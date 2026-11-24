// Ajustes › Segurança: fingerprint unlock, auto-lock, lock now, wipe the device.
export const id = "security";
export const label = "Segurança";

export const render = (t, ctx) => securityCard(ctx);

export function bind(pane, t, ctx) {
  pane.onclick = async (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (a === "bio") { if (ctx.bio.enrolled) { if (confirm("Desativar o desbloqueio por digital neste aparelho?")) await ctx.disableBio(); } else ctx.enrollBio(); }
    if (a === "lock") ctx.lock();
    if (a === "wipe" && confirm("Apagar PIN, credenciais e dados deste aparelho?")) await ctx.wipe();
  };
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
