#!/usr/bin/env node
// Sync the pi-package catalog from the npm registry search API.
// Data source: https://registry.npmjs.org/-/v1/search?text=keywords:pi-package
// Output: JSONL (one package per line) at ~/.pi/agent/data/pi-find-packages/catalog.jsonl
// Usage: node sync-catalog.mjs [--out <dir>]
//   --out: output directory (default: ~/.pi/agent/data/pi-find-packages; CI writes to a checkout of the data branch)

import { mkdirSync, writeFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const PAGE_SIZE = 250;
const REQUEST_DELAY_MS = 1000; // shared runner IPs get rate-limited fast; stay polite // be polite to the registry
const outArg = process.argv.indexOf("--out");
const OUT_DIR = outArg > -1 ? process.argv[outArg + 1] : join(homedir(), ".pi/agent/data/pi-find-packages");
const OUT_FILE = join(OUT_DIR, "catalog.jsonl");
const OUT_GZ = join(OUT_DIR, "catalog.jsonl.gz");

const seen = new Map(); // name -> record (dedupe across pages)
let total = Infinity;

async function fetchPage(from) {
  const url = `https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=${PAGE_SIZE}&from=${from}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return res.json();
    if (attempt >= 5 || (res.status !== 429 && res.status >= 500)) {
      throw new Error(`registry ${res.status} at from=${from} after ${attempt + 1} attempts`);
    }
    const wait = Math.min(30000, 2000 * 2 ** attempt); // 2s, 4s, 8s, 16s, 30s, 30s
    process.stderr.write(`registry ${res.status} at from=${from}; retrying in ${wait / 1000}s\n`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

function toRecord(p) {
  const links = p.links || {};
  return {
    name: p.name,
    version: p.version,
    description: p.description || "",
    date: p.date || "",
    author: typeof p.author === "string" ? p.author : p.author?.name || "",
    publisher: p.publisher?.username || "",
    keywords: p.keywords || [],
    npm: links.npm || `https://www.npmjs.com/package/${p.name}`,
    repo: links.repository || "",
    homepage: links.homepage || "",
  };
}

for (let from = 0; from < total; from += PAGE_SIZE) {
  const data = await fetchPage(from);
  total = Math.min(data.total, 10000); // search API caps total at 10000
  for (const { package: p } of data.objects) seen.set(p.name, toRecord(p));
  process.stderr.write(`fetched ${seen.size}/${total}\n`);
  if (from + PAGE_SIZE < total) await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
}

const lines = [...seen.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((r) => JSON.stringify(r));

mkdirSync(OUT_DIR, { recursive: true });
const tmp = OUT_FILE + ".tmp";
writeFileSync(tmp, lines.join("\n") + "\n");
renameSync(tmp, OUT_FILE);
writeFileSync(OUT_GZ, gzipSync(Buffer.from(lines.join("\n") + "\n")));

writeFileSync(OUT_GZ + ".sha256", createHash("sha256").update(readFileSync(OUT_GZ)).digest("hex") + "\n");

const bytes = statSync(OUT_FILE).size;
console.log(`done: ${lines.length} packages, ${(bytes / 1e6).toFixed(1)} MB -> ${OUT_FILE}`);
console.log(`gz: ${(statSync(OUT_GZ).size / 1e6).toFixed(1)} MB -> ${OUT_GZ}`);
