// The agenda: everything dated ahead, in one list. Card bills (the open one, and the months ahead with the installments
// already posted), the monthly bills paid by hand (with ✓ once the charge shows), renewals, maturities and the forecast
// salary. Pure; Início shows the next 30 days of it and Início › Agenda up to 90.
import { timeline } from "./model.js";
import { nextMonthly, monthlyPayment, upcomingRenewals } from "./decisions.js";
import { daysBetween } from "./format.js";

const addMonths = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const dueIn = (ym, day) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, "0")}`; };

export function agenda({ cards = [], bills = [], mat, salary = [], monthly = [], renewals = [], snapshot = null, cash = null, today, days = 90 }) {
  const fromReserve = (bank) => Boolean(cash?.earmark && cash.billBank === bank);
  const out = timeline({ cards, mat, salary, today, days }).map((e) => ({ ...e, pay: e.kind === "bill", ...(e.kind === "bill" && fromReserve(e.bank) && { reserve: true }) }));
  const inWindow = (d) => daysBetween(today, d) >= 0 && daysBetween(today, d) <= days;
  // Bills after the open one, on the card's due day: the installments already posted, or the card's usual bill (median
  // of its last 6) when that is more, since new purchases have not happened yet.
  for (const c of cards) {
    if (!c.due) continue;
    for (let k = 1; k <= 3; k++) {
      const month = addMonths(c.due.slice(0, 7), k), date = dueIn(month, Number(c.due.slice(8, 10)));
      if (!inWindow(date)) continue;
      const posted = (bills.find((m) => m.month === month && !m.open)?.rows || []).filter((r) => r.bank === c.bank).reduce((a, r) => a + r.amount, 0);
      const est = c.typical > posted;
      const amount = est ? c.typical : posted;
      if (!(amount > 0)) continue;
      out.push({ date, kind: "bill", bank: c.bank, name: `Fatura ${c.name}`, amount: -amount, pay: true, partial: !est, est, posted, ...(fromReserve(c.bank) && { reserve: true }) });
    }
  }
  for (const m of nextMonthly(monthly, today, snapshot)) {
    const paid = monthlyPayment(snapshot, m, m.due);
    if (!paid && m.due < today) { out.push({ date: m.due, kind: "monthly", name: m.name, amount: -(m.amount || 0), pay: true, late: true, card: Boolean(m.card), note: m.note }); continue; }
    if (!inWindow(m.due) && !(paid && m.due >= today)) continue;
    out.push({ date: m.due, kind: "monthly", name: m.name, amount: -(paid?.amount ?? m.amount ?? 0), pay: true, approx: !paid, paid: paid?.date || null, card: Boolean(m.card), note: m.note });
  }
  for (const r of upcomingRenewals(renewals, today, days)) out.push({ date: r.date, kind: "renewal", name: `${r.name} renova`, amount: r.amount != null ? -r.amount : null, note: r.note || null });
  out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  // The checking balance after each line that moves it: unpaid bills and contas paid from the account go out, the
  // forecast salary comes in. A conta on the card moves nothing here (it leaves with that card's bill).
  // A card bill paid from the money set apart for it (Ajustes › Metas) draws on that instead, and says when it is short.
  if (cash) {
    let bal = cash.checking, kept = cash.earmark || 0;
    for (const e of out) {
      if (e.reserve && !e.paid) { kept += e.amount || 0; e.kept = kept; continue; }
      const d = moves(e);
      if (!d) continue;
      bal += d;
      e.balance = bal;
    }
  }
  return out;
}

const moves = (e) => (e.kind === "salary" ? e.amount : e.pay && !e.paid && !e.card && !e.reserve ? e.amount || 0 : 0);

// Banks whose own investments are the daily-liquidity reserve (Nubank's caixinhas come through as CDBs, unnamed).
export const RESERVE_BANKS = ["nubank"];

// The owner's money: checking (what bills are paid from) and the daily-liquidity reserve beside it, of which
// `earmark` (Ajustes › Metas) is set apart to pay that bank's card bill; `free` is the rest.
export function cashOf(mine, { earmark = 0 } = {}) {
  const banks = (mine?.banks || []).filter((b) => !b.joint);
  const res = banks.filter((b) => RESERVE_BANKS.includes(b.label));
  const reserve = res.reduce((a, b) => a + (b.invested || 0), 0) + banks.filter((b) => !RESERVE_BANKS.includes(b.label)).reduce((a, b) => a + (b.reserved || []).reduce((x, p) => x + (p.balance || 0), 0), 0);
  const kept = Math.min(Math.max(0, earmark || 0), res.reduce((a, b) => a + (b.invested || 0), 0));
  return { checking: banks.reduce((a, b) => a + (b.checking || 0), 0), reserve, earmark: kept, free: reserve - kept, billBank: kept ? RESERVE_BANKS[0] : null };
}

// The lowest the account gets over the list, and on which day (null when it never moves).
export function lowPoint(list) {
  let low = null;
  for (const e of list) if (e.balance != null && (!low || e.balance < low.balance)) low = { balance: e.balance, date: e.date };
  return low;
}

// The first bill the set-apart money does not cover: { date, short } or null.
export function keptShort(list) {
  const e = list.find((x) => x.kept != null && x.kept < 0);
  return e ? { date: e.date, short: -e.kept, name: e.name } : null;
}

// What goes out and comes in over the list (unpaid, from the account; a conta on the card is in its bill already;
// maturities are money already yours, not income).
// out: from the account · reserve: from the money set apart for the card · pay: both (what there is to pay).
export function agendaTotals(list) {
  let out = 0, inn = 0, reserve = 0;
  for (const e of list) {
    if (e.pay && !e.paid && !e.card) { if (e.reserve) reserve += -(e.amount || 0); else out += -(e.amount || 0); }
    if (e.kind === "salary") inn += e.amount;
  }
  return { out, in: inn, reserve, pay: out + reserve };
}
