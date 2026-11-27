import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRules } from "../src/lib/categorize.js";
import { spendRows, byMonth, sum, monthView, monthRange, clusterOf, CLUSTERS, isInternal, clusterTrends, suggestGoals } from "../src/lib/spend.js";

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
  // The 7k plan split + Saques R$ 300 (Rafael, 11-25). The phone keeps its own target and limits in Ajustes › Metas.
  assert.equal(CLUSTERS.reduce((a, c) => a + (c.limit || 0), 0), 7300);
  assert.equal(isInternal({ operationType: "X", description: "COMPRA CDB BANCO" }, "Shopping"), true);
});

test("card cycles: card rows follow their bill, account rows follow the closing dates", async () => {
  const { cardCycles, cycleOf, cycleBounds } = await import("../src/lib/spend.js");
  const card = { type: "CREDIT", bills: [{ dueDate: "2026-11-03", billClosingDate: "2026-10-27" }, { dueDate: "2026-10-05", billClosingDate: "2026-09-26" }], transactions: [
    { date: "2026-10-26T12:00:00Z", amount: 50, description: "Late Oct buy", operationType: "X", category: "Eating out", card: { billForecastDate: "2026-12" } },
    { date: "2026-11-10T12:00:00Z", amount: 70, description: "Nov buy", operationType: "X", category: "Eating out", card: { billForecastDate: "2026-12" } },
  ] };
  const bank = { type: "BANK", transactions: [
    { date: "2026-10-26T12:00:00Z", amount: -10, description: "Pix A", operationType: "PIX", category: "Transfer - PIX" },
    { date: "2026-10-28T12:00:00Z", amount: -20, description: "Pix B", operationType: "PIX", category: "Transfer - PIX" },
  ] };
  const p = { items: [{ label: "b1", accounts: [card, bank] }] };
  const cycles = cardCycles(p, { rules, entity: "me" });
  assert.deepEqual(cycles.closes, ["2026-09-26", "2026-10-27", "2026-11-27", "2026-12-27"]);
  assert.equal(cycleOf("2026-10-26", cycles), "2026-10");
  assert.equal(cycleOf("2026-10-27", cycles), "2026-11");
  assert.deepEqual(cycleBounds("2026-11", cycles), { start: "2026-10-27", end: "2026-11-27" });
  const rows = spendRows(p, { rules, compiled, entity: "me", today: "2026-11-23", cycles });
  assert.deepEqual(rows.map((r) => [r.desc, r.cyc]), [["Late Oct buy", "2026-11"], ["Nov buy", "2026-11"], ["Pix A", "2026-10"], ["Pix B", "2026-11"]]);
  const v = monthView(rows, { today: "2026-11-23", cycles });
  assert.equal(v.month, "2026-11");
  assert.equal(v.spent, 140);
  assert.equal(v.end, "2026-11-26");
  assert.equal(v.daysLeft, 4);
});

test("bill history: one source per cycle, statement refunds net, 24-month card-only series", async () => {
  const { cardCycles } = await import("../src/lib/spend.js");
  const hr = { ...rules, learned: { "grand hotel": "Accomodation" }, history: { bank: "b1", until: "2026-10", rows: [
    ["2026-09", "2026-08-30", "Grand Hotel", 900],
    ["2026-10", "2026-09-28", "Restaurant", 100],
    ["2026-10", "2026-10-05", 'Crédito de "GRAND HOTEL"', -800],
    ["2026-10", "2026-10-06", "Desconto Antecipação Shop", -5],
  ] } };
  const card = { type: "CREDIT", bills: [{ dueDate: "2026-11-03", billClosingDate: "2026-10-27" }, { dueDate: "2026-12-03", billClosingDate: "2026-11-26" }], transactions: [
    { id: "p1", date: "2026-10-20T12:00:00Z", amount: 70, description: "Partial cycle buy", operationType: "X", category: "Eating out", card: { billForecastDate: "2026-11" } },
    { id: "p2", date: "2026-11-10T12:00:00Z", amount: 40, description: "Covered buy", operationType: "X", category: "Eating out", card: { billForecastDate: "2026-12" } },
  ] };
  const bank = { type: "BANK", transactions: [{ date: "2026-11-05T12:00:00Z", amount: -30, description: "Pix A", operationType: "PIX", category: "Transfer - PIX" }] };
  const p = { items: [{ label: "b1", accounts: [card, bank] }] };
  const cycles = cardCycles(p, { rules: hr, entity: "me" });
  const rows = spendRows(p, { rules: hr, compiled: compileRules(hr), entity: "me", today: "2026-11-23", cycles });
  assert.deepEqual(rows.map((r) => [r.desc, r.cyc, r.amt, r.hist ?? false]), [
    ["Covered buy", "2026-11", 40, false],
    ["Grand Hotel", "2026-09", 900, true],
    ["Restaurant", "2026-10", 100, true],
    ['Crédito de "GRAND HOTEL"', "2026-10", -800, true],
    ["Desconto Antecipação Shop", "2026-10", -5, true], // paying early: the discount lowers the cost
    ["Pix A", "2026-11", 30, false],
  ]);
  assert.equal(rows.find((r) => r.amt === -800).cat, "Accomodation");
  const v = monthView(rows, { today: "2026-11-23", cycles });
  assert.equal(v.long.length, 24);
  assert.deepEqual(v.long.slice(-3).map((h) => [h.month, h.spent, h.cardOnly ?? false]), [["2026-09", 900, true], ["2026-10", -705, true], ["2026-11", 70, false]]);
  assert.deepEqual(v.yearAgo, null);
  assert.equal(monthView(rows.filter((r) => !r.hist), { today: "2026-11-23", cycles }).long, null);
});

