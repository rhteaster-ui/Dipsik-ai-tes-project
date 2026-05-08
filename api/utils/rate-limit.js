/* Sliding-window rate limiter (in-memory).
 *
 * Pakai untuk endpoint Vercel Serverless. Storage map akan di-share antar
 * invocation pada container yang sama (best-effort) dan reset ketika
 * container di-recycle. Cocok untuk anti-spam ringan di portofolio/demo.
 *
 * Flow:
 *   const result = checkRateLimit({ key, windowMs, max });
 *   if (!result.allowed) -> kirim 429 dengan retryAfter detik
 */

const STORE_KEY = '__exploreLabRateLimit';
globalThis[STORE_KEY] = globalThis[STORE_KEY] || new Map();
const store = globalThis[STORE_KEY];

const MAX_TRACKED_KEYS = 5000;

function pruneStore(now) {
  if (store.size <= MAX_TRACKED_KEYS) return;
  const entries = Array.from(store.entries());
  entries.sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const toEvict = entries.slice(0, store.size - MAX_TRACKED_KEYS);
  for (const [key] of toEvict) store.delete(key);
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
