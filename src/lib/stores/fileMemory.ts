// Per-file memory: where you were in a file, and what you chose for it (plan §7.9,
// AD-22). Owner: WP7.5 (the M7 prelude wrote the stub this replaces).
//
// The memos live in `UiState.files`, keyed by absolute path, and reach disk through
// `stores/uiState.ts` — so they inherit its 1 s debounce and its quit flush, and they
// are covered by the same 1 MiB cap on `state.json`. What this module adds is the
// rules: at most 500 paths (least recently used out), at most 200 bookmarks each,
// at most [`MAX_REMEMBERED_BYTES`] of `state.json` for all of them together, and
// bookmarks clamped to the file's line count when it is read back (`bookmarks.set`).
//
// The byte bound is the one that is not obvious and the one that matters most: the
// file is pretty-printed, so the entry count alone is no bound on its size, and a
// `state.json` over the cap is not a memo lost — it is every writer of that file
// failing at once, for good. See [`MAX_REMEMBERED_BYTES`].
//
// Why a memo is never load-bearing: it is written on close, on tab switch and before
// quit, for a file whose content can change under it at any time. A memo that is
// missing, stale, or points at a profile or a machine that no longer exists is
// therefore *ignored*, and the file opens exactly as it would have without one. The
// one member that needs care is `machineId`, where `undefined` ("nothing remembered")
// and `null` ("remembered as none") are different answers (AD-31).
//
// Three rules carry the weight, and each has a test that fails without it:
//
//  1. **`files.rememberPerFile` is honoured here, not at the call sites.** With the
//     setting off every read answers "nothing remembered" and every `remember` is
//     dropped, so no caller can restore a dialect the user asked gEdit to forget —
//     `fileOps.open` (WP7.3) consults `profileFor`/`machineFor` and needs no gate of
//     its own. What is already in the file is kept, so turning the setting back on
//     brings the old memos back rather than starting from nothing.
//  2. **A memo that carries nothing is not stored.** Line 1, column 1, top 1, no
//     bookmarks and no choice is what a freshly opened file looks like anyway, so
//     writing it would fill the 500 slots with entries that change no behaviour and
//     push the ones that do out of the table.
//  3. **A remembered profile id is checked against the registry before it is handed
//     out.** `machineId` deliberately is *not*: `stores/machines.ts` is the authority
//     on whether a machine is usable for a document and already falls back with one
//     message (AD-31), and a second check here would race the machine file's load.
//
// Nothing here ever widens the fs scope: a remembered path is a key, not a permission.
//
// `createFileMemory(deps)` plus the singleton wired to `uiState` and the real stores
// (AD-2), so a unit test drives the LRU and the caps without Tauri.

import { get } from 'svelte/store';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { settings as appSettings } from '$lib/stores/settings';
import { uiState as appUiState } from '$lib/stores/uiState';
import type { FileMemo, FileMemoryStore } from '$lib/app/types';

/** At most this many paths are remembered; the least recently used one goes first. */
export const MAX_REMEMBERED_FILES = 500;

/** At most this many bookmarks per file. */
export const MAX_REMEMBERED_BOOKMARKS = 200;

/**
 * At most this many bytes of `state.json`, all memos together.
 *
 * **Counting entries is not a bound on the size of the file**, and that is what this
 * constant is here to fix (G8 M7). Rust writes `state.json` with
 * `serde_json::to_vec_pretty`, so every bookmark becomes a line of its own with ten
 * spaces in front of it: 500 files × 200 bookmarks is 1.56 MiB pretty, over
 * `config::MAX_FILE_BYTES` (1 MiB). Past that point `save_json_object_versioned`
 * refuses **every** write of that file — and `state.rs` has one road in, so the session
 * list, the recent list and the window layout all stop persisting together, with
 * nothing on screen to say so and no way back from inside the app, because the table
 * never shrinks below its 500-entry cap. The threshold is crossed at around 130
 * bookmarks across 500 files, which is a programmer who bookmarks heavily rather than
 * a pathological case. (The plan's §7.11 estimate of "about 200 KiB at its caps" was
 * out by a factor of eight; it is corrected there.)
 *
 * 384 KiB leaves 640 KiB of the file for `recent`, `ui.layout`, `ui.lastParams` and
 * `session` — an enormous margin — and it still holds 500 files with the handful of
 * bookmarks most of them have, or a hundred files at the full 200. What gives way when
 * it is reached is the least recently written memo, which is what the LRU is for.
 */
export const MAX_REMEMBERED_BYTES = 384 * 1024;

/**
 * Roughly what one memo costs in the pretty-printed `state.json`, in bytes.
 *
 * Measured against `serde_json::to_vec_pretty` at the nesting `ui.files` really sits
 * at: about 71 bytes of braces and indentation per memo, plus the compact JSON, plus
 * eleven bytes of indent and newline for every bookmark line. The two constants are
 * rounded **up** from those measurements, because being a little over evicts one memo
 * early and being under lets the whole file stop being written.
 */
