# Explore Lab

[![Deployed on Vercel](https://img.shields.io/badge/Vercel-Deployed-000?logo=vercel)](https://dipsik-ai-tes-project.vercel.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#lisensi)

> Hub AI tanpa login yang dibangun di atas HTML statis + Vercel Serverless.
> Dua produk dalam satu repo:
>
> - **ExploreAi Chat** (`/ai.html`) — chat multi-model dengan auto-routing,
>   memori percakapan, file upload, code block, dan web search.
> - **ExploreAi Studio** (`/studio.html`) — image generation & edit dengan
>   beberapa model (Pollinations Flux/Turbo, Deep Image, Nanobanana edit).
>
> Landing page (`/index.html`) tetap berjudul **Explore Lab** dan jadi pintu
> masuk ke kedua produk.

Live: <https://dipsik-ai-tes-project.vercel.app/>

## Pengembang

- **R_hmt ofc** (handle), Indonesia — self-taught web app developer.
- Profil & social: lihat [`about.html`](./about.html).
- GitHub: [@rhteaster-ui](https://github.com/rhteaster-ui)
- Konten: WhatsApp Channel, Instagram, dan TikTok (tertaut di halaman Tentang).

## Stack

| Layer       | Teknologi                                                      |
| ----------- | -------------------------------------------------------------- |
| Frontend    | HTML5, Tailwind CSS (CDN), Lucide Icons, Vanilla JS (ES2020+)  |
| Backend     | Node.js Serverless Functions (Vercel runtime default)          |
| AI Provider | Google Gemini (official + universal), Daunscode, Pollinations.ai, Deep Image, Perplexity/TurboSeek |
| Hosting     | Vercel (free tier)                                             |
| Storage     | Browser localStorage (no DB)                                   |

## Fitur Utama

- **Auto-routing pintar** — sistem otomatis pilih endpoint yang tepat (chat,
  code, search, image-gen, image-edit) berdasarkan prompt + lampiran.
- **Memori percakapan** — riwayat dikirim ke model setiap turn agar konteks
  tidak hilang.
- **Thinking Mode** — analisis mendalam memakai `gemini-2.5-pro`.
- **ExploreAi Studio** — 4 model image (Pollinations Flux/Turbo, Deep Image,
  Nanobanana edit) dengan gallery sesi.
- **Web Search** — TurboSeek/Perplexity Sonar lengkap dengan kutipan sumber.
- **Rate-Limit + Cooldown** — proxy anti-spam: 60 req/menit chat, 30 req/menit
  studio, plus jeda 2 menit setelah 3 generasi gambar berturut-turut.
- **Security headers** — HSTS, X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy, Permissions-Policy (lihat `vercel.json`).
- **SEO siap** — `robots.txt`, `sitemap.xml`, JSON-LD `WebSite`, `Person`,
  `SoftwareApplication` di tiap halaman.

## Struktur

```text
index.html          # Landing page "Explore Lab"
ai.html             # ExploreAi Chat
studio.html         # ExploreAi Studio
about.html          # Halaman Tentang (JSON-LD Person)
api/
  backend.js        # Gateway universal (Chat)
  studio.js         # Endpoint Studio (image gen + edit)
  chat.js           # Gemini + fallback
  perplexity.js     # Web search
  imagegen.js       # Pollinations + Nanobanana edit (legacy entry)
  about.js          # IDENTITY (single source of truth)
  utils/
    rate-limit.js   # sliding-window + image cooldown
    proxy.js        # stub agent rotator
Studio/
  explore-deep-imagen.mjs   # modul image-gen baru (deep-image.ai)
  ...                       # CLI demos
public/
  favicon.png       # brand icon
  og-image.png      # OG image
robots.txt
sitemap.xml
vercel.json
CATATAN_PROYEK.md   # catatan internal
DAUNS_API_DOCS.md   # spec endpoint
Devin.md            # standar pengembangan
```

## Lokal

Repo ini full statis: tidak perlu build step.

```bash
git clone https://github.com/rhteaster-ui/Dipsik-ai-tes-project.git
cd Dipsik-ai-tes-project
# pakai vercel dev untuk emulasi serverless lokal:
npx vercel dev
```

Untuk preview cepat tanpa serverless, buka `index.html` langsung di browser
(endpoint `/api/*` akan offline tapi UI tetap berjalan).

## Deploy

Push ke GitHub → Vercel auto-deploy. Build command: kosongkan, Vercel akan
menyajikan file statis + setiap `api/*.js` sebagai serverless function.

## Versi & Roadmap

- **v3.0 (current, 2026)** — Chat + Studio split, modul deep-image, SEO,
  security headers.
- **v2.0** — Stabilisasi engine, memory, auto-routing, image cooldown.
- **v4 (planned)** — eksplorasi opsi migrasi framework jika beban produksi
  menuntut SSR + caching layer.

## Lisensi

MIT — silakan dipakai, di-fork, atau dijadikan referensi. Tetap apresiasi
kalau credit `R_hmt ofc` dipertahankan.
