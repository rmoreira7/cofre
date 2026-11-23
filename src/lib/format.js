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

export function ago(iso, now = new Date()) {
  const h = (now - new Date(iso)) / 36e5;
  const t = new Date(iso);
  const hhmm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  if (h < 24 && localToday(t) === localToday(now)) return { text: `Atualizado hoje, ${hhmm}`, stale: false };
  if (h < 24) return { text: `Atualizado ontem, ${hhmm}`, stale: false };
  return { text: `Atualizado há ${Math.floor(h / 24) >= 2 ? Math.floor(h / 24) + " dias" : Math.floor(h) + " h"}`, stale: true };
}
