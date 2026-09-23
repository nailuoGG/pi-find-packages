import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../helpers/pi-runner.mjs";

test("registry 5xx rejects immediately without publishing a catalog", async () => {
  const out = mkdtempSync(join(tmpdir(), "fp-sync-server-error-"));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  process.argv.push("--out", out);
  globalThis.fetch = async () => { calls++; return { ok: false, status: 503 }; };
  try {
    await assert.rejects(import(pathToFileURL(join(repoRoot, "scripts/sync-catalog.mjs")).href), /registry 503 at from=0 after 1 attempts/, "server error should reject immediately");
  } finally {
    process.argv.splice(-2, 2);
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 1, "server error must not be retried");
  assert.equal(existsSync(join(out, "catalog.jsonl")), false, "failure must not publish a catalog");
});
