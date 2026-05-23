# Catatan Proyek — Explore Lab

Ringkasan singkat agar developer/AI yang baru membuka repo ini langsung paham
arah, arsitektur, dan area kerja terakhir.

## Tujuan

- Web AI hub tanpa login dengan dua produk:
  - **ExploreAi Chat** (`/ai.html`) — chat multi-model + auto-routing + memori +
    file upload + code block + web search.
  - **ExploreAi Studio** (`/studio.html`) — image generation & edit dengan model
    Pollinations (Flux/Turbo), Deep Image, dan Nanobanana edit.
- Landing page (`/index.html`) tetap bernama **Explore Lab**.
- Frontend statis (HTML + Tailwind CDN) + serverless function di `api/*` ala Vercel.
- Tidak ada API key di browser; semua key disimpan via env vars di server.

## Arsitektur

```
Browser ai.html (Chat) → POST /api/backend
   └── /v1/auto              auto-routing (default)
   └── /v1/chat              → api/chat.js (Gemini official + fallback universal)
   └── /v1/perplexity        → api/perplexity.js (TurboSeek/Sonar)
   └── /v1/dauns             → Daunscode REST (chatgpt/notegpt/grok/deepai/nanobanana)
   └── /v1/image-generate    → api/imagegen.js (Pollinations.ai)
   └── /v1/image-edit        → Daunscode nanobanana (image edit)

Browser studio.html (Studio) → POST /api/studio
   └── model = pollinations-flux  → Pollinations Flux
   └── model = pollinations-turbo → Pollinations Turbo
   └── model = deep-image         → Studio/explore-deep-imagen.mjs
   └── model = nanobanana-edit    → Daunscode nanobanana (edit)
```

Setiap path POST melewati rate-limit per IP (`api/utils/rate-limit.js`,
sliding window, 60 req/menit, 20 req/menit khusus image-gen).

## File penting

```text
/
├── index.html                     # landing page "Explore Lab" (dark/light)
├── ai.html                        # ExploreAi Chat (workspace chat)
├── studio.html                    # ExploreAi Studio (image gen/edit)
├── about.html                     # halaman Tentang (JSON-LD Person)
├── robots.txt                     # allow + sitemap pointer
├── sitemap.xml                    # 4 halaman
├── public/
│   ├── favicon.png                # brand icon (kubus biru)
│   └── og-image.png               # Open Graph image
├── api/
│   ├── backend.js                 # gateway universal + auto-routing + rate-limit
│   ├── chat.js                    # Gemini + fallback + memory (server-side)
│   ├── perplexity.js              # web search
│   ├── imagegen.js                # image gen + edit (legacy entry untuk Chat)
│   ├── studio.js                  # endpoint khusus Studio (pollinations/deep-image/nanobanana)
│   ├── about.js                   # IDENTITY (single source of truth)
│   └── utils/
│       ├── rate-limit.js          # sliding-window rate limit + image cooldown
│       └── proxy.js               # stub proxy agent (rotasi list manual)
├── Studio/
│   ├── explore-deep-imagen.mjs    # MODUL ESM, model image-gen baru (deep-image)
│   ├── nanobanana.mjs             # referensi CLI (tidak dipakai runtime)
│   ├── deepdream.mjs              # referensi CLI
│   ├── gpt-4o-mini.mjs            # referensi CLI
│   └── deep-image-txt2img.mjs     # CLI demo original (jangan import langsung)
├── sampah/                        # ditahan: deepseek.mjs, dll — dihiraukan, jangan import
├── vercel.json                    # headers + security + cache rules
├── DAUNS_API_DOCS.md              # detail format payload & contoh per path
├── CATATAN_PROYEK.md              # file ini
└── Devin.md                       # standar pengembangan untuk asisten AI
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

## Frontend ai.html (ExploreAi Chat)

- Layout flex (bukan absolute) → input area tidak "tenggelam".
- Responsif (mobile / tablet / desktop), dark+light mode persistent.
- Sidebar history + mode (Auto / Web Search / Thinking) — mode "image" sudah
  dipindah ke halaman Studio (link cepat di sidebar dan header).
- Upload gambar (≤5MB) & dokumen teks (≤200KB: txt/md/html/json/csv/log/xml/css/js/yaml).
- Markdown rendering + code block highlight + streaming text + per-message actions.
- LocalStorage keys: `exploreLab.sessionId`, `.history`, `.historyList`, `.theme`,
  `.mode`, `.model`, `.ratio`, `.settings`.

## Frontend studio.html (ExploreAi Studio)

- Halaman terpisah dengan aksen ungu/amber agar terasa berbeda namun tetap nyambung
  dengan brand utama.
- Endpoint `POST /api/studio` (alih-alih /api/backend) — mendukung model
  `pollinations-flux`, `pollinations-turbo`, `deep-image`, `nanobanana-edit`.
- Rate-limit 30 req/menit per IP + cooldown image-gen sama dengan /api/imagegen.
- LocalStorage keys: `exploreStudio.gallery`, `exploreStudio.settings`,
  `exploreStudio.motion` (toggle motion penuh / dikurangi).
- Drag-drop / file picker untuk mode edit, dengan validasi MIME + 5MB max.

## Keamanan & resilience

- Rate-limit per IP di gateway dan image-gen.
- Validasi panjang prompt (8000 char di gateway, 2000 di image-gen).
- Validasi MIME & ukuran file di frontend sebelum kirim.
- Cascade fallback chat: Gemini → Daunscode chatgpt → Perplexity.
- Provider label dikembalikan di response untuk transparansi/debug.
- Tidak ada secret/API key yang masuk repo; semua via env Vercel.

## Terakhir di-update

- **Tanggal (UTC): 2026-05-23**
- **Release: v3.0 (Chat + Studio split)**
- **Update:**
  - Pisah halaman jadi `ai.html` (ExploreAi Chat) dan `studio.html` (ExploreAi Studio).
  - Endpoint baru `api/studio.js` + modul ESM `Studio/explore-deep-imagen.mjs`
    (model image-gen baru via deep-image.ai, fallback ke Pollinations).
  - Branding lokal: `public/favicon.png` & `public/og-image.png` menggantikan
    aset top4top.io. JSON-LD `WebSite`, `Person`, dan `SoftwareApplication`
    ditambahkan supaya Google bisa kenali pemilik & produk.
  - SEO: `robots.txt`, `sitemap.xml`, meta OG/Twitter di semua halaman.
  - Security headers di `vercel.json` (HSTS, X-Content-Type-Options, X-Frame-Options,
    Referrer-Policy, Permissions-Policy).
  - Halaman `about.html` & `api/about.js` di-update dengan deskripsi dua produk,
    feature baru, dan roadmap v3.

> Saran: setiap perubahan endpoint atau provider AI, update bagian ini dulu
> sebelum merge.
