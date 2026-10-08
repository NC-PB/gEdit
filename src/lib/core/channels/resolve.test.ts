// Channel resolution (plan §7.17, WP12.1 deliver; written by P12, extended by WP12.1). The
// fixtures of §9.1 run through `goldens.test.ts`; this file is the section table and the
// rules that keep a line out of a channel it may not be in.

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { channelAt, channelsAt, complementRanges, findSections, markerChannel, readMarker, resolveChannelToken } from './resolve';
import type { ChannelParams, ChannelSet } from './types';

const lathe = cpOf('fanuc-lathe');
const sinumerik = cpOf('sinumerik');

const twin = (over: Partial<ChannelParams> = {}): ChannelParams => ({
  layout: 'single-file',
  list: [
    { id: '1', name: 'Turret A', aliases: ['G13'] },
    { id: '2', name: 'Turret B', aliases: ['G14'] },
  ],
  sectionStart: '(?<![A-Z0-9.])(?<channel>G1[34])(?![\\d.])',
  syncMarks: [],
  ...over,
});

const ranges = (r: ReturnType<typeof findSections>) =>
  Object.fromEntries(r.sections.map((s) => [s.channel.id, s.ranges.map((x) => [x.startLine, x.endLine])]));

describe('findSections', () => {
  it('collects four alternating sections into two channels with two ranges each', () => {
    const lines = ['%', 'O1000', 'G13', 'G0 X1', 'G14', 'G0 X2', 'G13', 'G1 X3', 'G14', 'G1 X4', 'M02'];
    const r = findSections(lines, lathe, twin());
    expect(ranges(r)).toEqual({ '1': [[3, 4], [7, 8]], '2': [[5, 6], [9, 11]] });
    expect(r.outside).toEqual([{ startLine: 1, endLine: 2 }]);
    expect(r.problems).toEqual([]);
  });

  it('ends a section at sectionEnd and puts the lines up to the next start outside', () => {
    const p = twin({ sectionEnd: '(?<![A-Z])M99(?!\\d)' });
    const lines = ['G13', 'G0 X1', 'M99', 'O9000 (SUB)', 'M99', 'G14', 'G0 X2', 'M99', '(TAIL)'];
    const r = findSections(lines, lathe, p);
    expect(ranges(r)).toEqual({ '1': [[1, 3]], '2': [[6, 8]] });
    expect(r.outside).toEqual([
      { startLine: 4, endLine: 5 },
      { startLine: 9, endLine: 9 },
    ]);
  });

  it('ignores a start inside a comment', () => {
    const r = findSections(['(G14 LATER)', 'G13', 'X1'], lathe, twin());
    expect(ranges(r)).toEqual({ '1': [[2, 3]] });
    expect(r.problems.map((p) => p.message.key)).toEqual(['channels.problems.channelNotFound']);
  });

  it('lists a section that names several channels under each of them', () => {
    const p: ChannelParams = {
      layout: 'single-file',
      list: [
        { id: 's1', name: 'S1' },
        { id: 's3', name: 'S3' },
        { id: 's4', name: 'S4' },
      ],
      sectionStart: '^\\+(?<channel>[A-Z0-9/]+)$',
      syncMarks: [],
    };
    const r = findSections(['+S1/S3/S4', 'G0 X0', '+S1', 'G0 X1'], lathe, p);
    expect(ranges(r)).toEqual({ s1: [[1, 4]], s3: [[1, 2]], s4: [[1, 2]] });
  });

  it('reports an undeclared channel with its line, and keeps its lines outside', () => {
    const p = twin({ sectionStart: '^\\$(?<channel>\\w+)$' });
    const r = findSections(['$1', 'X1', '$7', 'X7', '$2', 'X2'], lathe, p);
    expect(ranges(r)).toEqual({ '1': [[1, 2]], '2': [[5, 6]] });
    expect(r.outside).toEqual([{ startLine: 3, endLine: 4 }]);
    expect(r.problems).toEqual([
      { path: 'line:3', message: { key: 'channels.problems.unknownChannel', params: { line: 3, token: '7' } } },
    ]);
  });

  it('takes the Nth start as the Nth channel when the pattern has no channel capture', () => {
    const p = twin({ sectionStart: '^O\\d+' });
    const r = findSections(['%', 'O2101', 'X1', 'O2102', 'X2', 'O2103'], lathe, p);
    expect(ranges(r)).toEqual({ '1': [[2, 3]], '2': [[4, 5]] });
    expect(r.problems.map((x) => x.message.key)).toEqual(['channels.problems.tooManyStarts']);
  });

  it('answers nothing for no match, another layout, or a pattern that does not compile', () => {
    expect(findSections(['G0 X1'], lathe, twin()).sections).toEqual([]);
    expect(findSections(['G13'], lathe, twin({ layout: 'multi-file' })).sections).toEqual([]);
    const bad = findSections(['G13'], lathe, twin({ sectionStart: '(' }));
    expect(bad.sections).toEqual([]);
    expect(bad.problems[0].message.key).toBe('channels.problems.badPattern');
  });

  it('gives up past its deadline', () => {
    let t = 0;
    const lines = Array.from({ length: 5000 }, (_, i) => (i % 2 ? 'G13' : 'X1'));
    const r = findSections(lines, lathe, twin(), { deadline: 10, now: () => (t += 20) });
    expect(r.abandoned).toBe(true);
    expect(r.sections).toEqual([]);
  });
});

