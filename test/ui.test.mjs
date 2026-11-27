import { test } from "node:test";
import assert from "node:assert/strict";
import { createTriage, render, MESSAGES } from "../ui.mjs";

function fakeView() {
  const node = () => ({ textContent: "", hidden: false });
  return { message: node(), result: node(), topic: node(), draft: node() };
}

const READY = { status: "ready", topic: "delivery", draft: "Спасибо, заказ в пути." };
const MANUAL = { status: "manual_review", topic: null, draft: null };

test("при успехе показаны тема и черновик", () => {
  const view = fakeView();
  render(view, READY);
  assert.equal(view.topic.textContent, "Доставка");
  assert.equal(view.draft.textContent, READY.draft);
  assert.equal(view.result.hidden, false);
  assert.equal(view.message.textContent, "");
});

test("manual_review очищает предыдущий черновик и показывает сообщение", () => {
  const view = fakeView();
  render(view, READY);
  render(view, MANUAL);
  assert.equal(view.draft.textContent, "");
  assert.equal(view.topic.textContent, "");
  assert.equal(view.result.hidden, true);
  assert.equal(view.message.textContent, MESSAGES.manual_review);
});

test("сетевая ошибка тоже очищает черновик", async () => {
  const view = fakeView();
  render(view, READY);
  const triage = createTriage(view, async () => {
    throw new TypeError("Failed to fetch");
  });
  await triage("текст");
  assert.equal(view.draft.textContent, "");
  assert.equal(view.message.textContent, MESSAGES.unavailable);
});

test("ответ на старый запрос не перезаписывает новый", async () => {
  const view = fakeView();
  const replies = [];
  const triage = createTriage(view, () => new Promise((resolve) => replies.push(resolve)));
  const first = triage("первая");
  const second = triage("вторая");
  replies[1](MANUAL);
  await second;
  replies[0](READY);
  await first;
  assert.equal(view.draft.textContent, "");
  assert.equal(view.message.textContent, MESSAGES.manual_review);
});
