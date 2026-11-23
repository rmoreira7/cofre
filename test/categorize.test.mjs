import { test } from "node:test";
import assert from "node:assert/strict";
import { key, keys, learn, categorize, compileRules, parseRulesFile, entityOf, rulesSummary } from "../src/lib/categorize.js";

const raw = {
  format: "cofre-rules", v: 1, exported_at: "2026-01-01T00:00:00Z",
  entities: { a: { banks: ["bank1"] }, b: { banks: ["bank2"] } },
  entity_rules: { b: [{ pattern: "ACME RENT", flags: "", category: "Rent" }] },
  desc_rules: [{ pattern: "money abroad", flags: "i", category: "Abroad" }],
  overrides: { "coffee shop": "Eating out" },
  learned: { "big market*": "Groceries" },
};

test("key/keys normalise like categories.py", () => {
  assert.equal(key("Nupay|  Big   Market*SP  2/10 "), "big market*sp");
  assert.deepEqual(keys("Big Market*SP"), ["big market*sp", "big market*", "~big marketsp"]);
  assert.deepEqual(keys("Solo"), ["solo"]);
});

test("rule order: entity → personal desc → generic → overrides → pluggy → learned → fallback", () => {
  const r = compileRules(raw);
  assert.equal(categorize({ src: "bank", op: "PIX", desc: "acme rent ltda", pluggy: "Transfers" }, r, {}, "b"), "Rent");
  assert.equal(categorize({ src: "bank", op: "PIX", desc: "acme rent ltda", pluggy: "Transfers" }, r, {}, "a"), "PIX to people");
  assert.equal(categorize({ src: "bank", op: "X", desc: "Money Abroad", pluggy: "Shopping" }, r, {}, "a"), "Abroad");
  assert.equal(categorize({ src: "card", op: "X", desc: "COFFEE SHOP", pluggy: "Shopping" }, r, {}, "a"), "Eating out");
  assert.equal(categorize({ src: "card", op: "X", desc: "Big Market*RJ", pluggy: null }, r, r.learned, "a"), "Groceries");
  assert.equal(categorize({ src: "card", op: "X", desc: "Nowhere", pluggy: null }, r, {}, "a"), "Uncategorized");
  assert.equal(categorize({ src: "bank", op: "SAQUE", desc: "x", pluggy: null }, null, {}, null), "Cash withdrawals");
});

test("learn keeps exact keys, and prefix keys only at ≥ 80 % agreement", () => {
  const m = learn([["Shop*A", "Food"], ["Shop*B", "Food"], ["Shop*C", "Fun"], ["Other", "Transfers"]]);
  assert.equal(m["shop*a"], "Food");
  assert.equal(m["shop*"], undefined);
  assert.equal(m["other"], undefined);
});

test("parseRulesFile rejects foreign or broken files", () => {
  assert.throws(() => parseRulesFile("nope"), /JSON/);
  assert.throws(() => parseRulesFile(JSON.stringify({ format: "x" })), /export de regras/);
  assert.throws(() => parseRulesFile(JSON.stringify({ ...raw, v: 2 })), /Versão/);
  assert.throws(() => parseRulesFile(JSON.stringify({ ...raw, desc_rules: [{ pattern: "(", category: "c" }] })), /padrão inválido/);
  assert.throws(() => parseRulesFile(JSON.stringify({ ...raw, learned: { a: 1 } })), /Mapa/);
  assert.equal(parseRulesFile(JSON.stringify(raw)).v, 1);
});

test("entityOf and rulesSummary", () => {
  assert.equal(entityOf("bank2", raw), "b");
  assert.equal(entityOf("zzz", raw), null);
  assert.deepEqual(rulesSummary(raw), { learned: 1, overrides: 1, regex: 2, exportedAt: raw.exported_at });
});
