import { test } from "node:test";
import assert from "node:assert/strict";
import { cycleWarnings, newWarnings, warningText } from "../src/lib/warnings.js";

const v = (o = {}) => ({
  today: "2026-12-10",
  month: { month: "2026-12", spent: 4100, target: 7000, over: false, daysLeft: 15, clusters: [
    { id: "food", label: "Alimentação", spent: 2050, limit: 2000, over: true },
    { id: "travel", label: "Viagem", spent: 2600, limit: 2000, over: true },
    { id: "shop", label: "Compras", spent: 100, limit: 550, over: false },
    { id: "other", label: "Outros", spent: 900, limit: null, over: false }] },
  pace: { tone: "warn", expected: 3300, projected: 8600 },
  projects: [{ open: 2400 }],
  ...o,
});

test("groups past their limit, a high pace; the target passed replaces the pace", () => {
  const w = cycleWarnings(v());
  assert.deepEqual(w.items.map((i) => i.id), ["pace", "group:food", "group:travel"]);
  assert.equal(w.items[2].trip, 2400);
  const over = cycleWarnings(v({ month: { ...v().month, spent: 7200, over: true } }));
  assert.deepEqual(over.items.map((i) => i.id).slice(0, 1), ["target"]);
  assert.equal(cycleWarnings(v({ pace: { tone: "warn", expected: 3300, projected: 7300 } })).items[0].id, "group:food");
});

test("one fact per line, like the Fechamento", () => {
  const [pace, food, travel] = cycleWarnings(v()).items;
  assert.match(warningText(food, 15), /^⚠️ <b>Alimentação passou do limite<\/b>\n<b>R\$ 2\.050<\/b> de R\$ 2\.000 · \+R\$ 50\nfaltam 15 dias para fechar o ciclo$/);
  assert.match(warningText(travel, 1), /inclui R\$ 2\.400 da viagem\nfalta 1 dia/);
  assert.match(warningText(pace, 0), /Nesse ritmo o ciclo fecha em ~R\$ 8\.600 \(meta R\$ 7\.000\)\no ciclo fecha hoje/);
});

test("each warning goes out once per cycle; a new cycle starts over; a closed cycle's stay quiet", () => {
  const state = {};
  const w = cycleWarnings(v());
  assert.equal(newWarnings(state, w, "2026-12-10").length, 3);
  assert.equal(newWarnings(state, w, "2026-12-11").length, 0);
  const more = { ...w, items: [...w.items, { id: "group:shop", kind: "group", label: "Compras", spent: 600, limit: 550 }] };
  const sent = newWarnings(state, more, "2026-12-12");
  assert.equal(sent.length, 1);
  assert.match(sent[0], /faltam 13 dias/);
  assert.equal(newWarnings(state, { ...w, cycle: "2027-01", at: "2026-12-26", daysLeft: 30 }, "2026-12-27").length, 3);
  assert.equal(newWarnings({}, w, "2026-12-26").length, 0);
});
