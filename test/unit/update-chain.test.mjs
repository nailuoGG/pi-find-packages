import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubExtensionApi } from "../helpers/stub-api.mjs";
import { importExtension, dataDirName, catalogPath } from "../helpers/pi-runner.mjs";

// Exercises the refresh chain through its public surface (the `update`
// subcommand) with a stubbed global fetch, so the CDN fallback and checksum
// branches are covered without network access.

const ORIGINAL = '{"name":"original-catalog-entry"}\n';
const originalTmpDir = process.env.TMPDIR;
afterEach(() => {
  if (originalTmpDir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpDir;
});

/** @returns {Promise<{stub: any, agentDir: string}>} */
async function activateWithCatalog(config) {
  const agentDir = mkdtempSync(join(tmpdir(), "fp-update-"));
  mkdirSync(join(agentDir, dataDirName), { recursive: true });
  writeFileSync(catalogPath(agentDir), ORIGINAL);
  if (config) writeFileSync(join(agentDir, dataDirName, "config.json"), config);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.TMPDIR = agentDir; // installCatalog's temporary file stays in this test's directory

  const { default: activate } = await importExtension();
  const stub = createStubExtensionApi();
  await activate(stub.api);
  stub.commit();
  return { stub, agentDir };
}

function sha256Of(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function gzipJsonl(text) {
  return gzipSync(Buffer.from(text, "utf8"));
}

/** A fetch double for the three URLs the refresh chain touches. */
function stubFetch({ gz, sha256, npmmirror }) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const target = String(url);
    if (target.endsWith(".sha256")) {
      if (sha256 === undefined) return { ok: false, text: async () => "" };
      return { ok: true, text: async () => sha256 };
    }
    if (target.includes("npmmirror")) {
      return npmmirror ?? { ok: false, json: async () => ({}) };
    }
    if (target.includes("catalog.jsonl.gz")) {
      return {
        ok: true,
        arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength),
      };
    }
    return { ok: false, text: async () => "", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return calls;
}

test("a checksum-verified download replaces the catalog and reports the source", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  const updated = '{"name":"fresh-from-jsdelivr"}\n';
  const gz = gzipJsonl(updated);
  stubFetch({ gz, sha256: sha256Of(gz) });

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.equal(readFileSync(catalogPath(agentDir), "utf8"), updated);
  assert.ok(
    stub.notifies.some((n) => n.type === "info" && /jsDelivr/i.test(n.message)),
    "the user should be told which source won",
  );
});

test("a checksum mismatch is not installed, and the failure explains how to rebuild", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  const gz = gzipJsonl('{"name":"tampered"}\n');
  const calls = stubFetch({ gz, sha256: "0".repeat(64), npmmirror: { ok: false, json: async () => ({}) } });

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.equal(readFileSync(catalogPath(agentDir), "utf8"), ORIGINAL, "unverified bytes must never be installed");
  assert.ok(calls.some((url) => url.includes("npmmirror")), "the chain should fall back to the mirror");
  assert.ok(
    stub.notifies.some((n) => n.type === "warning" && /Rebuild locally/.test(n.message)),
    "the user needs the recovery command",
  );
});

test("a corrupt gzip that passes the checksum is rejected and the previous catalog survives", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  const corrupt = gzipSync(Buffer.from("this is not jsonl", "utf8"));
  stubFetch({ gz: corrupt, sha256: sha256Of(corrupt) });

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.equal(readFileSync(catalogPath(agentDir), "utf8"), ORIGINAL, "a failed install must keep the old file");
  assert.ok(
    stub.notifies.some((n) => n.type === "error" && /failed validation/i.test(n.message)),
    "the user should learn the download was rejected",
  );
});

test("a successful refresh leaves no temporary file behind", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  const gz = gzipJsonl('{"name":"clean"}\n');
  stubFetch({ gz, sha256: sha256Of(gz) });

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.ok(existsSync(catalogPath(agentDir)));
  assert.ok(!existsSync(join(agentDir, dataDirName, "catalog.jsonl.tmp")), "no stray temp file");
});
