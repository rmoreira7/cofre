// Charges that come back every month (a subscription, a plan, a PIX to the same person) and are not yet a conta do mês
// or a renewal: offered in Ajustes › Contas, prefilled, so a forgotten one gets a due date and a check.
import { merchantOf } from "./model.js";
import { daysBetween } from "./format.js";

const WINDOW = 200;   // days of history looked at
const ACTIVE = 45;    // the last charge at most this many days ago
const TOLERANCE = 0.2; // each charge within ±20 % of the usual amount
const SKIP = new Set(["Interests charged", "Tax on financial operations", "Proceeds interests and dividends"]);
const monthly = (g) => g >= 20 && g <= 40, skipped = (g) => g >= 52 && g <= 70; // one month missed
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const plain = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "");

// Some issuers pad the merchant to a fixed width and add the city and country ("LOJA X      CIDADE      BR"), and only
// on some months: the merchant is what comes before the padding.
const merchant = (desc) => merchantOf(desc).split(/\s{3,}/)[0].trim();
export const recurringKey = (r) => `${r.src}:${merchant(r.desc).toLowerCase().replace(/\s+/g, " ")}`;

// Covered: a conta's match text is in the charge, or a renewal's name and the merchant contain one another (single
// words would match too much: "clube" is in more than one plan).
function covered(desc, lists) {
  const d = String(desc || "").toLowerCase(), p = plain(merchant(desc));
  if ((lists.monthly || []).some((m) => (m.match || []).some((x) => d.includes(x.toLowerCase())))) return true;
  return p.length >= 5 && (lists.renewals || []).some((r) => { const w = plain(r.name); return w.length >= 5 && (p.includes(w) || w.includes(p)); });
}

// rows: spendRows(). → [{ key, name, src, card, amount, day | every, match, last, n }], the most recent first.
export function recurring(rows, { lists = {}, ignored = [], today }) {
  return detect(rows, today).filter((r) => !ignored.includes(r.key) && !covered(r.desc, lists)).map(({ desc, cluster, raise, ...r }) => r);
}

// Every charge that keeps coming back monthly, whatever list it is in (Gastos › Assinaturas).
// A merchant that renames its charge ("Netflix.Com" → "Netflix Entretenimento") splits into two groups too short to
// count: what is left after the first pass is grouped again by the store's first word (5+ letters) and checked the same way.
function detect(rows, today) {
  const by = (xs, keyOf) => { const g = new Map(); for (const r of xs) { const k = keyOf(r); if (k) (g.get(k) || g.set(k, []).get(k)).push(r); } return g; };
  const live = rows.filter((r) => !(r.amt <= 0 || r.inst || r.hist || SKIP.has(r.cat) || daysBetween(r.d, today) > WINDOW));
  const out = [], used = new Set();
  for (const [key, xs] of by(live, recurringKey)) { const f = evaluate(key, xs, today); if (f) { out.push(f); xs.forEach((r) => used.add(r)); } }
  const first = (r) => { const w = plain(niceName(r.desc).split(/[\s.*]+/)[0]); return w.length >= 5 ? `${r.src}:~${w}` : null; };
  for (const [key, xs] of by(live.filter((r) => !used.has(r)), first)) {
    if (by(xs, recurringKey).size < 2) continue; // one name only: the first pass already said no
    const f = evaluate(key, xs, today);
    if (f) out.push(f);
  }
  return out.sort((a, b) => b.last.localeCompare(a.last));
}

function evaluate(key, xs, today) {
  {
    xs.sort((a, b) => a.d.localeCompare(b.d));
    // The trailing run of roughly monthly charges (a single missed month allowed).
    let i = xs.length - 1, good = 0;
    while (i > 0) {
      const g = daysBetween(xs[i - 1].d, xs[i].d);
      if (monthly(g)) good++; else if (!skipped(g)) break;
      i--;
    }
    let run = xs.slice(i);
    if (good < 2 || daysBetween(run.at(-1).d, today) > ACTIVE) return null;
    const stable = (r) => { const u = median(r.map((x) => x.amt)); return r.every((x) => Math.abs(x.amt - u) <= u * TOLERANCE); };
    // A price raise past the tolerance still is the same charge: the run before it held, the last is up to 50 % more.
    const before = run.slice(0, -1), jump = run.at(-1).amt / median(before.map((x) => x.amt));
    if (!stable(run) && !(before.length >= 2 && stable(before) && jump > 1 && jump <= 1.5)) return null;
    const last = run.at(-1);
    // Raised: a fixed price (the two charges before it equal to the cent) and the last one higher.
    const c = (n) => Math.round(n * 100), [p2, p1] = run.slice(-3, -1).map((x) => x.amt);
    const raise = run.length >= 3 && c(p1) === c(p2) && c(last.amt) - c(p1) >= Math.max(100, c(p1) * 0.03)
      ? { from: p1, to: last.amt, since: last.d } : null;
    const days = run.map((x) => Number(x.d.slice(8, 10)));
    // A fixed day of the month when the charges keep to it (month ends wrap: the 30th and the 2nd are 3 days apart).
    const day = Math.round(median(days)), drift = Math.max(...days.map((d) => Math.min(Math.abs(d - day), 31 - Math.abs(d - day))));
    const name = merchant(last.desc);
    return {
      key, name: name.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()), src: last.src, card: last.src === "card",
      amount: Math.round(last.amt * 100) / 100, match: [name],
      ...(drift <= 4 ? { day: Math.min(28, day) } : { every: Math.round(median(run.slice(1).map((x, j) => daysBetween(run[j].d, x.d)).filter(monthly))) }),
      last: last.d, n: run.length, desc: last.desc, cluster: last.cluster, ...(raise && { raise }),
    };
  }
}


