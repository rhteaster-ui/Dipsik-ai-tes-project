# Catatan

Dokumen ini dibuat sebagai ringkasan cepat agar AI atau developer yang baru membaca repository ini langsung paham: ini web apa, tujuannya apa, komponen utamanya apa, dan perubahan terakhir ada di mana.

## Tujuan

- Menyediakan **web AI workspace** berbasis antarmuka chat dengan tampilan modern (halaman utama + halaman chat).
- Menjadi **jembatan (proxy API)** antara frontend dan beberapa sumber model AI tanpa menaruh kredensial sensitif di frontend.
- Mendukung use case chat multimodal (teks + gambar) melalui endpoint backend yang ada.

## Fungsi

- **Frontend chat** di `index.html` / `ai.html` untuk interaksi pengguna, histori chat, pengaturan, dan pemilihan model.
- **Endpoint Gemini** (`api/chat.js`) untuk request chat berbasis model Gemini (dengan dukungan input gambar via data URL).
- **Endpoint GPT relay** (`api/gpt.js`) sebagai relay ke layanan streaming eksternal berbasis GPT dengan rate limit sederhana.
- **Endpoint DeepSeek** (`api/deepseek.js`) untuk login, pembuatan session, multi-turn chat, serta upload gambar/file lewat klien DeepSeek.
- **Endpoint listing model** (`api/list.js`, `api/list-model.js`) untuk mengambil daftar model dari Google Generative Language API.

## Struktur

Struktur utama repository:

```text
/
├── index.html                # UI utama workspace/chat
├── ai.html                   # alternatif halaman chat (layout sejenis)
├── api/
│   ├── chat.js               # handler chat Gemini (POST)
│   ├── gpt.js                # handler relay GPT stream (POST)
│   ├── deepseek.js           # handler DeepSeek + session + upload file (POST)
│   ├── list.js               # daftar model Gemini
│   └── list-model.js         # varian endpoint daftar model
├── deepseek-example/
│   ├── deepseek.js           # client DeepSeek reverse-engineered
│   ├── tes.js                # contoh penggunaan client
│   ├── sha3_wasm.wasm        # komponen PoW yang dibutuhkan client
│   └── README.md             # dokumentasi client DeepSeek
├── package.json
└── vercel.json
```

## Terakhir di-update

- **Tanggal (UTC): 2026-04-25**
- **Update terakhir:** Perbaikan endpoint `api/gpt.js` agar memaksimalkan relay GPT tanpa API key (via NoteGPT stream), mendukung context `history`, dukungan `images`, retry, validasi input, rate limit, serta perbaikan kompatibilitas header request untuk menghindari error 406.

> Saran penggunaan: setiap kali ada perubahan arsitektur, endpoint baru, atau pergantian model/provider AI, update bagian ini terlebih dahulu sebelum merge.
