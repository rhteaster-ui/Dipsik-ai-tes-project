/* Developer / Site identity database — single source of truth.
 *
 * Dipakai oleh:
 *   - GET /api/about              -> JSON identitas (dipakai about.html, landing, sidebar)
 *   - POST /api/backend /v1/about -> identitas via gateway
 *   - api/backend.js              -> auto-inject ringkasan ke system prompt chat
 *
 * Datanya dikuratori dari sampah/data data portofolio.txt. Kalau user mau
 * update profil, ubah objek `IDENTITY` di file ini saja — front-end &
 * backend langsung membaca otomatis.
 */

const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';

export const IDENTITY = {
  site: {
    name: 'Explore Lab',
    tagline: 'Workspace AI all-in-one — chat multi-model, image studio, web search, dengan auto-routing pintar.',
    description: 'Explore Lab adalah workspace AI tanpa login & tanpa biaya. Dirancang ringan untuk perangkat low-end, bekerja di balik proxy backend agar tidak butuh API key di sisi pengguna, dan mendukung dokumen teks + gambar dalam satu interface.',
    version: 'v2.0',
    year: '2026',
    favicon: 'https://l.top4top.io/p_3774ypjwm0.png',
    banner: 'https://e.top4top.io/p_37695nh3v0.png',
    repo: 'https://github.com/rhteaster-ui/Dipsik-ai-tes-project',
    features: [
      { name: 'Smart Auto-Routing', desc: 'Sistem deteksi niat: chat, kode/script, web search, generate gambar, edit gambar — diarahkan ke endpoint yang tepat.' },
      { name: 'Memory Konteks', desc: 'Riwayat percakapan ikut dikirim ke model setiap turn supaya AI ingat konteks sebelumnya.' },
      { name: 'Thinking Mode', desc: 'Mode analisis mendalam memakai gemini-2.5-pro dengan system prompt reasoning.' },
      { name: 'Image Studio', desc: 'Generate gambar via Pollinations.ai (Flux/Turbo) dan edit gambar via Nanobanana.' },
      { name: 'Web Search', desc: 'Pencarian real-time via TurboSeek/Perplexity dengan kutipan sumber.' },
      { name: 'File Upload', desc: 'Lampirkan dokumen teks (txt, md, html, json, csv, log, dll) atau gambar; sistem akan ringkas atau analisa.' },
      { name: 'Per-Message Actions', desc: 'Salin, edit, dan generate ulang setiap pesan — bisa pilih model untuk regenerate.' },
      { name: 'Rate Limit + Cooldown', desc: 'Proxy anti-spam: 60 req/menit per IP, plus jeda 2 menit setelah 3 generasi gambar berturut.' },
    ],
  },
  developer: {
    handle: 'R_hmt ofc',
    realName: 'Rhmt',
    role: 'Self-taught Web App Developer',
    profileImage: 'https://j.top4top.io/p_376952pby0.png',
    location: 'Indonesia',
    bio: 'Pengembang web mandiri (otodidak) yang fokus membangun web app, PWA, dan website statis interaktif yang ringan, fungsional, dan stabil — terutama untuk perangkat low-end. Mengembangkan, debug, refactor, dan deploy semuanya full device only, dengan AI sebagai productivity tool, bukan sekadar generator kode.',
    longBio: 'Memulai perjalanan teknologi secara otodidak tanpa mentor langsung dan dengan keterbatasan perangkat. Fokus utama bukan sekadar membuat website terlihat keren, tapi memastikan web benar-benar berguna, mudah dipahami, dan stabil dipakai pengguna umum. Telah menyelesaikan 50+ proyek web (statis & web app), mengembangkan PWA, dan terbiasa bekerja dengan codebase kompleks ribuan baris.',
    workStyle: [
      'Fokus pada fungsi & stabilitas',
      'Mengutamakan kesederhanaan yang efektif',
      'Iteratif: membangun, menguji, memperbaiki',
      'Adaptif terhadap keterbatasan perangkat',
    ],
    techStack: [
      { name: 'HTML5', icon: 'file-code-2', color: 'text-orange-500' },
      { name: 'CSS3', icon: 'palette', color: 'text-blue-500' },
      { name: 'JavaScript', icon: 'braces', color: 'text-yellow-500' },
      { name: 'TypeScript', icon: 'code', color: 'text-blue-600' },
      { name: 'Vue.js', icon: 'component', color: 'text-emerald-500' },
      { name: 'React', icon: 'atom', color: 'text-cyan-400' },
      { name: 'Tailwind CSS', icon: 'wind', color: 'text-cyan-500' },
      { name: 'FastAPI', icon: 'zap', color: 'text-teal-500' },
      { name: 'Node.js', icon: 'server', color: 'text-emerald-600' },
      { name: 'Vercel', icon: 'triangle', color: 'text-slate-700 dark:text-white' },
      { name: 'PWA', icon: 'smartphone', color: 'text-blue-400' },
      { name: 'Upstash Redis', icon: 'database', color: 'text-red-500' },
    ],
    socials: [
      { label: 'WhatsApp Channel', icon: 'message-circle', url: 'https://whatsapp.com/channel/0029VbBjyjlJ93wa6hwSWa0p', handle: 'RhmT | Code & AI' },
      { label: 'Instagram', icon: 'instagram', url: 'https://www.instagram.com/rahmt_nhw?igsh=MWQwcnB3bTA2ZnVidg==', handle: '@rahmt_nhw' },
      { label: 'TikTok', icon: 'video', url: 'https://www.tiktok.com/@r_hmtofc?_r=1&_t=ZS-94KRfWQjeUu', handle: '@r_hmtofc' },
      { label: 'GitHub', icon: 'github', url: 'https://github.com/rahmat-369', handle: '@rahmat-369' },
      { label: 'Telegram', icon: 'send', url: 'https://t.me/rAi_engine', handle: 't.me/rAi_engine' },
    ],
  },
  roadmap: [
    { milestone: 'Stabilisasi v2', status: 'in-progress', desc: 'Smart memory, auto-routing tepat, file preview, code block, per-message actions, identity DB, image cooldown.' },
    { milestone: 'Sistem Login', status: 'planned', desc: 'Akun pengguna agar rate-limit tidak bertumpu pada 1 IP saja, plus sinkronisasi histori antar device.' },
    { milestone: 'Admin Log Page', status: 'planned', desc: 'Dashboard kontrol pemakaian, monitor request, dan pengaturan model default.' },
    { milestone: 'Migrasi Framework', status: 'planned', desc: 'Upgrade backend ke FastAPI dan frontend ke Next.js untuk skala produksi.' },
  ],
};

