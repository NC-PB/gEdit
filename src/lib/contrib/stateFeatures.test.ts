// What the three WP2.3 contributions declare, and the markup of the two components they
// bring (plan §5 WP2.3, §7.9, §7.11).
//
// The command ids, the banner's `data-action` values and the panel region are contracts
// with the runtime harness: renaming one breaks scenarios in `tests/runtime/`, and a
// shortcut that §7.11 does not list would be a key conflict at startup. The same
// reasoning as `fileFeatures.test.ts` (WP1.6).
//
// The components are rendered with `svelte/server`, so there is no DOM, no `onMount` and
// no Monaco. `stores/recent.ts` is replaced by a store this file can fill, because the
// real one has no setter on purpose — Rust owns the list.

import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentEntry } from '$lib/platform/commands';
import type { CommandContext, CommandDef, Contribution, DocId } from '$lib/app/types';

/** A minimal readable store the mock below hands out, and this file writes to. */
const entries = vi.hoisted(() => {
  const subscribers = new Set<(value: unknown) => void>();
  let value: unknown[] = [];
  return {
    set(next: unknown[]): void {
      value = next;
      for (const run of subscribers) run(next);
    },
    /** `recent_list` through the store; a test programs what a re-read finds. */
    refresh: vi.fn(async (): Promise<void> => {}),
    store: {
      subscribe(run: (value: unknown) => void) {
        subscribers.add(run);
        run(value);
        return (): void => void subscribers.delete(run);
      },
    },
  };
});

vi.mock('$lib/stores/recent', () => ({
  recent: {
    list: entries.store,
    refresh: entries.refresh,
    touch: async (): Promise<void> => {},
    remove: async (): Promise<void> => {},
    clear: async (): Promise<void> => {},
  },
}));

const externalChange = (await import('./externalChange')).default;
const { default: layoutPersist, persistable } = await import('./layoutPersist');
const recentContrib = (await import('./recent')).default;
const ExternalChangeBanner = (await import('$lib/components/editor/ExternalChangeBanner.svelte')).default;
const RecentMenu = (await import('$lib/components/menus/RecentMenu.svelte')).default;
const { commands } = await import('$lib/app/registry/commands');
const { dialogs } = await import('$lib/app/dialogs');
const { files } = await import('$lib/app/fileOps');
const { docs } = await import('$lib/stores/documents');
const { hasKey } = await import('$lib/i18n');

const all: Contribution[] = [externalChange, layoutPersist, recentContrib];

const CONTEXT: CommandContext = {
  activeDocId: 'd1',
  profileId: 'fanuc-gcode',
  hasSelection: false,
  editorFocused: true,
  compareOpen: false,
  modalOpen: false,
  scriptRunning: false,
};

function commandsOf(c: Contribution): CommandDef[] {
  return c.commands ?? [];
}

function setEntries(list: RecentEntry[]): void {
  entries.set(list);
}

beforeEach(() => {
  setEntries([]);
  entries.refresh.mockReset();
  entries.refresh.mockImplementation(async () => {});
});

describe('commands', () => {
  it('registers exactly the two recent-file commands, and no shortcut', () => {
    expect(commandsOf(recentContrib).map((def) => [def.id, def.keys ?? null])).toEqual([
      ['file.openRecent', null],
      ['file.clearRecent', null],
    ]);
  });

  it('gives the other two contributions no commands at all', () => {
    expect(commandsOf(externalChange)).toEqual([]);
    expect(commandsOf(layoutPersist)).toEqual([]);
  });

  it('makes every command reachable from outside the editor', () => {
    for (const def of all.flatMap(commandsOf)) expect(def.global).toBe(true);
  });

  it('enables Clear only while there is something to clear', () => {
    const clear = commandsOf(recentContrib).find((def) => def.id === 'file.clearRecent');
    expect(clear?.enabled?.(CONTEXT)).toBe(false);
    setEntries([{ path: '/nc/a.nc', exists: true }]);
    expect(clear?.enabled?.(CONTEXT)).toBe(true);
  });

  it('leaves Open Recent enabled, so the picker can say the list is empty', () => {
    const open = commandsOf(recentContrib).find((def) => def.id === 'file.openRecent');
    expect(open?.enabled).toBeUndefined();
  });
});

