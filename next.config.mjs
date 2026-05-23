/**
 * Next.js config untuk Explore Lab.
 *
 * Strategi migrasi (v3.1):
 *  - File HTML statis disimpan di `/public/` supaya tetap diakses lewat
 *    URL aslinya (`/index.html`, `/ai.html`, `/studio.html`, `/about.html`).
 *  - URL bersih (`/`, `/ai`, `/studio`, `/about`) di-rewrite ke file HTML
 *    yang sesuai supaya tidak 404, tanpa mengubah konten halaman.
 *  - API route Vercel klasik (`api/*.js` dengan signature `(req, res)`)
 *    diadopsi langsung lewat `pages/api/*.js` — signature kompatibel jadi
 *    perubahan kode minimal.
 *  - Header keamanan tetap dideklarasikan di `vercel.json` sehingga
 *    diaplikasikan di edge layer Vercel (sebelum framework).
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Static HTML pages live under /public/ — rewrite clean URLs to the
  // corresponding .html file so they never 404.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/index.html' },
        { source: '/ai', destination: '/ai.html' },
        { source: '/studio', destination: '/studio.html' },
        { source: '/about', destination: '/about.html' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  // Jangan emit folder ekstra di build output yang tidak perlu.
  experimental: {
    // No experimental flags needed for current setup.
  },
};

export default nextConfig;
