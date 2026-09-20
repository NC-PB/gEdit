// The recent-files list (plan §7.3, AD-9). Owner: WP2.3.
//
// Rust owns the list itself, because it is also a scope concern: `recent_touch` refuses a
// path the fs scope does not already allow, and the entries are re-granted at startup so
// that reopening a file from the last session needs no dialog. Every call answers with
// the whole list, so this store never has to guess what the file now holds — it only
// mirrors the last answer for the ribbon dropdown and the picker.
//
// Nothing here is load bearing: a failed call leaves the list as it was and says so in
// the console as a *warning*. Opening a file must not fail because its entry could not be
// recorded, and a console error would fail a runtime scenario.
//
// `createRecentService(deps)` plus the singleton wired to the real command wrappers
// (AD-2), so a unit test needs no Tauri runtime.

import { derived, writable } from 'svelte/store';
import { DEFAULTS } from '$lib/core/settings/schema';
import { recentClear, recentList, recentRemove, recentTouch } from '$lib/platform/commands';
import { settings } from '$lib/stores/settings';
import { isTauriRuntime } from '$lib/utils/platform';
import type { RecentEntry } from '$lib/platform/commands';
import type { RecentService } from '$lib/app/types';

export interface RecentServiceDeps {
  list(): Promise<RecentEntry[]>;
  touch(path: string, max: number): Promise<RecentEntry[]>;
  remove(path: string): Promise<RecentEntry[]>;
  clear(): Promise<RecentEntry[]>;
  /** `files.recentLength`, read per call so a settings change takes effect at once. */
  maxLength(): number;
}

/** `files.recentLength` is an int 0-50 (§7.7); a hand-edited file may hold anything. */
function cap(value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS['files.recentLength'];
  return Math.min(50, Math.max(0, Math.trunc(value)));
}

export function createRecentService(deps: RecentServiceDeps): RecentService {
  const entries = writable<RecentEntry[]>([]);

  /** Runs `call` and mirrors its answer; a failure keeps the list and warns. */
  async function apply(what: string, call: () => Promise<RecentEntry[]>): Promise<void> {
    try {
      entries.set(await call());
    } catch (err) {
      console.warn(`the recent files could not be ${what}`, err);
    }
  }

  return {
    list: derived(entries, (value) => value),

    refresh(): Promise<void> {
      return apply('read', () => deps.list());
    },

    touch(path: string): Promise<void> {
      return apply('updated', () => deps.touch(path, cap(deps.maxLength())));
    },

    remove(path: string): Promise<void> {
      return apply('updated', () => deps.remove(path));
    },

    clear(): Promise<void> {
      return apply('cleared', () => deps.clear());
    },
  };
}

/** No recent list outside Tauri: there is no file system to remember anything about. */
function none(): Promise<RecentEntry[]> {
  return Promise.resolve([]);
}

/** The application-wide recent-files list. */
export const recent: RecentService = createRecentService({
  list: () => (isTauriRuntime() ? recentList() : none()),
  touch: (path, max) => (isTauriRuntime() ? recentTouch(path, max) : none()),
  remove: (path) => (isTauriRuntime() ? recentRemove(path) : none()),
  clear: () => (isTauriRuntime() ? recentClear() : none()),
  maxLength: () => settings.get('files.recentLength'),
});
