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
  assert.deepEqual(x.brackets.map((b) => b.rate), [0, 0.15]); // every bank in the split, the joint one too
  assert.equal(x.all.n, 3);
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
  assert.deepEqual(log[0].p, { p1: [850.12, 800, null, "bank_a"] });
  log = logPositions([{ v: 2, d: "2025-01-01", p: {} }, { d: "2026-11-20", p: {} }, ...log], snap, "2026-11-25");
  assert.deepEqual(log.map((e) => e.d), ["2026-11-24", "2026-11-25"]);
  assert.deepEqual(logPositions([], { items: [] }, "2026-11-25"), []);
});

test("without today's CDI, CDI positions are not reported as unpriced", () => {
  const x = income({ items: [{ label: "bank_a", accounts: [], investments: [cdb({ balance: 850 }), { id: "f", subtype: "FIXED_INCOME_FUND", balance: 100 }] }] }, rules, null);
  assert.equal(x.own.unrated, 1);
});

import { earned, earnedSteps } from "../src/lib/income.js";

test("earned: held → balance change; a partial withdrawal is scaled out, not a loss; new → balance − cost", () => {
  assert.equal(earned([100, 90, 10], [101, 90, 10]), 1);
  near(earned([100, 90, 10], [50.6, 45, 5]), 0.6);
  assert.equal(earned(undefined, [105, 100, 1]), 5);
  assert.equal(earned(undefined, [105, 0, 1]), 0);
  assert.equal(earned([100, 90, null], [101, 90, null]), 1);
  assert.equal(earned([100, 90, 1], undefined), 0);
});

test("earnedSteps sums per bank between entries; unknown positions are skipped", () => {
  const log = [{ d: "a", p: { x: [100, 90, 10], y: [10, 10, 1] } }, { d: "b", p: { x: [50.6, 45, 5], y: [10.1, 10, 1], z: [20, 20, 1], q: [5, 1, 1] } }];
  const st = earnedSteps(log, (id) => ({ x: "bank_a", y: "bank_a", z: "bank_b" })[id]);
  assert.equal(st.length, 1);
  near(st[0].banks.bank_a, 0.7);
  assert.equal(st[0].banks.bank_b, 0);
});

import { businessDays, mergeLog, monthlyHistory } from "../src/lib/income.js";

test("business days skip weekends and national holidays", () => {
  assert.equal(businessDays("2026-11-06", "2026-11-24"), 11); // 15/11 is a Sunday; 20/11 (Consciência Negra) a holiday
  assert.equal(businessDays("2026-11-23", "2026-11-23"), 0);
  assert.equal(businessDays("2026-12-24", "2026-12-28"), 1); // 25 holiday, 26–27 weekend
});

test("mergeLog: one entry per day, the app's own entry wins, old-format entries dropped", () => {
  const seed = [{ v: 2, d: "2026-11-06", p: { a: [1, 1, 1, "x"] } }, { v: 2, d: "2026-11-10", p: { a: [2, 1, 1, "x"] } }];
  const own = [{ v: 2, d: "2026-11-10", p: { a: [3, 1, 1, "x"] } }, { d: "2026-11-11", p: {} }];
  const m = mergeLog(seed, own);
  assert.deepEqual(m.map((e) => e.d), ["2026-11-06", "2026-11-10"]);
  assert.equal(m[1].p.a[0], 3);
});

test("monthlyHistory: steps grouped by the month they end in, estimate for the same business days", () => {
  const log = [
    { v: 2, d: "2026-11-06", p: { a: [1000, 900, 10, "x"], j: [500, 500, 1, "y"] } },
    { v: 2, d: "2026-11-24", p: { a: [1010, 900, 10, "x"], j: [502, 500, 1, "y"], k: [5000, 5000, 1, "y"] } },
    { v: 2, d: "2026-12-01", p: { a: [1013, 900, 10, "x"], j: [503, 500, 1, "y"], k: [5010, 5000, 1, "y"] } },
  ];
  const h = monthlyHistory(log, { x: 21, y: 42 });
  assert.deepEqual(h.map((m) => m.month), ["2026-11", "2026-12"]);
  assert.equal(h[0].partial, true);
  assert.equal(h[1].partial, false);
  assert.equal(h[0].bd, 11);
  assert.equal(h[0].banks.x.measured, 10);
  assert.equal(h[0].banks.x.estimated, 11); // 21/month × 11 of 21 business days
  assert.equal(h[0].banks.y.estimated, null); // most of y's money at the end was bought mid-period
  assert.equal(h[1].banks.y.measured, 11);
  assert.notEqual(h[1].banks.y.estimated, null);
});

import { maturityEarnings } from "../src/lib/income.js";
test("maturityEarnings: invested, receita after tax, yearly rate, IR bracket and the estimate to the due date", () => {
  const r = { due: "2026-12-08", parts: [{ balance: 900, orig: 750, tax: 30, bought: "2025-08-29", cdi: 125, subtype: "CDB" }] };
  const e = maturityEarnings(r, "2026-11-24", 0.055);
  assert.equal(e.orig, 750); assert.equal(e.gain, 150); assert.equal(e.tax, 30);
  assert.ok(Math.abs(e.pct - 0.2) < 1e-9);
  assert.equal(e.bracket, 0.175); // 466 days held to maturity
  assert.ok(e.yearly > 0.15 && e.yearly < 0.16);
  assert.equal(e.est.days, 10);
  assert.ok(e.est.gain > 150 && e.est.gain < 160);
});
test("maturityEarnings: several bonds add up; a missing invested amount means no line; exempt and past due", () => {
  const two = maturityEarnings({ due: "2027-01-10", parts: [{ balance: 500, orig: 400, tax: 0, bought: "2025-01-02", subtype: "LCA" }, { balance: 300, orig: 250, tax: 0, bought: "2025-03-01", subtype: "LCA" }] }, "2026-11-24", null);
  assert.equal(two.orig, 650); assert.equal(two.gain, 150); assert.equal(two.bracket, 0);
  assert.equal(two.yearly, null); assert.equal(two.bought, null); assert.equal(two.earliest, "2025-01-02"); assert.equal(two.est, null);
  assert.equal(maturityEarnings({ due: "2027-01-10", parts: [{ balance: 500, orig: null }] }, "2026-11-24"), null);
  assert.equal(maturityEarnings({ due: "2026-11-20", parts: [{ balance: 500, orig: 400, cdi: 100, bought: "2025-01-02" }] }, "2026-11-24", 0.05).est, null);
});
