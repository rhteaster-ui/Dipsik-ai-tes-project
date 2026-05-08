---
name: testing-explore-lab
description: End-to-end test the Explore Lab Vercel deployment (landing page CTAs, ai.html layout, theme/history persistence, auto-routing, doc upload, rate-limit headers, model picker, defensive limits). Use whenever a PR touches index.html, ai.html, /api/backend, /api/chat, /api/imagegen, /api/perplexity, or /api/utils/rate-limit.
---

# Testing Explore Lab

Explore Lab is a static frontend (`index.html`, `ai.html`) + Vercel-serverless backend gateway (`api/backend.js`) that fans out to `/api/chat` (Gemini), `/api/perplexity` (web search), and `/api/imagegen` (Pollinations + nanobanana). The frontend always talks to `/api/backend` only.

## When this skill applies

- PRs that change `ai.html`, `index.html`, the api routes under `/api`, or `/api/utils/rate-limit.js`.
- Anything that claims to fix the "sunken-input" layout bug, the auto-routing logic, or the rate-limiter.

## Devin Secrets Needed

- `VERCEL_BYPASS_TOKEN` — the **Protection Bypass for Automation** token from Vercel project settings → Deployment Protection. Required for any preview-environment testing because the preview URL is gated by Vercel SSO. Without it the browser hits a 401 auth-wall HTML. The user usually provides this once per session as a temporary secret.

## Step 0 — Bypass Vercel deployment protection

The preview URL returns HTTP 401 for unauthenticated requests. Two options that both work:

1. **One-shot bypass URL** (sets a `_vercel_jwt` cookie): navigate to
   ```
   {PREVIEW_URL}/?x-vercel-protection-bypass={TOKEN}&x-vercel-set-bypass-cookie=true
   ```
   Then the cookie persists for ~1h on subsequent requests in the same browser/Playwright context.
2. **Header on every fetch**: set `x-vercel-protection-bypass: {TOKEN}` and/or include the `_vercel_jwt` cookie.

**IMPORTANT:** internal lambda-to-lambda fetches (e.g. `/api/backend` calling `/api/chat` via `buildSelfUrl`) are ALSO blocked by Vercel SSO on previews. `api/backend.js` mitigates this with `buildInternalHeaders(req)` which forwards the inbound `cookie`, `x-vercel-protection-bypass`, and `authorization` headers onto the internal `fetch`. If you see HTML auth-wall content in JSON responses from `/api/backend`, this forwarding is the first thing to check.

## Step 1 — Attach Playwright over CDP

Devin's Chrome exposes CDP at `http://localhost:29229`. This is the most reliable way to drive the page AND capture `/api/backend` request bodies + response headers. Native browser_console may report "Chrome is not in foreground" — Playwright works regardless.

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp('http://localhost:29229')
    page = browser.contexts[0].pages[0]
    page.on('response', lambda r: capture_if(r, '/api/backend'))
    page.set_viewport_size({'width': 1280, 'height': 800})
    # ...
```

The page tab must already be on the preview URL (with bypass cookie set). For desktop tests use 1280×800; for mobile use 375×800.

## Step 2 — Test plan (8 suites)

Each suite has falsifiable concrete pass criteria. Don't accept screenshots alone; assert on DOM/localStorage/request-body content.

### T1 Landing page CTAs
- `<title>` = `Explore Lab | AI Tools Workspace`
- Footer text contains literal `2026`
- Card hrefs (read via `Array.from(document.querySelectorAll('section a'))`):
  - card 1 (Workspace Chat): `ai.html`
  - card 2 (Image Studio): `ai.html?mode=image`
  - card 3 (Web Search): `ai.html?mode=search`
- Click card 2 → URL `ai.html?mode=image`, `#modeBadge` = `Image Studio`, `localStorage.exploreLab.mode` = `image`
- Click card 3 → URL `ai.html?mode=search`, `#modeBadge` = `Web Search`, `localStorage.exploreLab.mode` = `search`

### T2 ai.html layout (the "sunken-input" regression test)
- Desktop 1280×800: `#sendBtn.getBoundingClientRect()` bottom must be ≥10px above viewport bottom; `document.documentElement.scrollWidth - clientWidth` should be `0` (no h-scroll)
- Mobile 375×800: sidebar hidden by default (`#sidebar.classList.contains('hidden')` true), `#sidebarToggle` visible, `scrollWidth - clientWidth` = 0
- Click `#sidebarToggle` on mobile → sidebar slides in as overlay; `#sidebarOverlay` visible

