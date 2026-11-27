// Telegram button taps: ✓ Feito / ⏰ Adiar on a decision's message, ↩ Desfazer after. Each tap is recorded in the
// watcher's state with the app's own decide()/undo(); then every message whose decision changed (by a tap, or on the
// phone: watch/phone.mjs) is edited to say what was recorded, or gets its buttons back after an undo.
// Run on its own every few minutes (.github/workflows/taps.yml), and at the start of the daily run.
import { decide, undo } from "../src/lib/decisions.js";
import { forget, tsOf } from "../src/lib/sync.js";
import { localToday } from "../src/lib/format.js";

const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const KEEP_MESSAGES_DAYS = 60;

export const buttons = (n) => [["✓ Feito", `f:${n}`], ["⏰ Adiar", `a:${n}`]];
const undoButton = (n) => [["↩ Desfazer", `u:${n}`]];

// What a decision currently is, as a string that changes whenever it changes (a repeated Feito included).
export const sig = (state, id) => {
  const r = state.decisions[id];
  return r ? `${r.status}:${tsOf(r)}` : `open:${state.undone?.[id] || 0}`;
};

// Messages saved before `seen` existed: taken as showing their decision's current state.
const mark = (state) => { for (const m of Object.values(state.messages)) m.seen ??= sig(state, m.id); };

// Returns how many taps changed the state. tg: watch/telegram.mjs. chatId: only taps from that chat count.
export async function applyTaps(state, tg, { chatId, today = localToday(), now = Date.now() }) {
  mark(state);
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
      state.undone = forget(state.undone, m.id, now);
      await tg.answer(q.id, "Desfeito");
    } else if (act === "f" || act === "a") {
      state.decisions = decide(state.decisions, m.d, act === "f" ? "done" : "snoozed", { today, ts: now, by: "telegram" });
      const r = state.decisions[m.id];
      await tg.answer(q.id, act === "f" ? "Registrado" : `Volta em ${ddmm(r.until)}`);
    } else continue;
    delete state.reported[m.id];
    changed++;
  }
  await syncMessages(state, tg);
  return changed;
}

// Edits every message whose decision changed since it was last painted. Returns how many were edited.
export async function syncMessages(state, tg) {
  mark(state);
  let n = 0;
  for (const [k, m] of Object.entries(state.messages)) {
    const s = sig(state, m.id);
    if (s === m.seen) continue;
    const r = state.decisions[m.id];
    const where = r?.by === "app" ? " no app" : "";
    const note = !r ? null
      : r.status === "snoozed" ? `⏰ Adiado${where} até ${ddmm(r.until)}`
      : r.status === "other" ? `✓ Outra escolha${where} em ${ddmm(r.at)}`
      : `✓ ${m.d.kind === "bill" || m.d.kind === "monthly" ? "Paga" : "Feito"}${where} em ${ddmm(r.at)} · confiro nos dados`;
    try {
      await tg.edit(m.mid, note ? `${m.text}\n\n<i>${note}</i>` : m.text, note ? undoButton(k) : buttons(k));
    } catch (e) {
      if (!/not modified/i.test(e.description || "")) { console.log(`edit failed: ${e.description || e.message}`); continue; }
    }
    m.seen = s;
    n++;
  }
  return n;
}

// Drops the message map entries older than KEEP_MESSAGES_DAYS (their buttons then answer "decida no app").
export function pruneMessages(state, today) {
  const cut = new Date(today + "T12:00:00Z"); cut.setUTCDate(cut.getUTCDate() - KEEP_MESSAGES_DAYS);
  const c = cut.toISOString().slice(0, 10);
  state.messages = Object.fromEntries(Object.entries(state.messages).filter(([, m]) => m.at >= c));
}

// A connection that never reached Telegram or GitHub (timeout, DNS, reset), as opposed to an API answer saying no.
const NET = /^(ETIMEDOUT|ENETUNREACH|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_\w+)$/;
export function isNetworkError(e) {
  for (let c = e, i = 0; c && i < 5; c = c.cause, i++) {
    if (NET.test(c.code || "") || (c.errors || []).some((x) => NET.test(x.code || ""))) return true;
  }
  return false;
}

// CLI: node watch/taps.mjs — env TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, COFRE_STATE_KEY, STATE_PATH, and optionally
// COFRE_PHONE_GIST (the phone's decisions, merged in).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { createTelegram } = await import("./telegram.mjs");
  const { load, save } = await import("./state.mjs");
  const { pullPhone } = await import("./phone.mjs");
  const { canon } = await import("../src/lib/sync.js");
  const need = (k) => process.env[k] || (console.error(`missing ${k}`), process.exit(2));
  const path = need("STATE_PATH"), key = need("COFRE_STATE_KEY");
  const state = await load(path, key);
  const before = canon(state);
  const tg = createTelegram({ token: need("TELEGRAM_BOT_TOKEN"), chatId: need("TELEGRAM_CHAT_ID") });
  try {
    console.log(`taps: ${await applyTaps(state, tg, { chatId: need("TELEGRAM_CHAT_ID") })}`);
    console.log(`phone: ${await pullPhone(state, { gist: process.env.COFRE_PHONE_GIST, key })}`);
    console.log(`edited: ${await syncMessages(state, tg)}`);
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    // Nothing saved: the offset stays put, so the next run fetches the same taps again.
    console.log(`::warning::network blip, skipped this run: ${e.cause?.code || e.code || e.message}`);
    process.exit(0);
  }
  if (canon(state) !== before) await save(path, state, key);
}
