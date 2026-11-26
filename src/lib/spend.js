// Spending: a port of the spend side of finance/pluggy/analyze.py build(), plus the clusters of design §5.
import { categorize, learn, entityOf } from "./categorize.js";
import { cleanCard, refundMatches, refundTarget } from "./cardtx.js";
import { BANKS } from "./model.js";

export const DEFAULT_TARGET = 7000;

export const CLUSTERS = [
  { id: "travel", label: "Viagem", limit: 2000, cats: ["Airport and airlines", "Accomodation", "Sent abroad (Wise)", "Travel (NuViagens)", "Travel", "Mileage programs", "Bus tickets", "Tax on financial operations"] },
  { id: "food", label: "Alimentação", limit: 2000, cats: ["Eating out", "Groceries", "Food delivery", "Food and drinks"] },
  { id: "shop", label: "Compras", limit: 550, cats: ["Shopping", "Clothing", "Houseware", "Kids and toys", "Bookstore", "Sports goods", "Online shopping", "Electronics", "Office supplies"] },
  { id: "serv", label: "Serviços", limit: 500, cats: ["Services", "Digital services"] },
  { id: "pix", label: "PIX p/ pessoas", limit: 500, cats: ["PIX to people", "Transfers (other)"] },
  { id: "trans", label: "Transporte", limit: 500, cats: ["Taxi and ride-hailing", "Public transportation", "Gas stations", "Parking", "Vehicle maintenance", "Transportation", "Automotive"] },
  { id: "bills", label: "Contas", limit: 430, cats: ["Telecommunications", "Mobile", "Internet", "Payments (boletos)", "Payments (NuPay)", "Housing", "Electricity", "Insurance"] },
  { id: "health", label: "Saúde", limit: 300, cats: ["Dentist", "Hospital clinics and labs", "Pharmacy", "Wellness and fitness", "Optometry", "Healthcare"] },
  { id: "leis", label: "Lazer", limit: 170, cats: ["Tickets", "Leisure", "Sports practice", "Gambling"] },
  { id: "tobacco", label: "Tabaco", limit: 50, cats: ["Tobacco"] },
  { id: "cash", label: "Saques", limit: 300, cats: ["Cash withdrawals"] },
  { id: "other", label: "Outros", limit: null, cats: [] },
];
const CLUSTER_OF = new Map(CLUSTERS.flatMap((c) => c.cats.map((cat) => [cat, c.id])));
export const clusterOf = (cat) => CLUSTER_OF.get(cat) || "other";

const SELF_CATS = new Set(["Same person transfer", "Transfer - Internal"]);
const INTERNAL_CATS = new Set([...SELF_CATS, "Investments"]);
const INTERNAL_DESC = /^(Pagamento de fatura|Aplicação|Vencimento|Resgate)|COMPRA (CDB|CDI|LC[AI]?|CR[AI]|FUNDO|TESOURO)|APLICA[CÇ][AÃ]O (CDB|CDI|LC[AI]?|CR[AI]|FUNDO|TESOURO)|COR COMP (CDB|LC[AI]|CR[AI])|conta investimento|conta digital|FUNDO GARANTIDOR/i;

export function isInternal(x, cat) {
  return INTERNAL_CATS.has(cat) || x.operationType === "RESGATE_APLIC_FINANCEIRA" || INTERNAL_DESC.test(x.description);
}

// pulled: pluggy.pullAll() output (or a snapshot of the same shape). Returns one entity's spend rows.
// Card cycles: closing dates of the entity's main card, plus an estimate for the open one (last + 1 month).
// A spending "month" then runs from one closing to the next and is named after the month most of it covers.
export function cardCycles(pulled, { rules, entity }) {
  let best = null;
  for (const it of pulled.items) {
    if (it.error || entityOf(it.label, rules) !== entity) continue;
    for (const a of it.accounts) {
      if (a.type !== "CREDIT") continue;
      const closes = (a.bills || []).map((b) => (b.billClosingDate || "").slice(0, 10)).filter(Boolean).sort();
      if (closes.length && (!best || a.transactions.length > best.n)) best = { closes, n: a.transactions.length };
    }
  }
  if (!best) return null;
  const last = best.closes.at(-1);
  const closes = [...best.closes];
  for (let i = 1; i <= 2; i++) closes.push(addMonthsDate(last, i));
  return { closes };
}

