/* Universal API gateway untuk Explore Lab.
 *
 * Frontend hanya bicara ke `/api/backend` dengan payload:
 *   { path: "/v1/...", method: "POST", body: {...} }
 *
 * Routing yang didukung:
 *   GET                            -> daftar provider/model
 *   POST  /v1/models               -> daftar provider/model
 *   POST  /v1/chat                 -> Gemini chat (api/chat.js)
 *   POST  /v1/perplexity           -> Perplexity / TurboSeek (api/perplexity.js)
 *   POST  /v1/dauns                -> Daunscode AI proxy (chatgpt/notegpt/grok/deepai/nanobanana)
 *   POST  /v1/image-generate       -> Pollinations.ai (api/imagegen.js, mode generate)
 *   POST  /v1/image-edit           -> Daunscode nanobanana (api/imagegen.js, mode edit)
 *   POST  /v1/auto                 -> auto-routing berdasarkan isi prompt + attachment
 *
 * Setiap route punya fallback chain supaya kalau upstream Daunscode/TurboSeek
 * down, user tetap dapat balasan yang bisa dipakai (bukan 500 mentah).
 */

import { applyRateLimit } from './utils/rate-limit.js';

const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const DAUNS_BASE = 'https://daunsloveelaina.daunscode.com';
const REQUEST_TIMEOUT_MS = 35_000;

const MODEL_CATALOG = {
  providers: [
    {
      key: 'gemini',
      label: 'Gemini',
      models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
      capabilities: ['chat', 'vision', 'document'],
    },
    {
      key: 'perplexity',
      label: 'Web Search',
      models: ['sonar', 'sonar-pro'],
      capabilities: ['chat', 'search'],
    },
    {
      key: 'dauns',
      label: 'Model Endpoint',
      models: ['chatgpt', 'notegpt', 'grok', 'deepai', 'nanobanana'],
      capabilities: ['chat', 'vision'],
    },
    {
      key: 'image',
      label: 'Image Studio',
      models: ['flux', 'turbo', 'nanobanana-edit'],
      capabilities: ['image-generate', 'image-edit'],
    },
  ],
  defaultProvider: 'gemini',
  defaultModel: 'gemini-2.5-flash',
};

const DAUNS_PATH_BY_MODEL = {
  chatgpt: '/v1/ai/chatgpt',
  notegpt: '/v1/ai/notegpt',
  grok: '/v1/ai/grok',
  deepai: '/v1/ai/deepai',
  nanobanana: '/v1/ai/nanobanana',
};

const DAUNS_CHAT_FALLBACK_ORDER = ['chatgpt', 'notegpt', 'grok', 'deepai'];

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

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeReply(payload = {}) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const replyCandidates = [
    data.reply, data.answer, data.result, data.message, data.msg, data.text,
    data?.data?.reply, data?.data?.answer, data?.data?.result, data?.data?.message,
    data?.choices?.[0]?.message?.content,
  ];
  const imageCandidates = [
    data.imageUrl, data.image, data.url,
    data?.result?.image, data?.result?.url,
    data?.data?.image, data?.data?.imageUrl, data?.data?.url,
  ];
  const reply = replyCandidates.find((v) => typeof v === 'string' && v.trim());
  const imageUrl = imageCandidates.find((v) => typeof v === 'string' && v.trim().startsWith('http'));

  return {
    ...data,
    reply: reply ? String(reply).trim() : '',
    imageUrl: imageUrl ? String(imageUrl).trim() : '',
  };
}

function resolveDaunsPath(model = '') {
  const normalized = String(model || '').trim().toLowerCase();
  return DAUNS_PATH_BY_MODEL[normalized] || DAUNS_PATH_BY_MODEL.chatgpt;
}

function buildSelfUrl(req, suffix) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers.host;
  return `${proto}://${host}${suffix}`;
}

async function callDaunsModel(model, body) {
  const targetPath = resolveDaunsPath(model);
  const payload = { prompt: String(body?.prompt || '').trim() };
  if (body?.image_url) payload.image_url = String(body.image_url);
  if (body?.ratio) payload.ratio = String(body.ratio);

  try {
    const response = await fetchWithTimeout(`${DAUNS_BASE}${targetPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await safeJson(response);
    const normalized = normalizeReply(data);
    return {
      ok: response.ok && Boolean(normalized.reply || normalized.imageUrl),
      status: response.status,
      data: normalized,
      provider: `dauns:${model}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      data: { reply: '', imageUrl: '' },
      error: error?.name === 'AbortError' ? 'Upstream timeout.' : (error?.message || 'Upstream error.'),
      provider: `dauns:${model}`,
    };
  }
}

