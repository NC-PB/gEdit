// The tester's report (WP12.3's tester, built by I12): channels with ranges, outside lines,
// marks, problems, per-rule time with the 50 ms flag.

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { SLOW_RULE_MS, splitLines, testChannelRules } from './tester';
import type { ChannelParams } from './types';

const cp = cpOf('fanuc-lathe');

const single: ChannelParams = {
  layout: 'single-file',
  list: [
    { id: 'a', name: 'Turret A', aliases: ['G13'] },
    { id: 'b', name: 'Turret B', aliases: ['G14'] },
  ],
  sectionStart: '(?<![A-Z0-9.])(?<channel>G1[34])(?![\\d.])',
  syncMarks: [
    { id: 'wait', label: 'Waits', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'all' } },
    { id: 'none', label: 'Nothing', match: { kind: 'codes', codes: 'M700' }, partners: { kind: 'all' } },
  ],
};

describe('testChannelRules', () => {
  it('lists a channel with four sections as one row with every range', () => {
    const text = ['O1', 'G13', 'M901', 'G14', 'M901', 'G13', 'M902', 'G14', 'M902'].join('\n');
    const r = testChannelRules(text, '', cp, single);
    expect(r.layout).toBe('single-file');
    const a = r.sections.find((s) => s.channel.id === 'a');
    expect(a?.ranges).toEqual([
      { startLine: 2, endLine: 3 },
      { startLine: 6, endLine: 7 },
    ]);
    expect(a?.lines).toBe(4);
    expect(r.outside).toEqual([{ startLine: 1, endLine: 1 }]);
    expect(r.marks.map((m) => m.mark)).toEqual(['M901', 'M901', 'M902', 'M902']);
  });

  it('shows a rule that matches nothing as a row with no marks, timed', () => {
    let t = 0;
    const r = testChannelRules('G13\nM901', '', cp, single, { now: () => (t += 1) });
    expect(r.rules.map((x) => [x.id, x.marks, x.slow])).toEqual([
      ['wait', 1, false],
      ['none', 0, false],
    ]);
  });

  it('flags a rule over the time limit', () => {
    let t = 0;
    const r = testChannelRules('G13\nM901', '', cp, single, { now: () => (t += SLOW_RULE_MS + 1) });
    expect(r.rules.map((x) => x.slow)).toEqual([true, true]);
  });

  it('reads one channel from the file name in a multi-file block', () => {
    const multi: ChannelParams = {
      layout: 'multi-file',
      list: [
        { id: '1', name: 'Path 1' },
        { id: '2', name: 'Path 2' },
      ],
      fileName: '^(?<stem>.+)_CH(?<channel>\\d+)\\.nc$',
      syncMarks: single.syncMarks,
    };
    const r = testChannelRules('M901', 'p_CH2.nc', cp, multi);
    expect(r.self?.id).toBe('2');
    expect(r.by).toBe('fileName');
    expect(r.marks).toHaveLength(1);
    expect(testChannelRules('M901', 'other.nc', cp, multi).self).toBeNull();
  });

  it('splits on any line ending, and an empty text has no lines', () => {
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitLines('')).toEqual([]);
  });
});
