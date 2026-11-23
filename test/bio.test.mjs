import { test } from "node:test";
import assert from "node:assert/strict";
import { createBio } from "../src/lib/bio.js";

const mem = () => { let r; return { get: async () => r, put: async (x) => { r = x; }, clear: async () => { r = undefined; } }; };
// A fake platform authenticator: PRF = HMAC(secret of the credential, salt), released only when the "finger" is right.
function fakeCredentials({ prfAtCreate = true } = {}) {
  const creds = new Map();
  const state = { finger: true, calls: [] };
  const prf = async (secret, salt) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), salt));
  return {
    state,
    async create({ publicKey: o }) {
      state.calls.push(["create", o.authenticatorSelection.userVerification, o.rp.id]);
      const id = crypto.getRandomValues(new Uint8Array(16)), secret = crypto.getRandomValues(new Uint8Array(32));
      creds.set(id.join(","), secret);
      const results = prfAtCreate ? { first: await prf(secret, o.extensions.prf.eval.first) } : undefined;
      return { rawId: id.buffer, getClientExtensionResults: () => ({ prf: { enabled: true, results } }) };
    },
    async get({ publicKey: o }) {
      state.calls.push(["get", o.userVerification]);
      if (!state.finger) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      const secret = creds.get([...o.allowCredentials[0].id].join(","));
      const first = await prf(secret, o.extensions.prf.eval.first);
      return { getClientExtensionResults: () => ({ prf: { results: { first } } }) };
    },
  };
}

test("enroll then unlock returns the PIN; the stored record never holds it in clear", async () => {
  const store = mem(), credentials = fakeCredentials();
  const bio = createBio(store, { credentials, rpId: "example.test", isAvailable: async () => true });
  assert.equal(await bio.available(), true);
  assert.equal(await bio.enrolled(), false);
  await bio.enroll("123456");
  assert.equal(await bio.enrolled(), true);
  assert.equal(JSON.stringify(await store.get()).includes("123456"), false);
  assert.equal(await bio.pin(), "123456");
  assert.deepEqual(credentials.state.calls.map((c) => c.slice(0, 2)), [["create", "required"], ["get", "required"]]);
});

test("PRF reported only as enabled at creation: the first output comes from an assertion", async () => {
  const credentials = fakeCredentials({ prfAtCreate: false });
  const bio = createBio(mem(), { credentials, rpId: "example.test", isAvailable: async () => true });
  await bio.enroll("654321");
  assert.equal(await bio.pin(), "654321");
  assert.equal(credentials.state.calls.filter((c) => c[0] === "get").length, 2);
});

test("no PRF support, a refused finger, and clear", async () => {
  const noPrf = { create: async () => ({ rawId: new ArrayBuffer(8), getClientExtensionResults: () => ({}) }) };
  await assert.rejects(createBio(mem(), { credentials: noPrf, rpId: "x", isAvailable: async () => true }).enroll("111111"), (e) => e.unsupported === true);
  const credentials = fakeCredentials();
  const bio = createBio(mem(), { credentials, rpId: "x", isAvailable: async () => true });
  await bio.enroll("222222");
  credentials.state.finger = false;
  await assert.rejects(bio.pin(), { name: "NotAllowedError" });
  await bio.clear();
  assert.equal(await bio.enrolled(), false);
  assert.equal(await createBio(mem(), { credentials: null, rpId: "x", isAvailable: async () => true }).available(), false);
});
