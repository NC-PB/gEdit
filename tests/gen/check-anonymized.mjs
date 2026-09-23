#!/usr/bin/env node
// Lists what looks personal in a program the owner is thinking of publishing (plan §9.2).
// Written by the M6 prelude (P6); **FX owns it afterwards**.
//
// It is a **reading aid, not a filter**. It never rewrites a file, never moves one and
// never says "this is safe": it prints the lines worth a second look, and the owner
// decides, file by file. A tool that promised to anonymize would be trusted, and the one
// comment it missed would be public for ever.
//
// Codes, numbers, spacing, encoding, line endings and a NUL leader are left exactly as
// they are — a published fixture has to be byte-identical to what the control ran.
//
//   node tests/gen/check-anonymized.mjs <files…>
//
// Exit code 0 when nothing was flagged, 1 when something was, 2 when it could not read a
// file. The output names the file the user passed in and its line numbers, which is the
// point here: this runs on the owner's own machine, on files he chose.

import { readFileSync } from 'node:fs';

/** What is worth a second look, and why. The wording is what the owner reads. */
const RULES = [
  { id: 'name', what: 'a word that reads like a person or a company', re: /\b(?:GmbH|AG|Ltd|Inc|Co\.?KG|S\.?A\.?|B\.?V\.?)\b/i },
  { id: 'customer', what: 'a customer, order or drawing reference', re: /\b(?:KUNDE|CUSTOMER|AUFTRAG|ORDER|ZEICHNUNG|DRAWING|ARTIKEL|PART\s*NO|TEILE?NR)\b/i },
  { id: 'partNumber', what: 'something shaped like a part number', re: /\b[A-Z]{2,}[-_ ]?\d{3,}(?:[-_ ]\d+)*\b/ },
  { id: 'date', what: 'a date', re: /\b\d{1,4}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/ },
  { id: 'path', what: 'a file path or a share', re: /(?:[A-Za-z]:\\|\\\\[A-Za-z0-9_.-]+\\|\/(?:Users|home|Volumes)\/)/ },
  { id: 'email', what: 'an e-mail address', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { id: 'phone', what: 'a telephone number', re: /(?:\+\d{1,3}[\s/-]?)?(?:\(?\d{2,5}\)?[\s/-]){1,2}\d{3,}/ },
  { id: 'nonAscii', what: 'a non-ASCII word, often a name', re: /[^\p{ASCII}]/u },
  { id: 'header', what: 'a program header that carries the machine or the post', re: /^\s*(?:\$[^%]*%|%_N_\w+)/ },
];

/** Everything between a comment marker and its end, in the dialects P1 ships. */
const COMMENT = /\([^)]*\)|;[^\r\n]*/g;

function findings(text) {
  const out = [];
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      // A rule that is about the whole line (a header) sees the line; the rest look at
      // the line too, because a part number outside a comment is just as personal.
      if (rule.re.test(line)) {
        out.push({ line: index + 1, rule: rule.id, what: rule.what, text: line.trim() });
        break;
      }
    }
  });
  return out;
}

/** True when the line holds nothing but a comment — the usual home of a name. */
export function commentTextOf(line) {
  const found = line.match(COMMENT);
  return found === null ? null : found.join(' ');
}

export function checkText(text) {
  return findings(text);
}

function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node tests/gen/check-anonymized.mjs <files…>');
    return 2;
  }
  let flagged = 0;
  for (const file of files) {
    let text;
    try {
      // latin1: the point is to read every byte as a character, whatever the encoding is,
      // so a cp1252 umlaut in a name is still found.
      text = readFileSync(file, 'latin1');
    } catch (err) {
      console.error(`${file}: could not be read (${err instanceof Error ? err.message : String(err)})`);
      return 2;
    }
    const found = findings(text);
    if (found.length === 0) {
      console.log(`${file}: nothing flagged — your call, not the tool's`);
      continue;
    }
    flagged += found.length;
    console.log(`${file}: ${found.length} line(s) worth a second look`);
    for (const entry of found) {
      console.log(`  line ${entry.line}: ${entry.what}`);
      console.log(`    ${entry.text}`);
    }
  }
  if (flagged > 0) {
    console.log('');
    console.log('Nothing was changed. Decide per file whether it may be public; only then');
    console.log('copy it byte for byte to tests/fixtures/nc/owner-public/<profileId>/ and');
    console.log('add its line to tests/fixtures/README.md.');
  }
  return flagged > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv));
