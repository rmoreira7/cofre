import { test } from "node:test";
import assert from "node:assert/strict";
import { shortIssuer, rateLabel, nextDue, holdings, maturities, slim } from "../src/lib/model.js";

test("shortIssuer", () => {
  assert.deepEqual(["ALFA S.A.- CREDITO", "BRB S.A.", "BANCO GAMMA S.A.", "NU FINANCEIRA S.A. - SCFI", "BANCO DELTA S/A", "EPSILON SA CREDITO"].map(shortIssuer),
    ["Alfa", "BRB", "Gamma", "Nubank", "Delta", "Epsilon"]);
});

test("rateLabel", () => {
  assert.equal(rateLabel({ rateType: "CDI", rate: 110 }), "110% CDI");
  assert.equal(rateLabel({ fixedAnnualRate: 15.41 }), "15,41% a.a.");
  assert.equal(rateLabel({}), "–");
});

test("nextDue rolls a past due date forward monthly", () => {
  assert.equal(nextDue("2026-11-03", "2026-11-23"), "2026-12-03");
  assert.equal(nextDue("2026-11-30", "2026-11-23"), "2026-11-30");
  assert.equal(nextDue("2026-01-31", "2026-02-10"), "2026-02-28");
  assert.equal(nextDue(null, "2026-11-23"), null);
});

const rules = { entities: { me: { banks: ["xp", "mp"] }, mom: { banks: ["itau"] } } };
const pulled = {
  at: "2026-11-23T10:00:00Z",
  items: [
    { label: "xp", item: { status: "UPDATED" }, accounts: [{ id: "a", type: "BANK", balance: 100, transactions: [] }],
      investments: [
        { status: "ACTIVE", issuer: "BANCO GAMMA S.A.", balance: 600, rateType: "CDI", rate: 120, dueDate: "2027-01-10T00:00:00Z" },
        { status: "ACTIVE", issuer: "BANCO GAMMA S.A.", balance: 100, rateType: "CDI", rate: 110, dueDate: "2027-01-10T00:00:00Z" },
        { status: "ACTIVE", issuer: "BRB S.A.", balance: 200, rateType: "CDI", rate: 109, dueDate: "2027-03-03T00:00:00Z" },
        { status: "ACTIVE", issuer: "BANCO DELTA S/A", balance: 100, fixedAnnualRate: 12, dueDate: "2026-12-01T00:00:00Z" },
        { status: "TOTAL_WITHDRAWAL", issuer: "OLD", balance: 0 },
      ] },
    { label: "mp", item: { status: "UPDATED" }, accounts: [{ id: "b", type: "BANK", balance: 0, transactions: [], bankData: { reservedBalances: [{ name: "Cofrinho", availableAmounts: [{ amount: 50, remuneration: { postFixedIndexerPercentage: 1.4 } }] }] } }], investments: [] },
    { label: "itau", item: { status: "UPDATED" }, accounts: [{ id: "c", type: "BANK", balance: 999, transactions: [] }], investments: [] },
    { label: "neon", error: "boom" },
  ],
};

test("holdings: invested + reserved + checking per entity; joint never mixed in", () => {
  const s = slim(pulled);
  assert.equal(s.items[0].investments.length, 4);
  const h = holdings(s, rules, "me");
  assert.equal(h.total, 1000 + 100 + 50);
  assert.equal(holdings(s, rules, "mom").total, 999);
  assert.equal(h.banks.find((b) => b.label === "mp").reserved[0].rate, "140% CDI");
});

test("maturities: grouped, tagged, concentration and BRB", () => {
  const m = maturities(holdings(slim(pulled), rules, "me"), "2026-11-23");
  assert.deepEqual(m.rows.map((r) => [r.due, r.issuer, r.n, r.tag]), [
    ["2026-12-01", "Delta", 1, null],
    ["2027-01-10", "Gamma", 2, "conc"],
    ["2027-03-03", "BRB", 1, "brb"],
  ]);
  assert.equal(m.brbLast, "2027-03-03");
  assert.deepEqual(m.conc.map((c) => [c.issuer, c.share]), [["Gamma", 0.7]]);
  assert.equal(m.liquid.length, 1);
});