/** Ringkasan teks pendek untuk di-inject ke system prompt chat. */
export function buildIdentitySummaryText() {
  const dev = IDENTITY.developer;
  const site = IDENTITY.site;
  const socialList = dev.socials.map((s) => `- ${s.label}: ${s.url}`).join('\n');
  return [
    `Tentang aplikasi ini: "${site.name}" — ${site.tagline}`,
    site.description,
    '',
    `Pengembang: ${dev.handle} (${dev.role}, ${dev.location}).`,
    dev.bio,
    '',
    'Saluran resmi pengembang:',
    socialList,
    '',
    'Jika user bertanya "siapa kamu/developer/yang bikin", "apa nama webnya", "sosmed/saluran/kontak developer", "tech stack", "kapan dibuat", atau pertanyaan tentang identitas — jawab langsung memakai info di atas, jangan bilang tidak tahu. Jangan tampilkan emoji sebagai ikon, gunakan teks biasa.',
  ].join('\n');
}

/** Kata kunci yang mengindikasikan user bertanya tentang identitas. */
const IDENTITY_KEYWORDS = [
  'siapa kamu', 'siapa anda', 'siapa yg', 'siapa yang', 'siapa developer', 'siapa pembuat',
  'kamu siapa', 'anda siapa', 'who are you', 'who made', 'who built',
  'nama web', 'nama aplikasi', 'nama site', 'nama situs', 'tentang web', 'tentang aplikasi',
  'sosmed', 'sosial media', 'social media', 'saluran', 'channel', 'kontak developer',
  'whatsapp dev', 'instagram dev', 'tiktok dev', 'github dev', 'telegram dev',
  'tech stack', 'teknologi yg', 'teknologi yang dipakai', 'pakai apa untuk',
  'explore lab itu', 'apa itu explore lab', 'punya siapa', 'milik siapa',
  'bagaimana web', 'bagaimana aplikasi', 'how was this',
];

export function isIdentityQuery(prompt = '') {
  const text = String(prompt || '').toLowerCase();
  if (!text) return false;
  return IDENTITY_KEYWORDS.some((kw) => text.includes(kw));
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  return res.status(200).json(IDENTITY);
}
