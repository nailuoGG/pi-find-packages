import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { repoRoot } from "../helpers/pi-runner.mjs";

const enabled = process.env.PI_FIND_PACKAGES_E2E_DOCKER === "1";

test("Docker analysis image enforces non-root hardened runtime and writable tmpfs workdirs", {
  skip: enabled ? false : "set PI_FIND_PACKAGES_E2E_DOCKER=1 to enable",
}, () => {
  const id = randomUUID();
  const tag = `pi-find-packages-analysis-test:${id}`;
  const containerName = `pi-find-packages-analysis-test-${id}`;
  let buildSucceeded = false;
  let containerCreated = false;
  try {
    const build = spawnSync("docker", ["build", "-f", "docker/Dockerfile.analysis", "-t", tag, "."], {
      cwd: repoRoot, encoding: "utf8", timeout: 600000,
    });
    assert.equal(build.status, 0, `Docker image should build: ${build.error ?? build.stderr}`);
    buildSucceeded = true;

    const create = spawnSync("docker", ["create", "--name", containerName, "--read-only", "--cap-drop=ALL",
      "--security-opt=no-new-privileges", "--tmpfs", "/analysis:rw,mode=1777", "--tmpfs", "/tmp:rw,mode=1777",
      tag, "-c", "set -e; test \"$(id -u)\" -ne 0; touch /analysis/probe /tmp/probe; if touch /root-write-probe 2>/dev/null; then exit 42; fi"], {
      cwd: repoRoot, encoding: "utf8", timeout: 60000,
    });
    assert.equal(create.status, 0, `analysis container should be created: ${create.error ?? create.stderr}`);
    containerCreated = true;

    const run = spawnSync("docker", ["start", "--attach", containerName], {
      cwd: repoRoot, encoding: "utf8", timeout: 60000,
    });
    assert.equal(run.status, 0, `runtime probes should pass (non-root, writable tmpfs dirs, read-only root): ${run.error ?? run.stderr}`);

    const inspect = spawnSync("docker", ["inspect", containerName], { encoding: "utf8", timeout: 60000 });
    assert.equal(inspect.status, 0, `container inspect should succeed: ${inspect.error ?? inspect.stderr}`);
    const [container] = JSON.parse(inspect.stdout);
    const { HostConfig: host, Mounts: mounts } = container;
    assert.equal(container.State.ExitCode, 0, "container runtime probes must exit successfully");
    assert.equal(host.ReadonlyRootfs, true, "root filesystem must be read-only");
    assert.ok(host.CapDrop?.includes("ALL"), "all Linux capabilities must be dropped");
    assert.ok(host.SecurityOpt?.some((option) => /no-new-privileges/.test(option)), "no-new-privileges must be enabled");
    assert.deepEqual(Object.keys(host.Tmpfs ?? {}).sort(), ["/analysis", "/tmp"], "only /analysis and /tmp should be tmpfs mounts");
    for (const path of ["/analysis", "/tmp"]) {
      assert.match(host.Tmpfs[path], /mode=1777/, `${path} tmpfs must have mode 1777`);
    }
    assert.ok(!mounts.some((mount) => mount.Type === "bind"), "container must not have host bind mounts");
  } finally {
    if (containerCreated) {
      spawnSync("docker", ["rm", "--force", containerName], { encoding: "utf8", timeout: 60000 });
    }
    if (buildSucceeded) {
      spawnSync("docker", ["image", "rm", tag], { encoding: "utf8", timeout: 60000 });
    }
  }
});
