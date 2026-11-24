// Every tab's sub-tabs render against a fictional snapshot without throwing: catches a screen module that uses a helper
// it never imported (only fails at render time, never at parse time). The bind() side needs a DOM and is covered by the
// browser end-to-end run.
import test from "node:test";
import assert from "node:assert/strict";
import { buildView } from "../src/lib/view.js";
import * as home from "../src/screens/home.js";
import { screen as spend } from "../src/screens/spend/index.js";
import { screen as investments } from "../src/screens/investments/index.js";
import { screen as projection } from "../src/screens/projection/index.js";
import { screen as settings } from "../src/screens/settings/index.js";

const today = "2026-11-24";
const tx = (id, date, amount, description, extra = {}) => ({ id, date, amount, description, operationType: extra.op, category: extra.cat || "Restaurants", status: "POSTED", ...(extra.card && { card: extra.card }) });
const charge = (id, date, amount, bill, desc, n, of) => tx(id, date, amount, desc, { card: { billForecastDate: `${bill}-03`, paymentType: n ? "INSTALLMENT" : "SINGLE", installmentNumber: n, totalInstallments: of, purchaseDate: date } });
const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const next = (ym, k) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return d.toISOString().slice(0, 7); };
const cardTx = months.flatMap((m, i) => [charge(`c${i}a`, `${m}-10`, 300 + i * 10, next(m, 1), "Restaurante Teste"), charge(`c${i}b`, `${m}-12`, 120, next(m, 1), "Mercado Teste")])
  .concat([charge("p1", "2026-11-07", 90, "2026-12", "Loja Parcelada 1/3", 1, 3), charge("p2", "2026-11-07", 90, "2027-01", "Loja Parcelada 2/3", 2, 3), charge("p3", "2026-11-07", 90, "2027-02", "Loja Parcelada 3/3", 3, 3)]);
const bankTx = months.flatMap((m, i) => [tx(`s${i}`, `${m}-05`, 900, "Transferência recebida", { cat: "Same person transfer" }), tx(`d${i}`, `${m}-15`, -80, "Conta de luz", { cat: "Electricity" })]);
const inv = (id, issuer, balance, orig, due, extra = {}) => ({ id, name: issuer, issuer, type: "FIXED_INCOME", subtype: "CDB", status: "ACTIVE", balance, amountOriginal: orig, rate: 110, rateType: "CDI", dueDate: due, purchaseDate: "2025-06-01", taxes: (balance - orig) * 0.2, quantity: 1, ...extra });
const snapshot = {
  at: `${today}T10:00:00Z`,
  cdi: { daily: 0.05, date: today },
  items: [
    { label: "nubank", item: { status: "UPDATED", consentExpiresAt: "2027-11-05", resourcesCollectedAt: `${today}T09:00:00Z` }, accounts: [
      { id: "card", type: "CREDIT", balance: 1200, currencyCode: "BRL", credit: { balanceDueDate: "2026-12-03", creditLimit: 5000 }, bills: [{ dueDate: "2026-11-03", totalAmount: 400 }], transactions: cardTx },
      { id: "acc", type: "BANK", balance: 1500, currencyCode: "BRL", reserved: [], transactions: bankTx },
    ], investments: [inv("n1", "Emissor A", 1100, 1000, "2028-06-01")] },
    { label: "xp", item: { status: "UPDATED", consentExpiresAt: "2027-11-06" }, accounts: [{ id: "x", type: "BANK", balance: 20, currencyCode: "BRL", reserved: [], transactions: [] }],
      investments: [inv("x1", "Emissor B", 2000, 1800, "2026-12-01"), inv("x2", "Emissor C", 3000, 2900, "2027-09-01"), inv("x3", "Emissor D", 4000, 4000, "2029-01-01", { subtype: "LCA", taxes: 0 })] },
    { label: "itau", item: { status: "UPDATED", consentExpiresAt: "2027-11-06" }, accounts: [{ id: "i", type: "BANK", balance: 9000, currencyCode: "BRL", reserved: [], transactions: [] }],
      investments: [inv("i1", "Emissor E", 5000, 5000, "2027-11-22", { subtype: "LCA", taxes: 0 })] },
  ],
};
const p = { salary: [{ from: "2020-01", net: 1000 }], thirteenth: { months: [11, 12], share: 0.5 }, vacation: { month: 1, amount: 300, from_year: 2031 }, cdi: { 2026: 14, 2027: 13, 2028: 12 }, cdi_pct: 110, ir: 15, from: "2026-11-06" };
const rules = {
  format: "cofre-rules", v: 1, entities: { me: { banks: ["nubank", "xp"] }, mom: { banks: ["itau"] } }, entity_rules: {}, desc_rules: [], overrides: {}, learned: {}, projection: p,
  wealth: [{ d: "2026-11-06", banks: { nubank: 2500, xp: 9000 } }],
  invHistory: [{ v: 2, d: "2026-11-06", p: { n1: [1090, 1000, 1, "nubank"], x1: [1990, 1800, 1, "xp"], x2: [2990, 2900, 1, "xp"], x3: [3990, 4000, 1, "xp"], i1: [4990, 5000, 1, "itau"] } }],
};
const data = { v: 1, settings: { target: 700 }, credentials: { clientId: "id", clientSecret: "s", items: [{ label: "nubank", id: "0".repeat(36) }] }, rules, snapshot, userOverrides: {}, invLog: [{ v: 2, d: today, p: { n1: [1100, 1000, 1, "nubank"], x1: [2000, 1800, 1, "xp"], x2: [3000, 2900, 1, "xp"], x3: [4000, 4000, 1, "xp"], i1: [5000, 5000, 1, "itau"] } }] };
let view = null;
const ctx = { data, version: "test", progress: "", busy: false, bio: { available: false, enrolled: false }, view: () => (view ||= buildView(data, today)), sub: (tab, ids) => ids[0] };

test("the view builds from the fixture", () => {
  const v = ctx.view();
  assert.ok(v.month && v.wealth.total > 0 && v.income.own.n === 4 && v.bills.length === 3 && v.history.length === 1);
});

test("Início renders its five summary rows with links into the sub-tabs", () => {
  const el = { innerHTML: "", onclick: null };
  home.render(el, ctx);
  for (const go of ["spend:cycle", "investments:wallet", "spend:bills"]) assert.match(el.innerHTML, new RegExp(`data-go="${go}"`));
});

for (const s of [spend, investments, projection, settings]) {
  test(`${s.title}: every sub-tab renders`, () => {
    const t = s.context(ctx);
    for (const sub of s.subs) {
      assert.ok(sub.id && sub.label, `${s.tab}: a sub-tab without id/label`);
      const html = sub.render(t, ctx);
      assert.equal(typeof html, "string", `${s.tab}/${sub.id}`);
      assert.ok(html.length > 50, `${s.tab}/${sub.id} rendered almost nothing`);
    }
  });
}

test("Faturas lists the bill months with the installment lines", () => {
  const html = spend.subs.find((x) => x.id === "bills").render(spend.context(ctx), ctx);
  assert.match(html, /data-bm="2026-12"/);
  assert.match(html, /data-bm="2027-02"/);
  assert.match(html, /<span class="pl">1\/3<\/span>/);
});

test("Rendimentos shows the measured history with the joint account apart", () => {
  const html = investments.subs.find((x) => x.id === "income").render(investments.context(ctx), ctx);
  assert.match(html, /Histórico, medido/);
  assert.match(html, /data-hb="itau"/);
  assert.match(html, /conjunta/);
});
