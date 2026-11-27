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
