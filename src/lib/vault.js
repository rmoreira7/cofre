// Encrypted on-device vault: one AES-GCM blob in IndexedDB, key derived from a PIN with PBKDF2.
// The key lives in memory only and is dropped on lock. Nothing here ever touches the network.

export const ITERATIONS = 600_000;
export const MAX_ATTEMPTS = 10;
const enc = new TextEncoder();
const dec = new TextDecoder();

// Chunked: spreading a large buffer into fromCharCode overflows the call stack (~100k+ bytes).
export const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKey(pin, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function unseal(key, sealed) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, unb64(sealed.ct));
  return JSON.parse(dec.decode(pt));
}

export function validPin(pin) {
  return /^\d{6}$/.test(pin);
}

// storage: { get(): Promise<record|undefined>, put(record): Promise, clear(): Promise }
export function createVault(storage, { iterations = ITERATIONS } = {}) {
  let key = null;

  return {
    async exists() {
      return Boolean(await storage.get());
    },
    get unlocked() {
      return key !== null;
    },
    async create(pin, data) {
      if (!validPin(pin)) throw new Error("PIN must be 6 digits");
      const salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(pin, salt, iterations);
      await storage.put({ v: 1, salt: b64(salt), iterations, attempts: 0, ...(await seal(key, data)) });
    },
    async unlock(pin) {
      const rec = await storage.get();
      if (!rec) throw new Error("no vault");
      const k = await deriveKey(pin, unb64(rec.salt), rec.iterations);
      try {
        const data = await unseal(k, rec);
        key = k;
        if (rec.attempts) await storage.put({ ...rec, attempts: 0 });
        return data;
      } catch {
        const attempts = (rec.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await storage.clear();
          throw Object.assign(new Error("vault wiped after too many wrong PINs"), { wiped: true });
        }
        await storage.put({ ...rec, attempts });
        throw Object.assign(new Error("wrong PIN"), { left: MAX_ATTEMPTS - attempts });
      }
    },
    async save(data) {
      if (!key) throw new Error("locked");
      const rec = await storage.get();
      await storage.put({ ...rec, attempts: 0, ...(await seal(key, data)) });
    },
    lock() {
      key = null;
    },
    async wipe() {
      key = null;
      await storage.clear();
    },
  };
}

export function idbStorage(dbName = "cofre", store = "vault", id = "blob") {
  const open = () =>
    new Promise((res, rej) => {
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(store);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: () => tx("readonly", (s) => s.get(id)),
    put: (rec) => tx("readwrite", (s) => s.put(rec, id)),
    clear: () => tx("readwrite", (s) => s.delete(id)),
  };
}
