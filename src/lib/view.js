// The view: everything the screens show, derived from the vault's data once per data change. Pure (no DOM), so the
// screens can be rendered against it in tests.
import { compileRules } from "./categorize.js";
import { spendRows, incomeRows, leftover, salaryForecast, monthView, byMonth, sum, monthRange, cardCycles, BANK_CODES, DEFAULT_TARGET, clusterTrends, suggestGoals } from "./spend.js";
import { holdings, cards, maturities as maturityLadder, fgc, primaryEntity, alerts, installmentsAhead, billMonths } from "./model.js";
import { daysBetween } from "./format.js";
import { agenda, cashOf } from "./agenda.js";
import { listsOf } from "./lists.js";
import { closing, period } from "./closing.js";
import { pace } from "./pace.js";
import { recurring } from "./recurring.js";
import { income as investIncome, mergeLog, monthlyHistory, maturityEarnings } from "./income.js";

export function buildView(data, today) {
  const rules = data.rules;
  const compiled = compileRules(rules, data.userOverrides || {});
  const snap = data.snapshot;
  const s = data.settings || {};
  const me = primaryEntity(rules);
  const lists = listsOf(data);
  const cycles = s.monthMode === "calendar" ? null : cardCycles(snap, { rules, entity: me });
  const rows = spendRows(snap, { rules, compiled, entity: me, today, cycles });
  const mine = holdings(snap, rules, me);
  const month = monthView(rows, { today, target: s.target ?? DEFAULT_TARGET, limits: s.limits || {}, cycles });
  const m = byMonth(rows, "cluster", null, cycles ? "cyc" : "m");
  const last12 = monthRange(month.history[0].month, month.history.at(-2).month);
  const last3 = last12.slice(-3);
  const avg3 = last3.reduce((a, k) => a + sum(m[k]), 0) / (last3.length || 1);
  const avgN = last12.length;
  const avg12 = last12.reduce((a, k) => a + sum(m[k]), 0) / (avgN || 1);
  const income = incomeRows(snap, { rules, compiled, entity: me, today, cycles });
  const key = cycles ? "cyc" : "m";
  // Months with income data only: before Pluggy's first month there is none (the bill history has spending only).
  const firstIncome = income.reduce((a, r) => (r[key] && r[key] < a ? r[key] : a), "9999");
  const pastLeft = leftover(income, rows, last12.filter((k) => k > firstIncome), key);
  const avg = (f) => pastLeft.reduce((a, r) => a + r[f], 0) / (pastLeft.length || 1);
  const salaryFrom = [...new Set(income.filter((r) => r.kind === "salary").map((r) => BANK_CODES[r.from] || `banco ${r.from}`))];
  const left = { now: leftover(income, rows, [month.month], key)[0], n: pastLeft.length, avg: { left: avg("regular"), salary: avg("salary"), other: avg("other"), spent: avg("spent"), oneOff: pastLeft.reduce((a, r) => a + r.oneOff, 0) }, history: pastLeft, salaryFrom };
  const trends = clusterTrends(m, last12);
  const goals = suggestGoals({ income: pastLeft.length ? left.avg.left + left.avg.spent : 0, trends });
  // Wealth, maturities and the FGC check cover every connected account, the joint one (Itaú) included. Spending,
  // income and Projeção stay on the owner's accounts: the joint account's flows are the household's, not his.
  const wealth = holdings(snap, rules, null);
  const v = {
    today, rows, mine, wealth, month, avg12, avgN, avg3, left, trends, goals,
    cards: cards(snap, rules, me, today),
    mat: maturityLadder(wealth, today),
    guarantee: fgc(wealth),
    income: investIncome(snap, rules, snap.cdi?.daily ?? null),
    daysTo: (iso) => daysBetween(today, iso),
  };
  for (const r of v.mat.rows) r.earn = maturityEarnings(r, today, snap.cdi?.daily ?? null);
  v.installments = installmentsAhead(snap, rules, me, today);
  v.bills = billMonths(snap, rules, me, today);
  v.history = monthlyHistory(mergeLog(rules?.invHistory, data.invLog), Object.fromEntries(v.income.banks.map((b) => [b.label, b.net])));
  v.alerts = alerts(v, { idleCash: s.idleCash ?? 5000, cdbMin: s.cdbMin ?? 110 });
  const pOpts = { rows, income, cycles, target: s.target ?? DEFAULT_TARGET, limits: s.limits || {}, log: mergeLog(rules?.invHistory, data.invLog), own: mine.banks.map((b) => b.label) };
  v.closing = closing({ ...pOpts, month, bills: v.bills, today });
  // Gastos › Histórico: every past period on the chart, summarised like the month-end one.
  v.periods = Object.fromEntries((month.long || month.history).filter((h) => h.month !== month.month).map((h) => [h.month, { ...period(h.month, pOpts), cardOnly: Boolean(h.cardOnly) }]));
  v.pace = pace(month, { rows, cycles, monthly: lists.monthly, renewals: lists.renewals, snapshot: snap, today });
  v.recurring = recurring(rows, { lists, ignored: data.ignoredRecurring || [], today });
  v.cash = cashOf(mine, { earmark: s.billReserve || 0 });
  v.agenda = agenda({ cards: v.cards, bills: v.bills, mat: v.mat, salary: salaryForecast(income, { today, days: 90 }), monthly: lists.monthly, renewals: lists.renewals, snapshot: snap, cash: v.cash, today, days: 90 });
  v.timeline = v.agenda.filter((e) => e.late || daysBetween(today, e.date) <= 30);
  return v;
}