describe('channelAt', () => {
  const set: ChannelSet = {
    layout: 'single-file',
    self: null,
    members: [
      { kind: 'section', channel: { id: '1', name: 'A', index: 0 }, docId: 'd', ranges: [{ startLine: 3, endLine: 4 }, { startLine: 7, endLine: 8 }] },
      { kind: 'section', channel: { id: '2', name: 'B', index: 1 }, docId: 'd', ranges: [{ startLine: 5, endLine: 6 }] },
    ],
    missing: [],
    outside: [{ startLine: 1, endLine: 2 }],
    marks: [],
    problems: [],
    truncated: false,
  };
  it('walks every range', () => {
    expect([1, 3, 5, 8, 9].map((line) => channelAt(set, line)?.id ?? null)).toEqual([null, '1', '2', '1', null]);
  });
  it('answers the document itself in multi-file', () => {
    const self = { id: '2', name: 'B', index: 1 };
    expect(channelAt({ ...set, layout: 'multi-file', members: [], self }, 99)).toBe(self);
  });
});

describe('tokens, markers and ranges', () => {
  it('resolves ids and aliases ignoring case', () => {
    expect(resolveChannelToken(twin(), ' g14 ')?.id).toBe('2');
    expect(resolveChannelToken(twin(), '3')).toBeNull();
  });
  it('reads the marker on the raw line, comments included', () => {
    const p: ChannelParams = { ...twin(), layout: 'multi-file', marker: '\\(CHANNEL (?<channel>\\d)\\)' };
    expect(markerChannel(['%', 'O1 (CHANNEL 2)'], lathe, p)).toBe('2');
    expect(markerChannel(['%', 'O1 (CHANNEL 7)'], lathe, p)).toBeNull();
  });
  it('complements covered ranges', () => {
    expect(complementRanges([{ startLine: 3, endLine: 4 }], 6)).toEqual([
      { startLine: 1, endLine: 2 },
      { startLine: 5, endLine: 6 },
    ]);
  });
});

