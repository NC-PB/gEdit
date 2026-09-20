// What the NC "Cleanup" contribution declares, and the one piece of logic it owns
// (plan §5 WP4.3, §7.1).
//
// The commands are declarations, so the test is about the contract they make with the
// rest of the app: stable ids, a message for every key they name, a ribbon group in the
// NC tab, and no shortcut (plan §7.11 assigns none to this group, and a key nobody listed
// would be a conflict the registry reports as a `console.error`, which the runtime
// harness turns into a failed scenario).
//
// The logic is the Klartext follow-up: a transform that removed lines from a program with
// consecutive block numbers carries `ncCleanup.renumberNeeded`, and the user is asked
// before `nc.renumber` runs. Until WP4.2 lands that command does not exist, so the offer
// has to stay quiet rather than ask a question it cannot answer.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandDef, Msg } from '$lib/app/types';
import type { TransformResult } from '$lib/core/transforms/types';

const fake = vi.hoisted(() => ({
  result: null as TransformResult | null,
  registered: new Set<string>(),
  confirmAnswer: true,
  confirmed: [] as string[],
  ran: [] as string[],
}));

vi.mock('$lib/app/transforms', () => ({
  transforms: { run: (): Promise<TransformResult | null> => Promise.resolve(fake.result) },
}));
vi.mock('$lib/app/dialogs', () => ({
  dialogs: {
    confirm: (o: { title: string }): Promise<boolean> => {
      fake.confirmed.push(o.title);
      return Promise.resolve(fake.confirmAnswer);
    },
  },
}));
vi.mock('$lib/app/registry/commands', () => ({
  commands: {
    has: (id: string): boolean => fake.registered.has(id),
    run: (id: string): Promise<boolean> => {
      fake.ran.push(id);
      return Promise.resolve(true);
    },
  },
}));

const ncCleanup = (await import('./ncCleanup')).default;
const { hasKey } = await import('$lib/i18n');

const IDS = ['nc.insertSpaces', 'nc.removeSpaces', 'nc.removeEmptyLines', 'nc.removeComments', 'nc.convertCase'];
const byId = new Map<string, CommandDef>((ncCleanup.commands ?? []).map((def) => [def.id, def]));

function resultWith(warnings: Msg[]): TransformResult {
  return { lines: [], summary: { key: 'ncCleanup.removeEmptyLines.summaryNone' }, skipped: [], warnings };
}

describe('commands', () => {
  it('registers the five cleanup transforms', () => {
    expect([...byId.keys()]).toEqual(IDS);
  });

  it('claims no shortcut, because plan §7.11 assigns none to this group', () => {
    for (const def of byId.values()) expect(def.keys, def.id).toBeUndefined();
  });

  it('needs a document and has an icon', () => {
    for (const def of byId.values()) {
      expect(def.enabled?.({ activeDocId: null } as never), def.id).toBe(false);
      expect(def.enabled?.({ activeDocId: 'd1' } as never), def.id).toBe(true);
      expect(def.icon, def.id).toBeDefined();
    }
  });

  it('has a message for every title and category it names', () => {
    for (const def of byId.values()) {
      expect(hasKey(def.title), def.title).toBe(true);
      expect(def.category !== undefined && hasKey(def.category), def.id).toBe(true);
    }
  });
});

describe('the ribbon group', () => {
  it('puts one button per command into the NC tab', () => {
    expect(ncCleanup.ribbon?.map((item) => item.command)).toEqual(IDS);
    for (const item of ncCleanup.ribbon ?? []) {
      expect(item.tab).toBe('nc');
      expect(item.group).toBe('ncCleanup.group');
    }
  });

  it('names a group caption that has a message, and orders the buttons', () => {
    expect(hasKey('ncCleanup.group')).toBe(true);
    const orders = (ncCleanup.ribbon ?? []).map((item) => item.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('the renumber offer after a run that removed lines', () => {
  beforeEach(() => {
    fake.result = null;
    fake.registered = new Set(['nc.renumber']);
    fake.confirmAnswer = true;
    fake.confirmed = [];
    fake.ran = [];
  });

  const removeEmptyLines = (): CommandDef => byId.get('nc.removeEmptyLines') as CommandDef;

  it('asks, and renumbers when the answer is yes', async () => {
    fake.result = resultWith([{ key: 'ncCleanup.renumberNeeded' }]);
    await removeEmptyLines().run({ activeDocId: 'd1' } as never);
    expect(fake.confirmed).toHaveLength(1);
    expect(fake.ran).toEqual(['nc.renumber']);
  });

  it('leaves the program alone when the answer is no', async () => {
    fake.result = resultWith([{ key: 'ncCleanup.renumberNeeded' }]);
    fake.confirmAnswer = false;
    await removeEmptyLines().run({ activeDocId: 'd1' } as never);
    expect(fake.confirmed).toHaveLength(1);
    expect(fake.ran).toEqual([]);
  });

  it('says nothing when the numbering was not broken', async () => {
    fake.result = resultWith([]);
    await removeEmptyLines().run({ activeDocId: 'd1' } as never);
    expect(fake.confirmed).toEqual([]);
    expect(fake.ran).toEqual([]);
  });

  it('says nothing when the transform did not run', async () => {
    fake.result = null;
    await removeEmptyLines().run({ activeDocId: 'd1' } as never);
    expect(fake.confirmed).toEqual([]);
  });

  it('stays quiet while nc.renumber is not registered', async () => {
    fake.result = resultWith([{ key: 'ncCleanup.renumberNeeded' }]);
    fake.registered = new Set();
    await removeEmptyLines().run({ activeDocId: 'd1' } as never);
    expect(fake.confirmed).toEqual([]);
    expect(fake.ran).toEqual([]);
  });

  it('has a message for every string the offer shows', () => {
    for (const key of ['ncCleanup.renumberNeeded', 'ncCleanup.renumberTitle', 'ncCleanup.renumberMessage', 'ncCleanup.renumberOk']) {
      expect(hasKey(key), key).toBe(true);
    }
  });
});
