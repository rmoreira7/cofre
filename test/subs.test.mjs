import { test } from "node:test";
import assert from "node:assert/strict";
import { subscriptions } from "../src/lib/recurring.js";
import { render } from "../src/screens/spend/subs.js";

const today = "2026-11-27";
const charge = (d, desc, amt, src = "card", cluster = "serv") => ({ d, desc, amt, src, cluster, cat: "Services" });
const rows = ["2026-08-12", "2026-09-12", "2026-10-12", "2026-11-12"].flatMap((d) => [charge(d, "Plano Streaming", 39.9), charge(d.replace(/12$/, "05"), "Clube Socio", 100, "card", "leis")]);

test("found charges, a renewal with no charge (yearly) and a conta paid by boleto add up per month and per year", () => {
  const lists = {
    renewals: [{ name: "Clube Socio", date: "2027-01-05", every: "month" }, { name: "Seguro Anual", date: "2026-12-20", amount: 1200, every: "year" }],
    monthly: [{ name: "Internet", day: 10, amount: 100, match: ["NET SERV"] }, { name: "Plano Streaming", day: 12, amount: 39.9, match: ["Plano Streaming"] }],
  };
  const s = subscriptions(rows, { lists, today });
  assert.deepEqual(s.monthly.map((m) => [m.name, m.src]), [["Clube Socio", "card"], ["Internet", "list"], ["Plano Streaming", "card"]]);
  assert.equal(s.monthly[0].renews, "2027-01-05");
  assert.deepEqual(s.yearly.map((y) => [y.name, y.days]), [["Seguro Anual", 23]]);
  assert.equal(Math.round(s.perMonth * 100) / 100, 100 + 100 + 39.9 + 100);
  assert.equal(Math.round(s.perYear), Math.round((339.9) * 12));
  const html = render({ subscriptions: s });
  assert.match(html, /Seguro Anual <span class="chip bad">em 23 d<\/span>/);
  assert.match(html, /Todo ano/);
});

test("nothing recurring: an empty state", () => {
  assert.match(render({ subscriptions: subscriptions([], { lists: {}, today }) }), /Nenhuma assinatura/);
});

test("names read like a person's; a hidden one leaves the totals and can come back", async () => {
  const { niceName } = await import("../src/lib/recurring.js");
  assert.deepEqual(["Op P*fatura Op", "Milhas Clube Milhas", "Google Youtube", "Google One"].map(niceName), ["Op", "Clube Milhas", "YouTube", "Google One"]);
  const all = subscriptions(rows, { lists: {}, today });
  const key = all.monthly.find((m) => m.name === "Plano Streaming").key;
  const s = subscriptions(rows, { lists: {}, today, hidden: [key] });
  assert.deepEqual(s.monthly.map((m) => m.name), ["Clube Socio"]);
  assert.deepEqual(s.hidden.map((m) => m.name), ["Plano Streaming"]);
  assert.equal(s.perMonth, 100);
  const html = render({ subscriptions: s });
  assert.match(html, /data-hide="card:clube socio"/);
  assert.match(html, /Ocultas \(1\)/);
  let saved;
  const pane = {};
  const { bind } = await import("../src/screens/spend/subs.js");
  bind(pane, {}, { data: { hiddenSubs: [key] }, save: async (d) => { saved = d; } }, { repaint() {}, rerender() {} });
  pane.onclick({ target: { closest: (sel) => (sel === "[data-show]" ? { dataset: { show: key } } : null) } });
  assert.deepEqual(saved.hiddenSubs, []);
});

test("a fixed price that goes up is a raise: a chip on the row and one Telegram warning in that cycle", async () => {
  const { cycleWarnings, newWarnings } = await import("../src/lib/warnings.js");
  const plan = ["2026-08-24", "2026-09-24", "2026-10-24"].map((d) => charge(d, "Socio Clube", 259.9, "card", "leis")).concat(charge("2026-11-24", "Socio Clube", 289.9, "card", "leis"));
  const s = subscriptions(plan, { lists: {}, today });
  assert.deepEqual(s.monthly[0].raise, { from: 259.9, to: 289.9, since: "2026-11-24" });
  assert.match(render({ subscriptions: s }), /▲ \+R\$ 30,00 desde 24\/11/);
  const v = { today, month: { month: "2026-12", start: "2026-11-26", daysLeft: 29, clusters: [] }, subscriptions: s };
  assert.equal(cycleWarnings(v).items.length, 0); // charged before this cycle began
  const w = cycleWarnings({ ...v, month: { ...v.month, start: "2026-11-20" } });
  const [msg] = newWarnings({}, w, today);
  assert.match(msg, /Socio Clube ficou mais caro<\/b>\nR\$ 259,90 → <b>R\$ 289,90<\/b> · \+R\$ 30,00 \(12%\)\ncobrado em 24\/11 · R\$ 360 a mais por ano/);
  // a bill that varies a little every month is not a raise; nor is a jump past 50 %
  const varying = [["2026-08-05", 61.2], ["2026-09-05", 69.8], ["2026-10-05", 66.4], ["2026-11-05", 72.1]].map(([d, a]) => charge(d, "Op Fatura", a, "card", "bills"));
  assert.equal(subscriptions(varying, { lists: {}, today }).monthly.find((m) => m.raise), undefined);
  const big = plan.slice(0, 3).concat(charge("2026-11-24", "Socio Clube", 500, "card", "leis"));
  assert.equal(subscriptions(big, { lists: {}, today }).monthly.length, 0);
});
