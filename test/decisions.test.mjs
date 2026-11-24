import test from "node:test";
import assert from "node:assert/strict";
import { validRenewals, upcomingRenewals, idleCost } from "../src/lib/decisions.js";

test("renewals: validated, filtered to the window ahead, nearest first", () => {
  const list = [{ name: "A", date: "2027-01-10" }, { name: "B", date: "2026-12-01", amount: 9.9 }, { name: "C", date: "2026-11-01" }];
  assert.ok(validRenewals(list));
  assert.ok(!validRenewals([{ name: "A", date: "10/01/2027" }]));
  assert.deepEqual(upcomingRenewals(list, "2026-11-24", 60).map((r) => [r.name, r.days]), [["B", 7], ["A", 47]]);
});

test("idle cost: amount × CDI per business day, null without the CDI", () => {
  assert.equal(idleCost(10000, 0.05), 5);
  assert.equal(idleCost(10000, null), null);
});
