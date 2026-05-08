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
import { IDENTITY, buildIdentitySummaryText, isIdentityQuery } from './about.js';

const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const DAUNS_BASE = 'https://daunsloveelaina.daunscode.com';
const REQUEST_TIMEOUT_MS = 35_000;

const THINKING_SYSTEM_PROMPT = [
  'Kamu adalah asisten Explore Lab dalam mode Thinking — analisis mendalam.',
  'Sebelum menjawab, susun reasoning langkah demi langkah secara internal.',
  'Output kamu HARUS dalam dua bagian:',
  '1. Bagian "**Reasoning**" — penalaran ringkas (3-6 poin) yang menjelaskan asumsi, langkah, dan trade-off.',
  '2. Bagian "**Jawaban**" — kesimpulan akhir yang to the point.',
  'Gunakan markdown. Untuk kode, selalu pakai code block dengan label bahasa.',
  'Jangan halusinasi; bila kurang konteks, sebut asumsi yang kamu pakai.',
].join('\n');

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

/**
 * Forward auth-related headers on internal self-fetches so the inner lambda
 * isn't blocked by Vercel Deployment Protection (preview SSO). Harmless in
 * production where these headers are absent.
 */
function buildInternalHeaders(req, extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (req?.headers?.cookie) headers.cookie = req.headers.cookie;
  if (req?.headers?.['x-vercel-protection-bypass']) {
    headers['x-vercel-protection-bypass'] = req.headers['x-vercel-protection-bypass'];
  }
  if (req?.headers?.authorization) headers.authorization = req.headers.authorization;
  return headers;
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

function buildSystemPromptWithIdentity(extraSystem = '') {
  const identitySummary = buildIdentitySummaryText();
  const extra = String(extraSystem || '').trim();
  return [identitySummary, extra].filter(Boolean).join('\n\n');
}

async function chatViaGemini(req, body) {
  try {
    const requestedModel = String(body.model || '').trim();
    const isThinking = body.thinking === true || requestedModel === 'thinking';
    const finalModel = isThinking
      ? 'gemini-2.5-pro'
      : (requestedModel && /^gemini/.test(requestedModel) ? requestedModel : MODEL_CATALOG.defaultModel);
    const baseSystem = isThinking ? THINKING_SYSTEM_PROMPT : (body.system || '');
    const finalSystem = buildSystemPromptWithIdentity(baseSystem);

    const response = await fetchWithTimeout(buildSelfUrl(req, '/api/chat'), {
      method: 'POST',
      headers: buildInternalHeaders(req),
      body: JSON.stringify({
        prompt: body.prompt,
        question: body.prompt,
        model: finalModel,
        images: body.image_url ? [body.image_url] : (Array.isArray(body.images) ? body.images : []),
        history: Array.isArray(body.history) ? body.history : [],
        sessionId: String(body.sessionId || '').trim(),
        system: finalSystem,
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
      headers: buildInternalHeaders(req),
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
      headers: buildInternalHeaders(req),
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

/**
 * Klasifikasi niat dari prompt + konteks. Urutan prioritas:
 *   1. Identity (siapa kamu / siapa dev / dll) -> chat (jangan ke image-gen)
 *   2. Code/script request -> chat (jangan ke image-gen)
 *   3. Edit gambar (butuh image attachment + kata edit)
 *   4. Generate gambar (butuh kata generate + bukan kode)
 *   5. Search (kata cari/berita/terbaru)
 *   6. Default -> chat
 */
function classifyIntent({ prompt = '', hasImage = false, history = [] }) {
  const lower = String(prompt || '').toLowerCase();
  const recent = Array.isArray(history)
    ? history.slice(-3).map((m) => String(m?.text || '').toLowerCase()).join(' ')
    : '';
  const combined = `${recent} ${lower}`;

  // Code-related keywords menang atas image-gen
  const codeKeywords = [
    'script', 'kode', 'code', 'codingan', 'coding', 'function', 'fungsi',
    'html', 'css', 'javascript', 'js ', 'python', 'java ', 'typescript',
    'react', 'vue', 'angular', 'node', 'fastapi', 'django', 'flask',
    'sql', 'query', 'database', 'api', 'endpoint', 'class ', 'method',
    'algorithm', 'algoritma', 'regex', 'json', 'xml', 'yaml',
    'bug', 'error', 'debug', 'fix', 'refactor', 'optimize',
    'tampilkan kode', 'beri code', 'bikin script', 'tulis script',
    'tulis kode', 'buatkan script', 'buatkan kode', 'buat script',
    'buat kode', 'contoh kode', 'contoh script', 'contoh code',
    'snippet', 'syntax', 'sintaks', 'logic', 'logika', 'pseudocode',
  ];
  const isCode = codeKeywords.some((kw) => lower.includes(kw));

  // Identity / about
  if (isIdentityQuery(lower)) return 'chat-identity';

  // Code request menang
  if (isCode) return 'chat';

  const editPattern = /\b(edit|ubah|ganti|tambahkan|hapus|hilangkan|jadikan|tukar|ubahlah|kasih warna|jadikan latar)\b/;
  const generatePattern = /\b(generate gambar|bikin gambar|buatkan gambar|buat gambar|gambarkan|render(kan)? gambar|ilustrasi(kan)?|poster|wallpaper|draw|design(kan)? gambar|buatkan ilustrasi)\b/;
  const standaloneImageHint = /\b(gambar|image|foto)\b/.test(lower) && /\b(buat|bikin|generate|render|draw|create)\b/.test(lower);
  const searchPattern = /\b(cari|search|berita|terbaru|harga sekarang|update|news|trending|kurs|saham hari)\b/;

  if (hasImage && editPattern.test(lower)) return 'image-edit';
  if (!hasImage && (generatePattern.test(lower) || standaloneImageHint)) return 'image-generate';
  if (!hasImage && searchPattern.test(combined)) return 'search';

  return 'chat';
}

async function autoRoute(req, body) {
  const intent = classifyIntent({
    prompt: body?.prompt || '',
    hasImage: Boolean(body?.image_url),
    history: Array.isArray(body?.history) ? body.history : [],
  });

  if (intent === 'image-edit') {
    const out = await chatViaImageGen(req, body, 'edit');
    if (out.ok) return { ...out, intent };
  }

  if (intent === 'image-generate') {
    const out = await chatViaImageGen(req, body, 'generate');
    if (out.ok) return { ...out, intent };
  }

  if (intent === 'search') {
    const out = await chatViaPerplexity(req, body);
    if (out.ok) return { ...out, intent };
  }

  const gemini = await chatViaGemini(req, body);
  if (gemini.ok) return { ...gemini, intent };

  const dauns = await runDaunsChain(body, 'chatgpt');
  if (dauns.ok) return { ...dauns, intent };

  const perplexity = await chatViaPerplexity(req, body);
  if (perplexity.ok) return { ...perplexity, intent };

  return {
    ok: false,
    status: 503,
    provider: 'auto',
    intent,
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

    if (requestPath === '/v1/about') {
      return res.status(200).json({ identity: IDENTITY, summary: buildIdentitySummaryText() });
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
