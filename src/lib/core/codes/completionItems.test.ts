// Dictionary-driven completion (plan §5 WP3.6): what is offered where, and what it
// inserts. The tests run over the shipped profiles and databases, because `G8` → G80…G89
// is the deliverable itself.

import { describe, expect, it } from 'vitest';
import fanucProfileJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainProfileJson from '$lib/data/profiles/heidenhain-klartext.json';
import fanucCodesJson from '$lib/data/codes/fanuc.json';
import heidenhainCodesJson from '$lib/data/codes/heidenhain.json';
import { compileProfile } from '$lib/core/profiles/compile';
import { t } from '$lib/i18n';
import { loadCodeDb } from './load';
import { completionContext, completionItems, completionsAt } from './completionItems';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { CodeDb, CodeEntry } from './types';

const fanucProfile = compileProfile(fanucProfileJson as unknown as Profile);
const klartextProfile = compileProfile(heidenhainProfileJson as unknown as Profile);
const fanuc = loadCodeDb(fanucCodesJson);
const heidenhain = loadCodeDb(heidenhainCodesJson);

/**
 * The suggestions at the cursor. The cursor is written as `|` in the line, which keeps
 * the test readable and the offsets right.
 */
function at(cp: CompiledProfile, db: CodeDb, marked: string) {
  const offset = marked.indexOf('|');
  expect(offset, `"${marked}" has no cursor`).toBeGreaterThanOrEqual(0);
  const line = marked.slice(0, offset) + marked.slice(offset + 1);
  return completionsAt(line, offset, cp, db, { t });
}

const fanucAt = (marked: string) => at(fanucProfile, fanuc, marked);
const klartextAt = (marked: string) => at(klartextProfile, heidenhain, marked);

/** Just the labels, which is what most of the rules are about. */
function labels(marked: string, cp: CompiledProfile, db: CodeDb): string[] {
  return (at(cp, db, marked)?.items ?? []).map((item) => item.label);
}

function entry(code: string, db: CodeDb): CodeEntry {
  const found = db.codes.find((candidate) => candidate.code === code);
  expect(found, `${code} is not in the database`).toBeDefined();
  return found as CodeEntry;
}

describe('completion: what is offered', () => {
  it('offers G80 to G89 for "G8"', () => {
    expect(labels('N10 G8|', fanucProfile, fanuc)).toEqual([
      'G80',
      'G81',
      'G82',
      'G83',
      'G84',
      'G85',
      'G86',
      'G87',
      'G88',
      'G89',
    ]);
  });

  it('filters case and zero padding like the lookup does', () => {
    expect(labels('N10 g8|', fanucProfile, fanuc)).toContain('G81');
    expect(labels('N10 G08|', fanucProfile, fanuc)).toContain('G81');
  });

  it('offers the M codes in the middle of a block', () => {
    const items = labels('N10 G1 X10. F100 M|', fanucProfile, fanuc);
    expect(items).toContain('M8');
    expect(items).toContain('M30');
    expect(items.every((label) => label.startsWith('M'))).toBe(true);
  });

  it('offers everything the dialect has right after a block number', () => {
    const result = fanucAt('N10 |');
    expect(result?.items.length).toBe(fanuc.codes.length);
    expect(result?.start).toBe(4);
  });

  it('keeps the database order instead of Monaco\'s alphabetical one', () => {
    const items = fanucAt('N10 G|')?.items ?? [];
    const sortTexts = items.map((item) => item.sortText ?? '');
    expect([...sortTexts].sort()).toEqual(sortTexts);
    expect(items[0].label).toBe('G0');
  });

  it('offers a Klartext keyword only at the start of a block', () => {
    expect(labels('13 |', klartextProfile, heidenhain)).toContain('TOOL CALL');
    // `L` may open a block; after an axis word it cannot.
    expect(labels('13 L X+10 |', klartextProfile, heidenhain)).not.toContain('L');
    // The radius compensation and the feed words still belong there.
    expect(labels('13 L X+10 R|', klartextProfile, heidenhain)).toEqual(['R0', 'RL', 'RR']);
  });

  it('keeps finding a multi-word code while it is half typed', () => {
    const cycles = klartextAt('14 CYCL DEF 20|');
    expect(cycles?.items.map((item) => item.label)).toContain('CYCL DEF 200');
    // The whole code is replaced, not only the digits.
    expect(cycles?.start).toBe(3);
    expect(cycles?.end).toBe(14);

    const tool = klartextAt('12 TOOL CA|');
    expect(tool?.items.map((item) => item.label)).toEqual(['TOOL CALL']);
    expect(tool?.start).toBe(3);
  });

  it('falls back to the word under the cursor when the wider prefix matches nothing', () => {
    const result = klartextAt('0 BEGIN PGM TEST M|');
    expect(result?.items.map((item) => item.label)).toContain('M3');
    expect(result?.start).toBe(17);
  });

  it('answers with an empty list when nothing matches', () => {
    const result = fanucAt('N10 G83 X|');
    expect(result).not.toBeNull();
    expect(result?.items).toEqual([]);
  });
});

