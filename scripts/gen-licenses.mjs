#!/usr/bin/env node
// Writes src/lib/data/licenses.json: the third-party notices shown in About.
//
//   node scripts/gen-licenses.mjs           regenerate the file
//   node scripts/gen-licenses.mjs --check   exit 1 when the committed file is stale
//
// Sources:
// - npm: the production tree from `npm ls --omit=dev --all --json`, plus the
//   few dev dependencies whose code is compiled into the bundle (BUNDLED_DEV_PACKAGES)
//   with their own runtime dependencies.
// - Rust: `cargo metadata --offline`, following normal dependency edges from the app
//   crate for every platform (build and dev dependencies are not shipped).
//
// Both kinds contribute their own LICENSE/NOTICE files verbatim (for example
// monaco-editor's ThirdPartyNotices.txt), which is what MIT, BSD and Apache-2.0 ask
// for: the original copyright notice has to travel with the code. Only a package that
// ships no license file at all falls back to the canonical text for its SPDX id
// (CANONICAL_TEXTS at the end of this file), whose copyright line is a placeholder.
//
// Output shape: { packages: [{ name, version, license, repository, source, textId }],
// texts: { [textId]: text } }. No timestamps or local paths, so the output depends only
// on the lockfiles. Dependency-free on purpose.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/lib/data/licenses.json");
const CARGO_MANIFEST = join(root, "src-tauri/Cargo.toml");

// Dev dependencies whose code still ships: the SvelteKit client runtime, the Svelte
// runtime and Tailwind's base CSS. To re-verify, run `npx vite build --sourcemap` and
// list the node_modules packages named in the `sources` of .svelte-kit/output/client/**/*.map.
const BUNDLED_DEV_PACKAGES = ["@sveltejs/kit", "svelte", "tailwindcss"];

// Files that carry license text inside a package directory (matched on the base name)
const LICENSE_FILE = /^(licen[cs]e|copying|notice|third[-_]?party[-_]?notices)([-_.].*)?$/i;
// Look like license files but are metadata or code
const NOT_LICENSE_FILE = /\.(spdx|json|[cm]?js|ts|html?)$/i;

// When an expression offers a choice (A OR B), take the first available id in this list
const SPDX_PREFERENCE = ["MIT", "Apache-2.0", "ISC", "BSD-3-Clause", "Zlib", "Unicode-3.0", "MPL-2.0"];

// Separates the texts of an AND expression inside one entry
const AND_SEPARATOR = "\n\n" + "-".repeat(72) + "\n\n";

class LicenseError extends Error {}

// ---------------------------------------------------------------------------
// Helpers

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Numeric-aware and locale-independent, so the order is the same on every machine
function compareVersions(a, b) {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (x !== y) {
      return compareStrings(x, y);
    }
  }
  return 0;
}

// BOM and line endings normalized, surrounding blank lines and trailing spaces removed
function cleanText(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
}

function normalizeRepository(repo) {
  let url = typeof repo === "string" ? repo : repo?.url;
  if (!url) return null;
  url = url.trim();
  const short = url.match(/^(github|gitlab|bitbucket):([\w.-]+\/[\w.-]+)$/);
  if (short) url = `https://${short[1]}.${short[1] === "bitbucket" ? "org" : "com"}/${short[2]}`;
  else if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

function run(cmd, args, what) {
  try {
    return execFileSync(cmd, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      // npm is a .cmd shim on Windows, which needs a shell
      shell: process.platform === "win32" && cmd === "npm",
    });
  } catch (err) {
    const detail = String(err.stderr || err.message).trim().split("\n").slice(-5).join("\n");
    throw new LicenseError(`${what} failed:\n${detail}`);
  }
}

// ---------------------------------------------------------------------------
// SPDX expressions

