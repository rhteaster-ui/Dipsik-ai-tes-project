import { randomBytes } from 'node:crypto';

const base = 'https://api-preview.chatgot.io';

const defaultHeaders = {
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

function randomDeviceId() {
  return randomBytes(16).toString('hex');
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  return {
    mimeType: match[1] || 'application/octet-stream',
    buffer: Buffer.from(match[2] || '', 'base64'),
  };
}

function parseTextFromFileLike(file, idx) {
  if (!file || typeof file !== 'object') return null;
  const name = String(file.name || `file-${idx + 1}`).trim();
  const mimeType = String(file.mimeType || file.type || '').toLowerCase();

  if (typeof file.text === 'string') {
    return { name, text: file.text.trim() };
  }

  if (typeof file.dataUrl === 'string') {
    const parsed = parseDataUrl(file.dataUrl);
    if (parsed && (parsed.mimeType.startsWith('text/') || parsed.mimeType.includes('json') || parsed.mimeType.includes('xml'))) {
      return { name, text: parsed.buffer.toString('utf8').trim() };
    }
  }

  if (typeof file.base64 === 'string' && mimeType && (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml'))) {
    return { name, text: Buffer.from(file.base64, 'base64').toString('utf8').trim() };
  }

  return null;
}

function withFileContext(prompt, files = []) {
  const snippets = (Array.isArray(files) ? files : [])
    .map((file, idx) => parseTextFromFileLike(file, idx))
    .filter((item) => item && item.text)
    .slice(0, 3)
    .map((item) => `Nama file: ${item.name}\nIsi file:\n${item.text.slice(0, 12000)}`);

  if (!snippets.length) return prompt;

  return `${prompt}\n\nGunakan konteks file berikut jika relevan:\n\n${snippets.join('\n\n---\n\n')}`;
}

async function chat(message, modelId = 2) {
  const res = await fetch(`${base}/api/v1/char-gpt/conversations`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({
      device_id: randomDeviceId(),
      model_id: Number.isFinite(Number(modelId)) ? Number(modelId) : 2,
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
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    const lines = decoder.decode(chunk, { stream: true }).split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        const json = JSON.parse(line.slice(5).trim());
        if (json?.data?.content) {
          data += json.data.content;
        }
      } catch {
        // abaikan chunk yang bukan JSON valid
      }
    }
  }

  return data.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { prompt = '', question = '', files = [], model = '' } = req.body || {};
    const rawPrompt = String(prompt || question || '').trim();
    if (!rawPrompt) return res.status(400).json({ error: 'Prompt wajib diisi.' });

    const modelId = String(model).toLowerCase().includes('reasoner') ? 3 : 2;
    const finalPrompt = withFileContext(rawPrompt, files);
    const reply = await chat(finalPrompt, modelId);

    return res.status(200).json({
      reply: reply || 'Balasan model kosong. Coba ulangi pertanyaan.',
      model: modelId === 3 ? 'deepseek-reasoner' : 'deepseek-chat',
      sessionId: `chatgot-${Date.now()}`,
    });
  } catch (error) {
    console.error('deepseek handler error', error);
    return res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
}
