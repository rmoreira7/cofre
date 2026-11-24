// The few Telegram Bot API calls the watcher makes. fetch is injectable for tests.
export function createTelegram({ token, chatId, fetch = globalThis.fetch }) {
  async function call(method, body) {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw Object.assign(new Error(`telegram ${method}: ${j.description || r.status}`), { description: j.description });
    return j.result;
  }
  const keyboard = (buttons) => (buttons?.length ? { reply_markup: { inline_keyboard: [buttons.map(([text, data]) => ({ text, callback_data: data }))] } } : {});
  return {
    send: (text, buttons) => call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...keyboard(buttons) }),
    edit: (messageId, text, buttons) => call("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true, ...keyboard(buttons) }),
    answer: (queryId, text) => call("answerCallbackQuery", { callback_query_id: queryId, text }).catch(() => null), // too old after ~15 min: harmless
    updates: (offset) => call("getUpdates", { offset, timeout: 0, allowed_updates: ["callback_query"] }),
  };
}
