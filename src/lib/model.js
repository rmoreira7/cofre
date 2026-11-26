// Turns a Pluggy pull into what the screens show. Pure functions, no DOM, no network.
import { entityOf } from "./categorize.js";
import { reservedHoldings } from "./pluggy.js";
import { daysBetween } from "./format.js";
import { cleanCard } from "./cardtx.js";

// codes: the bank's COMPE codes, so a transfer from a connected bank is recognised as internal.
export const BANKS = {
  nubank: { name: "Nubank", color: "#8a05be", codes: ["260"] },
  xp: { name: "XP", color: "var(--ink)", codes: ["102", "348"] },
  // fgc: the bank's own checking account is a deposit the FGC covers, under this issuer.
  itau: { name: "Itaú", color: "var(--joint)", codes: ["341"], fgc: "ITAU UNIBANCO S.A." },
  neon: { name: "Neon", color: "#00a3b4", codes: ["536", "655"] },
  mercadopago: { name: "Mercado Pago", color: "#00b1ea", codes: ["323"] },
  // balanceOnly: Meu Pluggy gives Wise's balances but not its card purchases (only currency conversions), so its
  // transactions are dropped; the money spent abroad stays counted when it leaves for Wise ("Sent abroad (Wise)").
  wise: { name: "Wise", color: "#9fe870", codes: [], balanceOnly: true },
};

// Balances in another currency, in BRL with the rates the snapshot carries ({ USD: 5.9, … }). Unknown rate → 0, and
// the account is listed in holdings' `unpriced`.
export const toBRL = (amount, currency, fx) => (!currency || currency === "BRL" ? amount : fx?.[currency] ? amount * fx[currency] : 0);
export const bankName = (label) => BANKS[label]?.name || label;
export const CONCENTRATION = 0.4;

// Keep only what the app reads: the vault stays small and holds no field the app never shows.
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const TX = ["id", "date", "amount", "description", "operationType", "category", "status"];
const INV = ["id", "name", "issuer", "type", "subtype", "status", "balance", "amountOriginal", "rate", "rateType", "fixedAnnualRate", "dueDate", "purchaseDate", "issueDate", "taxes", "taxes2", "taxExempt", "quantity"];

export function slim(pulled) {
  return {
    at: pulled.at,
    items: pulled.items.map((it) => {
      if (it.error) return { label: it.label, error: it.error, status: it.status ?? null };
      return {
        label: it.label,
        item: pick(it.item, ["id", "status", "executionStatus", "consentExpiresAt", "lastUpdatedAt", "resourcesCollectedAt", "nextAutoSyncAt"]),
        accounts: it.accounts.map((a) => ({
          ...pick(a, ["id", "type", "subtype", "name", "balance", "currencyCode"]),
          reserved: reservedHoldings(a).flatMap((r) =>
            (r.availableAmounts || []).filter((x) => x.amount).map((x) => ({ name: r.name, amount: x.amount, pct: x.remuneration?.postFixedIndexerPercentage ?? null })),
          ),
          credit: a.type === "CREDIT" ? pick(a.creditData || {}, ["creditLimit", "availableCreditLimit", "balanceDueDate", "balanceCloseDate"]) : undefined,
          bills: a.bills?.map((b) => pick(b, ["dueDate", "totalAmount", "billClosingDate"])),
          transactions: (BANKS[it.label]?.balanceOnly ? [] : a.type === "CREDIT" ? cleanCard(a.transactions) : a.transactions).map((t) => {
            const out = pick(t, TX);
            // Bank codes only (never account numbers): who sent and who received a transfer, for income detection.
            const pd = t.paymentData;
            if (pd?.payer?.routingNumber) out.from = String(Number(pd.payer.routingNumber));
            if (pd?.receiver?.routingNumber) out.to = String(Number(pd.receiver.routingNumber));
            const m = t.creditCardMetadata;
            if (m) out.card = pick(m, ["billForecastDate", "paymentType", "installmentNumber", "totalInstallments", "purchaseDate"]);
            return out;
          }),
        })),
        investments: it.investments.filter((i) => i.status === "ACTIVE").map((i) => pick(i, INV)),
      };
    }),
  };
}

export function primaryEntity(rules) {
  return rules?.primary || Object.keys(rules?.entities || {})[0] || null;
}

export function shortIssuer(s) {
  let t = String(s || "").split(" - ")[0].toUpperCase();
  if (/^NU (FINANCEIRA|PAGAMENTOS|INVEST)/.test(t)) return "Nubank";
  t = t.replace(/^BANCO\s+/, "").split(/\s+S\.?\s?\/?A\b|\s+SA\b|\s*-|,|\s+BANCO\b/)[0].trim();
  const words = t.split(/\s+/).slice(0, 2);
  return words.map((w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase())).join(" ");
}

