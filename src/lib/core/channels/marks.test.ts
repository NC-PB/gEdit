// Sync marks (plan §7.17, WP12.1 deliver, R5; written by P12, extended by WP12.1): the rule
// kinds, the partner readings, what is never guessed, the caps, the budget and the 300k-line
// resolution.

import { describe, expect, it } from 'vitest';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { decodePartnerText, findMarks, resolveDocument } from './marks';
import { STOPS_AND_ENDS_RULE, type ChannelParams, type SyncRule } from './types';

const lathe = cpOf('fanuc-lathe');
const sinumerik = cpOf('sinumerik');

const three = (rules: SyncRule[], over: Partial<ChannelParams> = {}): ChannelParams => ({
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Path 1' },
    { id: '2', name: 'Path 2' },
    { id: '3', name: 'Path 3', aliases: ['P3X'] },
  ],
  syncMarks: rules,
  ...over,
});

const fanucWait = (decode: 'digits' | 'bitmask', whenAbsent?: { kind: 'fixed'; channels: string[] } | { kind: 'none' }): SyncRule => ({
  id: 'wait',
  label: 'wait',
  match: { kind: 'codes', codes: 'M900-M999' },
  partners: { kind: 'word', address: 'P', decode, whenAbsent },
});

const run = (lines: string[], p: ChannelParams, cp = lathe) => findMarks(lines, cp, p, { channelOf: () => '1' }).marks;

describe('decodePartnerText (R5)', () => {
  it('reads digits as path numbers, 0 as path 10, and skips a leading 0', () => {
    expect(decodePartnerText('123', 'digits')).toEqual(['1', '2', '3']);
    expect(decodePartnerText('321', 'digits')).toEqual(['3', '2', '1']);
    expect(decodePartnerText('103579', 'digits')).toEqual(['1', '10', '3', '5', '7', '9']);
    expect(decodePartnerText('013579', 'digits')).toEqual(['1', '3', '5', '7', '9']);
  });
  it('reads a bit sum', () => {
    expect(decodePartnerText('7', 'bitmask')).toEqual(['1', '2', '3']);
    expect(decodePartnerText('341', 'bitmask')).toEqual(['1', '3', '5', '7', '9']);
    expect(decodePartnerText('0', 'bitmask')).toEqual([]);
  });
  it('keeps what it cannot read as one piece', () => {
    expect(decodePartnerText('#1', 'digits')).toEqual(['#1']);
    expect(decodePartnerText('99999999999', 'bitmask')).toEqual(['99999999999']);
  });
  it('splits, trims and drops empty pieces', () => {
    expect(decodePartnerText(' 1, WAIT_K2 ,', 'split')).toEqual(['1', 'WAIT_K2']);
  });
});

