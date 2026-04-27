const UNIVERSAL_ENDPOINT = 'https://api.covenant.sbs/api/ai/gemini';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const response = await fetch(UNIVERSAL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }

    if (!response.ok) {
      const message = data?.error || data?.message || `Universal endpoint error ${response.status}`;
      return res.status(response.status).json({
        error: message,
        detail: data,
      });
    }

    return res.status(200).json(data || {});
  } catch (error) {
    return res.status(500).json({
      error: error?.message || 'Failed to call universal endpoint',
    });
  }
}
