// Ajustes › Conexões: the Pluggy credentials and connections (status, consent, add · change ID · remove), and the
// rules file from the laptop (import, age, overrides made on the phone → export), and the Google Agenda client.
import { parseRulesFile, rulesSummary, exportUserOverrides, entityOf } from "../../lib/categorize.js";
import { esc, when, MES, ddmm, daysBetween, localToday } from "../../lib/format.js";
import { itemStatus, BANKS, bankName, primaryEntity } from "../../lib/model.js";
import { download } from "../../ui/shell.js";

export const id = "connections";
export const label = "Conexões";

const ITEM_RX = /^[a-z0-9_-]{1,32}:[0-9a-f-]{36}$/i;
const ID_RX = /^[0-9a-f-]{36}$/i;
export const GCLIENT_RX = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const STALE_RULES_DAYS = 14;
const CONSENT_WARN_DAYS = 30;
// UI state that survives a repaint.
let openConn = null, adding = false, editCreds = false;
const mask = (id) => `${id.slice(0, 4)}…${id.slice(-4)}`;
const mmyy = (iso) => `${MES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;

export function parseItems(text) {
  const items = text.split(/[\s,]+/).filter(Boolean).map((l) => {
    if (!ITEM_RX.test(l)) throw new Error(`Formato inválido: use banco:id (ex.: nubank:xxxxxxxx-…).`);
    const [label, id] = l.split(":");
    return { label: label.toLowerCase(), id };
  });
  if (!items.length) throw new Error("Informe ao menos uma conexão.");
  return items;
}

export function render(t, ctx) {
  const d = ctx.data || {};
  return `${d.credentials ? connections(ctx, d) : setupCard()}
    <div class="sec">Regras do notebook</div>${rulesCard(d)}
    <div class="sec">Google Agenda</div>${gcalCard(d)}`;
}

export function bind(pane, t, ctx, { repaint }) {
  const creds = ctx.data.credentials;
  const saveCreds = async (items, patch = {}) => {
    await ctx.save({ ...ctx.data, credentials: { ...ctx.data.credentials, ...patch, items } });
  };
  pane.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, err = f.querySelector(".err");
    try {
      if (f.dataset.f === "setup") {
        const items = parseItems(f.elements.items.value);
        if (!f.elements.secret.value.trim()) throw new Error("Informe o Client Secret.");
        await ctx.save({ ...ctx.data, credentials: { clientId: f.elements.id.value.trim(), clientSecret: f.elements.secret.value.trim(), items } });
        ctx.refresh();
      }
      if (f.dataset.f === "creds") {
        await saveCreds(creds.items, { clientId: f.elements.id.value.trim(), clientSecret: f.elements.secret.value.trim() || creds.clientSecret });
        editCreds = false; ctx.refresh();
      }
      if (f.dataset.f === "gcal") {
        const id = f.elements.client.value.trim();
        if (!GCLIENT_RX.test(id)) throw new Error("O Client ID termina em .apps.googleusercontent.com (Google Cloud › Credenciais).");
        await ctx.save({ ...ctx.data, gcal: { ...(ctx.data.gcal || {}), clientId: id } });
        repaint();
      }
      if (f.dataset.f === "add") {
        const label = f.elements.label.value, id = f.elements.id.value.trim();
        if (!ID_RX.test(id)) throw new Error("O ID tem 36 caracteres (xxxxxxxx-xxxx-…), copie do Meu Pluggy.");
        await saveCreds([...creds.items, { label, id }]);
        adding = false; ctx.refresh();
      }
    } catch (x) { if (err) err.textContent = x.message; }
  };
  pane.onchange = (e) => { if (e.target.matches("[data-i=rules]")) importRules(pane, ctx, e.target); };
  pane.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const a = b.dataset.a, c = ctx.data.credentials;
    if (b.dataset.c) { openConn = openConn === b.dataset.c ? null : b.dataset.c; repaint(); return; }
    if (a === "refresh") ctx.refresh();
    if (a === "add") { adding = !adding; editCreds = false; repaint(); }
    if (a === "creds") { editCreds = !editCreds; adding = false; repaint(); }
    if (a === "conn-id") {
      const it = c.items.find((i) => i.label === b.dataset.l);
      const id = prompt(`Novo ID da conexão ${bankName(it.label)} (Meu Pluggy):`, "")?.trim();
      if (!id) return;
      if (!ID_RX.test(id)) { alert("ID inválido: são 36 caracteres (xxxxxxxx-xxxx-…)."); return; }
      await saveCreds(c.items.map((i) => (i === it ? { ...i, id } : i)));
      ctx.refresh();
    }
    if (a === "conn-rm") {
      const label = b.dataset.l;
      if (!confirm(`Remover ${bankName(label)}? Os dados dessa conexão saem deste aparelho.`)) return;
      const snap = ctx.data.snapshot;
      await ctx.save({ ...ctx.data, credentials: { ...c, items: c.items.filter((i) => i.label !== label) }, snapshot: snap ? { ...snap, items: snap.items.filter((i) => i.label !== label) } : snap });
      openConn = null; repaint();
    }
    if (a === "gcal-rm" && confirm("Desligar o Google Agenda deste aparelho? A agenda Cofre continua no Google.")) {
      const { gcal, ...rest } = ctx.data; void gcal;
      await ctx.save(rest); repaint();
    }
    if (a === "import") pane.querySelector("[data-i=rules]").click();
    if (a === "export") download(`cofre-ajustes-${localToday().replace(/-/g, "")}.json`, new Blob([exportUserOverrides(ctx.data.userOverrides)], { type: "application/json" }));
  };
}

function setupCard() {
  return `<div class="card"><div class="label">Pluggy</div>
    <form data-f="setup" autocomplete="off">
      <label class="in">Client ID<input name="id" required spellcheck="false" autocapitalize="off"></label>
      <label class="in">Client Secret<input name="secret" type="password" required spellcheck="false" autocapitalize="off"></label>
      <label class="in">Conexões (banco:id, uma por linha)<textarea name="items" rows="5" required spellcheck="false" autocapitalize="off"></textarea></label>
      <div class="err" role="alert"></div>
      <button class="btn">Salvar e atualizar</button>
    </form></div>`;
}

function connections(ctx, d) {
  const creds = d.credentials;
  const status = d.snapshot ? itemStatus(d.snapshot) : [];
  const me = primaryEntity(d.rules);
  const today = localToday();
  const rows = creds.items.map((i) => {
    const st = status.find((x) => x.label === i.label);
    const data = st?.collected ? when(st.collected) : null;
    const joint = me && d.rules && entityOf(i.label, d.rules) && entityOf(i.label, d.rules) !== me;
    const left = st?.consent ? daysBetween(today, st.consent) : null;
    const chip = !st ? ["warn", "sem dados"] : st.stale || st.error ? ["bad", "falhou"] : !st.ok ? ["warn", (st.status || "").toLowerCase() || "pendente"]
      : st.consent ? [left <= CONSENT_WARN_DAYS ? "warn" : "", left <= CONSENT_WARN_DAYS ? `renovar até ${ddmm(st.consent)}` : `até ${mmyy(st.consent)}`] : ["", "conectado"];
    const open = openConn === i.label;
    return `<div class="conn-row"><button class="conn${open ? " open" : ""}" data-c="${esc(i.label)}" aria-expanded="${open}">
        <i class="dot" style="background:${BANKS[i.label]?.color || "var(--ink-3)"}"></i>
        <span class="l"><span>${esc(bankName(i.label))}${joint ? ' <span class="chip joint chip-s">conjunta</span>' : ""}</span><small${data?.stale ? ' class="stale"' : ""}>${data ? `dados de ${data.text}` : "sem dados ainda"}${BANKS[i.label]?.balanceOnly ? " · só saldo" : ""}</small></span>
        <span class="chip ${chip[0]}">${esc(chip[1])}</span><i class="caret">›</i></button>
      ${open ? `<div class="conn-more"><span>item ${esc(mask(i.id))}</span><span><button class="lnk" data-a="conn-id" data-l="${esc(i.label)}">Trocar ID</button><button class="lnk bad" data-a="conn-rm" data-l="${esc(i.label)}">Remover</button></span></div>` : ""}</div>`;
  }).join("");
  const free = Object.keys(BANKS).filter((k) => !creds.items.some((i) => i.label === k));
  return `<div class="card">
    ${rows}
    <div class="muted mt6" data-p>${ctx.progress || ""}</div>
    <button class="btn" data-a="refresh">Atualizar agora</button>
    <div class="row mt10"><button class="lnk" data-a="add">${adding ? "Cancelar" : "+ Adicionar conexão"}</button><button class="lnk muted" data-a="creds">${editCreds ? "Cancelar" : "Credenciais Pluggy ›"}</button></div>
    ${adding ? `<form data-f="add" class="mt10" autocomplete="off">
      <label class="in row"><span>Banco</span><select name="label">${free.map((k) => `<option value="${k}">${esc(bankName(k))}</option>`).join("")}</select></label>
      <label class="in">ID da conexão (Meu Pluggy)<input name="id" required spellcheck="false" autocapitalize="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label>
      <div class="err" role="alert"></div><button class="btn ghost">Adicionar e atualizar</button></form>` : ""}
    ${editCreds ? `<form data-f="creds" class="mt10" autocomplete="off">
      <label class="in">Client ID<input name="id" required spellcheck="false" autocapitalize="off" value="${esc(creds.clientId)}"></label>
      <label class="in">Client Secret<input name="secret" type="password" spellcheck="false" autocapitalize="off" placeholder="deixe vazio para manter"></label>
      <div class="err" role="alert"></div><button class="btn ghost">Salvar e atualizar</button></form>` : ""}
  </div>`;
}

function rulesCard(d) {
  const r = rulesSummary(d.rules);
  const n = Object.keys(d.userOverrides || {}).length;
  const age = r?.exportedAt ? daysBetween(localToday(new Date(r.exportedAt)), localToday()) : null;
  const t = r?.exportedAt ? new Date(r.exportedAt) : null;
  const hist = d.rules?.history?.rows?.length || 0;
  return `<div class="card">
    ${r ? `<div class="field"><span>${t ? `Arquivo de ${ddmm(localToday(t))}, ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "Arquivo sem data"}<small class="block muted">${age == null ? "" : age === 0 ? "hoje" : age === 1 ? "há 1 dia" : `há ${age} dias`}</small></span><span class="chip ${age > STALE_RULES_DAYS ? "warn" : ""}">${age > STALE_RULES_DAYS ? "antigo · rode export_rules.py" : "em dia"}</span></div>
    <details><summary><span>${r.learned.toLocaleString("pt-BR")} categorias · ${r.overrides} ajustes${hist ? ` · histórico ${hist.toLocaleString("pt-BR")} compras` : ""}</span><span class="muted">›</span></summary>
      <div class="field"><span>Regras de texto</span><span>${r.regex}</span></div>
      <div class="field"><span>Premissas da projeção</span><span>${d.rules.projection ? "incluídas" : "ausentes"}</span></div>
      <div class="field"><span>Patrimônio (pontos)</span><span>${(d.rules.wealth || []).length}</span></div>
    </details>` : `<div class="field"><span>Status</span><span>não importadas</span></div>
    <div class="muted">Gere no notebook com <code>export_rules.py</code> e importe o arquivo aqui. Ele fica só neste aparelho, criptografado.</div>`}
    <div class="field"><span>Ajustes feitos no celular</span><span>${n}</span></div>
    <div class="err" role="alert" data-e="rules"></div>
    <input type="file" accept=".json,application/json" data-i="rules" hidden>
    <button class="btn ghost" data-a="import">${r ? "Substituir arquivo de regras" : "Importar arquivo de regras"}</button>
    ${n ? '<button class="btn ghost" data-a="export">Exportar ajustes para o notebook</button>' : ""}
  </div>`;
}

