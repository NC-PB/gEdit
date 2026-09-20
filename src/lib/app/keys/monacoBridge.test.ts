// The Monaco bridge (plan AD-4): every palette command becomes a `gedit.*` action on each
// editor with a `<Category>: <Title>` label and its platform keybinding, the actions
// re-sync when the registry changes or an editor appears, and keybinding removals are
// applied once as '-<monacoId>'.
//
// The bridge takes its Monaco slice as a dependency, so this runs in node with a fake.

import { describe, expect, it, vi } from 'vitest';
import {
  createBridge,
  paletteLabel,
  type ActionTarget,
  type BridgeDeps,
  type MonacoBridgeApi,
} from './monacoBridge';
import type { CommandDef, Disposable } from '$lib/app/types';
import type { KeybindingRemoval } from '$lib/app/registry/keybindings';

interface Action {
  id: string;
  label: string;
  keybindings?: number[];
  run(...args: unknown[]): void;
  editor: string;
  disposed: boolean;
}

function fakeApi(): MonacoBridgeApi & {
  actions: Action[];
  rules: { keybinding: number; command: string }[][];
  rulesDisposed: number;
  targets: ActionTarget[];
  addEditor(name: string): void;
  createdListener: (() => void) | null;
} {
  const actions: Action[] = [];
  const rules: { keybinding: number; command: string }[][] = [];
  const makeTarget = (name: string): ActionTarget => ({
    addAction(descriptor) {
      const action: Action = { ...descriptor, editor: name, disposed: false };
      actions.push(action);
      return {
        dispose() {
          action.disposed = true;
        },
      };
    },
  });
  const api = {
    actions,
    rules,
    rulesDisposed: 0,
    targets: [makeTarget('editor-1')],
    createdListener: null as (() => void) | null,
    addEditor(name: string) {
      api.targets.push(makeTarget(name));
      api.createdListener?.();
    },
    editors: () => api.targets,
    onDidCreateEditor(cb: () => void) {
      api.createdListener = cb;
      return {
        dispose() {
          api.createdListener = null;
        },
      };
    },
    addKeybindingRules(list: { keybinding: number; command: string }[]) {
      rules.push(list);
      return {
        dispose() {
          api.rulesDisposed += 1;
        },
      };
    },
    KeyMod: class {
      static readonly CtrlCmd = 2048;
      static readonly Shift = 1024;
      static readonly Alt = 512;
      static readonly WinCtrl = 256;
      static chord(a: number, b: number): number {
        return (a << 16) | b;
      }
    },
    KeyCode: { KeyS: 49, KeyG: 37, F1: 59, F2: 60 },
  };
  return api as unknown as MonacoBridgeApi & {
    actions: Action[];
    rules: { keybinding: number; command: string }[][];
    rulesDisposed: number;
    targets: ActionTarget[];
    addEditor(name: string): void;
    createdListener: (() => void) | null;
  };
}

function command(over: Partial<CommandDef> & { id: string }): CommandDef {
  return { title: `title.${over.id}`, run: () => {}, ...over };
}

function deps(
  over: Partial<BridgeDeps> & { api: MonacoBridgeApi },
): BridgeDeps & { fire(): void; run: ReturnType<typeof vi.fn> } {
  let listener: (() => void) | null = null;
  const run = vi.fn();
  const full: BridgeDeps = {
    list: () => [],
    removals: (): KeybindingRemoval[] => [],
    label: (def) => paletteLabel(def, (key) => key.replace(/^.*\./, '').toUpperCase()),
    onChanged: (cb): Disposable => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    isMac: true,
    ...over,
    run,
  };
  return Object.assign(full, {
    fire: () => listener?.(),
    run,
  });
}

describe('paletteLabel', () => {
  it('joins the category and the title, and falls back to the title alone', () => {
    const translate = (key: string) => ({ 'c.file': 'File', 't.save': 'Save' })[key] ?? key;
    expect(paletteLabel(command({ id: 'file.save', category: 'c.file', title: 't.save' }), translate)).toBe(
      'File: Save',
    );
    expect(paletteLabel(command({ id: 'file.save', title: 't.save' }), translate)).toBe('Save');
  });
});

