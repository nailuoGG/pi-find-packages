// Helpers for running the real `pi` CLI against an isolated, minimal agent dir.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository root (test/helpers/ -> ../..). */
export const repoRoot = join(HERE, "..", "..");

export const dataDirName = "data/pi-find-packages";

/**
 * Create an isolated agent directory from the checked-in minimal pi-agent config.
 * Nothing is read from the operator's real ~/.pi/agent.
 *
 * @param {object} [options]
 * @param {number} [options.mockPort] Port substituted into models.json baseUrl.
 * @param {"bundled" | "none"} [options.catalog] Seed the catalog, or leave it absent
 *   so the extension must extract it on first run.
 * @returns {string} absolute agent dir
 */
export function makeAgentDir({ mockPort, catalog = "none" } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-find-packages-test-"));
  copyFileSync(join(HERE, "..", "fixtures", "agent", "settings.json"), join(agentDir, "settings.json"));

  let models = readFileSync(join(HERE, "..", "fixtures", "agent", "models.json"), "utf8");
  if (mockPort !== undefined) {
    models = models.replaceAll("${MOCK_PORT}", String(mockPort));
  }
  writeFileSync(join(agentDir, "models.json"), models);

  if (catalog === "bundled") {
    mkdirSync(join(agentDir, dataDirName), { recursive: true });
    writeFileSync(join(agentDir, dataDirName, "catalog.jsonl"), bundledCatalog());
  }
  return agentDir;
}

/** The catalog snapshot shipped with the package, decompressed. */
export function bundledCatalog() {
  return gunzipSync(readFileSync(join(repoRoot, "data", "catalog.jsonl.gz")));
}

export function catalogPath(agentDir) {
  return join(agentDir, dataDirName, "catalog.jsonl");
}

/**
 * Run the real pi CLI non-interactively.
 *
 * stdin is /dev/null on purpose: pi reads stdin when it is a pipe, so spawning
 * with a never-closing stdin pipe makes it hang forever with no output.
 *
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string }>}
 */
export function runPi({ agentDir, args, timeoutMs = 120000, env = {} }) {
  return new Promise((resolve) => {
    const child = spawn("pi", args, {
      cwd: repoRoot,
      // Child pi executes a fresh extension instance; its partial V8 coverage
      // must not overwrite the fuller unit-test report for the same source URL.
      env: { ...process.env, NODE_V8_COVERAGE: undefined, PI_CODING_AGENT_DIR: agentDir, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\nspawn error: ${error.message}` });
    });
  });
}

/** Arguments that load only this package's extension and skill into a minimal pi. */
export function packageArgs({ model = "mock/mock-model", skill = true } = {}) {
  return [
    "-p",
    "--no-session",
    "--mode",
    "json",
    "-ne", // no extension discovery: only the explicit -e below
    "-e",
    join(repoRoot, "extensions", "find-packages.ts"),
    ...(skill ? ["-ns", "--skill", join(repoRoot, "skills")] : []),
    "--model",
    model,
  ];
}

/** Import the extension module (Node strips the TypeScript types). */
export function importExtension() {
  return import(pathToFileURL(join(repoRoot, "extensions", "find-packages.ts")).href);
}

export function exists(path) {
  return existsSync(path);
}
