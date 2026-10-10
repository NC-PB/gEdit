// What the typing contribution declares and how it drives the editor (plan AD-30, §6 M13
// WP13.4, §7.13).
//
// The editor is a small fake with a text model and a recording of what was asked of it: the
// real Monaco is the runtime harness's business (scenario `m13-typing`). What is pinned here
// is the order of the cheap checks, what each key press asks of the editor (one `type`
// command for the capital, one `executeEdits` when the cursors disagree, nothing for a
// paste-like or modified key), the hint of a refused join, the session switch, and that a
// re-created editor instance is hooked again.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { CommandDef, RibbonItemDef } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  messages: [] as string[],
  activeId: 'd1' as string | null,
  readOnly: false,
  /** The path of the active document; null is an untitled one. */
  path: null as string | null,
  editing: { forceUppercase: true, preventLineJoin: true } as { forceUppercase?: boolean; preventLineJoin?: boolean },
  profileId: 'fanuc-gcode',
  instance: null as unknown,
  listeners: { attach: [] as (() => void)[] },
}));

vi.mock('$lib/app/status', () => ({ status: { show: (text: string) => fake.messages.push(text) } }));
vi.mock('$lib/monaco/setup', () => ({
  getMonaco: async () => ({
    Selection: class {
      constructor(
        public a: number,
        public b: number,
        public c: number,
        public d: number,
      ) {}
    },
  }),
}));
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    editorInstance: () => fake.instance,
    onDidAttach: (cb: () => void) => (fake.listeners.attach.push(cb), () => fake.listeners.attach.splice(0)),
  },
}));
vi.mock('$lib/stores/documents', () => ({
  docs: {
    getActiveId: () => fake.activeId,
    get: (id: string) => (id === fake.activeId ? { id, readOnly: fake.readOnly, path: fake.path } : undefined),
  },
}));
vi.mock('$lib/stores/machines', async () => {
  const { BUILTIN_PROFILE_JSON: all } = await import('$lib/data/profiles');
  const { compileProfile: compile } = await import('$lib/core/profiles/compile');
  const cache = new Map<string, CompiledProfile>();
  return {
    machines: {
      effective: () => {
        let cp = cache.get(fake.profileId);
        if (!cp) {
          cp = compile(all.find((p) => (p as Profile).id === fake.profileId) as Profile);
          cache.set(fake.profileId, cp);
        }
        return { cp, profile: { ...cp.profile, editing: fake.editing } };
      },
    },
  };
});

const typing = (await import('./typing')).default;
const { handleKey, uppercaseOn, resetUppercaseOverride, isNcDocument, MAX_TYPING_LINE } = await import('./typing');
const { hasKey, t } = await import('$lib/i18n');

// -- a fake code editor ---------------------------------------------------------------------

interface Sel {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}

/** A selection from `[line, column]` pairs; the active end is the end. */
const sel = (start: [number, number], end: [number, number] = start): Sel => ({
  startLineNumber: start[0],
  startColumn: start[1],
  endLineNumber: end[0],
  endColumn: end[1],
  positionLineNumber: end[0],
  positionColumn: end[1],
});

function makeEditor(lines: string[], selections: Sel[]) {
  const calls: { kind: string; args: unknown[] }[] = [];
  let keyDown: ((e: unknown) => void) | undefined;
  const instance = {
    onKeyDown: (cb: (e: unknown) => void) => {
      keyDown = cb;
      return { dispose: () => calls.push({ kind: 'disposeKeyDown', args: [] }) };
    },
    onDidCompositionStart: () => ({ dispose: () => {} }),
    onDidCompositionEnd: () => ({ dispose: () => {} }),
    getModel: () => ({
      getLineContent: (n: number) => lines[n - 1] ?? '',
      getLineLength: (n: number) => (lines[n - 1] ?? '').length,
      getLineCount: () => lines.length,
    }),
    getSelections: () => selections,
    trigger: (...args: unknown[]) => calls.push({ kind: 'trigger', args }),
    executeEdits: (...args: unknown[]) => {
      calls.push({ kind: 'executeEdits', args });
      return true;
    },
  };
  return { instance, calls, press: (e: unknown) => keyDown?.(e) };
}