test("income: salary = same-person transfer from an unconnected bank; leftover per cycle", async () => {
  const { incomeRows, leftover } = await import("../src/lib/spend.js");
  const t = (date, amount, description, category, from, op = "PIX") => ({ date: `${date}T12:00:00Z`, amount, description, operationType: op, category, status: "POSTED", ...(from ? { from } : {}) });
  const p = { items: [
    { label: "nubank", accounts: [{ type: "BANK", transactions: [
      t("2026-11-05", 7000, "Transferência Recebida|ME", "Same person transfer", "237"),
      t("2026-11-06", 3000, "Transferência Recebida|ME", "Same person transfer", "348"),
      t("2026-11-07", 500, "Resgate RDB", "Investments", null, "RESGATE_APLIC_FINANCEIRA"),
      t("2026-11-08", 120, "Pix recebido Friend", "Transfer - PIX", "1"),
      t("2026-11-09", 2, "Rendimento", "Proceeds interests and dividends", null, "RENDIMENTO_APLIC_FINANCEIRA"),
      t("2026-11-10", -100, "Pix enviado Someone", "Transfer - PIX"),
      t("2026-12-01", 9999, "Future", "Same person transfer", "237"),
    ] }] },
    { label: "xp", accounts: [{ type: "BANK", transactions: [] }] },
  ] };
  const r = { ...rules, entities: { me: { banks: ["nubank", "xp"] } } };
  const inc = incomeRows(p, { rules: r, compiled: compileRules(r), entity: "me", today: "2026-11-23" });
  assert.deepEqual(inc.map((x) => [x.amt, x.kind]), [[7000, "salary"], [120, "other"], [2, "yield"]]);
  const [m] = leftover(inc, [{ m: "2026-11", amt: 5000 }, { m: "2026-11", amt: 99, hist: true }], ["2026-11"]);
  assert.deepEqual(m, { month: "2026-11", salary: 7000, other: 122, oneOff: 0, income: 7122, spent: 5000, left: 2122, regular: 2122 });
});

test("salaryForecast: median day and amount per pay slot, a weekend moved to the Friday, skipping months already paid", async () => {
  const { salaryForecast } = await import("../src/lib/spend.js");
  const s = (d, amt) => ({ d, m: d.slice(0, 7), amt, kind: "salary", from: "237" });
  const income = [
    s("2026-08-05", 7000), s("2026-08-20", 4700), s("2026-09-05", 7200), s("2026-09-21", 4720),
    s("2026-10-06", 7277), s("2026-10-20", 4723), s("2026-11-05", 7278), s("2026-11-19", 4723),
    { d: "2026-11-10", m: "2026-11", amt: 50, kind: "other" },
  ];
  assert.deepEqual(salaryForecast(income, { today: "2026-11-23" }), [
    { date: "2026-12-04", amount: 7277, from: "237" }, // 05/12 is a Saturday → Friday
    { date: "2026-12-18", amount: 4723, from: "237" }, // 20/12 is a Sunday → Friday
  ]);
  assert.deepEqual(salaryForecast(income, { today: "2026-12-21", days: 31 }).map((x) => x.date), ["2027-01-05", "2027-01-20"], "weekdays stay");
  assert.deepEqual(salaryForecast(income.slice(0, 2), { today: "2026-11-23" }), []);
});

test("clusterTrends: per-group series over the given months, mean of all and of the last 3", () => {
  const t = clusterTrends({ "2026-01": { food: 100 }, "2026-02": { food: 400, travel: 50 }, "2026-04": { food: 700 } }, ["2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.deepEqual(t.food.series, [100, 400, 0, 700]);
  assert.equal(t.food.avg, 300);
  assert.equal(t.food.avg3, 1100 / 3);
  assert.equal(t.travel.avg, 12.5);
  assert.equal(t.food.median, 250);
  assert.equal(t.travel.median, 0);
  assert.equal(t.shop.avg, 0);
});

test("suggestGoals: 90% of income to the R$ 500, limits scaled from the medians and adding up to the target", () => {
  const trends = Object.fromEntries(CLUSTERS.map((c) => [c.id, { avg: 0, median: 0 }]));
  Object.assign(trends, { travel: { avg: 5120, median: 5120 }, food: { avg: 2814, median: 2814 }, shop: { avg: 1363, median: 1363 }, pix: { avg: 1769, median: 1769 }, serv: { avg: 1409, median: 0 }, other: { avg: 999, median: 999 } });
  const g = suggestGoals({ income: 13583, trends });
  assert.equal(g.target, 12000);
  assert.equal(g.left, 1583);
  assert.equal(Object.values(g.limits).reduce((a, b) => a + b, 0), 12000);
  assert.ok(!("other" in g.limits), "Outros has no limit");
  assert.equal(g.limits.shop, Math.round((1363 * 12000) / 11066 / 50) * 50);
  assert.ok(g.limits.travel > g.limits.food);
  assert.equal(g.limits.serv, 0, "an outlier-driven mean does not set the limit");
  assert.equal(suggestGoals({ income: 0, trends }), null);
});
