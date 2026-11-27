import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto as crypto } from "node:crypto";
import { seal, unseal, EMPTY } from "../watch/state.mjs";
import { applyTaps, buttons, pruneMessages } from "../watch/taps.mjs";

const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const other = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

test("state: sealed with the key, unreadable without it, and nothing in clear", async () => {
  const s = { ...EMPTY, decisions: { "idle:bank_j": { status: "done", at: "2026-11-24" } } };
  const box = await seal(s, key);
  assert.ok(!box.includes("bank_j"));
  assert.deepEqual((await unseal(box, key)).decisions, s.decisions);
  await assert.rejects(unseal(box, other));
});

const fakeTg = (updates) => {
  const calls = [];
  return { calls, updates: async (offset) => { calls.push(["updates", offset]); return updates; }, edit: async (...a) => calls.push(["edit", ...a]), answer: async (...a) => calls.push(["answer", ...a]) };
};
const d = { id: "bill:card_a:2026-12-03", kind: "bill", title: "Pagar Cartão A", name: "Cartão A", due: "2026-12-03", days: 9, amount: 696, bank: "card_a" };
const fresh = () => ({ ...structuredClone(EMPTY), seq: 1, messages: { 1: { id: d.id, d, text: "🧾 Fatura", at: "2026-11-24", mid: 555 } } });
const tap = (id, data, chat = 42) => ({ update_id: id, callback_query: { id: `q${id}`, data, message: { chat: { id: chat } } } });

test("Feito records the decision, edits the message (with Desfazer) and moves the offset", async () => {
  const s = fresh(), tg = fakeTg([tap(10, "f:1")]);
  assert.equal(await applyTaps(s, tg, { chatId: 42, today: "2026-11-24" }), 1);
  assert.equal(s.decisions[d.id].status, "done");
  assert.equal(s.offset, 10);
  const edit = tg.calls.find((c) => c[0] === "edit");
  assert.equal(edit[1], 555);
  assert.match(edit[2], /✓ Paga em 24\/11/);
  assert.deepEqual(edit[3], [["↩ Desfazer", "u:1"]]);
});

test("Adiar snoozes to the deadline or 7 days; Desfazer brings the buttons back", async () => {
  const s = fresh();
  await applyTaps(s, fakeTg([tap(11, "a:1")]), { chatId: 42, today: "2026-11-30" });
  assert.equal(s.decisions[d.id].until, "2026-12-03");
  const tg = fakeTg([tap(12, "u:1")]);
  await applyTaps(s, tg, { chatId: 42, today: "2026-11-30" });
  assert.equal(s.decisions[d.id], undefined);
  assert.deepEqual(tg.calls.find((c) => c[0] === "edit")[3], buttons(1));
});

test("taps from another chat, or on a forgotten message, change nothing", async () => {
  const s = fresh();
  assert.equal(await applyTaps(s, fakeTg([tap(13, "f:1", 99), tap(14, "f:7")]), { chatId: 42 }), 0);
  assert.deepEqual(s.decisions, {});
  assert.equal(s.offset, 14);
});

test("the next poll starts after the last update seen", async () => {
  const s = { ...fresh(), offset: 20 }, tg = fakeTg([]);
  await applyTaps(s, tg, { chatId: 42 });
  assert.deepEqual(tg.calls[0], ["updates", 21]);
});

test("old message entries are pruned after 60 days", () => {
  const s = fresh();
  pruneMessages(s, "2027-02-01");
  assert.deepEqual(s.messages, {});
});

test("isNetworkError: a connection that never landed, not an API refusal", async () => {
  const { isNetworkError } = await import("../watch/taps.mjs");
  const blip = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new AggregateError([Object.assign(new Error("x"), { code: "ETIMEDOUT" }), Object.assign(new Error("y"), { code: "ENETUNREACH" })]), { code: "ETIMEDOUT" }) });
  assert.equal(isNetworkError(blip), true);
  assert.equal(isNetworkError(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } })), true);
  assert.equal(isNetworkError(Object.assign(new Error("telegram getUpdates: Unauthorized"), { description: "Unauthorized" })), false);
  assert.equal(isNetworkError(new Error("unseal failed")), false);
});
