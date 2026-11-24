// What the investments earn, after tax. Pure: snapshot in, numbers out.
// Pluggy's investment `balance` is already NET of income tax: `taxes` is the IR the bank would withhold on redemption
// and `taxes2` the IOF (verified 24/11: taxes ÷ (balance − amountOriginal) = b ÷ (1 − b) for every bracket b). So the
// net gain so far is balance − amountOriginal, and the gross value is balance + taxes + taxes2.
import { entityOf } from "./categorize.js";
import { bankName, primaryEntity } from "./model.js";
import { daysBetween } from "./format.js";

export const EXEMPT = new Set(["LCA", "LCI", "CRA", "CRI", "LIG"]);
export const BUSINESS_DAYS = 252;
export const LOG_DAYS = 400;

// The regressive IR table on fixed income, by days from purchase to redemption.
export const bracket = (days) => (days <= 180 ? 0.225 : days <= 360 ? 0.2 : days <= 720 ? 0.175 : 0.15);

export const cdiAnnual = (daily) => (daily ? (1 + daily / 100) ** BUSINESS_DAYS - 1 : null);

// The tax this position pays when it is held to maturity (its own term). No due date → the lowest bracket.
export function taxRate(i) {
  if (EXEMPT.has(i.subtype) || i.taxExempt) return 0;
  if (!i.purchaseDate || !i.dueDate) return 0.15;
  return bracket(daysBetween(i.purchaseDate, i.dueDate));
}

// Annual gross rate today: % of CDI on the current CDI, or the fixed rate. IPCA and funds have no rate we can price.
export function annualRate(i, cdiDaily) {
  if (i.rateType === "CDI" && i.rate) return cdiDaily ? (1 + (cdiDaily / 100) * (i.rate / 100)) ** BUSINESS_DAYS - 1 : null;
  if (i.rateType !== "IPCA" && i.fixedAnnualRate) return i.fixedAnnualRate / 100;
  return null;
}

const zero = () => ({ n: 0, balance: 0, gain: 0, tax: 0, gross: 0, net: 0, unrated: 0 });
function add(t, i, cdiDaily) {
  const tax = (i.taxes || 0) + (i.taxes2 || 0);
  t.n++;
  t.balance += i.balance || 0;
  t.tax += tax;
  if (i.amountOriginal > 0) t.gain += (i.balance || 0) - i.amountOriginal;
  const ra = annualRate(i, cdiDaily);
  if (ra === null) { if (!(i.rateType === "CDI" && i.rate)) t.unrated++; return; }
  const month = ((i.balance || 0) + tax) * ((1 + ra) ** (1 / 12) - 1);
  t.gross += month;
  t.net += month * (1 - taxRate(i));
}
const sumUp = (list) => list.reduce((a, b) => { for (const k of Object.keys(a)) a[k] += b[k]; return a; }, zero());

// Per bank (the joint account tagged), with own and joint totals and the own money's split by maturity bracket.
export function income(snapshot, rules, cdiDaily) {
  const primary = primaryEntity(rules);
  const banks = [];
  const brackets = new Map();
  for (const it of snapshot.items) {
    if (it.error || !it.investments?.length) continue;
    const owner = entityOf(it.label, rules);
    const joint = Boolean(owner && primary && owner !== primary);
    const t = { label: it.label, name: bankName(it.label), joint, ...zero() };
    for (const i of it.investments) {
      add(t, i, cdiDaily);
      if (!joint) { const r = taxRate(i); brackets.set(r, (brackets.get(r) || 0) + (i.balance || 0)); }
    }
    banks.push(t);
  }
  banks.sort((a, b) => b.balance - a.balance);
  const own = sumUp(banks.filter((b) => !b.joint));
  const joint = sumUp(banks.filter((b) => b.joint));
  const split = [...brackets].filter(([, v]) => v > 0).sort((a, b) => a[0] - b[0]).map(([rate, amount]) => ({ rate, amount, share: own.balance ? amount / own.balance : 0 }));
  return { banks, own, joint, brackets: split, cdiDaily, cdiAnnual: cdiAnnual(cdiDaily) };
}

// The CDB rate (% of CDI) that matches a tax-exempt rate after a bracket's IR: 88% exempt = 103,5% at 15%.
export const cdbEquivalent = (exemptPct, rate) => exemptPct / (1 - rate);

// One entry per day: each position's net balance, invested amount, quantity and bank, so the income actually earned can be
// measured later (a position that matures takes its gain out of any sum of totals; per position it does not).
export function logPositions(log, snapshot, today, keep = LOG_DAYS) {
  const p = {};
  for (const it of snapshot.items) {
    if (it.error || it.stale) continue;
    for (const i of it.investments || []) if (i.id) p[i.id] = [Math.round((i.balance || 0) * 100) / 100, Math.round((i.amountOriginal || 0) * 100) / 100, i.quantity ?? null, it.label];
  }
  const out = (log || []).filter((e) => e.v === 2).filter((e) => e.d !== today && daysBetween(e.d, today) < keep);
  if (Object.keys(p).length) out.push({ v: 2, d: today, p });
  return out;
}

// Net income one position earned between two log entries. Held both times: the balance change, with the start balance
// scaled to the units still held, so a partial withdrawal is not counted as a loss. Bought in between: balance − cost.
// Gone: nothing (what it earned up to its last entry was already counted).
export function earned(a, b) {
  if (!b) return 0;
  if (!a) return b[1] ? b[0] - b[1] : 0;
  const scale = a[2] && b[2] ? b[2] / a[2] : 1;
  return b[0] - a[0] * scale;
}

