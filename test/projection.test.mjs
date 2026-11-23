import { test } from "node:test";
import assert from "node:assert/strict";
import { project, incomeAt, monthlyYield, validParams, assumptions } from "../src/lib/projection.js";

// Fictional parameters; the real ones only exist in the imported rules file.
const p = { salary: [{ from: "2020-01", net: 1000 }, { from: "2031-01", net: 2000 }], thirteenth: { months: [11, 12], share: 0.5 }, vacation: { month: 1, amount: 300, from_year: 2031 }, cdi: { 2030: 10, 2031: 12 }, cdi_pct: 100, ir: 20 };

test("income: salary steps, split 13th, vacation from its year", () => {
  assert.equal(incomeAt(p, 2030, 6), 1000);
  assert.equal(incomeAt(p, 2030, 11), 1500);
  assert.equal(incomeAt(p, 2031, 1), 2300);
  assert.equal(incomeAt(p, 2031, 12), 3000);
});

test("yield: net of IR, last known CDI carries forward", () => {
  assert.ok(Math.abs(monthlyYield(p, 2030) - (1.1 ** (1 / 12) - 1) * 0.8) < 1e-12);
  assert.equal(monthlyYield(p, 2035), monthlyYield(p, 2031));
});

test("project: zero yield and zero income just subtracts spending", () => {
  const flat = { salary: [{ from: "2000-01", net: 0 }], cdi: { 2030: 0 }, cdi_pct: 100, ir: 0 };
  const r = project(flat, { start: 10000, today: "2030-10-15", spend: 100, untilYear: 2031 });
  assert.equal(r.byYear[2030], 10000 - 200);
  assert.equal(r.byYear[2031], 10000 - 200 - 1200);
  assert.equal(r.path[0].month, "2030-11");
});

test("project: spending less always ends higher", () => {
  const a = project(p, { start: 5000, today: "2030-06-10", spend: 500, untilYear: 2031 }).byYear[2031];
  const b = project(p, { start: 5000, today: "2030-06-10", spend: 900, untilYear: 2031 }).byYear[2031];
  assert.ok(a > b);
});

test("validParams and assumptions", () => {
  assert.ok(validParams(p));
  assert.ok(!validParams({ salary: [] }));
  assert.match(assumptions(p), /R\$ 2 mil a partir de jan\/31 · 13º e férias investidos · ~100% CDI \(10% em 2030, 12% em 2031\) · IR 20%/);
});
