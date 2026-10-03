// Exit criterion X13 on the committed owner-public programs (plan §2.2, §6 M9 WP9.6), the
// TypeScript half. The Python half is `tests/python/test_owner_public.py`.
//
// These are the only real programs in the repository (`tests/fixtures/nc/owner-public/**`,
// published by the owner, §9.2). What they must show, and which half proves it:
//
// | X13 check                                   | here | Python |
// |---------------------------------------------|------|--------|
// | detects as its folder says                  | yes  |        |
// | no unknown token outside comments, or each  | yes  | yes    |
// |   remaining one listed with its reason      |      |        |
// | its map matches its golden                  | yes  |        |
// | opens and saves back byte for byte          | yes  |        |
// | `tool_list` agrees with the map             |      | yes    |
// | scale feed and scale speed at 100 % give    |      | yes    |
// |   back every byte                           |      |        |
//
// The shared golden is `tests/fixtures/expected/owner-public/known-gaps.json`: both
// tokenizers must find exactly the unknown tokens it lists, no more and no fewer. The
// scripts run in the Python half because that is where the CI job with an interpreter is,
// and because a 99,000-line Klartext program takes the scripts half a minute each.
//
// The Python half reads the programs with the profile's defaults (the resolved
// `effective/<profile>/defaults.json`), never merging a machine itself; the last test here
// checks that this is what the app does with them too: no variant detected away from its
// default.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, listFixtures, readFixture } from './helpers/fixtures';
import {
  BUILTINS,
  detectsAs,
  effectiveFor,
  groupUnknown,
  mapTools,
  openBytes,
  roundTrips,
  unknownTokens,
} from './helpers/realPrograms';

const ROOT = 'nc/owner-public/';
const GAPS_FILE = join(FIXTURES_DIR, 'expected/owner-public/known-gaps.json');
const OUTLINE = join(FIXTURES_DIR, 'expected/outline');

interface UnknownEntry {
  text: string;
  count: number;
  firstLine: number;
  why: string;
  fix: string;
}

interface GapFile {
  profile: string;
  unknown: UnknownEntry[];
  map: { why: string; fix: string } | null;
}

const KNOWN = JSON.parse(readFileSync(GAPS_FILE, 'utf8')) as { $format: number; ownerReviewed: boolean; files: Record<string, GapFile> };
const OUTLINE_GAPS = (
  JSON.parse(readFileSync(join(OUTLINE, 'owner-public/_known-gaps.json'), 'utf8')) as {
    gaps: Record<string, { profile: string; tools: [number, string][] }>;
  }
).gaps;

const PROGRAMS = listFixtures('nc/owner-public');
const IDS = new Set(BUILTINS.map((cp) => cp.profile.id));

/** The profile a program has to open with: the folder it is in. */
const folderOf = (rel: string): string => rel.slice(ROOT.length).split('/')[0];

function opened(rel: string) {
  const result = openBytes(readFixture(rel));
  if (!result.ok) throw new Error(`${rel} does not open: ${result.reason}`);
  return result;
}

