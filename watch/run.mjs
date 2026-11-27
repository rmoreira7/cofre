// Daily run (.github/workflows/watch.yml): pull Pluggy, record any button taps, report how decided things turned out,
// send each decision due today as its own message with ✓ Feito / ⏰ Adiar buttons, and the Monday message (the past
// week, this week, what is ahead).
// Logs carry counts only, never amounts or names.
// env: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEMS ("label:id,…"), COFRE_ENTITIES (rules.entities JSON),
//      TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, COFRE_STATE_KEY + STATE_PATH (buttons; without them, plain messages),
//      COFRE_PHONE_GIST (optional: the phone's decisions, merged in),
//      OPENAI_API_KEY (optional: explanations), OPENAI_MODEL, COFRE_RENEWALS + COFRE_MONTHLY (optional JSON lists),
//      DRY_RUN=1 (print instead of send), FORCE_DIGEST=1 (treat today as Monday), TODAY=YYYY-MM-DD (test a date).
import { createPluggy } from "../src/lib/pluggy.js";
import { slim } from "../src/lib/model.js";
import { localToday } from "../src/lib/format.js";
import { outcome } from "../src/lib/decisions.js";
import { view, decide, decisionText, digest } from "./decide.mjs";
import { explain, MODEL } from "./explain.mjs";
import { createTelegram } from "./telegram.mjs";
import { load, save, EMPTY } from "./state.mjs";
import { applyTaps, syncMessages, buttons, pruneMessages, sig } from "./taps.mjs";
import { pullPhone } from "./phone.mjs";
import { closingText } from "../src/lib/closing.js";
import { newWarnings } from "../src/lib/warnings.js";

const need = (k) => process.env[k] || (console.error(`missing ${k}`), process.exit(2));
const dry = process.env.DRY_RUN === "1";
const MAX_EXPLAIN = 5;
const IDLE_CASH = 5000;

async function fx(snap) {
  const cur = [...new Set(snap.items.flatMap((it) => (it.accounts || []).map((a) => a.currencyCode)).filter((c) => c && c !== "BRL"))];
  if (!cur.length) return {};
  try {
    const r = await fetch(`https://economia.awesomeapi.com.br/json/last/${cur.map((c) => `${c}-BRL`).join(",")}`);
    return Object.fromEntries(Object.values(await r.json()).map((q) => [q.code, Number(q.bid)]));
  } catch {
    return {};
  }
}

// CDI in % per business day, from the Central Bank (SGS series 12). Null on failure: the cost line is then left out.
async function cdiDaily() {
  try {
    const r = await fetch("https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json", { signal: AbortSignal.timeout(15000) });
    const v = Number(String((await r.json())[0].valor).replace(",", "."));
    return v > 0 && v < 1 ? v : null;
  } catch {
    return null;
  }
}

// What a decided decision's check found, once per state change: confirmed, or not found (it then speaks again).
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
function reportText(r, o) {
  const d = r.d;
  if (o.state === "ok") {
    if (d.kind === "maturity") return `✅ <b>${d.title}</b> confirmado: ${o.n} ${o.n === 1 ? "aplicação nova" : "aplicações novas"}${o.cdi ? ` a ${Math.round(o.cdi)}% CDI` : ""}${o.cdi && d.cdbMin && o.cdi < d.cdbMin ? ` (abaixo do mínimo de ${d.cdbMin}%)` : ""}.`;
    if (d.kind === "idle") return `✅ <b>${d.name}</b>: conta de volta perto da reserva.`;
    if (d.kind === "bill") return `✅ <b>Fatura ${d.name}</b> paga: o pagamento apareceu.`;
    if (d.kind === "monthly") return `✅ <b>${d.name}</b> paga: a cobrança apareceu.`;
  }
  if (o.state === "no") {
    if (d.kind === "maturity") return `⚠️ <b>${d.title}</b>: marcado Feito em ${ddmm(r.at)}, mas não achei aplicação nova no banco. Volta a aparecer como decisão.`;
    if (d.kind === "idle") return `⚠️ <b>${d.name}</b>: marcado Feito em ${ddmm(r.at)}, mas o dinheiro continua na conta.`;
    if (d.kind === "bill") return `⚠️ <b>Fatura ${d.name}</b>: marcada como paga, mas o pagamento não apareceu.`;
    if (d.kind === "monthly") return `⚠️ <b>${d.name}</b>: marcada como paga, mas a cobrança não apareceu.`;
  }
  return null;
}