describe('file.openRecent', () => {
  function openRecent(arg?: string): Promise<unknown> {
    const def = commandsOf(recentContrib).find((d) => d.id === 'file.openRecent');
    if (!def) throw new Error('file.openRecent is not registered');
    return Promise.resolve(def.run(CONTEXT, arg));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-reads the list before it decides, and offers to drop an entry that went away', async () => {
    // G8 M2: `exists` used to be whatever the startup read found, so a file deleted while
    // the app ran was opened and failed with the generic "could not be opened" dialog
    // instead of being offered for removal.
    setEntries([{ path: '/nc/a.nc', exists: true }]);
    entries.refresh.mockImplementation(async () => setEntries([{ path: '/nc/a.nc', exists: false }]));
    const confirm = vi.spyOn(dialogs, 'confirm').mockResolvedValue(false);
    const open = vi.spyOn(files, 'open').mockResolvedValue([]);

    await openRecent('/nc/a.nc');

    expect(entries.refresh).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens an entry that is still there', async () => {
    setEntries([{ path: '/nc/a.nc', exists: true }]);
    const confirm = vi.spyOn(dialogs, 'confirm').mockResolvedValue(false);
    const open = vi.spyOn(files, 'open').mockResolvedValue([]);

    await openRecent('/nc/a.nc');

    expect(entries.refresh).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(['/nc/a.nc']);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('says the list is empty rather than opening a picker with nothing in it', async () => {
    const open = vi.spyOn(files, 'open').mockResolvedValue([]);
    await openRecent();
    expect(entries.refresh).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('i18n', () => {
  it('every command title and category has a message', () => {
    const missing = all
      .flatMap(commandsOf)
      .flatMap((def) => [def.title, def.category])
      .filter((key): key is string => typeof key === 'string')
      .filter((key) => !hasKey(key));
    expect(missing).toEqual([]);
  });

  it('every ribbon group and panel title has a message', () => {
    const keys = [
      ...all.flatMap((c) => c.ribbonGroups ?? []).map((g) => g.group),
      ...all.flatMap((c) => c.panels ?? []).map((p) => p.title),
    ];
    expect(keys.filter((key) => !hasKey(key))).toEqual([]);
  });
});

describe('layoutPersist', () => {
  it('remembers the two docked regions and not the overlay (a comparison is a mode)', () => {
    expect(
      persistable({
        left: { visible: true, width: 300, active: 'programMap' },
        bottom: { visible: false, height: 200, active: 'output' },
        overlay: 'compare',
      }),
    ).toEqual({
      left: { visible: true, width: 300, active: 'programMap' },
      bottom: { visible: false, height: 200, active: 'output' },
    });
  });
});

describe('where the features sit', () => {
  it('puts the Recent dropdown in the Home tab, after the File group', () => {
    expect(recentContrib.ribbonGroups).toEqual([
      { tab: 'home', group: 'recent.groupRecent', order: 15, component: RecentMenu },
    ]);
  });

  it('puts the external-change banner in the banner region (AD-10)', () => {
    expect(externalChange.panels).toHaveLength(1);
    const panel = externalChange.panels?.[0];
    expect(panel?.region).toBe('banner');
    expect(panel?.component).toBe(ExternalChangeBanner);
  });

  it('gives every contribution an id that matches its file name', () => {
    expect(all.map((c) => c.id)).toEqual(['externalChange', 'layoutPersist', 'recent']);
  });

  it('claims no command id twice', () => {
    const ids = all.flatMap(commandsOf).map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// The markup contracts of §7.9
// ---------------------------------------------------------------------------

function addDoc(external: 'none' | 'changed' | 'deleted'): DocId {
  return docs.add({
    path: '/nc/prog.nc',
    untitledIndex: null,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'crlf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external,
  });
}

afterEach(() => {
  for (const doc of docs.all()) docs.remove(doc.id);
});

describe('ExternalChangeBanner', () => {
  it('shows nothing while no document carries an external change', () => {
    addDoc('none');
    expect(render(ExternalChangeBanner).body).not.toContain('data-testid="external-banner"');
  });

  it('carries the §7.9 test ids and the Reload / Keep actions for a changed file', () => {
    const id = addDoc('changed');
    const html = render(ExternalChangeBanner).body;
    expect(html).toContain('data-testid="external-banner"');
    expect(html).toContain(`data-doc-id="${id}"`);
    expect(html).toContain('data-external="changed"');
    expect(html).toContain('data-action="reload"');
    expect(html).toContain('data-action="keep"');
    expect(html).toContain('prog.nc');
  });

  it('offers only Keep for a file that is gone (AD-10)', () => {
    addDoc('deleted');
    const html = render(ExternalChangeBanner).body;
    expect(html).toContain('data-external="deleted"');
    expect(html).toContain('data-action="keep"');
    expect(html).not.toContain('data-action="reload"');
    expect(html).not.toContain('data-action="compare"');
  });

  it('shows Compare only once WP2.5 has registered `compare.withSaved`', () => {
    addDoc('changed');
    expect(render(ExternalChangeBanner).body).not.toContain('data-action="compare"');
    const off = commands.register({ id: 'compare.withSaved', title: 'common.close', run: () => {} });
    expect(render(ExternalChangeBanner).body).toContain('data-action="compare"');
    off();
  });
});

describe('RecentMenu', () => {
  it('is disabled and holds only its placeholder while the list is empty', () => {
    const html = render(RecentMenu).body;
    expect(html).toContain('data-testid="recent-menu"');
    expect(html).toContain('disabled');
    expect(html).not.toContain('Clear recent files');
  });

  it('lists every entry by path, marks the ones that are gone, and ends with Clear', () => {
    setEntries([
      { path: '/nc/a.nc', exists: true },
      { path: '/nc/gone.nc', exists: false },
    ]);
    const html = render(RecentMenu).body;
    expect(html).toContain('value="/nc/a.nc"');
    expect(html).toContain('title="/nc/gone.nc"');
    // File names are data and stay untranslated (AD-14); only the marker is a message.
    expect(html).toContain('a.nc');
    expect(html).toContain('gone.nc (not found)');
    expect(html).toContain('Clear recent files');
  });
});
