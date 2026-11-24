// Daily run (.github/workflows/watch.yml): pull Pluggy, decide what is due, send it to Telegram. Logs carry counts only, never amounts or names.
// env: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEMS ("label:id,…"), COFRE_ENTITIES (rules.entities JSON),
//      TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DRY_RUN=1 (print instead of send), FORCE_DIGEST=1 (treat today as Monday),
//      OPENAI_API_KEY (optional: explanations), OPENAI_MODEL, TODAY=YYYY-MM-DD (test a future date).
import { createPluggy } from "../src/lib/pluggy.js";
import { slim } from "../src/lib/model.js";
import { localToday } from "../src/lib/format.js";
import { view, decide, message } from "./decide.mjs";
import { explain, MODEL } from "./explain.mjs";

const need = (k) => process.env[k] || (console.error(`missing ${k}`), process.exit(2));
const dry = process.env.DRY_RUN === "1";

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

const MAX_EXPLAIN = 5;

async function telegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${need("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: need("TELEGRAM_CHAT_ID"), text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`telegram ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

const items = need("PLUGGY_ITEMS").split(",").filter((x) => x.trim()).map((x) => {
  const [label, id] = x.trim().split(":");
  // Public repo, public logs: the item IDs are masked even though nothing here prints them.
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${id}`);
  return { label, id };
});
const rules = { entities: JSON.parse(need("COFRE_ENTITIES")) };
const pulled = await createPluggy({ clientId: need("PLUGGY_CLIENT_ID"), clientSecret: need("PLUGGY_CLIENT_SECRET") }).pullAll(items);
const failed = pulled.items.filter((i) => i.error).length;
console.log(`pluggy: ${items.length - failed}/${items.length} banks ok`);
if (failed === items.length) process.exit(1);

const snap = slim(pulled);
snap.fx = await fx(snap);
const today = process.env.TODAY || localToday();
const d = decide(view(snap, rules, today), { today, cdiDaily: await cdiDaily(), ...(process.env.FORCE_DIGEST === "1" && { monday: true }) });
let tokens = 0;
for (const u of d.urgent.filter((u) => u.facts).slice(0, MAX_EXPLAIN)) {
  const r = await explain(u.facts, { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || MODEL });
  u.why = r.text;
  if (dry) console.log("facts:", JSON.stringify(u.facts));
  tokens += r.usage?.total_tokens || 0;
  console.log(`explain: ${r.reason}`);
}
if (tokens) console.log(`openai tokens: ${tokens}`);
console.log(`decisions: ${d.urgent.length} urgent, ${d.weekly.length} weekly, digest=${d.monday}`);
const text = message(d, today);
if (!text) console.log("nothing to send");
else if (dry) console.log("\n" + text);
else { await telegram(text); console.log("sent"); }
