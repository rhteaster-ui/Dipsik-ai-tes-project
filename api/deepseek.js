import { randomBytes } from 'node:crypto';

const base = 'https://api-preview.chatgot.io';
const REQUEST_TIMEOUT_MS = 45000;

const hdrs = {
  accept: 'text/event-stream',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'content-type': 'application/json',
  origin: 'https://deepseekfree.ai',
  referer: 'https://deepseekfree.ai/',
  'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
};

const randomDeviceId = () => randomBytes(16).toString('hex');

function makeRequestId() {
  return `ds-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

function safeJsonLog(level, event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

function extractTextFileContext(files = []) {
  if (!Array.isArray(files)) return [];

  return files
    .slice(0, 3)
    .map((file, idx) => {
      if (!file || typeof file !== 'object') return null;
      const name = String(file.name || `file-${idx + 1}`).trim();
      const mime = String(file.mimeType || file.type || '').toLowerCase();

      if (typeof file.text === 'string' && file.text.trim()) {
        return { name, text: file.text.trim().slice(0, 12000) };
      }

      if (typeof file.base64 === 'string' && file.base64 && (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml'))) {
        try {
          const text = Buffer.from(file.base64, 'base64').toString('utf8').trim();
          if (text) return { name, text: text.slice(0, 12000) };
        } catch {
          return null;
        }
      }

      return null;
    })
    .filter(Boolean);
}

function withFileContext(prompt, files = []) {
  const contexts = extractTextFileContext(files);
  if (!contexts.length) return prompt;

  const joined = contexts.map((file) => `Nama file: ${file.name}\nIsi file:\n${file.text}`).join('\n\n---\n\n');
  return `${prompt}\n\nGunakan konteks file berikut jika relevan:\n\n${joined}`;
}

async function chat(message, modelId = 2, requestId = makeRequestId()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/api/v1/char-gpt/conversations`, {
      method: 'POST',
      headers: hdrs,
      signal: controller.signal,
      body: JSON.stringify({
        device_id: randomDeviceId(),
        model_id: modelId,
        include_reasoning: false,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DeepSeek API ${res.status}: ${text || 'Request gagal'}`);
    }

    if (!res.body) return '';

    let data = '';
    let sseBuffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      sseBuffer += decoder.decode(chunk, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const json = JSON.parse(line.slice(5).trim());
          if (json?.data?.content) data += json.data.content;
        } catch {
          safeJsonLog('warn', 'deepseek.sse_chunk_parse_failed', { requestId });
        }
      }
    }

    if (sseBuffer.startsWith('data:')) {
      try {
        const tailJson = JSON.parse(sseBuffer.slice(5).trim());
        if (tailJson?.data?.content) data += tailJson.data.content;
      } catch {
        safeJsonLog('warn', 'deepseek.sse_tail_parse_failed', { requestId });
      }
    }

    return data.trim();
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const requestId = makeRequestId();

  try {
    const { prompt = '', question = '', messages = [], files = [], model = '' } = req.body || {};
    const latestMessage = Array.isArray(messages) ? [...messages].reverse().find((m) => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim()) : null;
    const rawPrompt = String(prompt || question || latestMessage?.content || '').trim();

    if (!rawPrompt) {
      return res.status(400).json({ error: 'Prompt wajib diisi.', requestId });
    }

    const normalizedModel = String(model || '').toLowerCase();
    const modelId = normalizedModel.includes('reasoner') ? 3 : 2;
    const finalPrompt = withFileContext(rawPrompt, files);
    const reply = await chat(finalPrompt, modelId, requestId);

    return res.status(200).json({
      reply: reply || 'Balasan model kosong. Coba ulangi pertanyaan.',
      model: modelId === 3 ? 'deepseek-reasoner' : 'deepseek-chat',
      requestId,
      sessionId: `chatgot-${Date.now()}`,
    });
  } catch (error) {
    safeJsonLog('error', 'deepseek.handler_error', {
      requestId,
      message: error?.message || 'Internal Server Error',
      name: error?.name || 'Error',
    });

    const isTimeout = error?.name === 'AbortError';
    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? 'Timeout saat menghubungi DeepSeek. Coba ulangi.' : (error?.message || 'Internal Server Error'),
      requestId,
    });
  }
}
