import test from "node:test";
import assert from "node:assert/strict";
import { decide, message } from "../watch/decide.mjs";

const today = "2026-11-24"; // a Tuesday
const mat = (due, balance, extra = {}) => ({ due, bank: "xp", issuer: "Emissor A", n: 1, balance, rates: ["110% CDI"], joint: false, tag: null, ...extra });
const base = (alerts, rows = []) => ({ alerts, mat: { rows }, status: [{ name: "XP", ok: true, consent: "2027-11-06" }] });

test("a maturity speaks only on D-7/3/1/0", () => {
  for (const [days, speaks] of [[7, true], [6, false], [3, true], [1, true], [0, true], [12, false]]) {
    const due = new Date(Date.parse(today + "T12:00:00Z") + days * 864e5).toISOString().slice(0, 10);
    const d = decide(base([{ kind: "maturity", issuer: "Emissor A", n: 1, due, days, amount: 20000, cdbMin: 110, scope: "mine" }], [mat(due, 20000)]), { today });
    assert.equal(d.urgent.length, speaks ? 1 : 0, `D-${days}`);
  }
});

test("the maturity carries the ladder's split and the BRB rule", () => {
  const due = "2026-12-01";
  const d = decide(base([{ kind: "maturity", issuer: "BRB", n: 1, due, days: 7, amount: 28000, brb: true, cdbMin: 110, scope: "joint" }], [mat(due, 28000, { issuer: "BRB", tag: "brb" }), mat("2028-06-01", 50000)]), { today });
  assert.match(d.urgent[0].text, /BRB: não renovar/);
  assert.match(d.urgent[0].text, /Sugestão da escada: /);
  assert.match(d.urgent[0].text, /conta conjunta/);
});

test("bills speak on D-3 and D-1 only", () => {
  const d3 = decide(base([{ kind: "bill", bank: "Nubank", due: "2026-11-27", days: 3, amount: 6968 }]), { today });
  const d2 = decide(base([{ kind: "bill", bank: "Nubank", due: "2026-11-26", days: 2, amount: 6968 }]), { today });
  assert.equal(d3.urgent.length, 1);
  assert.equal(d2.urgent.length, 0);
});

test("standing conditions wait for Monday; a quiet Tuesday sends nothing", () => {
  const v = base([{ kind: "idle", bank: "Itaú", amount: 82000, scope: "joint" }]);
  const tue = decide(v, { today });
  assert.equal(tue.weekly.length, 0);
  assert.equal(message(tue, today), null);
  const mon = decide(v, { today: "2026-11-23" });
  assert.equal(mon.weekly.length, 1);
  assert.match(message(mon, "2026-11-23"), /parado na conta · conta conjunta/);
});

test("Monday says so when nothing is pending, and flags broken banks and expiring consents", () => {
  assert.match(message(decide(base([]), { today: "2026-11-23" }), "2026-11-23"), /Semana sem pendências/);
  const v = { alerts: [], mat: { rows: [] }, status: [{ name: "Nubank", ok: false, error: "LOGIN_ERROR" }, { name: "Wise", ok: true, consent: "2026-12-10" }] };
  const w = decide(v, { today: "2026-11-23" }).weekly.join("\n");
  assert.match(w, /Nubank: sincronização falhou \(LOGIN_ERROR\)/);
  assert.match(w, /Wise: consentimento expira 10\/12/);
});

test("names are HTML-escaped for Telegram", () => {
  const d = decide(base([{ kind: "bill", bank: "A&B <x>", due: "2026-11-27", days: 3, amount: 1 }]), { today });
  assert.match(d.urgent[0].text, /A&amp;B &lt;x&gt;/);
});

import { guard, outputText, explain } from "../watch/explain.mjs";

const facts = { valor: "R$ 280", vencimento: "01/12", sugestao: [{ valor: "R$ 70", prazo: "4 anos" }], alvo_por_faixa: "16,7%", custo_por_dia_util_sem_aplicar: "R$ 15" };

test("guard: numbers copied verbatim pass, anything else fails", () => {
  assert.equal(guard("Vence 01/12: R$ 280 em 4 anos, alvo 16,7%, custa R$ 15 por dia.", facts).ok, true);
  assert.deepEqual(guard("Rende R$ 285 ou 0,05% ao dia.", facts).bad, ["285", "0,05"]);
  assert.equal(guard("Sem números.", facts).ok, true);
});

