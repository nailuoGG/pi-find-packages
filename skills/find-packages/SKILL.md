---
name: find-packages
description: >-
  Search a local offline catalog of the pi package ecosystem (npm keywords:pi-package) and review a
  candidate package before installing it. Use when the user wants to find, compare, or evaluate a pi
  package, extension, or skill to install: lexical and semantic catalog search over cached READMEs,
  catalog refresh when stale, and a fixed integration review (feature overlap with pi built-ins and
  installed packages, peer compatibility, maintenance activity, supply chain) plus sandboxed Docker
  source analysis.
license: MIT
compatibility: >-
  Requires jq, node >= 22 and npm; docker for source analysis; network access for catalog refresh and
  npm view. qmd is optional and only enables semantic search over cached READMEs. POSIX shell assumed.
---

# find-packages

Find pi packages in a local, offline catalog of the pi ecosystem (npm `keywords:pi-package`) and review
a candidate before it gets installed. Search is lexical (`jq`), optionally semantic; review is a fixed
rubric with sandboxed Docker source analysis.

Catalog: `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/data/pi-find-packages/catalog.jsonl` — one JSON object
per line, with fields `name`, `version`, `description`, `date` (last publish), `author` (frequently
empty), `publisher` (use this as the maintainer), `keywords`, `npm`, `repo`, `homepage`. The same
directory holds `config.json` and the `readmes/` cache.

Throughout this file, paths are relative to this skill directory; `../../` is the package root.

## Workflow

1. **Search** the catalog for candidates — §1.
2. **Shortlist** the 3–5 closest matches.
3. **Review** each candidate against the rubric — §3. Feature overlap is a hard rule.
4. **Analyze sources** inside the Docker sandbox when the review needs code-level evidence — §4.
5. **Report** a comparison table plus a recommendation — §5.

Complete the steps in order; never skip the overlap check in step 3.

## 1. Search the catalog

Run one pass per synonym group, English first, and always include channel/transport words
(remote, telegram, discord, web, vnc) when the need is about access or reach:

```bash
CAT="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/data/pi-find-packages/catalog.jsonl"
jq -r 'select((.name + " " + (.description // "") + " " + ((.keywords // [])|join(" ")))
  | test("remote|telegram|discord";"i"))
  | [.name, .version, (.publisher // ""), .date] | @tsv' "$CAT"
```

Expected output — tab-separated, one candidate per line:

```text
@99percentpeople/pi-ssh-remote	0.6.2	GitHub Actions	2026-09-08T08:29:12.985Z
@bacnh85/pi-a2a	0.7.11	bacnh85	2026-09-21T03:51:02.441Z
```

`.description` and `.keywords` can be `null`, hence the `// ""` guards. Keep `test()` case-insensitive.

**Semantic search (optional).** Only when `qmd` is installed and `semantic` is not `"off"` — see
Configuration. It searches cached READMEs of previously reviewed packages only, so check the collection
first and skip semantic search while it is empty — `qmd query` spends an LLM expansion pass per call,
`qmd ls` is free:

```bash
qmd ls pi-pkg-readmes                                  # "No files found" → skip
qmd query --collection pi-pkg-readmes "<one sentence>"
```

**When both come up empty**, fall back to `npm search` and say in the report that the catalog may be
stale.

## 2. Refresh the catalog

Refresh only when the catalog is missing, older than 30 days (`find "$CAT" -mtime +30`), or the user
asks. Avoid hammering the registry.

1. `/find-packages update` — the command provided by this package's extension. Pulls the snapshot from
   the jsDelivr `data` branch (checksum-verified against the published `.sha256`), then falls back to
   the npmmirror tarball of the latest published version.
2. Last resort, when both CDNs fail: run `node ../../scripts/sync-catalog.mjs` to rebuild the catalog
   locally from the npm registry search API (~40 requests). It writes `catalog.jsonl`, its `.gz` and
   `.sha256` into the catalog directory; CI invokes the same script with `--out <dir>`.

## 3. Integration review

Run every candidate through all four checks; record the evidence for each one.

| Check | How to verify | Verdict |
|---|---|---|
| **Feature overlap** (hard rule) | Compare against pi built-ins and the packages installed in the `packages` array of `$PI_CODING_AGENT_DIR/settings.json` and of the project `.pi/settings.json` | Any overlap → recommend against, whatever the other checks say |
| **pi compatibility** | `npm view <pkg> peerDependencies` | Peer range must cover the current pi version |
| **Maintenance activity** | Catalog `date` (last publish) plus the last commit in `repo` | Stale on both → note as risk, not a blocker |
| **Supply chain** | `npm view <pkg> maintainers dependencies scripts` | Flag `install`/`preinstall` scripts, large dependency trees, and any path that sends data off-host |

## 4. Analyze sources in the sandbox

Source analysis runs in Docker by default, using `../../docker/Dockerfile.analysis` (node24-slim + git +
ripgrep, no credentials). Clone, unpack and read candidate code **inside the container**; only analysis
text reaches the host.

**Never execute a candidate's install scripts or build artifacts** — not on the host and not in the
container. Reading `package.json`, the README or registry metadata needs no container, so shallow
lookups stay on the host.

`isolation: "off"` in `config.json` disables isolation and moves analysis to the host; every use shows a
risk warning. Do not recommend it, and do not fall back to host-side analysis on your own when Docker is
unavailable — report the blocker instead.

## 5. Report

Compare the shortlist in a table, then give one recommendation with reasons:

| name | version | last publish | activity | fit | risk |
|---|---|---|---|---|---|
| @acme/pi-search | 1.2.0 | 2026-09-05 | active (7d) | no overlap | low |

**A report is not install authorization.** The user decides whether to run `pi install`.

## README cache

After reviewing a candidate, save its README to
`<catalog dir>/readmes/<name with / replaced by __>.md`, first line `# <name> <version> <date>`, then
refresh the semantic index:

```bash
qmd update && qmd embed
```

This cache is the corpus behind semantic search. Never bulk-fetch READMEs — it grows one real review at
a time.

## Configuration

`<catalog dir>/config.json` (absent file → defaults apply):

- `isolation`: `"docker"` (default) | `"off"` — source-analysis environment.
- `semantic`: `"auto"` (default) | `"on"` | `"off"` — `auto` enables semantic search exactly when the
  `qmd` binary is present.

## Edge cases

| Situation | Action |
|---|---|
| `catalog.jsonl` missing | Cold start extracts it automatically; if it is still missing, run `/find-packages update` |
| Catalog older than 30 days, or no matches | Refresh (§2), then search again; note staleness in the report if the refresh fails |
| `qmd` missing, `semantic: "off"`, or the `pi-pkg-readmes` collection is empty | Skip semantic search; rely on lexical passes |
| Docker unavailable | Stop before source analysis, report the blocker, and ask the user how to proceed |
| `config.json` absent | Defaults apply: Docker isolation on, semantic `auto` |
