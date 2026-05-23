import crypto from "node:crypto";

const API = "https://api.deep-image.ai";
const ORIGIN = "https://deep-image.ai";

const PROMPT = "Ferrari";
const WIDTH = 1024;
const HEIGHT = 1024;

const MAX_POLL = 40;
const POLL_DELAY_MS = 2000;

const ua =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeClientId() {
  return crypto.randomBytes(16).toString("hex");
}

function baseHeaders(clientId) {
  return {
    "user-agent": ua,
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "x-client-id": clientId,
    origin: ORIGIN,
    referer: `${ORIGIN}/`,
    "sec-ch-ua-platform": `"Android"`,
    "sec-ch-ua": `"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"`,
    "sec-ch-ua-mobile": "?1",
    "sec-fetch-site": "same-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    priority: "u=1, i"
  };
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.data = json;
    throw err;
  }

  return {
    status: res.status,
    json
  };
}

async function generateImage() {
  const clientId = makeClientId();

  const create = await requestJson(`${API}/api/public/free-image-generator/generate`, {
    method: "POST",
    headers: baseHeaders(clientId),
    body: JSON.stringify({
      prompt: PROMPT,
      width: WIDTH,
      height: HEIGHT
    })
  });

  const job = create.json?.job;
  if (!job) {
    return {
      Status: false,
      Code: create.status,
      Model: "google-gemini-image-flash-free",
      Prompt: PROMPT,
      "Result url": "",
      Error: "Job ID tidak ditemukan",
      Raw: create.json
    };
  }

  for (let i = 0; i < MAX_POLL; i++) {
    await sleep(POLL_DELAY_MS);

    const poll = await requestJson(`${API}/api/apps/deep_image/v2/jobs/${job}`, {
      method: "GET",
      headers: baseHeaders(clientId)
    });

    const data = poll.json;

    if (data?.is_failed) {
      return {
        Status: false,
        Code: poll.status,
        Model:
          data?.generation_metadata?.model ||
          data?.data?.background?.generate?.model_type ||
          "google-gemini-image-flash-free",
        Prompt: PROMPT,
        "Result url": "",
        Error: "Generation failed",
        Raw: data
      };
    }

    const resultUrl = data?.result?.result_url;
    if (resultUrl) {
      return {
        Status: true,
        Code: poll.status,
        Model:
          data?.generation_metadata?.model ||
          data?.data?.background?.generate?.model_type ||
          "google-gemini-image-flash-free",
        Prompt: PROMPT,
        "Result url": resultUrl
      };
    }
  }

  return {
    Status: false,
    Code: 408,
    Model: "google-gemini-image-flash-free",
    Prompt: PROMPT,
    "Result url": "",
    Error: "Timeout polling result"
  };
}

try {
  const result = await generateImage();
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.log(JSON.stringify({
    Status: false,
    Code: err.status || 500,
    Model: "google-gemini-image-flash-free",
    Prompt: PROMPT,
    "Result url": "",
    Error: err.data ? JSON.stringify(err.data) : err.message
  }, null, 2));
}