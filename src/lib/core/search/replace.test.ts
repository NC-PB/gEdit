// The `replace` transform (plan §6 WP11.1): the options form, the count in the summary,
// and a run that does not touch what the query does not name.

import { describe, expect, it } from 'vitest';
import type { CodeDb } from '$lib/core/codes/types';
import { noMachine } from '$lib/core/machines/effective';
import { compileProfile } from '$lib/core/profiles/compile';
import type { Profile } from '$lib/core/profiles/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import type { TransformContext } from '$lib/core/transforms/types';
import { hasKey } from '$lib/i18n';
import { flagsOf, replace, searchFields } from './replace';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const NO_CODES: CodeDb = { dialect: 'test', version: 1, addresses: {}, codes: [] };

function context(options: Record<string, unknown>): TransformContext {
  return { cp: fanuc, codes: NO_CODES, options, firstLine: 1, machine: noMachine(fanuc.profile) };
}

describe('the replace transform', () => {
  it('replaces a word and counts in the summary', () => {
    const lines = ['T1 M6', 'G1 X1', 'T01 M6', 'T10 M6', '(T1)'];
    const r = replace.run(lines, context({ query: 'T1', wholeAddress: true, replacement: 'T7' }));
    expect(r.lines).toEqual(['T7 M6', 'G1 X1', 'T7 M6', 'T10 M6', '(T1)']);
    expect(r.summary).toEqual({ key: 'search.replaceSummary', params: { count: 2 } });
    expect(r.skipped).toEqual([]);
    expect(Array.from(r.lineMap ?? [])).toEqual([0, 1, 2, 3, 4]);
  });

  it('uses regex groups', () => {
    const r = replace.run(['X10 Y20'], context({ query: '([XY])(\\d+)', regex: true, replacement: '$1=$2' }));
    expect(r.lines).toEqual(['X=10 Y=20']);
    expect(r.summary.params).toEqual({ count: 2 });
  });

  it('says so when nothing was found, and changes nothing', () => {
    const lines = ['G1 X1'];
    const r = replace.run(lines, context({ query: 'T1', wholeAddress: true, replacement: 'T7' }));
    expect(r.lines).toEqual(lines);
    expect(r.summary).toEqual({ key: 'search.replaceNone' });
  });

  it('returns the lines untouched and the reason when the query does not parse', () => {
    const lines = ['G1 X1'];
    const r = replace.run(lines, context({ query: '(', regex: true, replacement: '' }));
    expect(r.lines).toBe(lines);
    expect(r.summary.key).toBe('search.errorRegex');
  });

  it('offers the form of the plan, with the fields find-all shares', () => {
    const ids = (replace.options?.(fanuc) ?? []).map((f) => f.id);
    expect(ids).toEqual(['query', 'replacement', 'wholeAddress', 'caseSensitive', 'regex', 'inComments', 'output']);
    expect(searchFields().map((f) => f.id)).toEqual(['query', 'wholeAddress', 'caseSensitive', 'regex', 'inComments']);
  });

  it('says in the form that a condition compares the value as written (D51)', () => {
    const query = searchFields()[0];
    expect(query.help).toMatch(/as written/);
    expect(query.help).toMatch(/X60\./);
  });

  it('has a message for its title', () => {
    expect(hasKey(replace.title)).toBe(true);
    expect(flagsOf({ regex: true })).toEqual({ wholeAddress: false, regex: true, caseSensitive: false, inComments: false });
  });
});
