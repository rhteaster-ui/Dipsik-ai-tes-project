import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import fs from "node:fs/promises";

const BASE = "https://deepdreamgenerator.com";
const GENERATE_PAGE = `${BASE}/generate`;
const GENERATE_API = `${BASE}/image-generator/generate`;
const DOWNLOAD_API = `${BASE}/image-generator/download`;

const PROMPT = "Galaxy";
const MODEL = "davinci";
const OUTPUT_FILE = "./deepdream-result.jpg";

const MODELS = {
  "z turbo": {
    id: "250",
    name: "Z-Image Turbo"
  },
  davinci: {
    id: "105",
    name: "DaVinci2"
  }
};

const SELECTED_MODEL = MODELS[MODEL.toLowerCase()] || MODELS["z turbo"];

const EFFECT_STRENGTH = "60";
const BASE_RESOLUTION = "20";
const DEEP_STYLE = "10";
const STYLE_ID = "3";
const ASPECT_RATIO = "10";

const MAX_POLL = 60;
const POLL_DELAY_MS = 3000;

const ua =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

const jar = new CookieJar();

const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
    timeout: 120000,
    headers: {
      "user-agent": ua,
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
    },
    validateStatus: () => true
  })
);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function output(status, code, model, prompt, result = "") {
  return {
    Status: status,
    Code: code,
    Model: model,
    Prompt: prompt,
    Result: result
  };
}

function decodeCookieValue(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function getCookie(name) {
  const cookies = await jar.getCookies(BASE);
  const found = cookies.find(c => c.key === name);
  return found?.value || "";
}

async function initSession() {
  const res = await client.get(GENERATE_PAGE, {
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "sec-ch-ua": `"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"`,
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": `"Android"`,
      "upgrade-insecure-requests": "1"
    }
  });

  const html = String(res.data || "");
  const $ = cheerio.load(html);

  const metaCsrf =
    $('meta[name="csrf-token"]').attr("content") ||
    $('input[name="_token"]').attr("value") ||
    "";

  const xsrfCookie = decodeCookieValue(await getCookie("XSRF-TOKEN"));

  return metaCsrf || xsrfCookie;
}

function parseGenerateResponse(json) {
  const html = json?.html || "";
  const $ = cheerio.load(html);
  const card = $(".latest-image").first();

  return {
    id: json?.id || card.attr("data-id") || "",
    pusherChannel: json?.pusherChannel || card.attr("data-pusher-channel") || "",
    anonymUserToken: card.attr("data-anonym-user-token") || "",
    model: card.attr("data-image-model") || SELECTED_MODEL.name,
    prompt: card.attr("data-raw-prompt") || PROMPT
  };
}

async function generateJob(csrf) {
  const body = new URLSearchParams({
    textPrompt: PROMPT,
    textPromptNegative: "",
    visualTextPrompt: "",
    effectStrength: EFFECT_STRENGTH,
    baseResolution: BASE_RESOLUTION,
    aiModel: SELECTED_MODEL.id,
    deepStyle: DEEP_STYLE,
    style_id: STYLE_ID,
    aspectRatio: ASPECT_RATIO
  });

  const res = await client.post(GENERATE_API, body.toString(), {
    headers: {
      "x-csrf-token": csrf,
      "x-requested-with": "XMLHttpRequest",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      accept: "application/json, text/javascript, */*; q=0.01",
      origin: BASE,
      referer: GENERATE_PAGE,
      "sec-ch-ua-platform": `"Android"`,
      "sec-ch-ua": `"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"`,
      "sec-ch-ua-mobile": "?1",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      priority: "u=1, i"
    }
  });

  if (res.status !== 200 || typeof res.data !== "object") {
    return {
      ok: false,
      code: res.status,
      error: typeof res.data === "string" ? res.data.slice(0, 500) : JSON.stringify(res.data)
    };
  }

  if (res.data?.error) {
    return {
      ok: false,
      code: res.status,
      error: res.data.error,
      raw: res.data
    };
  }

  return {
    ok: true,
    code: res.status,
    data: parseGenerateResponse(res.data),
    raw: res.data
  };
}

async function tryDownload(jobId, anonymUserToken) {
  const params = new URLSearchParams({
    job_id: String(jobId)
  });

  if (anonymUserToken) {
    params.set("ut", anonymUserToken);
  }

  const res = await client.get(`${DOWNLOAD_API}?${params.toString()}`, {
    responseType: "arraybuffer",
    headers: {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      referer: GENERATE_PAGE,
      "sec-ch-ua-platform": `"Android"`,
      "sec-ch-ua": `"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"`,
      "sec-ch-ua-mobile": "?1",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-dest": "image"
    }
  });

  const contentType = String(res.headers["content-type"] || "");

  if (res.status === 200 && contentType.includes("image/")) {
    await fs.writeFile(OUTPUT_FILE, Buffer.from(res.data));
    return {
      done: true,
      code: res.status,
      result: OUTPUT_FILE
    };
  }

  return {
    done: false,
    code: res.status,
    contentType
  };
}

async function pollDownload(jobId, anonymUserToken, modelName) {
  for (let i = 0; i < MAX_POLL; i++) {
    const res = await tryDownload(jobId, anonymUserToken);

    if (res.done) {
      return output(true, 200, modelName, PROMPT, res.result);
    }

    await sleep(POLL_DELAY_MS);
  }

  return output(false, 408, modelName, PROMPT, "");
}

async function main() {
  const csrf = await initSession();

  if (!csrf) {
    return {
      ...output(false, 500, SELECTED_MODEL.name, PROMPT, ""),
      Error: "CSRF token tidak ditemukan"
    };
  }

  const job = await generateJob(csrf);

  if (!job.ok) {
    return {
      ...output(false, job.code || 500, SELECTED_MODEL.name, PROMPT, ""),
      Error: job.error || "Generate failed"
    };
  }

  if (!job.data.id) {
    return {
      ...output(false, 500, SELECTED_MODEL.name, PROMPT, ""),
      Error: "Job ID tidak ditemukan"
    };
  }

  return await pollDownload(job.data.id, job.data.anonymUserToken, job.data.model);
}

main()
  .then(result => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch(err => {
    console.log(
      JSON.stringify(
        {
          ...output(false, 500, SELECTED_MODEL.name, PROMPT, ""),
          Error: err.message
        },
        null,
        2
      )
    );
  });