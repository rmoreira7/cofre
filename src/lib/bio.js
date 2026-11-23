// Fingerprint unlock: a platform passkey with the WebAuthn PRF extension. The PRF output only leaves the authenticator
// after user verification (the fingerprint); HKDF turns it into an AES-GCM key that seals a copy of the PIN.
// The PIN stays the master key: a fingerprint unlock decrypts the PIN and then runs the normal vault.unlock(pin), so the
// attempt counter and the wipe still apply. The record holds the credential id, the PRF salt and the sealed PIN.
import { b64, unb64 } from "./vault.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const INFO = enc.encode("cofre-bio-v1");
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function prfKey(prfOutput) {
  const base = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: INFO }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// storage: { get, put, clear } (one IndexedDB record). credentials: navigator.credentials. rpId: the page's host.
export function createBio(storage, { credentials, rpId, isAvailable }) {
  async function evaluate(id, salt) {
    const a = await credentials.get({ publicKey: {
      challenge: rand(32), rpId, allowCredentials: [{ type: "public-key", id }], userVerification: "required", timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    } });
    const out = a?.getClientExtensionResults?.().prf?.results?.first;
    if (!out) throw Object.assign(new Error("Este aparelho não devolveu a chave da digital."), { unsupported: true });
    return new Uint8Array(out);
  }

  return {
    async available() {
      try { return Boolean(credentials && (await isAvailable())); } catch { return false; }
    },
    async enrolled() {
      return Boolean(await storage.get());
    },
    async enroll(pin) {
      const salt = rand(32);
      const cred = await credentials.create({ publicKey: {
        rp: { name: "Cofre", id: rpId }, user: { id: rand(16), name: "cofre", displayName: "Cofre" }, challenge: rand(32),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        timeout: 60000, extensions: { prf: { eval: { first: salt } } },
      } });
      const prf = cred?.getClientExtensionResults?.().prf;
      if (!prf?.enabled && !prf?.results?.first) throw Object.assign(new Error("Este aparelho não suporta desbloqueio por digital no navegador."), { unsupported: true });
      const id = new Uint8Array(cred.rawId);
      // Some authenticators only report `enabled` at creation; the first output then comes from an assertion.
      const out = prf.results?.first ? new Uint8Array(prf.results.first) : await evaluate(id, salt);
      const iv = rand(12);
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await prfKey(out), enc.encode(pin));
      await storage.put({ v: 1, id: b64(id), salt: b64(salt), iv: b64(iv), ct: b64(ct) });
    },
    async pin() {
      const rec = await storage.get();
      if (!rec) throw new Error("Digital não ativada.");
      const key = await prfKey(await evaluate(unb64(rec.id), unb64(rec.salt)));
      return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.iv) }, key, unb64(rec.ct)));
    },
    clear: () => storage.clear(),
  };
}
