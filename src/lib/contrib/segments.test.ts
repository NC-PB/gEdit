// Select a tool segment (plan §6 M10, WP10.1): the bounds come from the outline's tool items
// and their `endLine`; the selection is set on the editor instance. The pure helpers are
// tested directly, the command against a fake outline, editor and form.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutlineItem } from '$lib/core/profiles/outline';
import type { CommandDef } from '$lib/app/types';

const tool = (line: number, endLine: number, number: string, children?: OutlineItem[]): OutlineItem => ({
  kind: 'tool',
  line,
  endLine,
  text: `T${number}`,
  tool: number,
  children,
});
const program: OutlineItem = { kind: 'program', line: 1, endLine: 40, text: 'O1' };

// Lines 1-4 header, T1 5-14, T2 15-24 (ends with two blank lines), T1 again 25-40.
const ITEMS: OutlineItem[] = [program, tool(5, 14, '1'), tool(15, 24, '2'), tool(25, 40, '1')];

const fake = vi.hoisted(() => ({
  items: [] as OutlineItem[],
  cursor: 1,
  lines: [] as string[],
  selections: [] as unknown[],
  revealed: [] as unknown[],
  messages: [] as string[],
  answer: undefined as Record<string, unknown> | undefined,
  choices: [] as { label: string; value: unknown }[],
  asked: 0,
  ready: 0,
}));

vi.mock('$lib/app/outlineService', () => ({
  outline: {
    whenReady: (): Promise<void> => {
      fake.ready++;
      return Promise.resolve();
    },
    snapshot: (): OutlineItem[] => fake.items,
  },
}));
vi.mock('$lib/app/modals', () => ({
  modals: {
    form: (spec: { fields: { choices: { label: string; value: unknown }[] }[] }): Promise<Record<string, unknown> | undefined> => {
      fake.asked++;
      fake.choices = spec.fields[0]?.choices ?? [];
      return Promise.resolve(fake.answer);
    },
  },
}));
vi.mock('$lib/app/status', () => ({
  status: { show: (text: string): number => fake.messages.push(text), clear: (): void => {} },
}));
vi.mock('$lib/stores/documents', () => ({ docs: { getActiveId: (): string => 'd1' } }));
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    cursor: () => ({ line: fake.cursor, column: 1 }),
    getLineCount: (): number => fake.lines.length,
    getLines: (_id: string, first: number, last: number): string[] => fake.lines.slice(first - 1, last),
    editorInstance: () => ({
      getModel: () => ({ getLineMaxColumn: (line: number): number => (fake.lines[line - 1] ?? '').length + 1 }),
      setSelection: (range: unknown): number => fake.selections.push(range),
      revealLinesInCenterIfOutsideViewport: (first: number, last: number): number => fake.revealed.push([first, last]),
      focus: (): void => {},
    }),
  },
}));

const segments = (await import('./segments')).default;
const { boundsOf, pickSegment, segmentAt, segmentsOf, sameTool, toolKey, toolSegments, trimBlankEnd } = await import('./segments');
const { hasKey } = await import('$lib/i18n');

const command = (segments.commands ?? [])[0] as CommandDef;

describe('the command', () => {
  it('is the one of plan §7.13 on Mod+F7, in the NC tab', () => {
    expect(command.id).toBe('nav.selectToolSegment');
    expect(command.keys).toBe('Mod+F7');
    expect(segments.ribbon?.[0]).toMatchObject({ tab: 'nc', group: 'segments.group', command: 'nav.selectToolSegment' });
    expect(command.enabled?.({ activeDocId: null } as never)).toBe(false);
    for (const key of [command.title, command.category ?? '', 'segments.group', 'segments.askChoice', 'segments.noTools', 'segments.noSuchTool', 'segments.selected', 'segments.selectedNoTool']) {
      expect(hasKey(key), key).toBe(true);
    }
  });
});

