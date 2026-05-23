/* ExploreAi Studio — endpoint dedikasi untuk image generation & edit.
 *
 * Routing:
 *   POST /api/studio
 *     body: { prompt, model?, ratio?, image_url?, mode? }
 *     - model = pollinations-flux (default) | pollinations-turbo | deep-image | nanobanana-edit
 *     - mode  = 'generate' (default) | 'edit'   (auto = edit kalau image_url ada)
 *
 * Keamanan:
 *   - applyRateLimit (60 req/menit per IP, scope khusus 'studio')
 *   - applyImageGenCooldown (3 burst, jeda 2 menit)
 *   - max prompt 2000 char, max image_url 2 MB-base64 (validasi panjang URL ≤ 3.5 MB)
 *
 * Output:
 *   { reply, imageUrl, provider, model, mode, prompt }
 */

import { applyRateLimit, applyImageGenCooldown } from '../../lib/rate-limit.js';
import { generateDeepImage } from '../../Studio/explore-deep-imagen.mjs';

const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';
const DAUNS_BASE = 'https://daunsloveelaina.daunscode.com';

const MAX_PROMPT = 2000;
const MAX_IMAGE_PAYLOAD = 3_500_000;

const POLLINATIONS_MODELS = new Set(['flux', 'turbo']);

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function jsonOk(res, data) {
  return res.status(200).json({ ...data, ok: true, error: null });
}

function jsonErr(res, status, code, message) {
  return res.status(status).json({
    ok: false,
    imageUrl: '',
    reply: '',
    error: { code, message },
  });
}

function ratioToSize(ratio = '1:1') {
  const map = {
    '1:1': { width: 1024, height: 1024 },
    '16:9': { width: 1280, height: 720 },
    '9:16': { width: 720, height: 1280 },
    '4:3': { width: 1024, height: 768 },
    '3:4': { width: 768, height: 1024 },
    '21:9': { width: 1280, height: 540 },
    '4:5': { width: 1024, height: 1280 },
  };
  return map[String(ratio || '1:1').trim()] || map['1:1'];
}

function buildPollinationsUrl({ prompt, ratio, model, seed }) {
  const { width, height } = ratioToSize(ratio);
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: 'true',
    enhance: 'true',
  });
  if (model && POLLINATIONS_MODELS.has(model)) params.set('model', model);
  if (seed) params.set('seed', String(seed));
  const safePrompt = encodeURIComponent(String(prompt || '').slice(0, 1500));
  return `${POLLINATIONS_BASE}/${safePrompt}?${params.toString()}`;
}

