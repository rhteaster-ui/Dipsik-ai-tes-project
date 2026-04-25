import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DeepSeekClient } = require('../deepseek-example/deepseek.js');

const runtimeState = globalThis.__deepseekRuntime || {
  client: null,
  isLoggedIn: false,
  sessions: new Map(),
  credsKey: null,
};
globalThis.__deepseekRuntime = runtimeState;

function sanitizeCredential(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function ensureClient(auth = {}) {
  const bodyEmail = sanitizeCredential(auth?.email);
  const bodyPassword = sanitizeCredential(auth?.password);
  const envEmail = sanitizeCredential(process.env.DEEPSEEK_EMAIL);
  const envPassword = sanitizeCredential(process.env.DEEPSEEK_PASSWORD);
  const email = bodyEmail || envEmail;
  const password = bodyPassword || envPassword;

  if (!email || !password) {
    throw new Error('Login DeepSeek belum diisi. Isi DEEPSEEK_EMAIL/DEEPSEEK_PASSWORD di server atau isi email/password di Pengaturan frontend.');
  }

  const nextCredsKey = `${email}::${password}`;
  if (!runtimeState.client || runtimeState.credsKey !== nextCredsKey) {
    runtimeState.client = new DeepSeekClient();
    runtimeState.isLoggedIn = false;
    runtimeState.sessions = new Map();
    runtimeState.credsKey = nextCredsKey;
  }

  if (!runtimeState.isLoggedIn) {
    await runtimeState.client.login(email, password);
    runtimeState.isLoggedIn = true;
  }

  return runtimeState.client;
}

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  const mimeType = match[1] || 'application/octet-stream';
  const data = match[2] || '';
  if (!data) return null;

  return {
    buffer: Buffer.from(data, 'base64'),
    mimeType,
  };
}

function buildFallbackPrompt(prompt, history = []) {
  const safePrompt = String(prompt || '').trim();
  const historyItems = Array.isArray(history)
    ? history
        .filter((m) => m && typeof m === 'object' && (m.text || (Array.isArray(m.images) && m.images.length)))
        .slice(-6)
    : [];

  if (!historyItems.length) return safePrompt;

  const historyText = historyItems
    .map((item) => {
      const role = item.role === 'assistant' ? 'Assistant' : 'User';
      const text = String(item.text || '').trim();
      return `${role}: ${text}`;
    })
    .filter(Boolean)
    .join('\n');

  return [
    'Lanjutkan percakapan berikut dengan konteks yang sama.',
    'Riwayat:',
    historyText,
    '',
    `Pertanyaan terbaru: ${safePrompt}`,
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      prompt = '',
      images = [],
      history = [],
      sessionId,
      thinking = true,
      search = false,
      auth = {},
    } = req.body || {};

    const safePrompt = String(prompt || '').trim().slice(0, 6000);
    if (!safePrompt) {
      return res.status(400).json({ error: 'Prompt wajib diisi.' });
    }

    const client = await ensureClient(auth);
    const conversationKey = String(sessionId || '').trim() || null;

    let chatSessionId = conversationKey ? runtimeState.sessions.get(conversationKey) : null;
    const isNewSession = !chatSessionId;

    if (!chatSessionId) {
      chatSessionId = await client.createSession();
      if (conversationKey) {
        runtimeState.sessions.set(conversationKey, chatSessionId);
      }
    }

    const fileIds = [];
    for (const image of Array.isArray(images) ? images.slice(0, 1) : []) {
      const parsed = dataUrlToBuffer(image);
      if (!parsed) continue;
      const extension = parsed.mimeType.split('/')[1] || 'bin';
      const filename = `upload-${Date.now()}.${extension}`;
      const fileId = await client.uploadFile(parsed.buffer, filename, parsed.mimeType);
      await client.waitForFile(fileId, { maxAttempts: 12, intervalMs: 1500 });
      fileIds.push(fileId);
    }

    const message = isNewSession
      ? buildFallbackPrompt(safePrompt, history)
      : safePrompt;

    const reply = await client.chat(chatSessionId, message, {
      thinking: Boolean(thinking),
      search: Boolean(search),
      fileIds,
    });

    const stableSessionId = conversationKey || chatSessionId;
    runtimeState.sessions.set(stableSessionId, chatSessionId);

    return res.status(200).json({
      reply: String(reply?.content || '').trim(),
      model: 'deepseek-web',
      sessionId: stableSessionId,
      messageId: reply?.message_id || null,
    });
  } catch (error) {
    const lowerMessage = String(error?.message || '').toLowerCase();

    if (lowerMessage.includes('login') || lowerMessage.includes('token') || lowerMessage.includes('auth')) {
      runtimeState.isLoggedIn = false;
    }

    console.error('deepseek handler error', error);
    return res.status(500).json({
      error: error?.message || 'Internal Server Error',
      code: error?.code || null,
    });
  }
}
