import { test } from "node:test";
import assert from "node:assert/strict";
import { ladder, RUNGS } from "../src/lib/ladder.js";

test("ladder: rungs today, a split per maturity (one slice per ~R$ 7k, at most 4), better balance at the horizon", () => {
  const rows = [
    { due: "2026-12-10", balance: 30000, issuer: "Big", tag: "brb" },
    { due: "2027-01-10", balance: 2000, issuer: "Small" },
    { due: "2028-06-01", balance: 10000, issuer: "Far" },
    { due: "2030-01-01", balance: 10000, issuer: "Farther" },
    { due: "2026-11-01", balance: 999, issuer: "Past" },
  ];
  const l = ladder(rows, { today: "2026-11-23" });
  assert.equal(l.total, 52000);
  assert.equal(l.now.length, RUNGS.length);
  assert.deepEqual(l.now.map((r) => Math.round(r.amount)), [32000, 0, 0, 10000, 0, 10000]);
  assert.deepEqual(l.plan.map((p) => [p.due, p.buys.length, Math.round(p.buys.reduce((a, b) => a + b.amount, 0))]), [["2026-12-10", 4, 30000], ["2027-01-10", 1, 2000]]);
  assert.equal(l.plan[0].brb, true);
  assert.ok(Math.max(...l.with) < Math.max(...l.without));
});