async function importRules(el, ctx, input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    await ctx.save({ ...ctx.data, rules: parseRulesFile(await file.text()) });
    ctx.go("settings");
  } catch (x) {
    el.querySelector('[data-e="rules"]').textContent = x.message;
  } finally {
    input.value = "";
  }
}

// The OAuth client (public, not a secret) lives in the vault anyway, so the public repo never names the project.
function gcalCard(d) {
  const g = d.gcal || {};
  if (!g.clientId) return `<div class="card">
    <div class="muted sm">Envia vencimentos (Tangerina), faturas e renovações para uma agenda <b>Cofre</b> no Google Agenda. O app só enxerga a agenda que ele mesmo cria.</div>
    <form data-f="gcal" class="mt10" autocomplete="off">
      <label class="in">Client ID (OAuth, aplicativo da Web)<input name="client" required spellcheck="false" autocapitalize="off" placeholder="…apps.googleusercontent.com"></label>
      <div class="err" role="alert"></div><button class="btn ghost">Salvar</button>
    </form></div>`;
  const last = g.last ? `${when(g.last.at).text} · ${g.last.total} eventos` : "ainda não sincronizado";
  return `<div class="card">
    <div class="field"><span>Client ID</span><span>${esc(g.clientId.slice(0, 6))}…apps</span></div>
    <div class="field"><span>Última sincronização</span><span>${esc(last)}</span></div>
    <div class="row mt10"><button class="lnk" data-go="investments:maturities">Sincronizar em Vencimentos ›</button><button class="lnk bad" data-a="gcal-rm">Desligar</button></div>
  </div>`;
}
