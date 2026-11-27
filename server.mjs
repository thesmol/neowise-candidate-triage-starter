import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify as mockClassify } from "./mock-ai.mjs";

const TOPICS = new Set(["delivery", "pricing", "other"]);
const MODEL_TIMEOUT_MS = 300;
const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

const assets = {
  "/": { file: "./index.html", type: "text/html; charset=utf-8" },
  "/ui.mjs": { file: "./ui.mjs", type: "text/javascript; charset=utf-8" },
};

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// Текст заявки или null, если ввод не подходит.
export function parseInput(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const text = body?.text;
  if (typeof text !== "string" || text.trim() === "") return null;
  return text;
}

// Ответ модели проверяется до того, как его увидит менеджер.
// Возвращает { topic, draft } или null, если ответ использовать нельзя.
export function parseModelOutput(raw) {
  if (typeof raw !== "string") return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!TOPICS.has(data?.topic)) return null;
  if (typeof data.draft !== "string" || data.draft.trim() === "") return null;
  return { topic: data.topic, draft: data.draft.trim() };
}

// Ждёт модель не дольше timeoutMs. Таймер завершает ожидание сам,
// даже если модель не реагирует на signal.
async function callModel(classify, text, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`model timeout ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([classify(text, { signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createApp({ classify = mockClassify, timeoutMs = MODEL_TIMEOUT_MS, log = console } = {}) {
  async function handleTriage(request, response) {
    const text = parseInput(await readBody(request));
    if (text === null) return json(response, 400, { status: "invalid_input" });

    let raw;
    try {
      raw = await callModel(classify, text, timeoutMs);
    } catch (error) {
      log.warn(`triage: manual_review, model failed: ${error.message}`);
      return json(response, 200, MANUAL_REVIEW);
    }

    const result = parseModelOutput(raw);
    if (!result) {
      log.warn("triage: manual_review, unusable model output");
      return json(response, 200, MANUAL_REVIEW);
    }
    return json(response, 200, { status: "ready", ...result });
  }

  return createServer(async (request, response) => {
    try {
      const asset = request.method === "GET" && assets[request.url];
      if (asset) {
        const body = await readFile(new URL(asset.file, import.meta.url));
        response.writeHead(200, { "Content-Type": asset.type });
        response.end(body);
        return;
      }
      if (request.method !== "POST" || request.url !== "/api/triage") {
        return json(response, 404, { status: "not_found" });
      }
      await handleTriage(request, response);
    } catch (error) {
      log.error(`server error: ${error.message}`);
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, "127.0.0.1", () => {
    console.log(`Открыть: http://127.0.0.1:${port}`);
  });
}
