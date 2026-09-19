#!/usr/bin/env node
// Fails when the app version differs between the places that carry it.
// package.json is the reference; tauri.conf.json and Cargo.toml must match,
// and so must the two lockfiles (a stale lockfile breaks `npm ci` / `--locked`).
//
// Usage: node scripts/check-versions.mjs   (exit 0 = all equal, 1 = mismatch)
// Dependency-free on purpose: it runs before `npm ci` would matter.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readText(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function readJson(rel) {
  return JSON.parse(readText(rel));
}

// Value of `key = "…"` inside the first `[section]` table of a TOML file.
// Enough for Cargo.toml's [package] table; not a general TOML parser.
function tomlTableValue(text, section, key) {
  let inSection = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (line.startsWith("[")) {
      inSection = line === `[${section}]`;
      continue;
    }
    if (!inSection) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"$/);
    if (m && m[1] === key) return m[2];
  }
  return null;
}

// Version of `name` in Cargo.lock ([[package]] entries are name, then version).
function cargoLockVersion(text, name) {
  const blocks = text.split(/^\[\[package\]\]\s*$/m);
  for (const block of blocks) {
    const n = block.match(/^name\s*=\s*"([^"]*)"/m);
    if (n && n[1] === name) {
      const v = block.match(/^version\s*=\s*"([^"]*)"/m);
      return v ? v[1] : null;
    }
  }
  return null;
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const tauriConf = readJson("src-tauri/tauri.conf.json");
const cargoToml = readText("src-tauri/Cargo.toml");
const crateName = tomlTableValue(cargoToml, "package", "name");

// tauri.conf.json may point at a package.json instead of holding the version itself
let tauriVersion = tauriConf.version ?? null;
if (typeof tauriVersion === "string" && tauriVersion.endsWith(".json")) {
  tauriVersion = readJson(join("src-tauri", tauriVersion)).version ?? null;
}

const found = [
  ["package.json", pkg.version ?? null],
  ["package-lock.json", lock.version ?? null],
  ['package-lock.json (packages[""])', lock.packages?.[""]?.version ?? null],
  ["src-tauri/tauri.conf.json", tauriVersion],
  ["src-tauri/Cargo.toml", tomlTableValue(cargoToml, "package", "version")],
  [
    `src-tauri/Cargo.lock (${crateName})`,
    crateName ? cargoLockVersion(readText("src-tauri/Cargo.lock"), crateName) : null,
  ],
];

const expected = found[0][1];
const bad = found.filter(([, v]) => v === null || v !== expected);

if (!expected || bad.length > 0) {
  console.error("Version mismatch:");
  for (const [file, v] of found) {
    const mark = v === expected && v !== null ? "  " : "✗ ";
    console.error(`  ${mark}${file}: ${v ?? "(missing)"}`);
  }
  console.error(
    "Set the same version everywhere. `npm install` refreshes package-lock.json;" +
      " `cargo check` in src-tauri refreshes Cargo.lock.",
  );
  process.exit(1);
}

console.log(`Versions match: ${expected} (${found.map(([f]) => f).join(", ")})`);
