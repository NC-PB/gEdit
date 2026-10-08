// What the channels contribution declares and decides (plan §6 M12, WP12.5, §7.13): the
// eight commands and their keys, the key removal, and the decision functions — the next
// wait code with wrapping, the partner of a mark, the picker, the split texts and the
// check's report.

import { describe, expect, it, vi } from 'vitest';
import type { ChannelSet, SyncHit } from '$lib/core/channels/types';
import { hasKey } from '$lib/i18n';

vi.mock('$lib/stores/channels', () => ({
  channels: { ruleLabel: () => '' },
  sameMarkId: (a: string, b: string) => a === b || a.replace(/^M0+/, 'M') === b.replace(/^M0+/, 'M'),
}));
vi.mock('$lib/app/dialogs', () => ({ dialogs: {} }));
vi.mock('$lib/app/fileOps', () => ({ files: {} }));
vi.mock('$lib/app/modals', () => ({ modals: {} }));
vi.mock('$lib/app/outlineService', () => ({ computeJumpLines: () => ({}) }));
vi.mock('$lib/app/status', () => ({ status: { show: () => {} } }));
vi.mock('$lib/monaco/editorService', () => ({ editor: {} }));
vi.mock('$lib/stores/documents', () => ({ docs: { getActiveId: () => 'd1', get: () => ({ title: 'x.nc' }) } }));
vi.mock('$lib/stores/machines', () => ({ machines: {} }));
vi.mock('$lib/stores/results', () => ({ results: {} }));

const { default: contribution, stepSync, findPartner, splitTexts, selectItems, checkReport } = await import('./channels');

const hit = (line: number, mark: string, channel: string, ruleId = 'w', partners = ['1', '2', '3']): SyncHit => ({ ruleId, mark, line, channel, partners, blocking: true });
const ref = (id: string, index: number) => ({ id, name: `Channel ${id}`, index });

describe('the contribution', () => {
  it('declares the eight pinned commands with their keys', () => {
    const cmds = Object.fromEntries((contribution.commands ?? []).map((c) => [c.id, c]));
    expect(Object.keys(cmds).sort()).toEqual(
      ['channels.assign', 'channels.checkSync', 'channels.gotoPartner', 'channels.nextSyncPoint', 'channels.prevSyncPoint', 'channels.select', 'channels.splitToDocuments', 'channels.testOnDocument'],
    );
    expect(cmds['channels.nextSyncPoint'].keys).toBe('Alt+F7');
    expect(cmds['channels.prevSyncPoint'].keys).toBe('Shift+Alt+F7');
    expect(cmds['channels.gotoPartner'].keys).toBe('Mod+Alt+P');
    for (const c of Object.values(cmds)) {
      expect(hasKey(c.title), c.title).toBe(true);
      expect(c.category).toBe('channels.category');
    }
  });

  it('frees Mod+Alt+P from the editor\'s toggle-preserve-case', () => {
    expect(contribution.keybindingRemovals).toEqual([{ keys: 'Mod+Alt+P', command: 'togglePreserveCase' }]);
  });

  it('puts the navigation on the NC tab and the check on the Tools tab', () => {
    const where = Object.fromEntries((contribution.ribbon ?? []).map((r) => [r.command, `${r.tab}/${r.group}`]));
    expect(where).toEqual({
      'channels.nextSyncPoint': 'nc/channels.group',
      'channels.prevSyncPoint': 'nc/channels.group',
      'channels.gotoPartner': 'nc/channels.group',
      'channels.splitToDocuments': 'nc/channels.group',
      'channels.checkSync': 'tools/channels.toolsGroup',
    });
  });
});

describe('stepSync', () => {
  const marks = [hit(10, 'M901', '1'), hit(20, 'M902', '1'), hit(30, 'M903', '1')];
  it('steps to the next and the previous mark', () => {
    expect(stepSync(marks, 10, 1)).toEqual({ mark: marks[1], wrapped: false });
    expect(stepSync(marks, 25, -1)).toEqual({ mark: marks[1], wrapped: false });
  });
  it('wraps after the last and before the first', () => {
    expect(stepSync(marks, 30, 1)).toEqual({ mark: marks[0], wrapped: true });
    expect(stepSync(marks, 10, -1)).toEqual({ mark: marks[2], wrapped: true });
    expect(stepSync(marks, 99, 1)?.wrapped).toBe(true);
  });
  it('answers null for no marks', () => {
    expect(stepSync([], 1, 1)).toBeNull();
  });
});

