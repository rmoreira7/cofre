// Decisions: what is open, what was decided, and how it turned out. Pure, no DOM; shared by the app and the watcher.
import { daysBetween } from "./format.js";

// Renewals (subscriptions, annual plans) come from the rules file's `renewals`: [{ name, date: "YYYY-MM-DD", note?,
// amount?, every?: "month" | "year" }]. The personal list lives on the laptop, never in this repository.
export function validRenewals(list) {
  return Array.isArray(list) && list.every((r) => r && typeof r.name === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date)
    && (r.note == null || typeof r.note === "string") && (r.amount == null || Number.isFinite(r.amount)));
}

// The renewals still ahead, nearest first, with the days left; `within` days at most.
export function upcomingRenewals(list, today, within = 60) {
  return (list || []).map((r) => ({ ...r, days: daysBetween(today, r.date) }))
    .filter((r) => r.days >= 0 && r.days <= within)
    .sort((a, b) => a.days - b.days);
}

// What money parked in a checking account costs per business day at today's CDI (% per business day).
export const idleCost = (amount, cdiDaily) => (cdiDaily ? (amount * cdiDaily) / 100 : null);

// ---------- Open decisions ----------
// A decision: { id, kind, title, due, days, amount, bank, joint, detail, suggestion?, cost? }. The id is stable for as
// long as the situation is the same one (this maturity, this bill), so a record made on it keeps applying.
export const BILL_WINDOW = 10; // a bill becomes a decision this many days before it is due
export const MATURITY_WINDOW = 30;
export const MATURITY_GRACE = 10; // a maturity stays open this long after its date, while the money is not reinvested
export const RENEWAL_WINDOW = 30;
export const SNOOZE_DAYS = 7;
export const KEEP_DAYS = 180; // decided records older than this are dropped

const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const term = (m) => (m % 12 === 0 ? `${m / 12} ${m === 12 ? "ano" : "anos"}` : `${m} meses`);

// v: the app's view (cards, mat, wealth, guarantee); lad: the ladder simulation (its plan sizes each maturity's split).
export function candidates(v, { lad, renewals = [], idleCash = 5000, cdbMin = 110, cdiDaily = null, today }) {
  const out = [];
  for (const c of v.cards) {
    if (!c.due || !(c.bill > 0)) continue;
    const days = daysBetween(today, c.due);
    if (days >= 0 && days <= BILL_WINDOW) out.push({ id: `bill:${c.bank}:${c.due}`, kind: "bill", title: `Pagar ${c.name}`, name: c.name, due: c.due, days, amount: c.bill, bank: c.bank,
      detail: c.exact && c.early ? { early: c.early, charges: c.charges } : null });
  }
  for (const r of v.mat.rows) {
    if (r.days > MATURITY_WINDOW || r.days < -MATURITY_GRACE) continue;
    const p = lad?.plan.find((x) => x.due === r.due);
    const rung = (m) => lad?.now.find((x) => m <= x.max)?.label;
    out.push({ id: `mat:${r.bank}:${r.issuer}:${r.due}`, kind: "maturity", title: `Reaplicar ${r.issuer}${r.n > 1 ? ` ×${r.n}` : ""}`, issuer: r.issuer, n: r.n, due: r.due, days: r.days, amount: r.balance, bank: r.bank, joint: Boolean(r.joint), brb: r.tag === "brb", cdbMin,
      suggestion: p?.buys.length ? p.buys.map((b) => ({ amount: b.amount, term: term(b.months), rung: rung(b.months) })) : null,
      rule: `CDB ≥ ${cdbMin}% CDI, outro emissor`, cost: idleCost(r.balance, cdiDaily) });
  }
  for (const b of v.wealth.banks) {
    if (!(b.checking > idleCash)) continue;
    // name is the bank's display name (for messages), bank its label (for the id and the checks).
    const amount = b.checking - idleCash;
    out.push({ id: `idle:${b.label}`, kind: "idle", title: `Investir o parado no ${b.name}`, name: b.name, due: today, days: 0, amount, bank: b.label, joint: b.joint,
      detail: { balance: b.checking, reserve: idleCash }, cost: idleCost(b.checking, cdiDaily) });
  }
  for (const e of v.guarantee?.issuers.filter((x) => x.over) || []) out.push({ id: `fgc:${e.issuer}`, kind: "fgc", title: `Tirar o excesso de ${e.issuer}`, issuer: e.issuer, due: today, days: 0, amount: e.over, joint: e.joint, detail: { total: e.amount } });
  for (const r of upcomingRenewals(renewals, today, RENEWAL_WINDOW)) out.push({ id: `ren:${r.name}:${r.date}`, kind: "renewal", title: `${r.name} renova`, name: r.name, due: r.date, days: r.days, amount: r.amount ?? null, every: r.every, detail: r.note || null });
  return out.sort((a, b) => a.days - b.days || (b.amount || 0) - (a.amount || 0));
}

