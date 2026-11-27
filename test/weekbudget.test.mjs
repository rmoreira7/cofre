import { test } from "node:test";
import assert from "node:assert/strict";
import { weekBudget } from "../src/lib/pace.js";
import { render } from "../src/screens/home/summary.js";

const month = { month: "2026-12", start: "2026-11-26", end: "2026-12-25", spent: 2000, target: 7000 };
const row = (d, amt, o = {}) => ({ d, amt, cyc: "2026-12", m: d.slice(0, 7), ...o });
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);

test("the week starts at the cycle's first day, its budget is that share of what was free, and its purchases spend it", () => {
  // Fri 27/11: the week is Thu 26 → Sun 29 (4 of the cycle's 30 days); 3000 free now, 600 spent this week → 3600 free at its start
  const w = weekBudget(month, { free: 3000 }, [row("2026-11-26", 400), row("2026-11-27", 200), row("2026-11-20", 999, { cyc: "2026-11" }), row("2026-11-28", 50, { ahead: true })], { today: "2026-11-27", cycles: true });
  assert.deepEqual([w.start, w.end, w.days], ["2026-11-26", "2026-11-29", 4]);
  near(w.spent, 600);
  near(w.budget, (3600 * 4) / 30);
  near(w.left, 480 - 600);
  assert.equal(w.after.weeks, 4); // 26 days after Sunday
  near(w.after.perWeek, 3000 / (26 / 7)); // nothing left this week: all that is free goes to the next ones
});

test("a full week mid-cycle, the last week cut at the close, and no room left", () => {
  const mid = weekBudget(month, { free: 2800 }, [row("2026-12-01", 200)], { today: "2026-12-02", cycles: true });
  assert.deepEqual([mid.start, mid.end, mid.days], ["2026-11-30", "2026-12-06", 7]);
  near(mid.budget, (3000 * 7) / 26);
  const last = weekBudget(month, { free: 500 }, [], { today: "2026-12-23", cycles: true });
  assert.deepEqual([last.end, last.after], ["2026-12-25", null]);
  near(last.budget, 500);
  const none = weekBudget(month, { free: -300 }, [row("2026-12-01", 100)], { today: "2026-12-02", cycles: true });
  assert.equal(none.over, true);
  assert.equal(none.by, 300);
});

test("Início shows the week under the cycle", () => {
  const v = { month: { ...month, cycle: true, daysLeft: 29 }, pace: { free: 3000, perDay: 100, tone: "", early: true, committedTotal: 0 },
    week: { start: "2026-11-30", end: "2026-12-06", days: 7, budget: 900, spent: 300, left: 600, after: { perWeek: 950, weeks: 3 } } };
  const html = render({ v: { ...v, cards: [], mat: { rows: [] }, wealth: { total: 0, banks: [] }, income: null, timeline: [], recurring: [], agenda: [], projects: [] }, board: { open: [] } });
  assert.match(html, /Esta semana · seg 30 → dom 6/);
  assert.match(html, /<b>R\$ 300<\/b> <span class="muted">de R\$ 900<\/span>/);
  assert.match(html, /sobram <b class="ink">R\$ 600<\/b> até domingo · depois ~R\$ 950\/semana \(3 semanas\)/);
});