export function rateLabel(i) {
  if (i.rateType === "CDI" && i.rate) return `${fmtNum(i.rate)}% CDI`;
  if (i.rateType === "IPCA" && (i.rate || i.fixedAnnualRate)) return `IPCA + ${fmtNum(i.rate || i.fixedAnnualRate)}%`;
  if (i.fixedAnnualRate) return `${fmtNum(i.fixedAnnualRate)}% a.a.`;
  return "–";
}
const fmtNum = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function positionsOf(it) {
  const out = it.investments.map((i) => ({ bank: it.label, issuer: shortIssuer(i.issuer || i.name), name: i.name, subtype: i.subtype, balance: i.balance || 0, rate: rateLabel(i), cdi: i.rateType === "CDI" ? i.rate : null, due: i.dueDate ? i.dueDate.slice(0, 10) : null,
    // for the receita of a maturity (src/lib/income.js maturityEarnings): invested, IR + IOF withheld, bought on
    orig: i.amountOriginal > 0 ? i.amountOriginal : null, tax: (i.taxes || 0) + (i.taxes2 || 0), bought: i.purchaseDate ? i.purchaseDate.slice(0, 10) : null, taxExempt: Boolean(i.taxExempt) }));
  for (const a of it.accounts) for (const r of a.reserved || []) out.push({ bank: it.label, issuer: r.name, name: r.name, subtype: "RESERVED_BALANCE", balance: r.amount, rate: r.pct ? `${fmtNum(r.pct * 100)}% CDI` : "–", cdi: r.pct ? r.pct * 100 : null, due: null, liquid: true });
  return out;
}

// Net worth: invested (incl. reserved balances) + checking, per bank. entity = one key of rules.entities, or null for
// every entity (the joint account included); each bank then carries `joint` when it isn't the primary entity's.
export function holdings(snapshot, rules, entity) {
  const banks = [];
  const primary = primaryEntity(rules);
  for (const it of snapshot.items) {
    const owner = entityOf(it.label, rules);
    if (it.error || (entity !== null && owner !== entity)) continue;
    const positions = positionsOf(it);
    const invested = positions.reduce((a, p) => a + p.balance, 0);
    const bankAcc = it.accounts.filter((a) => a.type !== "CREDIT");
    const checking = bankAcc.reduce((a, x) => a + toBRL(x.balance || 0, x.currencyCode, snapshot.fx), 0);
    const foreign = bankAcc.filter((x) => x.currencyCode && x.currencyCode !== "BRL" && x.balance).map((x) => ({ currency: x.currencyCode, amount: x.balance, brl: toBRL(x.balance, x.currencyCode, snapshot.fx) }));
    const cdi = positions.filter((p) => p.cdi);
    const cdiAvg = cdi.length ? cdi.reduce((a, p) => a + p.cdi * p.balance, 0) / cdi.reduce((a, p) => a + p.balance, 0) : null;
    banks.push({ label: it.label, name: bankName(it.label), invested, checking, total: invested + checking, positions, cdiAvg, count: positions.filter((p) => !p.liquid).length, reserved: positions.filter((p) => p.liquid), foreign, joint: Boolean(owner && primary && owner !== primary) });
  }
  banks.sort((a, b) => b.total - a.total);
  return { total: banks.reduce((a, b) => a + b.total, 0), banks };
}

// A card's usual bill: the median of its last 6 closed bills (null with fewer than 3). Used to estimate the bills ahead,
// of which only the installments are posted yet.
export function typicalBill(bills, today) {
  const t = (bills || []).filter((b) => b.dueDate.slice(0, 10) < today && b.totalAmount > 0).sort((x, y) => y.dueDate.localeCompare(x.dueDate)).slice(0, 6).map((b) => b.totalAmount).sort((a, b) => a - b);
  if (t.length < 3) return null;
  return t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2;
}

export function cards(snapshot, rules, entity, today) {
  const out = [];
  for (const it of snapshot.items) {
    if (it.error || entityOf(it.label, rules) !== entity) continue;
    for (const a of it.accounts) {
      if (a.type !== "CREDIT") continue;
      const next = (a.bills || []).filter((b) => b.dueDate.slice(0, 10) >= today).sort((x, y) => x.dueDate.localeCompare(y.dueDate))[0];
      const due = nextDue(a.credit?.balanceDueDate, today) || next?.dueDate.slice(0, 10) || null;
      out.push({ bank: it.label, name: bankName(it.label), used: a.balance || 0, limit: a.credit?.creditLimit || null, due, typical: typicalBill(a.bills, today), ...openBill(a, due) });
    }
  }
  return out.sort((a, b) => b.bill - a.bill);
}

