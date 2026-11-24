// AES-256-GCM sealing shared by the watcher (Node) and the phone (browser): the same file format on both sides, so the
// phone can read the watcher's state and the watcher the phone's. key: 32 bytes, base64. Output: JSON {v, iv, ct}.
const b64 = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function importKey(k) {
  const raw = unb64(k);
  if (raw.length !== 32) throw new Error("a chave de sincronização deve ter 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(value, k) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(k), new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) });
}

export async function unseal(text, k) {
  const { iv, ct } = JSON.parse(text);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await importKey(k), unb64(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

export const validKey = (k) => { try { return typeof k === "string" && unb64(k).length === 32; } catch { return false; } };