// Parses "A OR (B AND C)", "A WITH exception" and the legacy "A/B" (= A OR B).
function parseSpdx(expression) {
  const tokens = expression
    .replace(/\//g, " OR ")
    .replace(/([()])/g, " $1 ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let i = 0;
  const isOp = (t, op) => typeof t === "string" && t.toUpperCase() === op;
  const fail = () => {
    throw new LicenseError(`Cannot parse license expression "${expression}"`);
  };

  function orExpr() {
    const items = [andExpr()];
    while (isOp(tokens[i], "OR")) {
      i++;
      items.push(andExpr());
    }
    return items.length === 1 ? items[0] : { op: "OR", items };
  }
  function andExpr() {
    const items = [atom()];
    while (isOp(tokens[i], "AND")) {
      i++;
      items.push(atom());
    }
    return items.length === 1 ? items[0] : { op: "AND", items };
  }
  function atom() {
    const t = tokens[i++];
    if (t === "(") {
      const inner = orExpr();
      if (tokens[i++] !== ")") fail();
      return inner;
    }
    if (!t || t === ")" || ["AND", "OR", "WITH"].some((op) => isOp(t, op))) fail();
    if (isOp(tokens[i], "WITH")) {
      const exception = tokens[i + 1];
      if (!exception || exception === "(" || exception === ")") fail();
      i += 2;
      return { id: `${t} WITH ${exception}` };
    }
    return { id: t };
  }

  if (tokens.length === 0) fail();
  const tree = orExpr();
  if (i !== tokens.length) fail();
  return tree;
}

function rank(id) {
  const r = SPDX_PREFERENCE.indexOf(id);
  return r < 0 ? SPDX_PREFERENCE.length : r;
}

// The ids whose canonical texts satisfy the expression, or null when one is missing.
// OR takes the option needing the fewest texts, then the most preferred ids.
function chooseIds(node) {
  if (node.id) {
    // SPDX ids are case-insensitive
    const id = Object.keys(CANONICAL_TEXTS).find((k) => k.toLowerCase() === node.id.toLowerCase());
    return id ? [id] : null;
  }
  const options = node.items.map(chooseIds);
  if (node.op === "AND") {
    if (options.includes(null)) return null;
    return [...new Set(options.flat())].sort((a, b) => rank(a) - rank(b) || compareStrings(a, b));
  }
  const cost = (ids) => ids.length * 100 + ids.reduce((sum, id) => sum + rank(id), 0);
  const usable = options.filter(Boolean);
  if (usable.length === 0) return null;
  return usable.reduce((best, ids) => (cost(ids) < cost(best) ? ids : best));
}

// Display form: legacy slashes become OR, whitespace is collapsed
function normalizeExpression(expression) {
  return expression.replace(/\s*\/\s*/g, " OR ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Texts

const texts = new Map(); // textId -> text
const textIdByContent = new Map(); // text -> textId

// Adds a package's own text; identical texts share the first id that used them
function addOwnText(id, text) {
  const existing = textIdByContent.get(text);
  if (existing) return existing;
  texts.set(id, text);
  textIdByContent.set(text, id);
  return id;
}

// Adds the canonical text(s) for an SPDX expression and returns its id
function addSpdxText(expression, owner) {
  const ids = chooseIds(parseSpdx(expression));
  if (!ids) {
    throw new LicenseError(
      `${owner}: no canonical text for "${expression}". ` +
        "Add the SPDX text to CANONICAL_TEXTS in scripts/gen-licenses.mjs.",
    );
  }
  const id = `spdx:${ids.join(" AND ")}`;
  if (!texts.has(id)) {
    const text = ids.map((x) => CANONICAL_TEXTS[x]).join(AND_SEPARATOR);
    texts.set(id, text);
    if (!textIdByContent.has(text)) textIdByContent.set(text, id);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Package directories

// The license files a package ships, concatenated in a stable order. Used for npm
// packages (node_modules/<name>) and for crates (the unpacked registry source).
function licenseFilesText(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && !NOT_LICENSE_FILE.test(f))
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort((a, b) => compareStrings(a.toLowerCase(), b.toLowerCase()) || compareStrings(a, b));
  const parts = files.map((f) => cleanText(readFileSync(join(dir, f), "utf8"))).filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

// ---------------------------------------------------------------------------
// npm

function npmLicenseExpression(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses.map((l) => l.type ?? l).join(" OR ");
  }
  return null;
}

// Node's lookup: <from>/node_modules/<name>, then the same in each parent up to the root.
// Used instead of the `path` of `npm ls --long`, which npm may redact in its output.
function resolvePackageDir(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dir === root || dir === dirname(dir)) return null;
  }
}

// Adds a package and, recursively, its `dependencies` to `dirs`. The walk can pick up a
// dependency the bundler drops (a server-only or types-only one); a notice too many is
// harmless, a missing one is not.
function walkDevDependencies(name, fromDir, trail, dirs) {
  const dir = resolvePackageDir(name, fromDir);
  if (!dir) throw new LicenseError(`${trail} is not installed (run npm ci).`);
  if (dirs.has(dir)) return;
  dirs.add(dir);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    walkDevDependencies(dep, dir, `${trail} -> ${dep}`, dirs);
  }
}

function npmPackageDirs() {
  // Through npm's own CLI when started by `npm run`, which also works on Windows
  const npmCli = process.env.npm_execpath;
  const args = ["ls", "--omit=dev", "--all", "--json"];
  const out =
    npmCli && /\.[cm]?js$/.test(npmCli)
      ? run(process.execPath, [npmCli, ...args], "npm ls")
      : run("npm", args, "npm ls");
  const tree = JSON.parse(out);

  const dirs = new Set();
  (function walk(node, nodeDir) {
    for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
      // Missing optional peers have no version
      if (!dep.version || dep.missing) continue;
      const dir = resolvePackageDir(name, nodeDir);
      if (!dir) throw new LicenseError(`${name}@${dep.version} is not installed (run npm ci).`);
      dirs.add(dir);
      walk(dep, dir);
    }
  })(tree, root);

  // The bundled dev packages are outside the production tree, so `npm ls --omit=dev`
  // reaches neither them nor their own runtime dependencies. Walk those here.
  for (const name of BUNDLED_DEV_PACKAGES) {
    walkDevDependencies(name, root, `${name} (BUNDLED_DEV_PACKAGES)`, dirs);
  }
  return [...dirs];
}

function collectNpm() {
  const byKey = new Map();
  for (const dir of npmPackageDirs()) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const key = `${pkg.name}@${pkg.version}`;
    if (!byKey.has(key)) byKey.set(key, { dir, pkg });
  }
  const list = [...byKey.values()].sort(
    (a, b) => compareStrings(a.pkg.name, b.pkg.name) || compareVersions(a.pkg.version, b.pkg.version),
  );

  return list.map(({ dir, pkg }) => {
    const expression = npmLicenseExpression(pkg);
    const own = licenseFilesText(dir);
    let textId;
    if (own) {
      textId = addOwnText(`npm:${pkg.name}@${pkg.version}`, own);
    } else if (expression) {
      textId = addSpdxText(expression, `${pkg.name}@${pkg.version} (${relative(root, dir)})`);
    } else {
      throw new LicenseError(`${pkg.name}@${pkg.version} has neither a license field nor a license file.`);
    }
    return {
      name: pkg.name,
      version: pkg.version,
      license: expression ? normalizeExpression(expression) : "SEE LICENSE FILE",
      repository: normalizeRepository(pkg.repository) ?? normalizeRepository(pkg.homepage),
      source: "npm",
      textId,
    };
  });
}

