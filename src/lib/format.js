const nf = (d) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const NF = [nf(0), nf(1), nf(2)];

export const brl = (n, d = 0) => (n < 0 ? "−" : "") + "R$ " + NF[d].format(Math.abs(n));
export const mil = (n) => (n < 0 ? "−" : "") + "R$ " + NF[1].format(Math.abs(n) / 1000) + " mil";
export const pct = (n, d = 1) => NF[d].format(n) + "%";
export const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const ddmmyyyy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b.slice(0, 10) + "T12:00:00Z") - Date.parse(a.slice(0, 10) + "T12:00:00Z")) / 864e5);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// "hoje, 11:42" / "ontem, 23:21" / "22/11, 23:21". stale = older than staleH hours.
export function when(iso, now = new Date(), staleH = 30) {
  const t = new Date(iso);
  const hhmm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const day = localToday(t) === localToday(now) ? "hoje" : localToday(t) === localToday(y) ? "ontem" : ddmm(localToday(t));
  return { text: `${day}, ${hhmm}`, stale: (now - t) / 36e5 > staleH };
}

export function ago(iso, now = new Date()) {
  const w = when(iso, now, 24);
  return { text: `Atualizado ${w.text}`, stale: w.stale };
}
