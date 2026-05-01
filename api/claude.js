import axios from 'axios';

const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const CLAUDE_ENDPOINT = 'https://api.deepai.org/hacking_is_a_serious_crime';
const REQUEST_TIMEOUT_MS = 20000;

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function generateApiKey() {
  const r = Math.floor(1e11 * Math.random());
  return `tryit-${r}-a3edf17b505349f1794bcdbc7290a045`;
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function safeJsonLog(level, event, fields = {}) {
  const payload = { ts: new Date().toISOString(), level, event, ...fields };
  const line = `${JSON.stringify(payload)}\n`;
  if (level === 'error') process.stderr.write(line);
  else process.stdout.write(line);
}

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { prompt = '', question = '' } = req.body || {};
    const input = String(prompt || question || '').trim().slice(0, 4000);

    if (!input) {
      return res.status(400).json({ error: 'Prompt wajib diisi.' });
    }

    const formData = new FormData();
    formData.append('chat_style', 'claudeai_0');
    formData.append('chatHistory', JSON.stringify([{ role: 'user', content: input }]));
    formData.append('model', 'standard');
    formData.append('session_uuid', generateUUID());
    formData.append('hacker_is_stinky', 'very_stinky');

    const apiKey = generateApiKey();
    const response = await axios.post(CLAUDE_ENDPOINT, formData, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'api-key': apiKey,
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
        referer: 'https://deepai.org/chat/claude-3-haiku',
        accept: '*/*',
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      safeJsonLog('error', 'claude.upstream_error', { status: response.status });
      return res.status(response.status).json({
        error: 'Claude upstream gagal.',
        detail: response.data || null,
      });
    }

    const reply = String(
      response?.data?.output || response?.data?.response || response?.data?.text || ''
    ).trim();

    return res.status(200).json({
      reply: reply || 'Balasan model kosong. Coba ulangi pertanyaan.',
      raw: response.data,
      model: 'claude',
    });
  } catch (error) {
    safeJsonLog('error', 'claude.handler_error', {
      message: error?.message || 'Internal Server Error',
      name: error?.name || 'Error',
    });

    const isTimeout = error?.code === 'ECONNABORTED';
    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? 'Timeout saat menghubungi Claude. Coba ulangi.' : (error?.message || 'Internal Server Error'),
    });
  }
}
