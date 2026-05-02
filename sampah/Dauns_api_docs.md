```markdown
# MASTER PROMPT & PROJECT RESTRUCTURING (EXPLORE LAB)

**Konteks Proyek:**
Proyek ini adalah "Explore Lab", sebuah workspace AI. Frontend menggunakan HTML/Tailwind/JS murni, dan backend menggunakan Vercel Serverless Functions di folder `/api/`. Saat ini, kita perlu merapikan repository, mengatur Universal Proxy API, menyempurnakan logika frontend, dan mengatur routing Vercel berdasarkan file yang sudah ada di proyek.

Tolong eksekusi instruksi di bawah ini secara berurutan:

## 1. PEMBARUAN LOGO & FAVICON PADA HTML
- Baca file `index.html` dan `ai.html` yang sudah ada di root proyek.
- Ubah semua ikon/logo website di kedua file tersebut menggunakan URL: `https://l.top4top.io/p_3774ypjwm0.png`
- Tambahkan atau ubah tag ini di dalam `<head>` pada kedua file tersebut:
  `<link rel="icon" href="https://l.top4top.io/p_3774ypjwm0.png" type="image/png">`

## 2. SETUP HALAMAN FRONTEND (index.html)
- Baca file referensi `text 1.html` (atau file sumber lain yang memuat UI Landing Page Explore Lab).
- **Ganti seluruh isi** file `index.html` saat ini dengan kode dari `text 1.html`.
- Pastikan di file `index.html` yang baru, tombol CTA (seperti "Akses Lab" atau "Mulai Eksplorasi") mengarah ke `ai.html`.

## 3. PEMBERSIHAN BACKEND (CLEANUP `/api`)
- Masuk ke direktori `api/`.
- **HAPUS** file-file model berikut karena akan diganti dengan universal proxy:
  - `claude.js`
  - `deepseek.js`
  - `gemini.js`
  - `gpt.js`
  - `list-model.js`
  - `list.js`
- **PERTAHANKAN** file `api/chat.js` (menggunakan API key resmi) dan `api/perplexity.js`. Jangan hapus atau ubah logika inti di dalamnya.

## 4. SETUP VERCEL CONFIG (`vercel.json`)
Perbarui file `vercel.json` yang ada di root folder agar sesuai dengan konfigurasi CORS dan routing API yang benar:
```json
{
  "version": 2,
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Credentials", "value": "true" },
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,OPTIONS,PATCH,DELETE,POST,PUT" },
        { "key": "Access-Control-Allow-Headers", "value": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" }
      ]
    }
  ]
}
```

## 5. PEMBUATAN UNIVERSAL BACKEND PROXY
Buat dua file baru di dalam folder `api/` untuk menangani endpoint dari `daunsloveelaina.daunscode.com` (seperti `/v1/ai/chatgpt`, `/v1/ai/nanobanana`, dll).

**A. Buat file `api/utils/proxy.js`:**
```javascript
const { HttpsProxyAgent } = require('https-proxy-agent');

// Array kosong untuk diisi IP proxy rotasi
const proxyList = [];

function getRandomAgent() {
    if (proxyList.length === 0) return null;
    return new HttpsProxyAgent(proxyList[Math.floor(Math.random() * proxyList.length)]);
}
module.exports = { getRandomAgent };
```

**B. Buat file `api/backend.js`:**
```javascript
const { getRandomAgent } = require('./utils/proxy');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method harus POST' });
    
    try {
        const { path, method, body } = req.body;
        if (!path) return res.status(400).json({ error: 'Parameter "path" wajib' });

        const BASE_URL = '[https://daunsloveelaina.daunscode.com](https://daunsloveelaina.daunscode.com)';
        const targetUrl = `${BASE_URL}${path}`;
        const agent = getRandomAgent();

        const fetchOptions = {
            method: method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            agent: agent ? agent : undefined
        };

        if (fetchOptions.method !== 'GET' && body) {
            fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(targetUrl, fetchOptions);
        const data = await response.json();

        if (!response.ok) return res.status(response.status).json(data);
        return res.status(200).json(data);

    } catch (error) {
        console.error("Proxy Error:", error);
        return res.status(500).json({ error: 'Internal Server Error dari Proxy' });
    }
}
```

## 6. LOGIKA FRONTEND (`ai.html`)
Di dalam file `ai.html`, buat atau perbarui fungsi Javascript untuk menangani fetch ke `/api/backend`. Logika fetch harus menyesuaikan struktur parameter Daunscode.

