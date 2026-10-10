// P3b fix NC (review NC-01, NC-02, SK-02): the block numbers a template names, the numbers a
// program uses, and the values the form starts with (`blockNumbers.ts`). The service's use of
// them is pinned in `app/templateService.test.ts`.

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { blockNumberParams, blockValueErrors, documentNumbers, freeBlockValues, namedOwnNumbers, needsDocumentNumbers, ownNumbers } from './blockNumbers';
import type { TemplateDef } from './types';

const ROUGH: TemplateDef = {
  id: 'rough',
  label: 'Rough',
  group: 'Turning',
  body: '{{N}}G71 U1. R0.5\n{{N}}G71 P{{ns}} Q{{nf}} U0.4 W0.1 F0.2\nN{{ns}} G0 X16.\n/N{{nf}} G1 X34.\n{{N}}G70 P{{ns}} Q{{nf}}',
  params: [
    { id: 'ns', label: 'First', type: 'integer', required: true, min: 1, max: 99999, default: 100 },
    { id: 'nf', label: 'Last', type: 'integer', required: true, min: 1, max: 99999, default: 200 },
  ],
};

const LAP: TemplateDef = {
  id: 'lap',
  label: 'LAP',
  group: 'Turning',
  body: '{{name}} G81\nG0 X16\nG80\n{{N}}G85 {{name}} D3 F0.3\n{{N}}G87 {{name}}',
  params: [{ id: 'name', label: 'Name', type: 'text', required: true, uppercase: true, default: 'NLAP1' }],
};

describe('which parameters name a block', () => {
  it('reads N{{id}} at a line start (also behind a block-delete slash) and a name a reference of the body names', () => {
    expect(blockNumberParams(ROUGH, cpOf('fanuc-lathe'))).toEqual([
      { id: 'ns', kind: 'number' },
      { id: 'nf', kind: 'number' },
    ]);
    expect(blockNumberParams(LAP, cpOf('okuma-osp'))).toEqual([{ id: 'name', kind: 'name' }]);
    // A parameter alone at a line start that nothing references names no block.
    expect(blockNumberParams({ ...LAP, body: '{{name}} G81\nG80' }, cpOf('okuma-osp'))).toEqual([]);
  });

  it('has none on a consecutive profile, and a template without {{N}} and block numbers needs no scan', () => {
    expect(blockNumberParams(ROUGH, cpOf('heidenhain-klartext'))).toEqual([]);
    expect(needsDocumentNumbers(ROUGH, cpOf('heidenhain-klartext'))).toBe(false);
    expect(needsDocumentNumbers({ id: 'x', label: 'X', group: 'G', body: 'M0' }, cpOf('fanuc-gcode'))).toBe(false);
  });
});

describe('what a program uses', () => {
  it('collects the block numbers with their first line, the highest one, and what references point at', () => {
    const doc = documentNumbers(['%', 'O1', 'N10 G0 X0', 'N0100 G0 X1', 'N120 G71 P130 Q170', 'GOTO 300', '(N900 IN A COMMENT)'], cpOf('fanuc-lathe'));
    expect([...doc.blocks.entries()]).toEqual([
      ['10', { line: 3 }],
      ['100', { line: 4 }],
      ['120', { line: 5 }],
    ]);
    expect(doc.max).toBe(120);
    expect([...doc.referenced.entries()]).toEqual([
      ['130', { line: 5, word: 'P130' }],
      ['170', { line: 5, word: 'Q170' }],
      ['300', { line: 6, word: 'GOTO 300' }],
    ]);
  });

  it('compares Okuma sequence numbers and names as text: N0100 is not N100', () => {
    const doc = documentNumbers(['N0100 G0 X1', 'NLAP1 G81', 'G85 NLAP2 D3', 'GOTO N200'], cpOf('okuma-osp'));
    expect([...doc.blocks.keys()]).toEqual(['N0100', 'NLAP1', 'NLAP2']);
    expect([...doc.referenced.keys()]).toEqual(['N200']);
  });
});

describe('the values the form starts with, and what it refuses', () => {
  const cp = cpOf('fanuc-lathe');
  const env = { cp, prevBlockNumber: 100, numbered: true, sys: { date: '', time: '', file: '', stem: '' } };

  it('keeps a free default, moves a used one above the highest number, never onto its own {{N}} numbers', () => {
    const own = ownNumbers(env, 3);
    expect(own).toEqual([110, 120, 130]);
    const doc = documentNumbers(['N10 G0', 'N100 G0'], cp);
    const params = blockNumberParams(ROUGH, cp);
    expect(freeBlockValues(ROUGH, params, doc, own, cp)).toEqual({ ns: '140', nf: '200' });
    const empty = documentNumbers([''], cp);
    expect(freeBlockValues(ROUGH, params, empty, ownNumbers({ ...env, numbered: false }, 3), cp)).toEqual({ ns: '100', nf: '200' });
  });

  it('takes the lowest free numbers when there is no room above the highest one', () => {
    const doc = documentNumbers(['N99990 G0', 'N100 G0', 'N200 G0'], cp);
    expect(freeBlockValues(ROUGH, blockNumberParams(ROUGH, cp), doc, [], cp)).toEqual({ ns: '10', nf: '20' });
  });

  it('refuses a used, a referenced, an own and a doubled number', () => {
    const doc = documentNumbers(['N100 G0', 'G70 P300 Q400'], cp);
    const params = blockNumberParams(ROUGH, cp);
    const keys = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(blockValueErrors(params, values, doc, [110], cp)).map(([k, v]) => [k, v.key]));
    expect(keys({ ns: '100', nf: '300' })).toEqual({ ns: 'templates.value.blockNumberUsed', nf: 'templates.value.blockNumberNamed' });
    expect(keys({ ns: '110', nf: '500' })).toEqual({ ns: 'templates.value.blockNumberOwn' });
    expect(keys({ ns: '500', nf: '0500' })).toEqual({ nf: 'templates.value.blockNumberTwice' });
    expect(keys({ ns: '', nf: 'x' })).toEqual({});
  });

  it('gives an Okuma name the next free one of its kind', () => {
    const ok = cpOf('okuma-osp');
    const doc = documentNumbers(['NLAP1 G81', 'G85 NLAP2 D3'], ok);
    expect(freeBlockValues(LAP, blockNumberParams(LAP, ok), doc, [], ok)).toEqual({ name: 'NLAP3' });
  });

  it('names the {{N}} numbers a reference of the program points at', () => {
    const doc = documentNumbers(['N120 G71 P130 Q170'], cp);
    expect(namedOwnNumbers([110, 120, 130], doc, cp)).toEqual([{ number: 'N130', word: 'P130', line: 1 }]);
  });
});