async function chatViaGemini(req, body) {
  try {
    const response = await fetchWithTimeout(buildSelfUrl(req, '/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: body.prompt,
        question: body.prompt,
        model: body.model && /^gemini/.test(body.model) ? body.model : MODEL_CATALOG.defaultModel,
        images: body.image_url ? [body.image_url] : (Array.isArray(body.images) ? body.images : []),
        history: Array.isArray(body.history) ? body.history : [],
        sessionId: String(body.sessionId || '').trim(),
        system: body.system || '',
      }),
    });
    const data = await safeJson(response);
    const normalized = normalizeReply(data);
    return {
      ok: response.ok && Boolean(normalized.reply || normalized.imageUrl),
      status: response.status,
      data: normalized,
      provider: 'gemini',
    };
  } catch (error) {
    return { ok: false, status: 502, data: { reply: '', imageUrl: '' }, error: error?.message || 'Gemini error.', provider: 'gemini' };
  }
}

async function chatViaPerplexity(req, body) {
  try {
    const response = await fetchWithTimeout(buildSelfUrl(req, '/api/perplexity'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: body.prompt,
        model: body.model || 'sonar',
        history: Array.isArray(body.history) ? body.history : [],
      }),
    });
    const data = await safeJson(response);
    const normalized = normalizeReply(data);
    return {
      ok: response.ok && Boolean(normalized.reply),
      status: response.status,
      data: normalized,
      provider: 'perplexity',
    };
  } catch (error) {
    return { ok: false, status: 502, data: { reply: '', imageUrl: '' }, error: error?.message || 'Perplexity error.', provider: 'perplexity' };
  }
}

async function chatViaImageGen(req, body, mode) {
  try {
    const response = await fetchWithTimeout(buildSelfUrl(req, '/api/imagegen'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: body.prompt,
        ratio: body.ratio || '1:1',
        model: body.model && body.model !== 'nanobanana-edit' ? body.model : 'flux',
        image_url: mode === 'edit' ? (body.image_url || '') : '',
      }),
    });
    const data = await safeJson(response);
    const normalized = normalizeReply(data);
    return {
      ok: response.ok && Boolean(normalized.imageUrl),
      status: response.status,
      data: normalized,
      provider: data?.provider || (mode === 'edit' ? 'nanobanana' : 'pollinations'),
    };
  } catch (error) {
    return { ok: false, status: 502, data: { reply: '', imageUrl: '' }, error: error?.message || 'ImageGen error.', provider: 'pollinations' };
  }
}

async function runDaunsChain(body, preferred) {
  const order = preferred && DAUNS_PATH_BY_MODEL[preferred]
    ? [preferred, ...DAUNS_CHAT_FALLBACK_ORDER.filter((m) => m !== preferred)]
    : DAUNS_CHAT_FALLBACK_ORDER;

  const errors = [];
  for (const model of order) {
    const result = await callDaunsModel(model, body);
    if (result.ok) return result;
    if (result.error) errors.push(`${model}: ${result.error}`);
    else errors.push(`${model}: status ${result.status}`);
  }
  return {
    ok: false,
    status: 502,
    data: { reply: '', imageUrl: '' },
    provider: 'dauns:chain',
    error: errors.join(' | ') || 'Semua endpoint Daunscode tidak merespon.',
  };
}

