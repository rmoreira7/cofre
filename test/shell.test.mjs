import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

// The service worker caches a fixed list: a module missing from it breaks the app offline, silently.
const sw = readFileSync("sw.js", "utf8");
const shell = [...sw.slice(sw.indexOf("const SHELL = ["), sw.indexOf("];", sw.indexOf("const SHELL = ["))).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

test("every module and stylesheet under src/ is in the service worker's shell", () => {
  const missing = walk("src").filter((f) => /\.(js|css)$/.test(f) && !shell.includes(f));
  assert.deepEqual(missing, [], "run: node scripts/update-shell.mjs");
});

test("every shell entry exists", () => {
  assert.deepEqual(shell.filter((f) => f !== "./" && !existsSync(f)), []);
});

test("the cache name carries the app version", () => {
  const v = readFileSync("src/main.js", "utf8").match(/APP_VERSION = "([^"]+)"/)[1];
  assert.match(sw, new RegExp(`const CACHE = "cofre-${v.replace(/\./g, "\\.")}"`));
});

test("the update check reads the served version from sw.js, and new versions install from the network", async () => {
  const { readFileSync } = await import("node:fs");
  const { servedVersion } = await import("../src/screens/settings/about.js");
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(servedVersion(sw), /^\d+\.\d+\.\d+$/);
  assert.equal(servedVersion(sw), readFileSync(new URL("../src/main.js", import.meta.url), "utf8").match(/APP_VERSION = "([^"]+)"/)[1]);
  assert.equal(servedVersion("nothing"), null);
  assert.match(sw, /new Request\(u, \{ cache: "reload" \}\)/);
  assert.match(sw, /pathname\.endsWith\("\/sw\.js"\)/);
});
