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
