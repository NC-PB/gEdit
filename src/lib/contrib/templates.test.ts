// The templates contribution (Phase 3 plan §5 P3.5, §6.7): one command per template id of the
// loaded databases, kept in step with the service; the palette's quick pick; the Home tab's
// program-start button and the Insert tab's group.

import { readable, writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTemplates, templateCommandId, type TemplateDef } from '$lib/core/templates';
import { commands } from '$lib/app/registry/commands';
import { t } from '$lib/i18n';
import type { QuickPickItem, TemplateService } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  active: 'd1' as string | null,
  lists: {} as Record<string, import('$lib/core/templates').TemplateDef[]>,
  stars: [] as string[],
  inserted: [] as string[],
  picks: [] as { items: QuickPickItem<string>[]; placeholder?: string }[],
  pickAnswer: undefined as string | undefined,
  shown: [] as { text: string; error: boolean }[],
  changed: null as unknown,
}));

vi.mock('$lib/app/templateService', async (original) => {
  const actual = await original<typeof import('$lib/app/templateService')>();
  return {
    ...actual,
    templates: {
      list: (id: string) => fake.lists[id] ?? [],
      dialectOf: (id: string) => (fake.lists[id] ? 'demo' : null),
      favorites: () => fake.stars,
      setFavorite: () => {},
      render: () => ({ ok: false, errors: {} }),
      insert: async (id: string) => {
        fake.inserted.push(id);
        return true;
      },
      get changed() {
        return fake.changed as TemplateService['changed'];
      },
    } satisfies TemplateService,
  };
});
vi.mock('$lib/app/modals', () => ({
  modals: {
    quickPick: async (items: QuickPickItem<string>[], o?: { placeholder?: string }) => {
      fake.picks.push({ items, placeholder: o?.placeholder });
      return fake.pickAnswer;
    },
  },
}));
vi.mock('$lib/app/status', () => ({
  status: { show: (text: string, o?: { error?: boolean }) => fake.shown.push({ text, error: o?.error === true }) },
}));
vi.mock('$lib/components/shell/TemplatesGroup.svelte', () => ({ default: {} }));

const { default: contrib, keepCommandsInStep, loadedTemplateIds, pickAndInsert, pickItems } = await import('./templates');
const { templates } = await import('$lib/app/templateService');

const defs = (raw: unknown[]): TemplateDef[] => loadTemplates(raw);

beforeEach(() => {
  fake.active = 'd1';
  fake.lists = {};
  fake.stars = [];
  fake.inserted = [];
  fake.picks = [];
  fake.pickAnswer = undefined;
  fake.shown = [];
  fake.changed = readable(0);
});

describe('the templates contribution', () => {
  it('declares templates.insert without a key, the Home tab’s program-start button and the Insert tab’s group', () => {
    const insert = contrib.commands.find((c) => c.id === 'templates.insert')!;
    expect(insert.title).toBe('templates.insert');
    expect(insert.category).toBe('templates.category');
    expect((insert as { keys?: unknown }).keys).toBeUndefined();
    expect(contrib.ribbon).toEqual([{ tab: 'home', group: 'templates.groupProgram', command: 'insert.template:program-start', order: 20 }]);
    expect(contrib.ribbonGroups).toEqual([{ tab: 'insert', group: 'templates.groupTemplates', order: 10, component: expect.anything() }]);
    // No command is spelled out: the ids come from the databases.
    expect(contrib.commands.map((c) => c.id)).toEqual(['templates.insert']);
  });

  it('knows the template ids of every loaded database', () => {
    const ids = loadedTemplateIds();
    for (const id of ['program-start', 'program-end', 'tool-start', 'tapping', 'stop', 'stock-removal']) expect(ids.has(id), id).toBe(true);
    expect(ids.get('program-start')).toBe('Program start');
  });
});

