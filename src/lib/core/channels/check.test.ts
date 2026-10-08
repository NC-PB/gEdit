// The wait-code check (plan §7.17 "The check's algorithm, binding", WP12.2).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { t } from '$lib/i18n';
import { checkSyncMarks, checkSyncMarksReport, markKey } from './check';
import { findMarks } from './marks';
import { findSections } from './resolve';
import { CHANNEL_CAPS, STOPS_AND_ENDS_RULE, type ChannelParams, type SyncFinding, type SyncHit, type SyncRule } from './types';

// --- helpers ----------------------------------------------------------------------------

const rule = (id: string, over: Partial<SyncRule> = {}): SyncRule => ({
  id,
  label: `rule ${id}`,
  match: { kind: 'codes', codes: 'M900-M999' },
  partners: { kind: 'all' },
  ...over,
});

const machine = (ids: string[], rules: SyncRule[], over: Partial<ChannelParams> = {}): ChannelParams => ({
  layout: 'multi-file',
  list: ids.map((id) => ({ id, name: `Channel ${id}` })),
  syncMarks: rules,
  ...over,
});

const hit = (mark: string, line: number, channel: string, partners: string[], ruleId = 'wait', blocking = true): SyncHit => ({
  ruleId,
  mark,
  line,
  channel,
  partners,
  blocking,
});

/** Marks of one channel from `[mark, line]` pairs, all naming `partners`. */
const seq = (channel: string, partners: string[], marks: [string, number][], ruleId = 'wait'): SyncHit[] =>
  marks.map(([m, l]) => hit(m, l, channel, partners, ruleId));

const two = machine(['1', '2'], [rule('wait')]);
const brief = (f: SyncFinding[]) => f.map((x) => [x.kind, x.channel, x.line, x.mark, x.other ?? null]);

// --- goldens --------------------------------------------------------------------------

const GOLDEN_DIR = fileURLToPath(new URL('../../../../tests/fixtures/channels/check', import.meta.url));

interface Golden {
  description: string;
  profile: string;
  preset: string;
  machine?: Partial<ChannelParams>;
  program: Record<string, string[]> | string[];
  jumpLines?: Record<string, number[]>;
  expect: { findings: Partial<SyncFinding>[] };
}

