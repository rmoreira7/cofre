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

// Pluggy's bill month for installments not yet on a closed bill drifts when one falls on the closing day (Nubank's 26th):
// 2/6 of a purchase made on 26/11 lands in January although the bank puts it in February. Checked against Nubank's own
// future-bill statements: one installment per bill, so installment n sits (n − a) bills after the plan's anchor a,
// the latest installment already on a closed bill (else the plan's first row). Rows on a closed bill stay as they are.
const ym = (iso) => iso.slice(0, 7);
const plusMonths = (m, n) => { const [y, mo] = m.split("-").map(Number); const t = y * 12 + mo - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
export function alignInstallments(transactions, lastClose) {
  if (!lastClose) return transactions;
  const plans = new Map();
  for (const t of transactions) {
    const m = meta(t);
    if (m.paymentType !== "INSTALLMENT" || !m.installmentNumber || !m.billForecastDate) continue;
    const k = planKey(t);
    if (!plans.has(k)) plans.set(k, []);
    plans.get(k).push(t);
  }
  const fix = new Map();
  for (const rows of plans.values()) {
    const closed = rows.filter((t) => t.date.slice(0, 10) < lastClose);
    const pool = closed.length ? closed : rows;
    const a = pool.reduce((x, t) => ((closed.length ? meta(t).installmentNumber > meta(x).installmentNumber : meta(t).installmentNumber < meta(x).installmentNumber) ? t : x));
    const an = meta(a).installmentNumber, am = ym(meta(a).billForecastDate);
    for (const t of rows) {
      const m = meta(t), n = m.installmentNumber;
      if (t.date.slice(0, 10) < lastClose || n <= an) continue;
      const want = plusMonths(am, n - an);
      if (ym(m.billForecastDate) !== want) fix.set(t, `${want}${m.billForecastDate.slice(7)}`);
    }
  }
  if (!fix.size) return transactions;
  return transactions.map((t) => {
    if (!fix.has(t)) return t;
    const key = t.creditCardMetadata ? "creditCardMetadata" : "card";
    return { ...t, [key]: { ...t[key], billForecastDate: fix.get(t) } };
  });
}

export function cleanCard(transactions) {
  const g = ghostIds(transactions);
  return g.size ? transactions.filter((t) => !g.has(t.id)) : transactions;
}

// Refund credits ("IOF de volta de …", "Estorno de …", and the statements' `Crédito de "<merchant>"`) net against spending in the category of the charge they reverse:
// the positive card charge of the same amount from 60 days before to 3 days after (IOF reversals can post a day early),
// nearest date first, each charge used once; failing that, the latest charge from the same merchant within 365 days.
// IOF reversals only match IOF charges. Unmatched → null, except a refund
// within 60 days of the card's first row: its charge may predate the data, so it is left out (no entry).
export const REFUND_DESC = /^(IOF de volta de|Estorno de|Crédito de)\s*/i;
export const refundTarget = (desc) => desc.replace(REFUND_DESC, "").replace(/^"(.*)"$/, "$1").replace(/\s*-\s*NuPay\s*$/i, "");
const IOF = /^IOF\b/i;
const day = (t) => Date.parse(t.date.slice(0, 10) + "T12:00:00Z") / 864e5;

const merchant = (d) => d.toLowerCase().replace(/\s*-\s*parcela\s*\d+\/\d+\s*$/, "").replace(/\s+/g, " ").trim();

export function isRefund(t) {
  return t.amount < 0 && t.operationType !== "PAGAMENTO_FATURA" && REFUND_DESC.test(t.description);
}

export function refundMatches(transactions) {
  const charges = transactions.filter((t) => t.amount > 0);
  const used = new Set(), out = new Map();
  const first = Math.min(...transactions.map(day));
  for (const r of transactions.filter(isRefund).sort((a, b) => a.date.localeCompare(b.date))) {
    const iof = IOF.test(r.description);
    let best = null;
    for (const c of charges) {
      if (used.has(c) || cents(c.amount) !== cents(-r.amount) || IOF.test(c.description) !== iof) continue;
      const gap = day(r) - day(c);
      if (gap < -3 || gap > 60) continue;
      if (!best || Math.abs(gap) < Math.abs(day(r) - day(best))) best = c;
    }
    if (best) used.add(best);
    else {
      // No charge of the same amount (partial refund, exchange-rate difference): the latest charge from the same
      // merchant in the 365 days before. Not marked used — one purchase can have several partial refunds.
      const name = merchant(refundTarget(r.description));
      for (const c of charges) {
        const gap = day(r) - day(c);
        if (gap >= 0 && gap <= 365 && IOF.test(c.description) === iof && merchant(c.description) === name && (!best || day(c) > day(best))) best = c;
      }
    }
    if (best || day(r) - first > 60) out.set(r, best);
  }
  return out;
}