async function probeUrl(url, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function runPollinations({ prompt, ratio, model }) {
  const variant = POLLINATIONS_MODELS.has(model) ? model : 'flux';
  const url = buildPollinationsUrl({ prompt, ratio, model: variant });
  const ok = await probeUrl(url);
  return {
    ok,
    imageUrl: ok ? url : '',
    provider: ok ? 'pollinations' : '',
    model: variant,
    error: ok ? null : 'Pollinations.ai tidak merespon dalam batas waktu.',
  };
}

async function runNanobananaEdit({ prompt, imageUrl }) {
  try {
    const response = await fetch(`${DAUNS_BASE}/v1/ai/nanobanana`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_url: imageUrl }),
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { reply: raw }; }
    const candidates = [
      data.imageUrl,
      data.image,
      data.url,
      data?.result?.image,
      data?.result?.url,
      data?.data?.image,
      data?.data?.imageUrl,
      data?.data?.url,
    ];
    const found = candidates.find((v) => typeof v === 'string' && v.trim().startsWith('http'));
    if (found) {
      return {
        ok: true,
        imageUrl: found,
        provider: 'nanobanana',
        model: 'nanobanana-edit',
        reply: String(data.reply || '').trim(),
      };
    }
    return { ok: false, error: 'Nanobanana tidak mengembalikan URL gambar.' };
  } catch (error) {
    return { ok: false, error: error?.message || 'Upstream nanobanana error.' };
  }
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      providers: [
        { key: 'pollinations-flux',  label: 'Pollinations · Flux',  mode: 'generate' },
        { key: 'pollinations-turbo', label: 'Pollinations · Turbo', mode: 'generate' },
        { key: 'deep-image',         label: 'Deep Image · Free',    mode: 'generate' },
        { key: 'nanobanana-edit',    label: 'Nanobanana · Edit',    mode: 'edit'     },
      ],
      defaultModel: 'pollinations-flux',
      cooldown: { burstMax: 3, cooldownMs: 120_000 },
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method harus GET atau POST.' } });
  }

  const limit = applyRateLimit(req, res, { scope: 'studio', max: 30, windowMs: 60_000 });
  if (!limit.allowed) {
    return jsonErr(res, 429, 'RATE_LIMITED', `Terlalu banyak request. Coba lagi dalam ${limit.retryAfter} detik.`);
  }

  try {
    const body = req.body || {};
    const prompt = String(body.prompt || body.question || '').trim();
    const ratio = String(body.ratio || '1:1').trim();
    const requestedModel = String(body.model || 'pollinations-flux').trim().toLowerCase();
    const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() : '';
    const explicitMode = String(body.mode || '').toLowerCase();
    const mode = explicitMode === 'edit' || (imageUrl && requestedModel === 'nanobanana-edit') ? 'edit' : 'generate';

    if (!prompt) return jsonErr(res, 400, 'EMPTY_PROMPT', 'Prompt wajib diisi.');
    if (prompt.length > MAX_PROMPT) {
      return jsonErr(res, 400, 'PROMPT_TOO_LONG', `Prompt terlalu panjang (max ${MAX_PROMPT} karakter).`);
    }
    if (mode === 'edit' && !imageUrl) {
      return jsonErr(res, 400, 'IMAGE_REQUIRED', 'Mode edit butuh image_url.');
    }
    if (imageUrl && imageUrl.length > MAX_IMAGE_PAYLOAD) {
      return jsonErr(res, 413, 'IMAGE_TOO_BIG', 'Image payload terlalu besar (>~2.5 MB).');
    }

    // Cooldown khusus generate (bukan edit) — sama policy dengan /api/imagegen
    if (mode === 'generate') {
      const cooldown = applyImageGenCooldown(req, res, { burstMax: 3, cooldownMs: 120_000 });
      if (!cooldown.allowed) {
        const minutes = Math.ceil(cooldown.retryAfter / 60);
        return jsonErr(
          res,
          429,
          'COOLDOWN',
          `Sudah generate 3 gambar berturut. Tunggu ${cooldown.retryAfter} detik (~${minutes} menit) sebelum generate lagi.`,
        );
      }
    }

    if (mode === 'edit') {
      const edited = await runNanobananaEdit({ prompt, imageUrl });
      if (edited.ok) {
        return jsonOk(res, {
          reply: edited.reply || `Berhasil mengedit gambar: "${prompt}"`,
          imageUrl: edited.imageUrl,
          provider: edited.provider,
          model: edited.model,
          mode,
          prompt,
        });
      }
      return jsonErr(res, 502, 'EDIT_FAILED', edited.error || 'Edit gambar gagal.');
    }

    // mode === 'generate'
    if (requestedModel === 'deep-image') {
      const result = await generateDeepImage({ prompt, ratio });
      if (result.ok) {
        return jsonOk(res, {
          reply: `Gambar dibuat oleh Deep Image (model ${result.model}) — prompt: "${prompt}".`,
          imageUrl: result.imageUrl,
          provider: result.provider,
          model: result.model,
          mode,
          prompt,
        });
      }

      // Fallback ke pollinations supaya UX tidak gagal total kalau deep-image down
      const fallback = await runPollinations({ prompt, ratio, model: 'flux' });
      if (fallback.ok) {
        return jsonOk(res, {
          reply: `Deep Image upstream gagal (${result.error}). Fallback ke Pollinations Flux.`,
          imageUrl: fallback.imageUrl,
          provider: 'pollinations',
          model: 'flux',
          mode,
          prompt,
          fallback: true,
        });
      }
      return jsonErr(res, 502, 'GENERATE_FAILED', result.error || 'Deep Image gagal & fallback ikut gagal.');
    }

    // pollinations-flux / pollinations-turbo (default)
    const variant = requestedModel === 'pollinations-turbo' ? 'turbo' : 'flux';
    const pollinations = await runPollinations({ prompt, ratio, model: variant });
    if (pollinations.ok) {
      return jsonOk(res, {
        reply: `Gambar dibuat oleh Pollinations ${variant} — prompt: "${prompt}".`,
        imageUrl: pollinations.imageUrl,
        provider: 'pollinations',
        model: variant,
        mode,
        prompt,
      });
    }

    // Fallback ke deep-image kalau pollinations down
    const deep = await generateDeepImage({ prompt, ratio });
    if (deep.ok) {
      return jsonOk(res, {
        reply: `Pollinations gagal. Fallback ke Deep Image (${deep.model}).`,
        imageUrl: deep.imageUrl,
        provider: deep.provider,
        model: deep.model,
        mode,
        prompt,
        fallback: true,
      });
    }

    return jsonErr(res, 502, 'GENERATE_FAILED', pollinations.error || 'Semua provider image gagal.');
  } catch (error) {
    console.error('studio handler error', error);
    return jsonErr(res, 500, 'INTERNAL', error?.message || 'Internal Server Error');
  }
}
