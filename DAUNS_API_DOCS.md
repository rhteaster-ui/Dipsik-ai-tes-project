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
- **Fungsi:** Model yang mendukung input teks dan URL gambar.
- **Body Payload Asli:**
  ```json
  {
    "prompt": "make him wear glasses",
    "image_url": "https://url-gambar-lu.com/gambar.png"
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
- **Fungsi:** Membuat gambar dari teks dengan dukungan aspek rasio.
- **Body Payload Asli:**
  ```json
  {
    "prompt": "girl, witch hat, night sky, anime key visual",
    "ratio": "16:9"
  }
  ```
