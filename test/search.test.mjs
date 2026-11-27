import { test } from "node:test";
import assert from "node:assert/strict";
import { search } from "../src/lib/search.js";
import { render, results, bind } from "../src/screens/spend/search.js";

const today = "2026-11-27";
const r = (d, desc, amt, cat = "Food delivery", cluster = "food", o = {}) => ({ d, m: d.slice(0, 7), cyc: d.slice(0, 7), desc, amt, cat, cluster, src: "card", ...o });
const rows = [
  r("2026-11-25", "Ifood *Restaurante", 70.52), r("2026-10-03", "IFOOD *Mercado", 40), r("2025-12-10", "Ifood *Pizza", 50),
  r("2026-11-20", "Estorno de Ifood *Restaurante", -10), r("2026-09-01", "Farmácia São João", 30, "Pharmacy", "health"),
  r("2026-12-05", "Ifood *Futuro", 99, "Food delivery", "food", { ahead: true }),
];
const periods = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];

test("every word must match merchant, category or group; accents and case ignored; refunds net; nothing ahead of today", () => {
  const s = search(rows, "IFOOD", { key: "cyc", today, periods });
  assert.equal(s.n, 3);
  assert.equal(Math.round(s.total * 100), 15052);
  assert.equal(Math.round(s.year * 100), 10052);
  assert.equal(Math.round(s.byPeriod["2026-11"] * 100), 6052);
  assert.equal(search(rows, "farmacia", { today, periods }).n, 1);
  assert.equal(search(rows, "saude", { today, periods }).n, 1); // the group, Saúde
  assert.equal(search(rows, "ifood pizza", { today, periods }).n, 1);
  assert.equal(search(rows, " ", { today, periods }), null);
});

test("Buscar redraws only the results as you type", () => {
  const t = { today, rows, month: { cycle: true, history: periods.map((month) => ({ month })) } };
  assert.match(render(t), /data-q/);
  const out = { innerHTML: "" }, pane = { querySelector: () => out };
  bind(pane, t);
  pane.oninput({ target: { matches: () => true, value: "ifood" } });
  assert.match(out.innerHTML, /3 compras/);
  assert.match(out.innerHTML, /Restaurante/);
  pane.oninput({ target: { matches: () => true, value: "zzz" } });
  assert.match(out.innerHTML, /Nada encontrado/);
  pane.oninput({ target: { matches: () => true, value: "" } });
  assert.match(results(t), /Onde mais gastou/); // nothing typed: the ranking
});
