import { test } from "node:test";
import assert from "node:assert/strict";
import { pace, paceLabel } from "../src/lib/pace.js";
import { brl } from "../src/lib/format.js";

// Calendar months: in each of the last four, 600 on the 2nd and 400 on the 20th (60 % gone by day 10).
const past = ["2026-07", "2026-08", "2026-09", "2026-10"];
const rows = past.flatMap((m) => [{ d: `${m}-02`, m, amt: 600 }, { d: `${m}-20`, m, amt: 400 }]);
const month = (spent, today) => ({ month: "2026-11", start: "2026-11-01", end: "2026-11-30", length: 30, daysLeft: 30 - Number(today.slice(8)) + 1, spent, target: 1000, over: spent > 1000,
  history: [...past, "2026-11"].map((m) => ({ month: m })) });

test("pace follows the usual curve, not a straight line", () => {
  const p = pace(month(500, "2026-11-10"), { rows, today: "2026-11-10" });
  assert.equal(p.usual, 4);
  assert.equal(p.share, 0.6);
  assert.equal(p.expected, 600);
  assert.equal(p.tone, "ok");
  assert.equal(paceLabel(p, brl), "R$ 100 abaixo do ritmo");
  assert.ok(Math.abs(p.projected - 833.33) < 0.01);
  const hot = pace(month(800, "2026-11-10"), { rows, today: "2026-11-10" });
  assert.equal(hot.tone, "warn");
});

test("the contas still to come before the close come out of the daily allowance", () => {
  const snapshot = { items: [{ label: "b", accounts: [{ transactions: [{ date: "2026-11-05", amount: -50, description: "Pago A" }] }] }] };
  const monthly = [{ name: "A", day: 8, amount: 50, match: ["Pago A"] }, { name: "B", day: 25, amount: 100 }, { name: "C", day: 5, amount: 30 }];
  const renewals = [{ name: "R", date: "2026-11-28", amount: 40 }, { name: "Depois", date: "2026-12-10", amount: 99 }];
  const p = pace(month(500, "2026-11-10"), { rows, monthly, renewals, snapshot, today: "2026-11-10" });
  assert.deepEqual(p.committed.map((c) => c.name), ["B", "R"]);
  assert.equal(p.committedTotal, 140);
  assert.equal(p.free, 360);
  assert.equal(p.perDay, 360 / 21);
});

test("early in the period, or without three past periods, there is no verdict from a curve", () => {
  const early = pace(month(300, "2026-11-03"), { rows, today: "2026-11-03" });
  assert.equal(early.early, true);
  assert.equal(early.tone, "");
  assert.equal(early.projected, null);
  assert.equal(paceLabel(early, brl), "começo do ciclo");
  const linear = pace(month(500, "2026-11-15"), { rows: rows.slice(0, 4), today: "2026-11-15" });
  assert.equal(linear.usual, 0);
  assert.equal(linear.share, 0.5);
});
