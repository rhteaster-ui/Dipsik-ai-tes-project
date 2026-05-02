const { getRandomAgent } = require('./utils/proxy');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method harus POST' });

  try {
    const { path, method, body } = req.body;
    if (!path) return res.status(400).json({ error: 'Parameter "path" wajib' });

    const BASE_URL = 'https://daunsloveelaina.daunscode.com';
    const targetUrl = `${BASE_URL}${path}`;
    const agent = getRandomAgent();

    const fetchOptions = {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      agent: agent || undefined
    };

    if (fetchOptions.method !== 'GET' && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.json();

    if (!response.ok) return res.status(response.status).json(data);
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ error: 'Internal Server Error dari Proxy' });
  }
}
