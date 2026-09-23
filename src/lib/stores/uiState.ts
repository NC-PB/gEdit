// The webview's half of `state.json` (plan §7.3, §7.7, AD-8). Owner: WP2.3.
//
// Rust owns the file and the `recent` member; everything under `ui` is written here and
// merged in by `ui_state_save`. Three things live in it:
//
//   - `layout`: the panel layout `contrib/layoutPersist.ts` restores and then follows,
//   - `lastParams`: the last values of every form, by form key (M4/M5),
//   - `lastScript`: what `script.runLast` repeats (M5).
//
// Writes are debounced by one second, so dragging a splitter writes once rather than on
// every animation frame, and `files.onWillQuit` flushes what is still pending before the
// window goes away (`contrib/layoutPersist.ts` registers that handler).
//
// `createUiStateStore(deps)` plus the singleton wired to the real command wrappers
// (AD-2), so a unit test drives the debounce with a fake clock and never needs Tauri.

import { derived, writable } from 'svelte/store';
import { status as appStatus } from '$lib/app/status';
import { configLoad, uiStateSave, type ConfigLoad } from '$lib/platform/commands';
import { isTauriRuntime } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { FileMemo, LayoutState, UiState, UiStateStore } from '$lib/app/types';

/** How long a change waits before it reaches the disk (§7.3: "1 s debounced save"). */
export const SAVE_DEBOUNCE_MS = 1000;

/** What a window with no saved state looks like. */
export function emptyUiState(): UiState {
  return { layout: {}, lastParams: {}, lastScript: null, files: {} };
}

/**
 * Rust's own English text out of an IPC rejection, for the status item's tooltip
 * (AD-14). Written out here rather than imported from `app/dialogs.ts`, whose import
 * graph reaches the Tauri dialog plugin — nothing in a store's may.
 */
