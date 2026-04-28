const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function stripHtml(raw = '') {
  const input = String(raw || '');
  const paragraphMatches = input.match(/<p>(.*?)<\/p>/gis);

  if (paragraphMatches?.length) {
    return paragraphMatches
      .map((chunk) =>
        chunk
          .replace(/<\/?p>/gi, '')
          .replace(/<\/?strong>/gi, '')
          .replace(/<\/?em>/gi, '')
          .replace(/<\/?b>/gi, '')
          .replace(/<\/?i>/gi, '')
          .replace(/<\/?u>/gi, '')
          .replace(/<\/?[^>]+(>|$)/g, '')
          .trim(),
      )
      .filter(Boolean)
      .join('\n\n');
  }

  return input.replace(/<\/?[^>]+(>|$)/g, '').trim();
}

async function requestTurboseek(path, payload) {
  const response = await fetch(`https://www.turboseek.io/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: 'https://www.turboseek.io',
      referer: 'https://www.turboseek.io/',
      'user-agent': 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36',
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    if (!response.ok) {
      throw new Error(`TurboSeek ${path} gagal (HTTP ${response.status})`);
    }

    return raw;
  }

  if (!response.ok) {
    const message = data?.error || data?.message || `TurboSeek ${path} gagal (HTTP ${response.status})`;
    throw new Error(message);
  }

  return data;
}

async function runPerplexityWeb(question) {
  const safeQuestion = String(question || '').trim();
  if (!safeQuestion) throw new Error('Question is required.');

  const sources = await requestTurboseek('/getSources', { question: safeQuestion });
  const similarQuestions = await requestTurboseek('/getSimilarQuestions', {
    question: safeQuestion,
    sources,
  });
  const answer = await requestTurboseek('/getAnswer', {
    question: safeQuestion,
    sources,
  });

  const cleanAnswer = stripHtml(answer);
  const sourceLinks = Array.isArray(sources)
    ? sources.map((item) => item?.url).filter(Boolean)
    : [];

  return {
    reply: cleanAnswer,
    answer: cleanAnswer,
    sources: sourceLinks,
    similarQuestions,
    model: 'perplexity-web',
  };
}

function normalizeHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item && typeof item === 'object' && item.text)
    .slice(-12)
    .map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.text || '').trim(),
    }))
    .filter((item) => item.content);
}

function resolvePerplexityMode(model = '') {
  const value = String(model || '').trim().toLowerCase();
  if (['chat-manual', 'manual-chat', 'perplexity-chat'].includes(value)) return 'chat-manual';
  return 'turboseek';
}

async function runPerplexityChat({ question, history = [], model = '', system = '' }) {
  const safeQuestion = String(question || '').trim();
  if (!safeQuestion) throw new Error('Question is required.');

  const apiKey = String(process.env.PERPLEXITY_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY belum di-set. Mode chat manual membutuhkan API key Perplexity.');
  }

  const chatModel = String(model || '').trim() || 'sonar';
  const conversation = normalizeHistory(history);
  const defaultSystem = 'Kamu asisten AI yang membantu user dalam bahasa Indonesia dengan jawaban jelas dan natural.';

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: chatModel,
      messages: [
        {
          role: 'system',
          content: String(system || process.env.PERPLEXITY_SYSTEM_PROMPT || defaultSystem).trim(),
        },
        ...conversation,
        { role: 'user', content: safeQuestion },
      ],
      stream: false,
    }),
  });

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    if (!response.ok) {
      throw new Error(raw?.trim() || `Perplexity chat gagal (HTTP ${response.status})`);
    }
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || `Perplexity chat gagal (HTTP ${response.status})`);
  }

  const reply = String(data?.choices?.[0]?.message?.content || '').trim();
  const citations = Array.isArray(data?.citations)
    ? data.citations.filter((item) => typeof item === 'string' && item.trim())
    : [];

  return {
    reply: reply || 'Balasan model kosong. Coba ulangi pertanyaan.',
    answer: reply || 'Balasan model kosong. Coba ulangi pertanyaan.',
    sources: citations,
    model: chatModel,
    mode: 'chat-manual',
  };
}

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { question = '', prompt = '', model = '', history = [], system = '' } = req.body || {};
    const finalQuestion = String(question || prompt || '').trim();

    if (!finalQuestion) {
      return res.status(400).json({ error: 'Please provide a question' });
    }

    const mode = resolvePerplexityMode(model);
    const result = mode === 'chat-manual'
      ? await runPerplexityChat({ question: finalQuestion, history, model: 'sonar', system })
      : await runPerplexityWeb(finalQuestion);

    return res.status(200).json(result);
  } catch (error) {
    console.error('perplexity handler error', error);
    return res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
}
