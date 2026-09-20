// The shortcut table (plan §5 WP2.4). `shortcutRows` and `groupRows` are pure, so the
// ordering, the platform labels and the grouping are covered without a DOM. The markup is
// rendered with `svelte/server`, which needs no DOM either; filtering and the keyboard are
// covered by the M2 runtime scenarios.

import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import ShortcutsDialog, { groupRows, shortcutRows, type ShortcutRow } from './ShortcutsDialog.svelte';
import { commands } from '$lib/app/registry/commands';
import type { CommandDef, Disposable } from '$lib/app/types';

function def(over: Partial<CommandDef> & { id: string }): CommandDef {
  return { title: `t.${over.id}`, run: () => {}, ...over };
}

function row(id: string, category?: string): ShortcutRow {
  return category === undefined ? { id, title: `t.${id}` } : { id, title: `t.${id}`, category };
}

describe('shortcutRows', () => {
  it('keeps the i18n keys and formats the shortcut for the platform', () => {
    const defs = [def({ id: 'file.save', title: 'files.save', category: 'files.category', keys: 'Mod+S' })];
    expect(shortcutRows(defs, true)).toEqual([
      { id: 'file.save', title: 'files.save', category: 'files.category', keys: '⌘S' },
    ]);
    expect(shortcutRows(defs, false)).toEqual([
      { id: 'file.save', title: 'files.save', category: 'files.category', keys: 'Ctrl+S' },
    ]);
  });

  it('takes the spec of this platform and leaves the other one out', () => {
    const defs = [def({ id: 'a', keys: { mac: 'Mod+Alt+S' } }), def({ id: 'b', keys: { other: 'Ctrl+Alt+S' } })];
    expect(shortcutRows(defs, true).map((r) => r.keys)).toEqual(['⌥⌘S', undefined]);
    expect(shortcutRows(defs, false).map((r) => r.keys)).toEqual([undefined, 'Ctrl+Alt+S']);
  });

  it('lists a command without a shortcut, and one whose spec does not parse', () => {
    const rows = shortcutRows([def({ id: 'a' }), def({ id: 'b', keys: 'Mod+Nonsense' })], false);
    expect(rows.map((r) => r.keys)).toEqual([undefined, undefined]);
  });

  it('sorts by category key and then by command id, with the uncategorized commands last', () => {
    const defs = [
      def({ id: 'view.b', category: 'view.category' }),
      def({ id: 'loose' }),
      def({ id: 'file.b', category: 'files.category' }),
      def({ id: 'file.a', category: 'files.category' }),
      def({ id: 'view.a', category: 'view.category' }),
    ];
    expect(shortcutRows(defs, false).map((r) => r.id)).toEqual([
      'file.a',
      'file.b',
      'view.a',
      'view.b',
      'loose',
    ]);
  });

  it('does not invent a category for a command without one', () => {
    const [first] = shortcutRows([def({ id: 'a' })], false);
    expect(Object.prototype.hasOwnProperty.call(first, 'category')).toBe(false);
  });

  it('leaves its input alone', () => {
    const defs = [def({ id: 'b' }), def({ id: 'a' })];
    shortcutRows(defs, false);
    expect(defs.map((d) => d.id)).toEqual(['b', 'a']);
  });
});

describe('groupRows', () => {
  /** Two different category keys, one shared heading - exactly what the real catalog has. */
  const labelOf = (r: ShortcutRow): string => {
    if (!r.category) return 'Other';
    return r.category === 'core.categoryView' || r.category === 'view.category' ? 'View' : 'Files';
  };

  it('merges two category keys that carry the same label', () => {
    const groups = groupRows(
      [row('a', 'core.categoryView'), row('b', 'files.category'), row('c', 'view.category')],
      labelOf,
    );
    expect(groups.map((g) => g.label)).toEqual(['Files', 'View']);
    expect(groups[1].rows.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('sorts the headings and keeps the row order inside a group', () => {
    const groups = groupRows([row('v1', 'view.category'), row('f1', 'files.category'), row('v2', 'view.category')], labelOf);
    expect(groups.map((g) => g.label)).toEqual(['Files', 'View']);
    expect(groups[1].rows.map((r) => r.id)).toEqual(['v1', 'v2']);
  });

  it('puts the group of the uncategorized commands last, whatever its heading is', () => {
    const groups = groupRows([row('z', 'files.category'), row('a')], (r) => (r.category ? 'Zulu' : 'Alpha'));
    expect(groups.map((g) => g.label)).toEqual(['Zulu', 'Alpha']);
  });

  it('returns nothing for no rows', () => {
    expect(groupRows([], () => 'x')).toEqual([]);
  });
});

describe('ShortcutsDialog markup', () => {
  let registered: Disposable | undefined;

  afterEach(() => {
    registered?.();
    registered = undefined;
  });

  function markup(): string {
    return render(ShortcutsDialog, { props: { close: () => {} } }).body;
  }

  it('is a modal the harness can find by name, with Close and no confirm button', () => {
    const html = markup();
    expect(html).toContain('data-modal="shortcuts"');
    expect(html).toContain('data-testid="modal-cancel"');
    expect(html).not.toContain('data-testid="modal-ok"');
    expect(html).toContain('data-testid="shortcuts-filter"');
  });

  it('shows one row per registered command, with its heading and its keys', () => {
    registered = commands.register([
      def({ id: 'help.about', title: 'help.about', category: 'help.category' }),
      def({ id: 'help.shortcuts', title: 'help.shortcuts', category: 'help.category', keys: 'Mod+K' }),
    ]);
    const html = markup();
    expect(html.match(/data-testid="shortcuts-row"/g)).toHaveLength(2);
    expect(html).toContain('data-command="help.about"');
    expect(html).toContain('data-group="Help"');
    expect(html).toContain('Keyboard Shortcuts');
    expect(html).toMatch(/data-command="help\.shortcuts"[^>]*data-keys="(⌘K|Ctrl\+K)"/);
    expect(html).not.toContain('data-testid="shortcuts-empty"');
  });

  it('says so when no command is registered', () => {
    expect(markup()).toContain('data-testid="shortcuts-empty"');
  });
});
