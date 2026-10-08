// The M12 review fixes, NC batch (2026-10-07; §7.16 #167): one regression test per finding,
// each failing without its fix. The programs are synthetic, written for gEdit, not for a
// machine; the wait shapes are the ones the Fanuc 30i manual (alarm 0160, parameter 8103),
// the Siemens 840D job-planning pages (WAITM, SETM, CLEARM) and the reviews quote.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';
import { checkSyncMarks } from './check';
import { parseWaitCodes } from './codes';
import { findMarks, resolveDocument } from './marks';
import { findSections, readMarker, resolveChannelToken } from './resolve';
import { documentChannel, fillTemplate } from './siblings';
import { testChannelRules } from './tester';
import { CHANNEL_CAPS, type ChannelParams, type SyncFinding, type SyncHit } from './types';

function presetOf(profile: string, id: string): ChannelParams {
  const found = profileOf(profile).machineParams?.channels?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profile}: no preset ${id}`);
  return found.value;
}

/** One document per channel, read with the preset as it ships, then checked. */
function check(
  profile: string,
  p: ChannelParams,
  program: Record<string, string[]>,
  jumpLines?: Record<string, number[]>,
): SyncFinding[] {
  const cp = cpOf(profile);
  const perChannel: Record<string, SyncHit[]> = {};
  for (const [channel, lines] of Object.entries(program)) perChannel[channel] = findMarks(lines, cp, p, { channelOf: () => channel }).marks;
  return checkSyncMarks(perChannel, p, { jumpLines });
}

const brief = (f: SyncFinding[]) => f.map((x) => [x.kind, x.channel, x.line]);

const fanuc = (id: string) => presetOf('fanuc-lathe', id);
const siemens = presetOf('sinumerik', 'sinumerik-2channel');
const siemens3: ChannelParams = {
  ...siemens,
  list: [...siemens.list, { id: '3', name: 'Channel 3' }],
};

describe('NC-01: the paths of one wait must name the same paths (Fanuc alarm 0160)', () => {
  it('digit P words that differ (case 4): one partners-differ on the first path', () => {
    const f = check('fanuc-lathe', fanuc('fanuc-3path-digits'), { '1': ['M901 P123'], '2': ['M901 P12'], '3': ['M901 P13'] });
    expect(brief(f)).toEqual([['partners-differ', '1', 1]]);
    expect(f[0].message.key).toBe('channels.findings.partnersDiffer');
    expect(f[0].message.params).toMatchObject({ names: 'Path 1, Path 2, Path 3', otherNames: 'Path 1, Path 2' });
  });

  it('bit sums that differ (case 3): one partners-differ on the first path', () => {
    const f = check('fanuc-lathe', fanuc('fanuc-3path-bitmask'), { '1': ['M901 P7'], '2': ['M901 P3'], '3': ['M901 P5'] });
    expect(brief(f)).toEqual([['partners-differ', '1', 1]]);
  });

  it('a P-less wait meeting one with P (case 5), even when both mean paths 1 and 2', () => {
    const f = check('fanuc-lathe', fanuc('fanuc-2path'), { '1': ['M901'], '2': ['M901 P3'] });
    expect(brief(f)).toEqual([['partners-differ', '1', 1]]);
    expect(f[0].message).toMatchObject({ key: 'channels.findings.partnersDifferAbsent', params: { without: 'Path 1' } });
    // Both without P, or both with it: clean.
    expect(check('fanuc-lathe', fanuc('fanuc-2path'), { '1': ['M901'], '2': ['M901'] })).toEqual([]);
    expect(check('fanuc-lathe', fanuc('fanuc-2path'), { '1': ['M901 P3'], '2': ['M901 P3'] })).toEqual([]);
  });

  it('the same paths in any digit order stay clean', () => {
    expect(check('fanuc-lathe', fanuc('fanuc-3path-digits'), { '1': ['M901 P123'], '2': ['M901 P231'], '3': ['M901 P321'] })).toEqual([]);
  });

  it('Siemens WAITM lists may differ (no samePartners on the preset)', () => {
    expect(check('sinumerik', siemens3, { '1': ['WAITM(1,1,2,3)'], '2': ['WAITM(1,1,2)'], '3': ['WAITM(1,1,3)'] })).toEqual([]);
  });
});

describe('NC-02: a SETM answers a WAITM in another channel; a CLEARM does not', () => {
  it('SETM(5) against WAITM(5,1) is clean', () => {
    expect(check('sinumerik', siemens, { '1': ['N10 SETM(5)'], '2': ['N10 WAITM(5,1)'] })).toEqual([]);
  });

  it('a SETM in a synchronized action answers too', () => {
    expect(check('sinumerik', siemens, { '1': ['WHEN $AA_IW[X]>10 DO SETM(7)'], '2': ['WAITM(7,1)'] })).toEqual([]);
  });

  it('one SETM answers two WAITM (the mark stays set): no count finding', () => {
    expect(check('sinumerik', siemens, { '1': ['SETM(5)'], '2': ['WAITM(5,1)', 'G0 X1', 'WAITM(5,1)'] })).toEqual([]);
  });

  it('CLEARM(5) alone answers nothing: WAITM(5,1) is still missing', () => {
    expect(brief(check('sinumerik', siemens, { '1': ['CLEARM(5)'], '2': ['WAITM(5,1)'] }))).toEqual([['missing', '2', 1]]);
  });
});

describe('NC-04: a count difference of a wait inside a loop is not judged', () => {
  const two = fanuc('fanuc-2path');

  it('a WHILE loop (its DO and END lines given as jump lines): count-not-checked, no warning', () => {
    const program = { '1': ['WHILE[#1LT2]DO1', 'M901', 'END1'], '2': ['M901', 'M901'] };
    expect(brief(check('fanuc-lathe', two, program))).toEqual([['count-mismatch', '2', 2]]);
    const f = check('fanuc-lathe', two, program, { '1': [1, 3] });
    expect(brief(f)).toEqual([['count-not-checked', '2', 2]]);
    expect(f[0].message.key).toBe('channels.findings.countNotChecked');
  });

  it('a GOTO loop: count-not-checked', () => {
    const program = { '1': ['N10', 'M901', 'IF[#1LT2]GOTO10'], '2': ['M901', 'M901'] };
    expect(brief(check('fanuc-lathe', two, program, { '1': [1, 3] }))).toEqual([['count-not-checked', '2', 2]]);
  });

  it('a Siemens REPEAT … UNTIL loop: count-not-checked', () => {
    const program = { '1': ['REPEAT', 'WAITM(1,1,2)', 'UNTIL R1>=2'], '2': ['WAITM(1,1,2)', 'WAITM(1,1,2)'] };
    expect(brief(check('sinumerik', siemens, program, { '1': [1, 3] }))).toEqual([['count-not-checked', '2', 2]]);
  });

  it('a count rule in a loop: count-not-checked', () => {
    const p: ChannelParams = {
      layout: 'multi-file',
      list: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      syncMarks: [{ id: 'm100', label: 'M100', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } }],
    };
    const program = { a: ['N1', 'M100', 'GOTO1'], b: ['M100', 'M100'] };
    expect(brief(check('fanuc-lathe', p, program))).toEqual([['count-mismatch', 'b', 2]]);
    expect(brief(check('fanuc-lathe', p, program, { a: [1, 3] }))).toEqual([['count-not-checked', 'b', 2]]);
  });

  it('equal counts in a GOTO loop stay clean; an id missing on one side stays missing', () => {
    expect(check('fanuc-lathe', two, { '1': ['N10', 'M901', 'GOTO10'], '2': ['N10', 'M901', 'GOTO10'] }, { '1': [1, 3], '2': [1, 3] })).toEqual([]);
    expect(brief(check('fanuc-lathe', two, { '1': ['N10', 'M901', 'GOTO10'], '2': ['G0 X1'] }, { '1': [1, 3] }))).toEqual([['missing', '1', 2]]);
  });
});

describe('NC-06: channel numbers are read by value', () => {
  it('WAITM(1,01,02) against WAITM(1,1,2) is clean', () => {
    expect(check('sinumerik', siemens, { '1': ['WAITM(1,01,02)'], '2': ['WAITM(1,1,2)'] })).toEqual([]);
  });

  it('03 on a two-channel machine names no channel', () => {
    const f = check('sinumerik', siemens, { '1': ['WAITM(1,1,2,03)'], '2': ['WAITM(1,1,2,03)'] });
    expect(f.map((x) => x.kind)).toEqual(['unknown-channel', 'unknown-channel']);
  });

  it('a value two channels claim names none', () => {
    const p: ChannelParams = { ...siemens, list: [{ id: '1', name: 'One' }, { id: '2', name: 'Two', aliases: ['01'] }] };
    expect(resolveChannelToken(p, '1')?.id).toBe('1');
    expect(resolveChannelToken(p, '01')?.id).toBe('2');
    expect(resolveChannelToken(p, '001')).toBeNull();
  });
});

describe('NC-07: a WAITM with a variable mark is read', () => {
  it('both sides WAITM(_M,1,2): two marks found, clean', () => {
    const cp = cpOf('sinumerik');
    const marks = [
      ...findMarks(['WAITM(_M,1,2)'], cp, siemens, { channelOf: () => '1' }).marks,
      ...findMarks(['WAITM(_M,1,2)'], cp, siemens, { channelOf: () => '2' }).marks,
    ];
    expect(marks.map((m) => [m.mark, m.partners])).toEqual([
      ['_M', ['1', '2']],
      ['_M', ['1', '2']],
    ]);
    expect(check('sinumerik', siemens, { '1': ['WAITM(_M,1,2)'], '2': ['WAITM(_M,1,2)'] })).toEqual([]);
  });

  it('a variable against a number is missing on both sides', () => {
    expect(brief(check('sinumerik', siemens, { '1': ['WAITM(_M,1,2)'], '2': ['WAITM(5,1,2)'] }))).toEqual([
      ['missing', '1', 1],
      ['missing', '2', 1],
    ]);
  });
});

describe('NC-08: a P word with a blank inside its digits is not read as the first digits', () => {
  it('M901 P1 2 is one unreadable piece, reported', () => {
    const p = fanuc('fanuc-3path-digits');
    expect(findMarks(['M901 P1 2'], cpOf('fanuc-lathe'), p, { channelOf: () => '1' }).marks.map((m) => m.partners)).toEqual([['P1 2']]);
    const f = check('fanuc-lathe', p, { '1': ['M901 P1 2'], '2': ['M901 P12'] });
    expect(f.filter((x) => x.channel === '1').map((x) => [x.kind, x.message.params?.token])).toEqual([['unknown-channel', 'P1 2']]);
  });
});

describe('NC-10: the wait-code list reads M 900 and explains "to"', () => {
  it('M 900 is the code M900', () => {
    expect(parseWaitCodes('M 900')).toEqual({ ranges: [{ letter: 'M', from: 900, to: 900 }], errors: [] });
    expect(parseWaitCodes('M 900 - M 999, M 300')).toEqual({
      ranges: [
        { letter: 'M', from: 300, to: 300 },
        { letter: 'M', from: 900, to: 999 },
      ],
      errors: [],
    });
  });

  it('M900 to M999 says how to write a range', () => {
    expect(parseWaitCodes('M900 to M999').errors).toEqual([{ key: 'channels.codes.rangeWord', params: { item: 'to', example: 'M900-M999' } }]);
  });
});

describe('NC-12: one unknown-channel per mark, listing every token', () => {
  it('a bit sum (P9010 = paths 2, 5, 6, 9, 10, 14) that names five paths a two-path machine lacks', () => {
    const f = check('fanuc-lathe', fanuc('fanuc-2path'), { '1': ['G65 P9010 M901'], '2': ['M901'] });
    const unknown = f.filter((x) => x.kind === 'unknown-channel');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].message).toMatchObject({ key: 'channels.findings.unknownChannels', params: { tokens: '5, 6, 9, 10, 14' } });
  });
});

describe('CODE-1: a long line is never given to a pattern; the deadline is read on every line', () => {
  const long = `M901 P12 ${'X1. '.repeat(400)}`;

  it('findMarks skips and counts a line longer than the cap', () => {
    expect(long.length).toBeGreaterThan(CHANNEL_CAPS.lineLength);
    const r = findMarks(['M901 P12', long], cpOf('fanuc-lathe'), fanuc('fanuc-3path-digits'), { channelOf: () => '1' });
    expect([r.marks.length, r.longLines]).toEqual([1, 1]);
  });

  it('resolveDocument reports the skipped lines as one problem (multi-file and single-file)', () => {
    const multi = resolveDocument('PART.NC1', ['M901 P12', long, long], cpOf('fanuc-lathe'), fanuc('fanuc-3path-digits'));
    expect(multi.problems).toEqual([{ path: 'lines', message: { key: 'channels.problems.longLines', params: { count: 2, max: 1000 } } }]);
    const okuma = presetOf('okuma-osp', 'okuma-2turret');
    const single = resolveDocument('', ['G13', 'M100', `G14 ${'X1. '.repeat(400)}`, 'M100'], cpOf('okuma-osp'), okuma);
    expect(single.problems.map((x) => x.message.key)).toEqual(['channels.problems.longLines', 'channels.problems.channelNotFound']);
  });

  it('findSections stops after the first line once the clock is past the deadline', () => {
    let t = 0;
    const r = findSections(['G13', 'G14', 'G13'], cpOf('okuma-osp'), presetOf('okuma-osp', 'okuma-2turret'), {
      deadline: 500,
      now: () => (t += 600),
    });
    expect(r.abandoned).toBe(true);
  });

  it('readMarker and documentChannel give up past the deadline', () => {
    const p: ChannelParams = { ...siemens, marker: 'CHAN(?<channel>\\d)' };
    let t = 0;
    const clock = { deadline: 500, now: () => (t += 600) };
    expect(readMarker(['; header', '; CHAN2'], cpOf('sinumerik'), p, clock)).toMatchObject({ channel: null, abandoned: true });
    t = 0;
    expect(documentChannel('PART.MPF', ['; header', '; CHAN2'], cpOf('sinumerik'), p, clock)).toMatchObject({ channel: null, abandoned: true });
    expect(readMarker(['; header', '; CHAN2'], cpOf('sinumerik'), p).channel?.id).toBe('2');
  });

  it('the tester stops its per-rule timings on one shared deadline', () => {
    const rule = fanuc('fanuc-2path').syncMarks[0];
    const p: ChannelParams = { ...fanuc('fanuc-2path'), syncMarks: [rule, { ...rule, id: 'second' }] };
    const lines = Array.from({ length: 50 }, () => 'M901').join('\n');
    // The resolution reads the clock 50 times (its deadline, then lines 2 to 50), one tick
    // each, well inside its budget. From the 52nd read on (the first rule's start), every read
    // is 1,000 ticks later, so the first rule is past the shared deadline after its first line.
    let calls = 0;
    const now = () => (++calls > 51 ? calls * 1000 : calls);
    const slow = testChannelRules(lines, 'PART.NC1', cpOf('fanuc-lathe'), p, { now });
    expect(slow.abandoned).toBe(false);
    expect(slow.rulesAbandoned).toBe(true);
    expect(slow.rules.map((r) => [r.id, r.slow])).toEqual([['wait', true]]);
    let t = 0;
    const fast = testChannelRules(lines, 'PART.NC1', cpOf('fanuc-lathe'), p, { now: () => ++t });
    expect([fast.rulesAbandoned, fast.rules.length]).toEqual([false, 2]);
  });
});

describe('CODE-11: fillTemplate inserts the stem as it is', () => {
  it('a $& in the stem is not a replacement pattern', () => {
    expect(fillTemplate('{{stem}}_CH{{channel}}.nc', 'A$&B', '2')).toBe('A$&B_CH2.nc');
    expect(fillTemplate('{{stem}}_CH{{channel}}.nc', "P$$X$'", '2')).toBe("P$$X$'_CH2.nc");
  });

  it('a stem that holds {{channel}} stays as written', () => {
    expect(fillTemplate('{{stem}}_CH{{channel}}.nc', 'A{{channel}}', '2')).toBe('A{{channel}}_CH2.nc');
  });
});

describe('CODE-4: the guide writes the file-name templates the way the product reads them', () => {
  it('channels.md has no single-brace {stem} or {channel}', () => {
    const text = readFileSync(fileURLToPath(new URL('../../../../docs/user/channels.md', import.meta.url)), 'utf8');
    expect(text.match(/(?<!\{)\{(stem|channel)\}(?!\})/g) ?? []).toEqual([]);
  });
});
