import { test } from "node:test";
import assert from "node:assert/strict";
import { recurring } from "../src/lib/recurring.js";

const row = (d, amt, desc, extra = {}) => ({ d, m: d.slice(0, 7), amt, desc, src: "card", cat: "Digital services", ...extra });
const today = "2026-11-26";
const series = (desc, amt, dates, extra) => dates.map((d) => row(d, amt, desc, extra));
const MONTHS = ["2026-06-15", "2026-07-15", "2026-08-16", "2026-09-15", "2026-10-15", "2026-11-15"];

test("a charge on the same day every month, same price: offered with its day, amount and match", () => {
  const [r] = recurring(series("Streaming X", 39.9, MONTHS), { today });
  assert.deepEqual({ ...r, last: undefined }, { key: "card:streaming x", name: "Streaming X", src: "card", card: true, amount: 39.9, match: ["Streaming X"], day: 15, last: undefined, n: 6 });
});

test("a PIX that drifts through the month is offered as every N days, from the account", () => {
  const [r] = recurring(series("Pix enviado|Prof Y", 200, ["2026-06-01", "2026-07-04", "2026-08-06", "2026-09-08", "2026-10-11", "2026-11-13"], { src: "account" }), { today });
  assert.equal(r.card, false);
  assert.equal(r.every, 33);
  assert.equal(r.day, undefined);
  assert.deepEqual(r.match, ["Prof Y"]);
});

test("installments, varying amounts, irregular gaps, a stopped plan and too few charges are not subscriptions", () => {
  const found = recurring([
    ...series("Loja Z 2/6", 100, MONTHS, { inst: true }),
    ...MONTHS.map((d, i) => row(d, 50 + i * 40, "Mercado W")),
    ...series("Bar V", 30, ["2026-09-01", "2026-09-05", "2026-10-20", "2026-11-20"]),
    ...series("Plano Velho", 20, ["2026-04-10", "2026-05-10", "2026-06-10", "2026-07-10"]),
    ...series("Novo", 10, ["2026-10-10", "2026-11-10"]),
    ...series("Juros", 2, MONTHS, { cat: "Interests charged" }),
  ], { today });
  assert.deepEqual(found, []);
});

test("one missed month keeps the run; already in the lists or ignored, it is not offered again", () => {
  const xs = series("Clube Q", 46, ["2026-06-15", "2026-07-15", "2026-09-15", "2026-10-15", "2026-11-15"]);
  assert.equal(recurring(xs, { today })[0].n, 5);
  assert.deepEqual(recurring(xs, { today, lists: { monthly: [{ name: "Q", day: 15, match: ["clube q"] }] } }), []);
  assert.deepEqual(recurring(xs, { today, lists: { renewals: [{ name: "Clube-Q", date: "2027-01-01" }] } }), []);
  assert.equal(recurring(xs, { today, lists: { renewals: [{ name: "Clube Outro", date: "2027-01-01" }] } }).length, 1, "a shared word is not a match");
  assert.deepEqual(recurring(xs, { today, ignored: ["card:clube q"] }), []);
});

test("Ajustes › Contas: Adicionar opens the conta form prefilled; Ignorar hides the charge for good", async () => {
  const bills = await import("../src/screens/settings/bills.js");
  const found = recurring(series("Streaming X", 39.9, MONTHS), { today });
  let data = { rules: { monthly: [], renewals: [] } }, painted = 0;
  const ctx = { get data() { return data; }, save: async (d) => { data = d; } };
  const t = { recurring: found };
  assert.match(bills.render(t, ctx), /Encontradas no extrato[\s\S]*Streaming X[\s\S]*todo dia 15/);
  const pane = { querySelector: () => null };
  bills.bind(pane, t, ctx, { repaint: () => painted++ });
  const click = (r) => pane.onclick({ target: { closest: (s) => (s === "[data-r]" ? { dataset: { r } } : null) } });
  await click("add:0");
  const html = bills.render(t, ctx);
  for (const s of ['value="Streaming X"', 'name="day" type="number" inputmode="numeric" min="1" max="31" value="15"', 'value="39,9"', 'name="match" spellcheck="false" value="Streaming X"', 'name="card" type="checkbox" checked']) assert.ok(html.includes(s), s);
  pane.onclick({ target: { closest: (s) => (s === "[data-a]" ? { dataset: { a: "cancel" } } : null) } });
  await click("ignore:0");
  assert.deepEqual(data.ignoredRecurring, ["card:streaming x"]);
  assert.equal(recurring(series("Streaming X", 39.9, MONTHS), { today, ignored: data.ignoredRecurring }).length, 0);
  assert.ok(painted >= 2);
});