// ---------------------------------------------------------------------------
// Rust

function collectCargo() {
  let out;
  try {
    out = run(
      "cargo",
      ["metadata", "--format-version", "1", "--offline", "--locked", "--manifest-path", CARGO_MANIFEST],
      "cargo metadata",
    );
  } catch (err) {
    throw new LicenseError(
      `${err.message}\n(Cargo.lock must be current, and the crates fetched once: \`cargo fetch --locked\` in src-tauri.)`,
    );
  }
  const meta = JSON.parse(out);
  const packages = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const rootId = meta.resolve.root ?? meta.workspace_members[0];

  // Normal edges only; `kind: null` is a normal dependency on any target
  const reached = new Set();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg);
    }
  }

  const list = [...reached]
    .map((id) => packages.get(id))
    .filter((p) => p.source !== null) // our own crate(s)
    .sort((a, b) => compareStrings(a.name, b.name) || compareVersions(a.version, b.version));

  return list.map((p) => {
    const owner = `${p.name}@${p.version}`;
    // The unpacked registry source, which `cargo metadata` has just made sure exists
    const dir = dirname(p.manifest_path);
    let own = licenseFilesText(dir);
    // A crate that points at a file the name scan does not recognize
    if (!own && p.license_file && existsSync(join(dir, p.license_file))) {
      own = cleanText(readFileSync(join(dir, p.license_file), "utf8"));
    }
    let textId;
    if (own) {
      textId = addOwnText(`cargo:${owner}`, own);
    } else if (p.license) {
      textId = addSpdxText(normalizeExpression(p.license), owner);
    } else {
      throw new LicenseError(`${owner} declares neither license nor license-file.`);
    }
    return {
      name: p.name,
      version: p.version,
      license: p.license ? normalizeExpression(p.license) : "SEE LICENSE FILE",
      repository: normalizeRepository(p.repository) ?? normalizeRepository(p.homepage),
      source: "cargo",
      textId,
    };
  });
}

