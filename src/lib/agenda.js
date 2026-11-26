// The agenda: everything dated ahead, in one list. Card bills (the open one, and the months ahead with the installments
// already posted), the monthly bills paid by hand (with ✓ once the charge shows), renewals, maturities and the forecast
// salary. Pure; Início shows the next 30 days of it and Início › Agenda up to 90.
import { timeline, bankName } from "./model.js";
import { nextMonthly, monthlyPayment, upcomingRenewals } from "./decisions.js";
import { daysBetween } from "./format.js";

const dueIn = (ym, day) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, "0")}`; };

export function agenda({ cards = [], bills = [], mat, salary = [], monthly = [], renewals = [], snapshot = null, cash = null, today, days = 90 }) {
  const out = timeline({ cards, mat, salary, today, days }).map((e) => ({ ...e, pay: e.kind === "bill" }));
  const inWindow = (d) => daysBetween(today, d) >= 0 && daysBetween(today, d) <= days;
  // Bills after the open one: only what is already posted (installments), on the card's usual due day.
  for (const m of bills) {
    if (m.open) continue;
    const per = new Map();
    for (const r of m.rows) per.set(r.bank, (per.get(r.bank) || 0) + r.amount);
    for (const [bank, amount] of per) {
      const c = cards.find((x) => x.bank === bank && x.due);
      if (!c || !(amount > 0)) continue;
      const date = dueIn(m.month, Number(c.due.slice(8, 10)));
      if (inWindow(date)) out.push({ date, kind: "bill", name: `Fatura ${bankName(bank)}`, amount: -amount, pay: true, partial: true });
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
  if (cash) {
    let bal = cash.checking;
    for (const e of out) {
      const d = moves(e);
      if (!d) continue;
      bal += d;
      e.balance = bal;
    }
  }
  return out;
}

const moves = (e) => (e.kind === "salary" ? e.amount : e.pay && !e.paid && !e.card ? e.amount || 0 : 0);

// The owner's money: checking (what bills are paid from) and the daily-liquidity reserve beside it.
export function cashOf(mine) {
  const banks = (mine?.banks || []).filter((b) => !b.joint);
  return {
    checking: banks.reduce((a, b) => a + (b.checking || 0), 0),
    reserve: banks.reduce((a, b) => a + (b.reserved || []).reduce((x, p) => x + (p.balance || 0), 0), 0),
  };
}

// The lowest the account gets over the list, and on which day (null when it never moves).
export function lowPoint(list) {
  let low = null;
  for (const e of list) if (e.balance != null && (!low || e.balance < low.balance)) low = { balance: e.balance, date: e.date };
  return low;
}

// What goes out and comes in over the list (unpaid, from the account; a conta on the card is in its bill already;
// maturities are money already yours, not income).
export function agendaTotals(list) {
  let out = 0, inn = 0;
  for (const e of list) {
    if (e.pay && !e.paid && !e.card) out += -(e.amount || 0);
    if (e.kind === "salary") inn += e.amount;
  }
  return { out, in: inn };
}
