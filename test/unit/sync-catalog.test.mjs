import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { repoRoot } from "../helpers/pi-runner.mjs";

const script = pathToFileURL(join(repoRoot, "scripts/sync-catalog.mjs")).href;

// Each import executes the script afresh; keep its argv, registry, and output isolated.
async function syncWith(fetchRegistry) {
  const out = mkdtempSync(join(tmpdir(), "fp-sync-"));
  const originalFetch = globalThis.fetch;
  process.argv.push("--out", out);
  globalThis.fetch = fetchRegistry;
  try {
    await import(script);
  } finally {
    process.argv.splice(-2, 2);
    globalThis.fetch = originalFetch;
  }
  return out;
}

const success = (objects) => ({ ok: true, json: async () => ({ total: objects.length, objects: objects.map((p) => ({ package: p })) }) });

test("sync writes sorted, deduplicated JSONL, matching gzip and SHA in --out", async () => {
  const calls = [];
  const out = await syncWith(async (url, options) => {
    calls.push({ url, options });
    return success([
      { name: "zeta", version: "1", author: "First", links: { npm: "https://old.example/zeta" } },
      { name: "beta", version: "2", author: { name: "Beth" }, publisher: { username: "publisher" }, keywords: ["pi-package"], links: { repository: "https://example/repo", homepage: "https://example/home" }, description: "B", date: "2026" },
      { name: "zeta", version: "3", author: "Last" },
      { name: "alpha", version: "4" },
    ]);
  });
  const text = readFileSync(join(out, "catalog.jsonl"), "utf8");
  const records = text.trimEnd().split("\n").map(JSON.parse);
  assert.deepEqual(records.map(({ name }) => name), ["alpha", "beta", "zeta"], "records should be sorted and duplicate names replaced");
  assert.deepEqual(records[0], {
    name: "alpha", version: "4", description: "", date: "", author: "", publisher: "", keywords: [],
    npm: "https://www.npmjs.com/package/alpha", repo: "", homepage: "",
  }, "missing metadata should get the documented fallbacks");
  assert.equal(records[1].author, "Beth", "object author should use its name");
  assert.equal(records[1].publisher, "publisher", "publisher should use its username");
  assert.equal(records[1].repo, "https://example/repo", "repository should be preserved");
  assert.equal(records[1].homepage, "https://example/home", "homepage should be preserved");
  assert.equal(records[1].description, "B", "description should be preserved");
  assert.equal(records[1].date, "2026", "date should be preserved");
  assert.deepEqual(records[1].keywords, ["pi-package"], "keywords should be preserved");
  assert.equal(records[2].version, "3", "the last duplicate should win");
  assert.equal(records[2].author, "Last", "string author should be preserved");
  const gz = readFileSync(join(out, "catalog.jsonl.gz"));
  assert.equal(gunzipSync(gz).toString(), text, "compressed catalog should match JSONL exactly");
  assert.equal(readFileSync(join(out, "catalog.jsonl.gz.sha256"), "utf8"), createHash("sha256").update(gz).digest("hex") + "\n", "checksum should match written gzip bytes");
  assert.equal(calls.length, 1, "a small result must fit on one page without sleeping");
  assert.match(calls[0].url, /size=250&from=0$/, "registry should receive the first page request");
  assert.equal(calls[0].options.headers.accept, "application/json", "request should ask for JSON");
});

