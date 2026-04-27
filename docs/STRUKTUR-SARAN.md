# Saran Rapihkan Struktur Folder

Supaya repo lebih enak dibaca, kamu bisa pisahkan area **frontend**, **backend API**, dan **referensi/eksperimen**.

## Struktur yang disarankan

```txt
/
├── app/
│   ├── frontend/
│   │   ├── index.html
│   │   ├── ai.html
│   │   ├── assets/
│   │   └── scripts/
│   └── api/
│       ├── chat.js
│       ├── gpt.js
│       ├── perplexity.js
│       ├── deepseek.js
│       └── models/
│           ├── list.js
│           └── list-model.js
├── integrations/
│   └── deepseek-client/        # pindahan dari deepseek-example
├── references/
│   └── legacy/                 # pindahan dari folder Sampah
├── docs/
│   ├── CATATAN_PROYEK.md
│   └── STRUKTUR-SARAN.md
├── package.json
└── vercel.json
```

## Kenapa lebih nyaman

- Folder `app/frontend` fokus UI.
- Folder `app/api` fokus endpoint backend.
- Folder `integrations` untuk SDK/client pihak ketiga (mis. DeepSeek reverse client).
- Folder `references/legacy` untuk file eksperimen/sampah agar tidak mengganggu source utama.
- Folder `docs` untuk catatan proyek, changelog, dan panduan.

## Tahap migrasi aman (bertahap)

1. Pindah file referensi dulu (`Sampah` -> `references/legacy`).
2. Pindah `deepseek-example` ke `integrations/deepseek-client` dan update import path di API.
3. Pindah file frontend ke `app/frontend` lalu sesuaikan config deploy.
4. Pindah `api/` ke `app/api` jika pipeline deploy sudah siap.

> Kalau deploy masih mengandalkan default `api/` Vercel, langkah 4 bisa ditunda.
