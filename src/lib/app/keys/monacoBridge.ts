// The Monaco bridge (plan AD-4). Owner: WP1.1.
//
// Every command with `palette !== false` becomes an editor action `gedit.<id>` on each
// standalone editor, labelled `${t(category)}: ${t(title)}`, so F1 lists it with its
// shortcut and Monaco dispatches the shortcut while the editor has focus.
//
// The action has to go through `IStandaloneCodeEditor.addAction`, not the static
// `monaco.editor.addEditorAction`: the static call only registers a command and a global
// keybinding and never builds an `InternalEditorAction`, so the editor's own action list
// — what `getSupportedActions()` returns and what the F1 palette reads — stayed empty
// and F1 listed Monaco's built-ins alone.
//
// Default Monaco bindings that a contribution takes over are dropped with
// `addKeybindingRules([{ keybinding, command: '-<monacoId>' }])`; those stay global.
//
// `commands.changed` and `onDidCreateEditor` both ask the bridge to re-check itself, so a
// contribution registered later still reaches the palette and a re-attached editor gets
// the actions too. Re-checking is not re-registering: `changed` doubles as the ribbon's
// enablement signal and fires on every cursor move, so the actions are only rebuilt when
// their id/label/keybinding list or the set of editors has actually changed.
//
// Installed by `app/bootstrap.ts` after `editor.ready`.

import { commands } from '$lib/app/registry/commands';
import { keybindingRemovals, type KeybindingRemoval } from '$lib/app/registry/keybindings';
import { toMonacoKeybinding, resolveKeys } from '$lib/core/keys/keySpec';
import { t } from '$lib/i18n';
import { isMacPlatform } from '$lib/utils/platform';
import type { CommandDef, Disposable } from '$lib/app/types';
import type { Monaco } from '$lib/monaco/setup';

interface MonacoDisposable {
  dispose(): void;
}

/** The descriptor `IStandaloneCodeEditor.addAction` takes. */
export interface ActionDescriptor {
  id: string;
  label: string;
  keybindings?: number[];
  run(...args: unknown[]): void;
}

/** The one editor capability the bridge needs. */
export interface ActionTarget {
  addAction(descriptor: ActionDescriptor): MonacoDisposable;
}

/** The slice of `monaco.editor` the bridge uses, so a unit test can hand it a fake. */
export interface MonacoBridgeApi {
  /** The standalone editors that exist right now. */
  editors(): ActionTarget[];
  /** Fires for every editor created after this call. */
  onDidCreateEditor(cb: () => void): MonacoDisposable;
  addKeybindingRules(rules: { keybinding: number; command: string }[]): MonacoDisposable;
  KeyMod: Parameters<typeof toMonacoKeybinding>[2];
  KeyCode: Parameters<typeof toMonacoKeybinding>[3];
}

export interface BridgeDeps {
  api: MonacoBridgeApi;
  list(): CommandDef[];
  removals(): KeybindingRemoval[];
  run(id: string): void;
  label(def: CommandDef): string;
  onChanged(cb: () => void): Disposable;
  isMac: boolean;
}

/** `${t(category)}: ${t(title)}`, or just the title when the command has no category. */
export function paletteLabel(def: CommandDef, translate: (key: string) => string): string {
  const title = translate(def.title);
  return def.category ? `${translate(def.category)}: ${title}` : title;
}

function keybindingsOf(def: CommandDef, deps: BridgeDeps): number[] | undefined {
  const spec = resolveKeys(def.keys, deps.isMac);
  if (!spec) return undefined;
  try {
    return [toMonacoKeybinding(spec, deps.isMac, deps.api.KeyMod, deps.api.KeyCode)];
  } catch (err) {
    console.error(`command "${def.id}": cannot map "${spec}" to a Monaco keybinding`, err);
    return undefined;
  }
}

