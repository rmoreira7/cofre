// The month-end summary: once a card cycle (or a calendar month) closes, what was spent against the target and per
// group, what came in, what the investments earned and what the next bill already carries. Built on the phone, which
// has the categorization rules; it travels to the watcher in phone.enc and is sent to Telegram once (closingText).
import { byMonth, sum, CLUSTERS, leftover, cycleBounds } from "./spend.js";
import { earnedSteps } from "./income.js";
import { brl, ddmm, MES } from "./format.js";

export const CLOSING_DAYS = 10; // shown on Início for this many days after the period closes

const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// month: monthView() of the current period. log: the merged position log. own: the owner's bank labels.
export function closing({ rows, income, month, cycles, target, limits = {}, log = [], own = [], bills = [], today }) {
  const prev = month.history.at(-2)?.month;
  if (!prev) return null;
  const key = cycles ? "cyc" : "m";
  const b = cycles ? cycleBounds(prev, cycles) : null;
  const start = b ? b.start : `${prev}-01`, end = b ? addDays(b.end, -1) : addDays(month.start, -1);
  if (today <= end) return null;
  const per = byMonth(rows, "cluster", null, key)[prev] || {};
  const spent = sum(per);
  const groups = CLUSTERS.map((c) => {
    const limit = c.id in limits ? limits[c.id] : c.limit, s = per[c.id] || 0;
    return { id: c.id, label: c.label, spent: s, limit, over: limit !== null && s > limit ? s - limit : 0 };
  }).filter((g) => g.spent > 0).sort((x, y) => y.spent - x.spent);
  const inc = leftover(income, rows, [prev], key)[0];
  // Measured investment income over the period: the position-log steps that end inside it, own banks only.
  let earned = 0, steps = 0;
  for (const st of earnedSteps(log)) {
    if (st.to <= start || st.to > addDays(end, 1)) continue;
    steps++;
    for (const [bank, v] of Object.entries(st.banks)) if (own.includes(bank)) earned += v;
  }
  const next = bills.find((m) => !m.open);
  return {
    id: prev, start, end, cycle: Boolean(cycles), spent, target, over: spent > target,
    groups, overGroups: groups.filter((g) => g.over > 0),
    income: inc.income, salary: inc.salary, left: inc.left,
    earned: steps ? earned : null,
    committed: next ? { month: next.month, amount: next.amount } : null,
  };
}

const label = (c) => (c.cycle ? `ciclo ${ddmm(c.start)} → ${ddmm(c.end)}` : `${MES[Number(c.id.slice(5)) - 1]}/${c.id.slice(2, 4)}`);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);

// The Telegram message (HTML), from the summary alone: the watcher calls it with what the phone sent.
export function closingText(c) {
  const lines = [`📊 <b>Fechamento · ${label(c)}</b>`, ""];
  lines.push(`Gastou <b>${brl(c.spent)}</b> de ${brl(c.target)}${c.over ? ` · <b>${brl(c.spent - c.target)} acima</b>` : ` · sobrou ${brl(c.target - c.spent)}`}`);
  if (c.overGroups.length) lines.push(`Acima do limite: ${c.overGroups.map((g) => `${esc(g.label)} +${brl(g.over)}`).join(" · ")}`);
  const top = c.groups.slice(0, 3).map((g) => `${esc(g.label)} ${brl(g.spent)}`).join(" · ");
  if (top) lines.push(`Maiores: ${top}`);
  if (c.income) lines.push(`Entrou ${brl(c.income)}${c.salary ? ` (salário ${brl(c.salary)})` : ""} · ${c.left >= 0 ? "sobrou" : "faltou"} ${brl(Math.abs(c.left))}`);
  if (c.earned != null) lines.push(`Investimentos renderam ${brl(c.earned)} líquidos`);
  if (c.committed?.amount > 0) lines.push(`Fatura de ${MES[Number(c.committed.month.slice(5)) - 1]} já tem ${brl(c.committed.amount)} em parcelas`);
  return lines.join("\n");
}
