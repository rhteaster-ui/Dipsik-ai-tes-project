import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const API = "https://aga-api.aichatting.net/aigc/chat/v2/professional/stream";
const SESSION_FILE = "./aichatting-session.json";

const USER_PROMPT = "Siapa nama mobil tersebut";
const IMAGE_PATH = "";
const IMAGE_URL = "https://akcdn.detik.net.id/community/media/visual/2021/07/08/lamborghini-aventador-lp-780-4-ultimae-3.jpeg?w=600&q=90";

const MODEL = "gpt-4o-mini";
const FORCE_NEW_SESSION = true;

const PUBLIC_KEY_BASE64 =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCAdf/EyIbLBxjGqmh7qLU6/CPCzru+75+82OSPZ+nf4BFvg88drpZ6KigNW0J8TNgxe6Yms1irCZNVDyu+RXsl4y/7c2KOHc4OGTzHB5fUMiMasFUvcEs2P70e6yA/sKHZfBLG1XPhlb84Ibs3nhD3W5e2SuC+4EuVkaqzN08LQIDAQAB";

const ua =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

function makePublicKey() {
  const wrapped = PUBLIC_KEY_BASE64.match(/.{1,64}/g).join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`;
}

function encryptVisitorId(visitorId) {
  const encrypted = crypto.publicEncrypt(
    {
      key: makePublicKey(),
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(visitorId)
  );

  return encrypted.toString("base64");
}

function makeVisitorId() {
  return crypto.randomBytes(16).toString("hex");
}

function makeConversationId() {
  return crypto.randomInt(10000000, 99999999);
}

function getMimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";

  throw new Error("Format gambar tidak didukung. Gunakan JPG/JPEG/PNG saja.");
}

function getMimeTypeFromUrl(imageUrl, contentType = "") {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();

  if (type === "image/jpeg" || type === "image/png") return type;

  const cleanUrl = imageUrl.split("?")[0].toLowerCase();

  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "image/jpeg";
  if (cleanUrl.endsWith(".png")) return "image/png";

  throw new Error("Format gambar URL tidak didukung. Gunakan JPG/JPEG/PNG saja.");
}

async function fileToDataUrl(filePath) {
  const mime = getMimeTypeFromPath(filePath);
  const buffer = await fs.readFile(filePath);

  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function urlToDataUrl(imageUrl) {
  const response = await fetch(imageUrl, {
    headers: {
      "user-agent": ua,
      accept: "image/jpeg,image/png,*/*;q=0.8",
      referer: "https://www.google.com/",
    },
  });

  if (!response.ok) {
    throw new Error(`Gagal download image URL: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const mime = getMimeTypeFromUrl(imageUrl, contentType);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function getImageDataUrl() {
  if (IMAGE_PATH) return await fileToDataUrl(IMAGE_PATH);
  if (IMAGE_URL) return await urlToDataUrl(IMAGE_URL);

  return "";
}

function createNewSession() {
  const visitorId = makeVisitorId();

  return {
    visitorId,
    vtoken: encryptVisitorId(visitorId),
    conversationId: makeConversationId(),
    messages: [],
  };
}

async function loadSession() {
  if (FORCE_NEW_SESSION) {
    return createNewSession();
  }

  try {
    const raw = await fs.readFile(SESSION_FILE, "utf8");
    const session = JSON.parse(raw);

    if (!session.visitorId) session.visitorId = makeVisitorId();
    if (!session.vtoken) session.vtoken = encryptVisitorId(session.visitorId);
    if (!session.conversationId) session.conversationId = makeConversationId();
    if (!Array.isArray(session.messages)) session.messages = [];

    return session;
  } catch {
    return createNewSession();
  }
}

async function saveSession(session) {
  if (FORCE_NEW_SESSION) return;
  await fs.writeFile(SESSION_FILE, JSON.stringify(session, null, 2), "utf8");
}

function createUserContent(prompt, imageDataUrl = "") {
  const content = [
    {
      type: "text",
      text: prompt,
    },
  ];

  if (imageDataUrl) {
    content.push({
      type: "image_url",
      image_url: {
        url: imageDataUrl,
      },
    });
  }

  return content;
}

function trimMessages(messages, max = 12) {
  return messages.slice(-max);
}

function cleanAnswer(text) {
  return String(text || "")
    .replace(/-=-\s*--/g, " ")
    .replace(/--@DONE@--/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function ask() {
  const session = await loadSession();
  const imageDataUrl = await getImageDataUrl();

  const userMessage = {
    role: "user",
    content: createUserContent(USER_PROMPT, imageDataUrl),
  };

  const body = {
    spaceHandle: true,
    roleId: 0,
    messages: [...trimMessages(session.messages), userMessage],
    conversationId: session.conversationId,
    model: MODEL,
  };

  const headers = {
    "sec-ch-ua-platform": `"Android"`,
    lang: "en",
    "sec-ch-ua": `"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"`,
    "sec-ch-ua-mobile": "?1",
    vtoken: session.vtoken,
    source: "web",
    "user-agent": ua,
    accept: "text/event-stream,application/json, text/event-stream",
    "content-type": "application/json",
    origin: "https://www.aichatting.net",
    referer: "https://www.aichatting.net/",
    "sec-fetch-site": "same-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    priority: "u=1, i",
  };

  const response = await fetch(API, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");

    return {
      status: false,
      code: response.status,
      question: USER_PROMPT,
      answer: "",
      error: text,
    };
  }

  if (!response.body) {
    return {
      status: false,
      code: response.status,
      question: USER_PROMPT,
      answer: "",
      error: "Response body kosong",
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let answer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line.startsWith("data:")) continue;

      const data = line.slice(5);

      if (!data.trim()) continue;
      if (data.includes("--@DONE@--")) continue;

      answer += data;
    }
  }

  answer = cleanAnswer(answer);

  if (answer) {
    session.messages.push(userMessage);
    session.messages.push({
      role: "assistant",
      content: [
        {
          type: "text",
          text: answer,
        },
      ],
    });

    session.messages = trimMessages(session.messages, 20);

    await saveSession(session);
  }

  return {
    status: Boolean(answer),
    code: response.status,
    question: USER_PROMPT,
    answer,
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
          status: false,
          code: 500,
          question: USER_PROMPT,
          answer: "",
          error: error.message,
        },
        null,
        2
      )
    );

    process.exit(1);
  });