describe('completion: where nothing is offered', () => {
  it('offers nothing inside a comment', () => {
    expect(fanucAt('(TOOL 1 - 10M|M END MILL)')).toBeNull();
    expect(fanucAt('N10 G0 X10. (SPOT D|')).toBeNull();
    expect(klartextAt('15 Q200=2 ;SET|')).toBeNull();
  });

  it('offers nothing inside a string', () => {
    expect(klartextAt('12 TOOL CALL "D10|" Z S5000')).toBeNull();
  });

  // A comment that runs to the end of the line gives its trailing whitespace back, so
  // the last token of `12 ; ROUGHING ` is whitespace and the cursor still sits in prose.
  // Without the extra look the whole mid-block slice of the database was offered in the
  // middle of an operator note.
  it('offers nothing behind a space inside a line comment', () => {
    expect(klartextAt('12 ; ROUGHING |')).toBeNull();
    expect(klartextAt('12 ; ROUGHING   |')).toBeNull();
    expect(klartextAt('15 Q200=2 ;SET THE |')).toBeNull();
  });

  it('offers again after the comment ends', () => {
    expect(fanucAt('N10 (SETUP) G|')?.items.length).toBeGreaterThan(0);
    // A closed `( … )` comment is behind us, whitespace and all: code may follow it.
    expect(fanucAt('N10 (SETUP) |')?.items.length).toBeGreaterThan(0);
    expect(klartextAt('12 TOOL CALL "D10" |')?.items.length).toBeGreaterThan(0);
  });
});

describe('completionContext', () => {
  it('reports the prefix, the range and the block start', () => {
    expect(completionContext('N10 G8', 6, fanucProfile)).toEqual({
      prefix: 'G8',
      start: 4,
      end: 6,
      atBlockStart: true,
      wide: null,
    });
  });

  it('treats a block skip and a block number as nothing at all', () => {
    expect(completionContext('/N10 G', 6, fanucProfile)?.atBlockStart).toBe(true);
    expect(completionContext('N10 G0 G', 8, fanucProfile)?.atBlockStart).toBe(false);
  });

  it('starts an empty prefix at the cursor', () => {
    expect(completionContext('N10 G0 ', 7, fanucProfile)).toMatchObject({ prefix: '', start: 7, end: 7 });
  });

  it('reaches back over bare words only', () => {
    expect(completionContext('14 CYCL DEF 20', 14, klartextProfile)?.wide).toEqual({
      prefix: 'CYCL DEF 20',
      start: 3,
    });
    // `X+10` carries a value, so the prefix must not swallow it.
    expect(completionContext('13 L X+10 R', 11, klartextProfile)?.wide).toBeNull();
  });

  it('clamps an offset past the end of the line', () => {
    expect(completionContext('N10 G8', 99, fanucProfile)).toMatchObject({ prefix: 'G8', end: 6 });
  });
});

