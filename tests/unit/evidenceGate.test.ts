// The evidence gate (M12.5 review, owner decision of 2026-10-08).
//
// Evidence about real programs (counts, the labels of a review's findings, descriptions of
// what particular programs write) belongs in `docs/planning/` and nowhere else. Code,
// tests, fixtures, data, the user guide, the changelog and the TODO list use neutral
// wording: say what the rule does and why, never where the knowledge came from.
//
// This test fails when a tracked (or not yet ignored) text file outside `docs/planning/`
// holds any of:
//
//   - the words "clean-room" or "clean room";
//   - the phrase "real CAM output";
//   - the word "survey" or "surveys";
//   - the text "aggregate:" (the way evidence was introduced in a source string);
//   - a review-finding label, an `F` and a number from 1 to 15, on a line that also names
//     the milestone (`M12.5 F3`, `(M12.5, decision 9, F10)`) or the finding itself
//     (`findings F1`). A bare `F7` is a function key or a feed word and is never flagged:
//     a label is only recognised next to the milestone's name, so `Alt+F7`, `G04 F2` and
//     `F1` (the command palette) are safe.
//
// Format markers such as `<PROG_BEGIN_C1>` are not evidence and are not matched.
//
// Two files may name the rule: this one and CONTRIBUTING.md (see ALLOWED). Nothing else is
// exempt; to quote a word in a test, build the text from parts. Binary files are skipped.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The files that may name the rule itself, each with the reason. */
const ALLOWED: Readonly<Record<string, string>> = {
  'tests/unit/evidenceGate.test.ts': 'this gate, which has to write the patterns',
  'CONTRIBUTING.md': 'the contributor rule that points at this gate',
};

/** Text outside the plan may not hold evidence; the plan is where evidence lives. */
const EXEMPT_PREFIXES = ['docs/planning/'];

const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|ico|icns|webp|pdf|woff2?|ttf|otf|zip|gz|wasm|bin|snap)$/i;

/** A review-finding label: `F` and 1 to 15, not part of a key (`Alt+F7`), word or number. */
const LABEL = '(?<![\\w.+\\-$#%/])F(?:1[0-5]|[1-9])(?![\\w.])';

export const RULES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'clean-room', pattern: /clean[- ]room/i },
  { name: 'real CAM output', pattern: /real CAM output/i },
  { name: 'survey', pattern: /\bsurveys?\b/i },
  { name: 'aggregate', pattern: /\baggregates?:/i },
  { name: 'finding label next to the milestone', pattern: new RegExp(`M12\\.5[^\\n]{0,60}?${LABEL}`) },
  { name: 'finding label next to a work package', pattern: new RegExp(`WP-RP\\d[^\\n]{0,60}?${LABEL}`) },
  { name: 'finding label after "findings"', pattern: new RegExp(`\\bfindings?:? ${LABEL}`, 'i') },
];

/** The 1-based lines of `text` that break a rule, with the rule's name. */
export function violations(text: string): { line: number; rule: string }[] {
  const out: { line: number; rule: string }[] = [];
  text.split('\n').forEach((line, i) => {
    for (const rule of RULES) if (rule.pattern.test(line)) out.push({ line: i + 1, rule: rule.name });
  });
  return out;
}

function trackedTextFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');
  return listed
    .split('\0')
    .filter((path) => path !== '' && !BINARY_EXTENSIONS.test(path))
    .filter((path) => !EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .filter((path) => !(path in ALLOWED));
}

describe('the rules', () => {
  it('flag the words and the labels they are written for', () => {
    expect(violations('a ' + 'clean' + '-room recommendation').map((v) => v.rule)).toEqual(['clean-room']);
    expect(violations('Clean ' + 'Room').length).toBe(1);
    expect(violations('from ' + 'real CAM' + ' output with counts').length).toBe(1);
    expect(violations('the ' + 'survey' + ' showed').length).toBe(1);
    expect(violations('real CAM output (' + 'aggregate' + ': 8 programs)').map((v) => v.rule)).toEqual(['real CAM output', 'aggregate']);
    expect(violations('since M12.5 (F3) the rule skips').map((v) => v.rule)).toEqual(['finding label next to the milestone']);
    expect(violations('M12.5 decision 9 (F10): a control').length).toBe(1);
    expect(violations('the detection findings F1, F2').map((v) => v.rule)).toEqual(['finding label after "findings"']);
    expect(violations('WP-RP3: F15 and F6').length).toBe(1);
  });

  it('leave function keys, feed words, markers and ordinary words alone', () => {
    for (const ok of [
      'Alt+F7 steps through the waits',
      'M12.5 adds Alt+F7 and Shift+F2',
      'G04 F2 is a dwell',
      'the command palette (F1)',
      'M12.5 reads a feed of F100 and a key Ctrl+F9',
      'a section starts at <PROG_BEGIN_C1>',
      'a real CAM post writes it',
      'surveyed the folder',
      'an aggregate of rules',
    ]) {
      expect(violations(ok), ok).toEqual([]);
    }
  });
});

describe('the evidence gate: no evidence outside docs/planning/', () => {
  it('finds none in the tracked text files', () => {
    const files = trackedTextFiles();
    expect(files.length).toBeGreaterThan(1000);
    const found: string[] = [];
    for (const path of files) {
      const bytes = readFileSync(join(ROOT, path));
      if (bytes.subarray(0, 8000).includes(0)) continue;
      for (const v of violations(bytes.toString('utf8'))) found.push(`${path}:${v.line}  ${v.rule}`);
    }
    expect(found, 'move the evidence into docs/planning/ and say it neutrally here').toEqual([]);
  });
});
