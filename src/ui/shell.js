// The chrome every screen shares: the title bar (with the data's age and the refresh button) and the empty state.
import { when } from "../lib/format.js";
import { freshness } from "../lib/model.js";

const REFRESH_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`;

export function header(ctx, title, extra = "") {
  const snap = ctx.data?.snapshot;
  const f = snap ? freshness(snap) : null;
  const b = f?.bankAt ? when(f.bankAt) : null;
  const sub = ctx.busy ? "Atualizando…" : b ? `Dados dos bancos: ${b.text}` : snap ? `Atualizado ${when(snap.at).text}` : "Sem dados";
  return `<div class="top"><div><h1>${title}</h1><div class="sub${b?.stale ? " stale" : ""}">${sub}</div></div>
    <div class="top-btns">${extra}${ctx.data?.credentials ? `<button class="icon-btn" data-a="refresh" aria-label="Atualizar">${REFRESH_ICON}</button>` : ""}</div></div>`;
}

export function needsSetup(el, ctx, title) {
  const missing = !ctx.data?.credentials ? "Conecte o Pluggy em Ajustes." : !ctx.data?.rules ? "Importe o arquivo de regras pessoais em Ajustes." : !ctx.data?.snapshot ? "Toque em atualizar para buscar os dados." : null;
  if (!missing) return false;
  el.innerHTML = `${header(ctx, title)}<div class="card empty"><b>Sem dados ainda</b>${missing}</div>`;
  return true;
}

// A "›" at the end of a row that opens somewhere else.
export const GO = `<span class="go" aria-hidden="true">›</span>`;

// Downloads a Blob as a file (calendar export, overrides export).
export function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
