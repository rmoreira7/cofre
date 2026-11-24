import test from "node:test";
import assert from "node:assert/strict";
import { decide, decisionText, digest, maturityFacts } from "../watch/decide.mjs";

const today = "2026-11-24"; // a Tuesday
const inDays = (n, from = today) => new Date(Date.parse(from + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const mat = (days, balance, extra = {}) => ({ due: inDays(days), days, bank: "bank_x", issuer: "Emissor A", n: 1, balance, rates: ["110% CDI"], joint: false, tag: null, ...extra });
// The parts of the view decide() reads: cards, maturities, balances, FGC, connection status.
const view = ({ rows = [], cards = [], banks = [], issuers = [] } = {}) => ({ today, cards, mat: { rows }, wealth: { banks }, guarantee: { issuers }, status: [{ name: "Banco X", ok: true, consent: "2027-11-06" }] });

test("a maturity speaks only on D-7/3/1/0", () => {
  for (const [days, speaks] of [[7, true], [6, false], [3, true], [1, true], [0, true], [12, false]]) {
    const d = decide(view({ rows: [mat(days, 2000)] }), { today });
    assert.equal(d.urgent.length, speaks ? 1 : 0, `D-${days}`);
    if (speaks) assert.equal(d.urgent[0].id, `mat:bank_x:Emissor A:${inDays(days)}`);
  }
});

test("the maturity carries the ladder's split, the BRB rule and the joint tag", () => {
  const d = decide(view({ rows: [mat(7, 2800, { issuer: "BRB", tag: "brb", joint: true }), mat(600, 5000)] }), { today });
  assert.match(d.urgent[0].text, /BRB: não renovar/);
  assert.match(d.urgent[0].text, /Sugestão da escada: /);
  assert.match(d.urgent[0].text, /conta conjunta/);
  assert.equal(d.urgent[0].facts["observação"], "o valor não volta para o BRB");
});

test("the maturity message says what the money earned, computed by the rules", () => {
  const parts = [{ balance: 900, orig: 750, tax: 30, bought: "2025-08-29", cdi: 125, subtype: "CDB" }];
  const d = decide(view({ rows: [mat(7, 900, { parts })] }), { today, cdiDaily: 0.055 });
  assert.match(d.urgent[0].text, /Rendeu \+ R\$ 150 líquidos sobre R\$ 750 \(\d+,\d% a\.a\.\)\./);
  assert.doesNotMatch(decide(view({ rows: [mat(7, 900)] }), { today }).urgent[0].text, /Rendeu/);
});

test("bills speak on D-3 and D-1 only", () => {
  const card = (days) => ({ bank: "card_a", name: "Cartão A", bill: 696, due: inDays(days) });
  assert.equal(decide(view({ cards: [card(3)] }), { today }).urgent.length, 1);
  assert.equal(decide(view({ cards: [card(2)] }), { today }).urgent.length, 0);
});

test("idle cash and FGC excess speak on Mondays, with buttons' ids; a quiet Tuesday sends nothing", () => {
  const v = view({ banks: [{ label: "bank_j", name: "Banco J", checking: 9000, joint: true }] });
  const tue = decide(v, { today });
  assert.equal(tue.urgent.length, 0);
  assert.equal(digest(tue, today), null);
  const mon = decide({ ...v, today: "2026-11-23" }, { today: "2026-11-23", cdiDaily: 0.05 });
  assert.equal(mon.urgent[0].id, "idle:bank_j");
  assert.match(mon.urgent[0].text, /R\$ 9\.000 parado na conta · conta conjunta · ~R\$ 4,50 por dia útil/);
  assert.match(mon.urgent[0].text, /Investir R\$ 4\.000/);
  assert.match(digest(mon, "2026-11-23"), /Fora as decisões acima, nada pendente/);
});

test("Monday digest: maturities 8–30 days out, broken banks and expiring consents", () => {
  assert.match(digest(decide(view(), { today: "2026-11-23" }), "2026-11-23"), /Semana sem pendências/);
  const v = { ...view({ rows: [mat(20, 1000)] }), status: [{ name: "Banco N", ok: false, error: "LOGIN_ERROR" }, { name: "Banco W", ok: true, consent: "2026-12-10" }] };
  const w = decide(v, { today: "2026-11-23" }).weekly.join("\n");
  assert.match(w, /Emissor A R\$ 1\.000 vence/);
  assert.match(w, /Banco N: sincronização falhou \(LOGIN_ERROR\)/);
  assert.match(w, /Banco W: consentimento expira 10\/12/);
});

test("renewals speak at D-30/7/1/0 with price and note", () => {
  const renewals = [{ name: "Plano X", date: "2026-12-24", amount: 25, every: "month", note: "cancelar antes se não quiser" }, { name: "Plano Y", date: "2026-12-10", amount: 100, every: "year" }];
  const d = decide(view(), { today, renewals });
  assert.equal(d.urgent.length, 1);
  assert.match(d.urgent[0].text, /Plano X<\/b> renova em 30 dias \(24\/12\) · R\$ 25,00\/mês\n   cancelar antes/);
});

test("quiet(id) silences a decision the owner already took or snoozed", () => {
  const d = decide(view({ rows: [mat(7, 2000)] }), { today, quiet: (id) => id.startsWith("mat:") });
  assert.equal(d.urgent.length, 0);
});

test("names are HTML-escaped for Telegram", () => {
  const d = decide(view({ cards: [{ bank: "c", name: "A&B <x>", bill: 1, due: inDays(3) }] }), { today });
  assert.match(d.urgent[0].text, /A&amp;B &lt;x&gt;/);
});

test("maturity facts carry the rules' own below/above split, so the model never compares", () => {
  const lad = { now: [{ label: "≤6m", share: 0.3, max: 6 }, { label: "6–12m", share: 0.1, max: 12 }, { label: "12–18m", share: 0.2, max: 18 }, { label: "18–24m", share: 0.05, max: 24 }, { label: "24–36m", share: 0.15, max: 36 }, { label: "36m+", share: 0.2, max: Infinity }] };
  const f = maturityFacts({ issuer: "Emissor A", amount: 70, due: "2026-12-08", joint: false }, { buys: [{ months: 24, amount: 70 }] }, lad, 0.05);
  assert.equal(f["faixas abaixo do alvo"], "6–12m (10,0%), 18–24m (5,0%), 24–36m (15,0%)");
  assert.equal(f["faixas acima do alvo"], "≤6m (30,0%), 12–18m (20,0%), 36m+ (20,0%)");
  assert.equal(f["compra sugerida"], "R$ 70 em 2 anos, na faixa 18–24m");
  assert.equal(f["custo de cada dia útil sem aplicar"], "R$ 0,04");
  assert.equal(f["observação"], undefined);
  assert.equal(maturityFacts({ issuer: "BRB", amount: 70, due: "2026-12-08", brb: true }, null, lad, null)["observação"], "o valor não volta para o BRB");
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

test("decisionText puts the explanation under its decision, escaped", () => {
  assert.match(decisionText({ text: "💰 X", why: "a < b" }), /💬 <i>a &lt; b<\/i>/);
});
