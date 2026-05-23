/**
 * ExploreAi Studio — model image-gen "deep-image".
 *
 * Module ESM yang membungkus public free-image-generator dari
 * https://deep-image.ai. Sengaja DIBUAT FRESH dari skrip CLI demo
 * `Studio/deep-image-txt2img.mjs` tapi:
 *   - bisa di-import (export `generateDeepImage`),
 *   - parameter prompt/width/height/seed dinamis,
 *   - polling adaptif dengan timeout total wajar (≤ 25 detik supaya
 *     ramah Vercel function timeout default 30 detik),
 *   - error model konsisten ({ ok, status, imageUrl, error, provider }).
 *
 * Tidak butuh API key. Tetap dipanggil lewat `api/studio.js`
 * sehingga rate-limit + cooldown anti-spam tetap berlaku.
 */
import crypto from 'node:crypto';

const API = 'https://api.deep-image.ai';
const ORIGIN = 'https://deep-image.ai';
const UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

const DEFAULT_POLL_DELAY_MS = 1500;
const DEFAULT_MAX_POLL = 14; // 14 * 1500ms = 21s, masih < 25s budget
const REQUEST_TIMEOUT_MS = 12_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeClientId() {
  return crypto.randomBytes(16).toString('hex');
}

function clampDimension(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.round(n), 256), max);
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

function baseHeaders(clientId) {
  return {
    'user-agent': UA,
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    'x-client-id': clientId,
    origin: ORIGIN,
    referer: `${ORIGIN}/`,
    'sec-ch-ua-platform': '"Android"',
    'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    'sec-ch-ua-mobile': '?1',
    'sec-fetch-site': 'same-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    priority: 'u=1, i',
  };
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

async function requestJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}`);
    err.status = response.status;
    err.data = json;
    throw err;
  }
  return { status: response.status, json };
}

/**
 * Generate gambar dari teks prompt via deep-image.ai free generator.
 *
 * @param {Object} opts
 * @param {string} opts.prompt   - prompt teks (wajib).
 * @param {string} [opts.ratio]  - aspek rasio (1:1, 16:9, dst).
 * @param {number} [opts.width]  - override width (256..2048).
 * @param {number} [opts.height] - override height (256..2048).
 * @param {number} [opts.maxPoll]
 * @param {number} [opts.pollDelayMs]
 * @returns {Promise<{ok:boolean,status:number,imageUrl:string,error?:string,provider:string,model:string,prompt:string}>}
 */
export async function generateDeepImage(opts = {}) {
  const prompt = String(opts.prompt || '').trim();
  if (!prompt) {
    return {
      ok: false,
      status: 400,
      imageUrl: '',
      error: 'Prompt wajib diisi.',
      provider: 'deep-image',
      model: 'google-gemini-image-flash-free',
      prompt,
    };
  }

  const ratio = String(opts.ratio || '1:1').trim();
  const fallback = ratioToSize(ratio);
  const width = clampDimension(opts.width, fallback.width, 2048);
  const height = clampDimension(opts.height, fallback.height, 2048);
  const maxPoll = Number.isFinite(opts.maxPoll) ? opts.maxPoll : DEFAULT_MAX_POLL;
  const pollDelayMs = Number.isFinite(opts.pollDelayMs) ? opts.pollDelayMs : DEFAULT_POLL_DELAY_MS;

  const clientId = makeClientId();

  let create;
  try {
    create = await requestJson(`${API}/api/public/free-image-generator/generate`, {
      method: 'POST',
      headers: baseHeaders(clientId),
      body: JSON.stringify({ prompt, width, height }),
    });
  } catch (error) {
    return {
      ok: false,
      status: error.status || 502,
      imageUrl: '',
      error: error?.data?.message || error?.message || 'Gagal memulai job deep-image.',
      provider: 'deep-image',
      model: 'google-gemini-image-flash-free',
      prompt,
    };
  }

  const job = create?.json?.job;
  if (!job) {
    return {
      ok: false,
      status: create.status || 502,
      imageUrl: '',
      error: 'Job deep-image tidak terbuat (response tidak lengkap).',
      provider: 'deep-image',
      model: 'google-gemini-image-flash-free',
      prompt,
    };
  }

  for (let i = 0; i < maxPoll; i++) {
    await sleep(pollDelayMs);

    let poll;
    try {
      poll = await requestJson(`${API}/api/apps/deep_image/v2/jobs/${job}`, {
        method: 'GET',
        headers: baseHeaders(clientId),
      });
    } catch (error) {
      return {
        ok: false,
        status: error.status || 502,
        imageUrl: '',
        error: error?.data?.message || error?.message || 'Polling deep-image gagal.',
        provider: 'deep-image',
        model: 'google-gemini-image-flash-free',
        prompt,
      };
    }

    const data = poll.json;

    if (data?.is_failed) {
      return {
        ok: false,
        status: poll.status,
        imageUrl: '',
        error: data?.error || 'Generation failed di upstream.',
        provider: 'deep-image',
        model:
          data?.generation_metadata?.model ||
          data?.data?.background?.generate?.model_type ||
          'google-gemini-image-flash-free',
        prompt,
      };
    }

    const resultUrl = data?.result?.result_url;
    if (resultUrl && /^https?:\/\//i.test(resultUrl)) {
      return {
        ok: true,
        status: poll.status,
        imageUrl: resultUrl,
        provider: 'deep-image',
        model:
          data?.generation_metadata?.model ||
          data?.data?.background?.generate?.model_type ||
          'google-gemini-image-flash-free',
        prompt,
      };
    }
  }

  return {
    ok: false,
    status: 408,
    imageUrl: '',
    error: 'Timeout menunggu hasil deep-image. Coba prompt lebih sederhana.',
    provider: 'deep-image',
    model: 'google-gemini-image-flash-free',
    prompt,
  };
}

export default { generateDeepImage };
