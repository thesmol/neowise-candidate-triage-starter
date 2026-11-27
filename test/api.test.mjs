import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";

const silent = { warn() {}, error() {} };
let server;
let baseUrl;

async function start(options) {
  const app = createApp({ log: silent, ...options });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  return { app, url: `http://127.0.0.1:${app.address().port}` };
}

async function post(body, url = baseUrl) {
  const response = await fetch(`${url}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  ({ app: server, url: baseUrl } = await start());
});

after(() => server.close());

test("корректная заявка возвращает тему и черновик", async () => {
  const delivery = await post({ text: "Когда будет доставка заказа?" });
  assert.equal(delivery.status, 200);
  assert.equal(delivery.body.status, "ready");
  assert.equal(delivery.body.topic, "delivery");
  assert.ok(delivery.body.draft.trim().length > 0);

  const pricing = await post({ text: "Какая цена на услугу?" });
  assert.equal(pricing.body.topic, "pricing");
});

for (const [name, body] of [
  ["пустая строка", { text: "" }],
  ["только пробелы", { text: "   \n" }],
  ["нет поля text", {}],
  ["text не строка", { text: 42 }],
  ["text равен null", { text: null }],
  ["тело null", "null"],
  ["тело массив", "[]"],
  ["битый JSON", "{text:"],
  ["пустое тело", ""],
]) {
  test(`некорректный ввод: ${name} -> 400 invalid_input`, async () => {
    const result = await post(body);
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { status: "invalid_input" });
  });
}

const MANUAL = { status: "manual_review", topic: null, draft: null };

for (const tag of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`сбой модели ${tag} -> 200 manual_review`, async () => {
    const started = Date.now();
    const result = await post({ text: `Вопрос по доставке ${tag}` });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, MANUAL);
    // Имитатор при [timeout] отвечает через 1200 мс, ждать его нельзя.
    assert.ok(Date.now() - started < 1000, "ответ не должен ждать медленную модель");
  });
}

test("таймаут срабатывает, даже если модель не реагирует на отмену", async () => {
  const { app, url } = await start({ classify: () => new Promise(() => {}), timeoutMs: 50 });
  try {
    const result = await post({ text: "Где мой заказ?" }, url);
    assert.deepEqual(result.body, MANUAL);
  } finally {
    app.close();
  }
});

test("лишние поля из ответа модели не попадают в ответ API", async () => {
  const classify = async () =>
    JSON.stringify({ topic: "other", draft: " Ответ ", status: "hacked", extra: 1 });
  const { app, url } = await start({ classify });
  try {
    const result = await post({ text: "Привет" }, url);
    assert.deepEqual(result.body, { status: "ready", topic: "other", draft: "Ответ" });
  } finally {
    app.close();
  }
});