describe('findSections, WP12.1', () => {
  it('runs the last section to the last line, and a start without its channel group names nothing', () => {
    const p = twin({ sectionStart: '^\\$(?:(?<channel>\\d))?' });
    const r = findSections(['%', '$1', 'X1', '$', 'X9', '$2', 'X2', 'M30'], lathe, p);
    expect(ranges(r)).toEqual({ '1': [[2, 3]], '2': [[6, 8]] });
    expect(r.outside).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 4, endLine: 5 },
    ]);
    expect(r.problems.map((x) => [x.path, x.message.key])).toEqual([['line:4', 'channels.problems.noChannelInStart']]);
  });

  it('reports a declared channel that has no section', () => {
    const r = findSections(['G13', 'X1'], lathe, twin());
    expect(r.problems).toEqual([
      { path: 'list[1]', message: { key: 'channels.problems.channelNotFound', params: { channel: 'Turret B' } } },
    ]);
  });

  it('starts no section from inside a string', () => {
    const p = twin({ sectionStart: '\\b(?<channel>G1[34])\\b' });
    const r = findSections(['N10 MSG("G14 NEXT")', 'N20 G13', 'N30 MSG("G14")', 'N40 X1'], sinumerik, p);
    expect(ranges(r)).toEqual({ '1': [[2, 4]] });
  });

  it('gives a channel of four alternating sections both of its ranges, and channelAt answers in the second', () => {
    const lines = ['O1', 'G13', 'X1', 'G14', 'X2', 'G13', 'X3', 'G14', 'X4'];
    const r = findSections(lines, lathe, twin());
    const set = {
      layout: 'single-file' as const,
      self: null,
      members: r.sections.map((s) => ({ kind: 'section' as const, channel: s.channel, docId: 'd', ranges: s.ranges })),
      missing: [],
      outside: r.outside,
      marks: [],
      problems: [],
      truncated: false,
    };
    expect([1, 3, 5, 7, 9].map((line) => channelAt(set, line)?.id ?? null)).toEqual([null, '1', '2', '1', '2']);
  });

  it('lists a shared section under every channel it names, and channelsAt answers all of them', () => {
    const p: ChannelParams = {
      layout: 'single-file',
      list: [
        { id: 's1', name: 'S1' },
        { id: 's3', name: 'S3' },
      ],
      sectionStart: '^\\+(?<channel>[A-Z0-9/]+)$',
      syncMarks: [],
    };
    const r = findSections(['+S3/S1', 'X0', '+S3', 'X1'], lathe, p);
    const set: ChannelSet = {
      layout: 'single-file',
      self: null,
      members: r.sections.map((s) => ({ kind: 'section', channel: s.channel, docId: 'd', ranges: s.ranges })),
      missing: [],
      outside: [],
      marks: [],
      problems: [],
      truncated: false,
    };
    expect(channelsAt(set, 2).map((c) => c.id)).toEqual(['s1', 's3']);
    expect(channelsAt(set, 4).map((c) => c.id)).toEqual(['s3']);
    expect(channelAt(set, 2)?.id).toBe('s1');
  });

  it('never gives a section to a channel through a token two channels claim', () => {
    // An alias equal to another channel's id, and one alias on two channels: validation
    // refuses both (WP12.3); resolution names nobody rather than the first declaration.
    const p = twin({
      list: [
        { id: '1', name: 'A', aliases: ['G13', 'X'] },
        { id: '2', name: 'B', aliases: ['G14', '1', 'X'] },
      ],
      sectionStart: '^\\$(?<channel>\\w+)$',
    });
    expect(resolveChannelToken(p, '1')).toBeNull();
    expect(resolveChannelToken(p, 'x')).toBeNull();
    expect(resolveChannelToken(p, 'G14')?.id).toBe('2');
    const r = findSections(['$1', 'X1', '$G14', 'X2'], lathe, p);
    expect(ranges(r)).toEqual({ '2': [[3, 4]] });
    expect(r.outside).toEqual([{ startLine: 1, endLine: 2 }]);
    expect(r.problems[0]).toEqual({ path: 'line:1', message: { key: 'channels.problems.unknownChannel', params: { line: 1, token: '1' } } });
  });
});

describe('readMarker', () => {
  const p = (marker: string): ChannelParams => ({ ...twin(), layout: 'multi-file', marker });
  const marker = '\\(PATH (?<channel>\\w+)\\)';

  it('answers the channel and its line; repeated agreeing markers are fine', () => {
    const r = readMarker(['%', '(PATH 2)', 'O1 (PATH 2)'], lathe, p(marker));
    expect([r.channel?.id, r.line, r.problems]).toEqual(['2', 2, []]);
  });

  it('names nothing for a header that names an undeclared channel, and says so', () => {
    const r = readMarker(['(PATH 7)', '(PATH 1)'], lathe, p(marker));
    expect(r.channel).toBeNull();
    expect(r.problems.map((x) => [x.path, x.message.key])).toEqual([['line:1', 'channels.problems.unknownChannel']]);
  });

  it('names nothing when two lines name different channels', () => {
    const r = readMarker(['(PATH 1)', 'G0 X1', '(PATH G14)'], lathe, p(marker));
    expect(r.channel).toBeNull();
    expect(r.problems).toEqual([
      { path: 'line:3', message: { key: 'channels.problems.markerConflict', params: { line: 3, channel: 'Turret B', other: 1, otherChannel: 'Turret A' } } },
    ]);
    expect(markerChannel(['(PATH 1)', '(PATH 2)'], lathe, p(marker))).toBeNull();
  });

  it('reads only the first 400 lines, and reports a pattern that does not compile', () => {
    const lines = [...Array.from({ length: 400 }, () => 'G0 X1'), '(PATH 1)'];
    expect(readMarker(lines, lathe, p(marker)).channel).toBeNull();
    expect(readMarker(['(PATH 1)'], lathe, p('(')).problems[0].message.key).toBe('channels.problems.badPattern');
  });
});