// Per bank, between consecutive log entries: [{ from, to, banks: { label: amount } }]. The bank comes from the entry
// itself (4th field); bankOf is only a fallback for entries written without it.
export function earnedSteps(log, bankOf = () => null) {
  const out = [];
  for (let k = 1; k < log.length; k++) {
    const a = log[k - 1].p, b = log[k].p, banks = {};
    for (const [id, pos] of Object.entries(b)) {
      const bank = pos[3] || bankOf(id);
      if (bank) banks[bank] = (banks[bank] || 0) + earned(a[id], pos);
    }
    out.push({ from: log[k - 1].d, to: log[k].d, banks });
  }
  return out;
}

// Brazilian national holidays on which the CDI does not accrue (B3 closed), 2026–2027.
export const HOLIDAYS = new Set([
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-21", "2026-05-01", "2026-06-04", "2026-09-07",
  "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25",
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-26", "2027-04-21", "2027-05-01", "2027-05-27", "2027-09-07",
  "2027-10-12", "2027-11-02", "2027-11-15", "2027-11-20", "2027-12-25",
]);

// Business days in (a, b]: what the CDI accrues over.
export function businessDays(a, b) {
  let n = 0;
  const d = new Date(a + "T12:00:00Z"), end = new Date(b + "T12:00:00Z");
  for (d.setUTCDate(d.getUTCDate() + 1); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10), w = d.getUTCDay();
    if (w !== 0 && w !== 6 && !HOLIDAYS.has(iso)) n++;
  }
  return n;
}

// What a maturity (one issuer, one date, maybe several bonds) earned: invested, receita after tax so far (Pluggy's balance
// is already net of IR), the IR + IOF withheld, and, for CDI bonds with today's CDI, an estimate of the balance and
// receita on the due date. Null when any bond lacks its invested amount: no line beats a wrong one.
// The yearly rate and the bracket only when every bond shares them (one purchase date; one bracket).
export function maturityEarnings(r, today, cdiDaily = null) {
  const parts = r.parts || [];
  if (!parts.length || parts.some((p) => !(p.orig > 0))) return null;
  const orig = parts.reduce((a, p) => a + p.orig, 0), balance = parts.reduce((a, p) => a + p.balance, 0);
  const gain = balance - orig, tax = parts.reduce((a, p) => a + (p.tax || 0), 0);
  const dates = [...new Set(parts.map((p) => p.bought).filter(Boolean))];
  const bought = dates.length === 1 && parts.every((p) => p.bought) ? dates[0] : null;
  const held = bought ? daysBetween(bought, today) : 0;
  const yearly = bought && held >= 30 && balance > 0 ? (balance / orig) ** (365 / held) - 1 : null;
  const rateOf = (p) => taxRate({ subtype: p.subtype, taxExempt: p.taxExempt, purchaseDate: p.bought, dueDate: r.due });
  const rates = [...new Set(parts.map(rateOf))];
  let est = null;
  const bd = r.due > today ? businessDays(today, r.due) : 0;
  if (bd > 0 && cdiDaily && parts.every((p) => p.cdi)) {
    const add = parts.reduce((a, p) => a + (p.balance + (p.tax || 0)) * ((1 + (cdiDaily / 100) * (p.cdi / 100)) ** bd - 1) * (1 - rateOf(p)), 0);
    est = { balance: balance + add, gain: balance + add - orig, days: bd };
  }
  return { orig, balance, gain, pct: gain / orig, tax, bought, earliest: dates.sort()[0] || null, yearly, bracket: rates.length === 1 ? rates[0] : null, est };
}

// The laptop's history (rules file) and the app's own log in one series, one entry per day; the app's entry wins a tie.
export function mergeLog(seed, own) {
  const m = new Map();
  for (const e of [...(seed || []), ...(own || [])]) if (e?.v === 2 && e.d && e.p) m.set(e.d, e);
  return [...m.values()].sort((a, b) => a.d.localeCompare(b.d));
}

// Measured income per calendar month and bank, from the merged log, next to an estimate for the same business days at
// today's monthly rate (perMonth: { label: net per month }). A step counts in the month it ends in. The estimate is left
// out (null) for a bank where under 75% of the money at the end was already invested at the start: when most of it
// moved mid-period (a fund redeemed, CDBs bought), today's rate says nothing about the period.
export const MONTH_BDAYS = 21;
export function monthlyHistory(log, perMonth = {}) {
  const months = new Map();
  for (const st of earnedSteps(log)) {
    const m = st.to.slice(0, 7);
    const x = months.get(m) || { month: m, from: st.from, to: st.to, banks: {} };
    x.to = st.to;
    for (const [bank, v] of Object.entries(st.banks)) x.banks[bank] = (x.banks[bank] || 0) + v;
    months.set(m, x);
  }
  const at = (d) => log.find((e) => e.d === d);
  const held = (a, b, bank) => {
    let all = 0, kept = 0;
    for (const [id, x] of Object.entries(b?.p || {})) if (x[3] === bank) { all += x[0]; if (a?.p?.[id]) kept += x[0]; }
    return all ? kept / all : 0;
  };
  return [...months.values()].map((x) => {
    const bd = businessDays(x.from, x.to);
    const banks = Object.fromEntries(Object.entries(x.banks).map(([bank, measured]) => {
      const est = perMonth[bank] != null && held(at(x.from), at(x.to), bank) >= 0.75 ? (perMonth[bank] * bd) / MONTH_BDAYS : null;
      return [bank, { measured, estimated: est }];
    }));
    return { ...x, bd, partial: x.from.slice(0, 7) === x.month, banks };
  });
}
