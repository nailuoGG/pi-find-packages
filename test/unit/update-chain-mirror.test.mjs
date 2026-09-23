import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubExtensionApi } from "../helpers/stub-api.mjs";
import { importExtension, dataDirName, catalogPath } from "../helpers/pi-runner.mjs";

// Covers the second half of the refresh chain: the npmmirror tarball fallback,
// which is only reached when the jsDelivr branch fails.

const ORIGINAL = '{"name":"original-catalog-entry"}\n';
const originalTmpDir = process.env.TMPDIR;
afterEach(() => {
  if (originalTmpDir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpDir;
});

async function activateWithCatalog() {
  const agentDir = mkdtempSync(join(tmpdir(), "fp-mirror-"));
  mkdirSync(join(agentDir, dataDirName), { recursive: true });
  writeFileSync(catalogPath(agentDir), ORIGINAL);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.TMPDIR = agentDir; // installCatalog's temporary file stays in this test's directory

  const { default: activate } = await importExtension();
  const stub = createStubExtensionApi();
  await activate(stub.api);
  stub.commit();
  return { stub, agentDir };
}

/** Build a real npm-style tarball holding package/data/catalog.jsonl.gz. */
function makeTarball(catalogJsonl, { emptyMember = false } = {}) {
  const build = mkdtempSync(join(tmpdir(), "fp-tarball-"));
  mkdirSync(join(build, "package", "data"), { recursive: true });
  writeFileSync(join(build, "package", "data", "catalog.jsonl.gz"), emptyMember ? Buffer.alloc(0) : gzipSync(Buffer.from(catalogJsonl, "utf8")));
  const tarball = join(build, "package.tgz");
  const result = spawnSync("tar", ["-czf", tarball, "-C", build, "package"]);
  assert.equal(result.status, 0, `tar should succeed: ${result.stderr}`);
  return readFileSync(tarball);
}

/** fetch double: jsDelivr fails the checksum, npmmirror serves `tarball`. */
function stubFetchWithMirror(tarball) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("npmmirror") && !target.endsWith(".tgz")) {
      if (!tarball) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ dist: { tarball: "https://registry.npmmirror.com/catalog.tgz" } }) };
    }
    if (target.endsWith(".tgz")) {
      return { ok: true, arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength) };
    }
    if (target.endsWith(".sha256")) {
      return { ok: true, text: async () => "0".repeat(64) }; // never matches
    }
    const gz = gzipSync(Buffer.from('{"name":"jsdelivr-candidate"}\n', "utf8"));
    return { ok: true, arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) };
  };
  return calls;
}

test("the mirror tarball is unpacked and installed when jsDelivr fails verification", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  const mirrored = '{"name":"from-npmmirror"}\n';
  const calls = stubFetchWithMirror(makeTarball(mirrored));

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.equal(readFileSync(catalogPath(agentDir), "utf8"), mirrored);
  assert.ok(calls.some((url) => url.endsWith(".tgz")), "the tarball should be downloaded");
  assert.ok(
    stub.notifies.some((n) => n.type === "info" && /npmmirror/i.test(n.message)),
    "the user should be told the mirror supplied the catalog",
  );
});

test("a tarball without the expected member falls through to the rebuild warning", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  // A valid gzip that is not a tar archive: `tar -xzO package/data/...` extracts nothing.
  const junk = gzipSync(Buffer.from("not a tarball", "utf8"));
  stubFetchWithMirror(junk);

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.equal(readFileSync(catalogPath(agentDir), "utf8"), ORIGINAL, "nothing should be installed");
  assert.ok(
    stub.notifies.some((n) => n.type === "warning" && /Rebuild locally/.test(n.message)),
    "the user needs the recovery instruction",
  );
});

test("an empty catalog member in the mirror tarball falls through without installing", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  stubFetchWithMirror(makeTarball("", { emptyMember: true }));

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.equal(readFileSync(catalogPath(agentDir), "utf8"), ORIGINAL, "an empty archive member must not replace the catalog");
  assert.ok(stub.notifies.some((n) => n.type === "warning" && /Rebuild locally/.test(n.message)), "an empty archive member should provide recovery advice");
});

test("a mirror tarball whose catalog fails validation is rejected", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  stubFetchWithMirror(makeTarball("this is not jsonl"));

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.equal(readFileSync(catalogPath(agentDir), "utf8"), ORIGINAL, "an invalid catalog must not be installed");
  assert.ok(
    stub.notifies.some((n) => n.type === "error" && /failed validation/i.test(n.message)),
    "the rejection should be reported",
  );
});

test("a network failure while checking jsDelivr is survivable", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  const mirrored = '{"name":"after-network-error"}\n';
  const tarball = makeTarball(mirrored);

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("jsdelivr")) throw new Error("network down"); // exercises the fetch catch arms
    if (target.endsWith(".tgz")) {
      return { ok: true, arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength) };
    }
    if (target.includes("npmmirror")) {
      return { ok: true, json: async () => ({ dist: { tarball: "https://registry.npmmirror.com/catalog.tgz" } }) };
    }
    throw new Error(`unexpected URL ${target}`);
  };

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.equal(readFileSync(catalogPath(agentDir), "utf8"), mirrored, "the chain should recover via the mirror");
});

test("an HTTP error status on jsDelivr is treated as unavailable", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("jsdelivr")) return { ok: false, status: 503, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: false, json: async () => ({}) };
  };

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.equal(readFileSync(catalogPath(agentDir), "utf8"), ORIGINAL);
  assert.ok(stub.notifies.some((n) => n.type === "warning" && /Rebuild locally/.test(n.message)));
});

test("a mirror metadata network failure falls through to local rebuild advice", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  globalThis.fetch = async (url) => {
    if (String(url).includes("npmmirror")) throw new Error("mirror offline");
    return { ok: false, status: 503 };
  };

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.equal(readFileSync(catalogPath(agentDir), "utf8"), ORIGINAL, "network failure must keep the existing catalog");
  assert.ok(stub.notifies.some((n) => n.type === "warning" && /Rebuild locally/.test(n.message)), "the user should get local recovery advice");
});

test("the unpacked catalog is written atomically, leaving no temp file", async () => {
  const { stub, agentDir } = await activateWithCatalog();
  stubFetchWithMirror(makeTarball('{"name":"atomic"}\n'));

  await stub.commands.get("find-packages").handler("update", stub.ctx);

  assert.ok(!existsSync(join(agentDir, dataDirName, "catalog.jsonl.tmp")), "temp file should be gone");
  const installed = readFileSync(catalogPath(agentDir), "utf8");
  assert.equal(installed, '{"name":"atomic"}\n', "the verified catalog should replace the original file");
  assert.equal(createHash("sha256").update(installed).digest("hex").length, 64);
});