describe('completionItems', () => {
  it('shows the label as detail and the description as documentation', () => {
    const [item] = completionItems([entry('M8', fanuc)], { t });
    expect(item).toMatchObject({
      label: 'M8',
      insertText: 'M8',
      snippet: false,
      kind: 'code',
      detail: 'Coolant on',
    });
    expect(item.documentation).toContain('Turns the flood coolant on.');
    expect(item.documentation).toContain('modal');
  });

  it('inserts a cycle as a snippet with one tab stop per required word', () => {
    const [item] = completionItems([entry('G83', fanuc)], { t });
    expect(item.snippet).toBe(true);
    expect(item.kind).toBe('cycle');
    expect(item.insertText).toBe('G83 Z${1} R${2} Q${3} F${4}');
  });

  // A Q-style cycle is one logical block written over several lines. Without the
  // continuation marks the control reads the parameter lines as separate assignments and
  // runs the cycle with whatever values it held before — a different program, and not a
  // syntax error, which is why this shape is pinned here in full.
  it('inserts a Klartext cycle as one block, with continuation marks and indentation', () => {
    const [item] = completionItems([entry('CYCL DEF 201', heidenhain)], { t, profile: klartextProfile });
    expect(item.insertText).toBe(
      [
        'CYCL DEF 201 ${1:NAME} ~',
        '   Q200=${2} ~',
        '   Q201=${3} ~',
        '   Q206=${4} ~',
        '   Q211=${5} ~',
        '   Q208=${6} ~',
        '   Q203=${7} ~',
        '   Q204=${8}',
      ].join('\n'),
    );
    // Through the real entry point, which passes the profile on its own.
    const offered = klartextAt('14 CYCL DEF 201|')?.items[0];
    expect(offered?.insertText).toBe(item.insertText);
  });

  it('keeps a Klartext word parameter in its block, with the space the control needs', () => {
    const [item] = completionItems([entry('M140', heidenhain)], { t, profile: klartextProfile });
    expect(item.insertText).toBe('M140 MB ${1}');
    // A single-letter address takes no space in either dialect.
    expect(completionItems([entry('CR', heidenhain)], { t, profile: klartextProfile })[0].insertText).toBe('CR R${1}');
    expect(completionItems([entry('G83', fanuc)], { t, profile: fanucProfile })[0].insertText).toBe('G83 Z${1} R${2} Q${3} F${4}');
  });

  it('inserts the bare code when snippets are off', () => {
    const [item] = completionItems([entry('G83', fanuc)], { t, snippets: false });
    expect(item.insertText).toBe('G83');
    expect(item.snippet).toBe(false);
  });

  // The snippet icon promises tab stops to fill in, so only an item that really expands
  // may wear it — `kind: 'cycle'` is what the provider maps onto that icon.
  it('does not draw a cycle with nothing to fill in as a snippet', () => {
    // Cancels the canned cycle: in the cycle group, no parameter of its own.
    const [g80] = completionItems([entry('G80', fanuc)], { t });
    expect(g80.snippet).toBe(false);
    expect(g80.kind).toBe('code');

    const [call] = completionItems([entry('CYCL CALL', heidenhain)], { t });
    expect(call.snippet).toBe(false);
    expect(call.kind).toBe('keyword');

    // The same holds for a real cycle once snippets are switched off.
    const [g83] = completionItems([entry('G83', fanuc)], { t, snippets: false });
    expect(g83.kind).toBe('code');
  });

  // Over both shipped databases: nothing wears the snippet icon without expanding. The
  // converse is deliberately not claimed — `G43 H${1}` and `M140 MB${1}` do expand, and
  // they keep the icon of what they are, because their group is not `cycle`.
  it('never draws the snippet icon on an item that inserts plain text', () => {
    for (const db of [fanuc, heidenhain]) {
      const drawn = completionItems(db.codes, { t }).filter((item) => item.kind === 'cycle');
      expect(drawn.length, `${db.dialect} has no snippet item at all`).toBeGreaterThan(0);
      for (const item of drawn) {
        expect(item.snippet, `${db.dialect} ${item.label}`).toBe(true);
      }
    }
  });

  it('says when an entry is not verified yet', () => {
    const [item] = completionItems([entry('G87', fanuc)], { t });
    expect(item.documentation).toContain('Not verified yet');
    // It is still offered: completion may guess, hover may not.
    expect(item.label).toBe('G87');
  });

  it('marks a word-shaped code as a keyword', () => {
    expect(completionItems([entry('TOOL CALL', heidenhain)])[0].kind).toBe('keyword');
    expect(completionItems([entry('M3', heidenhain)])[0].kind).toBe('code');
  });

  it('escapes a database value that reads as snippet syntax', () => {
    const db: CodeDb = {
      dialect: 'evil',
      version: 1,
      addresses: {},
      codes: [{ code: 'G$1}', label: 'x', params: [{ address: 'Z$2', label: 'z', required: true }] }],
    };
    expect(completionItems(db.codes, { t })[0].insertText).toBe('G\\$1\\} Z\\$2${1}');
  });

  it('leaves the notes out when there is no translator', () => {
    const [item] = completionItems([entry('G83', fanuc)]);
    expect(item.documentation).toBe(entry('G83', fanuc).description);
  });
});
