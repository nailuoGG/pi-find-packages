import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../helpers/pi-runner.mjs";

test("a non-429 registry 4xx rejects after its bounded retries and writes nothing", async () => {
  const out = mkdtempSync(join(tmpdir(), "fp-sync-failure-"));
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  let calls = 0;
  process.argv.push("--out", out);
  globalThis.fetch = async () => { calls++; return { ok: false, status: 400 }; };
  globalThis.setTimeout = (callback) => queueMicrotask(callback);
  try {
    await assert.rejects(import(pathToFileURL(join(repoRoot, "scripts/sync-catalog.mjs")).href), /registry 400 at from=0 after 6 attempts/, "registry failure should reject with status and page");
  } finally {
    process.argv.splice(-2, 2);
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimer;
  }
  assert.equal(calls, 6, "bounded retry policy should stop after six attempts");
  assert.equal(existsSync(join(out, "catalog.jsonl")), false, "failure must not publish a partial catalog");
});
