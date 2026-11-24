import { parseRulesFile, rulesSummary, exportUserOverrides, entityOf } from "../lib/categorize.js";
import { CLUSTERS, DEFAULT_TARGET, limitsFor } from "../lib/spend.js";
import { brl, esc, when, MES, ddmm, daysBetween, localToday } from "../lib/format.js";
import { itemStatus, BANKS, bankName, primaryEntity } from "../lib/model.js";

const ITEM_RX = /^[a-z0-9_-]{1,32}:[0-9a-f-]{36}$/i;
const ID_RX = /^[0-9a-f-]{36}$/i;
const STALE_RULES_DAYS = 14;
const CONSENT_WARN_DAYS = 30;

export function parseItems(text) {
  const items = text.split(/[\s,]+/).filter(Boolean).map((l) => {
    if (!ITEM_RX.test(l)) throw new Error(`Formato inválido: use banco:id (ex.: nubank:xxxxxxxx-…).`);
    const [label, id] = l.split(":");
    return { label: label.toLowerCase(), id };
  });
  if (!items.length) throw new Error("Informe ao menos uma conexão.");
  return items;
}

// Screen state that survives the re-render after each tap.
let openConn = null, adding = false, editCreds = false;
const LIMITED = CLUSTERS.filter((c) => c.limit !== null);
const mask = (id) => `${id.slice(0, 4)}…${id.slice(-4)}`;
const mmyy = (iso) => `${MES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;

export function render(el, ctx) {
  const d = ctx.data || {};
  const s = d.settings || {};
  const creds = d.credentials;
  let trends = null;
  try { if (d.rules && d.snapshot) trends = ctx.view().trends; } catch { trends = null; }

  el.innerHTML = `
    <div class="top"><div><h1>Ajustes</h1><div class="sub">Tudo fica neste aparelho · v${ctx.version}</div></div></div>
    <div class="sec">Conexões</div>
    ${creds ? connections(ctx, d) : setupCard()}
    <div class="sec">Gastos</div>${spendCard(s, trends)}
    <div class="sec">Investimentos</div>${investCard(s)}
    <div class="sec">Regras do notebook</div>${rulesCard(d)}
    <div class="sec">Segurança</div>${securityCard(ctx)}
    <div class="sec">Sobre</div>
    <div class="card"><div class="row"><span>Versão ${esc(ctx.version)}<small class="block muted" data-upd>${navigator.serviceWorker?.controller ? "instalada no aparelho" : "modo navegador"}</small></span><button class="btn ghost inline" data-a="update">Procurar atualização</button></div></div>`;
  paintSum(el);

  const saveSettings = async (patch, note) => {
    await ctx.save({ ...ctx.data, settings: { ...(ctx.data.settings || {}), ...patch } });
    const n = note && el.querySelector(`[data-saved="${note}"]`);
    if (n) { n.textContent = "salvo ✓"; n.classList.add("ok"); setTimeout(() => { n.textContent = "salva ao sair do campo"; n.classList.remove("ok"); }, 1600); }
  };
  const saveCreds = async (items, patch = {}) => {
    await ctx.save({ ...ctx.data, credentials: { ...ctx.data.credentials, ...patch, items } });
  };

  // onclick/onchange/onsubmit, not addEventListener: render() runs again on this same element after most taps.
  el.oninput = (e) => { if (e.target.matches("[data-l], [name=target]")) paintSum(el); };
  el.onchange = async (e) => {
    const t = e.target;
    if (t.matches("[data-i=rules]")) return importRules(el, ctx, t);
    if (t.name === "target") return saveSettings({ target: Math.max(0, Number(t.value) || 0) }, "spend");
    if (t.dataset.l) return saveSettings({ limits: { ...(ctx.data.settings?.limits || {}), [t.dataset.l]: Math.max(0, Number(t.value) || 0) } }, "spend");
    if (t.name === "cdi") return saveSettings({ cdi: Number(t.value) || 13.65 }, "inv");
    if (t.name === "cdbMin") return saveSettings({ cdbMin: Number(t.value) || 110 }, "inv");
    if (t.name === "idleCash") return saveSettings({ idleCash: Math.max(0, Number(t.value) || 0) }, "inv");
  };
  el.onsubmit = async (e) => {
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
      if (f.dataset.f === "add") {
        const label = f.elements.label.value, id = f.elements.id.value.trim();
        if (!ID_RX.test(id)) throw new Error("O ID tem 36 caracteres (xxxxxxxx-xxxx-…), copie do Meu Pluggy.");
        await saveCreds([...creds.items, { label, id }]);
        adding = false; ctx.refresh();
      }
    } catch (x) { if (err) err.textContent = x.message; }
  };
  el.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const a = b.dataset.a, c = ctx.data.credentials;
    if (b.dataset.c) { openConn = openConn === b.dataset.c ? null : b.dataset.c; render(el, ctx); return; }
    if (b.dataset.mm) { await saveSettings({ monthMode: b.dataset.mm }); render(el, ctx); return; }
    if (a === "refresh") ctx.refresh();
    if (a === "add") { adding = !adding; editCreds = false; render(el, ctx); }
    if (a === "creds") { editCreds = !editCreds; adding = false; render(el, ctx); }
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
      openConn = null; render(el, ctx);
    }
    if (a === "median") {
      const target = ctx.data.settings?.target ?? DEFAULT_TARGET, limits = limitsFor(target, trends);
      if (limits) { await saveSettings({ limits: { ...(ctx.data.settings?.limits || {}), ...limits } }); render(el, ctx); }
    }
    if (a === "import") el.querySelector("[data-i=rules]").click();
    if (a === "export") {
      const url = URL.createObjectURL(new Blob([exportUserOverrides(ctx.data.userOverrides)], { type: "application/json" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: `cofre-ajustes-${localToday().replace(/-/g, "")}.json` });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    if (a === "bio") { if (ctx.bio.enrolled) { if (confirm("Desativar o desbloqueio por digital neste aparelho?")) await ctx.disableBio(); } else ctx.enrollBio(); }
    if (a === "lock") ctx.lock();
    if (a === "wipe" && confirm("Apagar PIN, credenciais e dados deste aparelho?")) await ctx.wipe();
    if (a === "update") checkUpdate(el);
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

function spendCard(s, trends) {
  const lim = (c) => s.limits?.[c.id] ?? c.limit;
  return `<div class="card">
    <label class="in row"><span>Meta por ${s.monthMode === "calendar" ? "mês" : "ciclo"} (R$)</span><input name="target" type="number" inputmode="numeric" min="0" step="100" value="${s.target ?? DEFAULT_TARGET}"></label>
    <div class="row field-row"><span>Mês de gastos</span><span class="seg mini-seg">${[["cycle", "Ciclo do cartão"], ["calendar", "Mês civil"]].map(([k, l]) => `<button data-mm="${k}" class="${(s.monthMode === "calendar" ? "calendar" : "cycle") === k ? "on" : ""}">${l}</button>`).join("")}</span></div>
    <div class="row mt10"><span class="label">Limites por grupo</span><span class="muted sm">${trends ? "mediana · " : ""}limite</span></div>
    ${LIMITED.map((c) => `<label class="limrow"><span>${esc(c.label)}</span><small>${trends ? brl(trends[c.id]?.median || 0) : ""}</small><input data-l="${c.id}" type="number" inputmode="numeric" min="0" step="10" value="${lim(c)}" aria-label="Limite ${esc(c.label)}"></label>`).join("")}
    <div class="sumbar" data-sum></div>
    <div class="row mt10">${trends ? '<button class="lnk" data-a="median">Recalcular pela mediana</button>' : "<span></span>"}<span class="muted sm" data-saved="spend">salva ao sair do campo</span></div>
  </div>`;
}

function paintSum(el) {
  const box = el.querySelector("[data-sum]");
  if (!box) return;
  const total = [...el.querySelectorAll("[data-l]")].reduce((a, i) => a + (Number(i.value) || 0), 0);
  const target = Number(el.querySelector("[name=target]").value) || 0;
  box.classList.toggle("warn", total !== target);
  box.innerHTML = `<span>Soma dos limites ${brl(total)}</span><span>${total === target ? "= meta ✓" : `meta ${brl(target)} · ${total > target ? "+" : "−"}${brl(Math.abs(total - target))}`}</span>`;
}

function investCard(s) {
  const f = (name, label, help, value, step, unit) => `<label class="in row"><span>${label}<small class="block muted">${help}</small></span><span class="unit-in"><input name="${name}" type="number" inputmode="decimal" min="0" step="${step}" value="${value}"><i>${unit}</i></span></label>`;
  return `<div class="card">
    ${f("cdi", "CDI", "usado na Projeção e na comparação CDB × LCA", s.cdi ?? 13.65, "0.05", "% a.a.")}
    ${f("cdbMin", "CDB mínimo", "abaixo disso, o vencimento pede outro título", s.cdbMin ?? 110, "1", "% CDI")}
    ${f("idleCash", "Dinheiro parado", "alerta acima deste saldo em conta", s.idleCash ?? 5000, "500", "R$")}
    <div class="row"><span></span><span class="muted sm" data-saved="inv">salva ao sair do campo</span></div>
  </div>`;
}

function rulesCard(d) {
  const r = rulesSummary(d.rules);
  const n = Object.keys(d.userOverrides || {}).length;
  const age = r?.exportedAt ? daysBetween(localToday(new Date(r.exportedAt)), localToday()) : null;
  const t = r?.exportedAt ? new Date(r.exportedAt) : null;
  const hist = d.rules?.history?.rows?.length || 0;
  return `<div class="card">
    ${r ? `<div class="field"><span>Arquivo de ${ddmm(localToday(t))}, ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}<small class="block muted">${age === 0 ? "hoje" : age === 1 ? "há 1 dia" : `há ${age} dias`}</small></span><span class="chip ${age > STALE_RULES_DAYS ? "warn" : ""}">${age > STALE_RULES_DAYS ? "antigo · rode export_rules.py" : "em dia"}</span></div>
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

function securityCard(ctx) {
  const on = ctx.bio.enrolled;
  return `<div class="card">
    ${on || ctx.bio.available ? `<div class="row field-row"><span>Digital<small class="block muted">o PIN de 6 dígitos continua valendo</small></span><button class="switch${on ? " on" : ""}" role="switch" aria-checked="${on}" aria-label="Desbloqueio por digital" data-a="bio"></button></div>`
      : '<div class="field"><span>Digital</span><span>indisponível neste navegador</span></div>'}
    <div class="field"><span>Bloquear após</span><span>5 min em segundo plano</span></div>
    <div class="field"><span>Dados no aparelho</span><span>criptografados (AES-GCM)</span></div>
    <button class="btn ghost" data-a="lock">Bloquear agora</button>
    <button class="btn ghost danger" data-a="wipe">Apagar dados deste aparelho</button>
  </div>`;
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
