import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../helpers/pi-runner.mjs";

test("a 429 retries without a real delay and persists the successful response", async () => {
  const out = mkdtempSync(join(tmpdir(), "fp-sync-retry-"));
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  let calls = 0;
  process.argv.push("--out", out);
  globalThis.setTimeout = (callback) => queueMicrotask(callback);
  globalThis.fetch = async () => ++calls === 1
    ? { ok: false, status: 429 }
    : { ok: true, json: async () => ({ total: 1, objects: [{ package: { name: "recovered", version: "1" } }] }) };
  try {
    await import(pathToFileURL(join(repoRoot, "scripts/sync-catalog.mjs")).href);
  } finally {
    process.argv.splice(-2, 2);
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimer;
  }
  assert.equal(calls, 2, "one rate-limited request should be retried exactly once");
  assert.equal(JSON.parse(readFileSync(join(out, "catalog.jsonl"), "utf8")).name, "recovered", "retried data should be persisted");
});
