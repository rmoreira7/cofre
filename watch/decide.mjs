// Which decisions are due today, and the Telegram text for each. Pure: no network, no clock (today is passed in).
// Built on the app's own decision candidates (src/lib/decisions.js), so a decision has the same id in the app and in
// Telegram. A maturity speaks at D-7/3/1/0, a bill at D-3/1, a renewal at D-30/7/1/0; idle cash and FGC excess on
// Mondays. One the owner already decided or snoozed (Telegram buttons, watch/state.mjs) stays quiet: quiet(id).
import { holdings, cards, maturities, fgc, primaryEntity, itemStatus } from "../src/lib/model.js";
import { ladder, RUNGS } from "../src/lib/ladder.js";
import { candidates } from "../src/lib/decisions.js";
import { brl, daysBetween } from "../src/lib/format.js";

export const MATURITY_DAYS = [7, 3, 1, 0];
export const BILL_DAYS = [3, 1];
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
export function decide(v, { today, monday = new Date(today + "T12:00:00Z").getUTCDay() === 1, cdiDaily = null, renewals = [], idleCash = 5000, cdbMin = 110, quiet = () => false } = {}) {
  const lad = ladder(v.mat.rows, { today });
  const urgent = [], weekly = [];
  for (const d of candidates(v, { lad, renewals, idleCash, cdbMin, cdiDaily, today })) {
    const speaks = d.kind === "maturity" ? MATURITY_DAYS.includes(d.days) : d.kind === "bill" ? BILL_DAYS.includes(d.days)
      : d.kind === "renewal" ? RENEWAL_DAYS.includes(d.days) : monday; // idle, fgc
    if (!speaks || quiet(d.id)) continue;
    urgent.push({ id: d.id, d, text: text(d), ...(d.kind === "maturity" && { facts: maturityFacts(d, lad.plan.find((x) => x.due === d.due), lad, cdiDaily) }) });
  }
  if (monday) {
    for (const r of v.mat.rows) if (r.days > 7 && r.days <= 30) weekly.push(`📅 ${esc(r.issuer)} ${brl(r.balance)} vence ${ddmm(r.due)}${joint(r)}`);
    for (const s of v.status) {
      if (!s.ok) weekly.push(`⚠️ ${esc(s.name)}: sincronização falhou (${esc(s.error || s.status || "?")})`);
      else if (s.consent && daysBetween(today, s.consent) <= CONSENT_DAYS) weekly.push(`🔑 ${esc(s.name)}: consentimento expira ${ddmm(s.consent)}`);
    }
  }
  return { urgent, weekly, monday };
}

function text(d) {
  if (d.kind === "maturity") {
    let s = `💰 <b>${esc(d.issuer)}${d.n > 1 ? ` ×${d.n}` : ""}</b> ${brl(d.amount)} ${when(d.days)} (${ddmm(d.due)})${joint(d)}`;
    if (d.brb) s += `\n   BRB: não renovar.`;
    if (d.suggestion) s += `\n   Sugestão da escada: ${d.suggestion.map((b) => `${brl(b.amount)} em ${b.term}`).join(" · ")}`;
    return s + `\n   Mínimo ${d.cdbMin}% CDI (CDB) · outro emissor se houver concentração.`;
  }
  if (d.kind === "bill") return `🧾 <b>Fatura ${esc(d.name)}</b> ${brl(d.amount)} ${when(d.days)} (${ddmm(d.due)})`;
  if (d.kind === "renewal") {
    const price = d.amount ? ` · ${brl(d.amount, 2)}${d.every === "month" ? "/mês" : d.every === "year" ? "/ano" : ""}` : "";
    return `🔁 <b>${esc(d.name)}</b> ${d.days === 0 ? "renova hoje" : d.days === 1 ? "renova amanhã" : `renova em ${d.days} dias`} (${ddmm(d.due)})${price}${d.detail ? `\n   ${esc(d.detail)}` : ""}`;
  }
  if (d.kind === "idle") return `🏦 <b>${esc(d.name)}</b>: ${brl(d.detail.balance)} parado na conta${joint(d)}${d.cost ? ` · ~${money(d.cost)} por dia útil` : ""}\n   Investir ${brl(d.amount)} (reserva de ${brl(d.detail.reserve)})`;
  if (d.kind === "fgc") return `🛡️ <b>FGC</b>: ${esc(d.issuer)} ${brl(d.detail.total)}, ${brl(d.amount)} acima do limite${joint(d)}`;
  return esc(d.title);
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
export const decisionText = (u) => (u.why ? `${u.text}\n   💬 <i>${esc(u.why)}</i>` : u.text);

// The Monday digest (null on other days): what is coming but not urgent, and the connections' health.
export function digest({ weekly, monday, urgent }, today) {
  if (!monday) return null;
  return `<b>Cofre · semana de ${ddmm(today)}</b>\n\n${weekly.length ? weekly.join("\n") : urgent.length ? "Fora as decisões acima, nada pendente." : "✅ Semana sem pendências."}`;
}

