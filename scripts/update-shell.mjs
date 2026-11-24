// Rewrites sw.js's SHELL list from what is on disk (every .js/.css under src/ plus the static files), and its CACHE
// name from APP_VERSION in src/main.js. Run after adding, moving or removing a module: `node scripts/update-shell.mjs`.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const STATIC = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const src = walk("src").filter((f) => /\.(js|css)$/.test(f)).sort((a, b) => (a.endsWith(".css") ? 0 : 1) - (b.endsWith(".css") ? 0 : 1) || a.localeCompare(b));
const lines = [];
let line = [];
for (const f of [...STATIC, ...src].map((f) => `"${f}"`)) {
  if (line.length && [...line, f].join(", ").length > 112) { lines.push(`  ${line.join(", ")},`); line = []; }
  line.push(f);
}
lines.push(`  ${line.join(", ")},`);
const version = readFileSync("src/main.js", "utf8").match(/APP_VERSION = "([^"]+)"/)[1];
const sw = readFileSync("sw.js", "utf8")
  .replace(/const CACHE = "[^"]+";/, `const CACHE = "cofre-${version}";`)
  .replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = [\n${lines.join("\n")}\n];`);
writeFileSync("sw.js", sw);
console.log(`sw.js: cofre-${version}, ${STATIC.length + src.length} files`);