const reply = (text, status = "completed") => ({ status, output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text }] }], usage: { total_tokens: 300 } });
const fakeFetch = (body, ok = true, seen = []) => async (url, init) => { seen.push({ url, init }); return { ok, status: ok ? 200 : 429, json: async () => body }; };

test("outputText skips reasoning items and refuses an incomplete reply", () => {
  assert.equal(outputText(reply("Oi.")), "Oi.");
  assert.equal(outputText(reply("Oi.", "incomplete")), null);
});

test("explain sends store:false with the facts and keeps a guarded reply", async () => {
  const seen = [];
  const r = await explain(facts, { apiKey: "k", fetch: fakeFetch(reply("Divide R$ 280 em partes de R$ 70."), true, seen) });
  assert.equal(r.text, "Divide R$ 280 em partes de R$ 70.");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.store, false);
  assert.match(body.input, /R\$ 280/);
});

test("explain drops a reply with an invented number, and never throws", async () => {
  assert.equal((await explain(facts, { apiKey: "k", fetch: fakeFetch(reply("Rende R$ 310.")) })).text, null);
  assert.equal((await explain(facts, { apiKey: "k", fetch: fakeFetch({}, false) })).reason, "http 429");
  assert.equal((await explain(facts, { apiKey: "k", fetch: async () => { throw new Error("net"); } })).reason, "error");
  assert.equal((await explain(facts, {})).reason, "skipped");
});

test("message shows the explanation under its decision, escaped", () => {
  const text = message({ urgent: [{ text: "💰 X", why: "a < b" }], weekly: [], monday: false }, "2026-12-01");
  assert.match(text, /💬 <i>a &lt; b<\/i>/);
});

import { maturityFacts } from "../watch/decide.mjs";

test("maturity facts carry the rules' own below/above split, so the model never compares", () => {
  const lad = { now: [{ label: "≤6m", share: 0.3 }, { label: "6–12m", share: 0.1 }, { label: "12–18m", share: 0.2 }, { label: "18–24m", share: 0.05 }, { label: "24–36m", share: 0.15 }, { label: "36m+", share: 0.2 }] };
  const f = maturityFacts({ issuer: "Emissor A", amount: 70, due: "2026-12-08", days: 7, cdbMin: 110, scope: "mine" }, { buys: [{ months: 24, amount: 70 }] }, lad, 0.05);
  assert.equal(f["faixas abaixo do alvo"], "6–12m (10,0%), 18–24m (5,0%), 24–36m (15,0%)");
  assert.equal(f["faixas acima do alvo"], "≤6m (30,0%), 12–18m (20,0%), 36m+ (20,0%)");
  assert.equal(f["compra sugerida"], "R$ 70 em 2 anos, na faixa 18–24m");
  assert.equal(f["custo de cada dia útil sem aplicar"], "R$ 0,04");
  assert.equal(f["observação"], undefined);
  assert.equal(maturityFacts({ issuer: "BRB", amount: 70, due: "2026-12-08", brb: true, cdbMin: 110 }, null, lad, null)["observação"], "o valor não volta para o BRB");
});

test("renewals speak at D-30/7/1/0 with price and note; idle cash carries its cost per business day", () => {
  const renewals = [{ name: "Plano X", date: "2026-12-24", amount: 25, every: "month", note: "cancelar antes se não quiser" }, { name: "Plano Y", date: "2026-12-10", amount: 100, every: "year" }];
  const d = decide(base([]), { today, renewals });
  assert.equal(d.urgent.length, 1);
  assert.match(d.urgent[0].text, /Plano X<\/b> renova em 30 dias \(24\/12\) · R\$ 25,00\/mês\n   cancelar antes/);
  const mon = decide(base([{ kind: "idle", bank: "Banco", amount: 2000, scope: "mine" }]), { today: "2026-11-23", cdiDaily: 0.05 });
  assert.match(mon.weekly[0], /R\$ 2\.000 parado na conta · ~R\$ 1,00 por dia útil/);
});