describe('findMarks', () => {
  it('reads Fanuc wait M-codes with a digit P word, packed or spaced', () => {
    const marks = run(['N10M901P123', 'N20 M902 P12', 'M903', 'G0 X1'], three([fanucWait('digits', { kind: 'fixed', channels: ['1', '2'] })]));
    expect(marks.map((m) => [m.mark, m.line, m.partners])).toEqual([
      ['M901', 1, ['1', '2', '3']],
      ['M902', 2, ['1', '2']],
      ['M903', 3, ['1', '2']],
    ]);
  });

  it('gives a P-less wait no partner by default and keeps an undeclared path', () => {
    const marks = run(['M901', 'M902 P14'], three([fanucWait('digits')]));
    expect(marks.map((m) => m.partners)).toEqual([[], ['1', '4']]);
  });

  it('reads a bit-sum P word', () => {
    expect(run(['M901 P5'], three([fanucWait('bitmask')]))[0].partners).toEqual(['1', '3']);
  });

  it('ignores a wait in a comment', () => {
    expect(run(['(M901 P12)', 'G0 X1 (M902)'], three([fanucWait('digits')]))).toEqual([]);
  });

  it('lets the first rule own a line, and carries blocking and count rules', () => {
    const rules: SyncRule[] = [
      { id: 'count', label: 'c', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } },
      { id: 'flag', label: 'f', blocking: false, match: { kind: 'prefix', prefix: 'M1', idDigits: { min: 2, max: 2 } }, partners: { kind: 'fixed', channels: ['P3X'] } },
    ];
    const marks = run(['M100', 'M101', 'M1001'], three(rules));
    expect(marks.map((m) => [m.ruleId, m.mark, m.partners, m.blocking])).toEqual([
      ['count', '', ['1', '2', '3'], true],
      ['flag', '01', ['3'], false],
    ]);
  });

  it('reads a WAITM line through split partners and aliases, never a string', () => {
    const rule: SyncRule = {
      id: 'waitm',
      label: 'w',
      match: { kind: 'regex', pattern: '\\bWAITMC?\\s*\\(\\s*(?<mark>\\d+)' },
      partners: { kind: 'line', pattern: '\\bWAITMC?\\s*\\(\\s*\\d+\\s*,(?<channels>[^)]*)\\)' },
    };
    const p = three([rule], { list: [{ id: '1', name: 'A', aliases: ['WAIT_K1'] }, { id: '2', name: 'B', aliases: ['WAIT_K2'] }] });
    const marks = run(['NN10: WAITM(10, WAIT_K1, WAIT_K2)', 'MSG("WAITM(11,1,2)")', '; WAITM(12,1,2)'], p, sinumerik);
    expect(marks.map((m) => [m.mark, m.partners])).toEqual([['10', ['1', '2']]]);
  });

  it('adds the profile’s stops and ends when stopsAndEndsWait is set', () => {
    const p = three([], { stopsAndEndsWait: true });
    const marks = run(['G0 X1', 'M01', 'M30'], p);
    expect(marks.map((m) => [m.ruleId, m.line, m.partners])).toEqual([
      [STOPS_AND_ENDS_RULE, 2, ['1', '2', '3']],
      [STOPS_AND_ENDS_RULE, 3, ['1', '2', '3']],
    ]);
    expect(run(['M30'], three([]))).toEqual([]);
  });

  it('keys each mark to the channel of its line', () => {
    const marks = findMarks(['M901 P12', 'X1', 'M902 P12'], lathe, three([fanucWait('digits')]), {
      channelOf: (line) => (line === 1 ? '' : '2'),
    }).marks;
    expect(marks.map((m) => m.channel)).toEqual(['', '2']);
  });

  it('keeps 20,000 marks and counts the rest', () => {
    const lines = Array.from({ length: 20_005 }, () => 'M901 P12');
    const r = findMarks(lines, lathe, three([fanucWait('digits')]), { channelOf: () => '1' });
    expect(r.marks).toHaveLength(20_000);
    expect(r.dropped).toBe(5);
  });

  it('finds nothing with a rule that does not compile', () => {
    const bad: SyncRule = { id: 'x', label: 'x', match: { kind: 'regex', pattern: '(?<mark>' }, partners: { kind: 'all' } };
    expect(run(['M901'], three([bad]))).toEqual([]);
  });
});