// ---------------------------------------------------------------------------
// Main

function generate() {
  // Rust first, so the canonical texts keep their spdx: ids when an npm file matches one
  const cargo = collectCargo();
  const npm = collectNpm();
  const sortedTexts = Object.fromEntries(
    [...texts.entries()].sort(([a], [b]) => compareStrings(a, b)),
  );
  return { packages: [...npm, ...cargo], texts: sortedTexts };
}

function describeStale(previousJson, next) {
  let prev;
  try {
    prev = JSON.parse(previousJson);
  } catch {
    return "  (the committed file is not valid JSON)";
  }
  const key = (p) => `${p.source}:${p.name}@${p.version}`;
  const before = new Map((prev.packages ?? []).map((p) => [key(p), p]));
  const after = new Map(next.packages.map((p) => [key(p), p]));
  const lines = [];
  for (const k of after.keys()) if (!before.has(k)) lines.push(`  + ${k}`);
  for (const k of before.keys()) if (!after.has(k)) lines.push(`  - ${k}`);
  for (const [k, p] of after) {
    const old = before.get(k);
    if (old && JSON.stringify(old) !== JSON.stringify(p)) lines.push(`  ~ ${k}`);
  }
  const changedTexts = Object.keys(next.texts).filter((id) => prev.texts?.[id] !== next.texts[id]);
  if (changedTexts.length > 0) lines.push(`  ~ ${changedTexts.length} text(s): ${changedTexts.slice(0, 5).join(", ")}`);
  if (lines.length > 20) lines.splice(20, lines.length - 20, `  … and more`);
  return lines.length > 0 ? lines.join("\n") : "  (formatting only)";
}

function main() {
  const check = process.argv.includes("--check");
  const data = generate();
  const json = JSON.stringify(data, null, 2) + "\n";
  const summary = `${data.packages.length} packages, ${Object.keys(data.texts).length} texts`;
  const rel = relative(root, OUT);

  if (check) {
    // A Windows checkout may have CRLF line endings
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : null;
    if (current === json) {
      console.log(`${rel} is up to date (${summary}).`);
      return;
    }
    console.error(`${rel} is ${current === null ? "missing" : "stale"}. Run \`npm run licenses\` and commit the result.`);
    if (current !== null) console.error(describeStale(current, data));
    process.exitCode = 1;
    return;
  }

  writeFileSync(OUT, json);
  console.log(`Wrote ${rel} (${summary}).`);
}

// ---------------------------------------------------------------------------
// Canonical license texts (SPDX), the fallback for a package that ships no license
// file of its own. Copyright lines are templates; each package lists its repository.

