import { test } from "node:test";
import assert from "node:assert/strict";
import { closing, closingText } from "../src/lib/closing.js";
import { monthView } from "../src/lib/spend.js";
import { typicalBill } from "../src/lib/model.js";
import { agenda } from "../src/lib/agenda.js";

const row = (d, amt, cluster) => ({ d, m: d.slice(0, 7), amt, cat: cluster, cluster, src: "card" });

test("closing: last period against the target and limits, income, measured earnings, what the next bill carries", () => {
  const today = "2026-12-03";
  const rows = [row("2026-11-05", 400, "food"), row("2026-11-20", 500, "bills"), row("2026-12-01", 50, "food")];
  const income = [{ d: "2026-11-05", m: "2026-11", amt: 3000, kind: "salary" }, { d: "2026-11-10", m: "2026-11", amt: 100, kind: "other" }];
  const month = monthView(rows, { today, target: 700 });
  const log = [{ v: 2, d: "2026-10-31", p: { a: [1000, 900, 1, "nubank"], j: [500, 500, 1, "itau"] } }, { v: 2, d: "2026-11-30", p: { a: [1010, 900, 1, "nubank"], j: [505, 500, 1, "itau"] } }];
  const c = closing({ rows, income, month, cycles: null, target: 700, limits: { bills: 430 }, log, own: ["nubank"], bills: [{ month: "2026-12", open: true, amount: 640 }, { month: "2027-01", open: false, amount: 180 }], today });
  assert.equal(c.id, "2026-11");
  assert.deepEqual([c.start, c.end, c.spent, c.over], ["2026-11-01", "2026-11-30", 900, true]);
  assert.deepEqual(c.overGroups.map((g) => [g.id, g.over]), [["bills", 70]]);
  assert.deepEqual([c.income, c.salary, c.left], [3100, 3000, 2200]);
  assert.equal(c.earned, 10, "own banks only");
  assert.deepEqual(c.committed, { month: "2026-12", amount: 640 }, "the new cycle's own (open) bill");
  const t = closingText(c);
  assert.match(t, /Fechamento · nov\/26/);
  assert.match(t, /🔴 <b>R\$ 900<\/b> de R\$ 700\nR\$ 200 acima da meta/);
  assert.match(t, /• .* <b>R\$ \d+<\/b>  ⚠️ \+R\$ 70/);
  assert.match(t, /📈 Investimentos renderam R\$ 10/);
  assert.match(t, /🧾 A fatura deste ciclo \(\w+\) já tem R\$ \d+/);
  assert.ok(t.split("\n").every((l) => l.length < 70), "one short fact per line");
});

test("usual bill = median of the last 6 closed; future bills use it when it is more than what is posted", () => {
  const today = "2026-11-26";
  const past = [900, 1100, 1000, 5000, 950, 1050, 99].map((a, i) => ({ dueDate: `2026-${String(10 - i).padStart(2, "0")}-03`, totalAmount: a }));
  assert.equal(typicalBill(past, today), 1025);
  assert.equal(typicalBill(past.slice(0, 2), today), null, "too few bills");
  const list = agenda({
    cards: [{ bank: "nubank", name: "Nubank", due: "2026-12-03", bill: 800, typical: 1025 }],
    bills: [{ month: "2027-01", open: false, rows: [{ bank: "nubank", amount: 300 }] }, { month: "2027-02", open: false, rows: [{ bank: "nubank", amount: 2000 }] }],
    mat: { rows: [] }, today, days: 90,
  }).filter((e) => e.kind === "bill");
  assert.deepEqual(list.map((e) => [e.date, -e.amount, Boolean(e.est), e.posted ?? null]), [["2026-12-03", 800, false, null], ["2027-01-03", 1025, true, 300], ["2027-02-03", 2000, false, 2000]]);
});

test("closing in card-cycle mode: the cycle that just closed, by its closing dates", () => {
  const cycles = { closes: ["2026-10-27", "2026-11-27", "2026-12-27"] };
  const r = (d, amt, cyc) => ({ ...row(d, amt, "food"), cyc });
  const rows = [r("2026-11-01", 100, "2026-11"), r("2026-11-26", 200, "2026-11"), r("2026-11-28", 50, "2026-12")];
  const today = "2026-11-29";
  const month = monthView(rows, { today, target: 700, cycles });
  assert.equal(month.month, "2026-12");
  const c = closing({ rows, income: [], month, cycles, target: 700, today });
  assert.deepEqual([c.id, c.start, c.end, c.spent, c.cycle], ["2026-11", "2026-10-27", "2026-11-26", 300, true]);
  assert.match(closingText(c), /ciclo 27\/10 → 26\/11/);
});