function addMonthsDate(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// The cycle a date belongs to: the first closing after it, named by that closing's month.
export function cycleOf(date, cycles) {
  const c = cycles.closes.find((x) => date < x);
  return c ? c.slice(0, 7) : date.slice(0, 7);
}

export function cycleBounds(label, cycles) {
  const i = cycles.closes.findIndex((x) => x.slice(0, 7) === label);
  if (i < 0) return null;
  const end = addMonthsDate(cycles.closes[i], 0);
  const start = i > 0 ? cycles.closes[i - 1] : addMonthsDate(end, -1);
  return { start, end };
}

export function spendRows(pulled, { rules, compiled, entity, today, cycles = null }) {
  const items = pulled.items.filter((it) => !it.error && entityOf(it.label, rules) === entity);
  const card = [], bank = [], refunds = new Map(), histBank = new Set();
  const h = rules.history && entityOf(rules.history.bank, rules) === entity ? rules.history : null;
  for (const it of items) for (const a of it.accounts) {
    if (a.type !== "CREDIT") { bank.push(...a.transactions); continue; }
    const txs = cleanCard(a.transactions);
    card.push(...txs);
    if (h && it.label === h.bank) txs.forEach((t) => histBank.add(t));
    for (const [r, o] of refundMatches(txs)) refunds.set(r, o);
  }
  // Bill history (CSV statements) for the cycles before Pluggy's data: it replaces that bank's card rows up to
  // h.until, so each cycle has exactly one source. In calendar mode, only history days before Pluggy's first row.
  const hist = h ? h.rows.map(([cyc, d, description, amount], i) => ({ id: `h${i}`, cyc, date: `${d}T12:00:00Z`, amount, description, operationType: "X", category: null, status: "POSTED" })) : [];
  const firstPluggy = [...histBank].reduce((a, t) => (t.date < a ? t.date : a), "9999").slice(0, 10);
  const histRefunds = refundMatches(hist);
  for (const [r, o] of histRefunds) refunds.set(r, o);
  const learned = { ...rules.learned, ...learn([...card, ...bank].map((x) => [x.description, x.category ?? null])) };
  const cat = (src, x) => categorize({ src, op: x.operationType, desc: x.description, pluggy: x.category ?? null }, compiled, learned, entity);

  const rows = [];
  for (const x of [...card, ...hist]) {
    const d = x.date.slice(0, 10);
    if (d > today || x.operationType === "PAGAMENTO_FATURA") continue;
    if (x.cyc && !cycles && d >= firstPluggy) continue;
    if (x.amount > 0) rows.push(row(d, x.amount, cat("card", x), "card", x, cycles));
    else if (refunds.has(x)) {
      const orig = refunds.get(x);
      const c = orig ? cat("card", orig) : /^IOF/i.test(x.description) ? "Tax on financial operations" : cat("card", { ...x, description: refundTarget(x.description), category: null });
      rows.push(row(d, x.amount, c, "card", x, cycles));
    }
  }
  if (h) for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i], x = r._x;
    if (x.cyc) { if (cycles) r.cyc = x.cyc; r.hist = true; }
    else if (cycles && histBank.has(x) && r.cyc <= h.until) rows.splice(i, 1);
  }
  for (const x of bank) {
    const d = x.date.slice(0, 10);
    if (x.amount >= 0 || d > today) continue;
    const c = cat("bank", x);
    if (isInternal(x, c)) continue;
    rows.push(row(d, -x.amount, c, "account", x, cycles));
  }
  for (const r of rows) delete r._x;
  return rows;
}

// Bank codes (COMPE) → names, for the salary line. Unknown codes show as "banco <code>".
export const BANK_CODES = { 1: "Banco do Brasil", 33: "Santander", 77: "Inter", 102: "XP", 104: "Caixa", 212: "Original", 237: "Bradesco", 260: "Nubank", 290: "PagBank", 323: "Mercado Pago", 336: "C6", 341: "Itaú", 348: "XP", 380: "PicPay", 536: "Neon", 655: "Neon" };
const YIELD_CATS = new Set(["Proceeds interests and dividends", "Interests charged"]);

