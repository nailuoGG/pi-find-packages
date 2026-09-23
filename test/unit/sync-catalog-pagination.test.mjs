import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../helpers/pi-runner.mjs";

test("a second registry page is fetched and its records join the first", async () => {
  const out = mkdtempSync(join(tmpdir(), "fp-sync-pages-"));
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  const offsets = [];
  process.argv.push("--out", out);
  globalThis.setTimeout = (callback) => queueMicrotask(callback);
  globalThis.fetch = async (url) => {
    const from = Number(new URL(url).searchParams.get("from"));
    offsets.push(from);
    return { ok: true, json: async () => ({
      total: 251,
      objects: [{ package: { name: from ? "second" : "first", version: "1" } }],
    }) };
  };
  try {
    await import(pathToFileURL(join(repoRoot, "scripts/sync-catalog.mjs")).href);
  } finally {
    process.argv.splice(-2, 2);
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimer;
  }
  assert.deepEqual(offsets, [0, 250], "pagination should fetch the next offset exactly once");
  const records = readFileSync(join(out, "catalog.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(records.map((p) => p.name), ["first", "second"], "both pages should appear in sorted output");
});
