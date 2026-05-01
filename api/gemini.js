import axios from 'axios';
import crypto from 'crypto';

const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const NOTE_GPT_URL = 'https://notegpt.io/api/v2/chat/stream';
const DEFAULT_CHAT_MODEL = 'gemini-3.1-flash-lite-preview';
const DEFAULT_FILE_MODEL = 'gemini-2.5-flash';

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

async function noteGptChat({ message, conversationId, model }) {
  let fullText = '';
  const response = await axios.post(
    NOTE_GPT_URL,
    {
      message,
      language: 'auto',
      model,
      tone: 'default',
      length: 'moderate',
      conversation_id: conversationId,
      image_urls: [],
      chat_mode: 'standard',
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
        Referer: 'https://notegpt.io/ai-chat',
      },
      responseType: 'stream',
      timeout: 45000,
    }
  );

  return new Promise((resolve, reject) => {
    response.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(line.slice(6));
          if (json.text) fullText += json.text;
          if (json.done) {
            resolve(fullText.trim());
          }
        } catch (_) {}
      }
    });
    response.data.on('error', reject);
    response.data.on('end', () => resolve(fullText.trim()));
  });
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { prompt = '', hasFile = false, model = '' } = req.body || {};
    const text = String(prompt || '').trim();
    if (!text) return res.status(400).json({ error: 'Prompt wajib diisi.' });

    const selectedModel = String(model || '').trim() || (hasFile ? DEFAULT_FILE_MODEL : DEFAULT_CHAT_MODEL);
    const conversationId = crypto.randomUUID();
    const reply = await noteGptChat({ message: text, conversationId, model: selectedModel });
    return res.status(200).json({ reply, conversationId, model: selectedModel });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Gagal memproses permintaan Gemini.' });
  }
}