// Money coming in to the entity's accounts, per cycle. Salary = a same-person transfer from a bank none of the
// connected accounts is at (the payroll account Pluggy doesn't see); a same-person transfer between connected banks,
// investment movements and card refunds are internal. Everything else that comes in (PIX from people, account
// interest) is "other".
export function incomeRows(pulled, { rules, compiled, entity, today, cycles = null }) {
  const own = new Set(pulled.items.flatMap((it) => BANKS[it.label]?.codes || []));
  for (const it of pulled.items) if (!it.error) for (const a of it.accounts) if (a.type !== "CREDIT") for (const t of a.transactions) if (t.amount > 0 && t.to) own.add(t.to);
  const items = pulled.items.filter((it) => !it.error && entityOf(it.label, rules) === entity);
  const bank = items.flatMap((it) => it.accounts.filter((a) => a.type !== "CREDIT").flatMap((a) => a.transactions));
  const learned = { ...rules.learned, ...learn(bank.map((x) => [x.description, x.category ?? null])) };
  const rows = [];
  for (const x of bank) {
    const d = x.date.slice(0, 10);
    if (!(x.amount > 0) || d > today || x.operationType === "CARTAO") continue;
    const c = categorize({ src: "bank", op: x.operationType, desc: x.description, pluggy: x.category ?? null }, compiled, learned, entity);
    let kind;
    if (SELF_CATS.has(c) || x.category === "Same person transfer") {
      if (!x.from || own.has(x.from)) continue;
      kind = "salary";
    } else if (isInternal(x, c)) continue;
    else kind = YIELD_CATS.has(c) || x.operationType === "RENDIMENTO_APLIC_FINANCEIRA" ? "yield" : "other";
    const r = { d, m: d.slice(0, 7), amt: x.amount, kind, from: x.from || null, desc: x.description };
    if (cycles) r.cyc = cycleOf(d, cycles);
    rows.push(r);
  }
  return rows;
}

// Income − spending for one cycle (or calendar month). oneOff = single non-salary entries ≥ ONE_OFF (a sale, a
// family transfer): real money, but kept out of `regular`, which is what averages and trends use.
export const ONE_OFF = 5000;
export function leftover(income, spend, months, key = "m") {
  const per = (m) => {
    const inc = income.filter((r) => r[key] === m);
    const salary = inc.filter((r) => r.kind === "salary").reduce((a, r) => a + r.amt, 0);
    const other = inc.filter((r) => r.kind !== "salary").reduce((a, r) => a + r.amt, 0);
    const oneOff = inc.filter((r) => r.kind !== "salary" && r.amt >= ONE_OFF).reduce((a, r) => a + r.amt, 0);
    const spent = spend.filter((r) => r[key] === m && !r.hist).reduce((a, r) => a + r.amt, 0);
    return { month: m, salary, other, oneOff, income: salary + other, spent, left: salary + other - spent, regular: salary + other - oneOff - spent };
  };
  return months.map(per);
}