// Gastos › Assinaturas: what keeps costing every month or year. The charges found in the statements, plus the renewals
// and contas do mês with a price that no charge accounts for yet (an annual plan, a bill paid by boleto). A renewal
// that is a found charge lends it its date. Hidden (keys tapped away on the screen) are listed apart, out of the totals.
// → { monthly: [...], yearly: [...], hidden: [...], perMonth, perYear }; each item
// { key, name, amount, per: "month" | "year", src: "card" | "account" | "list", day?, renews?, days?, cluster? }.
// A statement merchant as a person would name it: "Op P*fatura Op" → "Op", "Milhas Clube Milhas" → "Clube Milhas",
// "Mp *Loja" → "Loja", "Uber *Trip" → "Uber", "Estorno de Loja - NuPay" → "Loja", "Google Youtube" → "YouTube".
// Before a "*" is the store, unless it is a payment processor's code (then the store comes after it). A word that
// comes back later moves there; one-letter and billing words go; a few brands get their own spelling.
const PROC = new Set(["mp", "dm", "mep", "ebw", "ebn", "zig", "ifd", "pg", "pag", "pags", "pagseguro", "cappta", "jim.com", "izi", "iz", "ec", "dl", "sumup", "stone", "pagar.me", "paypal", "mercadopago", "ppro", "emv", "pix"]);
const BILLING = new Set(["fatura", "credit", "entretenimento", "ltda", "ltda.", "eireli", "s/a", "s.a.", "pagamento", "pgto", "pgt", "assinatura", "mensalidade", "recorrente"]);
const BRAND = { youtube: "YouTube", ifood: "iFood", iphone: "iPhone", icloud: "iCloud", hbo: "HBO", tv: "TV", xp: "XP", mercadolivre: "Mercado Livre", amazonmktplc: "Amazon" };
const title = (x) => (x === x.toUpperCase() || x === x.toLowerCase() ? x.charAt(0).toUpperCase() + x.slice(1).toLowerCase() : x);
export function niceName(desc) {
  let t = String(desc || "").split("|").at(-1).trim()
    .replace(/^(IOF de volta de|Estorno de|Crédito de)\s*/i, "").replace(/^"(.*)"$/, "$1").replace(/\s*-\s*NuPay\s*$/i, "")
    .replace(/\s*-?\s*parcela\s*\d+\/\d+\s*$/i, "").replace(/\s\d{1,2}\/\d{1,2}\s*$/, "").split(/\s{3,}/)[0].replace(/_/g, " ").trim();
  const star = t.match(/^([^*]*)\*\s*(.*)$/);
  if (star) { const pre = star[1].trim(), post = star[2].trim(); t = !pre || PROC.has(pre.toLowerCase()) ? post || pre : pre; }
  let w = t.split(/\s+/).filter(Boolean);
  while (w.length > 1 && w.slice(1).some((x) => x.toLowerCase() === w[0].toLowerCase())) w.shift();
  w = w.filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  const kept = w.filter((x) => !BILLING.has(x.toLowerCase()) && !(x.length === 1 && /[a-z]/i.test(x)));
  if (kept.length) w = kept;
  if (w.length > 1 && w[0].toLowerCase() === "google" && w[1].toLowerCase() === "youtube") w.shift();
  const out = w.map((x) => BRAND[x.toLowerCase()] || title(x)).join(" ");
  return out || String(desc || "").trim();
}
export const storeKey = (desc) => plain(niceName(desc));

export function subscriptions(rows, { lists = {}, today, hidden = [] }) {
  const found = detect(rows, today);
  const hit = (desc, r) => { const p = plain(merchant(desc)), w = plain(r.name); return w.length >= 5 && p.length >= 5 && (p.includes(w) || w.includes(p)); };
  const monthlyOut = found.map((f) => ({ key: f.key, name: niceName(f.name), amount: f.amount, per: "month", src: f.src, day: f.day ?? null, cluster: f.cluster, desc: f.desc, ...(f.raise && { raise: f.raise }) }));
  const yearly = [];
  for (const r of lists.renewals || []) {
    const days = daysBetween(today, r.date);
    const next = days >= 0 ? { renews: r.date, days } : {};
    const m = monthlyOut.find((f) => hit(f.desc, r));
    if (m) { Object.assign(m, next); continue; }
    if (!(r.amount > 0)) continue;
    (r.every === "year" ? yearly : monthlyOut).push({ key: `list:${plain(r.name)}`, name: r.name, amount: r.amount, per: r.every === "year" ? "year" : "month", src: "list", ...next });
  }
  for (const c of lists.monthly || []) {
    if (!(c.amount > 0)) continue;
    const d = (x) => String(x || "").toLowerCase();
    if (found.some((f) => (c.match || []).some((x) => d(f.desc).includes(d(x))))) continue;
    monthlyOut.push({ key: `list:${plain(c.name)}`, name: c.name, amount: c.amount, per: "month", src: "list", day: c.day ?? null });
  }
  monthlyOut.forEach((m) => delete m.desc);
  const off = [...monthlyOut, ...yearly].filter((x) => hidden.includes(x.key));
  const on = (xs) => xs.filter((x) => !hidden.includes(x.key));
  const mo = on(monthlyOut).sort((a, b) => b.amount - a.amount);
  const yr = on(yearly).sort((a, b) => (a.renews || "9").localeCompare(b.renews || "9"));
  const perMonth = mo.reduce((s, m) => s + m.amount, 0) + yr.reduce((s, y) => s + y.amount / 12, 0);
  return { monthly: mo, yearly: yr, hidden: off, perMonth, perYear: perMonth * 12 };
}
