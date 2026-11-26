import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto as crypto } from "node:crypto";
import { merge, forget, same } from "../src/lib/sync.js";
import { decide } from "../src/lib/decisions.js";
import { seal, unseal, validKey } from "../src/lib/seal.js";
import { parseRulesFile } from "../src/lib/categorize.js";
import { applyTaps, syncMessages, sig } from "../watch/taps.mjs";
import { pullPhone } from "../watch/phone.mjs";
import { EMPTY } from "../watch/state.mjs";

const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const d = { id: "idle:bank_j", kind: "idle", title: "Investir o parado", name: "Banco J", amount: 400, bank: "bank_j", due: "2026-11-24" };
const today = "2026-11-24", T = Date.parse("2026-11-24T15:00:00Z");

test("merge: the latest change wins, records and undos alike", () => {
  const phone = { decisions: decide({}, d, "done", { today, ts: T, by: "app" }), undone: {} };
  const tg = { decisions: decide({}, d, "snoozed", { today, ts: T + 1000, by: "telegram" }), undone: {} };
  assert.equal(merge([phone, tg], T).decisions[d.id].status, "snoozed");
  const undoneLater = { decisions: {}, undone: forget({}, d.id, T + 2000) };
  const m = merge([phone, tg, undoneLater], T);
  assert.deepEqual(m.decisions, {});
  assert.equal(m.undone[d.id], T + 2000);
  // decided again after the undo: the record wins and the tombstone goes
  const again = { decisions: decide({}, d, "done", { today, ts: T + 3000 }), undone: {} };
  const m2 = merge([m, again], T);
  assert.equal(m2.decisions[d.id].ts, T + 3000);
  assert.deepEqual(m2.undone, {});
});

test("merge: idempotent, order-free, old tombstones dropped, ts-less records count as noon", () => {
  const a = { decisions: decide({}, d, "done", { today, ts: T }), undone: { "x": T - 200 * 864e5 } };
  const b = { decisions: { [d.id]: { status: "snoozed", at: today, until: "2026-12-01", d } }, undone: {} };
  const ab = merge([a, b], T), ba = merge([b, a], T);
  assert.ok(same(ab, ba) && same(ab, merge([ab, ab], T)));
  assert.equal(ab.decisions[d.id].status, "done"); // 15:00 beats the legacy noon
  assert.deepEqual(ab.undone, {});
});

test("seal: browser-compatible format, wrong key fails, key validation", async () => {
  const box = await seal({ a: 1 }, key);
  assert.deepEqual(await unseal(box, key), { a: 1 });
  await assert.rejects(unseal(box, Buffer.alloc(32, 1).toString("base64")));
  assert.ok(validKey(key) && !validKey("abc") && !validKey(undefined));
});

const rules = (sync) => JSON.stringify({ format: "cofre-rules", v: 1, learned: {}, overrides: {}, entity_rules: {}, desc_rules: [], sync });
test("rules file: sync config is validated", () => {
  assert.equal(parseRulesFile(rules({ key, repo: "o/r" })).sync.repo, "o/r");
  assert.ok(parseRulesFile(rules({ key, repo: "o/r", gist: "a".repeat(32), token: "github_pat_X1" })).sync.gist);
  assert.throws(() => parseRulesFile(rules({ key: "short", repo: "o/r" })));
  assert.ok(parseRulesFile(rules({ key, repo: "o/r", gist: "b".repeat(32), token: "ghp_X1" })).sync.token);
  assert.throws(() => parseRulesFile(rules({ key, repo: "o/r", gist: "a".repeat(32) })));
});

const fakeTg = () => {
  const calls = [];
  return { calls, updates: async () => [], answer: async () => {}, edit: async (...a) => calls.push(a) };
};
const withMsg = () => ({ ...structuredClone(EMPTY), seq: 1, messages: { 1: { id: d.id, d, text: "🏦 Banco J", at: today, mid: 77 } } });

test("a decision made on the phone edits the Telegram message once; its undo brings the buttons back", async () => {
  const s = withMsg(), tg = fakeTg();
  await applyTaps(s, tg, { chatId: 1, today });
  assert.equal(tg.calls.length, 0); // nothing changed: no edit
  const box = await seal({ v: 1, decisions: decide({}, d, "done", { today, ts: T, by: "app" }), undone: {} }, key);
  const fetch = async (url) => (assert.match(url, /gist\.githubusercontent\.com\/rmoreira7\/g1\/raw\/phone\.enc\?t=/), { ok: true, status: 200, text: async () => box });
  assert.equal(await pullPhone(s, { gist: "g1", key, owner: "rmoreira7", fetch, now: T }), "1");
  assert.equal(await syncMessages(s, tg), 1);
  assert.match(tg.calls[0][1], /✓ Feito no app em 24\/11/);
  assert.equal(await syncMessages(s, tg), 0);
  const undoBox = await seal({ v: 1, decisions: {}, undone: { [d.id]: T + 5000 } }, key);
  await pullPhone(s, { gist: "g1", key, fetch: async () => ({ ok: true, status: 200, text: async () => undoBox }), now: T });
  await syncMessages(s, tg);
  assert.equal(tg.calls[1][1], "🏦 Banco J");
  assert.deepEqual(tg.calls[1][2], [["✓ Feito", "f:1"], ["⏰ Adiar", "a:1"]]);
});

test("a message sent while its decision is already recorded (its check failed) keeps its buttons", async () => {
  const s = { ...withMsg(), decisions: decide({}, d, "done", { today, ts: T }) };
  s.messages[1].seen = sig(s, d.id);
  assert.equal(await syncMessages(s, fakeTg()), 0);
});

test("phone gist missing or unreadable leaves the state alone", async () => {
  const s = withMsg();
  assert.equal(await pullPhone(s, { gist: null, key }), "off");
  assert.equal(await pullPhone(s, { gist: "g", key, fetch: async () => ({ ok: true, status: 200, text: async () => "garbage" }) }), "error");
  assert.deepEqual(s.decisions, {});
});

test("the phone's contas do mês and renewals reach the watcher state; an older or invalid copy does not replace them", async () => {
  const s = withMsg();
  const lists = { monthly: [{ name: "Conta A", day: 10 }], renewals: [{ name: "Plano", date: "2027-01-01" }], ts: T };
  const box = (v) => seal({ v: 1, decisions: {}, undone: {}, ...v }, key);
  const from = async (v) => { const b = await box(v); return pullPhone(s, { gist: "g1", key, fetch: async () => ({ ok: true, status: 200, text: async () => b }), now: T }); };
  await from({ lists });
  assert.deepEqual(s.lists, lists);
  await from({ lists: { ...lists, monthly: [], ts: T - 1 } });
  assert.equal(s.lists.monthly.length, 1, "older copy ignored");
  await from({ lists: { ...lists, monthly: [{ name: "", day: 99 }], ts: T + 1 } });
  assert.equal(s.lists.monthly[0].name, "Conta A", "invalid copy ignored");
  await from({});
  assert.deepEqual(s.lists, lists, "a phone without lists leaves them");
});
