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

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { question = '', prompt = '' } = req.body || {};
    const finalQuestion = String(question || prompt || '').trim();

    if (!finalQuestion) {
      return res.status(400).json({ error: 'Please provide a question' });
    }

    const result = await runPerplexityWeb(finalQuestion);
    return res.status(200).json(result);
  } catch (error) {
    console.error('perplexity handler error', error);
    return res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
}
