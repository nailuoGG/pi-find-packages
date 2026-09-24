import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubExtensionApi } from "../helpers/stub-api.mjs";
import { importExtension, dataDirName } from "../helpers/pi-runner.mjs";

/**
 * Activate the extension with a config.json in place and run the command.
 * @returns {Promise<{ prompt: string, stub: ReturnType<typeof createStubExtensionApi> }>}
 */
async function runCommand({ config, need = "control sessions remotely" } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "fp-prompt-"));
  mkdirSync(join(agentDir, dataDirName), { recursive: true });
  if (config !== undefined) {
    writeFileSync(join(agentDir, dataDirName, "config.json"), config);
  }
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const { default: activate } = await importExtension();
  const stub = createStubExtensionApi();
  await activate(stub.api);
  stub.commit();

  const command = stub.commands.get("find-packages");
  assert.ok(command, "find-packages command must be registered");
  await command.handler(need, stub.ctx);

  assert.equal(stub.sent.length, 1, "the command should send exactly one follow-up message");
  return { prompt: stub.sent[0].message, stub, agentDir };
}

test("the injected prompt points at the isolated catalog directory", async () => {
  const { prompt, agentDir } = await runCommand();
  const expectedCatalog = join(agentDir, dataDirName, "catalog.jsonl");
  assert.ok(prompt.includes(expectedCatalog), `prompt should reference ${expectedCatalog}`);
  assert.ok(prompt.includes(join(agentDir, dataDirName, "readmes")), "prompt should reference the readmes cache");
  assert.ok(!prompt.includes("~/.pi/agent"), "prompt must not hardcode the default agent dir");
  assert.match(prompt, /count matches first.*truncated output/i);
  // The qmd-specific wording only appears when the qmd binary exists
  // (semantic mode "auto", same detection as the extension). CI has no qmd.
  const qmdUsable = spawnSync("qmd", ["--version"], { timeout: 5000 }).status === 0;
  if (qmdUsable) {
    assert.match(prompt, /qmd hits only as leads/i);
  } else {
    assert.doesNotMatch(prompt, /qmd query/i);
  }
  assert.match(prompt, /actual pi --version/i);
  assert.match(prompt, /--read-only --cap-drop=ALL --security-opt=no-new-privileges/i);
  assert.match(prompt, /tmpfs mounts for \/analysis and \/tmp with mode=1777/i);
  assert.match(prompt, /no host candidate-source bind mount/i);
});

test("regression: the prompt never tells the model to run the nonexistent qmd index command", async () => {
  const { prompt } = await runCommand();
  assert.ok(!prompt.includes("qmd index"), "qmd has no `index` command; use `qmd update` + `qmd embed`");
});

test("regression: the prompt does not tell the model to fetch candidate source on the host", async () => {
  const { prompt } = await runCommand();
  assert.ok(
    !/clone or download source via the repo link/i.test(prompt),
    "candidate source must only be fetched in the sandbox, not on the host",
  );
  assert.match(prompt, /never fetch candidate source on the host/i);
});

test("isolation:off adds the risk warning and points at host analysis", async () => {
  const { prompt } = await runCommand({ config: JSON.stringify({ isolation: "off" }) });
  assert.match(prompt, /Isolation disabled \(isolation: off\)/);
  assert.match(prompt, /analyze read-only on the host/i);
});

test("the default (or absent) config keeps Docker isolation and shows no warning", async () => {
  for (const config of [undefined, JSON.stringify({})]) {
    const { prompt } = await runCommand({ config });
    assert.match(prompt, /source analysis must run inside the Docker container with --read-only/);
    assert.ok(!/Isolation disabled/.test(prompt), "no risk warning when isolation is on");
  }
});

test('semantic:"off" drops qmd search and indexing instructions from the prompt', async () => {
  const { prompt } = await runCommand({ config: JSON.stringify({ semantic: "off" }) });
  assert.ok(!prompt.includes("qmd query"), "semantic search is disabled");
  assert.ok(!prompt.includes("qmd update"), "semantic indexing is disabled");
});

test("malformed config.json falls back to the safe defaults instead of crashing", async () => {
  const { prompt } = await runCommand({ config: "{ this is not json" });
  assert.match(prompt, /source analysis must run inside the Docker container with --read-only/, "malformed config must not disable isolation");
});

test("an omitted command argument reports usage without sending a prompt", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "fp-prompt-undefined-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const { default: activate } = await importExtension();
  const stub = createStubExtensionApi();
  await activate(stub.api);
  stub.commit();

  await stub.commands.get("find-packages").handler(undefined, stub.ctx);

  assert.equal(stub.sent.length, 0, "missing arguments must not trigger a search");
  assert.ok(stub.notifies.some((n) => /Usage: \/find-packages/.test(n.message)), "missing arguments should show command usage");
});

test("the command reports usage instead of sending an empty prompt", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "fp-prompt-empty-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const { default: activate } = await importExtension();
  const stub = createStubExtensionApi();
  await activate(stub.api);
  stub.commit();

  await stub.commands.get("find-packages").handler("", stub.ctx);
  assert.equal(stub.sent.length, 0, "no prompt should be sent without a need");
  assert.ok(
    stub.notifies.some((n) => n.type === "warning" && /Usage: \/find-packages/.test(n.message)),
    "the user should see usage guidance",
  );
});
