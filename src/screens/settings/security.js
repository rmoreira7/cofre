// Ajustes › Segurança: fingerprint unlock, auto-lock, encrypted backup, lock now, wipe the device.
import { BACKUP_MIN, validBackupPassword } from "../../lib/vault.js";
import { esc } from "../../lib/format.js";
import { download } from "../../ui/shell.js";
export const id = "security";
export const label = "Segurança";

export const render = (t, ctx) => securityCard(ctx) + backupCard();

export function bind(pane, t, ctx) {
  pane.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, err = f.querySelector(".err"), [a, b] = [f.elements.p1.value, f.elements.p2.value];
    err.textContent = "";
    if (!validBackupPassword(a)) { err.textContent = `Use ${BACKUP_MIN}+ caracteres, não só números (uma frase funciona bem).`; return; }
    if (a !== b) { err.textContent = "As senhas não conferem."; return; }
    const file = await ctx.backup(a);
    download(`cofre-backup-${file.created.slice(0, 10)}.json`, new Blob([JSON.stringify(file)], { type: "application/json" }));
    f.reset();
    f.querySelector(".ok").textContent = "Backup salvo em Downloads. Guarde o arquivo e a senha em lugares diferentes.";
  };
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

// The file holds credentials and tokens: its own password (not the PIN), checked twice; never stored anywhere.
function backupCard() {
  return `<div class="sec">Backup</div><div class="card">
    <div class="muted sm">Um arquivo criptografado com tudo deste aparelho: credenciais, regras, suas categorias, decisões e histórico. Para restaurar num aparelho novo (ou depois de apagar), escolha <b>Restaurar backup</b> na tela de criar PIN.</div>
    <form data-f="backup" class="mt10" autocomplete="off">
      <label class="in"><span>Senha do backup</span><input name="p1" type="password" minlength="${BACKUP_MIN}" autocomplete="new-password" required></label>
      <label class="in mt6"><span>Repita a senha</span><input name="p2" type="password" autocomplete="new-password" required></label>
      <div class="err" role="alert"></div><div class="ok muted sm"></div>
      <button class="btn">Fazer backup</button>
    </form>
    <div class="muted sm mt6">${esc("Sem a senha o backup não abre, nem por aqui. Ela não é o PIN e não fica salva no aparelho.")}</div>
  </div>`;
}
