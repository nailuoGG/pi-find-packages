# pi-find-packages

A [pi](https://pi.dev) extension providing a local catalog of the pi package ecosystem plus a `/find-packages` integration-review workflow.

## Features

- **Offline catalog**: syncs the full `keywords:pi-package` corpus (~5k+ packages) from npm to local JSONL; search with jq/grep over descriptions, names, and keywords — no dependence on npm's keyword-matched search
- **`/find-packages <need>`**: retrieve candidates → read-only source analysis in a sandbox → comparison table and recommendation against criteria (feature overlap / peer compatibility / maintenance activity / supply-chain signals)
- **Cold start**: the package ships a bundled catalog snapshot (`data/catalog.jsonl.gz`); install and use immediately with zero network requests on first run
- **Docker isolation by default**: candidate repos are cloned and unpacked inside a credential-free, non-root container; isolation can be disabled explicitly (a risk warning is shown on every use — not recommended)

## Install

```bash
pi install npm:@nailuogg/pi-find-packages
pi install git:github.com/nailuoGG/pi-find-packages
pi install /path/to/pi-find-packages   # local trial
```

## Data directory

`<PI_CODING_AGENT_DIR>/data/pi-find-packages/` (default `~/.pi/agent/data/pi-find-packages/`)

- `catalog.jsonl` — catalog data (one package per line: name/version/description/date/author/publisher/keywords/repo)
- `config.json` — `{"isolation": "docker" | "off", "semantic": "auto" | "on" | "off"}`
  - `isolation` defaults to `docker` (sandboxed source analysis)
  - `semantic` controls semantic search over lazily-cached READMEs (via [qmd](https://github.com/tobi/qmd)); defaults to `auto`: enabled automatically when the `qmd` binary is present, force with `"on"`, disable with `"off"`
- `readmes/` — READMEs of reviewed candidates, the corpus behind semantic search (see below)

## Semantic search setup (optional)

Semantic search reads a qmd collection named `pi-pkg-readmes`, pointed at the `readmes/`
directory above. Nothing in this package registers that collection, and qmd does not create
it on demand: an unregistered directory simply stays empty, so semantic search degrades to
lexical search with no error. Register it once:

```bash
qmd collection add "$HOME/.pi/agent/data/pi-find-packages/readmes" --name pi-pkg-readmes
qmd collection show pi-pkg-readmes   # confirm the path matches your data directory
```

Substitute your real data directory when `PI_CODING_AGENT_DIR` is set. Afterwards
`/find-packages` keeps the corpus current on its own: each reviewed candidate's README is
saved into `readmes/` and indexed with `qmd update && qmd embed`.

## Refreshing the catalog

Preferred, in order:

1. `/find-packages update` — pulls the latest snapshot from the jsDelivr `data` branch
   (`cdn.jsdelivr.net/gh/nailuoGG/pi-find-packages@data`), falls back to the npmmirror
   tarball of the latest published version. Checksum-verified, atomic replace.
2. Full rebuild from the npm registry search API (~40 requests):

   ```bash
   node <package-dir>/scripts/sync-catalog.mjs            # default data dir
   node scripts/sync-catalog.mjs --out /tmp/catalog       # custom output dir (used by CI)
   ```

   Once every ≥30 days is plenty — please avoid hammering the npm registry.

A GitHub Actions workflow (`update-data.yml`) refreshes the `data` branch daily when the
corpus changes, which is what the jsDelivr channel serves. The npmmirror channel tracks
the latest npm publish and therefore updates on release cadence.

## Analysis sandbox

```bash
docker build -t pi-find-packages-analysis -f docker/Dockerfile.analysis docker
```

The image contains no pi and no credentials: it exists solely to clone/unpack/read third-party source. Never execute a candidate package's install scripts or build artifacts in any environment.

## Releasing

Publishing is automated: push a tag `v<version>` matching `package.json`, and the
`publish.yml` workflow verifies the version, publishes `@nailuogg/pi-find-packages`
to npm, and creates a GitHub release. Publishing uses npm **Trusted Publishing (OIDC)**: the package's npm settings list
this repository and `publish.yml` as a trusted publisher, so CI authenticates with a
short-lived OIDC token — no `NPM_TOKEN` secret involved. Requires the workflow to run
with `id-token: write` (set) and npm >= 11.5.1 (the workflow installs the latest npm).

## Security boundaries

- An analysis report is **not** install authorization — whether to `pi install` is always the user's decision
- `isolation: off` injects a risk warning on every use; third-party package source may contain malicious logic
- Planned: update channel via GitHub tag + jsDelivr CDN with checksum verification
