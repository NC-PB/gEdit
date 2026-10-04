// What the NC "Block Skip" contribution declares (plan §6 M10, WP10.1, §7.13): the two ids,
// no default key, a ribbon group on the NC tab, a message for every key, and that each
// command runs its own transform and nothing else.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandDef } from '$lib/app/types';
import type { TransformDef } from '$lib/core/transforms/types';

const fake = vi.hoisted(() => ({ ran: [] as string[] }));

vi.mock('$lib/app/transforms', () => ({
  transforms: {
    run: (def: TransformDef): Promise<null> => {
      fake.ran.push(def.id);
      return Promise.resolve(null);
    },
  },
}));

const ncBlockSkip = (await import('./ncBlockSkip')).default;
const { hasKey } = await import('$lib/i18n');

const byId = new Map<string, CommandDef>((ncBlockSkip.commands ?? []).map((def) => [def.id, def]));

describe('the block skip commands', () => {
  beforeEach(() => {
    fake.ran = [];
  });

  it('are the two of plan §7.13, with no shortcut', () => {
    expect([...byId.keys()]).toEqual(['nc.blockSkip.add', 'nc.blockSkip.remove']);
    for (const def of byId.values()) expect(def.keys, def.id).toBeUndefined();
  });

  it('need a document, and have a message for every title and category', () => {
    for (const def of byId.values()) {
      expect(def.enabled?.({ activeDocId: null } as never), def.id).toBe(false);
      expect(def.enabled?.({ activeDocId: 'd1' } as never), def.id).toBe(true);
      expect(hasKey(def.title), def.title).toBe(true);
      expect(def.category !== undefined && hasKey(def.category), def.id).toBe(true);
    }
  });

  it('sit in one ribbon group on the NC tab', () => {
    const items = ncBlockSkip.ribbon ?? [];
    expect(items.map((item) => item.command)).toEqual(['nc.blockSkip.add', 'nc.blockSkip.remove']);
    for (const item of items) {
      expect(item.tab).toBe('nc');
      expect(item.group).toBe('ncBlockSkip.group');
    }
    expect(hasKey('ncBlockSkip.group')).toBe(true);
  });

  it('each run its own transform', async () => {
    await byId.get('nc.blockSkip.add')?.run({ activeDocId: 'd1' } as never);
    await byId.get('nc.blockSkip.remove')?.run({ activeDocId: 'd1' } as never);
    expect(fake.ran).toEqual(['block-skip-add', 'block-skip-remove']);
  });
});
