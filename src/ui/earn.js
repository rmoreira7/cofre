// The receita of a maturity (src/lib/income.js maturityEarnings), worded once for Início, Vencimentos and Decisões.
import { brl, pct, ddmm } from "../lib/format.js";

const signed = (n) => `${n < 0 ? "−" : "+"} ${brl(Math.abs(n))}`;
const dmy = (iso) => `${ddmm(iso)}/${iso.slice(2, 4)}`;
const since = (e) => (e.bought ? `em ${dmy(e.bought)}` : e.earliest ? `desde ${dmy(e.earliest)}` : "");
const yearly = (e) => (e.yearly != null ? `${pct(e.yearly * 100, 1)} a.a.` : null);

// Próximos 30 dias: one line under the maturity.
export const earnLine = (e) => (e ? `<small class="rc">${signed(e.gain)} de receita · aplicou ${brl(e.orig)}</small>` : "");

// Vencimentos: invested · receita · IR, then the estimate to the due date.
export function earnTiles(e) {
  if (!e) return "";
  const sub = [pct(e.pct * 100, 1), yearly(e)].filter(Boolean).join(" · ");
  return `<div class="earn-wrap"><div class="earn">
      <div>Aplicado<b>${brl(e.orig)}</b>${e.bought ? dmy(e.bought) : e.earliest ? `desde ${dmy(e.earliest)}` : ""}</div>
      <div>Receita líquida<b class="${e.gain >= 0 ? "ok" : "bad"}">${signed(e.gain)}</b>${sub}</div>
      <div>IR já retido<b>${brl(e.tax)}</b>${e.bracket != null ? (e.bracket ? `faixa ${pct(e.bracket * 100, 1)}` : "isento") : ""}</div>
    </div>${e.est ? `<div class="est">No vencimento: ~${brl(e.est.balance)}, receita ~${brl(e.est.gain)} (mais ${e.est.days} ${e.est.days === 1 ? "dia útil" : "dias úteis"} no CDI de hoje, estimado)</div>` : ""}</div>`;
}

// Decisões: what this money earned, before deciding where it goes.
export function earnWhy(e) {
  if (!e) return "";
  const extra = [yearly(e), e.tax ? `IR de ${brl(e.tax)} já descontado` : null].filter(Boolean).join(", ");
  return `<span class="${e.gain >= 0 ? "ok" : "bad"}"><b>Rendeu ${signed(e.gain)} líquidos</b></span> sobre ${brl(e.orig)} aplicados ${since(e)}${extra ? ` (${extra})` : ""}`;
}

// Decididas: the receita as it stood (the estimate to the due date when it was decided before it).
export const earnDone = (e) => (!e ? "" : e.est ? ` · receita ~${brl(e.est.gain)}` : ` · receita ${signed(e.gain)}`);

// Telegram (plain text with the watcher's HTML): one sentence.
export const earnText = (e) => (!e ? "" : `Rendeu ${signed(e.gain)} líquidos sobre ${brl(e.orig)}${e.yearly != null ? ` (${pct(e.yearly * 100, 1)} a.a.)` : ""}.`);
