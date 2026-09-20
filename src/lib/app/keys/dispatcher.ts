// The window key dispatcher (plan AD-4). Owner: WP1.1.
//
// It listens on `window` in the bubble phase and runs `global` commands when focus is
// outside Monaco. It ignores events that are `defaultPrevented`, `isComposing`, carry the
// `AltGraph` state (D21: Ctrl+Alt is AltGr on some Windows layouts) or whose target is a
// text input or sits inside `.monaco-editor`, and it is suspended while a modal is open.
// Inside Monaco the same shortcuts arrive through `app/keys/monacoBridge.ts` instead.
//
// A key is only swallowed once a command will really run: a disabled one is passed over,
// because consuming the key and then reporting "not available right now" is worse than
// doing nothing.

import { commands } from '$lib/app/registry/commands';
import { modals } from '$lib/app/modals';
import { matchesKey, resolveKeys } from '$lib/core/keys/keySpec';
import { isMacPlatform } from '$lib/utils/platform';
import type { CommandDef, Disposable } from '$lib/app/types';
import type { KeyEventLike } from '$lib/core/keys/keySpec';

/** What the dispatcher reads off a keydown event. `KeyboardEvent` satisfies it. */
export interface DispatchEvent extends KeyEventLike {
  defaultPrevented: boolean;
  isComposing: boolean;
  target: unknown;
  getModifierState?(key: string): boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface DispatcherDeps {
  list(): CommandDef[];
  run(id: string): void;
  /** Whether the command would run right now; a disabled one must keep the key. */
  isEnabled(id: string): boolean;
  isModalOpen(): boolean;
  isMac: boolean;
}

/** Elements whose own key handling wins: text fields and anything inside the editor. */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA']);

interface TargetLike {
  tagName?: unknown;
  isContentEditable?: unknown;
  closest?: (selector: string) => unknown;
}

function tagOf(target: unknown): string {
  if (!target || typeof target !== 'object') return '';
  const el = target as TargetLike;
  return typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
}

export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as TargetLike;
  if (EDITABLE_TAGS.has(tagOf(target))) return true;
  if (el.isContentEditable === true) return true;
  if (typeof el.closest === 'function') {
    try {
      if (el.closest('.monaco-editor')) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * A focused `<select>` — the ribbon's script and block pickers — is not a text field: it
 * never consumes Cmd+S or Cmd+O, and while it has focus Monaco's editor-scoped bindings
 * do not fire either, so treating it as one made every global shortcut dead (G8). The one
 * thing it does own is its type-ahead, which is a bare printable character.
 */
export function isSelectTypeAhead(e: DispatchEvent): boolean {
  if (tagOf(e.target) !== 'SELECT') return false;
  if (typeof e.key !== 'string' || [...e.key].length !== 1) return false;
  return !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * Runs the first matching `global` command. Returns the command id it dispatched, or
 * null when the event is none of its business.
 */
export function dispatchKey(e: DispatchEvent, deps: DispatcherDeps): string | null {
  if (deps.isModalOpen()) return null;
  if (e.defaultPrevented || e.isComposing) return null;
  if (typeof e.getModifierState === 'function' && e.getModifierState('AltGraph')) return null;
  if (isEditableTarget(e.target) || isSelectTypeAhead(e)) return null;

  for (const def of deps.list()) {
    if (!def.global) continue;
    const spec = resolveKeys(def.keys, deps.isMac);
    if (!spec) continue;
    let matched: boolean;
    try {
      matched = matchesKey(spec, e, deps.isMac);
    } catch {
      // An invalid spec is already reported by `commands.register`.
      continue;
    }
    if (!matched) continue;
    // Enablement is checked BEFORE the event is swallowed: `commands.run` would answer a
    // disabled command with "… is not available right now" in the status bar, and the key
    // would be gone either way. Ctrl+Tab with a single tab open is the everyday case.
    if (!deps.isEnabled(def.id)) continue;
    e.preventDefault();
    e.stopPropagation();
    deps.run(def.id);
    return def.id;
  }
  return null;
}

/** Installs the real dispatcher on `window`. */
export function installDispatcher(): Disposable {
  if (typeof window === 'undefined') return () => {};

  let modalOpen = false;
  const unsubscribe = modals.isOpen.subscribe((open) => {
    modalOpen = open;
  });

  const deps: DispatcherDeps = {
    list: () => commands.list(),
    run: (id) => {
      void commands.run(id);
    },
    isEnabled: (id) => commands.isEnabled(id),
    isModalOpen: () => modalOpen,
    isMac: isMacPlatform(),
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    dispatchKey(e, deps);
  };

  window.addEventListener('keydown', onKeyDown);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('keydown', onKeyDown);
    unsubscribe();
  };
}
