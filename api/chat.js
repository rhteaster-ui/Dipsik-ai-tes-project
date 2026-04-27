const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const runtimeMemory = globalThis.__geminiChatMemory || new Map();
globalThis.__geminiChatMemory = runtimeMemory;

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}


function toInlineData(dataUrl) {
  const [meta, data] = dataUrl.split(',');
  const mime = meta?.match(/data:(.*?);base64/)?.[1] || 'image/png';
  return { inlineData: { mimeType: mime, data } };
}

function buildHistoryParts(history = []) {
  return history
    .filter((m) => m && (m.text || (m.images && m.images.length)))
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(m.text ? [{ text: String(m.text) }] : []),
        ...((m.images || []).map((img) => toInlineData(img))),
      ],
    }));
}

function sanitizeHistory(history = []) {
  return Array.isArray(history)
    ? history
        .filter((m) => m && typeof m === 'object' && (m.text || (Array.isArray(m.images) && m.images.length)))
        .slice(-16)
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          text: String(m.text || '').slice(0, 4000),
          images: Array.isArray(m.images) ? m.images.slice(0, 2) : [],
        }))
    : [];
}

function mergeSessionHistory(sessionId, incomingHistory = []) {
  const key = String(sessionId || '').trim();
  const storedHistory = key && runtimeMemory.has(key) ? runtimeMemory.get(key) : [];
  const merged = [...storedHistory, ...incomingHistory];
  return sanitizeHistory(merged).slice(-16);
}

function persistSessionHistory(sessionId, history = [], userPrompt = '', promptImages = [], replyText = '', replyImages = []) {
  const key = String(sessionId || '').trim();
  if (!key) return;

  const nextHistory = sanitizeHistory([
    ...history,
    { role: 'user', text: String(userPrompt || '').trim(), images: Array.isArray(promptImages) ? promptImages.slice(0, 2) : [] },
    { role: 'assistant', text: String(replyText || '').trim(), images: Array.isArray(replyImages) ? replyImages.slice(0, 2) : [] },
  ]).slice(-16);

  runtimeMemory.set(key, nextHistory);
}

async function callGemini({ apiKey, model, body }) {
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`;
  const maxAttempts = 3;
  const retryDelayMs = [800, 1600];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (response.ok) {
      return data;
    }

    const msg = data?.error?.message || JSON.stringify(data);
    const retryable = [429, 500, 503].includes(response.status);
    const hasNextAttempt = attempt < maxAttempts;

    if (retryable && hasNextAttempt) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs[attempt - 1] || 2000));
      continue;
    }

    throw new Error(`Gemini API ${response.status}: ${msg}`);
  }

  throw new Error('Gemini API gagal setelah beberapa percobaan.');
}


async function callGeminiUniversal({ prompt, history = [], images = [], system = '' }) {
  const endpoint = process.env.GEMINI_UNIVERSAL_URL || 'https://api.covenant.sbs/api/ai/gemini';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      prompt,
      question: prompt,
      history,
      images,
      system,
      model: 'gemini-universal',
    }),
  });

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    if (!response.ok) {
      throw new Error(raw?.trim() || `Gemini Universal API ${response.status}: invalid response`);
    }
    return { reply: raw?.trim() || '', images: [] };
  }

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Gemini Universal API ${response.status}`);
  }

  return {
    reply: String(data?.reply || data?.answer || data?.result || data?.msg || '').trim(),
    images: Array.isArray(data?.images) ? data.images : [],
  };
}

function extractOutput(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let reply = '';
  const images = [];

  for (const part of parts) {
    if (part.text) reply += `${part.text}\n`;
    if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith('image/')) {
      images.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
    }
  }

  return { reply: reply.trim(), images };
}

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY belum di-set di Vercel Environment Variables.' });
  }

  try {
    const {
      prompt = '',
      question = '',
      images = [],
      history = [],
      sessionId = '',
      mode = 'chat',
      model = 'gemini-2.5-flash',
      system = '',
    } = req.body || {};
    const incomingPrompt = String(prompt || question || '').trim();
    const sanitizedHistory = mergeSessionHistory(sessionId, sanitizeHistory(history));
    if (!incomingPrompt && !images.length) {
      return res.status(400).json({ error: 'Prompt wajib diisi.' });
    }
    const imageParts = images.map((img) => toInlineData(img));
    const contents = [...buildHistoryParts(sanitizedHistory)];
    const defaultSystemPrompt = 'Kamu asisten cerdas berbahasa Indonesia. Jawaban harus jelas, natural, dan helpful seperti ChatGPT. Untuk kode, gunakan markdown code block.';
    const envSystemPrompt = String(process.env.GEMINI_SYSTEM_PROMPT || '').trim();
    const requestSystemPrompt = String(system || '').trim();
    const systemInstruction = {
      parts: [{ text: requestSystemPrompt || envSystemPrompt || defaultSystemPrompt }],
    };

    const requestedModel = String(model || '').trim();
    const isUniversalModel = requestedModel === 'gemini-universal';

    contents.push({
      role: 'user',
      parts: [{ text: incomingPrompt }, ...imageParts],
    });

    const body = {
      contents,
      systemInstruction,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    };

    const output = isUniversalModel
      ? await callGeminiUniversal({
          prompt: incomingPrompt,
          history: sanitizedHistory,
          images,
          system: requestSystemPrompt || envSystemPrompt || defaultSystemPrompt,
        })
      : extractOutput(await callGemini({ apiKey, model: requestedModel || 'gemini-2.5-flash', body }));

    persistSessionHistory(sessionId, sanitizedHistory, incomingPrompt, images, output.reply, output.images);

    if (!output.reply && !output.images.length) {
      return res.status(200).json({ reply: 'Model tidak mengembalikan output. Coba ulangi prompt.', images: [] });
    }

    return res.status(200).json(output);
  } catch (error) {
    console.error('chat handler error', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
