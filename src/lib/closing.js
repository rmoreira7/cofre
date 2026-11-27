// The month-end summary: once a card cycle (or a calendar month) closes, what was spent against the target and per
// group, what came in, what the investments earned and what the next bill already carries. Built on the phone, which
// has the categorization rules; it travels to the watcher in phone.enc and is sent to Telegram once (closingText).
import { byMonth, sum, CLUSTERS, leftover, cycleBounds } from "./spend.js";
import { earnedSteps } from "./income.js";
import { brl, ddmm, MES } from "./format.js";

export const CLOSING_DAYS = 10; // the phone hands the summary to the watcher (Telegram) for this many days after the close

const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// month: monthView() of the current period. log: the merged position log. own: the owner's bank labels.
export function closing({ rows, income, month, cycles, target, limits = {}, log = [], own = [], bills = [], today }) {
  const prev = month.history.at(-2)?.month;
  if (!prev) return null;
  const s = period(prev, { rows, income, cycles, target, limits, log, own });
  if (today <= s.end) return null;
  // The new cycle's bill (the open one): what it already holds the day the old cycle closes.
  const next = bills.find((m) => m.open) || bills[0];
  return { ...s, committed: next ? { month: next.month, amount: next.amount } : null };
}

// One closed period (a card cycle, or a calendar month): spent against the target and per group, what came in and
// what the investments earned. Gastos › Histórico shows it for the bar tapped; closing() for the one just closed.
const nextMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
export function period(prev, { rows, income, cycles, target, limits = {}, log = [], own = [] }) {
  const key = cycles ? "cyc" : "m";
  const b = cycles ? cycleBounds(prev, cycles) : null;
  const start = b ? b.start : `${prev}-01`, end = b ? addDays(b.end, -1) : addDays(`${nextMonth(prev)}-01`, -1);
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
  return {
    id: prev, start, end, cycle: Boolean(cycles), spent, target, over: spent > target,
    groups, overGroups: groups.filter((g) => g.over > 0),
    income: inc.income, salary: inc.salary, left: inc.left,
    earned: steps ? earned : null,
  };
}

const label = (c) => (c.cycle ? `ciclo ${ddmm(c.start)} → ${ddmm(c.end)}` : `${MES[Number(c.id.slice(5)) - 1]}/${c.id.slice(2, 4)}`);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);

// The Telegram message (HTML), from the summary alone: the watcher calls it with what the phone sent. One fact per
// line: the result, where the money went (the biggest groups, the ones over their limit flagged), what came in.
export const TOP_GROUPS = 5;
export function closingText(c) {
  const L = [`📊 <b>Fechamento · ${label(c)}</b>`, ""];
  L.push(`${c.over ? "🔴" : "🟢"} <b>${brl(c.spent)}</b> de ${brl(c.target)}`);
  L.push(c.over ? `${brl(c.spent - c.target)} acima da meta` : `sobrou ${brl(c.target - c.spent)} da meta`);
  if (c.groups.length) {
    L.push("", "<b>Onde foi</b>");
    for (const g of c.groups.slice(0, TOP_GROUPS)) L.push(`• ${esc(g.label)} <b>${brl(g.spent)}</b>${g.over ? `  ⚠️ +${brl(g.over)}` : ""}`);
    const rest = c.groups.slice(TOP_GROUPS);
    if (rest.length) {
      const over = rest.filter((g) => g.over).map((g) => `${esc(g.label)} ⚠️ +${brl(g.over)}`);
      L.push(`• + ${rest.length} ${rest.length === 1 ? "outro" : "outros"} ${brl(rest.reduce((a, g) => a + g.spent, 0))}${over.length ? ` (${over.join(", ")})` : ""}`);
    }
  }
  const money = [];
  if (c.income) {
    money.push(`💰 Entrou ${brl(c.income)}${c.salary ? ` (salário ${brl(c.salary)})` : ""}`);
    money.push(c.left >= 0 ? `✅ Sobrou ${brl(c.left)}` : `🔻 Faltou ${brl(-c.left)}`);
  }
  if (c.earned != null) money.push(`📈 Investimentos renderam ${brl(c.earned)}`);
  if (money.length) L.push("", ...money);
  if (c.committed?.amount > 0) L.push("", `🧾 A fatura deste ciclo (${MES[Number(c.committed.month.slice(5)) - 1]}) já tem ${brl(c.committed.amount)}`);
  return L.join("\n");
}
