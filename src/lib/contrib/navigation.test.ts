// What the navigation contribution declares (plan §5 WP3.5, §7.11).
//
// The command ids and their shortcuts are a contract with the rest of the app: a key that
// §7.11 does not list would be a conflict the command registry reports as a
// `console.error`, which the runtime harness turns into a failed scenario. The same
// reasoning as `fileFeatures.test.ts` (WP1.6).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutlineItem } from '$lib/core/profiles/outline';
import type { CommandDef, DocId } from '$lib/app/types';

/**
 * What F7 reads: an outline service whose index is only built once someone asks.
 *
 * The real one starts the build in `items()`/`toolLines()` and finishes it a turn later,
 * which is the whole point of the test below — with the program map hidden, F7 is the
 * first caller and used to read the empty index it had just created.
 */
const fake = vi.hoisted(() => {
  let built = false;
  let resolveReady: () => void = () => {};
  const lines = [4, 12, 30];
  return {
    lines,
    /** Lets the pending build finish, the way the scheduled chunk would. */
    finish(): void {
      built = true;
      resolveReady();
    },
    reset(): void {
      built = false;
      fake.ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      fake.revealed = [];
      fake.messages = [];
    },
    ready: Promise.resolve(),
    revealed: [] as number[],
    /** `null` is a `status.clear()`: the bar was emptied, not written to. */
    messages: [] as (string | null)[],
    outline: {
      items: () => ({ subscribe: () => () => {} }),
      toolLines: (): number[] => (built ? lines : []),
      itemAt: (): OutlineItem | null => null,
      whenReady: (): Promise<void> => fake.ready,
    },
  };
});

vi.mock('$lib/app/outlineService', () => ({ outline: fake.outline }));
vi.mock('$lib/stores/documents', () => ({ docs: { getActiveId: (): DocId => 'd1', get: () => null } }));
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    cursor: () => ({ line: 1, column: 1 }),
    reveal: (_id: DocId, line: number) => fake.revealed.push(line),
    getLineCount: () => 100,
    getLines: () => [],
  },
}));
vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string) => fake.messages.push(text),
    // A jump that worked clears whatever was on the bar, so an older error is
    // never left standing as the answer to it (G8 M5). `null` is what the tests
    // read as "nothing is showing".
    clear: () => fake.messages.push(null),
  },
}));

const navigation = (await import('./navigation')).default;
const { hasKey, t } = await import('$lib/i18n');
const { parseGotoInput } = await import('$lib/core/nav');

const byId = new Map<string, CommandDef>((navigation.commands ?? []).map((def) => [def.id, def]));

describe('commands', () => {
  it('registers exactly the navigation commands of plan §7.11, with their shortcuts', () => {
    expect([...byId.keys()]).toEqual(['nav.goto', 'nav.nextTool', 'nav.prevTool']);
    expect(Object.fromEntries([...byId].map(([id, def]) => [id, def.keys ?? null]))).toEqual({
      'nav.goto': 'Ctrl+G',
      'nav.nextTool': 'F7',
      'nav.prevTool': 'Shift+F7',
    });
  });

  it('runs outside the editor too, and only with a document', () => {
    for (const def of byId.values()) {
      expect(def.global, def.id).toBe(true);
      expect(def.enabled?.({ activeDocId: null } as never), def.id).toBe(false);
      expect(def.enabled?.({ activeDocId: 'd1' } as never), def.id).toBe(true);
    }
  });

  it('has a message for every title and category it names', () => {
    for (const def of byId.values()) {
      expect(hasKey(def.title), def.title).toBe(true);
      expect(def.category !== undefined && hasKey(def.category), def.id).toBe(true);
    }
  });
});

describe('the Monaco binding it takes over', () => {
  it('drops the built-in go-to-line, because Ctrl+G now opens ours', () => {
    expect(navigation.keybindingRemovals).toEqual([{ keys: 'Ctrl+G', command: 'editor.action.gotoLine' }]);
  });

  it('removes the binding the command claims', () => {
    expect(navigation.keybindingRemovals?.[0].keys).toBe(byId.get('nav.goto')?.keys);
  });
});

describe('the go-to prompt', () => {
  /** The `validate` the prompt is opened with, pulled out of the command. */
  const messages = ['navigation.gotoTitle', 'navigation.gotoPlaceholder', 'navigation.gotoInvalid', 'navigation.noLine', 'navigation.noBlock', 'navigation.noTools', 'navigation.wrappedToFirst', 'navigation.wrappedToLast'];

  it('has a message for every status it can report', () => {
    for (const key of messages) expect(hasKey(key), key).toBe(true);
  });

  it('accepts what the prompt is allowed to return', () => {
    expect(parseGotoInput('120')).not.toBeNull();
    expect(parseGotoInput('N120')).not.toBeNull();
    expect(parseGotoInput('')).toBeNull();
  });
});

// The program map is what usually starts the index, and it is not mounted while the left
// region is hidden (a state M2 persists). F7 is then the first caller, and answering from
// the index it has just created reports "no tool changes" on a program full of them.
describe('stepping through the tool changes', () => {
  const nextTool = byId.get('nav.nextTool') as CommandDef;
  const prevTool = byId.get('nav.prevTool') as CommandDef;

  beforeEach(() => fake.reset());

  it('waits for the first build instead of reporting an empty program', async () => {
    const running = nextTool.run({ activeDocId: 'd1' } as never);
    expect(fake.messages, 'F7 answered before the index was built').toEqual([]);
    fake.finish();
    await running;
    // A jump that worked clears the bar rather than writing to it, so an older error is
    // not left standing as the answer to it (G8 M5).
    expect(fake.messages).toEqual([null]);
    expect(fake.revealed).toEqual([4]);
  });

  it('still says so when the built index really has no tool change', async () => {
    fake.lines.length = 0;
    fake.finish();
    await prevTool.run({ activeDocId: 'd1' } as never);
    expect(fake.messages).toEqual([t('navigation.noTools')]);
    expect(fake.revealed).toEqual([]);
    fake.lines.push(4, 12, 30);
  });

  it('wraps to the last tool and says so', async () => {
    fake.finish();
    await prevTool.run({ activeDocId: 'd1' } as never);
    expect(fake.revealed).toEqual([30]);
    expect(fake.messages).toEqual([t('navigation.wrappedToLast')]);
  });
});