describe('findPartner', () => {
  const order = [ref('1', 0), ref('2', 1), ref('3', 2)];
  const one = [hit(5, 'M901', '1'), hit(9, 'M901', '1'), hit(12, 'M902', '1')];
  const two = [hit(4, 'M901', '2'), hit(8, 'M0901', '2')];

  it('pairs the k-th mark of an id with the k-th of the other channel', () => {
    const marksOf = (c: string) => (c === '2' ? { docId: 'd2', marks: two } : null);
    const second = findPartner({ order, self: '1', mark: one[1], ownMarks: one, marksOf });
    expect(second).toMatchObject({ kind: 'found', docId: 'd2', hit: { line: 8 } });
    const first = findPartner({ order, self: '1', mark: one[0], ownMarks: one, marksOf });
    expect(first).toMatchObject({ kind: 'found', hit: { line: 4 } });
  });

  it('goes on to the next channel that has the id', () => {
    const three = [hit(40, 'M902', '3')];
    const marksOf = (c: string) => ({ docId: `d${c}`, marks: c === '2' ? two : three });
    expect(findPartner({ order, self: '1', mark: one[2], ownMarks: one, marksOf })).toMatchObject({ kind: 'found', channel: { id: '3' }, docId: 'd3' });
  });

  it('says which channel is not open when nothing else answers', () => {
    const marksOf = () => null;
    expect(findPartner({ order, self: '1', mark: one[0], ownMarks: one, marksOf })).toMatchObject({ kind: 'notOpen', channel: { id: '2' } });
  });

  it('says there is none when the open channels do not have it', () => {
    const marksOf = (c: string) => ({ docId: c, marks: [] as SyncHit[] });
    expect(findPartner({ order, self: '1', mark: one[0], ownMarks: one, marksOf })).toEqual({ kind: 'none' });
  });

  it('goes only to the channels the wait names, and to a mark that names this channel back (NC-03)', () => {
    // Path 1: M901 P13 (line 1), M901 P12 (line 2). Path 2: M901 P12. Path 3: M901 P13.
    const p1 = [hit(1, 'M901', '1', 'w', ['1', '3']), hit(2, 'M901', '1', 'w', ['1', '2'])];
    const p2 = [hit(1, 'M901', '2', 'w', ['1', '2'])];
    const p3 = [hit(1, 'M901', '3', 'w', ['1', '3'])];
    const marksOf = (c: string) => (c === '2' ? { docId: 'd2', marks: p2 } : c === '3' ? { docId: 'd3', marks: p3 } : null);
    expect(findPartner({ order, self: '1', mark: p1[0], ownMarks: p1, marksOf })).toMatchObject({ kind: 'found', channel: { id: '3' }, docId: 'd3', hit: { line: 1 } });
    expect(findPartner({ order, self: '1', mark: p1[1], ownMarks: p1, marksOf })).toMatchObject({ kind: 'found', channel: { id: '2' }, docId: 'd2', hit: { line: 1 } });
    const without3 = (c: string) => (c === '2' ? { docId: 'd2', marks: p2 } : null);
    expect(findPartner({ order, self: '1', mark: p1[0], ownMarks: p1, marksOf: without3 })).toMatchObject({ kind: 'notOpen', channel: { id: '3' } });
  });
});

const SET: ChannelSet = {
  layout: 'single-file',
  self: null,
  members: [
    { kind: 'section', channel: ref('1', 0), docId: 'd1', ranges: [{ startLine: 3, endLine: 4 }, { startLine: 8, endLine: 8 }] },
    { kind: 'section', channel: ref('2', 1), docId: 'd1', ranges: [{ startLine: 5, endLine: 7 }] },
  ],
  missing: [],
  outside: [{ startLine: 1, endLine: 2 }],
  marks: [],
  problems: [],
  truncated: false,
};

