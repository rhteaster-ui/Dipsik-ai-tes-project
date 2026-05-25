/**
 * 4x tex-to-image
 * ---------------------
 * Creator : rhmt
 * Base    : https://raphael.app/
 * Desc    : Generate gambar AI dari prompt dengan model Raphael
 * note :
 * simple bgt jir, tinggal kirim prompt terus jadi wkwkwk mana bisa 4 lagi wkwk
 */

const BASE_URL = 'https://raphael.app'
const API_URL = `${BASE_URL}/api/generate-image`

const randomId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const parseBool = (v, d = false) => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    if (v.toLowerCase() === 'true') return true
    if (v.toLowerCase() === 'false') return false
  }
  return d
}

const parseNumber = (v, d) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

async function raphael(prompt, options = {}) {
  try {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return {
        status: false,
        code: 400,
        creator: 'rhmt',
        error: 'Prompt kosong'
      }
    }

    const body = {
      prompt: prompt.trim(),
      negativePrompt: options.negativePrompt ?? '',
      aspect: options.aspect ?? '1:1',
      isSafeContent: options.isSafeContent ?? true,
      autoTranslate: options.autoTranslate ?? true,
      model_id: options.model_id ?? 'raphael-basic',
      number_of_images: parseNumber(options.number_of_images, 4),
      highQuality: parseBool(options.highQuality, false),
      fastMode: parseBool(options.fastMode, false),
      turnstileToken: options.turnstileToken ?? null,
      client_request_id: options.client_request_id ?? randomId()
    }

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'content-type': 'application/json',
        'origin': BASE_URL,
        'referer': `${BASE_URL}/id`,
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36'
      },
      body: JSON.stringify(body)
    })

    const rawText = await res.text()

    if (!res.ok) {
      return {
        status: false,
        code: res.status,
        creator: 'rhmt',
        input: prompt,
        error: 'Request gagal',
        raw: rawText
      }
    }

    const lines = rawText
      .split('\n')
      .map(v => v.trim())
      .filter(v => v.startsWith('{') && v.endsWith('}'))

    const parsed = []
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line))
      } catch {}
    }

    const results = parsed.map((item, index) => ({
      no: index + 1,
      url: item.url?.startsWith('http') ? item.url : `${BASE_URL}${item.url ?? ''}`,
      seed: item.seed ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      isHighQuality: item.isHighQuality ?? false
    })).filter(v => v.url)

    return {
      status: true,
      code: 200,
      creator: 'rhmt',
      prompt: body.prompt,
      negativePrompt: body.negativePrompt,
      model: body.model_id,
      aspect: body.aspect,
      total: results.length,
      results,
      raw: parsed
    }
  } catch (e) {
    return {
      status: false,
      code: 500,
      creator: 'rhmt',
      error: e.message || 'Terjadi kesalahan'
    }
  }
}

export default raphael

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const prompt = process.argv.slice(2).join(' ')
  const result = await raphael(prompt || 'A futuristic cityscape with holographic advertisements')
  console.log(JSON.stringify(result, null, 2))
}