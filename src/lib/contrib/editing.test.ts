// What the editing contribution declares (plan §5 WP4.4).
//
// Three things are worth a test and none of them is visible by reading the ribbon:
//
//  - **No shortcut anywhere.** Monaco already binds all of these; a `keys` here would be
//    a conflict the registry reports as a `console.error`, which fails the harness.
//  - **The palette rule.** `palette: false` on everything F1 already lists, and exactly
//    the three plain commands (`undo`, `redo`, `editor.action.selectAll`) left in it.
//  - **Focus before trigger.** Clicking a ribbon button moves focus out of Monaco, and
//    `undo`, `redo` and select-all resolve through the *focused* editor.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandDef, RibbonItemDef } from '$lib/app/types';
import type { Settings } from '$lib/core/settings/schema';

const fake = vi.hoisted(() => ({
  trace: [] as string[],
  messages: [] as string[],
  saved: [] as Partial<Settings>[],
  values: {
    'editor.renderWhitespace': 'none',
    'editor.wordWrap': false,
    'editor.minimap': false,
    'editor.stickyScroll': true,
  } as Record<string, unknown>,
  reset(): void {
    fake.trace = [];
    fake.messages = [];
    fake.saved = [];
    fake.values = {
      'editor.renderWhitespace': 'none',
      'editor.wordWrap': false,
      'editor.minimap': false,
      'editor.stickyScroll': true,
    };
  },
}));

vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    focus: () => fake.trace.push('focus'),
    triggerAction: (id: string) => fake.trace.push(id),
  },
}));
vi.mock('$lib/stores/settings', () => ({
  settings: {
    get: (key: string): unknown => fake.values[key],
    save: async (patch: Partial<Settings>): Promise<void> => {
      fake.saved.push(patch);
      Object.assign(fake.values, patch);
    },
  },
}));
vi.mock('$lib/app/status', () => ({ status: { show: (text: string) => fake.messages.push(text) } }));

const editing = (await import('./editing')).default;
const { hasKey } = await import('$lib/i18n');

const defs: CommandDef[] = editing.commands ?? [];
const byId = new Map<string, CommandDef>(defs.map((def) => [def.id, def]));
const items: RibbonItemDef[] = (editing.ribbon ?? []).filter(
  (entry): entry is RibbonItemDef => 'command' in entry,
);

const run = async (id: string): Promise<void> => {
  await byId.get(id)?.run({ activeDocId: 'd1' } as never);
};

beforeEach(() => {
  fake.reset();
});

describe('commands', () => {
  it('covers the Monaco features of plan §5 WP4.4', () => {
    expect([...byId.keys()]).toEqual([
      'edit.undo',
      'edit.redo',
      'edit.find',
      'edit.replace',
      'edit.toggleComment',
      'edit.duplicateLine',
      'edit.moveLineUp',
      'edit.moveLineDown',
      'edit.deleteLine',
      'edit.selectAll',
      'edit.upperCase',
      'edit.lowerCase',
      'view.foldAll',
      'view.unfoldAll',
      'view.quickOutline',
      'view.zoomIn',
      'view.zoomOut',
      'view.zoomReset',
      'view.toggleWhitespace',
      'view.toggleWordWrap',
      'view.toggleMinimap',
      'view.toggleStickyScroll',
    ]);
    expect(byId.size).toBe(defs.length);
  });

  it('claims no shortcut at all: every one of these keys is Monaco’s', () => {
    for (const def of defs) expect(def.keys, def.id).toBeUndefined();
  });

  it('keeps out of the palette wherever F1 already lists the Monaco action', () => {
    const inPalette = defs.filter((def) => def.palette !== false).map((def) => def.id);
    expect(inPalette.sort()).toEqual(
      [
        // Monaco `MultiCommand`s: the standalone palette lists editor *actions* only.
        'edit.redo',
        'edit.selectAll',
        'edit.undo',
        // Settings, not Monaco actions.
        'view.toggleMinimap',
        'view.toggleStickyScroll',
        'view.toggleWhitespace',
        'view.toggleWordWrap',
      ].sort(),
    );
  });

  it('has a message for every title and category it names', () => {
    for (const def of defs) {
      expect(hasKey(def.title), def.title).toBe(true);
      expect(def.category !== undefined && hasKey(def.category), def.id).toBe(true);
    }
  });

  it('files the View-tab commands under View, so F1 does not read "Edit: Fold All"', () => {
    for (const def of defs) {
      const wanted = def.id.startsWith('view.') ? 'editing.categoryView' : 'editing.category';
      expect(def.category, def.id).toBe(wanted);
    }
  });

  it('needs a document for the editor actions and not for the settings toggles', () => {
    for (const def of defs) {
      const needsDocument = def.id.startsWith('view.toggle') ? undefined : false;
      expect(def.enabled?.({ activeDocId: null } as never), def.id).toBe(needsDocument);
    }
  });
});