describe('the owner-public programs (X13)', () => {
  it('are the twenty the owner published, each in the folder of a built-in profile', () => {
    expect(PROGRAMS).toHaveLength(20);
    for (const rel of PROGRAMS) expect(IDS.has(folderOf(rel)), rel).toBe(true);
  });

  it('list their gaps in the format of P9, unreviewed, for programs that exist', () => {
    expect(KNOWN.$format).toBe(1);
    expect(KNOWN.ownerReviewed).toBe(false);
    for (const [rel, entry] of Object.entries(KNOWN.files)) {
      expect(PROGRAMS, rel).toContain(rel);
      expect(entry.profile, rel).toBe(folderOf(rel));
      expect(entry.unknown.length > 0 || entry.map !== null, `${rel} is listed with nothing to say`).toBe(true);
      for (const token of entry.unknown) {
        expect(token.why.length, `${rel}: ${token.text} needs a reason`).toBeGreaterThan(20);
        expect(token.fix, `${rel}: ${token.text}`).toMatch(/^(?:allow|WP\d+\.\d+[ab]?|R\d+.*)$/);
      }
      if (entry.map !== null) expect(entry.map.why.length, rel).toBeGreaterThan(20);
    }
  });

  it.each(PROGRAMS)('%s detects as its folder says, whatever document was open before', (rel) => {
    expect(detectsAs(`/work/${rel}`, opened(rel).text, folderOf(rel))).toBe(true);
  });

  it.each(PROGRAMS)('%s opens and saves back byte for byte', (rel) => {
    expect(roundTrips(opened(rel))).toBe(true);
  });

  it.each(PROGRAMS)('%s has exactly the unknown tokens known-gaps.json lists', (rel) => {
    const { text } = opened(rel);
    const eff = effectiveFor(folderOf(rel), text, null);
    const found = groupUnknown(unknownTokens(eff.cp, text));
    const listed = (KNOWN.files[rel]?.unknown ?? []).map(({ text: t, count, firstLine }) => ({ text: t, count, firstLine }));
    expect(found).toEqual(listed);
  });

  it.each(PROGRAMS)('%s has the map of its golden, or a map gap listed in both files', (rel) => {
    const { text } = opened(rel);
    const eff = effectiveFor(folderOf(rel), text, null);
    const tools = mapTools(eff.cp, text);
    const golden = join(OUTLINE, `${rel.replace(/^nc\//, '')}.json`);
    const listedGap = KNOWN.files[rel]?.map ?? null;
    const outlineGap = OUTLINE_GAPS[rel];
    // The two files say the same thing about the map: a gap in one is a gap in the other.
    expect(listedGap !== null, `${rel}: known-gaps.json and _known-gaps.json disagree`).toBe(outlineGap !== undefined);
    if (outlineGap !== undefined) {
      // A gap has no golden (it would record the wrong map as the right one), and it is
      // still a gap: the map is not yet the one the program means.
      expect(existsSync(golden), rel).toBe(false);
      expect(tools, `${rel}: the map is right now; remove the gap from both files`).not.toEqual(outlineGap.tools);
      return;
    }
    const items = (JSON.parse(readFileSync(golden, 'utf8')) as { items: { kind: string; line: number; tool?: string; children?: { kind: string; line: number; tool?: string }[] }[] }).items;
    const expected = items
      .flatMap((item) => [item, ...(item.children ?? [])])
      .filter((item) => item.kind === 'tool')
      .map((item) => [item.line, item.tool ?? '']);
    expect(tools).toEqual(expected);
  });

  it.each(PROGRAMS)('%s is read with the profile defaults the Python half uses', (rel) => {
    // No machine, so the app applies the variants it detects. Where one moves off its
    // default the Python half would read the program differently; then it needs the
    // effective profile of that variant, and this test says so.
    const { text } = opened(rel);
    const eff = effectiveFor(folderOf(rel), text, null);
    const defaults = effectiveFor(folderOf(rel), '', null);
    expect(eff.machine.params.variants).toEqual(defaults.machine.params.variants);
  });

  it('decode as UTF-8 or Windows-1252, without NUL bytes, so the Python half reads them alike', () => {
    for (const rel of PROGRAMS) {
      const { decoded } = opened(rel);
      expect(['utf-8', 'windows-1252'], rel).toContain(decoded.encoding.encoding);
      expect(decoded.nul, rel).toEqual({ leader: 0, trailer: 0, stripped: 0 });
    }
  });

  it('prints the X13 aggregates, counts only', () => {
    let clean = 0;
    let listed = 0;
    for (const rel of PROGRAMS) {
      const entry = KNOWN.files[rel];
      if (entry === undefined || entry.unknown.length === 0) clean++;
      else listed++;
    }
    const mapGaps = Object.values(KNOWN.files).filter((entry) => entry.map !== null).length;
    const line = `X13 owner-public: ${PROGRAMS.length} programs; no unknown token ${clean}, unknown tokens listed with a reason ${listed}; map gaps listed ${mapGaps}`;
    expect(line).not.toMatch(/\.(?:nc|h|mpf|min)\b/i);
    console.log(line);
  });
});