// What is coming but not open yet: renewals within a year and maturities within 90 days, past the windows above.
export function upcoming(v, { renewals = [], today }) {
  const ren = upcomingRenewals(renewals, today, 365).filter((r) => r.days > RENEWAL_WINDOW).map((r) => ({ kind: "renewal", title: `${r.name} renova`, due: r.date, opens: addDays(r.date, -RENEWAL_WINDOW), detail: r.note || null }));
  const mat = v.mat.rows.filter((r) => r.days > MATURITY_WINDOW && r.days <= 90).map((r) => ({ kind: "maturity", title: `${r.issuer}${r.n > 1 ? ` ×${r.n}` : ""} vence`, due: r.due, opens: addDays(r.due, -MATURITY_WINDOW), amount: r.balance, joint: Boolean(r.joint) }));
  return [...mat, ...ren].sort((a, b) => a.due.localeCompare(b.due));
}

// ---------- Records and outcomes ----------
// records: { [id]: { status: "done" | "other" | "snoozed", at, ts, by?, until?, note?, d: the decision as it was } }
// ts (ms) orders the phone's and Telegram's records when they are merged (src/lib/sync.js); by: "app" | "telegram".

export function decide(records, d, status, { today, note = null, ts = Date.now(), by = null } = {}) {
  records = Object.fromEntries(Object.entries(records || {}).filter(([, r]) => daysBetween(r.at, today) <= KEEP_DAYS));
  const left = d.due ? daysBetween(today, d.due) : 0; // counted from today, not from when the decision was built
  const until = status === "snoozed" ? addDays(today, left > 0 ? Math.min(SNOOZE_DAYS, left) : SNOOZE_DAYS) : undefined;
  return { ...records, [d.id]: { status, at: today, ts, ...(by && { by }), ...(until && { until }), ...(note && { note }), d } };
}

export function undo(records, id) {
  const { [id]: _, ...rest } = records || {};
  return rest;
}

// Checked against the bank data: "ok" confirmed · "wait" not yet visible · "no" not found in the window · "manual"
// (nothing to check: renewals, or a different choice). With what was found, for the history line.
export function outcome(rec, snapshot, { today, idleCash = 5000 } = {}) {
  const d = rec.d;
  if (rec.status === "other" || d.kind === "renewal") return { state: "manual" };
  const item = snapshot?.items.find((it) => it.label === d.bank && !it.error);
  if (d.kind === "maturity") {
    const from = addDays(d.due, -3), to = addDays(d.due, 10);
    const bought = (item?.investments || []).filter((i) => i.purchaseDate && i.purchaseDate.slice(0, 10) >= from && i.purchaseDate.slice(0, 10) <= to);
    const total = bought.reduce((a, i) => a + (i.amountOriginal || i.balance || 0), 0);
    if (total >= 0.8 * d.amount) {
      const cdi = bought.filter((i) => i.rateType === "CDI" && i.rate);
      const w = cdi.reduce((a, i) => a + (i.amountOriginal || i.balance), 0);
      return { state: "ok", total, n: bought.length, cdi: w ? cdi.reduce((a, i) => a + i.rate * (i.amountOriginal || i.balance), 0) / w : null };
    }
    return { state: today > to ? "no" : "wait", total };
  }
  if (d.kind === "idle") {
    const balance = (item?.accounts || []).filter((a) => a.type !== "CREDIT").reduce((a, x) => a + (x.balance || 0), 0);
    if (balance <= idleCash * 1.2) return { state: "ok", balance };
    return { state: daysBetween(rec.at, today) > 7 ? "no" : "wait", balance };
  }
  if (d.kind === "bill") {
    const card = (item?.accounts || []).find((a) => a.type === "CREDIT");
    const paid = (card?.transactions || []).filter((t) => t.operationType === "PAGAMENTO_FATURA" && t.date.slice(0, 10) >= addDays(rec.at, -3) && t.date.slice(0, 10) <= addDays(d.due, 3)).reduce((a, t) => a - t.amount, 0);
    if (paid >= 0.9 * d.amount) return { state: "ok", paid };
    return { state: today > addDays(d.due, 3) ? "no" : "wait", paid };
  }
  if (d.kind === "fgc") return { state: "wait" };
  return { state: "manual" };
}

// The three lists the Decisões tab shows. A snoozed decision comes back on its date; a decided one leaves "open", and
// returns only when its check fails ("no"): the money is still parked, the bill unpaid.
export function board(cands, records, snapshot, opts) {
  const open = [], snoozed = [], decided = [];
  for (const d of cands) {
    const r = records?.[d.id];
    if (!r) { open.push(d); continue; }
    if (r.status === "snoozed") { (r.until > opts.today ? snoozed : open).push(r.until > opts.today ? { ...d, until: r.until } : d); continue; }
    const o = outcome(r, snapshot, opts);
    if (o.state === "no") open.push({ ...d, failed: r.at });
  }
  for (const [id, r] of Object.entries(records || {})) {
    if (r.status === "snoozed") continue;
    decided.push({ id, ...r, outcome: outcome(r, snapshot, opts) });
  }
  decided.sort((a, b) => b.at.localeCompare(a.at));
  return { open, snoozed, decided };
}
