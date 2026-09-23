# find-packages: pi package catalog search & integration review

Maintains a local catalog of the pi package ecosystem (same source as pi.dev/packages: npm `keywords:pi-package`) for offline/semantic package discovery, plus a standard integration-evaluation workflow.

## Data

- Catalog file: `~/.pi/agent/data/pi-find-packages/catalog.jsonl` (one package per line: name/version/description/date/author/keywords/npm/repo)
- Refresh (pick the first that works):
  1. `/find-packages update` — pulls the latest snapshot from the jsDelivr `data` branch (falls back to the npmmirror tarball of the latest published version); checksum-verified, atomic replace
  2. `node <package-dir>/scripts/sync-catalog.mjs` — full rebuild from the npm registry search API (~40 requests). Only run when the file is older than 30 days or the user asks; avoid hammering the registry.

## Search methods

1. Lexical: `jq -r 'select(.description|test("keyword";"i")) | [.name,.version,.description] | @tsv' catalog.jsonl` — try multiple synonym groups (English-first; cover channel words like remote/telegram/discord/web).
2. Semantic (optional): `qmd query --collection pi-pkg-readmes "need description"` — searches cached READMEs of previously reviewed packages (grows over time; skip when the cache is empty). Only use when the `qmd` binary is available and not disabled via `"semantic":"off"` in `config.json`; otherwise skip this step and rely on lexical search.
3. When both come up empty, fall back to `npm search` and note the catalog may be stale.

## README cache (written as a side effect of review)

After reviewing a candidate, save its README to `~/.pi/agent/data/pi-find-packages/readmes/<name with / replaced by __>.md`, first line `# <name> <version> <date>`; then run `qmd index pi-pkg-readmes` to update the index. **Never bulk-fetch all READMEs** — the corpus grows with real reviews.

## Integration review (check every candidate)

- **Feature overlap**: does it overlap installed packages (`packages` arrays in `~/.pi/agent/settings.json` and the project `.pi/settings.json`) or pi built-ins? No overlap is a hard rule.
- **Compatibility**: does `npm view <pkg> peerDependencies` cover the current pi version?
- **Activity**: latest publish date, latest repo commit.
- **Supply chain**: author/maintainers, dependency count, install/preinstall scripts in package.json, any data-exfiltration paths.

## Execution environment

- **Source analysis must run inside Docker by default** (clone/unpack candidate code via `docker/Dockerfile.analysis`: node24-slim + git + ripgrep, no credentials). The host only receives analysis text. **Never execute a candidate's install scripts or build artifacts.**
- `"isolation":"off"` in `data/pi-find-packages/config.json` disables isolation — a risk warning is shown on every use; not recommended.
- Shallow lookups (`npm view`, registry JSON) do not need the container.

## Output convention

Candidate comparison table (name/version/last publish/activity/fit/risk) + a clear recommendation with reasons. **An analysis report is not install authorization** — the user decides whether to `pi install`.