test("openBill: forecast month charges minus early payments; installments ahead", async () => {
  const { openBill } = await import("../src/lib/model.js");
  const t = (amount, f, op = "X") => ({ amount, operationType: op, card: { billForecastDate: f } });
  const acc = {
    balance: 1500,
    bills: [{ dueDate: "2026-11-03T00:00:00Z", totalAmount: 600 }],
    transactions: [t(900, "2026-12"), t(-50, "2026-12"), t(-600, "2026-12", "PAGAMENTO_FATURA"), t(-200, "2026-12", "PAGAMENTO_FATURA"), t(300, "2027-01"), t(100, "2027-02"), t(400, "2026-11")],
  };
  assert.deepEqual(openBill(acc, "2026-12-03"), { bill: 650, charges: 850, early: 200, ahead: 400, exact: true });
  assert.deepEqual(openBill({ balance: 46, transactions: [{ amount: 46 }] }, "2026-12-01"), { bill: 46, ahead: 0, exact: false });
});

test("openBill falls back to the balance when nothing is tagged for the bill", async () => {
  const { openBill } = await import("../src/lib/model.js");
  const acc = { balance: 46, bills: [], transactions: [{ amount: 46, operationType: "X", card: { billForecastDate: "2026-09" } }] };
  assert.deepEqual(openBill(acc, "2026-12-01"), { bill: 46, ahead: 0, exact: false });
});

test("freshness and auto-refresh follow Pluggy's daily sync", async () => {
  const { freshness, shouldAutoRefresh } = await import("../src/lib/model.js");
  const snap = { at: "2026-11-23T14:00:00Z", items: [
    { label: "a", item: { status: "UPDATED", resourcesCollectedAt: "2026-11-22T22:12:00Z", nextAutoSyncAt: "2026-11-23T22:12:00Z" }, accounts: [], investments: [] },
    { label: "b", item: { status: "UPDATED", resourcesCollectedAt: "2026-11-22T20:14:00Z", nextAutoSyncAt: "2026-11-23T20:14:00Z" }, accounts: [], investments: [] },
  ] };
  assert.deepEqual(freshness(snap), { bankAt: "2026-11-22T20:14:00Z", nextSync: "2026-11-23T20:14:00Z", pulledAt: snap.at });
  assert.equal(shouldAutoRefresh(snap, new Date("2026-11-23T18:00:00Z")), false);
  assert.equal(shouldAutoRefresh(snap, new Date("2026-11-23T20:30:00Z")), true);
  assert.equal(shouldAutoRefresh({ ...snap, at: "2026-11-23T20:40:00Z" }, new Date("2026-11-23T21:00:00Z")), false);
  assert.equal(shouldAutoRefresh(snap, new Date("2026-11-24T15:00:00Z")), true);
  assert.equal(shouldAutoRefresh(null), true);
});

test("alerts: bill soon, maturity soon, idle cash; ranked", async () => {
  const { alerts } = await import("../src/lib/model.js");
  const bank = (name, checking) => ({ name, checking });
  const v = {
    today: "2026-11-23",
    mine: { banks: [bank("A", 700), bank("B", 9000)] },
    joint: [{ holdings: { banks: [bank("J", 87000)] } }],
    mat: { rows: [{ issuer: "Alfa", n: 1, due: "2026-12-08", days: 15, balance: 2000, tag: null }, { issuer: "BRB", n: 3, due: "2027-03-03", days: 100, balance: 9, tag: "brb" }] },
    cards: [{ name: "Card", due: "2026-11-26", bill: 500 }, { name: "Late", due: "2026-12-20", bill: 10 }],
  };
  const a = alerts(v, { idleCash: 5000 });
  assert.deepEqual(a.map((x) => [x.kind, x.bank || x.issuer, x.scope || ""]), [["bill", "Card", ""], ["maturity", "Alfa", "mine"], ["idle", "J", "joint"], ["idle", "B", "mine"]]);
});

