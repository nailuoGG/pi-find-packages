import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, join } from "node:path";
import { repoRoot } from "../helpers/pi-runner.mjs";

const enabled = process.env.PI_FIND_PACKAGES_E2E_DOCKER === "1";

// The bind-mount source must sit on a path the daemon can actually see. When the
// daemon runs inside a VM (colima or Docker Desktop), the VM-local /tmp is NOT the
// host /tmp, so mounting a os.tmpdir() path yields an empty /analysis and the test
// looks like "candidate file missing". Those setups share the host home directory,
// so keep the mount source under it. Override with
// PI_FIND_PACKAGES_E2E_DOCKER_TMPDIR when the daemon shares something else.
function shareableBaseDir() {
  return process.env.PI_FIND_PACKAGES_E2E_DOCKER_TMPDIR
    ?? join(homedir(), ".cache", "pi-find-packages-test-mount");
}

test("Docker analysis image runs as non-root and reads candidate source", {
  skip: enabled ? false : "set PI_FIND_PACKAGES_E2E_DOCKER=1 to enable",
}, () => {
  const base = shareableBaseDir();
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "fp-docker-"));
  const tag = `pi-find-packages-analysis-test:${basename(dir)}`.toLowerCase();
  writeFileSync(join(dir, "candidate.txt"), "candidate source is readable\n");
  chmodSync(dir, 0o755);
  try {
    const build = spawnSync("docker", ["build", "-f", "docker/Dockerfile.analysis", "-t", tag, "."], {
      cwd: repoRoot, encoding: "utf8", timeout: 600000,
    });
    assert.equal(build.status, 0, `Docker image should build: ${build.error ?? build.stderr}`);
    const run = spawnSync("docker", ["run", "--rm", "--network", "none", "-v", `${dir}:/analysis:ro`, tag,
      "-c", "id -u; cat /analysis/candidate.txt"], { cwd: repoRoot, encoding: "utf8", timeout: 60000 });
    assert.equal(run.status, 0, `analysis container should run: ${run.error ?? run.stderr}`);
    const [uid, content] = run.stdout.trim().split("\n");
    assert.match(uid, /^[1-9][0-9]*$/, "analysis container must run with a non-root uid");
    assert.equal(content, "candidate source is readable", "non-root user must read the mounted candidate file");
  } finally {
    spawnSync("docker", ["image", "rm", tag], { encoding: "utf8", timeout: 60000 });
    rmSync(dir, { recursive: true, force: true });
  }
});
