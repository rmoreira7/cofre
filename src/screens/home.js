export function render(el, ctx) {
  el.innerHTML = `
    <div class="top"><div><h1>Início</h1><div class="sub">v${ctx.version}</div></div></div>
    <div class="card empty"><b>Sem dados ainda</b>Seu patrimônio aparece aqui depois da primeira atualização.<br>Conecte o Pluggy em Ajustes.</div>`;
}