test("installmentsAhead: months after the open bill, grouped by plan", async () => {
  const { installmentsAhead } = await import("../src/lib/model.js");
  const t = (desc, amount, f, n, purchaseDate = "2026-11-07") => ({ description: desc, amount, operationType: "X", card: { paymentType: "INSTALLMENT", billForecastDate: f, installmentNumber: n, totalInstallments: 3, purchaseDate } });
  const snap = { items: [{ label: "nu", accounts: [{ type: "CREDIT", credit: { balanceDueDate: "2026-11-03" }, transactions: [
    t("Trip Example 1/3", 100, "2026-12", 1), t("Trip Example 2/3", 100, "2027-01", 2), t("Trip Example 3/3", 100, "2027-02", 3),
    t("Shop Example 2/3", 30, "2027-01", 2, "2026-10-01"), { description: "single", amount: 50, operationType: "X", card: { paymentType: "SINGLE", billForecastDate: "2027-01" } },
  ] }] }] };
  const r = installmentsAhead(snap, { entities: { me: { banks: ["nu"] } } }, "me", "2026-11-23");
  assert.deepEqual(r.months, [{ month: "2027-01", amount: 130 }, { month: "2027-02", amount: 100 }]);
  assert.equal(r.total, 230);
  assert.deepEqual(r.plans.map((p) => [p.name, p.left, p.per, p.last]), [["Trip Example", 2, 100, "2027-02"], ["Shop Example", 1, 30, "2027-01"]]);
});

test("maturities: Nubank's self-renewing daily-liquidity positions stay out of the ladder", () => {
  const bank = (label, issuer, due, balance) => ({ label, invested: balance, reserved: [], positions: [{ issuer, due, balance, rate: "100% CDI" }] });
  const m = maturities({ banks: [bank("nubank", "Nubank", "2027-01-01", 100), bank("other", "Acme", "2027-02-01", 50)] }, "2026-11-23");
  assert.deepEqual(m.rows.map((r) => [r.bank, r.due]), [["other", "2027-02-01"]]);
  assert.equal(m.total, 50);
});

test("mergeLadders: joint rows flagged and sorted in, totals kept apart, BRB = latest of both", async () => {
  const { mergeLadders } = await import("../src/lib/model.js");
  const own = { rows: [{ due: "2027-02-01", balance: 50 }], liquid: [], conc: [], brbLast: "2027-01-01", total: 50 };
  const joint = { rows: [{ due: "2027-01-15", balance: 80 }, { due: "2028-01-01", balance: 20 }], liquid: [{ balance: 5 }], conc: [{ issuer: "X", share: 0.6 }], brbLast: null, total: 100 };
  const m = mergeLadders(own, [joint]);
  assert.deepEqual(m.rows.map((r) => [r.due, r.joint ?? false]), [["2027-01-15", true], ["2027-02-01", false], ["2028-01-01", true]]);
  assert.equal(m.total, 50);
  assert.equal(m.jointTotal, 100);
  assert.equal(m.brbLast, "2027-01-01");
  assert.equal(m.conc[0].joint, true);
  assert.equal(m.liquid[0].joint, true);
});

test("Wise: balance-only (transactions dropped), foreign balances in BRL at the snapshot's rates", async () => {
  const { slim, holdings, toBRL } = await import("../src/lib/model.js");
  const r = { ...rules, entities: { me: { banks: ["wise"] } } };
  const s = slim({ at: "x", items: [{ label: "wise", item: {}, investments: [], accounts: [
    { id: "u", type: "BANK", balance: 100, currencyCode: "USD", transactions: [{ id: "t", date: "2026-11-01T00:00:00Z", amount: 50, description: "Money added", operationType: "X" }] },
    { id: "b", type: "BANK", balance: 7.5, currencyCode: "BRL", transactions: [] },
  ] }] });
  assert.equal(s.items[0].accounts[0].transactions.length, 0);
  assert.equal(holdings(s, r, "me").total, 7.5);
  s.fx = { USD: 5.9 };
  const h = holdings(s, r, "me");
  assert.equal(Math.round(h.total * 100) / 100, 597.5);
  assert.deepEqual(h.banks[0].foreign, [{ currency: "USD", amount: 100, brl: 590 }]);
  assert.equal(toBRL(10, "EUR", { USD: 5 }), 0);
});
