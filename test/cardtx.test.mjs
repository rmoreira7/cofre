import { test } from "node:test";
import assert from "node:assert/strict";
import { ghostIds, cleanCard } from "../src/lib/cardtx.js";

let id = 0;
const inst = (desc, n, total, amount, date, purchaseDate, status = "POSTED") => ({ id: `t${++id}`, description: `${desc} ${n}/${total}`, amount, date: `${date}T12:00:00Z`, status, creditCardMetadata: { paymentType: "INSTALLMENT", installmentNumber: n, totalInstallments: total, purchaseDate } });

test("anticipation: earliest row per installment survives, extra copies trimmed", () => {
  const rows = [
    inst("Air Example", 1, 3, 100, "2026-05-27", "2026-05-27"), inst("Air Example", 1, 3, 100, "2026-05-27", "2026-05-27"),
    inst("Air Example", 2, 3, 100, "2026-06-01", "2026-05-27"), inst("Air Example", 2, 3, 100, "2026-06-27", "2026-05-27"),
    inst("Air Example", 3, 3, 100, "2026-06-01", "2026-05-27"), inst("Air Example", 3, 3, 100, "2026-07-27", "2026-05-27"),
  ];
  const kept = cleanCard(rows);
  assert.deepEqual(kept.map((t) => [t.creditCardMetadata.installmentNumber, t.date.slice(0, 10)]), [[1, "2026-05-27"], [2, "2026-06-01"], [3, "2026-06-01"]]);
});

test("reversed purchase: refunds of installment 1 cancel that many copies", () => {
  const rows = [];
  for (const copy of [0, 1]) for (let n = 1; n <= 3; n++) rows.push(inst("Shop Example", n, 3, n === 1 ? 33.34 : 33.33, n === 1 ? "2026-07-20" : `2026-0${7 + n}-20`, "2026-07-20", n === 1 ? "POSTED" : "PENDING"));
  const refunds = [{ id: "r1", description: "Estorno de compra", amount: -33.34, date: "2026-07-21T12:00:00Z" }, { id: "r2", description: "Estorno de compra", amount: -33.34, date: "2026-07-21T12:00:00Z" }];
  const g = ghostIds([...rows, ...refunds]);
  assert.equal(g.size, 4);
  assert.ok(rows.filter((t) => t.creditCardMetadata.installmentNumber === 1).every((t) => !g.has(t.id)));
  const one = ghostIds([...rows, refunds[0]]);
  assert.equal(one.size, 2);
});

test("genuine plans and late refunds are untouched", () => {
  const rows = [inst("Store Example", 1, 2, 50, "2026-09-01", "2026-09-01"), inst("Store Example", 2, 2, 50, "2026-10-01", "2026-09-01", "PENDING")];
  const late = { id: "r9", description: "Estorno de compra", amount: -50, date: "2026-09-20T12:00:00Z" };
  assert.equal(ghostIds([...rows, late]).size, 0);
  const noFirst = [inst("Old Example", 5, 6, 10, "2026-11-01", "2026-06-01"), inst("Old Example", 6, 6, 10, "2026-12-01", "2026-06-01", "PENDING")];
  assert.equal(ghostIds(noFirst).size, 0);
});

test("refunds net against the charge they reverse, in its category", async () => {
  const { refundMatches } = await import("../src/lib/cardtx.js");
  const { compileRules } = await import("../src/lib/categorize.js");
  const { spendRows } = await import("../src/lib/spend.js");
  const t = (id, date, amount, description, category = "Eating out", operationType = "X") => ({ id, date: `${date}T12:00:00Z`, amount, description, category, operationType, status: "POSTED" });
  const txs = [
    t("a", "2026-01-01", 10, "Opening buy"),
    t("old", "2026-01-20", -99, "Estorno de compra", "Shopping"),
    t("c1", "2026-03-10", 50, "Shoe Store", "Clothing"),
    t("i1", "2026-03-11", 3.5, "IOF de compra internacional", "Tax on financial operations"),
    t("ir", "2026-03-10", -3.5, "IOF de volta de Shoe Store", "Clothing"),
    t("cr", "2026-03-20", -50, "Estorno de compra", "Shopping"),
    t("ur", "2026-03-21", -7, "Estorno de Fancy Cab - NuPay", "Transfers"),
    t("pay", "2026-03-25", -500, "Pagamento recebido", "Transfers", "PAGAMENTO_FATURA"),
  ];
  const m = refundMatches(txs);
  const byId = (id) => [...m].find(([r]) => r.id === id);
  assert.equal(byId("old"), undefined);
  assert.equal(byId("ir")[1].id, "i1");
  assert.equal(byId("cr")[1].id, "c1");
  assert.equal(byId("ur")[1], null);
  assert.equal(byId("pay"), undefined);
  const rules = { format: "cofre-rules", v: 1, entities: { me: { banks: ["b"] } }, entity_rules: {}, desc_rules: [], overrides: {}, learned: { "fancy cab": "Taxi and ride-hailing" } };
  const rows = spendRows({ items: [{ label: "b", accounts: [{ type: "CREDIT", transactions: txs }] }] }, { rules, compiled: compileRules(rules), entity: "me", today: "2026-12-31" });
  const net = {};
  for (const r of rows) net[r.cat] = (net[r.cat] || 0) + r.amt;
  assert.deepEqual(net, { "Eating out": 10, Clothing: 0, "Tax on financial operations": 0, "Taxi and ride-hailing": -7 });
});
