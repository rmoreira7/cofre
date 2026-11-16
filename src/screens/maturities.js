export function render(el, ctx) {
  el.innerHTML = `
    <div class="top"><div><h1>Vencimentos</h1><div class="sub">v${ctx.version}</div></div></div>
    <div class="card empty"><b>Sem dados ainda</b>A escada de vencimentos aparece aqui.<br>Conecte o Pluggy em Ajustes.</div>`;
}
