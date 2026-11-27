// Ajustes › App: the version and the update check.
import { esc } from "../../lib/format.js";

export const id = "about";
export const label = "App";

export const render = (t, ctx) => `<div class="card"><div class="row"><span>Versão ${esc(ctx.version)}<small class="block muted" data-upd>${navigator.serviceWorker?.controller ? "instalada no aparelho" : "modo navegador"}</small></span><button class="btn ghost inline" data-a="update">Procurar atualização</button></div></div>`;

export function bind(pane, t, ctx) {
  pane.onclick = (e) => { if (e.target.closest('[data-a="update"]')) checkUpdate(pane, ctx.version); };
}

// Asks the server which version it serves (sw.js names it, never from the cache), so the answer does not depend on how
// fast the new service worker installs. A newer one: update, and reload once it takes over (or after 10 s anyway).
export const servedVersion = (text) => text.match(/const CACHE = "cofre-([\d.]+)"/)?.[1] || null;
async function checkUpdate(el, current) {
  const say = (t) => { const n = el.querySelector("[data-upd]"); if (n) n.textContent = t; };
  const reg = await navigator.serviceWorker?.getRegistration?.();
  if (!reg) { say("sem instalação (aberto no navegador)"); return; }
  say("procurando…");
  let latest;
  try { latest = servedVersion(await (await fetch(`sw.js?t=${Date.now()}`, { cache: "no-store" })).text()); } catch { say("sem conexão para procurar"); return; }
  if (!latest || latest === current) { say("você já tem a última versão"); return; }
  say(`baixando a versão ${latest}…`);
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  try { await reg.update(); } catch { /* the reload below still picks it up */ }
  setTimeout(() => location.reload(), 10000);
}
