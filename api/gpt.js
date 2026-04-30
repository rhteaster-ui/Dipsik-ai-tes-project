const GPT_MODEL_MAP = {
  'gpt-5.1': 'openai/gpt-5.1-thinking',
  'gpt-5-online': 'openai/gpt-5-chat:online',
  'gpt-5': 'openai/gpt-5-chat',
  'gpt-5-nano': 'openai/gpt-5-nano',
  'gpt-5-mini': 'openai/gpt-5-mini',
  'openai-o1': 'openai/o1',
  'openai-o3': 'openai/o3',
  'openai-o3-mini': 'openai/o3-mini',
  'gpt-4o': 'openai/gpt-4o',
  'openai-o4-mini': 'openai/o4-mini',
  'gpt-4.1-mini': 'openai/gpt-4-1-mini',
  'gpt-4.1-nano': 'openai/gpt-4-1-nano',
  'gpt-5.3': 'openai/gpt-5.3-chat',
  'gpt-5.4': 'openai/gpt-5.4',
  'gpt-5.5': 'openai/gpt-5.5',
};

function resolveModel(modelLabel = '') {
  const normalized = String(modelLabel || '').trim();
  if (!normalized) return GPT_MODEL_MAP['gpt-5.3'];
  if (GPT_MODEL_MAP[normalized]) return GPT_MODEL_MAP[normalized];
  return normalized;
}

function normalizeHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item && typeof item === 'object' && (item.text || item.role))
    .slice(-12)
    .map((item) => ({
      id: '',
      role: item.role === 'assistant' ? 'assistant' : 'user',
      parts: [{
        type: 'text',
        text: String(item.text || '').trim().slice(0, 1200),
      }],
    }));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      prompt = '',
      history = [],
      model = 'gpt-5.3',
      isDeepResearchMode = false,
      isWebSearchMode = false,
      isImageGenerationMode = false,
      isAgenticMode = false,
    } = req.body || {};

    const safePrompt = String(prompt || '').trim().slice(0, 4000);
    if (!safePrompt) {
      return res.status(400).json({ error: 'Prompt wajib diisi.' });
    }

    const resolvedModel = resolveModel(model);
    const messages = [
      ...normalizeHistory(history),
      {
        id: '',
        role: 'user',
        parts: [{ type: 'text', text: safePrompt }],
      },
    ];

    const apiResponse = await fetch('https://fgsi.dpdns.org/api/ai/chatgpt', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        apikey: process.env.FGSI_API_KEY || 'You Apikey',
        model: resolvedModel,
        messages,
        isDeepResearchMode: Boolean(isDeepResearchMode),
        isWebSearchMode: Boolean(isWebSearchMode),
        isImageGenerationMode: Boolean(isImageGenerationMode),
        isAgenticMode: Boolean(isAgenticMode),
      }),
    });

    const raw = await apiResponse.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!apiResponse.ok) {
      return res.status(apiResponse.status).json({
        error: data?.message || data?.error || `GPT API error ${apiResponse.status}`,
      });
    }

    if (Array.isArray(data?.data?.images) && data.data.images.length > 0) {
      return res.status(200).json({
        reply: data?.data?.text || 'Gambar berhasil dibuat.',
        imageUrl: data.data.images[0]?.url || null,
        model: resolvedModel,
      });
    }

    const reply = String(data?.data?.text || '').trim();
    return res.status(200).json({
      reply: reply || 'Balasan model kosong. Silakan ulangi pertanyaan dengan lebih spesifik.',
      model: resolvedModel,
    });
  } catch (error) {
    console.error('gpt handler error', error);
    return res.status(500).json({
      error: error.message || 'Internal Server Error',
    });
  }
}
