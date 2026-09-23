import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubExtensionApi } from "../helpers/stub-api.mjs";
import { importExtension, dataDirName } from "../helpers/pi-runner.mjs";

// The semantic-search switch depends on whether `qmd` is on PATH, so the tests
// control PATH themselves instead of inheriting whatever the machine happens to
// have. That keeps the assertions identical locally and in CI.

/**
 * @param {"present" | "absent"} qmd
 * @returns {() => void} restore PATH
 */
function setPath(qmd) {
  const previous = process.env.PATH;
  const bin = mkdtempSync(join(tmpdir(), "fp-bin-"));
  if (qmd === "present") {
    const fake = join(bin, "qmd");
    writeFileSync(fake, "#!/bin/sh\nexit 0\n");
    chmodSync(fake, 0o755);
  }
  process.env.PATH = bin;
  return () => {
    process.env.PATH = previous;
    rmSync(bin, { recursive: true, force: true });
  };
}

async function promptFor({ config, qmd }) {
  const restore = setPath(qmd);
  try {
    const agentDir = mkdtempSync(join(tmpdir(), "fp-semantic-"));
    mkdirSync(join(agentDir, dataDirName), { recursive: true });
    if (config) writeFileSync(join(agentDir, dataDirName, "config.json"), JSON.stringify(config));
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const { default: activate } = await importExtension();
    const stub = createStubExtensionApi();
    await activate(stub.api);
    stub.commit();
    await stub.commands.get("find-packages").handler("control sessions remotely", stub.ctx);
    assert.equal(stub.sent.length, 1);
    return stub.sent[0].message;
  } finally {
    restore();
  }
}

test("semantic auto + qmd installed adds the semantic search step", async () => {
  const prompt = await promptFor({ config: { semantic: "auto" }, qmd: "present" });
  assert.match(prompt, /qmd query --collection pi-pkg-readmes/);
  assert.match(prompt, /qmd update && qmd embed/, "the README cache should be indexed with the real commands");
});

test("semantic auto + qmd missing quietly falls back to lexical search", async () => {
  const prompt = await promptFor({ config: { semantic: "auto" }, qmd: "absent" });
  assert.ok(!prompt.includes("qmd"), "no qmd instructions when the binary is unavailable");
  assert.match(prompt, /jq/, "the lexical recipe must still be handed over");
});

test('semantic "on" with qmd missing still degrades instead of crashing', async () => {
  const prompt = await promptFor({ config: { semantic: "on" }, qmd: "absent" });
  assert.ok(!prompt.includes("qmd"));
  assert.match(prompt, /jq/);
});

test('semantic "off" removes the semantic step even when qmd is installed', async () => {
  const prompt = await promptFor({ config: { semantic: "off" }, qmd: "present" });
  assert.ok(!prompt.includes("qmd"), "an explicit off must win over an available binary");
});

test("unknown config keys are ignored and the defaults still apply", async () => {
  const prompt = await promptFor({ config: { mystery: true, isolation: "docker" }, qmd: "present" });
  assert.match(prompt, /must run inside the Docker container/);
  assert.ok(!/Isolation disabled/.test(prompt));
});