const MEMO_OVERHEAD_BYTES = 80;
const BOOKMARK_LINE_BYTES = 12;

function memoBytes(path: string, memo: FileMemo): number {
  return (
    JSON.stringify(path).length +
    JSON.stringify(memo).length +
    MEMO_OVERHEAD_BYTES +
    memo.bookmarks.length * BOOKMARK_LINE_BYTES
  );
}

/** Everything the store reaches for, so a unit test never needs Tauri (AD-2). */
export interface FileMemoryDeps {
  /** The `files` member of the live UI state. */
  read(): Record<string, FileMemo>;
  /** Replaces it; the singleton routes this through `uiState.update` and its debounce. */
  write(files: Record<string, FileMemo>): void;
  /** `files.rememberPerFile`. Read on every call, so a change takes effect at once. */
  enabled(): boolean;
  /** Whether a remembered dialect still exists (rule 3). */
  knownProfile(id: string): boolean;
  /** `Date.now()` in the application; the LRU key. */
  now(): number;
}

/** A 1-based line or column, as `UiState` promises them. */
function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function lineOr(value: unknown, fallback: number): number {
  return isLine(value) ? value : fallback;
}

/**
 * The bookmarks of a memo: 1-based integers, without duplicates, ascending, at most
 * [`MAX_REMEMBERED_BOOKMARKS`].
 *
 * The **lowest** ones survive the cap rather than the newest, because a bookmark has no
 * age — `bookmarks.lines()` reads them back out of Monaco's decorations in line order,
 * so "the first 200 marks in the file" is the only stable answer. Anything that is not a
 * line at all is dropped here, so a hand-edited `state.json` cannot put a decoration
 * anywhere surprising when the file is opened again.
 */
function bookmarksOf(value: unknown): number[] {
  const lines = Array.isArray(value) ? value.filter(isLine) : [];
  return [...new Set(lines)].sort((a, b) => a - b).slice(0, MAX_REMEMBERED_BOOKMARKS);
}

/** The members this build knows about; anything else came from a later milestone. */
const KNOWN_MEMBERS = new Set(['line', 'column', 'top', 'bookmarks', 'profileId', 'machineId', 'at']);

/**
 * Whether `memo` would change anything about how the file opens (rule 2).
 *
 * `machineId` counts even when it is `null`: an explicit "none" is a decision, and
 * forgetting it would let the profile's default machine take the document over.
 */
function carriesSomething(memo: FileMemo): boolean {
  if (memo.line > 1 || memo.column > 1 || memo.top > 1) return true;
  if (memo.bookmarks.length > 0) return true;
  if (memo.profileId !== undefined) return true;
  if ('machineId' in memo) return true;
  // A member a later milestone added (M10's `channelId`, §7.14) is worth keeping too:
  // this build does not know what it means, which is exactly why it may not throw it
  // away. `at` is the LRU stamp and says nothing on its own.
  return Object.keys(memo).some((key) => !KNOWN_MEMBERS.has(key));
}

/**
 * `files[path] = memo`, written as an **own** property.
 *
 * Bracket assignment would hand a path spelled `__proto__` to `Object.prototype`'s
 * setter instead of storing the memo — the same fix `stores/uiState.ts` makes for
 * `lastParams` and `files` on the way in (G8 M2).
 */
function put(files: Record<string, FileMemo>, path: string, memo: FileMemo): void {
  Object.defineProperty(files, path, { value: memo, enumerable: true, writable: true, configurable: true });
}

function own(files: Record<string, FileMemo>, path: string): FileMemo | undefined {
  return Object.prototype.hasOwnProperty.call(files, path) ? files[path] : undefined;
}

