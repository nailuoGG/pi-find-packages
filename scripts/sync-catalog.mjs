#!/usr/bin/env node
// Sync the pi-package catalog from the npm registry search API.
// Data source: https://registry.npmjs.org/-/v1/search?text=keywords:pi-package
// Output: JSONL (one package per line) at ~/.pi/agent/data/pi-find-packages/catalog.jsonl
// Usage: node sync-catalog.mjs [--full]   (full = fetch all pages; default = same, incremental not yet needed at this scale)

import { mkdirSync, writeFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gzipSync } from "node:zlib";

const PAGE_SIZE = 250;
const REQUEST_DELAY_MS = 300; // be polite to the registry
const OUT_DIR = join(homedir(), ".pi/agent/data/pi-find-packages");
const OUT_FILE = join(OUT_DIR, "catalog.jsonl");
const OUT_GZ = join(OUT_DIR, "catalog.jsonl.gz");

const seen = new Map(); // name -> record (dedupe across pages)
let total = Infinity;

async function fetchPage(from) {
  const url = `https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=${PAGE_SIZE}&from=${from}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`registry ${res.status} at from=${from}`);
  return res.json();
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

const bytes = statSync(OUT_FILE).size;
console.log(`done: ${lines.length} packages, ${(bytes / 1e6).toFixed(1)} MB -> ${OUT_FILE}`);
console.log(`gz: ${(statSync(OUT_GZ).size / 1e6).toFixed(1)} MB -> ${OUT_GZ}`);
