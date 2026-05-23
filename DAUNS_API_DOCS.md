# Dokumentasi API Explore Lab

Ada **dua entry-point** dari frontend:

- **`POST /api/backend`** — dipakai oleh ExploreAi Chat (`ai.html`) untuk chat,
  web search, dan legacy image generation. Routing pakai field `path`.
- **`POST /api/studio`** — dipakai oleh ExploreAi Studio (`studio.html`) khusus
  image generation & edit dengan model yang dipilih user.

Tidak ada API key yang diekspos ke browser. Tiap endpoint melewati rate-limit
sliding-window per IP plus cooldown khusus untuk image generation.

## `POST /api/studio`

Body:

```json
{
  "prompt": "Astronot duduk di kafe Jakarta, gaya cinematic.",
  "model": "pollinations-flux",
  "ratio": "1:1",
  "mode": "generate",
  "image_url": "data:image/png;base64,..."
}
```

- `model` (opsional, default `pollinations-flux`): `pollinations-flux` |
  `pollinations-turbo` | `deep-image` | `nanobanana-edit`.
- `ratio` (opsional, default `1:1`): salah satu dari `1:1`, `16:9`, `9:16`,
  `4:3`, `3:4`, `21:9`, `4:5`.
- `mode` (opsional, otomatis `edit` kalau `image_url` ada).
- `image_url` (opsional): data URL (base64) untuk mode edit; max sekitar 5 MB.

Response:

```json
{
  "reply": "Sukses generate via pollinations-flux.",
  "imageUrl": "https://image.pollinations.ai/prompt/...",
  "provider": "pollinations",
  "model": "pollinations-flux",
  "mode": "generate",
  "prompt": "..."
}
```

Rate-limit khusus Studio: 30 req/menit per IP plus cooldown 3 burst → jeda 2
menit untuk mode `generate`. Response header bawaan `X-RateLimit-*` ikut dikirim.

---

## `POST /api/backend`

Frontend Chat (`ai.html`) bicara ke endpoint ini. Backend gateway menentukan
upstream sebenarnya berdasarkan field `path`. Tidak ada API key yang
diekspos ke browser.

## Format payload

```json
{
  "path": "/v1/auto",
  "method": "POST",
  "body": {
    "prompt": "Isi prompt di sini",
    "model": "gemini-2.5-flash",
    "image_url": "data:image/png;base64,...",
    "ratio": "16:9",
    "history": [{ "role": "user", "text": "..." }],
    "sessionId": "sess_xxx"
  }
}
```

Semua field selain `prompt` opsional. Untuk text-to-image cukup kirim `prompt`
(plus `ratio` jika ingin selain `1:1`). Untuk image-edit kirim `prompt` + `image_url`.

## Path yang didukung

| Path                  | Tujuan                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/backend`    | Daftar provider/model + default                                                          |
| `/v1/models`          | Idem (POST)                                                                              |
| `/v1/auto`            | Auto-routing pintar berdasarkan prompt + lampiran (rekomendasi default frontend)         |
| `/v1/chat`            | Gemini official (`api/chat.js`); fallback Daunscode chat jika Gemini gagal               |
| `/v1/perplexity`      | Web search via TurboSeek/Sonar (`api/perplexity.js`)                                     |
| `/v1/dauns`           | Daunscode AI proxy. Pilih `model: chatgpt|notegpt|grok|deepai|nanobanana`               |
| `/v1/image-generate`  | Text-to-image (Pollinations.ai, gratis, no-key)                                          |
| `/v1/image-edit`      | Image-to-image (Daunscode `/v1/ai/nanobanana`)                                           |
| `/v1/ai/{model}`      | Direct Daunscode (legacy alias). Setara `/v1/dauns` dengan `body.model = {model}`        |

## Keamanan & rate limit

- Setiap path POST melewati rate-limit per IP: 60 req/menit untuk gateway umum,
  20 req/menit khusus image generation.
- Header `X-RateLimit-Limit` dan `X-RateLimit-Remaining` selalu disertakan.
- Saat melebihi batas, response = HTTP 429 dengan `Retry-After` (detik).
- Validasi panjang prompt: max 8000 karakter di gateway, 2000 di image-gen.
- Validasi ukuran lampiran di frontend: gambar ≤ 5 MB, dokumen teks ≤ 200 KB.

## Contoh penggunaan

### 1) Chat auto-routing (paling umum)

```json
{
  "path": "/v1/auto",
  "method": "POST",
  "body": { "prompt": "Apa itu hologram? jawab singkat." }
}
```

### 2) Generate gambar dari teks

```json
{
  "path": "/v1/image-generate",
  "method": "POST",
  "body": { "prompt": "girl, witch hat, night sky, anime key visual", "ratio": "16:9" }
}
```

Response:

```json
{
  "reply": "Gambar dibuat dari prompt: \"...\".",
  "imageUrl": "https://image.pollinations.ai/prompt/...",
  "provider": "pollinations"
}
```

### 3) Edit gambar dengan instruksi

```json
{
  "path": "/v1/image-edit",
  "method": "POST",
  "body": {
    "prompt": "make him wear glasses",
    "image_url": "https://example.com/foto.png"
  }
}
```

### 4) Web search

```json
{
  "path": "/v1/perplexity",
  "method": "POST",
  "body": { "prompt": "berita AI generatif minggu ini" }
}
```

### 5) Pilih model Daunscode tertentu

```json
{
  "path": "/v1/dauns",
  "method": "POST",
  "body": { "prompt": "halo grok", "model": "grok" }
}
```

## Auto-routing (`/v1/auto`)

Heuristik di gateway memilih jalur berdasarkan isi prompt + apakah ada
lampiran gambar:

1. Punya gambar + kata kerja edit (`edit/ubah/ganti/tambahkan/...`) → `image-edit`.
2. Tidak punya gambar + kata kerja generate (`buat/generate/bikin/render/...`) → `image-generate`.
3. Tidak punya gambar + kata kunci pencarian (`cari/search/berita/terbaru/harga/news/...`) → `perplexity`.
4. Default → Gemini → Daunscode chain → Perplexity (cascade fallback).

Frontend juga bisa memaksa mode lewat sidebar (Auto / Web Search / Image Studio)
atau memilih model spesifik via tombol "Auto Routing" di header.
