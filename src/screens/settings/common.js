// Shared by the Ajustes sub-tabs.

// Saves a settings patch and, when a field note is named, flashes "salvo ✓" next to it.
export async function saveSettings(ctx, pane, patch, note) {
  await ctx.save({ ...ctx.data, settings: { ...(ctx.data.settings || {}), ...patch } });
  const n = note && pane.querySelector(`[data-saved="${note}"]`);
  if (n) { n.textContent = "salvo ✓"; n.classList.add("ok"); setTimeout(() => { n.textContent = "salva ao sair do campo"; n.classList.remove("ok"); }, 1600); }
}