function detailOf(err: unknown): string {
  if (typeof err === 'string') return err;
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// The one `config_load` round trip
// ---------------------------------------------------------------------------

let configOnce: Promise<ConfigLoad> | null = null;

/**
 * `config_load` answers with `settings.json` **and** the `ui` member of `state.json`, so
 * startup must not call it twice (AD-8: one round trip). `stores/settings.ts` (WP2.6)
 * runs first and this store second, and whichever gets here first pays for the call.
 *
 * Only for the startup read: `settings.reloadFromDisk()` wants fresh bytes and calls
 * `configLoad()` itself.
 */
export function loadConfigOnce(): Promise<ConfigLoad> {
  configOnce ??= configLoad();
  return configOnce;
}

/** Forgets the memoized `config_load`, so a test can start from nothing. */
export function resetConfigOnceForTest(): void {
  configOnce = null;
}

// ---------------------------------------------------------------------------
// Reading what is on disk
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boolOr(value: unknown, fallback: boolean | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : fallback;
}

function sizeOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function panelIdOf(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

/**
 * The region members of a hand-edited or outdated `ui.layout`. Everything that is not the
 * declared type is dropped rather than repaired, so `layout.restore()` keeps its current
 * value for it; the sizes it does accept are clamped there.
 */
function regionOf(value: unknown, size: 'width' | 'height'): Partial<LayoutState['left']> | undefined {
  if (!isRecord(value)) return undefined;
  const region: Record<string, unknown> = {};
  const visible = boolOr(value.visible, undefined);
  if (visible !== undefined) region.visible = visible;
  const px = sizeOf(value[size]);
  if (px !== undefined) region[size] = px;
  const active = panelIdOf(value.active);
  if (active !== undefined) region.active = active;
  return Object.keys(region).length > 0 ? (region as Partial<LayoutState['left']>) : undefined;
}

function layoutOf(value: unknown): Partial<LayoutState> {
  if (!isRecord(value)) return {};
  const layout: Partial<LayoutState> = {};
  const left = regionOf(value.left, 'width');
  if (left) layout.left = left as LayoutState['left'];
  const bottom = regionOf(value.bottom, 'height');
  if (bottom) layout.bottom = bottom as LayoutState['bottom'];
  const overlay = panelIdOf(value.overlay);
  if (overlay !== undefined) layout.overlay = overlay;
  return layout;
}

/**
 * `params[key] = entry`, for a key that comes from `state.json`.
 *
 * Bracket assignment would hand `__proto__` to `Object.prototype`'s setter, which changes
 * the accumulator's prototype rather than storing the entry — and `getLastParams` would
 * then answer with a value inherited from that prototype (G8 M2). Both sides are fixed:
 * this writes an own property, and the getter below only reads own ones.
 */
function put(params: Record<string, unknown>, key: string, entry: unknown): void {
  Object.defineProperty(params, key, {
    value: entry,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function lastParamsOf(value: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) return {};
  const params: Record<string, Record<string, unknown>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isRecord(entry)) put(params, key, entry);
  }
  return params;
}

function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * The per-file memory of `ui.files` (§7.9, AD-22), path by path.
 *
 * Two rules, and they pull in opposite directions on purpose:
 *
 *  - an entry that does not carry the four members every reader relies on (`line`,
 *    `column`, `top`, `at`) is **dropped**, because a half memo would have to be
 *    guessed at by every consumer;
 *  - an entry that does is **kept whole**, unknown members included. A later
 *    milestone adds one (M10's `channelId`, §7.14), and a user who runs that build,
 *    then this one, then that one again must get their channel assignments back
 *    rather than have them quietly erased in between.
 *
 * `machineId` is deliberately not defaulted: `undefined` ("follow the profile") and
 * `null` ("none") are different answers (AD-31), and only the entry itself knows
 * which one was meant.
 */
function filesOf(value: unknown): Record<string, FileMemo> {
  if (!isRecord(value)) return {};
  const files: Record<string, FileMemo> = {};
  for (const [path, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    if (!isLine(entry.line) || !isLine(entry.column) || !isLine(entry.top)) continue;
    if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) continue;
    const bookmarks = Array.isArray(entry.bookmarks) ? entry.bookmarks.filter(isLine) : [];
    // `put` writes an own property, so a path spelled `__proto__` cannot reach
    // `Object.prototype`'s setter (the G8 M2 finding, same fix as `lastParams`).
    put(files, path, { ...entry, bookmarks });
  }
  return files;
}

/** A `ui` member straight from disk, reduced to the shape `UiState` promises. */
export function sanitizeUiState(raw: unknown): UiState {
  const source = isRecord(raw) ? raw : {};
  return {
    layout: layoutOf(source.layout),
    lastParams: lastParamsOf(source.lastParams),
    lastScript: typeof source.lastScript === 'string' ? source.lastScript : null,
    files: filesOf(source.files),
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface UiStateDeps {
  /**
   * The `ui` member of `state.json` plus the English detail of a file that could not be
   * read. A rejection is an IPC failure; a broken *file* comes back as `{}` plus `error`.
   */
  load(): Promise<{ ui: unknown; error: string | null }>;
  save(ui: Record<string, unknown>): Promise<void>;
  /** Shown in the status bar; `detail` is the untranslated backend text (AD-14). */
  notify(text: string, detail?: string): void;
  debounceMs: number;
}

export function createUiStateStore(deps: UiStateDeps): UiStateStore {
  const state = writable<UiState>(emptyUiState());
  let current: UiState = emptyUiState();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** True while a change has not reached `deps.save` yet. */
  let unsaved = false;
  /** Serializes the writes, so `flush()` can wait for the one already in flight. */
  let writing: Promise<void> = Promise.resolve();
  /** Set by the first `update()`; a late `load()` must not undo the user's layout. */
  let touched = false;
  let loaded = false;
  /** Whether the user has been told, once, that `state.json` cannot be written. */
  let told = false;

  function set(next: UiState): void {
    current = next;
    state.set(next);
  }

  function writeNow(): Promise<void> {
    if (!unsaved) return writing;
    unsaved = false;
    const payload: Record<string, unknown> = {
      layout: current.layout,
      lastParams: current.lastParams,
      lastScript: current.lastScript,
      files: current.files,
    };
    writing = writing.then(() => deps.save(payload)).catch((err: unknown) => {
      // A warning, not an error: the runtime harness fails a scenario on a console error,
      // and a state file that cannot be written must not take a run down (AD-8).
      console.warn('the UI state could not be saved', err);
      // **Once**, and only once, in the status bar. This runs a second after every
      // splitter drag and panel toggle, so notifying every time would paint the status
      // bar red over and over and hide the messages that matter — which is why it used
      // to say nothing at all. But saying nothing at all was wrong too (G8 M7):
      // `state.json` is the one file the session list, the recent list, the layout and
      // the per-file memory all share, and Rust refuses to write any of it once the
      // whole is over 1 MiB. Everything the user asked gEdit to remember would then
      // stop being remembered in silence. `detail` carries Rust's own English text,
      // which names the limit (AD-14).
      if (!told) {
        told = true;
        deps.notify(t('uiState.saveFailed'), detailOf(err));
      }
    });
    return writing;
  }

  function schedule(): void {
    unsaved = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void writeNow();
    }, deps.debounceMs);
  }

  function update(fn: (s: UiState) => UiState): void {
    touched = true;
    set(fn(current));
    schedule();
  }

  return {
    state: derived(state, (s) => s),

    /** Never throws: `bootstrap` awaits it and a broken file may not stop startup. */
    async load(): Promise<void> {
      if (loaded) return;
      loaded = true;
      let answer: { ui: unknown; error: string | null };
      try {
        answer = await deps.load();
      } catch (err) {
        // The command itself failed: no config folder, no Tauri, a backend that is not
        // there. There is nothing the user can do about it and nothing was lost, so it
        // stays in the console. AD-8's notice is for a *file* that could not be parsed,
        // which comes back as `error` below.
        console.warn('the UI state could not be read', err);
        return;
      }
      if (answer.error !== null) deps.notify(t('uiState.loadFailed'), answer.error);
      // A contribution that wrote while the read was in flight owns the state now.
      if (!touched) set(sanitizeUiState(answer.ui));
    },

    update,

    getLastParams(key: string): Record<string, unknown> | undefined {
      // Own properties only: `lastParams['__proto__']` would otherwise answer with
      // `Object.prototype` for a form whose key happens to be that (G8 M2).
      return Object.prototype.hasOwnProperty.call(current.lastParams, key)
        ? current.lastParams[key]
        : undefined;
    },

    setLastParams(key: string, v: Record<string, unknown>): void {
      update((s) => ({ ...s, lastParams: { ...s.lastParams, [key]: v } }));
    },

    async flush(): Promise<void> {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await writeNow();
    },
  };
}

/** The application-wide UI state. */
export const uiState: UiStateStore = createUiStateStore({
  async load() {
    // A plain browser (`vite dev` without Tauri) has no config folder to read.
    if (!isTauriRuntime()) return { ui: {}, error: null };
    const config = await loadConfigOnce();
    return { ui: config.ui, error: config.stateError };
  },
  async save(ui) {
    if (!isTauriRuntime()) return;
    await uiStateSave(ui);
  },
  notify: (text, detail) => appStatus.show(text, { error: true, detail }),
  debounceMs: SAVE_DEBOUNCE_MS,
});
