import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../helpers/pi-runner.mjs";

// Packaging is a user-facing feature: a manifest that points at a missing file, or a
// `files` whitelist that omits a runtime resource, ships a package that looks installed
// but does nothing. Nothing else in the suite would notice.

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

test("every resource pi loads is declared and present on disk", () => {
  assert.ok(pkg.pi, "package.json must declare a `pi` manifest section");
  assert.ok(Array.isArray(pkg.pi.extensions) && pkg.pi.extensions.length > 0, "at least one extension entry");

  for (const entry of pkg.pi.extensions) {
    const path = join(repoRoot, entry);
    assert.ok(existsSync(path), `pi.extensions entry must exist: ${entry}`);
    assert.ok(statSync(path).isFile(), `pi.extensions entry must be a file: ${entry}`);
  }

  for (const dir of pkg.pi.skills ?? []) {
    const path = join(repoRoot, dir);
    assert.ok(existsSync(path), `pi.skills entry must exist: ${dir}`);
    // pi accepts either a single skill directory or a parent holding skill subdirectories.
    const direct = existsSync(join(path, "SKILL.md"));
    const nested = readdirSync(path, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && existsSync(join(path, entry.name, "SKILL.md")),
    );
    assert.ok(direct || nested, `pi.skills entry must hold a SKILL.md, directly or in a subdirectory: ${dir}`);
  }
});

test("the bundled cold-start catalog is present and non-trivial", () => {
  // Cold start extracts this file; without it the extension starts with no catalog.
  const bundled = join(repoRoot, "data", "catalog.jsonl.gz");
  assert.ok(existsSync(bundled), "data/catalog.jsonl.gz must be shipped");
  assert.ok(statSync(bundled).size > 1024, "the bundled catalog should not be an empty placeholder");
});

test("the published file whitelist covers every runtime resource and exists", () => {
  assert.ok(Array.isArray(pkg.files), "package.json must declare a `files` whitelist");

  for (const required of ["extensions/", "skills/", "scripts/", "data/", "docker/"]) {
    assert.ok(pkg.files.includes(required), `the tarball must include ${required}`);
  }

  for (const entry of pkg.files) {
    assert.ok(existsSync(join(repoRoot, entry)), `whitelisted path does not exist: ${entry}`);
  }

  // Tests and local evidence must not be published.
  for (const excluded of ["test/", "test-evidence/"]) {
    assert.ok(!pkg.files.includes(excluded), `${excluded} must stay out of the published package`);
  }
});

test("the pi peer dependency is declared so the extension API resolves", () => {
  assert.ok(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"], "the pi coding agent must be a peer dependency");
  assert.equal(pkg.type, "module", "the package is ESM and its entry points assume that");
});

test("the test script exists and needs no installed dependency", () => {
  assert.equal(pkg.scripts?.test, "node --test", "the suite must run with the built-in runner only");
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, "the package should have no runtime dependencies");
  assert.ok(!pkg.devDependencies || Object.keys(pkg.devDependencies).length === 0, "the suite should need no dev dependencies");
});
