// Google sign-in without Google's script (it would run next to the decrypted vault): the OAuth token flow in a
// popup, answered by our own oauth.html, which hands the URL fragment back over a BroadcastChannel and, for an
// installed app whose popup opens as a browser tab, through localStorage. The token lives in memory for one sync.
const KEY = "cofre.oauth";
const CHANNEL = "cofre-oauth";

export const redirectUri = (base = location.href) => new URL("oauth.html", base).href.split("#")[0].split("?")[0];

export function authUrl({ clientId, scope, state, redirect }) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "token", scope, state, include_granted_scopes: "true", prompt: "select_account" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

// The fragment Google sends back: access_token=…&state=… or error=…
export function parseResult(fragment, state) {
  const p = new URLSearchParams(String(fragment).replace(/^[#?]/, ""));
  if (p.get("state") !== state) return null; // someone else's answer (an older attempt): keep waiting
  if (p.get("error")) throw Object.assign(new Error(p.get("error") === "access_denied" ? "Acesso ao Google Agenda não autorizado." : `Google: ${p.get("error")}`), { denied: p.get("error") === "access_denied" });
  const token = p.get("access_token");
  if (!token) throw new Error("O Google não devolveu o acesso. Tente de novo.");
  return token;
}

export function requestToken({ clientId, scope, timeoutMs = 5 * 60_000 }) {
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
  const w = window.open(authUrl({ clientId, scope, state, redirect: redirectUri() }), "cofre-oauth", "popup,width=480,height=680");
  if (!w) return Promise.reject(new Error("O navegador bloqueou a janela do Google. Permita pop-ups para este site e tente de novo."));
  return new Promise((resolve, reject) => {
    let bc = null;
    const done = (fn, v) => {
      clearTimeout(timer); window.removeEventListener("storage", onStorage); document.removeEventListener("visibilitychange", poll);
      bc?.close(); try { localStorage.removeItem(KEY); } catch { /* */ }
      fn(v);
    };
    const take = (frag) => {
      if (!frag) return;
      try { const t = parseResult(frag, state); if (t) done(resolve, t); } catch (e) { done(reject, e); }
    };
    const onStorage = (e) => { if (e.key === KEY) take(e.newValue); };
    const poll = () => { if (document.visibilityState === "visible") { try { take(localStorage.getItem(KEY)); } catch { /* */ } } };
    try { bc = new BroadcastChannel(CHANNEL); bc.onmessage = (e) => take(e.data); } catch { bc = null; }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", poll);
    const timer = setTimeout(() => done(reject, new Error("O login no Google não terminou. Tente de novo.")), timeoutMs);
  });
}