describe('splitTexts', () => {
  it('puts the program header in front of each channel\'s ranges, in document order', () => {
    const lines = ['%', 'O1000', 'G13', 'A1', 'G14', 'B1', 'B2', 'G13 A2'];
    const out = splitTexts(lines, SET);
    expect(out.map((o) => o.text)).toEqual(['%\nO1000\nG13\nA1\nG13 A2', '%\nO1000\nG14\nB1\nB2']);
    expect(out.map((o) => o.channel.id)).toEqual(['1', '2']);
  });

  it('has no header when the first section starts at line 1 (ranges alone)', () => {
    const set = { ...SET, outside: [] };
    expect(splitTexts(['G13', 'A', 'G14', 'B', 'x', 'y', 'z', 'w'], set)[1].text).toBe('x\ny\nz');
  });
});

describe('selectItems', () => {
  it('lists the sections of one program and reveals the first line of each', () => {
    const items = selectItems('d1', SET, [], null);
    expect(items.map((i) => [i.label, i.detail, i.value])).toEqual([
      ['Channel 1', 'Lines 3-4, 8', { kind: 'reveal', docId: 'd1', line: 3 }],
      ['Channel 2', 'Lines 5-7', { kind: 'reveal', docId: 'd1', line: 5 }],
    ]);
  });

  it('offers the other channels\' files, the dialog and the assignment for one file per channel', () => {
    const set: ChannelSet = {
      layout: 'multi-file',
      self: ref('1', 0),
      members: [
        { kind: 'file', channel: ref('1', 0), name: 'a_CH1.nc', path: '/a_CH1.nc', exists: true, docId: 'd1', by: 'fileName' },
        { kind: 'file', channel: ref('2', 1), name: 'a_CH2.nc', path: '/a_CH2.nc', exists: true, docId: null, by: 'fileName' },
      ],
      missing: [ref('3', 2)],
      outside: [],
      marks: [],
      problems: [],
      truncated: false,
    };
    const all = [ref('1', 0), ref('2', 1), ref('3', 2)];
    const items = selectItems('d1', set, all, 'x');
    expect(items.map((i) => i.value.kind)).toEqual(['focus', 'open', 'assign', 'assign', 'assign']);
    expect(items[2].label).toBe('Assign this document to Channel 2');
  });
});

describe('checkReport', () => {
  const names = new Map([['1', 'Turret A'], ['2', 'Turret B']]);
  const finding = { kind: 'missing' as const, mark: 'M901', ruleId: 'w', channel: '2', line: 7, message: { key: 'channels.codes.empty' } };

  it('names the machine, the channels checked and not checked and the other machine', () => {
    const report = checkReport({
      machine: 'Lathe 1',
      current: 'Lathe 1',
      names,
      result: {
        findings: [finding],
        truncated: false,
        checked: ['1'],
        notChecked: [{ id: '2', name: 'Turret B', index: 1 }],
        otherMachines: [{ channel: '1', docId: 'd9', machineName: 'Lathe 2' }, { channel: '2', docId: 'd8', machineName: null }],
      },
      docOf: (c) => `doc-${c}`,
      textOf: () => 'text',
    });
    expect(report.title).toBe('Wait codes, Lathe 1: 1 to look at');
    expect(report.message).toContain('Checked: Turret A.');
    expect(report.message).toContain('Not checked (not open or not found): Turret B.');
    expect(report.message).toContain('Turret A is set to machine “Lathe 2”. It was checked with the rules of “Lathe 1”.');
    expect(report.message).toContain('Turret B is set to no machine.');
    expect(report.rows).toEqual([{ channel: 'Turret B', docId: 'doc-2', line: 7, text: 'text' }]);
  });

  it('says everything matches when there is no finding', () => {
    const report = checkReport({ machine: 'Lathe 1', current: 'Lathe 1', names, result: { findings: [], truncated: false, checked: ['1', '2'], notChecked: [], otherMachines: [] }, docOf: () => null, textOf: () => '' });
    expect(report.title).toBe('Wait codes, Lathe 1: all match');
    expect(report.rows).toEqual([]);
  });

  it('says "not checked" when the program could not be read in time, never "all match" (F4)', () => {
    const report = checkReport({ machine: 'Lathe 1', current: 'Lathe 1', names, result: { findings: [], truncated: true, abandoned: true, checked: [], notChecked: [], otherMachines: [] }, docOf: () => null, textOf: () => '' });
    expect(report.title).toBe('Wait codes, Lathe 1: not checked');
    expect(report.message).toContain('took too long to read for channels, so nothing was checked');
  });
});
