// Turns a Pluggy pull into what the screens show. Pure functions, no DOM, no network.
import { entityOf } from "./categorize.js";
import { reservedHoldings } from "./pluggy.js";
import { daysBetween } from "./format.js";
import { cleanCard } from "./cardtx.js";

// codes: the bank's COMPE codes, so a transfer from a connected bank is recognised as internal.
export const BANKS = {
  nubank: { name: "Nubank", color: "#8a05be", codes: ["260"] },
  xp: { name: "XP", color: "var(--ink)", codes: ["102", "348"] },
  itau: { name: "Itaú", color: "var(--joint)", codes: ["341"] },
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
const INV = ["id", "name", "issuer", "type", "subtype", "status", "balance", "amountOriginal", "rate", "rateType", "fixedAnnualRate", "dueDate", "purchaseDate", "issueDate"];

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
  const out = it.investments.map((i) => ({ bank: it.label, issuer: shortIssuer(i.issuer || i.name), name: i.name, subtype: i.subtype, balance: i.balance || 0, rate: rateLabel(i), cdi: i.rateType === "CDI" ? i.rate : null, due: i.dueDate ? i.dueDate.slice(0, 10) : null }));
  for (const a of it.accounts) for (const r of a.reserved || []) out.push({ bank: it.label, issuer: r.name, name: r.name, subtype: "RESERVED_BALANCE", balance: r.amount, rate: r.pct ? `${fmtNum(r.pct * 100)}% CDI` : "–", cdi: r.pct ? r.pct * 100 : null, due: null, liquid: true });
  return out;
}

// Net worth of one entity: invested (incl. reserved balances) + checking, per bank.
export function holdings(snapshot, rules, entity) {
  const banks = [];
  for (const it of snapshot.items) {
    if (it.error || entityOf(it.label, rules) !== entity) continue;
    const positions = positionsOf(it);
    const invested = positions.reduce((a, p) => a + p.balance, 0);
    const bankAcc = it.accounts.filter((a) => a.type !== "CREDIT");
    const checking = bankAcc.reduce((a, x) => a + toBRL(x.balance || 0, x.currencyCode, snapshot.fx), 0);
    const foreign = bankAcc.filter((x) => x.currencyCode && x.currencyCode !== "BRL" && x.balance).map((x) => ({ currency: x.currencyCode, amount: x.balance, brl: toBRL(x.balance, x.currencyCode, snapshot.fx) }));
    const cdi = positions.filter((p) => p.cdi);
    const cdiAvg = cdi.length ? cdi.reduce((a, p) => a + p.cdi * p.balance, 0) / cdi.reduce((a, p) => a + p.balance, 0) : null;
    banks.push({ label: it.label, name: bankName(it.label), invested, checking, total: invested + checking, positions, cdiAvg, count: positions.filter((p) => !p.liquid).length, reserved: positions.filter((p) => p.liquid), foreign });
  }
  banks.sort((a, b) => b.total - a.total);
  return { total: banks.reduce((a, b) => a + b.total, 0), banks };
}

