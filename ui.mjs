// Отрисовка результата разбора. Работает с любыми объектами, у которых есть
// textContent и hidden, поэтому её можно проверить в Node без браузера.

export const TOPIC_LABELS = {
  delivery: "Доставка",
  pricing: "Цены и стоимость",
  other: "Другое",
};

export const MESSAGES = {
  loading: "Разбираем заявку…",
  invalid_input: "Введите текст заявки.",
  manual_review:
    "AI не смог разобрать заявку. Определите тему и подготовьте ответ вручную.",
  unavailable: "Сервис разбора недоступен. Разберите заявку вручную.",
};

function clear(view) {
  view.topic.textContent = "";
  view.draft.textContent = "";
  view.result.hidden = true;
}

// payload — тело ответа API или null, если запрос не удался.
export function render(view, payload) {
  clear(view);
  if (payload?.status === "ready") {
    view.message.textContent = "";
    view.topic.textContent = TOPIC_LABELS[payload.topic] ?? payload.topic;
    view.draft.textContent = payload.draft;
    view.result.hidden = false;
    return;
  }
  view.message.textContent = MESSAGES[payload?.status] ?? MESSAGES.unavailable;
}

export function renderLoading(view) {
  clear(view);
  view.message.textContent = MESSAGES.loading;
}

// Показывает ответ только на последний отправленный запрос:
// если менеджер отправил заявку повторно, старый ответ не перезапишет новый.
export function createTriage(view, send) {
  let latest = 0;
  return async function triage(text) {
    const id = ++latest;
    renderLoading(view);
    let payload = null;
    try {
      payload = await send(text);
    } catch {
      payload = null;
    }
    if (id === latest) render(view, payload);
  };
}
