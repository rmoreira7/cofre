// Ajustes › App: the version and the update check.
import { esc } from "../../lib/format.js";

export const id = "about";
export const label = "App";

export const render = (t, ctx) => `<div class="card"><div class="row"><span>Versão ${esc(ctx.version)}<small class="block muted" data-upd>${navigator.serviceWorker?.controller ? "instalada no aparelho" : "modo navegador"}</small></span><button class="btn ghost inline" data-a="update">Procurar atualização</button></div></div>`;

export function bind(pane) {
  pane.onclick = (e) => { if (e.target.closest('[data-a="update"]')) checkUpdate(pane); };
}

// The service worker skips waiting and claims the page, so a new version takes over as soon as it installs.
async function checkUpdate(el) {
  const say = (t) => { const n = el.querySelector("[data-upd]"); if (n) n.textContent = t; };
  const reg = await navigator.serviceWorker?.getRegistration?.();
  if (!reg) { say("sem instalação (aberto no navegador)"); return; }
  say("procurando…");
  try { await reg.update(); } catch { say("sem conexão para procurar"); return; }
  const next = reg.installing || reg.waiting;
  if (!next) { say("você já tem a última versão"); return; }
  say("baixando a versão nova…");
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  setTimeout(() => location.reload(), 15000);
}