describe('the Monaco actions behind the buttons', () => {
  const expected: Record<string, string> = {
    'edit.undo': 'undo',
    'edit.redo': 'redo',
    'edit.find': 'actions.find',
    'edit.replace': 'editor.action.startFindReplaceAction',
    'edit.toggleComment': 'editor.action.commentLine',
    'edit.duplicateLine': 'editor.action.copyLinesDownAction',
    'edit.moveLineUp': 'editor.action.moveLinesUpAction',
    'edit.moveLineDown': 'editor.action.moveLinesDownAction',
    'edit.deleteLine': 'editor.action.deleteLines',
    'edit.selectAll': 'editor.action.selectAll',
    'edit.upperCase': 'editor.action.transformToUppercase',
    'edit.lowerCase': 'editor.action.transformToLowercase',
    'view.foldAll': 'editor.foldAll',
    'view.unfoldAll': 'editor.unfoldAll',
    'view.quickOutline': 'editor.action.quickOutline',
    'view.zoomIn': 'editor.action.fontZoomIn',
    'view.zoomOut': 'editor.action.fontZoomOut',
    'view.zoomReset': 'editor.action.fontZoomReset',
  };

  it('focuses the editor and then triggers the action', async () => {
    for (const [id, action] of Object.entries(expected)) {
      fake.reset();
      await run(id);
      expect(fake.trace, id).toEqual(['focus', action]);
    }
  });
});

describe('the display toggles', () => {
  it('turn whitespace on and off through the setting', async () => {
    await run('view.toggleWhitespace');
    expect(fake.saved).toEqual([{ 'editor.renderWhitespace': 'all' }]);
    expect(fake.messages).toEqual(['Whitespace is on.']);

    await run('view.toggleWhitespace');
    expect(fake.saved.at(-1)).toEqual({ 'editor.renderWhitespace': 'none' });
    expect(fake.messages.at(-1)).toBe('Whitespace is off.');
  });

  it('counts "boundary" as on, so the button turns it off', async () => {
    fake.values['editor.renderWhitespace'] = 'boundary';
    await run('view.toggleWhitespace');
    expect(fake.saved).toEqual([{ 'editor.renderWhitespace': 'none' }]);
  });

  it('flip the three boolean settings', async () => {
    await run('view.toggleWordWrap');
    await run('view.toggleMinimap');
    await run('view.toggleStickyScroll');
    expect(fake.saved).toEqual([
      { 'editor.wordWrap': true },
      { 'editor.minimap': true },
      { 'editor.stickyScroll': false },
    ]);
    expect(fake.messages).toEqual(['Word wrap is on.', 'Minimap is on.', 'Sticky scroll is off.']);
  });

  it('touches the editor only through the settings, never with updateOptions', async () => {
    await run('view.toggleMinimap');
    expect(fake.trace).toEqual([]);
  });
});

describe('the ribbon', () => {
  it('puts every command on a tab, and nothing that is not a command', () => {
    expect(items.map((item) => item.command).sort()).toEqual([...byId.keys()].sort());
  });

  it('groups them as the plan asks: Edit on Home, the rest on View', () => {
    const groups = new Map<string, { tab: string; commands: string[] }>();
    for (const item of items) {
      const group = groups.get(item.group) ?? { tab: item.tab, commands: [] };
      group.commands.push(item.command);
      groups.set(item.group, group);
    }
    expect([...groups].map(([key, g]) => [key, g.tab])).toEqual([
      ['editing.groupEdit', 'home'],
      ['editing.groupCode', 'view'],
      ['editing.groupDisplay', 'view'],
      ['editing.groupZoom', 'view'],
    ]);
    expect(groups.get('editing.groupCode')?.commands).toEqual([
      'view.foldAll',
      'view.unfoldAll',
      'view.quickOutline',
    ]);
  });

  it('has a message for every group caption', () => {
    for (const item of items) expect(hasKey(item.group), item.group).toBe(true);
  });

  it('orders the View groups behind the panels and ahead of Appearance, Settings and Help', () => {
    const order = (group: string): number =>
      Math.min(...items.filter((item) => item.group === group).map((item) => item.order));
    // `view.groupPanels` is 10-30, `theme.group` 90, `settings.group` 95, `help.group` 100.
    expect(order('editing.groupCode')).toBeGreaterThan(30);
    expect(order('editing.groupCode')).toBeLessThan(order('editing.groupDisplay'));
    expect(order('editing.groupDisplay')).toBeLessThan(order('editing.groupZoom'));
    expect(order('editing.groupZoom')).toBeLessThan(90);
    // Home: behind File (10-60), Recent (15) and Program (20).
    expect(order('editing.groupEdit')).toBeGreaterThan(60);
  });

  it('keeps the buttons of a group in the order they are declared', () => {
    const edit = items.filter((item) => item.group === 'editing.groupEdit');
    expect(edit.map((item) => item.order)).toEqual([...edit].sort((a, b) => a.order - b.order).map((i) => i.order));
    expect(new Set(edit.map((item) => item.order)).size).toBe(edit.length);
  });
});
