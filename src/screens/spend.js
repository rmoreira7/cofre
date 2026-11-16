export function render(el, ctx) {
  el.innerHTML = `
    <div class="top"><div><h1>Gastos</h1><div class="sub">v${ctx.version}</div></div></div>
    <div class="card empty"><b>Sem dados ainda</b>Os gastos do mês contra a meta aparecem aqui.<br>Conecte o Pluggy em Ajustes.</div>`;
}
