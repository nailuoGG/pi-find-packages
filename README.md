# pi-find-packages

A [pi](https://pi.dev) extension providing a local catalog of the pi package ecosystem plus a `/find-packages` integration-review workflow.

## Features

- **Offline catalog**: syncs the full `keywords:pi-package` corpus (~5k+ packages) from npm to local JSONL; search with jq/grep over descriptions, names, and keywords — no dependence on npm's keyword-matched search
- **`/find-packages <need>`**: retrieve candidates → read-only source analysis in a sandbox → comparison table and recommendation against criteria (feature overlap / peer compatibility / maintenance activity / supply-chain signals)
- **Cold start**: the package ships a bundled catalog snapshot (`data/catalog.jsonl.gz`); install and use immediately with zero network requests on first run
- **Docker isolation by default**: candidate repos are cloned and unpacked inside a credential-free, non-root container; isolation can be disabled explicitly (a risk warning is shown on every use — not recommended)

## Install

```bash
pi install npm:pi-find-packages        # once published
pi install git:github.com/nailuoGG/pi-find-packages
pi install /path/to/pi-find-packages   # local trial
```

## Data directory

`<PI_CODING_AGENT_DIR>/data/pi-find-packages/` (default `~/.pi/agent/data/pi-find-packages/`)

- `catalog.jsonl` — catalog data (one package per line: name/version/description/date/author/keywords/repo)
- `config.json` — `{"isolation": "docker" | "off"}`, default `docker`

## Refreshing the catalog

```bash
node <package-dir>/scripts/sync-catalog.mjs
```

Full pull in ~40 requests; once every ≥30 days is plenty — please avoid hammering the npm registry.

## Analysis sandbox

```bash
docker build -t pi-find-packages-analysis -f docker/Dockerfile.analysis docker
```

The image contains no pi and no credentials: it exists solely to clone/unpack/read third-party source. Never execute a candidate package's install scripts or build artifacts in any environment.

## Security boundaries

- An analysis report is **not** install authorization — whether to `pi install` is always the user's decision
- `isolation: off` injects a risk warning on every use; third-party package source may contain malicious logic
- Planned: update channel via GitHub tag + jsDelivr CDN with checksum verification