describe('one command per template id', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it('registers the ids of the loaded databases, runs the template, and is enabled where the active program offers it', async () => {
    fake.lists.d1 = defs([{ id: 'drill', label: 'Drilling (G81)', group: 'Drilling', body: 'x' }]);
    dispose = keepCommandsInStep(templates, () => new Map([['drill', 'Drilling (G81)'], ['other', 'Other']]));
    const drill = commands.get(templateCommandId('drill'))!;
    expect(drill.title).toBe('Drilling (G81)');
    expect(drill.category).toBe('templates.category');
    expect(commands.has(templateCommandId('other'))).toBe(true);
    expect(drill.enabled?.({ activeDocId: 'd1' } as never)).toBe(true);
    expect(commands.get(templateCommandId('other'))!.enabled?.({ activeDocId: 'd1' } as never)).toBe(false);
    expect(drill.enabled?.({ activeDocId: null } as never)).toBe(false);
    expect(drill.enabled?.({ activeDocId: 'unknown' } as never)).toBe(false);
    await drill.run({} as never);
    expect(fake.inserted).toEqual(['drill']);
  });

  it('registers again when the ids or a label change, and unregisters everything when it is disposed', () => {
    const bump = writable(0);
    fake.changed = { subscribe: bump.subscribe };
    let ids = new Map([['a', 'A'], ['b', 'B']]);
    const stop = keepCommandsInStep(templates, () => ids);
    expect(commands.has('insert.template:a') && commands.has('insert.template:b')).toBe(true);
    const before = commands.get('insert.template:a');

    ids = new Map([['a', 'A2'], ['c', 'C']]);
    bump.update((n) => n + 1);
    expect(commands.has('insert.template:b')).toBe(false);
    expect(commands.has('insert.template:c')).toBe(true);
    expect(commands.get('insert.template:a')!.title).toBe('A2');
    expect(commands.get('insert.template:a')).not.toBe(before);

    stop();
    expect(commands.list().filter((c) => c.id.startsWith('insert.template:'))).toEqual([]);
  });
});

describe('the quick pick', () => {
  const list = defs([
    { id: 'a1', label: 'Program start', group: 'Program', body: 'x', review: 'pending' },
    { id: 'b1', label: 'Drilling (G81)', group: 'Drilling', description: 'A hole.', body: 'x' },
    { id: 'a2', label: 'Program end', group: 'Program', body: 'x' },
    { id: 'c1', label: 'Tapping', group: 'Tapping', body: 'x' },
  ]);

  it('lists the favourites first, then the groups in order, each template once', () => {
    fake.lists.d1 = list;
    fake.stars = ['c1', 'gone'];
    const items = pickItems(templates, 'd1');
    expect(items.map((i) => i.value)).toEqual(['c1', 'a1', 'a2', 'b1']);
    expect(items[0].description).toBe(`${t('templates.favorites')} · Tapping`);
    expect(items[1]).toMatchObject({ label: 'Program start', description: 'Program', detail: t('templates.reviewPendingShort') });
    expect(items[3]).toMatchObject({ label: 'Drilling (G81)', description: 'Drilling', detail: 'A hole.' });
  });

  it('inserts the template that was chosen', async () => {
    fake.lists.d1 = list;
    fake.pickAnswer = 'b1';
    await pickAndInsert('d1');
    expect(fake.picks[0].placeholder).toBe(t('templates.pickPlaceholder'));
    expect(fake.inserted).toEqual(['b1']);
  });

  it('inserts nothing when it is dismissed, and says so when there is no program or no template', async () => {
    fake.lists.d1 = list;
    fake.pickAnswer = undefined;
    await pickAndInsert('d1');
    expect(fake.inserted).toEqual([]);
    await pickAndInsert(null);
    expect(fake.shown.pop()).toEqual({ text: t('templates.noDocument'), error: true });
    await pickAndInsert('d2');
    expect(fake.shown.pop()).toEqual({ text: t('templates.none'), error: true });
  });
});
