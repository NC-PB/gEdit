// Characterization tests: they freeze today's program map for every fixture, so the
// M3 outline (WP3.5) starts from known results. One snapshot per fixture lives in
// tests/unit/__snapshots__/gcodeParser/ (update with `npx vitest run -u`).
// Cases marked KNOWN GAP (M3) are wrong today and are expected to change in M3.

import { describe, expect, it } from 'vitest';
import { editorText, listFixtures, openFixture } from '../../../tests/unit/helpers/fixtures';
import { detectLanguage } from './detectLanguage';
import { parseProgramStructure, type StructureItem } from './gcodeParser';

const SNAPSHOTS = '../../../tests/unit/__snapshots__/gcodeParser/';

/** Program map of a fixture as the app builds it: detected dialect (default Fanuc), editor text. */
function programMap(rel: string) {
  const opened = openFixture(rel);
  if (opened.refused !== null) throw new Error(`${rel} does not open: ${opened.refused}`);
  const dialect = detectLanguage(`/work/${rel}`, opened.text, 'fanuc-gcode');
  const text = editorText(opened.text);
  return { dialect, text, items: parseProgramStructure(text, dialect) };
}

/** JSON with one item per line, so snapshot diffs stay readable. */
function formatMap(dialect: string, items: StructureItem[]): string {
  const rows = items.map((item) => `    ${JSON.stringify(item)}`);
  const list = rows.length > 0 ? `[\n${rows.join(',\n')}\n  ]` : '[]';
  return `{\n  "dialect": ${JSON.stringify(dialect)},\n  "items": ${list}\n}\n`;
}

const openable = listFixtures('nc').filter((rel) => openFixture(rel).refused === null);

describe('parseProgramStructure snapshots', () => {
  for (const rel of openable) {
    it(rel, async () => {
      const { dialect, items } = programMap(rel);
      await expect(formatMap(dialect, items)).toMatchFileSnapshot(`${SNAPSHOTS}${rel.replace(/^nc\//, '')}.json`);
    });
  }
});

/** 1-based number of the first line that reads exactly `content` (trimmed). */
function lineOf(text: string, content: string): number {
  const index = text.split('\n').findIndex((line) => line.trim() === content);
  if (index < 0) throw new Error(`no line "${content}"`);
  return index + 1;
}

/** Item type listed for the line that reads `content`, or null. */
function typeAt(rel: string, content: string): StructureItem['type'] | null {
  const { text, items } = programMap(rel);
  const line = lineOf(text, content);
  return items.find((item) => item.line === line)?.type ?? null;
}

describe('parseProgramStructure known behavior', () => {
  it('finds spaced Fanuc tool changes and ignores a T preselect', () => {
    expect(typeAt('nc/fanuc/f01-mill-3tools.nc', 'T1 M6')).toBe('tool');
    expect(typeAt('nc/fanuc/f01-mill-3tools.nc', 'T2')).toBeNull();
    expect(typeAt('nc/fanuc/f01-mill-3tools.nc', '(CONTOUR ROUGH)')).toBe('comment');
  });

  it('keeps a whole-line comment that mentions a tool change a comment', () => {
    expect(typeAt('nc/fanuc/f05-comments-edge.nc', '(T1 M6)')).toBe('comment');
  });

  it('finds numbered Klartext tool calls, named ones and numbered comment blocks', () => {
    expect(typeAt('nc/heidenhain/h01-3tools.h', '5 TOOL CALL 1 Z S3000 F800 ; D10 END MILL')).toBe('tool');
    expect(typeAt('nc/heidenhain/h02-tool-names.h', '5 TOOL CALL "MILL_D10" Z S5000 F800 DL+0.1')).toBe('tool');
    expect(typeAt('nc/heidenhain/h02-tool-names.h', '14 TOOL CALL QS1 Z S2800')).toBe('tool');
    expect(typeAt('nc/heidenhain/h01-3tools.h', '15 ; FOUR HOLES D8.5')).toBe('comment');
  });

  // KNOWN GAP (M3): compact spellings, words between T and M6, and a T word on the line
  // before M6 are not found.
  it.each([
    ['nc/fanuc/f02-packed.nc', 'N10T1M6'],
    ['nc/fanuc/O1234', 'N10T1M06'],
    ['nc/fanuc/f02-packed.nc', 'N130M06T2'],
    ['nc/fanuc/f02-packed.nc', 'N180T3G43H3M6'],
    ['nc/fanuc/f03-multi-program.nc', 'T6 G43 H6 M6'],
    ['nc/fanuc/f03-multi-program.nc', 'M6'],
  ])('misses the tool change in %s at "%s"', (rel, content) => {
    expect(typeAt(rel, content)).toBeNull();
  });

  // KNOWN GAP (M3): code inside a trailing comment counts as a tool change.
  it('lists "(NEXT: T1 M6)" in a trailing comment as a tool change', () => {
    expect(typeAt('nc/fanuc/f05-comments-edge.nc', 'G0 Z25. (NEXT: T1 M6)')).toBe('tool');
  });

  // KNOWN GAP (M3): a TOOL CALL without a tool number or name only changes the speed.
  it.each(['9 TOOL CALL Z S5000', '12 TOOL CALL S6000 F900'])('lists the speed change "%s" as a tool', (content) => {
    expect(typeAt('nc/heidenhain/h03-speed-only.h', content)).toBe('tool');
  });

  // KNOWN GAP (M3): comments after code, two comments on a line and Klartext section
  // headings are not listed.
  it.each([
    ['nc/fanuc/f05-comments-edge.nc', 'N50 (ROUGHING)'],
    ['nc/fanuc/f05-comments-edge.nc', '(A)(B)'],
    ['nc/heidenhain/h01-3tools.h', '4 * - ROUGH'],
  ])('does not list the comment in %s at "%s"', (rel, content) => {
    expect(typeAt(rel, content)).toBeNull();
  });

  // GAP CLOSED (M1, verified at I2): the pre-M1 shim left the 40-byte NUL leader inside
  // the editor text, so line 1 read as NULs rather than a comment and the map skipped it.
  // `decodeFile` keeps the leader and trailer as metadata (`nul.leader` / `nul.trailer`),
  // so the tape file now parses exactly like the same program without a leader.
  it('lists the first comment of a tape file with a NUL leader', () => {
    const { text, items } = programMap('nc/encoding/nul-leader-trailer.nc');
    expect(text.startsWith('\0')).toBe(false);
    expect(text.startsWith('(')).toBe(true);
    expect(items.some((item) => item.line === 1)).toBe(true);
    expect(typeAt('nc/encoding/nul-leader-trailer.nc', 'T1 M6')).toBe('tool');
  });
});
