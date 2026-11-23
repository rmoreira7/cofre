// Net-worth projection: a port of the 2026-11-16 simulation. Every assumption is a parameter that arrives in the
// imported rules file (rules.projection); nothing personal lives in this code.
//
// Each month: worth × (1 + net monthly yield) + net income − spending.
// Net yield = ((1 + CDI × cdi_pct)^(1/12) − 1) × (1 − IR). The current month only gets the remaining-fraction yield.

export function monthlyYield(p, year) {
  const cdi = (p.cdi[String(year)] ?? p.cdi[String(Math.max(...Object.keys(p.cdi).map(Number)))]) / 100;
  return ((1 + cdi * (p.cdi_pct / 100)) ** (1 / 12) - 1) * (1 - p.ir / 100);
}

export function salaryAt(p, ym) {
  let net = 0;
  for (const s of [...p.salary].sort((a, b) => a.from.localeCompare(b.from))) if (s.from <= ym) net = s.net;
  return net;
}

export function incomeAt(p, y, m) {
  const ym = `${y}-${String(m).padStart(2, "0")}`;
  const sal = salaryAt(p, ym);
  let extra = 0;
  if (p.thirteenth?.months?.includes(m)) extra += sal * p.thirteenth.share;
  if (p.vacation && m === p.vacation.month && y >= (p.vacation.from_year ?? 0)) extra += p.vacation.amount;
  return sal + extra;
}

// start: net worth on `today` (YYYY-MM-DD). partial: share of the current month still to earn yield
// (default: days left / days in month). Returns end-of-year totals up to `untilYear`.
export function project(p, { start, today, spend, untilYear = 2028, partial }) {
  let [y, m] = today.slice(0, 7).split("-").map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const left = partial ?? (dim - Number(today.slice(8, 10))) / dim;
  let w = start * (1 + monthlyYield(p, y) * left);
  const byYear = {}, path = [];
  for (;;) {
    if (++m === 13) { y++; m = 1; }
    if (y > untilYear) break;
    w = w * (1 + monthlyYield(p, y)) + incomeAt(p, y, m) - spend;
    path.push({ month: `${y}-${String(m).padStart(2, "0")}`, worth: w });
    if (m === 12) byYear[y] = w;
  }
  return { byYear, path };
}

export function validParams(p) {
  return Boolean(p && Array.isArray(p.salary) && p.salary.length && p.cdi && typeof p.cdi_pct === "number" && typeof p.ir === "number");
}

export function assumptions(p) {
  const fmt = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const sal = [...p.salary].sort((a, b) => a.from.localeCompare(b.from)).at(-1);
  const [sy, sm] = sal.from.split("-");
  const years = Object.keys(p.cdi).sort();
  const extras = [p.thirteenth && "13º", p.vacation && "férias"].filter(Boolean);
  const invested = extras.length ? ` · ${extras.join(" e ")} ${extras.length > 1 ? "investidos" : "investido"}` : "";
  const month = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(sm) - 1];
  return `Salário líquido R$ ${fmt(sal.net / 1000)} mil a partir de ${month}/${sy.slice(2)}${invested}`
    + ` · ~${fmt(p.cdi_pct)}% CDI (${years.map((y) => `${fmt(p.cdi[y])}% em ${y}`).join(", ")}) · IR ${fmt(p.ir)}%`;
}
