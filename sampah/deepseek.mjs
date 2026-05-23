import crypto from "node:crypto";
import fs from "node:fs/promises";

const BASE = "https://deep-seek.ai";
const CHAT_PAGE = `${BASE}/chat`;
const API = `${BASE}/api/chat`;
const SESSION_FILE = "./deepseek-session.json";

const USER_PROMPT = "Apa itu Node.js?";
const SELECTED_MODEL = "v32";
const RESET_SESSION = false;

const MODELS = {
  chat31: "deepseek/deepseek-chat-v3.1",
  r1: "deepseek/deepseek-r1",
  v32: "deepseek/deepseek-v3.2"
};

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/g).map((v) => v.trim()).filter(Boolean);
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  return splitSetCookie(headers.get("set-cookie"));
}

function cookiePair(setCookie) {
  return setCookie.split(";")[0];
}

function parseCookieName(pair) {
  return pair.split("=")[0];
}

function mergeCookies(oldCookie = "", setCookies = []) {
  const map = new Map();

  for (const part of oldCookie.split(";").map((v) => v.trim()).filter(Boolean)) {
    map.set(parseCookieName(part), part);
  }

  for (const item of setCookies) {
    const pair = cookiePair(item);
    if (pair.includes("=")) map.set(parseCookieName(pair), pair);
  }

  return [...map.values()].join("; ");
}

function getCookie(cookie, name) {
  const found = cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`));

  if (!found) return "";
  return found.slice(name.length + 1);
}

function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function findCsrf(html) {
  const patterns = [
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i,
    /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i,
    /csrf_token["']?\s*[:=]\s*["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return "";
}

async function loadSession() {
  if (RESET_SESSION) {
    return {
      sessionId: crypto.randomUUID(),
      cookie: "",
      csrfToken: "",
      messages: []
    };
  }

  try {
    const raw = await fs.readFile(SESSION_FILE, "utf8");
    const json = JSON.parse(raw);

    return {
      sessionId: json.sessionId || crypto.randomUUID(),
      cookie: json.cookie || "",
      csrfToken: json.csrfToken || "",
      messages: Array.isArray(json.messages) ? json.messages : []
    };
  } catch {
    return {
      sessionId: crypto.randomUUID(),
      cookie: "",
      csrfToken: "",
      messages: []
    };
  }
}

async function saveSession(session) {
  await fs.writeFile(SESSION_FILE, JSON.stringify(session, null, 2), "utf8");
}

async function refreshSession(session) {
  const response = await fetch(CHAT_PAGE, {
    method: "GET",
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      cookie: session.cookie,
      referer: BASE
    }
  });

  const html = await response.text();
  const setCookies = getSetCookies(response.headers);

  session.cookie = mergeCookies(session.cookie, setCookies);

  const csrfFromHtml = findCsrf(html);
  const xsrfCookie = decodeCookieValue(getCookie(session.cookie, "XSRF-TOKEN"));

  session.csrfToken = csrfFromHtml || session.csrfToken || xsrfCookie;

  if (!session.cookie.includes("deepseek_session")) {
    throw new Error("Session cookie deepseek_session tidak ditemukan. Kemungkinan halaman butuh reload, diblokir, atau ada proteksi tambahan.");
  }

  if (!session.csrfToken) {
    throw new Error("CSRF token tidak ditemukan dari halaman atau cookie.");
  }

  return session;
}

async function readStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let answer = "";
  let raw = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    raw += chunk;
    buffer += chunk;

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();

      if (!data || data === "[DONE]") continue;

      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content;

        if (typeof content === "string") {
          answer += content;
        }
      } catch {}
    }
  }

  return { answer, raw };
}

async function ask() {
  const model = MODELS[SELECTED_MODEL] || SELECTED_MODEL;

  const session = await refreshSession(await loadSession());

  const userMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: USER_PROMPT
  };

  const messages = [
    ...session.messages.map(({ role, content }) => ({ role, content })),
    {
      role: "user",
      content: USER_PROMPT
    }
  ];

  const body = {
    model,
    messages
  };

  const headers = {
    "sec-ch-ua-platform": `"Android"`,
    "x-csrf-token": session.csrfToken,
    "user-agent": UA,
    "sec-ch-ua": `"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"`,
    "content-type": "application/json",
    "sec-ch-ua-mobile": "?1",
    accept: "*/*",
    origin: BASE,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    referer: CHAT_PAGE,
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    cookie: session.cookie
  };

  await fs.writeFile(
    "last-request-deepseek.json",
    JSON.stringify({ url: API, method: "POST", headers, body }, null, 2),
    "utf8"
  );

  const response = await fetch(API, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const setCookies = getSetCookies(response.headers);
  session.cookie = mergeCookies(session.cookie, setCookies);

  if (!response.ok) {
    const text = await response.text();

    await saveSession(session);
    await fs.writeFile("last-response-deepseek.txt", text, "utf8");

    return {
      Status: false,
      Code: response.status,
      Question: USER_PROMPT,
      Answer: ""
    };
  }

  const { answer, raw } = await readStream(response);

  session.messages.push(userMessage);
  session.messages.push({
    id: crypto.randomUUID(),
    role: "assistant",
    content: answer
  });

  await saveSession(session);
  await fs.writeFile("last-response-deepseek.txt", raw, "utf8");

  return {
    Status: Boolean(answer),
    Code: response.status,
    Question: USER_PROMPT,
    Answer: answer
  };
}

ask()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.log(
      JSON.stringify(
        {
          Status: false,
          Code: 500,
          Question: USER_PROMPT,
          Answer: "",
          Error: error.message
        },
        null,
        2
      )
    );
  });