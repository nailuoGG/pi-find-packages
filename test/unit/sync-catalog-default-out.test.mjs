import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../helpers/pi-runner.mjs";

test("without --out the catalog is written below an isolated HOME", async () => {
  const home = mkdtempSync(join(tmpdir(), "fp-sync-home-"));
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;
  process.env.HOME = home;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ total: 1, objects: [{ package: { name: "default-output", version: "1" } }] }) });
  try {
    await import(pathToFileURL(join(repoRoot, "scripts/sync-catalog.mjs")).href);
  } finally {
    process.env.HOME = originalHome;
    globalThis.fetch = originalFetch;
  }
  const file = join(home, ".pi/agent/data/pi-find-packages/catalog.jsonl");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).name, "default-output", "default output must stay inside the isolated HOME");
});
