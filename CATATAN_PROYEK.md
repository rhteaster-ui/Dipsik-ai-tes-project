# Catatan Proyek — Explore Lab

Ringkasan singkat agar developer/AI yang baru membuka repo ini langsung paham
arah, arsitektur, dan area kerja terakhir.

## Tujuan

- Web AI workspace tanpa login: chat multi-model, web search, image generation
  & editing, plus upload dokumen — semua via satu interface ringan.
- Frontend statis (HTML + Tailwind CDN) + serverless function di `api/*` ala Vercel.
- Tidak ada API key di browser; semua key disimpan via env vars di server.

## Arsitektur

```
Browser (ai.html)
   └── POST /api/backend  ← satu pintu masuk gateway
        ├── /v1/auto             auto-routing (default)
        ├── /v1/chat              → api/chat.js (Gemini official + fallback universal)
        ├── /v1/perplexity        → api/perplexity.js (TurboSeek/Sonar)
        ├── /v1/dauns             → Daunscode REST (chatgpt/notegpt/grok/deepai/nanobanana)
        ├── /v1/image-generate    → api/imagegen.js (Pollinations.ai)
        └── /v1/image-edit        → Daunscode nanobanana (image edit)
```

Setiap path POST melewati rate-limit per IP (`api/utils/rate-limit.js`,
sliding window, 60 req/menit, 20 req/menit khusus image-gen).

## File penting

```text
/
├── index.html                # landing page Explore Lab (tema dark/light)
├── ai.html                   # workspace chat (layout flex, responsif, no login)
├── api/
│   ├── backend.js            # gateway universal + auto-routing + rate-limit
│   ├── chat.js               # Gemini official + fallback universal/Daunscode
│   ├── perplexity.js         # web search (TurboSeek/Sonar)
│   ├── imagegen.js           # text-to-image (Pollinations.ai), key-less
│   └── utils/
│       └── rate-limit.js     # in-memory sliding-window rate limiter per IP
├── DAUNS_API_DOCS.md         # detail format payload & contoh per path
├── CATATAN_PROYEK.md         # file ini
└── vercel.json               # konfigurasi serverless
```

File `imgeditor (1).js` dan `keekvx6ha5i0000-aifacefy (1).js` di root adalah
referensi script Node CLI untuk image edit/face swap. Tidak dipakai langsung
di runtime serverless karena terlalu berat — fitur image-edit di web memakai
endpoint `/v1/image-edit` (Daunscode nanobanana).

## Auto-routing (heuristik)

Diimplementasikan sama di backend (`/v1/auto`) dan frontend (`detectIntent` di
`ai.html`):

1. Punya gambar + kata kerja edit → `/v1/image-edit`.
2. Tanpa gambar + kata kerja generate → `/v1/image-generate`.
3. Tanpa gambar + kata pencarian → `/v1/perplexity`.
4. Default → `/v1/chat` (Gemini → fallback Daunscode → Perplexity).

## Frontend ai.html

- Layout flex (bukan absolute) → input area tidak "tenggelam" lagi.
- Responsif (mobile / tablet / desktop), dark+light mode persistent.
- Sidebar history + mode (Auto / Web Search / Image Studio).
- Upload gambar (≤5MB) & dokumen teks (≤200KB: txt/md/html/json/csv/log/xml/css/js/yaml).
- Markdown rendering + code block highlight + streaming text.
- LocalStorage keys: `exploreLab.sessionId`, `.history`, `.historyList`, `.theme`,
  `.mode`, `.model`, `.ratio`.

## Keamanan & resilience

- Rate-limit per IP di gateway dan image-gen.
- Validasi panjang prompt (8000 char di gateway, 2000 di image-gen).
- Validasi MIME & ukuran file di frontend sebelum kirim.
- Cascade fallback chat: Gemini → Daunscode chatgpt → Perplexity.
- Provider label dikembalikan di response untuk transparansi/debug.
- Tidak ada secret/API key yang masuk repo; semua via env Vercel.

## Terakhir di-update

- **Tanggal (UTC): 2026-05-08**
- **Update:** Rebuild ai.html (fix layout sunken-input, responsif, branding
  Explore Lab); tambah `api/imagegen.js`; tambah `api/utils/rate-limit.js`;
  refactor `api/backend.js` (auto-routing, image-gen/edit path, fallback chain);
  `api/chat.js` resilient + provider label; landing page card descriptions &
  CTAs di-update; docs disinkronkan.

> Saran: setiap perubahan endpoint atau provider AI, update bagian ini dulu
> sebelum merge.