export function cards(snapshot, rules, entity, today) {
  const out = [];
  for (const it of snapshot.items) {
    if (it.error || entityOf(it.label, rules) !== entity) continue;
    for (const a of it.accounts) {
      if (a.type !== "CREDIT") continue;
      const next = (a.bills || []).filter((b) => b.dueDate.slice(0, 10) >= today).sort((x, y) => x.dueDate.localeCompare(y.dueDate))[0];
      const due = nextDue(a.credit?.balanceDueDate, today) || next?.dueDate.slice(0, 10) || null;
      out.push({ bank: it.label, name: bankName(it.label), used: a.balance || 0, limit: a.credit?.creditLimit || null, due, ...openBill(a, due) });
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
    const g = groups.get(k) || { due: p.due, bank: b.label, issuer: p.issuer, n: 0, balance: 0, rates: new Set() };
    g.n++; g.balance += p.balance; g.rates.add(p.rate);
    groups.set(k, g);
  }
  const rows = [...groups.values()].map((g) => ({
    ...g, rates: [...g.rates], days: daysBetween(today, g.due),
    tag: /^BRB\b/.test(g.issuer) ? "brb" : concentrated(g.bank, g.issuer) ? "conc" : null,
  }));
  rows.sort((a, b) => a.due.localeCompare(b.due) || b.balance - a.balance);
  const liquid = h.banks.flatMap((b) => b.reserved.map((p) => ({ ...p, bankName: b.name })));
  const conc = Object.entries(share).filter(([k]) => concentrated(...k.split("|")))
    .map(([k, v]) => ({ bank: k.split("|")[0], issuer: k.split("|")[1], share: v })).sort((a, b) => b.share - a.share);
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
// One ladder for Vencimentos: the owner's plus each joint account's, joint rows flagged. Concentration and BRB stay
// per account (computed inside each ladder); totals stay apart, since the joint money is not the owner's.
export function mergeLadders(own, joints = []) {
  const flag = (xs) => xs.map((x) => ({ ...x, joint: true }));
  const rows = [...own.rows, ...joints.flatMap((m) => flag(m.rows))].sort((a, b) => a.due.localeCompare(b.due) || b.balance - a.balance);
  return {
    rows,
    liquid: [...own.liquid, ...joints.flatMap((m) => flag(m.liquid))],
    conc: [...own.conc, ...joints.flatMap((m) => flag(m.conc))],
    brbLast: [own.brbLast, ...joints.map((m) => m.brbLast)].filter(Boolean).sort().at(-1) || null,
    total: own.total,
    jointTotal: joints.reduce((a, m) => a + m.total, 0),
  };
}

// Início's next-30-days list: bills going out, maturities (own and joint), and the forecast salary coming in.
export function timeline({ cards = [], mat, salary = [], today, days = 30 }) {
  const out = [];
  for (const c of cards) if (c.due && c.bill > 0 && daysBetween(today, c.due) >= 0 && daysBetween(today, c.due) <= days) out.push({ date: c.due, kind: "bill", name: `Fatura ${c.name}`, amount: -c.bill, early: c.early || 0 });
  for (const r of mat.rows) if (r.days >= 0 && r.days <= days) out.push({ date: r.due, kind: "maturity", name: `${r.issuer}${r.n > 1 ? ` ×${r.n}` : ""} vence`, bank: r.bank, joint: Boolean(r.joint), rates: r.rates, amount: r.balance, brb: r.tag === "brb" });
  for (const f of salary) out.push({ date: f.date, kind: "salary", from: f.from, amount: f.amount, forecast: true });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

export function alerts({ mine, joint, mat, cards, today }, { idleCash = 5000, cdbMin = 110, soonDays = 30, billDays = 5 } = {}) {
  const out = [];
  const idle = (h, scope) => h.banks.filter((b) => b.checking > idleCash).forEach((b) => out.push({ kind: "idle", scope, bank: b.name, amount: b.checking }));
  idle(mine, "mine");
  for (const j of joint) idle(j.holdings, "joint");
  for (const r of mat.rows.filter((r) => r.days >= 0 && r.days <= soonDays)) out.push({ kind: "maturity", issuer: r.issuer, n: r.n, due: r.due, days: r.days, amount: r.balance, brb: r.tag === "brb", cdbMin, scope: r.joint ? "joint" : "mine" });
  for (const c of cards.filter((c) => c.due && c.bill > 0)) {
    const d = daysBetween(today, c.due);
    if (d >= 0 && d <= billDays) out.push({ kind: "bill", bank: c.name, due: c.due, days: d, amount: c.bill });
  }
  const rank = { bill: 0, maturity: 1, idle: 2 };
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
        const name = t.description.split("|").at(-1).replace(/\s*\d+\/\d+\s*$/, "").replace(/\s+-?\s*NuPay\s*$/i, "").trim();
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