const CANONICAL_TEXTS = {
  "MIT": `MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,

  "Apache-2.0": `Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications, including but not limited to software source code, documentation source, and configuration files.

"Object" form shall mean any form resulting from mechanical transformation or translation of a Source form, including but not limited to compiled object code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form, made available under the License, as indicated by a copyright notice that is included in or attached to the work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form, that is based on (or derived from) the Work and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship. For the purposes of this License, Derivative Works shall not include works that remain separable from, or merely link (or bind by name) to the interfaces of, the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including the original version of the Work and any modifications or additions to that Work or Derivative Works thereof, that is intentionally submitted to Licensor for inclusion in the Work by the copyright owner or by an individual or Legal Entity authorized to submit on behalf of the copyright owner. For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to the Licensor or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, the Licensor for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on behalf of whom a Contribution has been received by Licensor and subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by such Contributor that are necessarily infringed by their Contribution(s) alone or by combination of their Contribution(s) with the Work to which such Contribution(s) was submitted. If You institute patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or a Contribution incorporated within the Work constitutes direct or contributory patent infringement, then any patent licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in Source or Object form, provided that You meet the following conditions:

     (a) You must give any other recipients of the Work or Derivative Works a copy of this License; and

     (b) You must cause any modified files to carry prominent notices stating that You changed the files; and

     (c) You must retain, in the Source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the Source form of the Work, excluding those notices that do not pertain to any part of the Derivative Works; and

     (d) If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the attribution notices contained within such NOTICE file, excluding those notices that do not pertain to any part of the Derivative Works, in at least one of the following places: within a NOTICE text file distributed as part of the Derivative Works; within the Source form or documentation, if provided along with the Derivative Works; or, within a display generated by the Derivative Works, if and wherever such third-party notices normally appear. The contents of the NOTICE file are for informational purposes only and do not modify the License. You may add Your own attribution notices within Derivative Works that You distribute, alongside or as an addendum to the NOTICE text from the Work, provided that such additional attribution notices cannot be construed as modifying the License.

     You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Works as a whole, provided Your use, reproduction, and distribution of the Work otherwise complies with the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any Contribution intentionally submitted for inclusion in the Work by You to the Licensor shall be under the terms and conditions of this License, without any additional terms or conditions. Notwithstanding the above, nothing herein shall supersede or modify the terms of any separate license agreement you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to in writing, Licensor provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the appropriateness of using or redistributing the Work and assume any risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether in tort (including negligence), contract, or otherwise, unless required by applicable law (such as deliberate and grossly negligent acts) or agreed to in writing, shall any Contributor be liable to You for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this License or out of the use or inability to use the Work (including but not limited to damages for loss of goodwill, work stoppage, computer failure or malfunction, or any and all other commercial damages or losses), even if such Contributor has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the Work or Derivative Works thereof, You may choose to offer, and charge a fee for, acceptance of support, warranty, indemnity, or other liability obligations and/or rights consistent with this License. However, in accepting such obligations, You may act only on Your own behalf and on Your sole responsibility, not on behalf of any other Contributor, and only if You agree to indemnify, defend, and hold each Contributor harmless for any liability incurred by, or claims asserted against, such Contributor by reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

To apply the Apache License to your work, attach the following boilerplate notice, with the fields enclosed by brackets "[]" replaced with your own identifying information. (Don't include the brackets!)  The text should be enclosed in the appropriate comment syntax for the file format. We also recommend that a file or class name and description of purpose be included on the same "printed page" as the copyright notice for easier identification within third-party archives.

Copyright [yyyy] [name of copyright owner]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`,

  "ISC": `ISC License

<copyright notice>

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,

  "BSD-3-Clause": `Copyright (c) <year> <owner>.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,

  "Zlib": `zlib License

(C) <year> <copyright holders>

This software is provided 'as-is', without any express or implied warranty. In no event will the authors be held liable for any damages arising from the use of this software.

Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.

2. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.

3. This notice may not be removed or altered from any source distribution.`,

  "Unicode-3.0": `UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2024 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.`,

  "MPL-2.0": `Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.`,
};

try {
  main();
} catch (err) {
  if (!(err instanceof LicenseError)) throw err;
  console.error(`gen-licenses: ${err.message}`);
  process.exitCode = 1;
}
