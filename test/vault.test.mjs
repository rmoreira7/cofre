import { test } from "node:test";
import assert from "node:assert/strict";
import { createVault, MAX_ATTEMPTS, validPin } from "../src/lib/vault.js";

const memory = () => {
  let rec;
  return { get: async () => rec, put: async (r) => { rec = structuredClone(r); }, clear: async () => { rec = undefined; }, peek: () => rec };
};
const fast = { iterations: 1000 };
const sample = { clientId: "test-client", items: { bank: "test-item" }, snapshot: { total: 1 } };

test("PIN format", () => {
  assert.ok(validPin("123456"));
  for (const bad of ["12345", "1234567", "abcdef", "12 456", ""]) assert.ok(!validPin(bad));
});

test("create → lock → unlock round-trips the data", async () => {
  const s = memory();
  const v = createVault(s, fast);
  await v.create("123456", sample);
  v.lock();
  assert.equal(v.unlocked, false);
  assert.deepEqual(await v.unlock("123456"), sample);
  assert.equal(v.unlocked, true);
});

test("stored blob holds no plaintext", async () => {
  const s = memory();
  await createVault(s, fast).create("123456", sample);
  const raw = JSON.stringify(s.peek());
  for (const needle of ["test-client", "test-item", "snapshot"]) assert.ok(!raw.includes(needle), needle);
});

test("wrong PIN fails and counts down", async () => {
  const s = memory();
  const v = createVault(s, fast);
  await v.create("123456", sample);
  v.lock();
  await assert.rejects(v.unlock("000000"), (e) => e.left === MAX_ATTEMPTS - 1);
  assert.equal(v.unlocked, false);
  assert.deepEqual(await v.unlock("123456"), sample);
  assert.equal(s.peek().attempts, 0);
});

test("too many wrong PINs wipe the vault", async () => {
  const s = memory();
  const v = createVault(s, fast);
  await v.create("123456", sample);
  v.lock();
  for (let i = 1; i < MAX_ATTEMPTS; i++) await assert.rejects(v.unlock("000000"));
  await assert.rejects(v.unlock("000000"), (e) => e.wiped === true);
  assert.equal(await v.exists(), false);
});

test("save re-encrypts with a fresh IV", async () => {
  const s = memory();
  const v = createVault(s, fast);
  await v.create("123456", sample);
  const iv1 = s.peek().iv;
  await v.save({ ...sample, snapshot: { total: 2 } });
  assert.notEqual(s.peek().iv, iv1);
  v.lock();
  assert.equal((await v.unlock("123456")).snapshot.total, 2);
});

test("save while locked is refused", async () => {
  const v = createVault(memory(), fast);
  await assert.rejects(v.save(sample), /locked/);
});

test("large payloads (≥ 1 MB) seal and unseal", async () => {
  const s = memory();
  const big = { rows: Array.from({ length: 12000 }, (_, i) => ({ id: i, description: "x".repeat(80) })) };
  const v = createVault(s, fast);
  await v.create("123456", big);
  v.lock();
  assert.equal((await v.unlock("123456")).rows.length, 12000);
  await v.save({ ...big, more: true });
  v.lock();
  assert.equal((await v.unlock("123456")).more, true);
});
