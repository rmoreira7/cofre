// Which decisions are due today, and the Telegram text for each. Pure: no network, no clock (today is passed in).
// Built on the app's own decision candidates (src/lib/decisions.js), so a decision has the same id in the app and in
// Telegram. A maturity speaks at D-7/3/1/0, a bill at D-3/1, a renewal at D-30/7/1/0; idle cash and FGC excess on
// Mondays. One the owner already decided or snoozed (Telegram buttons, watch/state.mjs) stays quiet: quiet(id).
import { holdings, cards, maturities, fgc, primaryEntity, itemStatus } from "../src/lib/model.js";
import { ladder, RUNGS } from "../src/lib/ladder.js";
import { candidates, nextMonthly, upcomingRenewals } from "../src/lib/decisions.js";
import { weekLines } from "../src/lib/weekly.js";
import { brl, daysBetween } from "../src/lib/format.js";
import { earnText } from "../src/ui/earn.js";

export const MATURITY_DAYS = [7, 3, 1, 0];
export const BILL_DAYS = [3, 1];
// Monthly bills (phone, internet) are usually paid about 5 days early: speak then and the day before.
export const MONTHLY_DAYS = [5, 1];
export const CONSENT_DAYS = 30;
export const RENEWAL_DAYS = [30, 7, 1, 0];

// The parts of the app's view the decisions need (no spending: it is not needed to decide anything here).
export function view(snapshot, rules, today) {
  const me = primaryEntity(rules);
  const wealth = holdings(snapshot, rules, null);
  return { today, wealth, cards: cards(snapshot, rules, me, today), mat: maturities(wealth, today), guarantee: fgc(wealth), status: itemStatus(snapshot) };
}

const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const when = (d) => (d === 0 ? "vence hoje" : d === 1 ? "vence amanhã" : `vence em ${d} dias`);
const term = (m) => (m % 12 === 0 ? `${m / 12} ano${m > 12 ? "s" : ""}` : `${m} meses`);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const joint = (x) => (x.joint ? " · conta conjunta" : "");

// Each urgent item is { id, d, text, facts? }: d is the decision (kept with the Telegram message for the buttons);
// facts are what the rules computed, already formatted, and the only numbers an explanation (explain.mjs) may quote.
export function decide(v, { today, monday = new Date(today + "T12:00:00Z").getUTCDay() === 1, cdiDaily = null, renewals = [], monthly = [], snapshot = null, idleCash = 5000, cdbMin = 110, quiet = () => false } = {}) {
  const lad = ladder(v.mat.rows, { today });
  const urgent = [], weekly = [];
  for (const d of candidates(v, { lad, renewals, monthly, snapshot, idleCash, cdbMin, cdiDaily, today })) {
    const speaks = d.kind === "maturity" ? MATURITY_DAYS.includes(d.days) : d.kind === "bill" ? BILL_DAYS.includes(d.days)
      : d.kind === "renewal" ? RENEWAL_DAYS.includes(d.days) : d.kind === "monthly" ? MONTHLY_DAYS.includes(d.days) : monday; // idle, fgc
    if (!speaks || quiet(d.id)) continue;
    urgent.push({ id: d.id, d, text: text(d), ...(d.kind === "maturity" && { facts: maturityFacts(d, lad.plan.find((x) => x.due === d.due), lad, cdiDaily) }) });
  }
  if (monday) {
    // What falls due in the 7 days from today, in date order.
    const soon = [];
    for (const c of v.cards || []) if (c.due && c.bill > 0 && daysBetween(today, c.due) >= 0 && daysBetween(today, c.due) <= 6) soon.push([c.due, `🧾 Fatura ${esc(c.name)} <b>${brl(c.bill)}</b>`]);
    for (const r of v.mat.rows) if (r.days >= 0 && r.days <= 6) soon.push([r.due, `💰 ${esc(r.issuer)} <b>${brl(r.balance)}</b> vence${joint(r)}`]);
    for (const m of nextMonthly(monthly, today, snapshot)) if (m.days >= 0 && m.days <= 6) soon.push([m.due, `📱 ${esc(m.name)}${m.amount != null ? ` ~${brl(m.amount, 2)}` : ""}`]);
    for (const r of upcomingRenewals(renewals, today, 6)) soon.push([r.date, `🔁 ${esc(r.name)} renova${r.amount ? ` ${brl(r.amount, 2)}` : ""}`]);
    for (const [d, line] of soon.sort((a, b) => a[0].localeCompare(b[0]))) weekly.push({ sec: "soon", line: `• ${ddmm(d)} ${line}` });
    for (const r of v.mat.rows) if (r.days > 7 && r.days <= 30) weekly.push({ sec: "mat", line: `• ${esc(r.issuer)} <b>${brl(r.balance)}</b> · ${ddmm(r.due)}${joint(r)}` });
    for (const s of v.status) {
      if (!s.ok) weekly.push({ sec: "bank", line: `⚠️ ${esc(s.name)}: sincronização falhou (${esc(s.error || s.status || "?")})` });
      else if (s.consent && daysBetween(today, s.consent) <= CONSENT_DAYS) weekly.push({ sec: "bank", line: `🔑 ${esc(s.name)}: consentimento expira ${ddmm(s.consent)}` });
    }
  }
  return { urgent, weekly, monday };
}