export function createFileMemory(deps: FileMemoryDeps): FileMemoryStore {
  function memoOf(path: string): FileMemo | undefined {
    if (!deps.enabled() || path === '') return undefined;
    return own(deps.read(), path);
  }

  return {
    get(path: string): FileMemo | undefined {
      return memoOf(path);
    },

    profileFor(path: string): string | undefined {
      const wanted = memoOf(path)?.profileId;
      // A dialect that was uninstalled, renamed or never existed is ignored, and the
      // file is detected the way it would have been without a memo. Handing the id out
      // would set a Monaco language nobody has registered.
      return wanted !== undefined && deps.knownProfile(wanted) ? wanted : undefined;
    },

    machineFor(path: string): string | null | undefined {
      const memo = memoOf(path);
      // `'machineId' in memo` and not `memo?.machineId`: `null` is an explicit "none"
      // and must reach the caller as `null`, not as "nothing remembered" (AD-31).
      return memo !== undefined && 'machineId' in memo ? memo.machineId : undefined;
    },

    /**
     * Merges `patch` into the memo for `path` and moves it to the front of the LRU.
     *
     * A member that is **present in `patch` with the value `undefined`** is removed
     * from the memo — that is how "follow the profile's default machine" is recorded,
     * because `docs.update` cannot put `DocMeta.machineId` back to `undefined` and a
     * memo that kept the old id would hand the choice back at the next start (the M6
     * hand-off's `FOLLOW_DEFAULT` note). A member that is simply absent from `patch` is
     * left as it was.
     */
    remember(path: string, patch: Partial<Omit<FileMemo, 'at'>>): void {
      if (!deps.enabled() || path === '') return;
      const files = deps.read();
      const base = own(files, path);
      const merged: Record<string, unknown> = { ...(base ?? {}) };
      for (const key of Object.keys(patch)) {
        const value = (patch as Record<string, unknown>)[key];
        if (value === undefined) delete merged[key];
        else merged[key] = value;
      }

      const memo: FileMemo = {
        // Everything the memo already carried, the members this build does not know
        // included (rule: a later milestone's `channelId` survives an M7 run).
        ...(merged as unknown as FileMemo),
        // The four members `sanitizeUiState` insists on: a memo missing one of them is
        // dropped on the way back in, so it is repaired on the way out instead.
        line: lineOr(merged.line, 1),
        column: lineOr(merged.column, 1),
        top: lineOr(merged.top, 1),
        bookmarks: bookmarksOf(merged.bookmarks),
        at: deps.now(),
      };
      if (typeof memo.profileId !== 'string') delete memo.profileId;

      if (!carriesSomething(memo)) {
        if (base === undefined) return;
        // It used to carry something and does not any more (every bookmark removed, a
        // machine choice reset): the entry goes rather than sitting in the table as a
        // memo that restores nothing.
        const kept: Record<string, FileMemo> = {};
        for (const [key, value] of Object.entries(files)) if (key !== path) put(kept, key, value);
        deps.write(kept);
        return;
      }

      const next: Record<string, FileMemo> = {};
      for (const [key, value] of Object.entries(files)) if (key !== path) put(next, key, value);
      // Written last, so insertion order is "least recently written first" and the
      // eviction below can break a tie between two memos stamped in the same
      // millisecond without ever picking the one that was just written.
      put(next, path, memo);
      deps.write(evict(next));
    },

    forget(path: string): void {
      // Not gated on `enabled()`: forgetting is always allowed, so a caller that wants a
      // memo gone can rely on it whatever the setting says.
      const files = deps.read();
      if (own(files, path) === undefined) return;
      const next: Record<string, FileMemo> = {};
      for (const [key, value] of Object.entries(files)) if (key !== path) put(next, key, value);
      deps.write(next);
    },
  };
}

/**
 * Drops the least recently written memos until at most [`MAX_REMEMBERED_FILES`] are
 * left **and** they fit inside [`MAX_REMEMBERED_BYTES`]. `files` is in insertion order,
 * oldest first, and `at` breaks nothing it does not already agree with — a file
 * hand-edited into the table with a future stamp still loses its place to the files the
 * user actually opened.
 *
 * Both bounds, because either one alone lets the file grow without limit in the other
 * direction: 500 entries say nothing about their size once each may carry 200
 * bookmarks and a path of any length (G8 M7).
 */
function evict(files: Record<string, FileMemo>): Record<string, FileMemo> {
  const entries = Object.entries(files);
  const order = entries.map(([path, memo], index) => ({
    path,
    memo,
    index,
    bytes: memoBytes(path, memo),
  }));
  let total = order.reduce((sum, entry) => sum + entry.bytes, 0);
  if (entries.length <= MAX_REMEMBERED_FILES && total <= MAX_REMEMBERED_BYTES) return files;
  order.sort((a, b) => a.memo.at - b.memo.at || a.index - b.index);
  const doomed = new Set<string>();
  let over = entries.length - MAX_REMEMBERED_FILES;
  for (const entry of order) {
    if (over <= 0 && total <= MAX_REMEMBERED_BYTES) break;
    doomed.add(entry.path);
    total -= entry.bytes;
    over -= 1;
  }
  const kept: Record<string, FileMemo> = {};
  for (const [path, memo] of entries) if (!doomed.has(path)) put(kept, path, memo);
  return kept;
}

/** The application-wide per-file memory (`ctx.fileMemory`). */
export const fileMemory: FileMemoryStore = createFileMemory({
  read: () => get(appUiState.state).files,
  write: (files) => appUiState.update((s) => ({ ...s, files })),
  enabled: () => appSettings.get('files.rememberPerFile'),
  knownProfile: (id) => appProfiles.get(id) !== undefined,
  now: () => Date.now(),
});
