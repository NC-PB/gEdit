// Tests for tests/gen/gen-large.mjs, the generator of large programs for performance tests.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectProfile } from '$lib/core/profiles/detect';
import { OutlineIndex } from '$lib/core/profiles/outline';
import { validateProfile } from '$lib/core/profiles/validate';
import { generateLarge } from '../gen/gen-large.mjs';
import type { CompiledProfile } from '$lib/core/profiles/types';

const MIB = 1024 * 1024;

/** The built-ins, through the same gate the profile registry uses (M3: WP3.1). */
const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return compileProfile(checked.profile);
});

/** Which profile the content picks, given the other one as the fallback. */
function detect(path: string, text: string, fallback: string): string {
  return detectProfile(BUILTINS, path, text, fallback);
}

/** The tool calls the program map lists, as `T<n>` labels. */
function toolItems(text: string, profileId: string) {
  const cp = BUILTINS.find((entry) => entry.profile.id === profileId);
  if (!cp) throw new Error(`no profile ${profileId}`);
  const outline = new OutlineIndex(cp);
  outline.reset(text.split(/\r\n|\n/));
  return outline.items().filter((item) => item.kind === 'tool');
}

/** Lines of a generated text, which always ends with a line break. */
function rows(text: string, eol = '\r\n'): string[] {
  const list = text.split(eol);
  expect(list.pop()).toBe('');
  return list;
}

describe('generateLarge: Fanuc', () => {
  const text = generateLarge({ lines: 5000, dialect: 'fanuc' });
  const lines = rows(text);

  it('has exactly the requested lines, all ending in CRLF', () => {
    expect(lines).toHaveLength(5000);
    expect(lines.some((line) => /[\r\n]/.test(line))).toBe(false);
  });

  it('keeps the header and the end of the fixture program', () => {
    expect(lines.slice(0, 3)).toEqual([
      '(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)',
      '%',
      'O1001 (BRACKET)',
    ]);
    expect(lines.slice(-2)).toEqual(['M30', '%']);
  });

  it('gives the same bytes every time', () => {
    expect(generateLarge({ lines: 5000, dialect: 'fanuc' })).toBe(text);
  });

  it('is Fanuc by content and lists every tool change of the fixture', () => {
    expect(detect('/work/big.txt', text, 'heidenhain-klartext')).toBe('fanuc-gcode');
    expect(toolItems(text, 'fanuc-gcode').map((item) => item.tool)).toEqual(['1', '2', '3']);
  });

  it('renumbers tools and offsets in later copies of the segments', () => {
    const longer = rows(generateLarge({ lines: 8000, dialect: 'fanuc' }));
    expect(longer).toContain('T4 M6');
    expect(longer).toContain('G43 Z25. H4 M8');
  });
});

describe('generateLarge: Klartext', () => {
  const text = generateLarge({ lines: 5000, dialect: 'heidenhain', name: 'BIG' });
  const lines = rows(text);

  it('numbers the blocks from 0 and keeps cycle continuation lines unnumbered', () => {
    let next = 0;
    for (const line of lines) {
      const number = /^(\d+) /.exec(line);
      if (number) expect(Number(number[1])).toBe(next++);
      else expect(line).toMatch(/^\s+Q\d+=\S+ ;/);
    }
    expect(next).toBeGreaterThan(4900);
  });

  it('names the program after the output', () => {
    expect(lines[0]).toBe('0 BEGIN PGM BIG MM');
    expect(lines.at(-1)).toMatch(/^\d+ END PGM BIG MM$/);
  });

  it('is Klartext by content and lists its tool calls', () => {
    expect(detect('/work/big.txt', text, 'fanuc-gcode')).toBe('heidenhain-klartext');
    expect(toolItems(text, 'heidenhain-klartext').length).toBeGreaterThanOrEqual(3);
  });
});

describe('generateLarge: size and line endings', () => {
  it('reaches --mb within the requested lines by writing longer moves', () => {
    const text = generateLarge({ lines: 20000, dialect: 'fanuc', mb: 0.6 });
    expect(text.length).toBeGreaterThanOrEqual(0.6 * MIB);
    expect(rows(text).length).toBeGreaterThanOrEqual(20000);
    expect(rows(text).length).toBeLessThan(20100);
  });

  it('adds lines when the line count alone cannot reach --mb', () => {
    const text = generateLarge({ lines: 100, dialect: 'heidenhain', mb: 0.25 });
    expect(text.length).toBeGreaterThanOrEqual(0.25 * MIB);
    expect(rows(text).length).toBeGreaterThan(100);
  });

  it('writes LF when asked', () => {
    const text = generateLarge({ lines: 300, dialect: 'heidenhain', eol: 'lf' });
    expect(text).not.toContain('\r');
    expect(rows(text, '\n')).toHaveLength(300);
  });
});

describe('gen-large command line', () => {
  const script = fileURLToPath(new URL('../gen/gen-large.mjs', import.meta.url));

  it('writes the file, creating folders, and reports it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gedit-gen-large-'));
    try {
      const out = join(dir, 'sub', 'big-prog.h');
      const args = [script, '--lines', '200', '--dialect', 'heidenhain', '--eol', 'lf', '--out', out];
      expect(execFileSync(process.execPath, args, { encoding: 'utf8' })).toContain(': 200 lines');
      expect(readFileSync(out, 'utf8').startsWith('0 BEGIN PGM BIG_PROG MM\n')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects bad arguments with usage help', () => {
    for (const args of [['--lines', '0', '--dialect', 'fanuc'], ['--lines', '10', '--dialect', 'okuma']]) {
      const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('usage:');
    }
  });
});
