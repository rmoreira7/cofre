// Spending: a port of the spend side of finance/pluggy/analyze.py build(), plus the clusters of design §5.
import { categorize, learn, entityOf } from "./categorize.js";

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
export function spendRows(pulled, { rules, compiled, entity, today }) {
  const items = pulled.items.filter((it) => !it.error && entityOf(it.label, rules) === entity);
  const card = [], bank = [];
  for (const it of items) for (const a of it.accounts) (a.type === "CREDIT" ? card : bank).push(...a.transactions);
  const learned = { ...rules.learned, ...learn([...card, ...bank].map((x) => [x.description, x.category ?? null])) };
  const cat = (src, x) => categorize({ src, op: x.operationType, desc: x.description, pluggy: x.category ?? null }, compiled, learned, entity);

  const rows = [];
  for (const x of card) {
    const d = x.date.slice(0, 10);
    if (d > today || x.operationType === "PAGAMENTO_FATURA" || !(x.amount > 0)) continue;
    rows.push(row(d, x.amount, cat("card", x), "card", x));
  }
  for (const x of bank) {
    const d = x.date.slice(0, 10);
    if (x.amount >= 0 || d > today) continue;
    const c = cat("bank", x);
    if (isInternal(x, c)) continue;
    rows.push(row(d, -x.amount, c, "account", x));
  }
  return rows;
}

function row(d, amt, cat, src, x) {
  return { d, m: d.slice(0, 7), amt, cat, cluster: clusterOf(cat), src, desc: x.description, pending: x.status === "PENDING" };
}

// { "YYYY-MM": { [key]: total } }, key = category (by = "cat") or cluster id (by = "cluster")
export function byMonth(rows, by = "cat", src = null) {
  const out = {};
  for (const r of rows) {
    if (src && r.src !== src) continue;
    const m = (out[r.m] ||= {});
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
export function monthView(rows, { today, target = DEFAULT_TARGET, limits = {} }) {
  const month = today.slice(0, 7);
  const clusterMonths = byMonth(rows, "cluster");
  const now = clusterMonths[month] || {};
  const spent = sum(now);
  const [y, mo, day] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const daysLeft = daysInMonth - day + 1;
  const left = target - spent;
  const clusters = CLUSTERS.map((c) => {
    const limit = c.id in limits ? limits[c.id] : c.limit;
    const s = now[c.id] || 0;
    return { id: c.id, label: c.label, limit, spent: s, over: limit !== null && s > limit };
  }).filter((c) => c.limit !== null || c.spent > 0);
  const history = monthRange(addMonths(month, -11), month).map((m) => ({ month: m, spent: sum(clusterMonths[m]) }));
  return { month, spent, target, left, over: spent > target, daysLeft, perDay: left > 0 ? left / daysLeft : 0, clusters, history };
}