describe('the bounds', () => {
  it('finds the tool segment that covers a line, and none in the header', () => {
    expect(segmentAt(ITEMS, 5)?.line).toBe(5);
    expect(segmentAt(ITEMS, 14)?.line).toBe(5);
    expect(segmentAt(ITEMS, 15)?.line).toBe(15);
    expect(segmentAt(ITEMS, 40)?.line).toBe(25);
    expect(segmentAt(ITEMS, 3)).toBeNull();
    expect(toolSegments(ITEMS).map((i) => i.line)).toEqual([5, 15, 25]);
  });

  it('reads the end from the item and never ends above the start', () => {
    expect(boundsOf(ITEMS[1])).toEqual({ first: 5, last: 14 });
    expect(boundsOf({ kind: 'tool', line: 7, text: '' })).toEqual({ first: 7, last: 7 });
  });

  it('matches tool numbers however they are written', () => {
    expect(sameTool('5', '05')).toBe(true);
    expect(sameTool('T5', '5')).toBe(true);
    expect(sameTool('5', '6')).toBe(false);
    expect(sameTool('DRILL', 'drill')).toBe(true);
    expect(toolKey(' T05 ')).toBe('5');
    expect(toolKey('t5')).toBe('5');
    expect(segmentsOf(ITEMS, '1').map((i) => i.line)).toEqual([5, 25]);
  });

  it('takes the first segment at or after the cursor, wrapping to the first', () => {
    const found = segmentsOf(ITEMS, '1');
    expect(pickSegment(found, 10)?.line).toBe(25);
    expect(pickSegment(found, 30)?.line).toBe(5);
    expect(pickSegment([], 1)).toBeNull();
  });

  it('leaves the blank lines at the end of the segment out', () => {
    const lines = ['G1', 'G2', '', ''];
    expect(trimBlankEnd(1, 4, (n) => lines[n - 1])).toBe(2);
    expect(trimBlankEnd(3, 4, (n) => lines[n - 1])).toBe(3);
  });
});

describe('selecting', () => {
  beforeEach(() => {
    fake.items = ITEMS;
    fake.cursor = 1;
    fake.lines = Array.from({ length: 40 }, (_v, i) => (i >= 22 && i < 24 ? '' : `LINE${i + 1}`));
    fake.selections = [];
    fake.revealed = [];
    fake.messages = [];
    fake.answer = undefined;
    fake.asked = 0;
    fake.choices = [];
    fake.ready = 0;
  });

  const run = (arg?: unknown): unknown => command.run({ activeDocId: 'd1' } as never, arg);

  it('waits for the first build, then selects the segment under the cursor', async () => {
    fake.cursor = 17;
    await run();
    expect(fake.ready).toBe(1);
    // T2 is lines 15-24; 23 and 24 are blank and stay out.
    expect(fake.selections).toEqual([{ startLineNumber: 15, startColumn: 1, endLineNumber: 22, endColumn: 'LINE22'.length + 1 }]);
    expect(fake.asked).toBe(0);
    expect(fake.messages[0]).toContain('15');
  });

  it('stops the last segment above the empty line a file that ends in a newline has', async () => {
    // The outline's last tool item runs to the document's last line (41), which the editor
    // shows empty after the final `%`: the selection ends on the `%`, line 40.
    fake.items = [program, tool(5, 14, '1'), tool(15, 24, '2'), tool(25, 41, '1')];
    fake.lines = [...Array.from({ length: 40 }, (_v, i) => (i === 39 ? '%' : `LINE${i + 1}`)), ''];
    fake.cursor = 30;
    await run();
    expect(fake.selections).toEqual([{ startLineNumber: 25, startColumn: 1, endLineNumber: 40, endColumn: 2 }]);
    expect(fake.revealed).toEqual([[25, 40]]);
    expect(fake.messages[0]).toContain('40');
  });

  it('asks for the tool when the cursor is in the header, and selects what was chosen', async () => {
    fake.cursor = 2;
    fake.answer = { tool: '2' };
    await run();
    expect(fake.asked).toBe(1);
    expect(fake.selections).toHaveLength(1);
    expect((fake.selections[0] as { startLineNumber: number }).startLineNumber).toBe(15);
  });

  it('lists a tool once however it is written', async () => {
    // T5 written as `T5 M6`, `T05 M6` and (a lathe) `T0505`: one tool, one choice.
    fake.items = [program, tool(5, 14, '5'), tool(15, 24, '05'), tool(25, 30, 'T5'), tool(31, 40, '6')];
    fake.cursor = 2;
    await run();
    expect(fake.choices.map((c) => c.value)).toEqual(['5', '6']);
    expect(fake.choices[0].label).toContain('5');
  });

  it('selects nothing when the question is cancelled', async () => {
    fake.cursor = 2;
    await run();
    expect(fake.selections).toEqual([]);
  });

  it('takes the tool number from the argument, the first segment after the cursor', async () => {
    fake.cursor = 10;
    await run({ tool: 1 });
    expect(fake.asked).toBe(0);
    expect((fake.selections[0] as { startLineNumber: number; endLineNumber: number }).startLineNumber).toBe(25);
    expect(fake.messages[0]).toContain('2');
  });

  it('says so when the program never changes to that tool', async () => {
    await run('9');
    expect(fake.selections).toEqual([]);
    expect(fake.messages).toHaveLength(1);
  });

  it('says so when the program has no tool changes', async () => {
    fake.items = [program];
    await run();
    expect(fake.selections).toEqual([]);
    expect(fake.messages).toHaveLength(1);
  });
});

