// Telegram button taps: ✓ Feito / ⏰ Adiar on a decision's message, ↩ Desfazer after. Each tap is recorded in the
// watcher's state with the app's own decide()/undo(), and the message is edited to say what was recorded.
// Run on its own every few minutes (.github/workflows/taps.yml), and at the start of the daily run.
import { decide, undo } from "../src/lib/decisions.js";
import { localToday } from "../src/lib/format.js";

const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const KEEP_MESSAGES_DAYS = 60;

export const buttons = (n) => [["✓ Feito", `f:${n}`], ["⏰ Adiar", `a:${n}`]];
const undoButton = (n) => [["↩ Desfazer", `u:${n}`]];

// Returns how many taps changed the state. tg: watch/telegram.mjs. chatId: only taps from that chat count.
export async function applyTaps(state, tg, { chatId, today = localToday() }) {
  const updates = await tg.updates(state.offset ? state.offset + 1 : undefined);
  let changed = 0;
  for (const u of updates) {
    state.offset = Math.max(state.offset || 0, u.update_id);
    const q = u.callback_query;
    if (!q) continue;
    if (String(q.message?.chat?.id) !== String(chatId)) { await tg.answer(q.id); continue; }
    const [act, n] = String(q.data || "").split(":");
    const m = state.messages[n];
    if (!m) { await tg.answer(q.id, "Mensagem antiga: decida no app."); continue; }
    if (act === "u") {
      state.decisions = undo(state.decisions, m.id);
      delete state.reported[m.id];
      await tg.edit(m.mid, m.text, buttons(n));
      await tg.answer(q.id, "Desfeito");
    } else if (act === "f" || act === "a") {
      state.decisions = decide(state.decisions, m.d, act === "f" ? "done" : "snoozed", { today });
      delete state.reported[m.id];
      const r = state.decisions[m.id];
      const note = act === "f" ? `✓ ${m.d.kind === "bill" ? "Paga" : "Feito"} em ${ddmm(today)} · confiro nos dados` : `⏰ Adiado até ${ddmm(r.until)}`;
      await tg.edit(m.mid, `${m.text}\n\n<i>${note}</i>`, undoButton(n));
      await tg.answer(q.id, act === "f" ? "Registrado" : `Volta em ${ddmm(r.until)}`);
    } else continue;
    changed++;
  }
  return changed;
}

// Drops the message map entries older than KEEP_MESSAGES_DAYS (their buttons then answer "decida no app").
export function pruneMessages(state, today) {
  const cut = new Date(today + "T12:00:00Z"); cut.setUTCDate(cut.getUTCDate() - KEEP_MESSAGES_DAYS);
  const c = cut.toISOString().slice(0, 10);
  state.messages = Object.fromEntries(Object.entries(state.messages).filter(([, m]) => m.at >= c));
}

// CLI: node watch/taps.mjs — env TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, COFRE_STATE_KEY, STATE_PATH.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { createTelegram } = await import("./telegram.mjs");
  const { load, save } = await import("./state.mjs");
  const need = (k) => process.env[k] || (console.error(`missing ${k}`), process.exit(2));
  const path = need("STATE_PATH"), key = need("COFRE_STATE_KEY");
  const state = await load(path, key);
  const before = state.offset;
  const n = await applyTaps(state, createTelegram({ token: need("TELEGRAM_BOT_TOKEN"), chatId: need("TELEGRAM_CHAT_ID") }), { chatId: need("TELEGRAM_CHAT_ID") });
  console.log(`taps: ${n}`);
  if (n || state.offset !== before) await save(path, state, key);
}
