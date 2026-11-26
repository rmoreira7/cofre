// Static check for the screen modules: every function a module calls must be imported or declared in it. A missing
// import only fails when that line runs (a branch, or a bind() the Node tests never execute), so it is easy to ship.
// Heuristic, not a parser: calls are `name(` not preceded by "." or a word character; declarations are imports,
// function/const/let/var names, destructured names and parameters.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const GLOBALS = new Set(["Math", "Number", "String", "Object", "Array", "JSON", "Date", "Set", "Map", "Promise", "URL", "Blob", "FormData", "Boolean", "RegExp", "Error",
  "document", "window", "navigator", "location", "setTimeout", "clearTimeout", "confirm", "alert", "prompt", "parseInt", "parseFloat", "isFinite", "isNaN",
  "encodeURIComponent", "requestAnimationFrame", "console", "matchMedia", "fetch", "localStorage", "structuredClone", "Intl", "Event"]);
const KEYWORDS = new Set(["if", "for", "while", "switch", "return", "catch", "function", "typeof", "await", "new", "of", "in", "do", "else", "case", "throw", "async", "import", "export", "super", "void", "delete", "yield"]);
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

// Code with comments, strings and template text removed; a template keeps only its ${…} expressions (recursively).
function codeOnly(src) {
  let i = 0;
  const code = (close) => {
    let out = "", depth = 0;
    while (i < src.length) {
      const c = src[i], n = src[i + 1];
      if (close && c === "}" && depth === 0) { i++; return out; }
      if (c === "{") depth++;
      if (c === "}") depth--;
      if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (c === "/" && n === "*") { i = src.indexOf("*/", i + 2) + 2; continue; }
      if (c === "/" && /[(,=:[!&|?{};]$|^$|return$/.test(out.trimEnd())) { // a regex literal
        i++; let cls = false;
        while (i < src.length && (src[i] !== "/" || cls)) { if (src[i] === "\\") i++; else if (src[i] === "[") cls = true; else if (src[i] === "]") cls = false; i++; }
        i++; while (/[a-z]/.test(src[i] || "")) i++; out += " /r/ "; continue;
      }
      if (c === '"' || c === "'") { const q = c; i++; while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1; i++; out += '""'; continue; }
      if (c === "`") { i++; out += ' "" '; while (i < src.length && src[i] !== "`") { if (src[i] === "\\") { i += 2; continue; } if (src[i] === "$" && src[i + 1] === "{") { i += 2; out += " (" + code(true) + ") "; continue; } i++; } i++; continue; }
      out += c; i++;
    }
    return out;
  };
  return code(false);
}

export function undefinedCalls(src) {
  const code = codeOnly(src);
  const defined = new Set(GLOBALS);
  const add = (list) => list.split(/[,{}\[\]\s=:.]+/).map((x) => x.replace(/^\.\.\./, "")).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x)).forEach((x) => defined.add(x));
  for (const m of code.matchAll(/import\s*(?:\*\s*as\s+(\w+)|\{([^}]*)\}|(\w+))/g)) add((m[1] || m[2] || m[3]).replace(/\bas\b/g, ","));
  for (const m of code.matchAll(/\b(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  // Every name in a declaration list (const a = 1, b = (x) => x;): split at top-level commas.
  for (const m of code.matchAll(/\b(?:const|let|var)\s+/g)) {
    let j = m.index + m[0].length, depth = 0, part = "";
    for (; j < code.length; j++) {
      const ch = code[j];
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) { if (depth === 0) break; depth--; }
      if (depth === 0 && (ch === ";" || ch === "\n" && !/[=,(]\s*$/.test(part))) break;
      if (depth === 0 && ch === ",") { const n = part.trim().match(/^[A-Za-z_$][\w$]*/); if (n) defined.add(n[0]); part = ""; continue; }
      part += ch;
    }
    const n = part.trim().match(/^[A-Za-z_$][\w$]*/); if (n) defined.add(n[0]);
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s*([{[][^=]*?[}\]])\s*=/g)) add(m[1]);
  // Function parameters, with defaults that contain parentheses themselves.
  for (const m of code.matchAll(/function\s*[\w$]*\s*\(/g)) {
    let j = m.index + m[0].length, depth = 1, start = j;
    while (j < code.length && depth) { if (code[j] === "(") depth++; else if (code[j] === ")") depth--; j++; }
    add(code.slice(start, j - 1).replace(/=[^,{}]*?(?=[,}]|$)/g, ""));
  }
  for (const m of code.matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*=>/g)) add(m[1]);
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) defined.add(m[1]);
  for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let)\s*([^;]*?)\s+(?:of|in)\b/g)) add(m[1]);
  for (const m of code.matchAll(/catch\s*\((\w+)\)/g)) defined.add(m[1]);
  for (const m of code.matchAll(/(?:^|[,{]\s*)(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/gm)) { defined.add(m[1]); add(m[2]); }
  const missing = new Set();
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) if (!defined.has(m[1]) && !KEYWORDS.has(m[1])) missing.add(m[1]);
  return [...missing].sort();
}

test("every function a screen module calls is imported or declared there", () => {
  const found = Object.fromEntries(walk("src").filter((f) => /^src\/(screens|ui)\/.*\.js$/.test(f)).map((f) => [f, undefinedCalls(readFileSync(f, "utf8"))]).filter(([, m]) => m.length));
  assert.deepEqual(found, {});
});

test("the check itself flags a missing import and accepts a declared one", () => {
  assert.deepEqual(undefinedCalls('import { a } from "x";\nconst b = (y) => a(y) + c(y);'), ["c"]);
  assert.deepEqual(undefinedCalls("function f(g) { return g(1) + f(2); }"), []);
});
