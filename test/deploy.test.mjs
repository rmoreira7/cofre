import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The service worker pre-caches SHELL; one file missing from the Pages copy makes its install fail and freezes the
// phone on the old version. Every top-level SHELL entry must be in the workflow's cp line.
test("Pages deploy copies everything the service worker pre-caches", () => {
  const sw = readFileSync("sw.js", "utf8");
  const shell = [...sw.slice(sw.indexOf("SHELL = ["), sw.indexOf("];")).matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((f) => f !== "./");
  const cp = readFileSync(".github/workflows/pages.yml", "utf8").match(/cp -r ([^\n]+) _site\//)[1].split(/\s+/);
  for (const f of shell) assert.ok(cp.includes(f.split("/")[0]), `${f} is pre-cached but not deployed`);
});
