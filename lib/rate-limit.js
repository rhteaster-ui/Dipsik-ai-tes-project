/* Sliding-window rate limiter (in-memory) + image-gen cooldown.
 *
 * Pakai untuk endpoint Vercel Serverless. Storage map akan di-share antar
 * invocation pada container yang sama (best-effort) dan reset ketika
 * container di-recycle. Cocok untuk anti-spam ringan di portofolio/demo.
 *
 * Dua mekanisme:
 *   1. checkRateLimit / applyRateLimit  -> sliding window (60 req/menit dll)
 *   2. checkImageGenCooldown            -> setelah N generasi gambar,
 *      paksa cooldown durasi tertentu sebelum boleh generate lagi.
 */

const STORE_KEY = '__exploreLabRateLimit';
globalThis[STORE_KEY] = globalThis[STORE_KEY] || new Map();
const store = globalThis[STORE_KEY];

const COOLDOWN_KEY = '__exploreLabImagegenCooldown';
globalThis[COOLDOWN_KEY] = globalThis[COOLDOWN_KEY] || new Map();
const cooldownStore = globalThis[COOLDOWN_KEY];

const MAX_TRACKED_KEYS = 5000;

function pruneStore(now) {
  if (store.size <= MAX_TRACKED_KEYS) return;
  const entries = Array.from(store.entries());
  entries.sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const toEvict = entries.slice(0, store.size - MAX_TRACKED_KEYS);
  for (const [key] of toEvict) store.delete(key);
}

function pruneCooldownStore(now) {
  if (cooldownStore.size <= MAX_TRACKED_KEYS) return;
  const entries = Array.from(cooldownStore.entries());
  entries.sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const toEvict = entries.slice(0, cooldownStore.size - MAX_TRACKED_KEYS);
  for (const [key] of toEvict) cooldownStore.delete(key);
}

export function checkRateLimit({ key, windowMs = 60_000, max = 60 }) {
  if (!key) return { allowed: true, remaining: max, retryAfter: 0 };

  const now = Date.now();
  const cutoff = now - windowMs;
  const bucket = store.get(key) || { hits: [], lastSeen: now };

  bucket.hits = bucket.hits.filter((ts) => ts > cutoff);

  if (bucket.hits.length >= max) {
    const oldest = bucket.hits[0] || now;
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    bucket.lastSeen = now;
    store.set(key, bucket);
    pruneStore(now);
    return { allowed: false, remaining: 0, retryAfter };
  }

  bucket.hits.push(now);
  bucket.lastSeen = now;
  store.set(key, bucket);
  pruneStore(now);

  return { allowed: true, remaining: Math.max(0, max - bucket.hits.length), retryAfter: 0 };
}

export function getClientKey(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers?.['x-real-ip'] || '').trim();
  const remote = String(req.socket?.remoteAddress || '').trim();
  return forwarded || real || remote || 'anon';
}

export function applyRateLimit(req, res, options = {}) {
  const key = options.key || getClientKey(req);
  const result = checkRateLimit({
    key: `${options.scope || 'global'}:${key}`,
    windowMs: options.windowMs || 60_000,
    max: options.max || 60,
  });

  res.setHeader('X-RateLimit-Limit', String(options.max || 60));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfter));
  }
  return result;
}

/**
 * Cooldown khusus image generation:
 *  - Setiap IP boleh generate `burstMax` gambar berturut.
 *  - Setelah burst tercapai, IP wajib menunggu `cooldownMs` ms sebelum
 *    boleh generate lagi.
 *  - Setelah cooldown habis, counter direset, IP boleh burst lagi.
 *
 * Tidak menahan gambar yang sedang berjalan; hanya menolak request baru
 * di atas burst sampai cooldown habis.
 */
export function checkImageGenCooldown({ key, burstMax = 3, cooldownMs = 120_000, recordHit = true }) {
  if (!key) return { allowed: true, remaining: burstMax, retryAfter: 0, count: 0, cooldown: false };
  const now = Date.now();
  const bucket = cooldownStore.get(key) || { count: 0, firstHit: now, blockedUntil: 0, lastSeen: now };

  if (bucket.blockedUntil && now < bucket.blockedUntil) {
    bucket.lastSeen = now;
    cooldownStore.set(key, bucket);
    pruneCooldownStore(now);
    const retryAfter = Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
    return { allowed: false, remaining: 0, retryAfter, count: bucket.count, cooldown: true };
  }

  if (bucket.blockedUntil && now >= bucket.blockedUntil) {
    bucket.count = 0;
    bucket.firstHit = now;
    bucket.blockedUntil = 0;
  }

  if (!recordHit) {
    return {
      allowed: true,
      remaining: Math.max(0, burstMax - bucket.count),
      retryAfter: 0,
      count: bucket.count,
      cooldown: false,
    };
  }

  bucket.count = (bucket.count || 0) + 1;
  bucket.lastSeen = now;

  if (bucket.count >= burstMax) {
    bucket.blockedUntil = now + cooldownMs;
  }

  cooldownStore.set(key, bucket);
  pruneCooldownStore(now);

  return {
    allowed: true,
    remaining: Math.max(0, burstMax - bucket.count),
    retryAfter: 0,
    count: bucket.count,
    cooldown: bucket.count >= burstMax,
    cooldownEndsIn: bucket.count >= burstMax ? Math.ceil(cooldownMs / 1000) : 0,
  };
}

export function applyImageGenCooldown(req, res, options = {}) {
  const key = `imagegen-cooldown:${options.key || getClientKey(req)}`;
  const burstMax = options.burstMax || 3;
  const cooldownMs = options.cooldownMs || 120_000;
  const result = checkImageGenCooldown({
    key,
    burstMax,
    cooldownMs,
    recordHit: options.recordHit !== false,
  });

  res.setHeader('X-ImageGen-Burst-Max', String(burstMax));
  res.setHeader('X-ImageGen-Burst-Remaining', String(result.remaining));
  if (result.cooldownEndsIn) {
    res.setHeader('X-ImageGen-Cooldown-Seconds', String(result.cooldownEndsIn));
  }
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfter));
  }
  return result;
}
