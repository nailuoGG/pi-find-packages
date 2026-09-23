import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubExtensionApi } from "../helpers/stub-api.mjs";
import { importExtension, dataDirName, catalogPath } from "../helpers/pi-runner.mjs";

// A missing catalog has to be reported, not silently searched: the whole point of
// the package is the local catalog, and an empty search looks like "no packages
// matched" rather than "you are not set up yet".

async function activate() {
  const agentDir = mkdtempSync(join(tmpdir(), "fp-nocatalog-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const { default: activateExtension } = await importExtension();
  const stub = createStubExtensionApi();
  await activateExtension(stub.api);
  stub.commit();
  return { stub, agentDir };
}

test("a search with no catalog tells the user how to fix it instead of pretending", async () => {
  const { stub, agentDir } = await activate();
  // Remove what cold start just wrote, simulating a user whose catalog is gone.
  rmSync(catalogPath(agentDir), { force: true });
  assert.equal(existsSync(catalogPath(agentDir)), false, "precondition");

  await stub.commands.get("find-packages").handler("control sessions remotely", stub.ctx);

  assert.equal(stub.sent.length, 0, "no search prompt should be sent");
  const error = stub.notifies.find((n) => n.type === "error");
  assert.ok(error, "the user should get an error notification");
  assert.match(error.message, /catalog\.jsonl not found/);
  assert.match(error.message, /\/find-packages update/, "the fix should be named");
  assert.match(error.message, /sync-catalog\.mjs/, "the local rebuild should be named as the fallback");
});

test("an empty catalog file is still reported to the model as-is", async () => {
  const { stub, agentDir } = await activate();
  writeFileSync(catalogPath(agentDir), "");

  await stub.commands.get("find-packages").handler("control sessions remotely", stub.ctx);

  // Existing behaviour: an empty but present file passes the existence check and
  // the prompt goes out. Documented here so a future change is a deliberate one.
  assert.equal(stub.sent.length, 1);
});

test("without the agent-dir override, cold start stays inside an isolated HOME", async () => {
  const home = mkdtempSync(join(tmpdir(), "fp-home-"));
  const previousHome = process.env.HOME;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.HOME = home;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    const { default: activateExtension } = await importExtension();
    const stub = createStubExtensionApi();
    await activateExtension(stub.api);
    stub.commit();
    const fallbackCatalog = join(home, ".pi/agent", dataDirName, "catalog.jsonl");
    assert.ok(existsSync(fallbackCatalog), "fallback agent dir should be created under the isolated HOME");
  } finally {
    process.env.HOME = previousHome;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("without HOME or agent-dir override, relative fallback stays in a temp cwd", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "fp-no-home-"));
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.chdir(cwd);
  delete process.env.HOME;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    const { default: activateExtension } = await importExtension();
    const stub = createStubExtensionApi();
    await activateExtension(stub.api);
    stub.commit();
    assert.ok(existsSync(join(cwd, ".pi/agent", dataDirName, "catalog.jsonl")), "relative fallback catalog must stay inside the test cwd");
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("the data directory is created for a brand new agent dir", async () => {
  const { agentDir } = await activate();
  assert.ok(existsSync(join(agentDir, dataDirName)), "cold start should create the data directory");
});
