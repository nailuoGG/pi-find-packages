import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { startMockProvider } from "../helpers/mock-provider.mjs";
import {
  makeAgentDir,
  catalogPath,
  packageArgs,
  runPi,
} from "../helpers/pi-runner.mjs";

// Real `pi` processes run here against an isolated, minimal agent dir and a
// scripted local endpoint, so these cases prove the package works inside pi
// rather than merely reading well. They caught a real first-run failure that a
// permissive stub API had reported as working.

const hasJq = spawnSync("jq", ["--version"], { stdio: "ignore" }).status === 0;

test("a fresh install loads the extension and advertises the skill to the model", async () => {
  const mock = await startMockProvider({ responses: [{ kind: "text", text: "acknowledged" }] });
  try {
    const agentDir = makeAgentDir({ mockPort: mock.port, catalog: "none" });

    const result = await runPi({ agentDir, args: [...packageArgs(), "Say acknowledged."] });

    assert.equal(result.code, 0, `pi should exit 0.\nstderr:\n${result.stderr}`);
    assert.ok(
      !/Failed to load extension/.test(result.stderr),
      `the extension must load on a fresh machine.\nstderr:\n${result.stderr}`,
    );
    assert.ok(existsSync(catalogPath(agentDir)), "first run should extract the bundled catalog");

    assert.ok(mock.requests.length >= 1, "pi should have called the model at least once");
    const systemPrompt = JSON.stringify(mock.requests[0].body);
    assert.ok(systemPrompt.includes("available_skills"), "the model should receive the skills block");
    assert.ok(systemPrompt.includes("find-packages"), "the find-packages skill should be advertised");
  } finally {
    await mock.close();
  }
});

test(
  "the agent can use the bundled catalog through the documented search recipe",
  { skip: hasJq ? false : "jq is required by the documented search recipe" },
  async () => {
    // The mock reads its script at request time, so the recipe (which needs the
    // agent dir, which needs the mock's port) can be filled in afterwards.
    const responses = [];
    const mock = await startMockProvider({ responses });
    const agentDir = makeAgentDir({ mockPort: mock.port, catalog: "bundled" });
    const recipe = [
      "jq -r 'select((.name + \" \" + (.description // \"\") + \" \" + ((.keywords // [])|join(\" \")))",
      '| test("remote|telegram";"i")) | [.name, .version] | @tsv\' ' + `"${catalogPath(agentDir)}" | head -3`,
    ].join(" ");
    responses.push(
      { kind: "tool_call", name: "bash", args: { command: recipe } },
      { kind: "text", text: "candidates listed" },
    );
    try {
      const result = await runPi({
        agentDir,
        args: [...packageArgs(), "Run the shell command, then summarize the candidates you found."],
      });

      assert.equal(result.code, 0, `pi should exit 0.\nstderr:\n${result.stderr}`);
      assert.ok(mock.requests.length >= 2, "the tool result should be sent back to the model");

      // Ground truth from the same catalog, computed without jq.
      const names = readFileSync(catalogPath(agentDir), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((pkg) =>
          /remote|telegram/i.test(`${pkg.name} ${pkg.description ?? ""} ${(pkg.keywords ?? []).join(" ")}`),
        )
        .map((pkg) => pkg.name)
        .slice(0, 40);
      assert.ok(names.length > 0, "the bundled catalog should match the probe need");

      const followUp = JSON.stringify(mock.requests[1].body);
      assert.ok(
        names.some((name) => followUp.includes(name)),
        "the agent's tool result should contain real catalog entries",
      );
    } finally {
      await mock.close();
    }
  },
);

test("a broken extension is reported as a load failure rather than passing silently", async () => {
  // Guards the harness itself: if pi stopped reporting load failures, the two
  // cases above would pass for the wrong reason.
  const agentDir = makeAgentDir({ catalog: "bundled" });
  const result = await runPi({
    agentDir,
    args: ["-p", "--no-session", "-ne", "-e", "/nonexistent/extension.ts", "hi"],
  });
  assert.notEqual(result.code, 0, "a missing extension file must fail the run");
  assert.match(result.stderr, /Failed to load extension/);
});

// Opt-in: run the same flow against a real model to check that the package is
// usable by an actual agent, not just a scripted endpoint. Needs real provider
// credentials, so it uses the operator's agent dir unless one is given:
//   PI_FIND_PACKAGES_E2E_REAL_MODEL=provider/model npm test
//   PI_FIND_PACKAGES_E2E_REAL_MODEL=provider/model PI_FIND_PACKAGES_E2E_AGENT_DIR=/path/to/agent npm test
const realModel = process.env.PI_FIND_PACKAGES_E2E_REAL_MODEL;

const realModelAgentDir = () => process.env.PI_FIND_PACKAGES_E2E_AGENT_DIR ?? join(homedir(), ".pi", "agent");

test(
  "a real agent discovers the skill and uses the catalog",
  { skip: realModel ? false : "set PI_FIND_PACKAGES_E2E_REAL_MODEL=provider/model to enable" },
  async () => {
    const result = await runPi({
      agentDir: realModelAgentDir(),
      args: [
        ...packageArgs({ model: realModel }),
        "Find pi packages that let me control my running pi sessions remotely. "
          + "Follow the find-packages workflow, review at most 2 candidates, and report the comparison table.",
      ],
      timeoutMs: 900000,
    });

    assert.equal(result.code, 0, `real-model run should exit 0.\nstderr:\n${result.stderr}`);
    assert.ok(!/Failed to load extension/.test(result.stderr), "the extension must load");
    // The agent must reach the skill and the catalog on its own.
    assert.match(result.stdout, /skills\/find-packages\/SKILL\.md|find-packages. SKILL\.md/,
      "the agent should read the skill");
    assert.match(result.stdout, /catalog\.jsonl/, "the agent should use the catalog");
  },
);