describe('createBridge', () => {
  it('registers one gedit.* action per palette command, with its keybinding', () => {
    const api = fakeApi();
    const d = deps({
      api,
      list: () => [command({ id: 'file.save', keys: 'Mod+S' }), command({ id: 'nav.goto', keys: 'Ctrl+G' })],
    });
    createBridge(d);
    expect(api.actions.map((a) => a.id)).toEqual(['gedit.file.save', 'gedit.nav.goto']);
    expect(api.actions[0].label).toBe('SAVE');
    expect(api.actions[0].keybindings).toEqual([2048 | 49]);
    // Ctrl is the literal Control key, which is WinCtrl on macOS.
    expect(api.actions[1].keybindings).toEqual([256 | 37]);
  });

  it('skips `palette: false` and commands without a shortcut keep none', () => {
    const api = fakeApi();
    createBridge(
      deps({
        api,
        list: () => [
          command({ id: 'view.commandPalette', keys: 'F1', palette: false }),
          command({ id: 'file.closeAll' }),
        ],
      }),
    );
    expect(api.actions.map((a) => a.id)).toEqual(['gedit.file.closeAll']);
    expect(api.actions[0].keybindings).toBeUndefined();
  });

  it('runs the registry command when Monaco triggers the action', () => {
    const api = fakeApi();
    const d = deps({ api, list: () => [command({ id: 'file.save' })] });
    createBridge(d);
    api.actions[0].run({});
    expect(d.run).toHaveBeenCalledWith('file.save');
  });

  it('re-syncs when the registry changes, disposing the previous actions', () => {
    const api = fakeApi();
    let list = [command({ id: 'file.save' })];
    const d = deps({ api, list: () => list });
    createBridge(d);
    list = [command({ id: 'file.save' }), command({ id: 'file.open' })];
    d.fire();
    expect(api.actions.filter((a) => !a.disposed).map((a) => a.id)).toEqual([
      'gedit.file.save',
      'gedit.file.open',
    ]);
    expect(api.actions.filter((a) => a.disposed)).toHaveLength(1);
  });

  it('leaves Monaco alone when the registry has not changed', async () => {
    // G8: `commands.changed` is the ribbon's enablement signal too, so it fires on every
    // cursor move, tab switch and dirty flip. Disposing and re-adding 22 actions there
    // invalidates Monaco's keybinding resolver on essentially every keystroke.
    const api = fakeApi();
    const d = deps({
      api,
      list: () => [command({ id: 'file.save', keys: 'Mod+S' }), command({ id: 'file.open' })],
    });
    createBridge(d);
    const registered = api.actions.length;
    expect(registered).toBe(2);

    for (let i = 0; i < 10; i++) d.fire();

    expect(api.actions).toHaveLength(registered);
    expect(api.actions.some((a) => a.disposed)).toBe(false);
  });

  it('still re-syncs when only a label or a keybinding changed', () => {
    const api = fakeApi();
    let keys: string | undefined = 'Mod+S';
    const d = deps({ api, list: () => [command({ id: 'file.save', keys })] });
    createBridge(d);
    expect(api.actions[0].keybindings).toEqual([2048 | 49]);

    keys = undefined;
    d.fire();

    expect(api.actions).toHaveLength(2);
    expect(api.actions[0].disposed).toBe(true);
    expect(api.actions[1].keybindings).toBeUndefined();
  });

  it('adds the actions to the editor itself, so `getSupportedActions()` lists them', () => {
    // The regression this guards: `monaco.editor.addEditorAction()` registers a command
    // and a global keybinding but no `InternalEditorAction`, so F1 listed nothing.
    const api = fakeApi();
    createBridge(deps({ api, list: () => [command({ id: 'file.save', keys: 'Mod+S' })] }));
    expect(api.actions.map((a) => ({ id: a.id, editor: a.editor }))).toEqual([
      { id: 'gedit.file.save', editor: 'editor-1' },
    ]);
  });

  it('registers on an editor created later, after a microtask', async () => {
    const api = fakeApi();
    createBridge(deps({ api, list: () => [command({ id: 'file.save' })] }));
    api.addEditor('editor-2');
    // `addAction` needs the editor's keybinding service, which is assigned after
    // `onDidCreateEditor` fires, so the bridge defers.
    expect(api.actions.filter((a) => !a.disposed).map((a) => a.editor)).toEqual(['editor-1']);
    await Promise.resolve();
    expect(api.actions.filter((a) => !a.disposed).map((a) => a.editor)).toEqual([
      'editor-1',
      'editor-2',
    ]);
  });

  it('drops a queued editor sync when the bridge is disposed before it runs', async () => {
    const api = fakeApi();
    const dispose = createBridge(deps({ api, list: () => [command({ id: 'file.save' })] }));
    api.addEditor('editor-2'); // queues the deferred sync
    dispose(); // ... and the bridge goes away before the microtask runs
    await Promise.resolve();
    expect(api.createdListener).toBeNull();
    expect(api.actions.every((a) => a.disposed)).toBe(true);
    expect(api.actions.map((a) => a.editor)).toEqual(['editor-1']);
  });

  it('applies each keybinding removal once, prefixed with a minus', () => {
    const api = fakeApi();
    const d = deps({
      api,
      removals: () => [{ keys: 'F2', command: 'editor.action.rename' }],
    });
    createBridge(d);
    d.fire();
    expect(api.rules).toEqual([[{ keybinding: 60, command: '-editor.action.rename' }]]);
  });

  it('logs and skips a removal whose spec does not parse', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = fakeApi();
    createBridge(deps({ api, removals: () => [{ keys: 'Meta+Q', command: 'x' }] }));
    expect(api.rules).toEqual([]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('disposes its actions, its rules and its subscription, and tolerates a second call', () => {
    const api = fakeApi();
    const d = deps({
      api,
      list: () => [command({ id: 'file.save' })],
      removals: () => [{ keys: 'F2', command: 'editor.action.rename' }],
    });
    const dispose = createBridge(d);
    dispose();
    dispose();
    expect(api.actions.every((a) => a.disposed)).toBe(true);
    expect(api.rulesDisposed).toBe(1);
    d.fire();
    expect(api.actions).toHaveLength(1);
  });
});