function presetOf(profile: string, id: string): ChannelParams {
  const found = profileOf(profile).machineParams?.channels?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profile}: no preset ${id}`);
  return found.value;
}

/** What WP12.5 does for a report: the marks of every channel document (or every section). */
function perChannelOf(program: Golden['program'], cp: CompiledProfile, p: ChannelParams): Record<string, SyncHit[]> {
  const out: Record<string, SyncHit[]> = {};
  if (Array.isArray(program)) {
    const found = findSections(program, cp, p);
    expect(found.problems).toEqual([]);
    const owner = new Map<number, string>();
    for (const s of found.sections) {
      out[s.channel.id] = [];
      for (const r of s.ranges) for (let l = r.startLine; l <= r.endLine; l++) owner.set(l, s.channel.id);
    }
    out[''] = [];
    for (const m of findMarks(program, cp, p, {
      channelOf: (l) => owner.get(l) ?? '',
    }).marks)
      out[m.channel].push(m);
  } else {
    for (const [channel, lines] of Object.entries(program))
      out[channel] = findMarks(lines, cp, p, {
        channelOf: () => channel,
      }).marks;
  }
  return out;
}

function project(f: SyncFinding, like: Partial<SyncFinding>): Partial<SyncFinding> {
  const out: Partial<SyncFinding> = {
    kind: f.kind,
    channel: f.channel,
    line: f.line,
    mark: f.mark,
  };
  if ('ruleId' in like) out.ruleId = f.ruleId;
  if (f.other !== undefined) out.other = f.other;
  if (f.otherLine !== undefined) out.otherLine = f.otherLine;
  if (f.counts !== undefined) out.counts = f.counts;
  return out;
}

const goldens = readdirSync(GOLDEN_DIR)
  .filter((n) => n.endsWith('.json'))
  .sort();

describe('checkSyncMarks goldens (tests/fixtures/channels/check)', () => {
  it('has the goldens of every documented control shape', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(12);
  });

  it.each(goldens)('%s', (name) => {
    const g = JSON.parse(readFileSync(join(GOLDEN_DIR, name), 'utf8')) as Golden;
    const cp = cpOf(g.profile);
    const p = {
      ...presetOf(g.profile, g.preset),
      ...(g.machine ?? {}),
    } as ChannelParams;
    const perChannel = perChannelOf(g.program, cp, p);
    const findings = checkSyncMarks(perChannel, p, { jumpLines: g.jumpLines });
    const want = g.expect.findings;
    expect(
      findings.map((f, i) => project(f, want[i] ?? {})),
      g.description,
    ).toEqual(want);
    // Determinism: the same input with the channels in the other order gives the same bytes.
    const reversed = Object.fromEntries(Object.entries(perChannel).reverse());
    expect(JSON.stringify(checkSyncMarks(reversed, p, { jumpLines: g.jumpLines }))).toBe(JSON.stringify(findings));
  });
});

// --- the kinds, one by one -----------------------------------------------------------------

describe('checkSyncMarks: clean programs give no finding', () => {
  it('a pair in the shape of a real two-channel program: repeated ids, same counts, same order', () => {
    // A label on every wait line (no jump lines), mark 10 twice and mark 20 three times in both.
    const marks: [string, number][] = [
      ['10', 5],
      ['20', 8],
      ['10', 12],
      ['20', 15],
      ['20', 19],
    ];
    const perChannel = {
      '1': seq('1', ['1', '2'], marks),
      '2': seq(
        '2',
        ['1', '2'],
        marks.map(([m, l]) => [m, l + 2]),
      ),
    };
    expect(checkSyncMarks(perChannel, two)).toEqual([]);
  });

  it('a count rule with equal counts', () => {
    const p = machine(['a', 'b'], [rule('m100', { semantics: 'count' })]);
    const perChannel = {
      a: seq(
        'a',
        ['a', 'b'],
        [
          ['', 3],
          ['', 9],
        ],
        'm100',
      ),
      b: seq(
        'b',
        ['a', 'b'],
        [
          ['', 4],
          ['', 20],
        ],
        'm100',
      ),
    };
    expect(checkSyncMarks(perChannel, p)).toEqual([]);
  });

  it('an ordered rule with ids on one side only (P10/P20/P40 against P10/P30/P40)', () => {
    const p = machine(['a', 'b'], [rule('p', { semantics: 'ordered' })]);
    const perChannel = {
      a: seq(
        'a',
        ['a', 'b'],
        [
          ['P10', 3],
          ['P20', 5],
          ['P40', 7],
        ],
        'p',
      ),
      b: seq(
        'b',
        ['a', 'b'],
        [
          ['P10', 13],
          ['P30', 15],
          ['P40', 17],
        ],
        'p',
      ),
    };
    expect(checkSyncMarks(perChannel, p)).toEqual([]);
  });

  it('compares ids by digit value (M0101 = M101, 0101 = 101) and quotes them as written', () => {
    expect(markKey('M0101')).toBe(markKey('M101'));
    expect(markKey('0101')).toBe(markKey('101'));
    expect(markKey('0')).toBe(markKey('00'));
    expect(markKey('M101')).not.toBe(markKey('P101'));
    expect(markKey('A1B')).toBe('A1B');
    const perChannel = {
      '1': seq('1', ['2'], [['M0101', 3]]),
      '2': seq('2', ['1'], [['M101', 4]]),
    };
    expect(checkSyncMarks(perChannel, two)).toEqual([]);
    const off = {
      '1': seq(
        '1',
        ['2'],
        [
          ['M0101', 3],
          ['M0101', 5],
        ],
      ),
      '2': seq('2', ['1'], [['M101', 4]]),
    };
    expect(checkSyncMarks(off, two).map((f) => f.mark)).toEqual(['M0101']);
  });

  it('never checks a non-blocking mark (D60)', () => {
    const p = machine(['1', '2'], [rule('setm', { blocking: false })]);
    const perChannel = {
      '1': [hit('5', 3, '1', ['1', '2'], 'setm', false)],
      '2': [],
      '': [hit('6', 1, '', ['1'], 'setm', false)],
    };
    expect(checkSyncMarks(perChannel, p)).toEqual([]);
  });

  it('accepts partners that include the own channel, and order-free partner lists', () => {
    const perChannel = {
      '1': seq('1', ['2', '1'], [['M901', 3]]),
      '2': seq('2', ['1', '2'], [['M901', 4]]),
    };
    expect(checkSyncMarks(perChannel, two)).toEqual([]);
  });

  it('does not compare a channel the caller left out (its document is not open)', () => {
    const perChannel = { '1': seq('1', ['1', '2'], [['M901', 3]]) };
    expect(checkSyncMarks(perChannel, two)).toEqual([]);
    // Passed but empty: compared.
    expect(brief(checkSyncMarks({ ...perChannel, '2': [] }, two))).toEqual([['missing', '1', 3, 'M901', '2']]);
  });
});

describe('checkSyncMarks: findings', () => {
  it('count: unequal counts give exactly one finding, on the first unpaired mark', () => {
    const p = machine(['a', 'b'], [rule('m100', { semantics: 'count' })]);
    const perChannel = {
      a: seq('a', ['a', 'b'], [['', 3]], 'm100'),
      b: seq(
        'b',
        ['a', 'b'],
        [
          ['', 4],
          ['', 9],
          ['', 12],
        ],
        'm100',
      ),
    };
    const f = checkSyncMarks(perChannel, p);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      kind: 'count-mismatch',
      channel: 'b',
      other: 'a',
      line: 9,
      otherLine: 3,
      mark: '',
      counts: { channel: 3, other: 1 },
    });
    expect(f[0].message).toEqual({
      key: 'channels.findings.countMismatchRule',
      params: {
        rule: 'rule m100',
        channel: 'Channel b',
        other: 'Channel a',
        count: 3,
        otherCount: 1,
      },
    });
  });

  it('count: stops and ends are a count rule with every channel (STOPS_AND_ENDS_RULE)', () => {
    const p = machine(['1', '2', '3'], [], { stopsAndEndsWait: true });
    const all = ['1', '2', '3'];
    const perChannel = {
      '1': seq(
        '1',
        all,
        [
          ['', 10],
          ['', 20],
        ],
        STOPS_AND_ENDS_RULE,
      ),
      '2': seq(
        '2',
        all,
        [
          ['', 11],
          ['', 21],
        ],
        STOPS_AND_ENDS_RULE,
      ),
      '3': seq('3', all, [['', 30]], STOPS_AND_ENDS_RULE),
    };
    const f = checkSyncMarks(perChannel, p);
    expect(brief(f)).toEqual([
      ['count-mismatch', '1', 20, '', '3'],
      ['count-mismatch', '2', 21, '', '3'],
    ]);
    expect(f[0].message.key).toBe('channels.findings.countMismatchStops');
  });

  it('ordered: one decreasing id gives exactly one finding; the channels are never compared', () => {
    const p = machine(['a', 'b'], [rule('p', { semantics: 'ordered' })]);
    const perChannel = {
      a: seq(
        'a',
        ['a', 'b'],
        [
          ['P10', 3],
          ['P30', 5],
          ['P20', 7],
          ['P40', 9],
        ],
        'p',
      ),
      b: seq('b', ['a', 'b'], [['P50', 13]], 'p'),
    };
    const f = checkSyncMarks(perChannel, p);
    expect(brief(f)).toEqual([['not-increasing', 'a', 7, 'P20', null]]);
    expect(f[0].message).toEqual({
      key: 'channels.findings.notIncreasing',
      params: {
        mark: 'P20',
        previous: 'P30',
        previousLine: 5,
        channel: 'Channel a',
      },
    });
  });

  it('ordered: a decrease across a jump target is not checked', () => {
    const p = machine(['a', 'b'], [rule('p', { semantics: 'ordered' })]);
    const perChannel = {
      a: seq(
        'a',
        ['a', 'b'],
        [
          ['P10', 3],
          ['P30', 5],
          ['P20', 7],
        ],
        'p',
      ),
      b: [],
    };
    expect(brief(checkSyncMarks(perChannel, p, { jumpLines: { a: [6] } }))).toEqual([['order-not-checked', 'a', 7, 'P20', null]]);
  });

  it('rendezvous: an id the other channel lacks is missing on every mark that has it', () => {
    const perChannel = {
      '1': seq(
        '1',
        ['2'],
        [
          ['M901', 3],
          ['M930', 5],
          ['M930', 9],
        ],
      ),
      '2': seq('2', ['1'], [['M901', 4]]),
    };
    const f = checkSyncMarks(perChannel, two);
    expect(brief(f)).toEqual([
      ['missing', '1', 5, 'M930', '2'],
      ['missing', '1', 9, 'M930', '2'],
    ]);
    expect(f[0].message).toEqual({
      key: 'channels.findings.missing',
      params: { mark: 'M930', channel: 'Channel 1', other: 'Channel 2' },
    });
  });

  it('rendezvous: an id both carry in different numbers is one count mismatch, on the unpaired mark', () => {
    // The 3rd 80 of channel 1 against a channel 2 that has two.
    const perChannel = {
      '1': seq(
        '1',
        ['2'],
        [
          ['80', 3],
          ['80', 6],
          ['80', 9],
        ],
      ),
      '2': seq(
        '2',
        ['1'],
        [
          ['80', 4],
          ['80', 7],
        ],
      ),
    };
    const f = checkSyncMarks(perChannel, two);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      kind: 'count-mismatch',
      channel: '1',
      other: '2',
      line: 9,
      otherLine: 7,
      mark: '80',
      counts: { channel: 3, other: 2 },
    });
  });

  it('rendezvous: an extra wait in the second channel is reported there', () => {
    const perChannel = {
      '1': seq('1', ['2'], [['M901', 3]]),
      '2': seq(
        '2',
        ['1'],
        [
          ['M901', 4],
          ['M902', 6],
        ],
      ),
    };
    expect(brief(checkSyncMarks(perChannel, two))).toEqual([['missing', '2', 6, 'M902', '1']]);
  });

  it('rendezvous: a swapped pair is one out-of-order finding, with both lines on both sides', () => {
    const perChannel = {
      '1': seq(
        '1',
        ['2'],
        [
          ['M901', 3],
          ['M902', 5],
          ['M903', 7],
        ],
      ),
      '2': seq(
        '2',
        ['1'],
        [
          ['M901', 4],
          ['M903', 6],
          ['M902', 8],
        ],
      ),
    };
    const f = checkSyncMarks(perChannel, two);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      kind: 'out-of-order',
      channel: '1',
      other: '2',
      line: 5,
      otherLine: 8,
      mark: 'M902',
    });
    expect(f[0].message).toEqual({
      key: 'channels.findings.outOfOrder',
      params: {
        mark: 'M902',
        crossed: 'M903',
        channel: 'Channel 1',
        other: 'Channel 2',
        line: 5,
        crossedLine: 7,
        otherLine: 8,
        otherCrossedLine: 6,
      },
    });
    // M12 fix F5: with nothing more out of order the message has no "0 more" sentence.
    expect(t(f[0].message.key, f[0].message.params)).not.toMatch(/more/);
  });

  it('rendezvous: at most one inversion per pair, plus the count of the rest', () => {
    const ids = ['1', '2', '3', '4', '5', '6'];
    const perChannel = {
      '1': seq(
        '1',
        ['2'],
        ids.map((m, i) => [m, 10 + i] as [string, number]),
      ),
      '2': seq(
        '2',
        ['1'],
        [...ids].reverse().map((m, i) => [m, 10 + i] as [string, number]),
      ),
    };
    const f = checkSyncMarks(perChannel, two);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('out-of-order');
    expect(f[0].message.key).toBe('channels.findings.outOfOrderMore');
    expect(f[0].message.params?.rest).toBe(4);
    expect(t(f[0].message.key, f[0].message.params)).toMatch(/ 4 more out of order\.$/);
  });

  it('a jump target between two ids suspends exactly that pair; a plain label suspends nothing', () => {
    const perChannel = {
      '1': seq(
        '1',
        ['2'],
        [
          ['1', 3],
          ['2', 4],
          ['3', 6],
          ['4', 7],
          ['5', 9],
        ],
      ),
      '2': seq(
        '2',
        ['1'],
        [
          ['1', 3],
          ['3', 4],
          ['2', 5],
          ['5', 6],
          ['4', 8],
        ],
      ),
    };
    // Line 5 of channel 1 is a jump target (between marks 2 and 3); line 8 a plain label.
    expect(brief(checkSyncMarks(perChannel, two, { jumpLines: { '1': [5] } }))).toEqual([
      ['order-not-checked', '1', 4, '2', '2'],
      ['out-of-order', '1', 7, '4', '2'],
    ]);
    // M12 fix F5: one pair each, so neither message says "0 more".
    for (const f of checkSyncMarks(perChannel, two, { jumpLines: { '1': [5] } })) {
      expect(f.message.key).toMatch(/^channels\.findings\.(orderNotChecked|outOfOrder)$/);
      expect(t(f.message.key, f.message.params)).not.toMatch(/more/);
    }
    // Without jump lines both pairs are inversions: one finding, the rest counted.
    const plain = checkSyncMarks(perChannel, two);
    expect(brief(plain)).toEqual([['out-of-order', '1', 4, '2', '2']]);
    expect(plain[0].message.params?.rest).toBe(1);
    // A jump line in the other channel between the partners suspends the pair too.
    expect(brief(checkSyncMarks(perChannel, two, { jumpLines: { '2': [7] } }))).toEqual([
      ['out-of-order', '1', 4, '2', '2'],
      ['order-not-checked', '1', 7, '4', '2'],
    ]);
  });

  it('a label on the mark line itself separates nothing', () => {
    const perChannel = {
      '1': seq(
        '1',
        ['2'],
        [
          ['1', 3],
          ['2', 5],
        ],
      ),
      '2': seq(
        '2',
        ['1'],
        [
          ['2', 3],
          ['1', 5],
        ],
      ),
    };
    expect(
      brief(
        checkSyncMarks(perChannel, two, {
          jumpLines: { '1': [3, 5], '2': [3, 5] },
        }),
      ),
    ).toEqual([['out-of-order', '1', 3, '1', '2']]);
  });

  it('unmatched: a blocking rendezvous mark that names only its own channel, or nothing', () => {
    const perChannel = {
      '1': [hit('M905', 3, '1', []), hit('M906', 5, '1', ['1'])],
      '2': [],
    };
    const f = checkSyncMarks(perChannel, two);
    expect(brief(f)).toEqual([
      ['unmatched', '1', 3, 'M905', null],
      ['unmatched', '1', 5, 'M906', null],
    ]);
    expect(f[0].message).toEqual({
      key: 'channels.findings.unmatched',
      params: { mark: 'M905', channel: 'Channel 1' },
    });
  });

  it('unmatched is never raised by a count or an ordered rule', () => {
    const p = machine(['a', 'b'], [rule('m100', { semantics: 'count' }), rule('p', { semantics: 'ordered' })]);
    const perChannel = {
      a: [hit('', 3, 'a', [], 'm100'), hit('P10', 4, 'a', [], 'p')],
      b: [],
    };
    expect(checkSyncMarks(perChannel, p)).toEqual([]);
  });

  it('a mark that is missing is not also unmatched; one that names an unknown channel is not unmatched', () => {
    const perChannel = {
      '1': [hit('M907', 3, '1', ['1', '2'])],
      '2': [hit('M908', 4, '2', ['4'])],
    };
    expect(brief(checkSyncMarks(perChannel, two))).toEqual([
      ['missing', '1', 3, 'M907', '2'],
      ['unknown-channel', '2', 4, 'M908', null],
    ]);
  });

  it('unknown-channel names the token as written; all and fixed partners resolve inside the list', () => {
    const lineRule = machine(
      ['1', '2'],
      [
        rule('waitm', {
          match: { kind: 'regex', pattern: '\\bWAITM\\s*\\(\\s*(?<mark>\\d+)' },
          partners: {
            kind: 'line',
            pattern: '\\bWAITM\\s*\\(\\s*\\d+\\s*,(?<channels>[^)]*)\\)',
          },
        }),
        rule('fixed', {
          match: { kind: 'codes', codes: 'M800' },
          partners: { kind: 'fixed', channels: ['1', '2'] },
        }),
        rule('all', { match: { kind: 'codes', codes: 'M801' } }),
      ],
    );
    const cp = cpOf('sinumerik');
    const lines1 = ['WAITM(1,2,K9)', 'M800', 'M801'];
    const lines2 = ['WAITM(1,1)', 'M800', 'M801'];
    const perChannel = {
      '1': findMarks(lines1, cp, lineRule, { channelOf: () => '1' }).marks,
      '2': findMarks(lines2, cp, lineRule, { channelOf: () => '2' }).marks,
    };
    const f = checkSyncMarks(perChannel, lineRule);
    expect(brief(f)).toEqual([['unknown-channel', '1', 1, '1', null]]);
    expect(f[0].message).toEqual({
      key: 'channels.findings.unknownChannel',
      params: { mark: '1', token: 'K9', channel: 'Channel 1' },
    });
  });

  it('outside-channels: a blocking mark no section owns; a stop or end there is not reported', () => {
    const perChannel = {
      '': [hit('P5', 2, '', ['a', 'b'], 'p'), hit('', 40, '', ['a', 'b'], STOPS_AND_ENDS_RULE)],
      a: [],
      b: [],
    };
    const p = machine(['a', 'b'], [rule('p', { semantics: 'ordered' })], {
      stopsAndEndsWait: true,
    });
    const f = checkSyncMarks(perChannel, p);
    expect(brief(f)).toEqual([['outside-channels', '', 2, 'P5', null]]);
    expect(f[0].message).toEqual({
      key: 'channels.findings.outside',
      params: { mark: 'P5', line: 2 },
    });
  });

  it('an id present in three channels where one is missing', () => {
    const three = machine(['1', '2', '3'], [rule('wait')]);
    const all = ['1', '2', '3'];
    const perChannel = {
      '1': seq('1', all, [
        ['M901', 3],
        ['M902', 5],
      ]),
      '2': seq('2', all, [
        ['M901', 4],
        ['M902', 6],
      ]),
      '3': seq('3', all, [['M901', 7]]),
    };
    expect(brief(checkSyncMarks(perChannel, three))).toEqual([
      ['missing', '1', 5, 'M902', '3'],
      ['missing', '2', 6, 'M902', '3'],
    ]);
  });

  it('is deterministic: the same input twice, and the channels in the other order, give the same bytes', () => {
    const three = machine(['1', '2', '3'], [rule('wait'), rule('m100', { semantics: 'count' })]);
    const all = ['1', '2', '3'];
    const perChannel: Record<string, SyncHit[]> = {
      '1': [
        ...seq('1', all, [
          ['M901', 3],
          ['M903', 5],
          ['M902', 7],
          ['M904', 8],
        ]),
        hit('', 9, '1', all, 'm100'),
      ],
      '2': [
        ...seq('2', all, [
          ['M901', 4],
          ['M902', 6],
          ['M903', 8],
        ]),
        hit('', 9, '2', all, 'm100'),
        hit('', 10, '2', all, 'm100'),
      ],
      '3': [
        ...seq('3', all, [
          ['M902', 2],
          ['M901', 3],
        ]),
        hit('M909', 4, '3', ['3']),
      ],
      '': [hit('M999', 1, '', all)],
    };
    const a = JSON.stringify(checkSyncMarks(perChannel, three));
    expect(JSON.stringify(checkSyncMarks(perChannel, three))).toBe(a);
    const reversed = Object.fromEntries(Object.entries(perChannel).reverse());
    expect(JSON.stringify(checkSyncMarks(reversed, three))).toBe(a);
    const parsed = JSON.parse(a) as SyncFinding[];
    expect(parsed.length).toBeGreaterThan(4);
    // Sorted by channel (declared order, '' first), then line.
    const order = ['', '1', '2', '3'];
    for (let i = 1; i < parsed.length; i++) {
      const [x, y] = [parsed[i - 1], parsed[i]];
      const c = order.indexOf(x.channel) - order.indexOf(y.channel);
      expect(c < 0 || (c === 0 && x.line <= y.line)).toBe(true);
    }
  });

  it('sets document per channel when the caller names them (F58)', () => {
    const perChannel = { '1': seq('1', ['2'], [['M901', 3]]), '2': [] };
    const f = checkSyncMarks(perChannel, two, {
      documents: { '1': 'PART.NC-1', '2': 'PART.NC-2' },
    });
    expect(f[0].document).toBe('PART.NC-1');
    expect('document' in checkSyncMarks(perChannel, two)[0]).toBe(false);
  });

  it('is truncated, and says so, past the deadline', () => {
    const many = Array.from({ length: 5000 }, (_, i) => [`M${900 + (i % 100)}`, i + 1] as [string, number]);
    const perChannel = { '1': seq('1', ['2'], many), '2': [] };
    let t = 0;
    const report = checkSyncMarksReport(perChannel, two, {
      deadline: 10,
      now: () => t++,
    });
    expect(report.truncated).toBe(true);
    expect(report.findings.length).toBeLessThan(5000);
    expect(checkSyncMarksReport(perChannel, two).truncated).toBe(false);
    expect(checkSyncMarksReport(perChannel, two).findings).toHaveLength(5000);
  });

  it('ignores a hit of a rule the machine does not have, and a channel it does not declare', () => {
    const perChannel = {
      '1': [hit('M901', 3, '1', ['2'], 'gone')],
      '9': [hit('M901', 3, '9', ['1'])],
      '2': [],
    };
    expect(checkSyncMarks(perChannel, two)).toEqual([]);
  });
});

// --- G7: the contract cap -------------------------------------------------------------------

describe('checkSyncMarks budget (§7.17, G7: at the contract cap)', () => {
  /** `total` marks spread round-robin over `n` channels, every mark naming every channel, the
   *  same id sequence in each channel except one swapped pair per channel (so the diff runs). */
  function capInput(n: number, total: number): { perChannel: Record<string, SyncHit[]>; p: ChannelParams } {
    const ids = Array.from({ length: n }, (_, i) => String(i + 1));
    const p = machine(ids, [rule('wait')]);
    const per = Math.floor(total / n);
    const perChannel: Record<string, SyncHit[]> = {};
    ids.forEach((id, c) => {
      const marks = Array.from({ length: per }, (_, i) => `M${900 + (i % 100)}`);
      const k = (c * 7) % (per - 1);
      [marks[k], marks[k + 1]] = [marks[k + 1], marks[k]];
      perChannel[id] = marks.map((m, i) => hit(m, i + 1, id, ids));
    });
    return { perChannel, p };
  }

  it.each([
    [8, CHANNEL_CAPS.marks],
    [32, CHANNEL_CAPS.marks],
    [3, 2_000],
  ])('%i channels, %i marks within the check budget', (n, total) => {
    const { perChannel, p } = capInput(n, total);
    let findings: SyncFinding[] = [];
    const ms = fastest(2, () => {
      findings = checkSyncMarks(perChannel, p);
    });
    expect(findings.length).toBeGreaterThan(0);
    expectWithin(ms, CHANNEL_CAPS.checkMs, `check of ${total} marks over ${n} channels`);
  });

  it('the worst order (one channel reversed, 10,000 marks each) within the check budget', () => {
    const marks = Array.from({ length: CHANNEL_CAPS.marks / 2 }, (_, i) => `M${i}`);
    const perChannel = {
      '1': marks.map((m, i) => hit(m, i + 1, '1', ['2'])),
      '2': [...marks].reverse().map((m, i) => hit(m, i + 1, '2', ['1'])),
    };
    let findings: SyncFinding[] = [];
    const ms = fastest(2, () => {
      findings = checkSyncMarks(perChannel, two, {
        jumpLines: { '1': Array.from({ length: 1000 }, (_, i) => i * 10 + 5) },
      });
    });
    expect(findings.map((f) => f.kind).sort()).toEqual(['order-not-checked', 'out-of-order']);
    expectWithin(ms, CHANNEL_CAPS.checkMs, 'check of 20,000 marks in reversed order');
  });
});
