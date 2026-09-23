import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubExtensionApi } from "../helpers/stub-api.mjs";
import { importExtension, catalogPath, dataDirName } from "../helpers/pi-runner.mjs";

/** Activate the extension against an isolated agent dir, the way pi does. */
async function activateExtension(agentDir) {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const { default: activate } = await importExtension();
  const stub = createStubExtensionApi();
  await activate(stub.api);
  stub.commit();
  return stub;
}

test("the extension factory survives pi's loading rules and extracts the catalog", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "fp-cold-start-"));
  assert.equal(existsSync(join(agentDir, dataDirName)), false, "precondition: no data dir yet");

  // activate() must not throw: pi rejects the whole extension when the factory throws.
  const stub = await activateExtension(agentDir);
  // session_start is where pi allows long-lived setup; emit it so the assertion
  // holds whether the extraction happens during loading or on session start.
  await stub.emit("session_start");

  assert.ok(existsSync(catalogPath(agentDir)), "the bundled catalog should be extracted on first run");
  const firstLine = readFileSync(catalogPath(agentDir), "utf8").split("\n")[0];
  assert.doesNotThrow(() => JSON.parse(firstLine), "extracted catalog must be JSONL");
  assert.ok(stub.commands.has("find-packages"), "the find-packages command should be registered");
  assert.ok(
    stub.entries.some((entry) => entry.type === "find-packages" && entry.data?.event === "cold-start-extract"),
    "the deferred cold-start audit entry should be recorded once the session starts",
  );
});

test("cold start does not re-extract when the catalog already exists", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "fp-cold-start-existing-"));
  mkdirSync(join(agentDir, dataDirName), { recursive: true });
  const sentinel = join(catalogPath(agentDir));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(sentinel, '{"name":"sentinel"}\n');

  await activateExtension(agentDir);
  assert.equal(readFileSync(sentinel, "utf8"), '{"name":"sentinel"}\n', "an existing catalog must be left alone");
});
