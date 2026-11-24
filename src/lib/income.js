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

// One entry per day: each position's net balance and invested amount, so the income actually earned per month can be
// measured later (a position that matures takes its gain out of any sum of totals; per position it does not).
export function logPositions(log, snapshot, today, keep = LOG_DAYS) {
  const p = {};
  for (const it of snapshot.items) {
    if (it.error) continue;
    for (const i of it.investments || []) if (i.id) p[i.id] = [Math.round((i.balance || 0) * 100) / 100, Math.round((i.amountOriginal || 0) * 100) / 100];
  }
  const out = (log || []).filter((e) => e.d !== today && daysBetween(e.d, today) < keep);
  if (Object.keys(p).length) out.push({ d: today, p });
  return out;
}