const items = need("PLUGGY_ITEMS").split(",").filter((x) => x.trim()).map((x) => {
  const [label, id] = x.trim().split(":");
  // Public repo, public logs: the item IDs are masked even though nothing here prints them.
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${id}`);
  return { label, id };
});
const rules = { entities: JSON.parse(need("COFRE_ENTITIES")) };
// Optional: subscriptions and annual plans to warn about before they renew (a private secret, never in the repo).
const envRenewals = process.env.COFRE_RENEWALS ? JSON.parse(process.env.COFRE_RENEWALS) : [];
// Optional: monthly bills paid by hand ({ name, day, amount?, match? }), same kind of secret.
const envMonthly = process.env.COFRE_MONTHLY ? JSON.parse(process.env.COFRE_MONTHLY) : [];
const today = process.env.TODAY || localToday();
const tg = dry ? null : createTelegram({ token: need("TELEGRAM_BOT_TOKEN"), chatId: need("TELEGRAM_CHAT_ID") });
const statePath = process.env.STATE_PATH, stateKey = process.env.COFRE_STATE_KEY;
const withState = Boolean(statePath && stateKey);
const state = withState ? await load(statePath, stateKey) : structuredClone(EMPTY);

// 1 · taps since the last run (the taps workflow normally got them already), and what was decided on the phone
if (withState && tg) console.log(`taps: ${await applyTaps(state, tg, { chatId: need("TELEGRAM_CHAT_ID"), today })}`);
if (withState) console.log(`phone: ${await pullPhone(state, { gist: process.env.COFRE_PHONE_GIST, key: stateKey })}`);
if (withState && tg) console.log(`edited: ${await syncMessages(state, tg)}`);
// Lists edited on the phone win over the secrets (which only seed a phone that never edited them).
const renewals = state.lists?.renewals || envRenewals, monthly = state.lists?.monthly || envMonthly;
console.log(`lists: ${state.lists ? "phone" : "secrets"}`);

const pulled = await createPluggy({ clientId: need("PLUGGY_CLIENT_ID"), clientSecret: need("PLUGGY_CLIENT_SECRET") }).pullAll(items);
const failed = pulled.items.filter((i) => i.error).length;
console.log(`pluggy: ${items.length - failed}/${items.length} banks ok`);
if (failed === items.length) process.exit(1);
const snap = slim(pulled);
snap.fx = await fx(snap);

// 2 · how decided things turned out (each state reported once)
const out = new Map(Object.entries(state.decisions).map(([id, r]) => [id, r.status === "snoozed" ? null : outcome(r, snap, { today, idleCash: IDLE_CASH })]));
const reports = [];
for (const [id, o] of out) {
  if (!o || o.state === state.reported[id]) continue;
  const t = reportText(state.decisions[id], o);
  if (t) reports.push(t);
  state.reported[id] = o.state;
}

// 3 · what is due today, minus what was decided (unless its check failed) or snoozed
const quiet = (id) => {
  const r = state.decisions[id];
  if (!r) return false;
  if (r.status === "snoozed") return r.until > today;
  return out.get(id)?.state !== "no";
};
const d = decide(view(snap, rules, today), { today, cdiDaily: await cdiDaily(), renewals, monthly, snapshot: snap, idleCash: IDLE_CASH, quiet, ...(process.env.FORCE_DIGEST === "1" && { monday: true }) });
let tokens = 0;
for (const u of d.urgent.filter((u) => u.facts).slice(0, MAX_EXPLAIN)) {
  const r = await explain(u.facts, { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || MODEL });
  u.why = r.text;
  if (dry) console.log("facts:", JSON.stringify(u.facts));
  tokens += r.usage?.total_tokens || 0;
  console.log(`explain: ${r.reason}`);
}
if (tokens) console.log(`openai tokens: ${tokens}`);
console.log(`decisions: ${d.urgent.length} due, ${reports.length} reports, ${d.weekly.length} weekly, digest=${d.monday}`);

const week = digest(d, today, state.week);
// The month-end summary from the phone, once per period (state.closing.sent).
const close = state.closing && !state.closing.sent ? closingText(state.closing) : null;
// Mid-cycle warnings from the phone, each once per cycle (state.warned).
const warns = withState && state.warnings ? newWarnings(state, state.warnings, today) : [];
console.log(`warnings: ${warns.length}`);
if (dry) {
  for (const t of [...reports, ...d.urgent.map(decisionText), ...(week ? [week] : []), ...(close ? [close] : []), ...warns]) console.log("\n" + t);
} else {
  for (const t of reports) await tg.send(t);
  for (const u of d.urgent) {
    const text = decisionText(u);
    const n = withState ? ++state.seq : null;
    const m = await tg.send(text, withState ? buttons(n) : null);
    if (withState) state.messages[n] = { id: u.id, d: u.d, text, at: today, mid: m.message_id, seen: sig(state, u.id) };
  }
  if (week) await tg.send(week);
  if (close) { await tg.send(close); state.closing.sent = true; }
  for (const t of warns) await tg.send(t);
  console.log("sent");
}
if (withState && !dry) { pruneMessages(state, today); await save(statePath, state, stateKey); }