// Salary still to come in the next `days`: each pay slot (paid up to the 15th / after the 15th) seen in ≥ 3 of the
// last 6 months gives its median day and the median of its last 3 amounts. A month that already got that slot's
// payment is skipped. Output rows are forecasts, not data.
const toFriday = (iso) => { const w = new Date(iso + "T12:00:00Z").getUTCDay(); return w === 6 ? addDays(iso, -1) : w === 0 ? addDays(iso, -2) : iso; };
export function salaryForecast(income, { today, days = 30 }) {
  const sal = income.filter((r) => r.kind === "salary" && r.d <= today && r.d >= addDays(today, -183)).sort((a, b) => a.d.localeCompare(b.d));
  const slotOf = (d) => (Number(d.slice(8, 10)) <= 15 ? 0 : 1);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const end = addDays(today, days), out = [];
  for (const slot of [0, 1]) {
    const rows = sal.filter((r) => slotOf(r.d) === slot);
    if (new Set(rows.map((r) => r.m)).size < 3) continue;
    const day = Math.round(median(rows.map((r) => Number(r.d.slice(8, 10)))));
    const amount = median(rows.slice(-3).map((r) => r.amt));
    const from = rows.at(-1).from;
    for (const m of [today.slice(0, 7), addMonths(today.slice(0, 7), 1), addMonths(today.slice(0, 7), 2)]) {
      const [y, mo] = m.split("-").map(Number);
      // Paid on the business day before when the day falls on a weekend: Saturday or Sunday → Friday.
      const date = toFriday(`${m}-${String(Math.min(day, new Date(Date.UTC(y, mo, 0)).getUTCDate())).padStart(2, "0")}`);
      if (date < today || date > end || income.some((r) => r.kind === "salary" && r.m === m && slotOf(r.d) === slot)) continue;
      out.push({ date, amount, from });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function row(d, amt, cat, src, x, cycles) {
  const r = { d, m: d.slice(0, 7), amt, cat, cluster: clusterOf(cat), src, desc: x.description, pending: x.status === "PENDING", _x: x };
  if (cycles) {
    // A card purchase belongs to the bill the issuer put it on (forecast month − 1 = the cycle's name).
    const f = (x.creditCardMetadata || x.card)?.billForecastDate?.slice(0, 7);
    r.cyc = src === "card" && f ? addMonths(f, -1) : cycleOf(d, cycles);
  }
  return r;
}

// { "YYYY-MM": { [key]: total } }, key = category (by = "cat") or cluster id (by = "cluster")
export function byMonth(rows, by = "cat", src = null, key = "m") {
  const out = {};
  for (const r of rows) {
    if (src && r.src !== src) continue;
    const m = (out[r[key] ?? r.m] ||= {});
    m[r[by]] = (m[r[by]] || 0) + r.amt;
  }
  return out;
}

export const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

export function monthRange(a, b) {
  const out = [];
  let [y, m] = a.split("-").map(Number);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (k > b) return out;
    out.push(k);
    if (++m === 13) { y++; m = 1; }
  }
}

function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

// Per-group series over the closed months: the mean of all of them and of the last 3, and the median.
export function clusterTrends(byM, keys) {
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const median = (a) => { const o = [...a].sort((x, y) => x - y), h = o.length >> 1; return o.length % 2 ? o[h] : o.length ? (o[h - 1] + o[h]) / 2 : 0; };
  return Object.fromEntries(CLUSTERS.map((c) => {
    const series = keys.map((k) => byM[k]?.[c.id] || 0);
    return [c.id, { series, avg: mean(series), avg3: mean(series.slice(-3)), median: median(series) }];
  }));
}

// A target the income can pay for: 90% of the regular income, to the R$ 500. Group limits = each group's median
// (one outlier cycle doesn't inflate it) scaled to that target, to the R$ 50; the rounding remainder goes to the
// largest group so they add up exactly.
export function suggestGoals({ income, trends }) {
  if (!(income > 0)) return null;
  const target = Math.round((income * 0.9) / 500) * 500;
  const limits = limitsFor(target, trends);
  return limits && { target, limits, income, left: income - target };
}

// The group limits for a given target: each group's median scaled to it (Ajustes › Recalcular pela mediana).
export function limitsFor(target, trends) {
  const ids = CLUSTERS.filter((c) => c.limit !== null).map((c) => c.id);
  const base = ids.reduce((a, id) => a + (trends?.[id]?.median || 0), 0);
  if (!base) return null;
  const limits = Object.fromEntries(ids.map((id) => [id, Math.round((trends[id].median * target) / base / 50) * 50]));
  const top = ids.reduce((a, id) => (trends[id].median > trends[a].median ? id : a));
  limits[top] += target - Object.values(limits).reduce((a, b) => a + b, 0);
  return limits;
}

// The Gastos screen: this month against the target, per cluster, plus the last 12 months.
export function monthView(rows, { today, target = DEFAULT_TARGET, limits = {}, cycles = null }) {
  const month = cycles ? cycleOf(today, cycles) : today.slice(0, 7);
  const clusterMonths = byMonth(rows, "cluster", null, cycles ? "cyc" : "m");
  const now = clusterMonths[month] || {};
  const spent = sum(now);
  const [y, mo, day] = today.split("-").map(Number);
  const bounds = cycles ? cycleBounds(month, cycles) : null;
  const end = bounds ? addDays(bounds.end, -1) : `${month}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
  const start = bounds ? bounds.start : `${month}-01`;
  const daysLeft = Math.round((Date.parse(end + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 864e5) + 1;
  const length = Math.round((Date.parse(end + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 864e5) + 1;
  void day;
  const left = target - spent;
  const clusters = CLUSTERS.map((c) => {
    const limit = c.id in limits ? limits[c.id] : c.limit;
    const s = now[c.id] || 0;
    return { id: c.id, label: c.label, limit, spent: s, over: limit !== null && s > limit };
  }).filter((c) => c.limit !== null || c.spent > 0);
  const history = monthRange(addMonths(month, -11), month).map((m) => ({ month: m, spent: sum(clusterMonths[m]) }));
  // With bill history loaded: 24 months, the history-only ones flagged (card only: no account data for them),
  // and this cycle's card spending against the same cycle a year ago.
  const key = cycles ? "cyc" : "m";
  const histMonths = new Set(rows.filter((r) => r.hist).map((r) => r[key]));
  const cardMonths = byMonth(rows, "cluster", "card", key);
  const long = histMonths.size ? monthRange(addMonths(month, -23), month).map((m) => histMonths.has(m) ? { month: m, spent: sum(cardMonths[m]), cardOnly: true } : { month: m, spent: sum(clusterMonths[m]) }) : null;
  const ago = addMonths(month, -12);
  const card = (m) => rows.filter((r) => r.src === "card" && r[key] === m).reduce((a, r) => a + r.amt, 0);
  const yearAgo = histMonths.has(ago) || rows.some((r) => r[key] === ago) ? { month: ago, card: card(ago), cardNow: card(month) } : null;
  return { month, start, end, length, cycle: Boolean(cycles), spent, target, left, over: spent > target, daysLeft, perDay: left > 0 ? left / daysLeft : 0, clusters, history, long, yearAgo };
}

function addDays(iso, n) {
  return new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
}