// Maturity ladder: positions grouped by (due date, issuer), with the reinvestment-rule tag.
// Banks whose own daily-liquidity product carries a nominal due date it renews by itself (Nubank's): not a maturity
// to act on, so it stays in the holdings but out of the ladder, the alerts and the next-event line.
const AUTO_RENEW = new Set(["nubank"]);

export function maturities(h, today) {
    const share = {};
  for (const b of h.banks) for (const p of b.positions) {
    const k = `${b.label}|${p.issuer}`;
    share[k] = (share[k] || 0) + p.balance / (b.invested || 1);
  }
  const issuers = Object.fromEntries(h.banks.map((b) => [b.label, new Set(b.positions.filter((p) => !p.liquid).map((p) => p.issuer)).size]));
  const concentrated = (bank, issuer) => issuers[bank] > 1 && share[`${bank}|${issuer}`] >= CONCENTRATION;
  const groups = new Map();
  for (const b of h.banks) for (const p of b.positions) {
    if (!p.due || AUTO_RENEW.has(b.label)) continue;
    const k = `${p.due}|${b.label}|${p.issuer}`;
    const g = groups.get(k) || { due: p.due, bank: b.label, issuer: p.issuer, n: 0, balance: 0, rates: new Set(), joint: b.joint, parts: [] };
    g.n++; g.balance += p.balance; g.rates.add(p.rate);
    g.parts.push({ balance: p.balance, orig: p.orig, tax: p.tax, bought: p.bought, cdi: p.cdi, subtype: p.subtype, taxExempt: p.taxExempt });
    groups.set(k, g);
  }
  const rows = [...groups.values()].map((g) => ({
    ...g, rates: [...g.rates], days: daysBetween(today, g.due),
    tag: /^BRB\b/.test(g.issuer) ? "brb" : concentrated(g.bank, g.issuer) ? "conc" : null,
  }));
  rows.sort((a, b) => a.due.localeCompare(b.due) || b.balance - a.balance);
  const liquid = h.banks.flatMap((b) => b.reserved.map((p) => ({ ...p, bankName: b.name, joint: b.joint })));
  const conc = Object.entries(share).filter(([k]) => concentrated(...k.split("|")))
    .map(([k, v]) => ({ bank: k.split("|")[0], issuer: k.split("|")[1], share: v, joint: h.banks.find((b) => b.label === k.split("|")[0])?.joint })).sort((a, b) => b.share - a.share);
  const brbLast = rows.filter((r) => r.tag === "brb").map((r) => r.due).sort().at(-1) || null;
  return { rows, liquid, conc, brbLast, total: rows.reduce((a, r) => a + r.balance, 0) };
}

export function itemStatus(snapshot) {
  return snapshot.items.map((it) => ({
    label: it.label, name: bankName(it.label), ok: !it.error && it.item?.status === "UPDATED", stale: Boolean(it.stale), error: it.error || null, status: it.item?.status || null,
    consent: it.item?.consentExpiresAt?.slice(0, 10) || null,
    collected: it.item?.resourcesCollectedAt || it.item?.lastUpdatedAt || null,
    nextSync: it.item?.nextAutoSyncAt || null,
  }));
}

// Pluggy syncs each bank about once a day. bankAt = the oldest bank data on screen; nextSync = when new data
// can exist. A refresh before nextSync returns the same data, so auto-refresh waits for it.
export function freshness(snapshot) {
  const st = itemStatus(snapshot).filter((s) => s.collected);
  const bankAt = st.map((s) => s.collected).sort()[0] || null;
  const nextSync = st.map((s) => s.nextSync).filter(Boolean).sort()[0] || null;
  return { bankAt, nextSync, pulledAt: snapshot.at };
}

export function shouldAutoRefresh(snapshot, now = new Date(), { maxAgeH = 24, graceMin = 10 } = {}) {
  if (!snapshot) return true;
  const { nextSync, pulledAt } = freshness(snapshot);
  if (now - new Date(pulledAt) > maxAgeH * 36e5) return true;
  return Boolean(nextSync && now - new Date(nextSync) > graceMin * 6e4 && new Date(pulledAt) < new Date(nextSync));
}

