// What the bookmark contribution declares (plan §5 WP4.4, §7.11).
//
// The three shortcuts and the two Monaco bindings they take over are a contract: a key
// §7.11 does not list, or a Monaco default left in place underneath one of ours, is a
// conflict the command registry reports as a `console.error` and the runtime harness
// turns into a failed scenario. Same reasoning as `navigation.test.ts` (WP3.5).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandDef, DocId } from '$lib/app/types';

const fake = vi.hoisted(() => {
  let lines: number[] = [];
  return {
    activeId: 'd1' as DocId | null,
    /** `null` is a `status.clear()`: the bar was emptied, not written to. */
    messages: [] as (string | null)[],
    calls: [] as string[],
    installs: 0,
    uninstalls: 0,
    monacoResolved: false,
    setLines(next: number[]): void {
      lines = [...next];
    },
    reset(): void {
      fake.activeId = 'd1';
      fake.messages = [];
      fake.calls = [];
      fake.installs = 0;
      fake.uninstalls = 0;
      lines = [];
    },
    bookmarks: {
      toggle(): void {
        fake.calls.push('toggle');
      },
      next(): void {
        fake.calls.push('next');
      },
      prev(): void {
        fake.calls.push('prev');
      },
      clear(): void {
        fake.calls.push('clear');
        lines = [];
      },
      lines: (): number[] => [...lines],
      install(): () => void {
        fake.installs += 1;
        return () => {
          fake.uninstalls += 1;
        };
      },
    },
  };
});

vi.mock('$lib/monaco/bookmarks', () => ({ bookmarks: fake.bookmarks }));
vi.mock('$lib/monaco/editorService', () => ({ editor: { ready: Promise.resolve() } }));
vi.mock('$lib/monaco/setup', () => ({
  getMonaco: async () => {
    fake.monacoResolved = true;
    return {};
  },
}));
vi.mock('$lib/stores/documents', () => ({ docs: { getActiveId: (): DocId | null => fake.activeId } }));
vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string) => fake.messages.push(text),
    // A jump that worked clears whatever was on the bar, so an older error is
    // never left standing as the answer to it (G8 M5). `null` is what the tests
    // read as "nothing is showing".
    clear: () => fake.messages.push(null),
  },
}));

const bookmarksContrib = (await import('./bookmarks')).default;
const { hasKey, t } = await import('$lib/i18n');

const byId = new Map<string, CommandDef>((bookmarksContrib.commands ?? []).map((def) => [def.id, def]));
const run = async (id: string): Promise<void> => {
  await byId.get(id)?.run({ activeDocId: fake.activeId } as never);
};

beforeEach(() => {
  fake.reset();
});

describe('commands', () => {
  it('registers exactly the bookmark commands, with the shortcuts of plan §7.11', () => {
    expect([...byId.keys()]).toEqual([
      'bookmark.toggle',
      'bookmark.next',
      'bookmark.prev',
      'bookmark.clear',
    ]);
    expect(Object.fromEntries([...byId].map(([id, def]) => [id, def.keys ?? null]))).toEqual({
      'bookmark.toggle': 'Mod+F2',
      'bookmark.next': 'F2',
      'bookmark.prev': 'Shift+F2',
      'bookmark.clear': null,
    });
  });

  it('runs outside the editor too, and only with a document', () => {
    for (const def of byId.values()) {
      expect(def.global, def.id).toBe(true);
      expect(def.enabled?.({ activeDocId: null } as never), def.id).toBe(false);
      expect(def.enabled?.({ activeDocId: 'd1' } as never), def.id).toBe(true);
    }
  });

  it('stays in the palette, because Monaco has nothing of its own to list', () => {
    for (const def of byId.values()) expect(def.palette, def.id).toBeUndefined();
  });

  it('has a message for every title and category it names', () => {
    for (const def of byId.values()) {
      expect(hasKey(def.title), def.title).toBe(true);
      expect(def.category !== undefined && hasKey(def.category), def.id).toBe(true);
    }
  });
});

describe('keybinding removals', () => {
  it('drops the two Monaco defaults that sit on F2 and Mod+F2', () => {
    expect(bookmarksContrib.keybindingRemovals).toEqual([
      { keys: 'F2', command: 'editor.action.rename' },
      { keys: 'Mod+F2', command: 'editor.action.changeAll' },
    ]);
  });

  it('leaves every other Monaco binding alone (Mod+Shift+L stays select-all-occurrences)', () => {
    const removed = (bookmarksContrib.keybindingRemovals ?? []).map((r) => r.keys);
    expect(removed).not.toContain('Mod+Shift+L');
  });
});

describe('toggle', () => {
  it('says which way it went', async () => {
    fake.bookmarks.toggle = () => {
      fake.calls.push('toggle');
      fake.setLines([12]);
    };
    await run('bookmark.toggle');
    expect(fake.calls).toEqual(['toggle']);
    expect(fake.messages).toEqual([t('bookmarks.set')]);

    fake.bookmarks.toggle = () => {
      fake.calls.push('toggle');
      fake.setLines([]);
    };
    await run('bookmark.toggle');
    expect(fake.messages.at(-1)).toBe(t('bookmarks.removed'));
  });

  it('does nothing without a document', async () => {
    fake.activeId = null;
    await run('bookmark.toggle');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([]);
  });
});

describe('next and previous', () => {
  it('step through the bookmarks', async () => {
    fake.setLines([4, 12]);
    await run('bookmark.next');
    await run('bookmark.prev');
    expect(fake.calls).toEqual(['next', 'prev']);
    // Each jump clears the bar instead of saying anything, so "Bookmark set." from the
    // command before it does not sit there reading as the answer (G8 M5).
    expect(fake.messages).toEqual([null, null]);
  });

  it('say so instead of doing nothing when the document has none', async () => {
    await run('bookmark.next');
    await run('bookmark.prev');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([t('bookmarks.none'), t('bookmarks.none')]);
  });
});

describe('clear', () => {
  it('reports how many it removed, with the right plural', async () => {
    fake.setLines([4]);
    await run('bookmark.clear');
    expect(fake.messages.at(-1)).toBe('Removed 1 bookmark.');

    fake.setLines([4, 12, 20]);
    await run('bookmark.clear');
    expect(fake.messages.at(-1)).toBe('Removed 3 bookmarks.');
    expect(fake.calls).toEqual(['clear', 'clear']);
  });

  it('says there is nothing to clear rather than showing "removed 0"', async () => {
    await run('bookmark.clear');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([t('bookmarks.none')]);
  });
});

describe('activate', () => {
  it('hands Monaco to the decoration service once the editor is ready, and undoes it', async () => {
    const dispose = bookmarksContrib.activate();
    expect(fake.installs).toBe(0); // not before the editor is ready
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.monacoResolved).toBe(true);
    expect(fake.installs).toBe(1);

    (dispose as () => void)();
    expect(fake.uninstalls).toBe(1);
  });

  it('installs nothing when it is disposed before Monaco arrives', async () => {
    const dispose = bookmarksContrib.activate();
    (dispose as () => void)();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.installs).toBe(0);
    expect(fake.uninstalls).toBe(0);
  });
});
