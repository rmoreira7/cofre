// Which decisions are due today, and the Telegram text for them. Pure: no network, no clock (today is passed in).
// Stateless by design: a maturity speaks at D-7/3/1/0 and a bill at D-3/1, so a daily run never repeats itself and
// needs nothing stored. Standing conditions (idle cash, FGC, broken banks) go in the Monday digest only.
import { holdings, cards, maturities, fgc, primaryEntity, alerts, itemStatus } from "../src/lib/model.js";
import { ladder } from "../src/lib/ladder.js";
import { brl, daysBetween } from "../src/lib/format.js";

export const MATURITY_DAYS = [7, 3, 1, 0];
export const BILL_DAYS = [3, 1];
export const CONSENT_DAYS = 30;

// The same view main.js builds for Atenção, minus spending (not needed to decide anything here).
export function view(snapshot, rules, today, { idleCash = 5000, cdbMin = 110 } = {}) {
  const me = primaryEntity(rules);
  const wealth = holdings(snapshot, rules, null);
  const v = { today, wealth, cards: cards(snapshot, rules, me, today), mat: maturities(wealth, today), guarantee: fgc(wealth) };
  v.alerts = alerts(v, { idleCash, cdbMin });
  v.status = itemStatus(snapshot);
  return v;
}

const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const when = (d) => (d === 0 ? "vence hoje" : d === 1 ? "vence amanhã" : `vence em ${d} dias`);
const term = (m) => (m % 12 === 0 ? `${m / 12} ano${m > 12 ? "s" : ""}` : `${m} meses`);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const joint = (x) => (x.joint || x.scope === "joint" ? " · conta conjunta" : "");

export function decide(v, { today, monday = new Date(today + "T12:00:00Z").getUTCDay() === 1 } = {}) {
  const urgent = [];
  const plan = ladder(v.mat.rows, { today }).plan;
  for (const a of v.alerts) {
    if (a.kind === "maturity" && MATURITY_DAYS.includes(a.days)) {
      const p = plan.find((x) => x.due === a.due);
      let s = `💰 <b>${esc(a.issuer)}${a.n > 1 ? ` ×${a.n}` : ""}</b> ${brl(a.amount)} ${when(a.days)} (${ddmm(a.due)})${joint(a)}`;
      if (a.brb) s += `\n   BRB: não renovar.`;
      if (p?.buys.length) s += `\n   Sugestão da escada: ${p.buys.map((b) => `${brl(b.amount)} em ${term(b.months)}`).join(" · ")}`;
      s += `\n   Mínimo ${a.cdbMin}% CDI (CDB) · outro emissor se houver concentração.`;
      urgent.push(s);
    }
    if (a.kind === "bill" && BILL_DAYS.includes(a.days)) urgent.push(`🧾 <b>Fatura ${esc(a.bank)}</b> ${brl(a.amount)} ${when(a.days)} (${ddmm(a.due)})`);
  }
  const weekly = [];
  if (monday) {
    for (const a of v.alerts) {
      if (a.kind === "idle") weekly.push(`🏦 ${esc(a.bank)}: ${brl(a.amount)} parado na conta${joint(a)}`);
      if (a.kind === "fgc") weekly.push(`🛡️ FGC: ${esc(a.issuer)} ${brl(a.amount)}, ${brl(a.over)} acima do limite${joint(a)}`);
      if (a.kind === "maturity" && !MATURITY_DAYS.includes(a.days)) weekly.push(`📅 ${esc(a.issuer)} ${brl(a.amount)} vence ${ddmm(a.due)}${joint(a)}`);
    }
    for (const s of v.status) {
      if (!s.ok) weekly.push(`⚠️ ${esc(s.name)}: sincronização falhou (${esc(s.error || s.status || "?")})`);
      else if (s.consent && daysBetween(today, s.consent) <= CONSENT_DAYS) weekly.push(`🔑 ${esc(s.name)}: consentimento expira ${ddmm(s.consent)}`);
    }
  }
  return { urgent, weekly, monday };
}

export function message({ urgent, weekly, monday }, today) {
  if (!urgent.length && !(monday)) return null;
  const parts = [`<b>Cofre · ${ddmm(today)}</b>`];
  if (urgent.length) parts.push(urgent.join("\n\n"));
  if (monday) parts.push(weekly.length ? `<b>Semana</b>\n${weekly.join("\n")}` : "✅ Semana sem pendências.");
  return parts.join("\n\n");
}