/** A key event with a log of what was prevented. */
function keyEvent(key: string, rest: Record<string, unknown> = {}) {
  const log: string[] = [];
  return {
    log,
    e: {
      browserEvent: { key, ...rest },
      preventDefault: () => log.push('preventDefault'),
      stopPropagation: () => log.push('stopPropagation'),
    },
  };
}

const compiled = new Map<string, CompiledProfile>();
const cpOf = (id: string): CompiledProfile => {
  let cp = compiled.get(id);
  if (!cp) compiled.set(id, (cp = compileProfile(BUILTIN_PROFILE_JSON.find((p) => (p as Profile).id === id) as Profile)));
  return cp;
};

const deps = (selectionCtor = true) => ({
  activeDocId: () => fake.activeId,
  readOnly: () => fake.readOnly,
  effective: () => ({ cp: cpOf(fake.profileId), editing: fake.editing }),
  uppercaseOn: (id: string) => uppercaseOn(id),
  applies: (id: string) => isNcDocument(id),
  hint: (text: string) => fake.messages.push(text),
  makeSelection: (l: number, c: number) => (selectionCtor ? { l, c } : null),
});

beforeEach(() => {
  fake.messages = [];
  fake.activeId = 'd1';
  fake.readOnly = false;
  fake.path = null;
  fake.editing = { forceUppercase: true, preventLineJoin: true };
  fake.profileId = 'fanuc-gcode';
  fake.instance = null;
  resetUppercaseOverride();
});

describe('what the contribution declares', () => {
  const defs: CommandDef[] = typing.commands ?? [];

  it('registers edit.toggleForceUppercase with no key, in the typing category', () => {
    expect(defs.map((d) => d.id)).toEqual(['edit.toggleForceUppercase']);
    const [def] = defs;
    expect(def.keys).toBeUndefined();
    expect(def.title).toBe('typing.toggleForceUppercase');
    expect(def.category).toBe('typing.category');
    expect(hasKey(def.title)).toBe(true);
    expect(hasKey(def.category as string)).toBe(true);
    expect(def.enabled?.({ activeDocId: null } as never)).toBe(false);
    expect(def.enabled?.({ activeDocId: 'd1' } as never)).toBe(true);
  });

  it('puts the command on the Edit tab, group typing.group, order 150', () => {
    const items = (typing.ribbon ?? []) as RibbonItemDef[];
    expect(items).toEqual([{ tab: 'edit', group: 'typing.group', command: 'edit.toggleForceUppercase', order: 150 }]);
    expect(hasKey('typing.group')).toBe(true);
  });
});

describe('the session switch', () => {
  const run = (): void => void defs()[0].run({ activeDocId: 'd1' } as never);
  const defs = (): CommandDef[] => typing.commands as CommandDef[];

  it('follows the profile until it is used', () => {
    expect(uppercaseOn('d1')).toBe(true);
    fake.editing = { forceUppercase: false };
    expect(uppercaseOn('d1')).toBe(false);
    fake.editing = {};
    expect(uppercaseOn('d1')).toBe(false);
  });

  it('turns it off for every document, says so, and turns it on again', () => {
    run();
    expect(uppercaseOn('d1')).toBe(false);
    expect(uppercaseOn('d2')).toBe(false);
    expect(fake.messages.at(-1)).toBe(t('typing.upperOff'));
    run();
    expect(uppercaseOn('d1')).toBe(true);
    expect(fake.messages.at(-1)).toBe(t('typing.upperOn'));
  });

  it('turns it on over a profile that does not ask for it', () => {
    fake.editing = { forceUppercase: false };
    run();
    expect(uppercaseOn('d1')).toBe(true);
  });

  it('does nothing without a document', () => {
    void defs()[0].run({ activeDocId: null } as never);
    expect(fake.messages).toEqual([]);
  });
});

