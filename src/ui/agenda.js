// One agenda line, shared by Início › Resumo (next 30 days) and Início › Agenda.
import { brl, esc, MES, ddmm } from "../lib/format.js";
import { earnLine } from "./earn.js";

const DOT = { bill: "--c-bills", monthly: "--c-bills", renewal: "--warn", salary: "--ok", maturity: "--c-travel" };

export function agendaRow(e, { balance = false } = {}) {
  const [, mo, d] = e.date.split("-");
  const tag = e.paid ? ` <span class="chip ok chip-s">paga ${ddmm(e.paid)}</span>` : e.late ? ' <span class="chip bad chip-s">atrasada</span>' : "";
  const text = e.kind === "salary" ? `Salário <small>previsto</small>`
    : e.kind === "maturity" ? `${esc(e.name)}${e.joint ? " <small>conjunta</small>" : ""}${earnLine(e.earn)}`
    : e.kind === "bill" ? `${esc(e.name)}${e.partial ? " <small>parcelas já lançadas</small>" : e.est ? ` <small>estimada pela média${e.posted > 0 ? ` · ${brl(e.posted)} já lançados` : ""}</small>` : ""}${e.reserve ? `<small${e.kept < 0 ? ' class="bad"' : ""}>sai da reserva da fatura${e.kept < 0 ? ` · faltam ${brl(-e.kept)}` : ""}</small>` : ""}`
    : e.kind === "renewal" ? `${esc(e.name)}${e.note ? `<small>${esc(e.note)}</small>` : ""}`
    : `${esc(e.name)}${tag}${e.card ? "<small>no cartão: entra na fatura</small>" : ""}`;
  const amt = e.amount == null ? "" : e.kind === "salary" ? `+ ~${brl(e.amount)}` : e.kind === "maturity" ? brl(e.amount)
    : `− ${e.approx || e.partial || e.est ? "~" : ""}${brl(-e.amount)}`;
  return `<div class="${e.forecast || e.paid ? "fore" : ""}"><span class="d"><b>${d}</b>${MES[Number(mo) - 1]}</span><i class="dot" style="background:var(${DOT[e.kind] || "--ink-3"})"></i><span class="t">${text}</span><span class="amt"><b class="${e.kind === "salary" ? "ok" : ""}">${amt}</b>${balance && e.balance != null ? `<small class="${e.balance < 0 ? "bad" : ""}">conta ${brl(e.balance)}</small>` : ""}</span></div>`;
}
