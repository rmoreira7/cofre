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

test("reality: projection from the start date vs actual, same banks only; interpolated between month ends", async () => {
  const { reality } = await import("../src/lib/projection.js");
  const p = { salary: [{ from: "2026-01", net: 10000 }], cdi: { 2026: 12, 2027: 12 }, cdi_pct: 100, ir: 0 };
  const series = [
    { d: "2026-11-10", banks: { a: 900 } },
    { d: "2026-11-16", banks: { a: 1000, b: 100 } },
    { d: "2026-11-23", banks: { a: 1010, b: 100, w: 500 } },
    { d: "2026-12-31", banks: { a: 9000, b: 100 } },
  ];
  const r = reality(p, series, { spend: 5000, from: "2026-11-15", today: "2026-11-23" });
  assert.equal(r.from, "2026-11-16");
  assert.deepEqual(r.banks, ["a", "b"]);
  assert.equal(r.start, 1100);
  assert.equal(r.today.real, 1110);
  assert.deepEqual(r.extra, ["w"]);
  assert.ok(r.today.projected > 1100 && r.today.projected < 1110);
  assert.equal(r.actual.length, 2);
  const dec = r.knots.find((k) => k.d === "2026-12-31");
  assert.ok(Math.abs(dec.v - (r.knots[1].v * (1 + ((1.12) ** (1 / 12) - 1)) + 10000 - 5000)) < 1e-6);
});
