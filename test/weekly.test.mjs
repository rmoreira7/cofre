import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStart, weekSummary, weeksForPhone, weekLines } from "../src/lib/weekly.js";
import { decide, digest } from "../watch/decide.mjs";

const r = (d, desc, amt, cluster = "food", o = {}) => ({ d, desc, amt, cluster, src: "card", ...o });
const clusters = [{ id: "food", label: "Alimentação" }, { id: "trans", label: "Transporte" }, { id: "shop", label: "Compras" }, { id: "leis", label: "Lazer" }];
const v = (today) => ({
  today,
  rows: [r("2026-11-16", "Ifd*Pizza", 80), r("2026-11-18", "Uber *Trip", 30, "trans"), r("2026-11-22", "Mp *Loja", 200, "shop"),
    r("2026-11-21", "Cinema", 40, "leis"), r("2026-11-15", "Antes", 999), r("2026-11-24", "Depois", 50), r("2026-11-17", "Velha", 70, "food", { hist: true })],
  month: { month: "2026-12", spent: 4100, target: 7000, daysLeft: 29, over: false, clusters },
  pace: { tone: "", early: false, delta: 0 },
});

test("a week runs Monday to Sunday; the phone sends the previous and the current one", () => {
  assert.equal(weekStart("2026-11-23"), "2026-11-23");
  assert.equal(weekStart("2026-11-29"), "2026-11-23");
  const w = weekSummary(v("2026-11-27"), "2026-11-16");
  assert.equal(w.end, "2026-11-22");
  assert.equal(w.total, 350);
  assert.deepEqual(w.groups.map((g) => g.label), ["Compras", "Alimentação", "Lazer", "Transporte"]);
  assert.deepEqual(w.buys.map((b) => b.name), ["Loja", "Pizza", "Cinema"]);
  assert.deepEqual(weeksForPhone(v("2026-11-27")).map((x) => x.start), ["2026-11-16", "2026-11-23"]);
});

test("the Monday message opens with last week, then what falls due this week", () => {
  const weeks = weeksForPhone(v("2026-11-23"));
  const L = weekLines(weeks, "2026-11-23").join("\n");
  assert.match(L, /Semana passada<\/b> · <b>R\$ 350<\/b> em 4 compras/);
  assert.match(L, /• Compras R\$ 200 · Alimentação R\$ 80 · Lazer R\$ 40 · \+ R\$ 30/);
  assert.match(L, /maiores: Loja R\$ 200 · Pizza R\$ 80 · Cinema R\$ 40/);
  assert.match(L, /Ciclo<\/b> R\$ 4\.100 de R\$ 7\.000 · no ritmo · faltam 29 dias/);
  assert.doesNotMatch(L, /dados até/);
  // the phone last opened on Friday: the week is there, marked as partial
  assert.match(weekLines(weeksForPhone(v("2026-11-20")), "2026-11-23").join("\n"), /dados até 20\/11/);
  // no week from the phone: the message goes without it
  assert.deepEqual(weekLines([], "2026-11-23"), []);
  const view = { today: "2026-11-23", wealth: { banks: [], total: 0 }, cards: [{ name: "Cartão A", bill: 2650, due: "2026-11-27" }], mat: { rows: [] }, guarantee: { issuers: [] }, status: [] };
  const msg = digest(decide(view, { today: "2026-11-23", monthly: [{ name: "Conta B", day: 25, amount: 69.8 }] }), "2026-11-23", weeks);
  assert.match(msg, /^📅 <b>Cofre · semana de 23\/11<\/b>\n\n🧾 <b>Semana passada/);
  assert.match(msg, /<b>Esta semana<\/b>\n• 25\/11 📱 Conta B ~R\$ 69,80\n• 27\/11 🧾 Fatura Cartão A <b>R\$ 2\.650<\/b>/);
});