Pastikan fetch di frontend berbentuk seperti ini:
```javascript
// Contoh fungsi untuk trigger API dari frontend
async function fetchDaunscodeAPI(selectedPath, userInputText, optionalImageUrl = null, optionalRatio = null) {
    
    // Susun isi body sesuai kebutuhan endpoint Daunscode
    let requestBody = { prompt: userInputText };
    
    // Tambahkan image_url jika endpoint (seperti nanobanana) membutuhkannya
    if (optionalImageUrl) requestBody.image_url = optionalImageUrl;
    
    // Tambahkan ratio jika endpoint generate image membutuhkannya
    if (optionalRatio) requestBody.ratio = optionalRatio;

    try {
        const res = await fetch('/api/backend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: selectedPath, // contoh: "/v1/ai/nanobanana"
                method: "POST",
                body: requestBody
            })
        });
        
        const data = await res.json();
        return data;
    } catch (error) {
        console.error("Error fetching proxy:", error);
    }
}
```

**AKHIR DARI INSTRUKSI.** Eksekusi perubahan, penghapusan, dan pembuatan file secara keseluruhan.
```

## 8. PEMBUATAN FILE DOKUMENTASI API (`DAUNS_API_DOCS.md`)
Buat file baru bernama `DAUNS_API_DOCS.md` di root directory. Isi file tersebut dengan referensi lengkap endpoint Daunscode yang didukung oleh sistem proxy kita. Gunakan teks berikut sebagai isi filenya:

```markdown
# Dokumentasi Explore Lab API (Proxy Daunscode)

Dokumentasi ini berisi daftar endpoint Daunscode REST API yang didukung dan cara mengaksesnya melalui Universal Proxy kita (`/api/backend`).

## CARA MENGAKSES PROXY (FRONTEND TO BACKEND)
Semua request dari frontend harus diarahkan ke `/api/backend` dengan method `POST`.
**Format Payload Wajib:**
```json
{
  "path": "/v1/ai/nama_model",
  "method": "POST",
  "body": {
    "prompt": "Isi prompt disini",
    "parameter_lain": "value"
  }
}
```

---

## DAFTAR ENDPOINT DAUNSCODE TARGET

### 1. ChatGPT
- **Path Target:** `/v1/ai/chatgpt`
- **Fungsi:** Model chat AI standar untuk tanya jawab teks.
- **Body Payload Asli:** 
  ```json
  { "prompt": "Apa itu hologram? jawab singkat maksimal 2 kalimat." }
  ```

### 2. Nanobanana (Vision & Image Edit)
- **Path Target:** `/v1/ai/nanobanana`
- **Fungsi:** Model yang mendukung input teks dan URL gambar. Digunakan untuk memanipulasi gambar atau menganalisis gambar.
- **Body Payload Asli:**
  ```json
  {
    "prompt": "make him wear glasses",
    "image_url": "[https://url-gambar-lu.com/gambar.png](https://url-gambar-lu.com/gambar.png)"
  }
  ```

### 3. NoteGPT
- **Path Target:** `/v1/ai/notegpt`
- **Fungsi:** Mengirim prompt ke NoteGPT dan mengembalikan jawaban chat berbentuk teks.
- **Body Payload Asli:**
  ```json
  { "prompt": "halo notegpt" }
  ```

### 4. Grok
- **Path Target:** `/v1/ai/grok`
- **Fungsi:** Mengirim prompt ke API Toolbaz dengan gaya/style Grok AI.
- **Body Payload Asli:**
  ```json
  { "prompt": "Teks prompt lu disini" }
  ```

### 5. DeepAI
- **Path Target:** `/v1/ai/deepai`
- **Fungsi:** Interaksi chat berbasis DeepAI.
- **Body Payload Asli:**
  ```json
  { "prompt": "halo daunscode api" }
  ```

### 6. Image Generation (Anime Key Visual / Text-to-Image)
- **Fungsi:** Membuat gambar dari teks dengan dukungan aspek rasio. (Gunakan path model spesifik image generation Daunscode).
- **Body Payload Asli:**
  ```json
  {
    "prompt": "girl, witch hat, night sky, anime key visual",
    "ratio": "16:9"
  }
  ```
```

***

Nah, dengan tambahan ini, *repository* lu bakal punya satu file sakti `DAUNS_API_DOCS.md` yang isinya persis rangkuman dari 5 tangkapan layar lu tadi. Jadi kalau lu (atau Tenk) besok-besok mau nambahin fitur di *frontend*, tinggal buka file ini aja buat nyontek *payload*-nya. Gas, Bro! 
