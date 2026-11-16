export function render(el, ctx) {
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
      <div class="label">Metas</div>
      <div class="field"><span>Gasto mensal</span><span>R$ ${Number(ctx.data?.settings?.target ?? 7000).toLocaleString("pt-BR")}</span></div>
      <button class="btn ghost" data-a="wipe" style="color:var(--bad)">Apagar dados deste aparelho</button>
    </div>`;
  el.addEventListener("click", async (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (a === "lock") ctx.lock();
    if (a === "wipe" && confirm("Apagar PIN, credenciais e dados deste aparelho?")) await ctx.wipe();
  });
}
