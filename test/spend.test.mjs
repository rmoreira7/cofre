import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRules } from "../src/lib/categorize.js";
import { spendRows, byMonth, sum, monthView, monthRange, clusterOf, CLUSTERS, isInternal } from "../src/lib/spend.js";

const rules = { format: "cofre-rules", v: 1, entities: { me: { banks: ["b1"] }, other: { banks: ["b2"] } }, entity_rules: {}, desc_rules: [], overrides: {}, learned: {} };
const compiled = compileRules(rules);
const tx = (date, amount, description, operationType = "X", category = "Eating out", status = "POSTED") => ({ date: `${date}T12:00:00Z`, amount, description, operationType, category, status });
const pulled = {
  items: [
    { label: "b1", accounts: [
      { type: "CREDIT", transactions: [tx("2026-11-02", 100, "Restaurant"), tx("2026-11-03", -30, "Refund"), tx("2026-11-04", 500, "Pagamento", "PAGAMENTO_FATURA"), tx("2026-12-01", 40, "Future")] },
      { type: "BANK", transactions: [tx("2026-11-05", -200, "Pix enviado Someone", "PIX", "Transfer - PIX"), tx("2026-11-06", -1000, "Aplicação CDB", "X", "Investments"), tx("2026-10-10", -50, "Uber", "X", "Taxi and ride-hailing"), tx("2026-11-07", 3000, "Salary")] },
    ] },
    { label: "b2", accounts: [{ type: "BANK", transactions: [tx("2026-11-05", -999, "Other entity")] }] },
    { label: "b3", error: "boom" },
  ],
};

test("spendRows keeps the entity's real spending only", () => {
  const rows = spendRows(pulled, { rules, compiled, entity: "me", today: "2026-11-23" });
  assert.deepEqual(rows.map((r) => [r.d, r.amt, r.cat, r.cluster]), [
    ["2026-11-02", 100, "Eating out", "food"],
    ["2026-11-05", 200, "PIX to people", "pix"],
    ["2026-10-10", 50, "Taxi and ride-hailing", "trans"],
  ]);
});

test("byMonth and sum", () => {
  const rows = spendRows(pulled, { rules, compiled, entity: "me", today: "2026-11-23" });
  assert.equal(sum(byMonth(rows)["2026-11"]), 300);
  assert.deepEqual(byMonth(rows, "cluster", "account")["2026-11"], { pix: 200 });
});

test("monthView: allowance, over-limit clusters, 12-month history", () => {
  const rows = [{ m: "2026-11", amt: 600, cluster: "pix" }, { m: "2026-11", amt: 400, cluster: "food" }, { m: "2026-01", amt: 10, cluster: "other" }];
  const v = monthView(rows, { today: "2026-11-21", target: 7000 });
  assert.equal(v.spent, 1000);
  assert.equal(v.daysLeft, 10);
  assert.equal(v.perDay, 600);
  assert.equal(v.clusters.find((c) => c.id === "pix").over, true);
  assert.equal(v.clusters.find((c) => c.id === "other"), undefined);
  assert.equal(v.history.length, 12);
  assert.equal(v.history[0].month, "2025-12");
  const over = monthView([{ m: "2026-11", amt: 8000, cluster: "travel" }], { today: "2026-11-30", limits: { travel: 9000 } });
  assert.equal(over.over, true);
  assert.equal(over.perDay, 0);
  assert.equal(over.clusters[0].over, false);
});

test("helpers", () => {
  assert.deepEqual(monthRange("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(clusterOf("Tobacco"), "tobacco");
  assert.equal(clusterOf("Bank fees"), "other");
  assert.equal(CLUSTERS.reduce((a, c) => a + (c.limit || 0), 0), 7000);
  assert.equal(isInternal({ operationType: "X", description: "COMPRA CDB BANCO" }, "Shopping"), true);
});
