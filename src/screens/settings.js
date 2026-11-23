import { parseRulesFile, rulesSummary, exportUserOverrides } from "../lib/categorize.js";
import { CLUSTERS, DEFAULT_TARGET } from "../lib/spend.js";
import { brl, ddmmyyyy, esc, when } from "../lib/format.js";
import { itemStatus } from "../lib/model.js";

const ITEM_RX = /^[a-z0-9_-]{1,32}:[0-9a-f-]{36}$/i;

export function parseItems(text) {
  const items = text.split(/[\s,]+/).filter(Boolean).map((l) => {
    if (!ITEM_RX.test(l)) throw new Error(`Formato inválido: use banco:id (ex.: nubank:xxxxxxxx-…).`);
    const [label, id] = l.split(":");
    return { label: label.toLowerCase(), id };
  });
  if (!items.length) throw new Error("Informe ao menos uma conexão.");
  return items;
}

export function render(el, ctx) {
  const d = ctx.data || {};
  const s = d.settings || {};
  const rules = rulesSummary(d.rules);
  const creds = d.credentials;
  const status = d.snapshot ? itemStatus(d.snapshot) : [];
  const editing = !creds || el.dataset.edit === "1";

  el.innerHTML = `
    <div class="top"><div><h1>Ajustes</h1><div class="sub">Tudo fica neste aparelho · v${ctx.version}</div></div></div>
    <div class="card">
      <div class="label">Pluggy</div>
      ${editing ? `
        <form data-f="creds" autocomplete="off">
          <label class="in">Client ID<input name="id" required spellcheck="false" autocapitalize="off" value="${esc(creds?.clientId || "")}"></label>
          <label class="in">Client Secret<input name="secret" type="password" required spellcheck="false" autocapitalize="off" placeholder="${creds ? "deixe vazio para manter" : ""}"></label>
          <label class="in">Conexões (banco:id, uma por linha)<textarea name="items" rows="5" required spellcheck="false" autocapitalize="off">${esc((creds?.items || []).map((i) => `${i.label}:${i.id}`).join("\n"))}</textarea></label>
          <div class="err" role="alert" data-e="creds"></div>
          <button class="btn">Salvar e atualizar</button>
          ${creds ? '<button type="button" class="btn ghost" data-a="cancel">Cancelar</button>' : ""}
        </form>` : `
        <div class="field"><span>Client ID / Secret</span><span>●●●●●● salvo</span></div>
        ${creds.items.map((i) => {
          const st = status.find((x) => x.label === i.label);
          const txt = !st ? "sem dados" : st.stale ? "falhou · mostrando dados anteriores" : st.ok ? `conectado${st.consent ? " · até " + ddmmyyyy(st.consent) : ""}` : st.error ? "erro na última atualização" : (st.status || "").toLowerCase();
          const data = st?.collected ? when(st.collected) : null;
          return `<div class="field"><span>${esc(st?.name || i.label)}${data ? `<small class="block${data.stale ? " stale" : ""}">dados de ${data.text}</small>` : ""}</span><span class="${st?.ok && !st.stale ? "ok" : st ? "bad" : ""}">${esc(txt)}</span></div>`;
        }).join("")}
        <div class="muted mt6" data-p>${ctx.progress || ""}</div>
        <button class="btn" data-a="refresh">Atualizar agora</button>
        <button class="btn ghost" data-a="edit">Trocar credenciais</button>`}
    </div>
    <div class="card">
      <div class="label">Regras pessoais</div>
      ${rules
        ? `<div class="field"><span>Categorias aprendidas</span><span>${rules.learned.toLocaleString("pt-BR")}</span></div>
      <div class="field"><span>Ajustes manuais · regras</span><span>${rules.overrides} · ${rules.regex}</span></div>
      <div class="field"><span>Premissas da projeção</span><span>${d.rules.projection ? "incluídas" : "ausentes"}</span></div>
      <div class="field"><span>Exportado em</span><span>${new Date(rules.exportedAt).toLocaleDateString("pt-BR")}</span></div>`
        : `<div class="field"><span>Status</span><span>não importadas</span></div>
      <div class="muted">Gere no notebook com <code>export_rules.py</code> e importe o arquivo aqui. Ele fica só neste aparelho, criptografado.</div>`}
      <div class="field"><span>Ajustes feitos no celular</span><span>${Object.keys(d.userOverrides || {}).length}</span></div>
      <div class="err" role="alert" data-e="rules"></div>
      <input type="file" accept=".json,application/json" data-i="rules" hidden>
      <button class="btn ghost" data-a="import">${rules ? "Substituir arquivo de regras" : "Importar arquivo de regras"}</button>
      ${Object.keys(d.userOverrides || {}).length ? '<button class="btn ghost" data-a="export">Exportar ajustes para o notebook</button>' : ""}
    </div>
    <div class="card">
      <div class="label">Metas</div>
      <form data-f="goals">
        <label class="in row"><span>Gasto mensal (R$)</span><input name="target" type="number" inputmode="numeric" min="0" step="100" value="${s.target ?? DEFAULT_TARGET}"></label>
        <label class="in row"><span>Mês de gastos</span><select name="monthMode"><option value="cycle" ${s.monthMode !== "calendar" ? "selected" : ""}>ciclo do cartão</option><option value="calendar" ${s.monthMode === "calendar" ? "selected" : ""}>mês civil</option></select></label>
        <label class="in row"><span>CDI (% a.a.)</span><input name="cdi" type="number" inputmode="decimal" min="0" step="0.05" value="${s.cdi ?? 13.65}"></label>
        <label class="in row"><span>Alerta de dinheiro parado (R$)</span><input name="idleCash" type="number" inputmode="numeric" min="0" step="500" value="${s.idleCash ?? 5000}"></label>
        <label class="in row"><span>CDB mínimo (% CDI)</span><input name="cdbMin" type="number" inputmode="numeric" min="0" step="1" value="${s.cdbMin ?? 110}"></label>
        <details><summary>Limites por grupo <span class="muted">${CLUSTERS.filter((c) => c.limit !== null).length} grupos</span></summary>
          ${CLUSTERS.filter((c) => c.limit !== null).map((c) => `<label class="in row"><span>${c.label}</span><input name="l_${c.id}" type="number" inputmode="numeric" min="0" step="10" value="${s.limits?.[c.id] ?? c.limit}"></label>`).join("")}
          <div class="muted mt6" data-sum></div>
        </details>
        <button class="btn ghost">Salvar metas</button>
      </form>
    </div>
    <div class="card">
      <div class="label">Segurança</div>
      <div class="field"><span>Desbloqueio</span><span>PIN · 6 dígitos${ctx.bio.enrolled ? " + digital" : ""}</span></div>
      ${ctx.bio.enrolled ? '<button class="btn ghost" data-a="bio-off">Desativar digital</button>'
        : ctx.bio.available ? '<button class="btn ghost" data-a="bio-on">Ativar digital</button>'
        : '<div class="muted">Digital indisponível neste navegador.</div>'}
      <div class="field"><span>Bloquear após</span><span>5 min em segundo plano</span></div>
      <div class="field"><span>Dados no aparelho</span><span>criptografados (AES-GCM)</span></div>
      <button class="btn ghost" data-a="lock">Bloquear agora</button>
      <button class="btn ghost danger" data-a="wipe">Apagar dados deste aparelho</button>
    </div>`;

  const goals = el.querySelector('[data-f="goals"]');
  const paintSum = () => {
    const total = CLUSTERS.filter((c) => c.limit !== null).reduce((a, c) => a + (Number(goals.elements[`l_${c.id}`].value) || 0), 0);
    const target = Number(goals.elements.target.value) || 0;
    el.querySelector("[data-sum]").innerHTML = `Soma dos limites: <b>${brl(total)}</b>${total !== target ? ` · meta ${brl(target)}` : " = meta"}`;
  };
  goals.addEventListener("input", paintSum);
  paintSum();
  goals.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = goals.elements;
    const limits = Object.fromEntries(CLUSTERS.filter((c) => c.limit !== null).map((c) => [c.id, Math.max(0, Number(f[`l_${c.id}`].value) || 0)]));
    await ctx.save({ ...ctx.data, settings: { ...s, monthMode: f.monthMode.value, target: Math.max(0, Number(f.target.value) || 0), cdi: Number(f.cdi.value) || 13.65, cdbMin: Number(f.cdbMin.value) || 110, idleCash: Math.max(0, Number(f.idleCash.value) || 0), limits } });
    ctx.go("settings");
  });

  el.querySelector('[data-f="creds"]')?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const err = el.querySelector('[data-e="creds"]');
    try {
      const items = parseItems(f.items.value);
      const secret = f.secret.value.trim() || creds?.clientSecret;
      if (!secret) throw new Error("Informe o Client Secret.");
      await ctx.save({ ...ctx.data, credentials: { clientId: f.id.value.trim(), clientSecret: secret, items } });
      delete el.dataset.edit;
      ctx.go("settings");
      ctx.refresh();
    } catch (x) {
      err.textContent = x.message;
    }
  });

  el.addEventListener("click", async (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (a === "lock") ctx.lock();
    if (a === "bio-on") ctx.enrollBio();
    if (a === "bio-off" && confirm("Desativar o desbloqueio por digital neste aparelho?")) await ctx.disableBio();
    if (a === "refresh") ctx.refresh();
    if (a === "edit") { el.dataset.edit = "1"; render(el, ctx); }
    if (a === "cancel") { delete el.dataset.edit; render(el, ctx); }
    if (a === "import") el.querySelector('[data-i="rules"]').click();
    if (a === "export") {
      const url = URL.createObjectURL(new Blob([exportUserOverrides(ctx.data.userOverrides)], { type: "application/json" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: `cofre-ajustes-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json` });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    if (a === "wipe" && confirm("Apagar PIN, credenciais e dados deste aparelho?")) await ctx.wipe();
  });
  el.querySelector('[data-i="rules"]').addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = el.querySelector('[data-e="rules"]');
    try {
      const raw = parseRulesFile(await file.text());
      await ctx.save({ ...ctx.data, rules: raw });
      ctx.go("settings");
    } catch (x) {
      err.textContent = x.message;
    } finally {
      e.target.value = "";
    }
  });
}
