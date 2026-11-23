import { parseRulesFile, rulesSummary } from "../lib/categorize.js";

export function render(el, ctx) {
  const rules = rulesSummary(ctx.data?.rules);
  el.innerHTML = `
    <div class="top"><div><h1>Ajustes</h1><div class="sub">Tudo fica neste aparelho · v${ctx.version}</div></div></div>
    <div class="card">
      <div class="label">Segurança</div>
      <div class="field"><span>Desbloqueio</span><span>PIN · 6 dígitos</span></div>
      <div class="field"><span>Bloquear após</span><span>5 min em segundo plano</span></div>
      <div class="field"><span>Dados no aparelho</span><span>criptografados (AES-GCM)</span></div>
      <button class="btn ghost" data-a="lock">Bloquear agora</button>
    </div>
    <div class="card">
      <div class="label">Pluggy</div>
      <div class="field"><span>Credenciais</span><span>${ctx.data?.credentials ? "●●●●●● salvo" : "não configurado"}</span></div>
    </div>
    <div class="card">
      <div class="label">Regras pessoais</div>
      ${rules
        ? `<div class="field"><span>Categorias aprendidas</span><span>${rules.learned.toLocaleString("pt-BR")}</span></div>
      <div class="field"><span>Ajustes manuais · regras</span><span>${rules.overrides} · ${rules.regex}</span></div>
      <div class="field"><span>Exportado em</span><span>${new Date(rules.exportedAt).toLocaleDateString("pt-BR")}</span></div>`
        : `<div class="field"><span>Status</span><span>não importadas</span></div>
      <div class="muted">Gere no notebook com <code>export_rules.py</code> e importe o arquivo aqui. Ele fica só neste aparelho, criptografado.</div>`}
      <div class="err" role="alert" data-e="rules"></div>
      <input type="file" accept=".json,application/json" data-i="rules" hidden>
      <button class="btn ghost" data-a="import">${rules ? "Substituir arquivo de regras" : "Importar arquivo de regras"}</button>
    </div>
    <div class="card">
      <div class="label">Metas</div>
      <div class="field"><span>Gasto mensal</span><span>R$ ${Number(ctx.data?.settings?.target ?? 7000).toLocaleString("pt-BR")}</span></div>
      <button class="btn ghost" data-a="wipe" style="color:var(--bad)">Apagar dados deste aparelho</button>
    </div>`;
  el.addEventListener("click", async (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (a === "lock") ctx.lock();
    if (a === "import") el.querySelector('[data-i="rules"]').click();
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
