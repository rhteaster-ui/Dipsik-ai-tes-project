import crypto from 'node:crypto';

const limiter = globalThis.__gptLimiter || new Map();
globalThis.__gptLimiter = limiter;

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function enforceRateLimit(ip) {
  const now = Date.now();
  const item = limiter.get(ip) || { count: 0, resetAt: now + 60_000, last: 0 };

  if (now > item.resetAt) {
    item.count = 0;
    item.resetAt = now + 60_000;
  }

  if (now - item.last < 1500) {
    return { ok: false, status: 429, message: 'Terlalu cepat. Beri jeda sekitar 1-2 detik antar request.' };
  }

  item.count += 1;
  item.last = now;
  limiter.set(ip, item);

  if (item.count > 16) {
    return { ok: false, status: 429, message: 'Batas request per menit tercapai. Coba lagi sebentar.' };
  }

  return { ok: true };
}

function normalizeHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((m) => m && typeof m === 'object' && (m.text || (Array.isArray(m.images) && m.images.length)))
    .slice(-12)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: String(m.text || '').trim().slice(0, 1200),
      images: (Array.isArray(m.images) ? m.images : []).slice(0, 2),
    }));
}

function buildUserMessage(prompt, history = []) {
  const safePrompt = String(prompt || '').trim().slice(0, 4000);
  const safeHistory = normalizeHistory(history);

  if (!safeHistory.length) return safePrompt;

  const historyText = safeHistory
    .map((item) => {
      const role = item.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${item.text}`;
    })
    .filter(Boolean)
    .join('\n');

  return [
    'Lanjutkan percakapan berikut secara konsisten dan natural.',
    'Riwayat percakapan:',
    historyText,
    '',
    `Pertanyaan terbaru pengguna: ${safePrompt}`,
  ].join('\n');
}

function normalizeImageUrls(images = []) {
  if (!Array.isArray(images)) return [];

  return images
    .map((value) => String(value || '').trim())
    .filter((url) => /^https?:\/\//i.test(url) || /^data:image\//i.test(url))
    .slice(0, 2);
}

async function noteGptChat({ message, imageUrls = [] }) {
  const conversationId = crypto.randomUUID();
  const response = await fetch('https://notegpt.io/api/v2/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
      Referer: 'https://notegpt.io/ai-chat',
    },
    body: JSON.stringify({
      message,
      language: 'id',
      model: 'gpt-5-mini',
      tone: 'default',
      length: 'moderate',
      conversation_id: conversationId,
      image_urls: imageUrls,
      chat_mode: 'standard',
    }),
  });

  if (!response.ok || !response.body) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`NoteGPT error ${response.status}: ${bodyText || 'empty response body'}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload);
        if (typeof json.text === 'string' && json.text) {
          fullText += json.text;
        }
        if (json.done) {
          return {
            success: true,
            message: fullText.trim(),
            conversationId,
          };
        }
      } catch {
        // ignore malformed chunk
      }
    }
  }

  return {
    success: true,
    message: fullText.trim(),
    conversationId,
  };
}

async function requestWithRetry(payload) {
  const maxAttempts = 3;
  const retryDelayMs = [900, 1600];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await noteGptChat(payload);
      if (result?.message) return result;

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs[attempt - 1] || 2000));
        continue;
      }

      return result;
    } catch (error) {
      const msg = String(error?.message || '').toLowerCase();
      const retryable = msg.includes('429') || msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') || msg.includes('timeout');

      if (!retryable || attempt >= maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs[attempt - 1] || 2000));
    }
  }

  throw new Error('NoteGPT gagal setelah beberapa percobaan.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const ip = getIp(req);
  const limited = enforceRateLimit(ip);
  if (!limited.ok) {
    return res.status(limited.status).json({ error: limited.message });
  }

  try {
    const {
      prompt = '',
      history = [],
      images = [],
    } = req.body || {};

    const safePrompt = String(prompt || '').trim().slice(0, 4000);
    if (!safePrompt) {
      return res.status(400).json({ error: 'Prompt wajib diisi.' });
    }

    const message = buildUserMessage(safePrompt, history);
    const imageUrls = normalizeImageUrls(images);
    const result = await requestWithRetry({ message, imageUrls });
    const cleanReply = String(result?.message || '').trim();

    if (!cleanReply) {
      return res.status(200).json({
        reply: 'Balasan model kosong. Silakan ulangi pertanyaan dengan lebih spesifik.',
        reason: 'EMPTY_MODEL_OUTPUT',
        model: 'gpt-5-mini',
        conversationId: result?.conversationId || null,
      });
    }

    return res.status(200).json({
      reply: cleanReply,
      model: 'gpt-5-mini',
      conversationId: result?.conversationId || null,
      imageCount: imageUrls.length,
    });
  } catch (error) {
    console.error('gpt handler error', error);
    return res.status(500).json({
      error: error.message || 'Internal Server Error',
    });
  }
}