/** Mirrors the registry into Monaco and keeps it in sync. */
export function createBridge(deps: BridgeDeps): Disposable {
  let actions: MonacoDisposable[] = [];
  /** Removals are global and applied once per distinct rule. */
  const appliedRemovals = new Set<string>();
  let rules: MonacoDisposable[] = [];

  const syncRemovals = (): void => {
    const pending: { keybinding: number; command: string }[] = [];
    for (const removal of deps.removals()) {
      const signature = `${removal.keys}\u0000${removal.command}`;
      if (appliedRemovals.has(signature)) continue;
      appliedRemovals.add(signature);
      try {
        pending.push({
          keybinding: toMonacoKeybinding(
            removal.keys,
            deps.isMac,
            deps.api.KeyMod,
            deps.api.KeyCode,
          ),
          command: `-${removal.command}`,
        });
      } catch (err) {
        console.error(`keybinding removal "${removal.keys}" is not a valid key spec`, err);
      }
    }
    if (pending.length) rules.push(deps.api.addKeybindingRules(pending));
  };

  let disposed = false;

  /** The editors the actions are currently registered on, compared by identity. */
  let syncedTargets: ActionTarget[] | null = null;
  /** What was registered last time: id, label and keybinding of every action. */
  let syncedSignature = '';

  const sameTargets = (targets: ActionTarget[]): boolean =>
    syncedTargets !== null &&
    syncedTargets.length === targets.length &&
    targets.every((target, i) => syncedTargets?.[i] === target);

  const sync = (): void => {
    syncRemovals();

    const defs = deps.list().filter((def) => def.palette !== false);
    const wanted = defs.map((def) => ({
      def,
      descriptor: {
        id: `gedit.${def.id}`,
        label: deps.label(def),
        keybindings: keybindingsOf(def, deps),
      },
    }));
    // The editors are re-read every time: a disposed one drops out of the list and a
    // re-attached one appears in it.
    const targets = deps.api.editors();

    // `commands.changed` is also the ribbon's enablement signal, so it fires on every
    // cursor move, tab switch and dirty flip — many times a second while a key is held.
    // Re-adding the actions there would be wrong as well as wasteful: every `addAction`
    // and every dispose calls `addDynamicKeybindings`, which throws Monaco's cached
    // keybinding resolver away, so the next keystroke rebuilds it over ~200 default
    // bindings. Nothing needs re-registering unless the actions or the editors changed.
    const signature = wanted
      .map((w) => `${w.descriptor.id}\u0000${w.descriptor.label}\u0000${w.descriptor.keybindings?.join('+') ?? ''}`)
      .join('\u0001');
    if (signature === syncedSignature && sameTargets(targets)) return;
    syncedSignature = signature;
    syncedTargets = [...targets]; // a copy: `editors()` may hand back a live list

    for (const action of actions) action.dispose();
    actions = [];
    for (const target of targets) {
      for (const { def, descriptor } of wanted) {
        actions.push(
          target.addAction({
            ...descriptor,
            run: () => {
              deps.run(def.id);
            },
          }),
        );
      }
    }
  };

  sync();
  const unsubscribe = deps.onChanged(sync);
  // `onDidCreateEditor` fires from `CodeEditorWidget`'s constructor, before
  // `StandaloneCodeEditor` has assigned its keybinding service — and `addAction` needs
  // that service, or it warns and registers nothing. Defer one microtask so the editor
  // is fully built.
  const created = deps.api.onDidCreateEditor(() => {
    queueMicrotask(() => {
      if (!disposed) sync();
    });
  });

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    created.dispose();
    for (const action of actions) action.dispose();
    actions = [];
    for (const rule of rules) rule.dispose();
    rules = [];
    appliedRemovals.clear();
  };
}

/**
 * `getEditors()` is typed as the narrower `ICodeEditor`, which has no `addAction`, and a
 * diff editor's inner editors are plain code editors. Only the ones that can take an
 * action get one.
 */
function actionTarget(editor: unknown): ActionTarget | null {
  const candidate = editor as Partial<ActionTarget> | null;
  return candidate && typeof candidate.addAction === 'function'
    ? (candidate as ActionTarget)
    : null;
}

/** Installs the bridge on the real Monaco instance. */
export function installMonacoBridge(monaco: Monaco): Disposable {
  return createBridge({
    api: {
      editors: () => {
        const targets: ActionTarget[] = [];
        for (const editor of monaco.editor.getEditors()) {
          const target = actionTarget(editor);
          if (target) targets.push(target);
        }
        return targets;
      },
      onDidCreateEditor: (cb) => monaco.editor.onDidCreateEditor(() => cb()),
      addKeybindingRules: (list) => monaco.editor.addKeybindingRules(list),
      KeyMod: monaco.KeyMod,
      KeyCode: monaco.KeyCode,
    },
    list: () => commands.list(),
    removals: () => keybindingRemovals.list(),
    run: (id) => {
      void commands.run(id);
    },
    label: (def) => paletteLabel(def, t),
    onChanged: (cb) => {
      let first = true;
      return commands.changed.subscribe(() => {
        // `subscribe` fires immediately; the initial sync already ran.
        if (first) {
          first = false;
          return;
        }
        cb();
      });
    },
    isMac: isMacPlatform(),
  });
}