// One fact per line, like the Fechamento: a bold title, then the amount and the date, then what to do.
function text(d) {
  const L = [];
  if (d.kind === "maturity") {
    L.push(`💰 <b>${esc(d.issuer)}${d.n > 1 ? ` ×${d.n}` : ""}</b>`, `<b>${brl(d.amount)}</b> · ${when(d.days)} (${ddmm(d.due)})${joint(d)}`);
    if (d.earn) L.push(earnText(d.earn));
    if (d.brb) L.push("⛔ BRB: não renovar");
    if (d.suggestion?.length) L.push("", "<b>Sugestão da escada</b>", ...d.suggestion.map((b) => `• ${brl(b.amount)} em ${b.term}`));
    L.push("", `<i>Mínimo ${d.cdbMin}% CDI (CDB) · outro emissor se houver concentração</i>`);
  } else if (d.kind === "bill") L.push(`🧾 <b>Fatura ${esc(d.name)}</b>`, `<b>${brl(d.amount)}</b> · ${when(d.days)} (${ddmm(d.due)})`);
  else if (d.kind === "monthly") L.push(`📱 <b>${esc(d.name)}</b>`, `${d.amount != null ? `~<b>${brl(d.amount, 2)}</b> · ` : ""}${when(d.days)} (${ddmm(d.due)})`, ...(d.detail ? [esc(d.detail)] : []));
  else if (d.kind === "renewal") {
    const price = d.amount ? ` · <b>${brl(d.amount, 2)}</b>${d.every === "month" ? "/mês" : d.every === "year" ? "/ano" : ""}` : "";
    L.push(`🔁 <b>${esc(d.name)}</b>`, `${d.days === 0 ? "renova hoje" : d.days === 1 ? "renova amanhã" : `renova em ${d.days} dias`} (${ddmm(d.due)})${price}`, ...(d.detail ? [esc(d.detail)] : []));
  } else if (d.kind === "idle") {
    L.push(`🏦 <b>${esc(d.name)}</b>${joint(d)}`, `<b>${brl(d.detail.balance)}</b> parado na conta`, `➡️ Investir <b>${brl(d.amount)}</b> (reserva de ${brl(d.detail.reserve)})`);
    if (d.cost) L.push(`<i>~${money(d.cost)} por dia útil sem aplicar</i>`);
  } else if (d.kind === "fgc") L.push(`🛡️ <b>FGC · ${esc(d.issuer)}</b>${joint(d)}`, `<b>${brl(d.detail.total)}</b> no emissor, ${brl(d.amount)} acima do limite`);
  else L.push(esc(d.title));
  return L.join("\n");
}

const pct = (x) => `${(x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const money = (n) => brl(n, Math.abs(n) < 100 ? 2 : 0);

// The rung a purchase of `months` lands in today (same edges as ladder.js RUNGS).
const RUNG_OF = (months) => RUNGS.findIndex((r) => months <= r.max);

export function maturityFacts(d, p, lad, cdiDaily) {
  const target = 1 / lad.now.length;
  const list = (rows) => rows.map((r) => `${r.label} (${pct(r.share)})`).join(", ");
  const buys = (p?.buys || []).map((b) => `${brl(b.amount)} em ${term(b.months)}, na faixa ${lad.now[RUNG_OF(b.months)]?.label}`);
  return {
    "vence": `${d.issuer}, ${brl(d.amount)}, em ${ddmm(d.due)}${d.joint ? " (conta conjunta)" : ""}`,
    // The comparisons are done here, not by the model: given the shares and the target, a model gets above/below wrong.
    "faixas abaixo do alvo": list(lad.now.filter((r) => r.share < target)),
    "faixas acima do alvo": list(lad.now.filter((r) => r.share > target)),
    "alvo por faixa": pct(target),
    "compra sugerida": buys.join(" · "),
    ...(cdiDaily && { "custo de cada dia útil sem aplicar": money((d.amount * cdiDaily) / 100) }),
    ...(d.brb && { "observação": "o valor não volta para o BRB" }),
  };
}

// A decision's message: its text, the explanation under it when there is one.
export const decisionText = (u) => (u.why ? `${u.text}\n\n💬 <i>${esc(u.why)}</i>` : u.text);

// The Monday digest (null on other days): what is coming but not urgent, and the connections' health.
const WEEK_SECS = [["soon", "Esta semana"], ["mat", "Vencem nos próximos 30 dias"], ["bank", "Conexões"]];
// The Monday message: the past week's spending and the cycle (from the phone, `weeks`), what falls due this week, the
// maturities ahead, and the connections' health.
export function digest({ weekly, monday, urgent }, today, weeks = null) {
  if (!monday) return null;
  const L = [`📅 <b>Cofre · semana de ${ddmm(today)}</b>`];
  const past = weekLines(weeks, today);
  if (past.length) L.push("", ...past);
  for (const [sec, title] of WEEK_SECS) {
    const lines = weekly.filter((w) => w.sec === sec).map((w) => w.line);
    if (lines.length) L.push("", `<b>${title}</b>`, ...lines);
  }
  if (!weekly.length) L.push("", urgent.length ? "Fora as decisões acima, nada pendente." : "✅ Semana sem pendências.");
  return L.join("\n");
}
