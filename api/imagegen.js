/* Text-to-image endpoint untuk Explore Lab.
 *
 * Primary: Pollinations.ai (free, no-key, stabil).
 * Fallback: Daunscode `/v1/ai/nanobanana` (kalau Pollinations down).
 * Mengembalikan URL gambar siap-pakai supaya frontend bisa langsung
 * <img src=... />. Tidak download blob ke server (hemat bandwidth).
 */

import { applyRateLimit, applyImageGenCooldown } from './utils/rate-limit.js';

const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';
const DAUNS_BASE = 'https://daunsloveelaina.daunscode.com';

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
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
  if (model) params.set('model', model);
  if (seed) params.set('seed', String(seed));
  const safePrompt = encodeURIComponent(String(prompt || '').slice(0, 1500));
  return `${POLLINATIONS_BASE}/${safePrompt}?${params.toString()}`;
}

async function probeUrl(url, timeoutMs = 15_000) {
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

async function tryDaunsImageEdit({ prompt, imageUrl }) {
  if (!imageUrl) return null;
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
    if (found) return { imageUrl: found, provider: 'nanobanana', reply: String(data.reply || '').trim() };
  } catch {
    /* swallow */
  }
  return null;
}

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const limit = applyRateLimit(req, res, { scope: 'imagegen', max: 20, windowMs: 60_000 });
  if (!limit.allowed) {
    return res.status(429).json({ error: `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfter} detik.` });
  }

  try {
    const body = req.body || {};
    const prompt = String(body.prompt || body.question || '').trim();
    const ratio = String(body.ratio || '1:1').trim();
    const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() : '';
    const mode = imageUrl ? 'edit' : 'generate';

    if (!prompt) return res.status(400).json({ error: 'Prompt wajib diisi.' });
    if (prompt.length > 2000) return res.status(400).json({ error: 'Prompt terlalu panjang (max 2000 karakter).' });

    // Cooldown khusus untuk generate (bukan edit). Default: 3 burst, lalu wajib jeda 2 menit.
    if (mode === 'generate') {
      const cooldown = applyImageGenCooldown(req, res, { burstMax: 3, cooldownMs: 120_000 });
      if (!cooldown.allowed) {
        const minutes = Math.ceil(cooldown.retryAfter / 60);
        return res.status(429).json({
          error: `Sudah generate 3 gambar berturut. Tunggu ${cooldown.retryAfter} detik (~${minutes} menit) sebelum generate lagi.`,
          retryAfter: cooldown.retryAfter,
          cooldown: true,
        });
      }
    }

    if (mode === 'edit') {
      const edited = await tryDaunsImageEdit({ prompt, imageUrl });
      if (edited) {
        return res.status(200).json({
          reply: edited.reply || `Berhasil mengedit gambar dengan instruksi: "${prompt}"`,
          imageUrl: edited.imageUrl,
          provider: edited.provider,
          mode,
        });
      }
      return res.status(502).json({
        error: 'Endpoint image-edit (nanobanana) tidak merespon. Coba lagi sebentar atau gunakan mode generate biasa.',
      });
    }

    const seed = Math.floor(Math.random() * 1_000_000);
    const primaryUrl = buildPollinationsUrl({ prompt, ratio, model: body.model || 'flux', seed });
    const ok = await probeUrl(primaryUrl, 30_000);
    if (ok) {
      return res.status(200).json({
        reply: `Gambar dibuat dari prompt: "${prompt}".`,
        imageUrl: primaryUrl,
        provider: 'pollinations',
        mode,
      });
    }

    const fallbackUrl = buildPollinationsUrl({ prompt, ratio, model: 'turbo', seed });
    return res.status(200).json({
      reply: `Gambar (mode cepat) dari prompt: "${prompt}".`,
      imageUrl: fallbackUrl,
      provider: 'pollinations-fallback',
      mode,
    });
  } catch (error) {
    console.error('imagegen handler error', error);
    return res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
}
