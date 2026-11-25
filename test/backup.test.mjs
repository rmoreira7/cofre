import { test } from "node:test";
import assert from "node:assert/strict";
import { sealBackup, openBackup, validBackupPassword, BACKUP_KIND } from "../src/lib/vault.js";

const fast = { iterations: 100_000 };
const data = { v: 1, settings: { target: 12000 }, credentials: { clientId: "id", clientSecret: "s", items: [] }, userOverrides: { x: "Food" } };

test("backup round-trips the whole vault with its own password", async () => {
  const f = await sealBackup(data, "correct horse battery", { ...fast, now: new Date("2026-11-25T12:00:00Z") });
  assert.equal(f.kind, BACKUP_KIND);
  assert.equal(f.created, "2026-11-25T12:00:00.000Z");
  assert.ok(!JSON.stringify(f).includes("clientSecret"), "nothing in clear");
  assert.deepEqual(await openBackup(JSON.parse(JSON.stringify(f)), "correct horse battery"), data);
});

test("wrong password and foreign files are told apart", async () => {
  const f = await sealBackup(data, "correct horse battery", fast);
  await assert.rejects(openBackup(f, "wrong horse battery"), (e) => e.wrong === true);
  await assert.rejects(openBackup({ kind: "other" }, "x"), (e) => e.bad === true);
  await assert.rejects(openBackup({ ...f, iterations: 1000 }, "correct horse battery"), (e) => e.bad === true);
});

test("the backup password must be long and not just digits", async () => {
  assert.equal(validBackupPassword("123456"), false);
  assert.equal(validBackupPassword("123456789012"), false);
  assert.equal(validBackupPassword("short pass"), false);
  assert.equal(validBackupPassword("uma senha longa"), true);
  await assert.rejects(sealBackup(data, "123456", fast));
});