describe('a letter key', () => {
  it('asks for one capital through the editor, once, and prevents the lower-case default', () => {
    const { instance, calls } = makeEditor(['G1 '], [sel([1, 4])]);
    const { e, log } = keyEvent('x');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(true);
    expect(calls).toEqual([{ kind: 'trigger', args: ['keyboard', 'type', { text: 'X' }] }]);
    expect(log).toEqual(['preventDefault', 'stopPropagation']);
  });

  it.each([
    ['in a comment', ['G1 (note '], [sel([1, 10])]],
    ['in a Fanuc comment opened earlier on the line, cursor before the closing parenthesis', ['G1 (note )'], [sel([1, 10])]],
  ])('leaves the key alone %s', (_name, lines, selections) => {
    const { instance, calls } = makeEditor(lines, selections);
    const { e, log } = keyEvent('x');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
    expect(log).toEqual([]);
  });

  it('leaves the key alone in a Sinumerik string, a Klartext name and an Okuma comment', () => {
    for (const [profileId, line, col] of [
      ['sinumerik', 'MSG("check ', 12],
      ['sinumerik', 'T="drill ', 10],
      ['heidenhain-klartext', '0 BEGIN PGM part MM', 17],
      ['okuma-osp', 'G1 X1 (check ', 14],
    ] as const) {
      fake.profileId = profileId;
      const { instance, calls } = makeEditor([line], [sel([1, col])]);
      expect(handleKey(instance as never, keyEvent('x').e as never, false, deps()), line).toBe(false);
      expect(calls, line).toEqual([]);
    }
  });

  it('leaves the key alone when the option is off for the profile and capitalises when the session turns it on', () => {
    fake.editing = { forceUppercase: false };
    const off = makeEditor(['G1 '], [sel([1, 4])]);
    expect(handleKey(off.instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    typing.commands?.[0].run({ activeDocId: 'd1' } as never);
    const on = makeEditor(['G1 '], [sel([1, 4])]);
    expect(handleKey(on.instance as never, keyEvent('x').e as never, false, deps())).toBe(true);
  });

  it.each([
    ['Cmd+X', 'x', { metaKey: true }],
    ['Ctrl+C', 'c', { ctrlKey: true }],
    ['Alt+letter', 'm', { altKey: true }],
    ['a key for the IME', 'a', { keyCode: 229 }],
    ['a composing key', 'a', { isComposing: true }],
    ['a digit', '5', {}],
    ['an upper-case letter', 'G', {}],
    ['Enter', 'Enter', {}],
  ])('leaves %s to the editor', (_name, key, rest) => {
    const { instance, calls } = makeEditor(['G1 '], [sel([1, 4])]);
    expect(handleKey(instance as never, keyEvent(key, rest).e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
  });

  it('leaves every key to the editor while the editor reports a composition', () => {
    const { instance, calls } = makeEditor(['G1 '], [sel([1, 4])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, true, deps())).toBe(false);
    expect(calls).toEqual([]);
  });

  it('does not touch a read-only document or a missing one', () => {
    const { instance, calls } = makeEditor(['G1 '], [sel([1, 4])]);
    fake.readOnly = true;
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    fake.readOnly = false;
    fake.activeId = null;
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
  });

  it('reads the selection as replaced: a selected comment tail is typed over', () => {
    // `G1 (note)`: columns 5-9 (`note`) selected, the letter replaces them inside the comment.
    const { instance, calls } = makeEditor(['G1 (note)'], [sel([1, 5], [1, 9])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
  });

  it('reads a selection that spans a line break from the first line head and the last line tail', () => {
    // From inside a comment on line 1 to the code on line 2: the merged line is a comment.
    const { instance, calls } = makeEditor(['G1 (open', 'X5)'], [sel([1, 9], [2, 1])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
    // From code on line 1 to a comment's tail on line 2.
    const two = makeEditor(['G1 X1', 'note) Z5'], [sel([1, 6], [2, 6])]);
    expect(handleKey(two.instance as never, keyEvent('x').e as never, false, deps())).toBe(true);
    expect(two.calls[0]).toEqual({ kind: 'trigger', args: ['keyboard', 'type', { text: 'X' }] });
  });

  it('types one capital for every cursor when all are in code', () => {
    const { instance, calls } = makeEditor(['G1 ', 'G2 '], [sel([1, 4]), sel([2, 4])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('trigger');
  });

  it('edits each cursor with its own text when the cursors disagree, and puts the cursors after it', () => {
    const { instance, calls } = makeEditor(['G1 ', '(note '], [sel([1, 4]), sel([2, 7])]);
    const { e, log } = keyEvent('x');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(true);
    expect(log).toEqual(['preventDefault', 'stopPropagation']);
    expect(calls).toHaveLength(1);
    const [source, edits, cursorState] = calls[0].args as [
      string,
      { range: Sel; text: string }[],
      (inverse: { range: { endLineNumber: number; endColumn: number } }[]) => unknown[],
    ];
    expect(source).toBe('keyboard');
    expect(edits.map((edit) => edit.text)).toEqual(['X', 'x']);
    expect(cursorState([{ range: { endLineNumber: 1, endColumn: 5 } }, { range: { endLineNumber: 2, endColumn: 8 } }])).toEqual([
      { l: 1, c: 5 },
      { l: 2, c: 8 },
    ]);
  });

  it('lets the key through when the cursors disagree and Monaco has not been loaded for its Selection', () => {
    const { instance, calls } = makeEditor(['G1 ', '(note '], [sel([1, 4]), sel([2, 7])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps(false))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('leaves a monstrous line as typed instead of tokenizing it on every key', () => {
    const line = `G1 ${'X'.repeat(MAX_TYPING_LINE)}`;
    const { instance, calls } = makeEditor([line], [sel([1, 4])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('Backspace and Delete', () => {
  const lines = ['N10 G1 X1', 'N20 G2 X2', 'N30 G3 X3'];

  it('swallows Backspace in column 1 and says why', () => {
    const { instance, calls } = makeEditor(lines, [sel([2, 1])]);
    const { e, log } = keyEvent('Backspace');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(true);
    expect(log).toEqual(['preventDefault', 'stopPropagation']);
    expect(calls).toEqual([]);
    expect(fake.messages).toEqual([t('typing.noJoin')]);
  });

  it('removes an empty or blank line with Backspace and Delete, but not the join of two text lines', () => {
    const blankLines = ['N10 G1 X1', '', '   ', 'N20 G2 X2'];
    for (const [key, selection] of [
      ['Backspace', sel([2, 1])], // empty line, text above
      ['Backspace', sel([3, 1])], // blank line
      ['Backspace', sel([4, 1])], // text under a blank line
      ['Delete', sel([1, 10])], // text above an empty line
      ['Delete', sel([2, 1])], // empty line
      ['Delete', sel([3, 4])], // blank line, text below
    ] as const) {
      const { instance } = makeEditor(blankLines, [selection]);
      const { e, log } = keyEvent(key);
      expect(handleKey(instance as never, e as never, false, deps()), `${key} ${selection.positionLineNumber}`).toBe(false);
      expect(log).toEqual([]);
    }
    expect(fake.messages).toEqual([]);
    // A document that ends with an empty line: Delete at the end of the last text line.
    const tail = makeEditor(['N10 G1', ''], [sel([1, 7])]);
    expect(handleKey(tail.instance as never, keyEvent('Delete').e as never, false, deps())).toBe(false);
    // The two text lines still join nowhere.
    const text = makeEditor(['N10 G1', 'N20 G2'], [sel([2, 1])]);
    expect(handleKey(text.instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(true);
  });

  it('swallows Delete at the end of a line', () => {
    const { instance } = makeEditor(lines, [sel([2, 10])]);
    expect(handleKey(instance as never, keyEvent('Delete').e as never, false, deps())).toBe(true);
    expect(fake.messages).toEqual([t('typing.noJoin')]);
  });

  it.each([
    ['Backspace inside a line', 'Backspace', sel([2, 5])],
    ['Backspace at the very start of the document', 'Backspace', sel([1, 1])],
    ['Delete inside a line', 'Delete', sel([2, 5])],
    ['Delete at the very end of the document', 'Delete', sel([3, 10])],
    ['Backspace over a selection that starts in column 1', 'Backspace', sel([2, 1], [2, 4])],
    ['Delete over a selection that spans a line break', 'Delete', sel([1, 5], [2, 5])],
    ['Backspace over a selected line break', 'Backspace', sel([1, 10], [2, 1])],
  ])('lets %s through', (_name, key, selection) => {
    const { instance } = makeEditor(lines, [selection]);
    const { e, log } = keyEvent(key);
    expect(handleKey(instance as never, e as never, false, deps())).toBe(false);
    expect(log).toEqual([]);
    expect(fake.messages).toEqual([]);
  });

  // M13 review CODE-12 (owner, 2026-10-09): a word or line deletion in column 1 joins too.
  it('refuses the word and line deletions (Ctrl, Alt, Cmd) that would join two blocks', () => {
    const { instance } = makeEditor(lines, [sel([2, 1])]);
    for (const rest of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(handleKey(instance as never, keyEvent('Backspace', rest).e as never, false, deps())).toBe(true);
    }
  });

  it('does nothing when the profile does not ask for it, and not in a read-only document', () => {
    const { instance } = makeEditor(lines, [sel([2, 1])]);
    fake.editing = { forceUppercase: true, preventLineJoin: false };
    expect(handleKey(instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(false);
    fake.editing = { preventLineJoin: true };
    fake.readOnly = true;
    expect(handleKey(instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(false);
  });

  it('is not turned off by the upper-case session switch', () => {
    typing.commands?.[0].run({ activeDocId: 'd1' } as never);
    expect(uppercaseOn('d1')).toBe(false);
    const { instance } = makeEditor(lines, [sel([2, 1])]);
    expect(handleKey(instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(true);
  });

  it('refuses the key press when one of several cursors would join two text lines', () => {
    const { instance } = makeEditor(lines, [sel([1, 3]), sel([3, 1])]);
    expect(handleKey(instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(true);
  });

  it('lets the key press through when the only cursor at a join is on an empty line', () => {
    const { instance } = makeEditor(['N10 G1', '', 'N30 G3'], [sel([1, 3]), sel([2, 1])]);
    expect(handleKey(instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(false);
  });
});

describe('hooking the editor', () => {
  it('hooks an instance once, hooks a new one after the compare overlay re-creates it, and lets go on dispose', async () => {
    const first = makeEditor(['G1 '], [sel([1, 4])]);
    fake.instance = first.instance;
    const disposable = await typing.activate?.();
    // An attach that built the same instance again costs one comparison.
    for (const cb of fake.listeners.attach) cb();
    first.press(keyEvent('x').e);
    expect(first.calls.filter((c) => c.kind === 'trigger')).toHaveLength(1);

    const second = makeEditor(['G1 '], [sel([1, 4])]);
    fake.instance = second.instance;
    for (const cb of fake.listeners.attach) cb();
    second.press(keyEvent('x').e);
    expect(second.calls.filter((c) => c.kind === 'trigger')).toHaveLength(1);
    expect(first.calls.some((c) => c.kind === 'disposeKeyDown')).toBe(true);

    (disposable as () => void)();
    expect(second.calls.some((c) => c.kind === 'disposeKeyDown')).toBe(true);
    expect(fake.listeners.attach).toHaveLength(0);
  });
});

describe('only NC programs (CODE-3)', () => {
  const json = ['"extends": "fanuc-gcode"', '"id": "my-lathe"'];

  it.each([
    ['a profile file', '/cfg/profiles/a.json'],
    ['the machines file', 'C:\\Users\\me\\AppData\\machines.json'],
    ['a script', '/home/me/scripts/my_script.py'],
    ['an upper-case extension', '/cfg/codes/FANUC.JSON'],
  ])('leaves a letter typed in %s alone, with the profile flag and the session switch on', (_name, path) => {
    fake.path = path;
    typing.commands?.[0].run({ activeDocId: 'd1' } as never); // off for the session ...
    typing.commands?.[0].run({ activeDocId: 'd1' } as never); // ... and on again
    const { instance, calls } = makeEditor(['"id": "my-lath'], [sel([1, 15])]);
    const { e, log } = keyEvent('e');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
    expect(log).toEqual([]);
    expect(uppercaseOn('d1')).toBe(false);
  });

  it('leaves Backspace at column 1 and Delete at the end of a line alone in a JSON document', () => {
    fake.path = '/cfg/profiles/a.json';
    const { instance } = makeEditor(json, [sel([2, 1])]);
    const back = keyEvent('Backspace');
    expect(handleKey(instance as never, back.e as never, false, deps())).toBe(false);
    expect(back.log).toEqual([]);
    const forward = makeEditor(json, [sel([1, json[0].length + 1])]);
    const del = keyEvent('Delete');
    expect(handleKey(forward.instance as never, del.e as never, false, deps())).toBe(false);
    expect(del.log).toEqual([]);
    expect(fake.messages).toEqual([]);
  });

  it.each([
    ['an untitled document', null],
    ['a program number as the name', '/work/O0017'],
    ['a text file', '/work/a.txt'],
    ['a tape', '/work/part.tap'],
    ['a name with no extension', 'C:\\work\\PART1'],
    ['a name that only contains json', '/work/json.nc'],
  ])('still upper-cases and still refuses a join in %s', (_name, path) => {
    fake.path = path;
    const type = makeEditor(['G1 '], [sel([1, 4])]);
    expect(handleKey(type.instance as never, keyEvent('x').e as never, false, deps())).toBe(true);
    const join = makeEditor(['N10 G1', 'N20 G2'], [sel([2, 1])]);
    expect(handleKey(join.instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(true);
  });

  it('says the switch is not for this document instead of changing the session', () => {
    fake.path = '/cfg/profiles/a.json';
    typing.commands?.[0].run({ activeDocId: 'd1' } as never);
    expect(fake.messages.at(-1)).toBe(t('typing.notHere'));
    fake.path = null;
    expect(uppercaseOn('d1')).toBe(true);
    expect(typing.commands?.[0].enabled?.({ activeDocId: 'd1' } as never)).toBe(true);
    fake.path = '/cfg/profiles/a.json';
    expect(typing.commands?.[0].enabled?.({ activeDocId: 'd1' } as never)).toBe(false);
  });
});

describe('what a key press reads (CODE-7)', () => {
  /** A model whose text of the long line cannot be read: only its length can be asked for. */
  function longLineEditor(selections: Sel[], lines: string[], longAt: number) {
    const reads: number[] = [];
    const instance = {
      onKeyDown: () => ({ dispose: () => {} }),
      getModel: () => ({
        getLineContent: (n: number) => {
          reads.push(n);
          if (n === longAt) throw new Error(`line ${n} was read`);
          return lines[n - 1] ?? '';
        },
        getLineLength: (n: number) => (n === longAt ? 5_000_000 : (lines[n - 1] ?? '').length),
        getLineCount: () => lines.length,
      }),
      getSelections: () => selections,
      trigger: () => {},
      executeEdits: () => true,
    };
    return { instance, reads };
  }

  it('does not read the text of a line that is too long for a letter key, nor the one above it', () => {
    const lines = ['G1 X1', 'N10 G1 X'];
    const above = longLineEditor([sel([2, 9])], lines, 1);
    expect(handleKey(above.instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(above.reads).toEqual([]);
    const own = longLineEditor([sel([1, 3])], lines, 1);
    expect(handleKey(own.instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(own.reads).toEqual([]);
  });

  it('answers Backspace in the middle of a line, and Delete away from its end, from the lengths alone', () => {
    const lines = ['N10 G1 X1', 'N20 G2 X2', 'N30 G3 X3'];
    for (const [key, selection] of [
      ['Backspace', sel([2, 5])],
      ['Backspace', sel([2, 1], [2, 4])],
      ['Delete', sel([2, 5])],
      ['Delete', sel([2, 1], [2, 4])],
    ] as const) {
      const { instance, reads } = longLineEditor([selection], lines, 3);
      expect(handleKey(instance as never, keyEvent(key).e as never, false, deps()), key).toBe(false);
      expect(reads, key).toEqual([]);
    }
  });

  it('reads the neighbour only at the edge, and treats a very long line as text without reading it', () => {
    const lines = ['N10 G1 X1', 'N20 G2 X2', 'N30 G3 X3'];
    // Delete at the end of line 2 reads lines 2 and 3 (line 3 is the long one: it counts as text).
    const { instance, reads } = longLineEditor([sel([2, 10])], lines, 3);
    const { e } = keyEvent('Delete');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(true);
    expect(reads).toEqual([2]);
  });
});