async function autoRoute(req, body) {
  const prompt = String(body?.prompt || '').toLowerCase();
  const hasImage = Boolean(body?.image_url);
  const editPattern = /(edit|ubah|ganti|tambahkan|hapus|hilangkan|jadikan|tukar|ubahlah|kasih|kasi)\b/;
  const generatePattern = /(buat|generate|create|bikin|gambar(kan)?|render|draw|ilustrasi(kan)?|poster|wallpaper|design(kan)?)\b/;
  const searchPattern = /(cari|search|berita|terbaru|harga|update|news|kapan|siapa|dimana)\b/;

  if (hasImage && editPattern.test(prompt)) {
    const out = await chatViaImageGen(req, body, 'edit');
    if (out.ok) return out;
  }

  if (!hasImage && generatePattern.test(prompt)) {
    const out = await chatViaImageGen(req, body, 'generate');
    if (out.ok) return out;
  }

  if (!hasImage && searchPattern.test(prompt)) {
    const out = await chatViaPerplexity(req, body);
    if (out.ok) return out;
  }

  const gemini = await chatViaGemini(req, body);
  if (gemini.ok) return gemini;

  const dauns = await runDaunsChain(body, 'chatgpt');
  if (dauns.ok) return dauns;

  const perplexity = await chatViaPerplexity(req, body);
  if (perplexity.ok) return perplexity;

  return {
    ok: false,
    status: 503,
    provider: 'auto',
    data: { reply: '', imageUrl: '' },
    error: [gemini.error, dauns.error, perplexity.error].filter(Boolean).join(' | ') || 'Semua endpoint tidak tersedia.',
  };
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    return res.status(200).json(MODEL_CATALOG);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method harus GET atau POST' });
  }

  const limit = applyRateLimit(req, res, { scope: 'backend', max: 60, windowMs: 60_000 });
  if (!limit.allowed) {
    return res.status(429).json({ error: `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfter} detik.` });
  }

  try {
    const { path = '', body = {} } = req.body || {};
    const requestPath = String(path || '').trim();

    if (!requestPath || requestPath === '/v1/models') {
      return res.status(200).json(MODEL_CATALOG);
    }

    const safeBody = (body && typeof body === 'object') ? body : {};
    const promptText = typeof safeBody.prompt === 'string' ? safeBody.prompt : '';
    if (promptText.length > 8000) {
      return res.status(400).json({ error: 'Prompt terlalu panjang (maksimum 8000 karakter).' });
    }

    if (requestPath === '/v1/auto') {
      const out = await autoRoute(req, safeBody);
      return res.status(out.ok ? 200 : out.status || 502).json({ ...out.data, provider: out.provider, error: out.ok ? undefined : out.error });
    }

    if (requestPath === '/v1/chat') {
      const out = await chatViaGemini(req, safeBody);
      if (out.ok) return res.status(200).json({ ...out.data, provider: out.provider });
      const fallback = await runDaunsChain(safeBody, 'chatgpt');
      if (fallback.ok) return res.status(200).json({ ...fallback.data, provider: fallback.provider, fallbackFrom: 'gemini' });
      return res.status(out.status || 502).json({ ...out.data, error: out.error || 'Gemini tidak merespon dan fallback gagal.' });
    }

    if (requestPath === '/v1/perplexity') {
      const out = await chatViaPerplexity(req, safeBody);
      if (out.ok) return res.status(200).json({ ...out.data, provider: out.provider });
      return res.status(out.status || 502).json({ ...out.data, error: out.error || 'Perplexity tidak merespon.' });
    }

    if (requestPath === '/v1/dauns') {
      const preferred = String(safeBody.model || '').trim().toLowerCase();
      if (preferred === 'nanobanana') {
        const direct = await callDaunsModel('nanobanana', safeBody);
        if (direct.ok) return res.status(200).json({ ...direct.data, provider: direct.provider });
        return res.status(direct.status || 502).json({ ...direct.data, error: direct.error || 'Nanobanana tidak merespon.' });
      }
      const out = await runDaunsChain(safeBody, preferred);
      if (out.ok) return res.status(200).json({ ...out.data, provider: out.provider });
      return res.status(out.status || 502).json({ ...out.data, error: out.error || 'Semua endpoint Daunscode gagal.' });
    }

    if (requestPath === '/v1/image-generate') {
      const out = await chatViaImageGen(req, safeBody, 'generate');
      if (out.ok) return res.status(200).json({ ...out.data, provider: out.provider });
      return res.status(out.status || 502).json({ ...out.data, error: out.error || 'Image generation gagal.' });
    }

    if (requestPath === '/v1/image-edit') {
      if (!safeBody.image_url) {
        return res.status(400).json({ error: 'image_url wajib diisi untuk image-edit.' });
      }
      const out = await chatViaImageGen(req, safeBody, 'edit');
      if (out.ok) return res.status(200).json({ ...out.data, provider: out.provider });
      return res.status(out.status || 502).json({ ...out.data, error: out.error || 'Image edit gagal.' });
    }

    if (requestPath.startsWith('/v1/ai/')) {
      const segment = requestPath.split('/').pop().toLowerCase();
      const out = await callDaunsModel(segment || 'chatgpt', safeBody);
      if (out.ok) return res.status(200).json({ ...out.data, provider: out.provider });
      return res.status(out.status || 502).json({ ...out.data, error: out.error || 'Endpoint Daunscode tidak merespon.' });
    }

    return res.status(400).json({
      error: 'Path tidak didukung. Gunakan /v1/auto, /v1/models, /v1/chat, /v1/perplexity, /v1/dauns, /v1/image-generate, atau /v1/image-edit.',
    });
  } catch (error) {
    console.error('Backend Gateway Error:', error);
    return res.status(500).json({ error: error?.message || 'Internal Server Error dari Backend Gateway' });
  }
}
