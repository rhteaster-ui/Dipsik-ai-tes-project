const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const BASE_PROXY_URL = 'https://daunsloveelaina.daunscode.com';

const MODEL_CATALOG = {
  providers: [
    { key: 'gemini', label: 'Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
    { key: 'perplexity', label: 'Perplexity Search', models: ['sonar', 'sonar-pro'] },
    { key: 'dauns', label: 'Model Endpoint', models: ['chatgpt', 'notegpt', 'grok', 'deepai', 'nanobanana'] },
  ],
  defaultProvider: 'gemini',
  defaultModel: 'gemini-2.5-flash',
};

const PATH_BY_MODEL = {
  chatgpt: '/v1/ai/chatgpt',
  notegpt: '/v1/ai/notegpt',
  grok: '/v1/ai/grok',
  deepai: '/v1/ai/deepai',
  nanobanana: '/v1/ai/nanobanana',
};



function normalizeDaunsResponse(data = {}) {
  const payload = data && typeof data === 'object' ? data : {};
  const reply = [
    payload.reply,
    payload.answer,
    payload.result,
    payload.message,
    payload.msg,
    payload.text,
    payload?.data?.reply,
    payload?.data?.answer,
    payload?.data?.result,
    payload?.data?.message,
  ].find((v) => typeof v === 'string' && v.trim());

  const imageUrl = [
    payload.imageUrl,
    payload.image,
    payload.url,
    payload?.result?.image,
    payload?.data?.image,
    payload?.data?.imageUrl,
  ].find((v) => typeof v === 'string' && v.trim());

  return {
    ...payload,
    reply: reply ? String(reply).trim() : '',
    imageUrl: imageUrl ? String(imageUrl).trim() : '',
  };
}

function resolveDaunsPath(model = '') {
  const normalized = String(model || '').trim().toLowerCase();
  if (PATH_BY_MODEL[normalized]) return PATH_BY_MODEL[normalized];
  return PATH_BY_MODEL.chatgpt;
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

async function safeJson(response) {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : {}; } catch { return { reply: raw || '' }; }
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json(MODEL_CATALOG);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method harus GET atau POST' });

  try {
    const { path = '', body = {} } = req.body || {};
    if (path === '/v1/models') return res.status(200).json(MODEL_CATALOG);

    if (path === '/v1/chat') {
      const model = String(body?.model || MODEL_CATALOG.defaultModel).trim();
      if (!MODEL_CATALOG.providers[0].models.includes(model)) {
        return res.status(400).json({ error: `Model Gemini tidak tersedia: ${model}` });
      }
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const target = `${proto}://${host}/api/chat`;
      const response = await fetch(target, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: body.prompt,
          question: body.prompt,
          model,
          images: body.image_url ? [body.image_url] : [],
          history: Array.isArray(body.history) ? body.history : [],
          sessionId: String(body.sessionId || '').trim(),
        }),
      });
      const data = await safeJson(response);
      return res.status(response.status).json(data);
    }

    if (path === '/v1/perplexity') {
      const response = await fetch(`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/perplexity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: body.prompt, model: body.model || 'sonar' }),
      });
      const data = await safeJson(response);
      return res.status(response.status).json(data);
    }

    if (path === '/v1/dauns') {
      const model = String(body?.model || '').trim().toLowerCase();
      const targetPath = resolveDaunsPath(model);

      const payload = { prompt: String(body?.prompt || '').trim() };
      if (body?.image_url) payload.image_url = String(body.image_url);
      if (body?.ratio) payload.ratio = String(body.ratio);

      const response = await fetch(`${BASE_PROXY_URL}${targetPath}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await safeJson(response);
      return res.status(response.status).json(normalizeDaunsResponse(data));
    }

    return res.status(400).json({ error: 'Path tidak didukung. Gunakan /v1/models, /v1/chat, /v1/perplexity, atau /v1/dauns.' });
  } catch (error) {
    console.error('Backend Gateway Error:', error);
    return res.status(500).json({ error: error?.message || 'Internal Server Error dari Backend Gateway' });
  }
}