// Things that need a decision soon. Plain data; the screen picks the words and colours.
// FGC: R$ 250 mil per issuer, summed across every bank (an issuer bought at XP and at Itaú shares one limit).
// Covered: bank deposits (CDB, RDB, LC), LCA, LCI, LIG and a bank's own checking account; funds, Tesouro, CRA/CRI,
// debentures and payment accounts are not. Joint holdings count in full: the guarantee splits among the holders, so
// this errs on the safe side.
export const FGC_LIMIT = 250000;
const FGC_SUBTYPES = new Set(["CDB", "RDB", "LC", "LCA", "LCI", "LIG"]);
export function fgc(h) {
  const by = new Map();
  const add = (issuer, amount, b) => {
    if (!(amount > 0)) return;
    const e = by.get(issuer) || { issuer, amount: 0, banks: new Set(), joint: false };
    e.amount += amount; e.banks.add(b.label); e.joint ||= b.joint;
    by.set(issuer, e);
  };
  for (const b of h.banks) {
    for (const p of b.positions) if (FGC_SUBTYPES.has(p.subtype)) add(p.issuer, p.balance, b);
    if (BANKS[b.label]?.fgc) add(shortIssuer(BANKS[b.label].fgc), b.checking, b);
  }
  const issuers = [...by.values()].map((e) => ({ ...e, banks: [...e.banks], share: e.amount / FGC_LIMIT, over: e.amount > FGC_LIMIT })).sort((a, b) => b.amount - a.amount);
  return { issuers, total: issuers.reduce((a, e) => a + e.amount, 0), limit: FGC_LIMIT };
}

// Início's next-30-days list: bills going out, maturities (own and joint), and the forecast salary coming in.
export function timeline({ cards = [], mat, salary = [], today, days = 30 }) {
  const out = [];
  for (const c of cards) if (c.due && c.bill > 0 && daysBetween(today, c.due) >= 0 && daysBetween(today, c.due) <= days) out.push({ date: c.due, kind: "bill", bank: c.bank, name: `Fatura ${c.name}`, amount: -c.bill, early: c.early || 0 });
  for (const r of mat.rows) if (r.days >= 0 && r.days <= days) out.push({ date: r.due, kind: "maturity", name: `${r.issuer}${r.n > 1 ? ` ×${r.n}` : ""} vence`, bank: r.bank, joint: Boolean(r.joint), rates: r.rates, amount: r.balance, brb: r.tag === "brb", earn: r.earn || null });
  for (const f of salary) out.push({ date: f.date, kind: "salary", from: f.from, amount: f.amount, forecast: true });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

export function alerts({ wealth, mat, cards, today, guarantee }, { idleCash = 5000, cdbMin = 110, soonDays = 30, billDays = 5 } = {}) {
  const out = [];
  for (const b of wealth.banks.filter((b) => b.checking > idleCash)) out.push({ kind: "idle", scope: b.joint ? "joint" : "mine", bank: b.name, amount: b.checking });
  for (const e of guarantee?.issuers.filter((e) => e.over) || []) out.push({ kind: "fgc", issuer: e.issuer, amount: e.amount, over: e.amount - FGC_LIMIT, joint: e.joint });
  for (const r of mat.rows.filter((r) => r.days >= 0 && r.days <= soonDays)) out.push({ kind: "maturity", issuer: r.issuer, n: r.n, due: r.due, days: r.days, amount: r.balance, brb: r.tag === "brb", cdbMin, scope: r.joint ? "joint" : "mine" });
  for (const c of cards.filter((c) => c.due && c.bill > 0)) {
    const d = daysBetween(today, c.due);
    if (d >= 0 && d <= billDays) out.push({ kind: "bill", bank: c.name, due: c.due, days: d, amount: c.bill });
  }
  const rank = { bill: 0, fgc: 1, maturity: 2, idle: 3 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.days ?? 99) - (b.days ?? 99) || b.amount - a.amount);
}

// Pluggy keeps the last statement's due date until the next statement closes: roll it forward monthly.
export function nextDue(iso, today) {
  if (!iso) return null;
  let [y, m] = iso.slice(0, 7).split("-").map(Number);
  const d = Number(iso.slice(8, 10));
  for (let i = 0; i < 24; i++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cand = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
    if (cand >= today) return cand;
    if (++m === 13) { y++; m = 1; }
  }
  return null;
}

