// Turns a Pluggy pull into what the screens show. Pure functions, no DOM, no network.
import { entityOf } from "./categorize.js";
import { reservedHoldings } from "./pluggy.js";
import { daysBetween } from "./format.js";

export const BANKS = {
  nubank: { name: "Nubank", color: "#8a05be" },
  xp: { name: "XP", color: "var(--ink)" },
  itau: { name: "Itaú", color: "var(--joint)" },
  neon: { name: "Neon", color: "#00a3b4" },
  mercadopago: { name: "Mercado Pago", color: "#00b1ea" },
};
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
        item: pick(it.item, ["id", "status", "executionStatus", "consentExpiresAt", "lastUpdatedAt"]),
        accounts: it.accounts.map((a) => ({
          ...pick(a, ["id", "type", "subtype", "name", "balance"]),
          reserved: reservedHoldings(a).flatMap((r) =>
            (r.availableAmounts || []).filter((x) => x.amount).map((x) => ({ name: r.name, amount: x.amount, pct: x.remuneration?.postFixedIndexerPercentage ?? null })),
          ),
          credit: a.type === "CREDIT" ? pick(a.creditData || {}, ["creditLimit", "availableCreditLimit", "balanceDueDate", "balanceCloseDate"]) : undefined,
          bills: a.bills?.map((b) => pick(b, ["dueDate", "totalAmount"])),
          transactions: a.transactions.map((t) => {
            const out = pick(t, TX);
            const m = t.creditCardMetadata;
            if (m) out.card = pick(m, ["billForecastDate", "paymentType", "installmentNumber", "totalInstallments"]);
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
    const checking = it.accounts.filter((a) => a.type !== "CREDIT").reduce((a, x) => a + (x.balance || 0), 0);
    const cdi = positions.filter((p) => p.cdi);
    const cdiAvg = cdi.length ? cdi.reduce((a, p) => a + p.cdi * p.balance, 0) / cdi.reduce((a, p) => a + p.balance, 0) : null;
    banks.push({ label: it.label, name: bankName(it.label), invested, checking, total: invested + checking, positions, cdiAvg, count: positions.filter((p) => !p.liquid).length, reserved: positions.filter((p) => p.liquid) });
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
    if (!p.due) continue;
    const k = `${p.due}|${b.label}|${p.issuer}`;
    const g = groups.get(k) || { due: p.due, bank: b.label, issuer: p.issuer, n: 0, balance: 0, rates: new Set() };
    g.n++; g.balance += p.balance; g.rates.add(p.rate);
    groups.set(k, g);
  }
  const rows = [...groups.values()].map((g) => ({
    ...g, rates: [...g.rates], days: daysBetween(today, g.due),
    tag: /^BRB\b/.test(g.issuer) ? "brb" : concentrated(g.bank, g.issuer) ? "conc" : g.bank === "nubank" ? "liquid" : null,
  }));
  rows.sort((a, b) => a.due.localeCompare(b.due) || b.balance - a.balance);
  const liquid = h.banks.flatMap((b) => b.reserved.map((p) => ({ ...p, bankName: b.name })));
  const conc = Object.entries(share).filter(([k]) => concentrated(...k.split("|")))
    .map(([k, v]) => ({ bank: k.split("|")[0], issuer: k.split("|")[1], share: v })).sort((a, b) => b.share - a.share);
  const brbLast = rows.filter((r) => r.tag === "brb").map((r) => r.due).sort().at(-1) || null;
  return { rows, liquid, conc, brbLast, total: rows.reduce((a, r) => a + r.balance, 0) };
}

export function itemStatus(snapshot) {
  return snapshot.items.map((it) => ({ label: it.label, name: bankName(it.label), ok: !it.error && it.item?.status === "UPDATED", error: it.error || null, status: it.item?.status || null, consent: it.item?.consentExpiresAt?.slice(0, 10) || null }));
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
  return { bill: Math.max(0, charges - early), charges, early, ahead, exact: true };
}