describe('against the real program map', () => {
  it('selects from the tool change to the line before the next one, on a Fanuc program', async () => {
    const { OutlineIndex } = await import('$lib/core/profiles/outline');
    const { compileProfile } = await import('$lib/core/profiles/compile');
    const { BUILTIN_PROFILE_JSON } = await import('$lib/data/profiles');
    const raw = BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === 'fanuc-gcode');
    const cp = compileProfile(raw as never);
    const program = ['O1001', '(HEADER)', 'T1 M6', 'G1 X1', 'G1 X2', 'T2 M6', 'G1 X3', 'T1 M6', 'G1 X4', 'M30', '%'];
    const index = new OutlineIndex(cp);
    index.applyChange(1, 0, program);
    const items = index.items();
    expect(segmentAt(items, 4)?.tool).toBe('1');
    expect(boundsOf(segmentAt(items, 4) as OutlineItem)).toEqual({ first: 3, last: 5 });
    expect(boundsOf(segmentAt(items, 7) as OutlineItem)).toEqual({ first: 6, last: 7 });
    // The last segment runs to the end of the program, the program end included.
    expect(boundsOf(segmentAt(items, 9) as OutlineItem)).toEqual({ first: 8, last: 11 });
    expect(segmentAt(items, 2)).toBeNull();
    expect(segmentsOf(items, '1').map((i) => i.line)).toEqual([3, 8]);
  });

  it('counts the empty last line of a file that ends in a newline in the last segment, and the command leaves it out', async () => {
    const { OutlineIndex } = await import('$lib/core/profiles/outline');
    const { compileProfile } = await import('$lib/core/profiles/compile');
    const { BUILTIN_PROFILE_JSON } = await import('$lib/data/profiles');
    const raw = BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === 'fanuc-gcode');
    // What the editor holds for `...%\r\n`: the program's 11 lines and an empty 12th.
    const program = ['O1001', '(HEADER)', 'T1 M6', 'G1 X1', 'G1 X2', 'T2 M6', 'G1 X3', 'T1 M6', 'G1 X4', 'M30', '%', ''];
    const index = new OutlineIndex(compileProfile(raw as never));
    index.applyChange(1, 0, program);
    const items = index.items();
    const last = segmentsOf(items, '1')[1];
    expect(boundsOf(last)).toEqual({ first: 8, last: 12 });
    fake.items = items;
    fake.lines = program;
    fake.selections = [];
    fake.cursor = 9;
    await (command.run as (c: unknown, a?: unknown) => unknown)({ activeDocId: 'd1' });
    expect(fake.selections).toEqual([{ startLineNumber: 8, startColumn: 1, endLineNumber: 11, endColumn: 2 }]);
  });
});