// The open bill, from each charge's forecast bill month (Pluggy creditCardMetadata.billForecastDate).
// Payments tagged for that month first settle the previous bill; anything beyond is an early payment.
// Pluggy's account balance is the used limit (open bill + future installments), not the bill.
export function openBill(account, due) {
  const tx = account.transactions || [];
  if (!due || !tx.some((t) => t.card?.billForecastDate)) return { bill: account.balance || 0, ahead: 0, exact: false };
  const month = due.slice(0, 7);
  let charges = 0, paid = 0, ahead = 0;
  for (const t of tx) {
    const f = t.card?.billForecastDate?.slice(0, 7);
    if (!f) continue;
    if (t.operationType === "PAGAMENTO_FATURA") { if (f === month) paid += -t.amount; continue; }
    if (f === month) charges += t.amount;
    else if (f > month) ahead += t.amount;
  }
  const prev = (account.bills || []).filter((b) => b.dueDate.slice(0, 7) < month).sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
  const early = Math.max(0, paid - (prev?.totalAmount || 0));
  // Nothing tagged for this bill or later (XP tags differently): the balance is the bill.
  if (!charges && !ahead) return { bill: account.balance || 0, ahead: 0, exact: false };
  return { bill: Math.max(0, charges - early), charges, early, ahead, exact: true };
}

// Installments already committed to bills after the open one, per month and per purchase plan.
// The merchant part of a card line: no "n/N" installment tail, no " - NuPay" suffix.
export const merchantOf = (desc) => String(desc || "").split("|").at(-1).replace(/\s*\d+\/\d+\s*$/, "").replace(/\s+-?\s*NuPay\s*$/i, "").trim();

// Gastos › Faturas: the open bill and every later one, per month, with each line on it. The open month's amount is the
// bill itself (charges − early payments, from cards()); later months are what is already committed (installments).
// Only cards that tag each charge with its bill (Nubank) can be listed; the others show in the open bills only.
export function billMonths(snapshot, rules, entity, today) {
  const months = new Map();
  const open = cards(snapshot, rules, entity, today);
  for (const it of snapshot.items) {
    if (it.error || entityOf(it.label, rules) !== entity) continue;
    for (const a of it.accounts) {
      if (a.type !== "CREDIT") continue;
      const c = open.find((x) => x.bank === it.label && x.exact);
      if (!c?.due) continue;
      const first = c.due.slice(0, 7);
      for (const t of a.transactions || []) {
        const k = t.card, f = k?.billForecastDate?.slice(0, 7);
        if (!f || f < first || t.operationType === "PAGAMENTO_FATURA") continue;
        const m = months.get(f) || { month: f, open: f === first, amount: 0, charges: 0, rows: [] };
        m.charges += t.amount;
        m.rows.push({ bank: it.label, name: merchantOf(t.description), n: k.installmentNumber || null, of: k.totalInstallments || null, amount: t.amount, date: (k.purchaseDate || t.date || "").slice(0, 10) });
        months.set(f, m);
      }
      const m0 = months.get(first);
      if (m0) { m0.amount += c.bill; m0.early = (m0.early || 0) + (c.early || 0); m0.due = c.due; }
    }
  }
  const list = [...months.values()].sort((x, y) => x.month.localeCompare(y.month));
  for (const m of list) {
    if (!m.open) m.amount = m.charges;
    m.rows.sort((x, y) => y.amount - x.amount);
  }
  return list;
}

export function installmentsAhead(snapshot, rules, entity, today) {
  const months = {}, plans = new Map();
  for (const it of snapshot.items) {
    if (it.error || entityOf(it.label, rules) !== entity) continue;
    for (const a of it.accounts) {
      if (a.type !== "CREDIT") continue;
      const due = nextDue(a.credit?.balanceDueDate, today);
      if (!due) continue;
      const open = due.slice(0, 7);
      for (const t of a.transactions || []) {
        const c = t.card;
        if (c?.paymentType !== "INSTALLMENT" || t.operationType === "PAGAMENTO_FATURA") continue;
        const f = c.billForecastDate?.slice(0, 7);
        if (!f || f <= open) continue;
        months[f] = (months[f] || 0) + t.amount;
        const name = merchantOf(t.description);
        const k = `${it.label}|${name.toLowerCase()}|${(c.purchaseDate || "").slice(0, 10)}|${c.totalInstallments}`;
        const p = plans.get(k) || { bank: it.label, name, total: c.totalInstallments, left: 0, amount: 0, per: t.amount, last: f };
        p.left++; p.amount += t.amount; if (f > p.last) p.last = f;
        plans.set(k, p);
      }
    }
  }
  const list = Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));
  return { months: list, total: list.reduce((a, m) => a + m.amount, 0), plans: [...plans.values()].sort((a, b) => b.amount - a.amount) };
}
