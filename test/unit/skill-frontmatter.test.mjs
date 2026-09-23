import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../helpers/pi-runner.mjs";

// Guards the regression that broke this skill: a SKILL.md without frontmatter is
// dropped by pi (skill: null) with only a startup warning. CI also runs the
// reference validator (skills-ref) over the same directories; these checks keep
// the failure visible in the test suite itself, without reimplementing the spec.

const skillsDir = join(repoRoot, "skills");

function readSkill(dir) {
  const content = readFileSync(join(skillsDir, dir, "SKILL.md"), "utf8");
  return { content, dir };
}

/** Parse the top-level frontmatter block, handling folded scalars. */
function frontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md must start with a YAML frontmatter block");
  const fields = {};
  let currentKey = null;
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      fields[currentKey] = kv[2].trim() === ">-" || kv[2].trim() === ">" ? "" : kv[2].trim();
      continue;
    }
    if (currentKey && /^\s+\S/.test(line)) {
      fields[currentKey] = `${fields[currentKey] ?? ""} ${line.trim()}`.trim();
    }
  }
  return fields;
}

test("every skill directory has a loadable SKILL.md", () => {
  const dirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.ok(dirs.length > 0, "expected at least one skill directory");

  for (const dir of dirs) {
    const { content } = readSkill(dir);
    const fields = frontmatter(content);

    // Without a non-empty description pi returns skill: null and drops the skill.
    assert.equal(typeof fields.description, "string", `${dir}: description must be a string`);
    assert.notEqual(fields.description.trim(), "", `${dir}: description must not be empty`);
    assert.ok(fields.description.length <= 1024, `${dir}: description must be at most 1024 characters`);

    // The spec requires name to match the parent directory.
    assert.equal(fields.name, dir, `${dir}: frontmatter name must match the directory name`);
    assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${dir}: name must be lowercase letters, digits and hyphens`);
  }
});

test("the find-packages skill routes on both what it does and when to use it", () => {
  const fields = frontmatter(readSkill("find-packages").content);
  for (const keyword of ["pi package", "install"]) {
    assert.ok(fields.description.includes(keyword), `description should mention "${keyword}" for routing`);
  }
  assert.match(fields.description, /Use when/i, "description should state when to use the skill");
});
