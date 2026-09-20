// What the three WP1.6 contributions declare (plan §5 WP1.6, §7.9, §7.11).
//
// The shortcuts and the status-item slots are a contract with the rest of the app: an id
// that drifts is a `console.error` from the command registry, which the runtime harness
// turns into a failed scenario, and a status item in the wrong slot moves the whole right
// side of the status bar. Both are cheaper to catch here.

import { describe, expect, it, vi } from 'vitest';
import encoding from './encoding';
import files, { dropHandler, openDropped, type DropDeps } from './files';
import profileSelect from './profileSelect';
import { dialogs } from '$lib/app/dialogs';
import { hasKey, t } from '$lib/i18n';
import type { CommandDef, Contribution } from '$lib/app/types';
import type { FileStat } from '$lib/platform/commands';

const all: Contribution[] = [encoding, files, profileSelect];

function commandsOf(c: Contribution): CommandDef[] {
  return c.commands ?? [];
}

describe('commands', () => {
  it('registers exactly the file commands of plan §7.11, with their shortcuts', () => {
    const byId = new Map(commandsOf(files).map((def) => [def.id, def]));
    expect([...byId.keys()]).toEqual([
      'file.new',
      'file.open',
      'file.save',
      'file.saveAs',
      'file.saveAll',
      'file.close',
      'file.closeAll',
      'file.closeWindow',
    ]);
    expect(
      Object.fromEntries([...byId].map(([id, def]) => [id, def.keys ?? null])),
    ).toEqual({
      'file.new': 'Mod+N',
      'file.open': 'Mod+O',
      'file.save': 'Mod+S',
      'file.saveAs': 'Mod+Shift+S',
      'file.saveAll': 'Mod+Alt+S',
      'file.close': 'Mod+W',
      'file.closeAll': null,
      // The macOS menu item carries no accelerator, so the webview owns this chord
      // (WP1.4 D-WP1.4-1).
      'file.closeWindow': 'Mod+Shift+W',
    });
  });

  it('gives the metadata commands no shortcut at all', () => {
    for (const def of [...commandsOf(encoding), ...commandsOf(profileSelect)]) {
      expect(def.keys).toBeUndefined();
    }
    expect(commandsOf(encoding).map((d) => d.id)).toEqual(['file.setEncoding', 'file.setEol']);
    expect(commandsOf(profileSelect).map((d) => d.id)).toEqual(['file.setProfile']);
  });

  it('makes every command reachable from outside the editor', () => {
    for (const def of all.flatMap(commandsOf)) expect(def.global).toBe(true);
  });

  it('claims no id twice across the three contributions', () => {
    const ids = all.flatMap(commandsOf).map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
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

  it('every ribbon group has a message', () => {
    const missing = (files.ribbon ?? []).map((item) => item.group).filter((key) => !hasKey(key));
    expect(missing).toEqual([]);
  });
});

describe('the ribbon', () => {
  it('puts the file commands in the Home tab, in one group, in order', () => {
    const items = files.ribbon ?? [];
    expect(items.every((item) => item.tab === 'home' && item.group === 'files.groupFile')).toBe(true);
    expect(items.map((item) => item.order)).toEqual([...items.map((item) => item.order)].sort((a, b) => a - b));
  });

  it('only shows commands this contribution registers', () => {
    const known = new Set(commandsOf(files).map((def) => def.id));
    for (const item of files.ribbon ?? []) expect(known.has(item.command)).toBe(true);
  });
});

describe('status items', () => {
  it('takes the left slot for the file name and 10/20/30 on the right (§7.9)', () => {
    const slots = all
      .flatMap((c) => c.statusItems ?? [])
      .map((item) => `${item.id}:${item.side}:${item.order}`)
      .sort();
    // `cursor:right:40` comes from WP1.2's contrib/cursor.ts and completes the row.
    expect(slots).toEqual(['encoding:right:20', 'eol:right:30', 'file:left:10', 'profile:right:10']);
  });

  it('gives every status item a component', () => {
    for (const item of all.flatMap((c) => c.statusItems ?? [])) {
      expect(typeof item.component).toBe('function');
    }
  });
});

describe('contribution ids', () => {
  it('match the file names, so the i18n namespaces line up', () => {
    expect(all.map((c) => c.id)).toEqual(['encoding', 'files', 'profileSelect']);
  });
});

// ---------------------------------------------------------------------------
// Drag and drop (G8 F2/F3)
// ---------------------------------------------------------------------------

describe('openDropped', () => {
  interface Recorded {
    opened: string[][];
    errors: { summary: string; detail: unknown }[];
    shown: { text: string; error: boolean }[];
  }

  /** One stat answer; the defaults are an ordinary allowed file. */
  function stat(path: string, over: Partial<FileStat> = {}): FileStat {
    return {
      path,
      allowed: true,
      exists: true,
      isDir: false,
      mtimeMs: 1,
      size: 10,
      readonly: false,
      ...over,
    };
  }

  function deps(
    answer: FileStat[] | (() => Promise<FileStat[]>),
    o: { open?: () => Promise<unknown> } = {},
  ): DropDeps & Recorded {
    const recorded: Recorded = { opened: [], errors: [], shown: [] };
    return {
      ...recorded,
      stat: typeof answer === 'function' ? answer : async () => answer,
      async open(paths) {
        recorded.opened.push(paths);
        return o.open?.();
      },
      async error(summary, detail) {
        recorded.errors.push({ summary, detail });
      },
      show(text, opts) {
        recorded.shown.push({ text, error: opts?.error === true });
      },
    };
  }

  it('opens the files and ignores the folders, as before', async () => {
    const d = deps([stat('/nc/a.nc'), stat('/nc/dir', { isDir: true, size: null })]);
    await openDropped(['/nc/a.nc', '/nc/dir'], d);
    expect(d.opened).toEqual([['/nc/a.nc']]);
    expect(d.shown).toEqual([{ text: t('files.folderIgnored', { count: 1 }), error: false }]);
  });

  it('reports a path it cannot reach instead of dropping it silently', async () => {
    // A dropped symlink: the plugin grants the path as written, the scope canonicalizes
    // before matching, so the stat comes back `allowed: false` with everything empty.
    const d = deps([stat('/nc/link.nc', { allowed: false, exists: false, mtimeMs: null, size: null })]);
    await openDropped(['/nc/link.nc'], d);
    expect(d.opened).toEqual([]);
    expect(d.shown).toEqual([{ text: t('files.dropRefused', { count: 1 }), error: true }]);
  });

  it('reports a file that was deleted between the drop and the stat', async () => {
    const d = deps([stat('/nc/a.nc'), stat('/nc/gone.nc', { exists: false, mtimeMs: null, size: null })]);
    await openDropped(['/nc/a.nc', '/nc/gone.nc'], d);
    expect(d.opened).toEqual([['/nc/a.nc']]);
    // Still an error although one file did open: the user dropped two and got one.
    expect(d.shown).toEqual([{ text: t('files.dropRefused', { count: 1 }), error: true }]);
  });

  it('names both buckets in one message', async () => {
    const d = deps([
      stat('/nc/dir', { isDir: true, size: null }),
      stat('/nc/link.nc', { allowed: false, exists: false, mtimeMs: null, size: null }),
    ]);
    await openDropped(['/nc/dir', '/nc/link.nc'], d);
    expect(d.shown).toEqual([
      {
        text: `${t('files.folderIgnored', { count: 1 })} · ${t('files.dropRefused', { count: 1 })}`,
        error: true,
      },
    ]);
  });

  it('says nothing and opens nothing for an empty drop', async () => {
    const d = deps([]);
    await openDropped([], d);
    expect(d.opened).toEqual([]);
    expect(d.shown).toEqual([]);
  });

  it('reports a failing files_stat as an error dialog', async () => {
    const d = deps(() => Promise.reject(new Error('ipc is gone')));
    await openDropped(['/nc/a.nc'], d);
    expect(d.errors.map((e) => e.summary)).toEqual([t('files.dropFailed')]);
    expect(d.opened).toEqual([]);
  });
});

describe('the drop handler', () => {
  /** Records what `openDropped` was allowed to do; the real `dialogs.exclusive` is the lock. */
  function recorder(): DropDeps & { opened: string[][] } {
    const opened: string[][] = [];
    return {
      opened,
      async stat(paths) {
        return paths.map((path) => ({
          path,
          allowed: true,
          exists: true,
          isDir: false,
          mtimeMs: 1,
          size: 10,
          readonly: false,
        }));
      },
      async open(paths) {
        opened.push(paths);
      },
      async error() {},
      show() {},
    };
  }

  it('opens a drop that arrives while nothing else holds the screen', async () => {
    const d = recorder();
    dropHandler(d)(['/nc/a.nc']);
    await vi.waitFor(() => expect(d.opened).toEqual([['/nc/a.nc']]));
  });

  it('drops one that arrives while a dialog chain owns the screen (G8 F2)', async () => {
    // With two unsaved documents and the combined quit alert up, a dropped tape file used
    // to become a `metaDirty` document that the alert's "Save All" then wrote to disk,
    // although it was never named in the question.
    const d = recorder();
    let release = (): void => {};
    const chain = dialogs.exclusive(() => new Promise<void>((resolve) => (release = resolve)));

    dropHandler(d)(['/nc/dropped.nc']);
    await Promise.resolve();
    expect(d.opened).toEqual([]);

    release();
    await chain;
    // ... and the lock is free again for the next drop.
    dropHandler(d)(['/nc/later.nc']);
    await vi.waitFor(() => expect(d.opened).toEqual([['/nc/later.nc']]));
  });
});
