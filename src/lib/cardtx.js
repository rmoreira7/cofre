// Ghost installments that Pluggy keeps after the card issuer changed a plan. Mirror of analyze.py clean_card().
//  1. Anticipation: the brought-forward installment posts again with a new date and the original row stays.
//     Keep the earliest row per (plan, installment number); then trim any number with more copies than the plan has.
//  2. Reversed purchase: a refund of exactly installment 1's amount within 5 days of the purchase cancels the plan.
//     Drop installments ≥ 2 of one copy per refund.

const stem = (d) => d.split("|").at(-1).replace(/\s*\d+\/\d+\s*$/, "").trim().toLowerCase();
const meta = (t) => t.creditCardMetadata || t.card || {};
const REFUND = /estorno/i;
const cents = (n) => Math.round(n * 100);

function planKey(t) {
  const m = meta(t);
  return `${stem(t.description)}|${(m.purchaseDate || "").slice(0, 10)}|${m.totalInstallments}`;
}

export function ghostIds(transactions) {
  const plans = new Map();
  for (const t of transactions) {
    const m = meta(t);
    if (m.paymentType !== "INSTALLMENT" || !m.installmentNumber) continue;
    const k = planKey(t);
    if (!plans.has(k)) plans.set(k, []);
    plans.get(k).push(t);
  }
  const drop = new Set();
  const refunds = transactions.filter((t) => t.amount < 0 && REFUND.test(t.description));
  const usedRefunds = new Set();

  for (const rows of plans.values()) {
    const byNum = new Map();
    for (const t of rows) {
      const n = meta(t).installmentNumber;
      if (!byNum.has(n)) byNum.set(n, []);
      byNum.get(n).push(t);
    }
    // 1. anticipation: rows of one installment number on different dates → only the earliest date survives
    for (const xs of byNum.values()) {
      const dates = [...new Set(xs.map((t) => t.date.slice(0, 10)))].sort();
      if (dates.length > 1) for (const t of xs) if (t.date.slice(0, 10) !== dates[0]) drop.add(t.id);
    }
    const kept = (n) => byNum.get(n).filter((t) => !drop.has(t.id));
    const copies = Math.min(...[...byNum.keys()].map((n) => kept(n).length));
    for (const n of byNum.keys()) kept(n).slice(copies).forEach((t) => drop.add(t.id));

    // 2. reversed purchase: refunds of installment 1's exact amount, ≤ 5 days after the purchase
    const first = byNum.has(1) ? kept(1) : [];
    if (!first.length) continue;
    const bought = (meta(first[0]).purchaseDate || first[0].date).slice(0, 10);
    const limit = new Date(Date.parse(bought + "T12:00:00Z") + 5 * 864e5).toISOString().slice(0, 10);
    const hits = refunds.filter((r) => !usedRefunds.has(r.id) && cents(-r.amount) === cents(first[0].amount) && r.date.slice(0, 10) >= bought && r.date.slice(0, 10) <= limit);
    const cancelled = Math.min(hits.length, copies);
    hits.slice(0, cancelled).forEach((r) => usedRefunds.add(r.id));
    if (cancelled) for (const n of byNum.keys()) if (n >= 2) kept(n).slice(0, cancelled).forEach((t) => drop.add(t.id));
  }
  return drop;
}

export function cleanCard(transactions) {
  const g = ghostIds(transactions);
  return g.size ? transactions.filter((t) => !g.has(t.id)) : transactions;
}