describe('findMarks, WP12.1: a wait is read as the control reads it, or not at all', () => {
  const digits = three([fanucWait('digits', { kind: 'fixed', channels: ['1', '2'] })]);

  it('reads M0901, M 901 and m901 as the one wait M901', () => {
    expect(run(['M0901 P12', 'M 901 P12', 'm901p12', 'N10M901P12'], digits).map((m) => m.mark)).toEqual(['M901', 'M901', 'M901', 'M901']);
  });

  it('never reads a decimal, a longer number, an assignment or a variable as a wait', () => {
    expect(run(['M901.5 P12', 'M9010 P12', 'M901=1', '#901=12', 'M[901] P12', 'XM901 P12'], digits)).toEqual([]);
  });

  it('makes a P word it cannot read one unknown piece, never "no P"', () => {
    const marks = run(['M901 P12.', 'M902 P#1', 'M903 P[#5]', 'M904 P', 'M905 P12 P13', 'M906 P12 P12', 'M907 P1=2'], digits);
    expect(marks.map((m) => [m.mark, m.partners])).toEqual([
      ['M901', ['P12.']],
      ['M902', ['P#1']],
      ['M903', ['P[#5]']],
      ['M904', ['P']],
      ['M905', ['P12 P13']],
      ['M906', ['1', '2']],
      ['M907', ['1', '2']],
    ]);
  });

  it('reads the P word after a comment, and not one inside it', () => {
    expect(run(['M901 (WAIT) P13', 'M902 (P13)'], digits).map((m) => m.partners)).toEqual([
      ['1', '3'],
      ['1', '2'],
    ]);
  });

  it('reads a prefix rule with and without idDigits, never an assignment', () => {
    const rule = (idDigits?: { min: number; max: number }): SyncRule => ({ id: 'p', label: 'p', match: { kind: 'prefix', prefix: 'M1', idDigits }, partners: { kind: 'all' } });
    expect(run(['M130', 'M1305', 'M13', 'M1=5'], three([rule()])).map((m) => m.mark)).toEqual(['30', '305', '3']);
    expect(run(['M130', 'M1305', 'M13', 'M130.5'], three([rule({ min: 2, max: 2 })])).map((m) => m.mark)).toEqual(['30']);
  });

  it('runs an id-less count regex without a mark capture, and finds nothing for another kind without one', () => {
    const count: SyncRule = { id: 'c', label: 'c', semantics: 'count', match: { kind: 'regex', pattern: '\\bM100\\b' }, partners: { kind: 'all' } };
    const rendezvous: SyncRule = { ...count, semantics: 'rendezvous' };
    expect(run(['M100', 'M1000'], three([count])).map((m) => [m.ruleId, m.mark])).toEqual([['c', '']]);
    expect(run(['M100'], three([rendezvous]))).toEqual([]);
  });

  it('decodes line partners as digits or a bit sum, keeps an undeclared piece, and applies whenAbsent', () => {
    const line = (decode: 'digits' | 'bitmask' | 'split', whenAbsent?: SyncRule['partners'] extends infer P ? (P extends { kind: 'line'; whenAbsent?: infer W } ? W : never) : never): SyncRule => ({
      id: 'l',
      label: 'l',
      match: { kind: 'regex', pattern: '(?<![A-Z])(?<mark>M9\\d\\d)(?!\\d)' },
      partners: { kind: 'line', pattern: '(?<![A-Z])P(?<channels>\\d+)', decode, whenAbsent },
    });
    expect(run(['M901 P13', 'M902'], three([line('digits')])).map((m) => m.partners)).toEqual([['1', '3'], []]);
    expect(run(['M901 P5', 'M902'], three([line('bitmask', { kind: 'all' })])).map((m) => m.partners)).toEqual([
      ['1', '3'],
      ['1', '2', '3'],
    ]);
    expect(run(['M901 P4'], three([line('split', { kind: 'fixed', channels: ['P3X'] })]))[0].partners).toEqual(['4']);
  });

  it('lists a mark of a shared section once per channel, each with its own partners array', () => {
    const r = findMarks(['M901 P12', 'X1', 'M902 P12'], lathe, digits, { channelOf: (line) => (line === 1 ? ['1', '3'] : []) });
    expect(r.marks.map((m) => [m.mark, m.channel])).toEqual([
      ['M901', '1'],
      ['M901', '3'],
      ['M902', ''],
    ]);
    expect(r.marks[0].partners).not.toBe(r.marks[1].partners);
    r.marks[0].partners.push('x');
    expect(r.marks[1].partners).toEqual(['1', '2']);
  });

  it('gives up past its deadline and says so', () => {
    let t = 0;
    const lines = Array.from({ length: 5000 }, () => 'M901 P12');
    const r = findMarks(lines, lathe, digits, { channelOf: () => '1', deadline: 10, now: () => (t += 20) });
    expect(r.abandoned).toBe(true);
    // M12 review fix CODE-1: the deadline is read on every line, so the read stops after the
    // first line once the clock is past it (it used to run on to line 1,024).
    expect(r.marks.length).toBe(1);
  });

  it('reads the real wait shapes with the three-path preset as it ships', () => {
    const preset = profileOf('fanuc-lathe').machineParams?.channels?.presets.find((x) => x.id === 'fanuc-3path-digits');
    expect(preset).toBeDefined();
    const marks = run(['N10 M901P123', 'M902 P12', 'M903 P31', 'M904', 'M905P3.'], preset!.value);
    expect(marks.map((m) => [m.mark, m.partners])).toEqual([
      ['M901', ['1', '2', '3']],
      ['M902', ['1', '2']],
      ['M903', ['3', '1']],
      ['M904', []],
      ['M905', ['P3.']],
    ]);
  });
});

