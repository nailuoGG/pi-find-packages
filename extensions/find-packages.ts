/**
 * /find-packages — search the local pi-package catalog and kick off guided analysis.
 *
 * Data dir: <agentDir>/data/pi-find-packages/catalog.jsonl
 * Cold start: extracts the bundled data/catalog.jsonl.gz on first run.
 * Config (config.json in the data dir):
 *   isolation: "docker" (default) | "off"  — source-analysis execution environment
 *   semantic:  "auto" (default) | "on" | "off" — qmd-backed semantic search over cached READMEs
 * Subcommand: /find-packages update — refresh the catalog from jsDelivr (data branch),
 *   then the npmmirror tarball of the latest published version; local sync script as last resort.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const JSDELIVR_GZ = "https://cdn.jsdelivr.net/gh/nailuoGG/pi-find-packages@data/data/catalog.jsonl.gz";
const JSDELIVR_SHA = "https://cdn.jsdelivr.net/gh/nailuoGG/pi-find-packages@data/data/catalog.jsonl.gz.sha256";
const NPMIRROR_TARBALL = "https://registry.npmmirror.com/@nailuogg%2Fpi-find-packages/latest";

export default function activate(pi: ExtensionAPI) {
  // PI_CODING_AGENT_DIR is the official config-dir override (docs/environment-variables.md).
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? "", ".pi/agent");
  const dataDir = join(agentDir, "data/pi-find-packages");
  const catalog = join(dataDir, "catalog.jsonl");
  const configFile = join(dataDir, "config.json");

  // Cold start: extract bundled snapshot if catalog missing.
  const pkgDir = dirname(dirname(fileURLToPath(import.meta.url))); // extensions/../ = package root
  const bundled = join(pkgDir, "data/catalog.jsonl.gz");
  if (!existsSync(catalog)) {
    mkdirSync(dataDir, { recursive: true });
    if (existsSync(bundled)) {
      writeFileSync(catalog, gunzipSync(readFileSync(bundled)));
      pi.appendEntry("find-packages", { event: "cold-start-extract", from: bundled });
    }
  }

  function readConfig(): Record<string, unknown> {
    try {
      return JSON.parse(readFileSync(configFile, "utf8"));
    } catch {
      return {};
    }
  }

  function isolation(): "docker" | "off" {
    return readConfig().isolation === "off" ? "off" : "docker"; // secure default
  }

  // Semantic search via qmd: "auto" (default) = enabled iff qmd binary exists; "on" forces; "off" disables.
  let qmdAvailable: boolean | undefined;
  function semanticEnabled() {
    const pref = readConfig().semantic;
    if (pref === "off") return false;
    if (qmdAvailable === undefined) {
      try {
        qmdAvailable = spawnSync("qmd", ["--version"], { timeout: 5000 }).status === 0;
      } catch {
        qmdAvailable = false;
      }
    }
    return qmdAvailable;
  }

  async function fetchText(url: string, timeoutMs = 15000): Promise<string | undefined> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return undefined;
      return await res.text();
    } catch {
      return undefined;
    }
  }

  async function fetchBuffer(url: string, timeoutMs = 30000): Promise<Buffer | undefined> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return undefined;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return undefined;
    }
  }

  function sha256(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex");
  }

  function installCatalog(buf: Buffer, ctx): boolean {
    const tmp = join(tmpdir(), `catalog.jsonl.${Date.now()}`);
    try {
      const jsonl = gunzipSync(buf);
      JSON.parse(jsonl.toString("utf8").split("\n")[0]); // sanity: first line parses
      writeFileSync(tmp, jsonl);
      renameSync(tmp, catalog);
      return true;
    } catch {
      try { spawnSync("rm", ["-f", tmp]); } catch {}
      ctx.ui.notify("Downloaded catalog failed validation; keeping the existing file.", "error");
      return false;
    }
  }

  async function updateCatalog(ctx): Promise<void> {
    // 1) jsDelivr data branch (freshest; updated by CI)
    const gz = await fetchBuffer(JSDELIVR_GZ);
    const expected = (await fetchText(JSDELIVR_SHA))?.trim();
    if (gz && expected && sha256(gz) === expected.split(/\s+/)[0]) {
      if (installCatalog(gz, ctx)) ctx.ui.notify("Catalog updated from jsDelivr (data branch).", "info");
      return;
    }
    // 2) npmmirror tarball of the latest published version (freshness = publish cadence)
    try {
      const meta = await (await fetch(NPMIRROR_TARBALL, { signal: AbortSignal.timeout(15000) })).json();
      const tarballUrl: string | undefined = meta?.dist?.tarball;
      if (tarballUrl) {
        const res = await fetch(tarballUrl, { signal: AbortSignal.timeout(60000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const proc = spawnSync("tar", ["-xzOf", "-", "package/data/catalog.jsonl.gz"], { input: buf });
          if (proc.status === 0 && proc.stdout?.length) {
            if (installCatalog(Buffer.from(proc.stdout), ctx)) {
              ctx.ui.notify("Catalog updated from npmmirror (latest published version).", "info");
              return;
            }
          }
        }
      }
    } catch {}
    // 3) fall back to the local sync script
    ctx.ui.notify(
      "Both CDNs unavailable or checksum mismatch. Rebuild locally with:\n"
      + `  node ${join(pkgDir, "scripts/sync-catalog.mjs")}`,
      "warning",
    );
  }

  pi.registerCommand("find-packages", {
    description: "Search local pi-package catalog for packages matching a need; `update` refreshes the catalog",
    handler: async (args, ctx) => {
      const query = (args ?? "").trim();
      if (query === "update") {
        await updateCatalog(ctx);
        return;
      }
      if (!query) {
        ctx.ui.notify("Usage: /find-packages <need> — e.g. /find-packages control sessions remotely; or /find-packages update", "warning");
        return;
      }
      if (!existsSync(catalog)) {
        ctx.ui.notify(`catalog.jsonl not found. Run: /find-packages update  — or: node ${join(pkgDir, "scripts/sync-catalog.mjs")}`, "error");
        return;
      }
      const iso = isolation();
      const riskNote =
        iso === "off"
          ? [
              "",
              "⚠️ **Isolation disabled (isolation: off)**: candidate source will be cloned/unpacked on the host.",
              "Third-party packages may contain malicious install scripts or build logic; host-side analysis is not sandboxed.",
              "This mode is not recommended. Delete data/pi-find-packages/config.json or set isolation:\"docker\" to restore the default.",
            ].join("\n")
          : "";
      const prompt = [
        `Search the local pi-package catalog for packages that satisfy the following need, and complete an integration review:`,
        `**${query}**`,
        "",
        "Steps:",
        "1. Search: run multiple jq/grep keyword passes over `~/.pi/agent/data/pi-find-packages/catalog.jsonl` against description/keywords/name, trying synonyms as needed; "
        + (semanticEnabled()
            ? "also run `qmd query --collection pi-pkg-readmes` for semantic search over cached READMEs (skip if empty); "
            : "")
        + "pick the 3-5 most relevant candidates.",
        "2. Review each candidate (read-only): `npm view <pkg>` for version/deps/peer; clone or download source via the repo link; read entry points, extension points, and the README; judge maintenance activity, dependency surface, and supply-chain signals. "
        + "After reviewing, save the package README to `~/.pi/agent/data/pi-find-packages/readmes/<name with / replaced by __>.md` (first line `# <name> <version> <date>`)"
        + (semanticEnabled() ? ", then run `qmd index pi-pkg-readmes` to update the index" : "") + ".",
        `3. Execution environment: ${iso === "docker" ? "all cloning/unpacking/source analysis must run inside the Docker container (see docker/Dockerfile.analysis); the host only receives analysis text; never run a candidate's install scripts." : "not isolated — analyze read-only on the host (see the risk note above)."}`,
        "4. Criteria: feature overlap with the current setup / installed packages (Unix philosophy: features must not cross); pi compatibility (peer ranges); maintenance activity; dependency and supply-chain safety.",
        "5. Output: a candidate comparison table (name/version/activity/fit/risk) + a clear recommendation with reasons. The analysis report is not install authorization — I decide whether to integrate.",
        riskNote,
      ].filter(Boolean).join("\n");
      await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    },
  });
}
