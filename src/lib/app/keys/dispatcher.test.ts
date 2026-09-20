// The window key dispatcher (plan §5 WP1.1 "Tests", AD-4): fake events for
// `defaultPrevented`, composing, `AltGraph`, inputs, a Monaco ancestor and modal open.

import { describe, expect, it, vi } from 'vitest';
import { dispatchKey, isEditableTarget, type DispatchEvent, type DispatcherDeps } from './dispatcher';
import type { CommandDef } from '$lib/app/types';

const save: CommandDef = { id: 'file.save', title: 't.save', keys: 'Mod+S', global: true, run: () => {} };
const inEditorOnly: CommandDef = {
  id: 'nav.goto',
  title: 't.goto',
  keys: 'Ctrl+G',
  run: () => {},
};

/** The default deps: two commands, no modal, macOS, and a spy for `run`. */
function deps(over: Partial<DispatcherDeps> = {}): DispatcherDeps & { run: ReturnType<typeof vi.fn> } {
  return {
    list: () => [save, inEditorOnly],
    isEnabled: () => true,
    isModalOpen: () => false,
    isMac: true,
    ...over,
    run: vi.fn(),
  };
}

/** Cmd+S on a plain div, unless `over` says otherwise. */
function event(over: Partial<DispatchEvent> = {}): DispatchEvent & {
  preventDefault: ReturnType<typeof vi.fn>;
} {
  return {
    key: 's',
    code: 'KeyS',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    target: { tagName: 'DIV' },
    getModifierState: () => false,
    stopPropagation: vi.fn(),
    ...over,
    preventDefault: vi.fn(),
  };
}

describe('dispatchKey', () => {
  it('runs a matching global command and swallows the event', () => {
    const d = deps();
    const e = event();
    expect(dispatchKey(e, d)).toBe('file.save');
    expect(d.run).toHaveBeenCalledWith('file.save');
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('ignores a command that is not global', () => {
    const d = deps();
    const e = event({ key: 'g', code: 'KeyG', metaKey: false, ctrlKey: true });
    expect(dispatchKey(e, d)).toBeNull();
    expect(d.run).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores an unclaimed shortcut', () => {
    const d = deps();
    expect(dispatchKey(event({ key: 'q', code: 'KeyQ' }), d)).toBeNull();
    expect(d.run).not.toHaveBeenCalled();
  });

  it('ignores an event another handler already took', () => {
    const d = deps();
    expect(dispatchKey(event({ defaultPrevented: true }), d)).toBeNull();
    expect(d.run).not.toHaveBeenCalled();
  });

  it('ignores an IME composition', () => {
    const d = deps();
    expect(dispatchKey(event({ isComposing: true }), d)).toBeNull();
  });

  it('ignores AltGr (D21)', () => {
    const d = deps();
    const e = event({ getModifierState: (k: string) => k === 'AltGraph' });
    expect(dispatchKey(e, d)).toBeNull();
  });

  it('still works when the event has no getModifierState', () => {
    const d = deps();
    const e = event();
    delete (e as { getModifierState?: unknown }).getModifierState;
    expect(dispatchKey(e, d)).toBe('file.save');
  });

  it('leaves text fields and content-editable alone', () => {
    const d = deps();
    expect(dispatchKey(event({ target: { tagName: 'INPUT' } }), d)).toBeNull();
    expect(dispatchKey(event({ target: { tagName: 'textarea' } }), d)).toBeNull();
    expect(dispatchKey(event({ target: { tagName: 'DIV', isContentEditable: true } }), d)).toBeNull();
    expect(d.run).not.toHaveBeenCalled();
  });

  it('still dispatches while a ribbon <select> has focus (G8)', () => {
    // The v1 script picker and the Insert tab's block picker are plain `<select>`s.
    // Monaco's editor-scoped bindings do not fire while one has focus either, so treating
    // it as a text field made Cmd+S and Cmd+O do nothing at all, silently.
    const d = deps();
    expect(dispatchKey(event({ target: { tagName: 'SELECT' } }), d)).toBe('file.save');
    expect(d.run).toHaveBeenCalledWith('file.save');
  });

  it('leaves a <select> its own type-ahead: a bare printable key', () => {
    const d = deps();
    const bare = event({ target: { tagName: 'SELECT' }, key: 'f', code: 'KeyF', metaKey: false });
    expect(dispatchKey(bare, d)).toBeNull();
    expect(bare.preventDefault).not.toHaveBeenCalled();
    // A function key is not type-ahead, so F1 still reaches its command.
    const f1: CommandDef = { id: 'view.commandPalette', title: 't.p', keys: 'F1', global: true, run: () => {} };
    const withF1 = deps({ list: () => [f1] });
    expect(dispatchKey(event({ target: { tagName: 'SELECT' }, key: 'F1', code: 'F1', metaKey: false }), withF1)).toBe(
      'view.commandPalette',
    );
  });

  it('passes a disabled command over instead of swallowing the key (G8)', () => {
    // Ctrl+Tab with one tab open: `view.nextTab` is `enabled: manyDocs`. Swallowing the
    // key and then showing "Next tab is not available right now" is worse than nothing.
    const d = deps({ isEnabled: () => false });
    const e = event();
    expect(dispatchKey(e, d)).toBeNull();
    expect(d.run).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });

  it('asks about enablement only for the command whose shortcut matched', () => {
    const d = deps();
    const asked = vi.fn(() => true);
    dispatchKey(event(), { ...d, isEnabled: asked });
    expect(asked.mock.calls).toEqual([['file.save']]);
  });

  it('leaves anything inside the Monaco editor alone', () => {
    const d = deps();
    const inside = { tagName: 'SPAN', closest: (s: string) => (s === '.monaco-editor' ? {} : null) };
    const outside = { tagName: 'SPAN', closest: () => null };
    expect(dispatchKey(event({ target: inside }), d)).toBeNull();
    expect(dispatchKey(event({ target: outside }), d)).toBe('file.save');
  });

  it('is suspended while a modal is open', () => {
    const d = deps({ isModalOpen: () => true });
    expect(dispatchKey(event(), d)).toBeNull();
    expect(d.run).not.toHaveBeenCalled();
  });

  it('uses the platform spec', () => {
    const mac = deps({ isMac: true });
    const other = deps({ isMac: false });
    const cmdS = event({ metaKey: true });
    const ctrlS = event({ metaKey: false, ctrlKey: true });
    expect(dispatchKey(cmdS, mac)).toBe('file.save');
    expect(dispatchKey(ctrlS, mac)).toBeNull();
    expect(dispatchKey(ctrlS, other)).toBe('file.save');
    expect(dispatchKey(cmdS, other)).toBeNull();
  });

  it('skips a command whose spec does not parse instead of throwing', () => {
    const broken: CommandDef = { id: 'x', title: 't.x', keys: 'Meta+S', global: true, run: () => {} };
    const d = deps({ list: () => [broken, save] });
    expect(dispatchKey(event(), d)).toBe('file.save');
  });
});

describe('isEditableTarget', () => {
  it('handles null, plain objects and a throwing closest', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget('body')).toBe(false);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(
      isEditableTarget({
        tagName: 'SPAN',
        closest: () => {
          throw new Error('detached');
        },
      }),
    ).toBe(false);
  });
});
