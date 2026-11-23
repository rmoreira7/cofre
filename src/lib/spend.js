// Spending: a port of the spend side of finance/pluggy/analyze.py build(), plus the clusters of design §5.
import { categorize, learn, entityOf } from "./categorize.js";
import { cleanCard, refundMatches, refundTarget } from "./cardtx.js";

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
  { id: "cash", label: "Saques", limit: 0, cats: ["Cash withdrawals"] },
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
