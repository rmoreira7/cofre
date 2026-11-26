// The balances on 31/12, kept for the income-tax return (Bens e Direitos asks for each account and investment as of the
// last day of the year). Every refresh overwrites the current year's entry per bank, so the last refresh of the year
// wins: refresh on 31/12 and that is the year-end. A bank that failed keeps its earlier entry. Transactions are left out.
import { toBRL } from "./model.js";

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
export const ACCOUNT_FIELDS = ["type", "subtype", "name", "balance", "currencyCode"];

export function keepYearEnd(prev, snapshot, today) {
  const y = today.slice(0, 4), all = { ...(prev || {}) };
  const cur = all[y] || { banks: {} }, banks = { ...cur.banks };
  for (const it of snapshot.items || []) {
    if (it.error || it.stale) continue;
    banks[it.label] = {
      d: today,
      accounts: (it.accounts || []).filter((a) => a.type !== "CREDIT").map((a) => pick(a, ACCOUNT_FIELDS)),
      investments: it.investments || [],
    };
  }
  all[y] = { banks, fx: snapshot.fx || cur.fx || null };
  return all;
}

// Per bank: the day it was kept, checking (BRL, foreign converted) and invested. done = every bank kept on 31/12.
export function yearEndSummary(all, year) {
  const ye = all?.[year];
  if (!ye) return null;
  const last = `${year}-12-31`;
  const banks = Object.entries(ye.banks).map(([label, b]) => ({
    label, d: b.d, onTime: b.d === last,
    checking: b.accounts.reduce((a, x) => a + toBRL(x.balance || 0, x.currencyCode, ye.fx), 0),
    invested: b.investments.reduce((a, i) => a + (i.balance || 0), 0),
    positions: b.investments.length,
  })).sort((a, b) => b.checking + b.invested - (a.checking + a.invested));
  return { year, banks, done: banks.length > 0 && banks.every((b) => b.onTime) };
}
