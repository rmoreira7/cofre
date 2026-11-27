import { test } from "node:test";
import assert from "node:assert/strict";
import { yearView } from "../src/lib/year.js";
import { topStores } from "../src/lib/search.js";
import { render } from "../src/screens/home/year.js";

const r = (d, desc, amt, o = {}) => ({ d, cyc: d.slice(0, 7), m: d.slice(0, 7), desc, amt, src: "card", cluster: "trans", cat: "Taxi and ride-hailing", ...o });

test("stores: processor codes and refunds fold into one store; card-only stores compare with the 12 before", () => {
  const periods = Array.from({ length: 24 }, (_, i) => `${2025 + Math.floor((i) / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
  const rows = [
    r("2026-03-10", "Uber *Trip", 30), r("2026-04-10", "Uber Uber *Trip Help.U", 40), r("2026-04-12", "Estorno de Uber - NuPay", -10),
    r("2025-05-10", "UBER* TRIP", 20, { hist: true }),
    r("2026-05-01", "Mp *Loja Boa", 80, { cluster: "shop" }),
    r("2026-06-01", "Pix|Pessoa Alfa", 100, { src: "account", cluster: "pix" }),
  ];
  const top = topStores(rows, { key: "cyc", today: "2026-12-20", periods });
  assert.deepEqual(top.map((x) => [x.name, x.total, x.prev]), [["Pessoa Alfa", 100, null], ["Loja Boa", 80, 0], ["Uber", 60, 20]]);
  assert.equal(top[2].n, 2);
});

test("the year: closed cycles give income and leftover, the open one adds to spending only", () => {
  const p = (id, spent, income, over = false) => ({ id, spent, income, left: income - spent, over, groups: [{ id: "food", label: "Alimentação", spent }] });
  const v = {
    today: "2026-11-27", rows: [r("2026-03-10", "Uber *Trip", 30)], wealth: { total: 500000 },
    periods: { "2025-12": p("2025-12", 9000, 10000), "2026-01": p("2026-01", 8000, 10000, true), "2026-02": p("2026-02", 6000, 10000) },
    month: { month: "2026-03", cycle: true, spent: 1000, daysLeft: 10, clusters: [{ id: "food", label: "Alimentação", spent: 1000 }] },
    history: [{ month: "2026-02", from: "2026-02-06", banks: { a: { measured: 300 }, b: { measured: 200 } } }],
  };
  const y = yearView(v);
  assert.equal(y.n, 2);
  assert.equal(y.spent, 15000);
  assert.equal(y.income, 20000);
  assert.equal(y.left, 6000);
  assert.equal(y.over, 1);
  assert.deepEqual([y.high.id, y.low.id], ["2026-01", "2026-02"]);
  assert.equal(y.earned.amount, 500);
  const html = render({ v, today: v.today });
  assert.match(html, /Gastos em 2026/);
  assert.match(html, /1 de 2 ciclos/);
  assert.match(html, /data-find="Uber"/);
});