### T3 Theme + history persistence
- Click `#themeToggle` → `<html>` toggles `dark` class, body bg color changes (`rgb(3, 7, 18)` in dark), `localStorage.exploreLab.theme` updates
- Hard reload → theme persists
- Send chats → reload → `localStorage.exploreLab.history` keeps messages, chatBox hydrates them. **Important:** the rendered messages do NOT have `data-role` attributes. Use `document.querySelector('#chatBox').children` and check classes `flex justify-end` (user) vs `flex justify-start` (assistant) instead.

### T4 Auto-routing
Use `page.on('response', ...)` to capture `/api/backend` request bodies. The body shape is `{path, method, body: {prompt, sessionId, history, ...}}`. Send these prompts in mode=auto (no attachment):
- `Sebut tiga warna pelangi dalam satu baris.` → request body `path` should be `/v1/auto`, response should contain real chat text
- `buatkan gambar kucing astronot di bulan` → `path` = `/v1/image-generate`, response has `imageUrl` matching `https://image.pollinations.ai/...`, rendered `<img>.naturalWidth > 0`
- `berita teknologi AI hari ini terbaru` → `path` = `/v1/perplexity`, response has substantive news content

### T5 Document upload embedded in prompt
- Create `note.txt` with content `RAHASIA: kode pintu adalah 4827.`
- Use `page.set_input_files('#hiddenFileInput', '/path/to/note.txt')` (NOT `#hiddenImageInput`)
- Wait ~1.5s (handler is async — calls `readFileAsText` then `showAttachmentPreview`)
- `#attachmentName` should show `note.txt`, `#attachmentMeta` says `Teks akan disisipkan ke konteks prompt`
- Send a prompt asking about the document
- Captured `/api/backend` request body MUST contain BOTH `RAHASIA` and `4827`
- Assistant reply should mention `4827`

### T6 Rate-limit headers
Every `/api/backend` 200 response must carry headers:
- `x-ratelimit-limit: 60`
- `x-ratelimit-remaining: <int>` decrementing monotonically across calls in the same container

Do NOT try to trigger 429 — Vercel containers reset in-memory state between cold starts.

### T7 Model picker
- Click `#modelPickerBtn` → modal `#modelPickerBackdrop.classList.contains('visible')` true
- Modal has chips with `data-pick` like `gemini:gemini-2.5-pro`, `perplexity:sonar`, `dauns:chatgpt`, `image:flux`
- Pick `gemini-2.5-pro`: modal closes, `#activeModelLabel.textContent` = `gemini-2.5-pro`, `localStorage.exploreLab.model` = `gemini-2.5-pro`
- **Hard reload** — the pill MUST also restore from localStorage. If the pill resets to `Auto Routing` while localStorage still has `gemini-2.5-pro`, that's a known regression — see commit `0b664f2` for the canonical fix in `init()`.

### T8 Defensive
- Empty prompt + click `#sendBtn` → 0 POSTs to `/api/backend` (assert via request listener count)
- Attach a 10MB image (`dd if=/dev/urandom of=big.png bs=1M count=10`) via `#hiddenImageInput` → `#attachmentPreview` stays hidden, `#toast` shows `Gambar terlalu besar (max 5MB).`

## Known upstream limitations (don't gate on these)

- **Daunscode (`/v1/dauns` chatgpt/notegpt/grok/deepai/nanobanana-edit)** returns HTTP 403 from both Vercel egress and this VM — upstream IP block, not a gateway bug. Auto-routing falls back to Gemini/Pollinations/Perplexity which all work.
- **In-memory rate-limit (T6)**: per-Vercel-container only; not global. Headers are the falsifiable contract.

## Common gotchas

- The chat-box messages are NOT tagged with `data-role`. Use class selectors `flex.justify-end` (user) and `flex.justify-start` (assistant) when asserting on chatBox state.
- The Gemini official key may be unset on preview; backend has a universal fallback to `https://api.covenant.sbs/api/ai/gemini` so chat always works.
- After clicking a model in the picker, the change might not survive reload unless `init()` rehydrates `state.modelLabel` from `state.model`. Always hard-reload to verify.
- `state.history` (current session messages) and `state.historyList` (sidebar session labels) are separate localStorage keys.
- For chat reload tests, prefer Playwright's `page.reload(wait_until='domcontentloaded')` and then wait ~1.5s for hydration to complete.

## Reporting

- Capture all `/api/backend` request bodies and response headers via Playwright network listener; save to JSON for the report.
- Take screenshots at: T2 mobile, T3 chat-after-reload, T4.2 image-rendered, T5 doc-reply, T7 modal+pill, T8 oversize-toast.
- Annotate the recording with `setup` / `test_start` / `assertion` events. Use `It should …` style for `test_start`.
- Post ONE PR comment summarizing results with collapsed `<details>` per suite. Include link to the Devin session.
