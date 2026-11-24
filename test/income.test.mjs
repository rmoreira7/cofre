import test from "node:test";
import assert from "node:assert/strict";
import { bracket, taxRate, annualRate, income, cdbEquivalent, logPositions, cdiAnnual } from "../src/lib/income.js";

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const rules = { entities: { me: { banks: ["bank_a"] }, other: { banks: ["bank_j"] } } };
const cdb = (o) => ({ id: o.id || "x", subtype: "CDB", rateType: "CDI", rate: 110, purchaseDate: "2026-01-01", dueDate: "2029-01-01", ...o });

test("IR brackets by days held", () => {
  assert.deepEqual([180, 181, 360, 361, 720, 721].map(bracket), [0.225, 0.2, 0.2, 0.175, 0.175, 0.15]);
});

test("the tax rate follows the position's own term; exempt subtypes and flags pay none", () => {
  assert.equal(taxRate(cdb({ purchaseDate: "2026-01-01", dueDate: "2026-05-01" })), 0.225);
  assert.equal(taxRate(cdb({})), 0.15);
  assert.equal(taxRate(cdb({ subtype: "LCA" })), 0);
  assert.equal(taxRate(cdb({ subtype: "CRA" })), 0);
  assert.equal(taxRate(cdb({ taxExempt: true })), 0);
  assert.equal(taxRate(cdb({ dueDate: null })), 0.15);
});

test("annual rate: % of CDI on today's CDI, fixed rates as they are, IPCA and funds unpriced", () => {
  near(annualRate(cdb({ rate: 100 }), 0.05), cdiAnnual(0.05), 1e-12);
  near(annualRate(cdb({ rate: 110 }), 0.05), (1 + 0.00055) ** 252 - 1, 1e-12);
  assert.equal(annualRate({ rateType: "PRE", fixedAnnualRate: 12 }, 0.05), 0.12);
  assert.equal(annualRate({ rateType: "IPCA", fixedAnnualRate: 6 }, 0.05), null);
  assert.equal(annualRate({ subtype: "FIXED_INCOME_FUND" }, 0.05), null);
  assert.equal(annualRate(cdb({}), null), null);
});

test("income: balance is net, gain = balance − invested, gross value adds the withheld taxes", () => {
  const snap = { items: [
    { label: "bank_a", accounts: [], investments: [cdb({ balance: 850, amountOriginal: 800, taxes: 10, taxes2: 0 }), { id: "f", subtype: "FIXED_INCOME_FUND", balance: 100 }] },
    { label: "bank_j", accounts: [], investments: [cdb({ id: "j", subtype: "LCA", balance: 500, amountOriginal: 500 })] },
  ] };
  const x = income(snap, rules, 0.05);
  assert.equal(x.own.n, 2);
  assert.equal(x.own.gain, 50); // the fund has no invested amount: left out, not counted as all gain
  assert.equal(x.own.tax, 10);
  assert.equal(x.own.unrated, 1);
  const month = 860 * ((1 + annualRate(cdb({}), 0.05)) ** (1 / 12) - 1);
  near(x.own.gross, month);
  near(x.own.net, month * 0.85);
  assert.equal(x.joint.n, 1);
  near(x.joint.net, x.joint.gross); // LCA: exempt
  assert.equal(x.banks.find((b) => b.label === "bank_j").joint, true);
  assert.deepEqual(x.brackets.map((b) => b.rate), [0.15]); // the joint account stays out of the own split
});

test("no CDI → no monthly estimate, the rest still adds up", () => {
  const x = income({ items: [{ label: "bank_a", accounts: [], investments: [cdb({ balance: 850, amountOriginal: 800, taxes: 10 })] }] }, rules, null);
  assert.equal(x.own.net, 0);
  assert.equal(x.own.gain, 50);
  assert.equal(x.cdiAnnual, null);
});

test("exempt-vs-CDB yardstick", () => {
  near(cdbEquivalent(88, 0.15), 103.53);
  near(cdbEquivalent(88, 0.175), 106.67);
});

test("the position log keeps one entry per day, drops old days and failed banks", () => {
  const snap = { items: [{ label: "bank_a", investments: [cdb({ id: "p1", balance: 850.123, amountOriginal: 800 })] }, { label: "bank_b", error: "x" }] };
  let log = logPositions([], snap, "2026-11-24");
  log = logPositions(log, snap, "2026-11-24");
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].p, { p1: [850.12, 800] });
  log = logPositions([{ d: "2025-01-01", p: {} }, ...log], snap, "2026-11-25");
  assert.deepEqual(log.map((e) => e.d), ["2026-11-24", "2026-11-25"]);
  assert.deepEqual(logPositions([], { items: [] }, "2026-11-25"), []);
});

test("without today's CDI, CDI positions are not reported as unpriced", () => {
  const x = income({ items: [{ label: "bank_a", accounts: [], investments: [cdb({ balance: 850 }), { id: "f", subtype: "FIXED_INCOME_FUND", balance: 100 }] }] }, rules, null);
  assert.equal(x.own.unrated, 1);
});