describe('resolveDocument', () => {
  const single: ChannelParams = {
    layout: 'single-file',
    list: [
      { id: '1', name: 'Channel 1' },
      { id: '2', name: 'Channel 2' },
    ],
    sectionStart: '^O(?<channel>[12])\\d{3}(?![\\d.])',
    sectionEnd: '(?<![A-Z])M(?:99|30)(?![\\d.])',
    syncMarks: [fanucWait('digits')],
  };

  it('answers none, with no marks, for a program with no section', () => {
    const r = resolveDocument('a.nc', ['O5555', 'M901 P12', 'M30'], lathe, single);
    expect([r.layout, r.marks, r.problems]).toEqual(['none', [], []]);
  });

  it('keys each mark to the channel of its line and a mark outside to no channel', () => {
    const r = resolveDocument('a.nc', ['O1001', 'M901 P12', 'M99', 'M902 P12', 'O2001', 'M901 P12', 'M30'], lathe, single);
    expect(r.layout).toBe('single-file');
    expect(r.marks.map((m) => [m.mark, m.line, m.channel])).toEqual([
      ['M901', 2, '1'],
      ['M902', 4, ''],
      ['M901', 6, '2'],
    ]);
    expect(r.outside).toEqual([{ startLine: 4, endLine: 4 }]);
  });

  it('answers none past the deadline', () => {
    let t = 0;
    const lines = Array.from({ length: 5000 }, (_, i) => (i === 0 ? 'O1001' : 'M901 P12'));
    const r = resolveDocument('a.nc', lines, lathe, single, { deadline: 10, now: () => (t += 20) });
    expect([r.layout, r.abandoned, r.marks]).toEqual(['none', true, []]);
  });

  it('lets the user’s assignment win in multi-file, and ignores one that names no channel', () => {
    const multi: ChannelParams = { ...single, layout: 'multi-file', fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.nc$' };
    expect(resolveDocument('a_CH1.nc', ['M901 P12'], lathe, multi, { assigned: '2' })).toMatchObject({ layout: 'multi-file', self: { id: '2' }, by: 'assigned' });
    expect(resolveDocument('a_CH1.nc', ['M901 P12'], lathe, multi, { assigned: '7' })).toMatchObject({ self: { id: '1' }, by: 'fileName' });
    expect(resolveDocument('loose.nc', ['M901 P12'], lathe, multi).layout).toBe('none');
  });

  it('resolves 300,000 lines with two rules within the budget (G7: 150 ms; asserted below 500 ms)', () => {
    const p: ChannelParams = {
      ...single,
      syncMarks: [fanucWait('digits'), { id: 'm1', label: 'm', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } }],
    };
    const body = ['G01 X52.4 Z-30.2 F0.25', 'G00 X56. Z2. (RETRACT)', 'M901 P12', 'G01 Z-12.5 F0.1', 'M100', 'T0303 (OD FINISH)'];
    const lines: string[] = [];
    for (let i = 0; lines.length < 300_000; i++) {
      if (i % 5000 === 0) lines.push(i % 10000 === 0 ? 'O1001' : 'O2001');
      lines.push(body[i % body.length]);
    }
    let marks = 0;
    const ms = fastest(2, () => {
      marks = resolveDocument('big.nc', lines, lathe, p).marks.length;
    });
    expect(marks).toBe(20_000);
    expectWithin(ms, 500, '300k-line resolution, two rules');
  });
});
