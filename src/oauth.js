// The OAuth redirect target: hand Google's answer (in the fragment) to the app, then close.
const frag = location.hash.slice(1) || location.search.slice(1);
history.replaceState(null, "", location.pathname);
const msg = document.getElementById("msg");
if (frag) {
  try { new BroadcastChannel("cofre-oauth").postMessage(frag); } catch { /* old browser: localStorage below */ }
  try { localStorage.setItem("cofre.oauth", frag); } catch { /* private mode */ }
  msg.textContent = /(^|&)error=/.test(frag) ? "Acesso não autorizado. Pode fechar esta janela." : "Pronto. Pode fechar esta janela e voltar ao Cofre.";
  setTimeout(() => window.close(), 400);
} else msg.textContent = "Nada para fazer aqui.";
