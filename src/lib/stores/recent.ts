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
// A failure is also said in the status bar (B1 A2), once until a call succeeds again:
// Rust used to print a failed write of `state.json` on stderr and answer as if it had
// worked, so a read-only or full config folder lost the list with no sign at all.
//
// `files.recentLength: 0` means "off": nothing is recorded and the list is hidden, but
// what is stored is kept, so setting a number again brings it back (owner decision, B1).
//
// `createRecentService(deps)` plus the singleton wired to the real command wrappers
// (AD-2), so a unit test needs no Tauri runtime.

import { derived, writable, type Readable } from 'svelte/store';
import { DEFAULTS } from '$lib/core/settings/schema';
import { recentClear, recentList, recentRemove, recentTouch } from '$lib/platform/commands';
import { status } from '$lib/app/status';
import { settings } from '$lib/stores/settings';
import { t } from '$lib/i18n';
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
  /**
   * The same setting as a store, so the list hides and shows at once when it changes
   * to or from 0. Without it the list follows `maxLength()` at the time it is read.
   */
  maxLengthStore?: Readable<number>;
  /** Says that the list could not be saved. `detail` is Rust's English text. */
  notify?(text: string, detail: string): void;
}

/** `files.recentLength` is an int 0-50 (§7.7); a hand-edited file may hold anything. */
function cap(value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS['files.recentLength'];
  return Math.min(50, Math.max(0, Math.trunc(value)));
}

export function createRecentService(deps: RecentServiceDeps): RecentService {
  const entries = writable<RecentEntry[]>([]);
  /** Whether the user was already told that the list cannot be saved. */
  let told = false;

  /** Runs `call` and mirrors its answer; a failure keeps the list, warns and tells. */
  async function apply(
    what: string,
    call: () => Promise<RecentEntry[]>,
    reread: boolean,
  ): Promise<boolean> {
    try {
      entries.set(await call());
      told = false;
      return true;
    } catch (err) {
      console.warn(`the recent files could not be ${what}`, err);
      if (!told) {
        told = true;
        deps.notify?.(t('recent.saveFailed'), err instanceof Error ? err.message : String(err));
      }
      // A removal or a clear that was not written leaves the file as it was; the
      // mirror may be older than that, so it reads the truth again.
      if (reread) {
        try {
          entries.set(await deps.list());
        } catch {
          // Keep the last good list.
        }
      }
      return false;
    }
  }

  const hidden = (max: number): boolean => cap(max) === 0;
  const shown: Readable<RecentEntry[]> =
    deps.maxLengthStore === undefined
      ? derived(entries, (value) => (hidden(deps.maxLength()) ? [] : value))
      : derived([entries, deps.maxLengthStore], ([value, max]) => (hidden(max) ? [] : value));

  return {
    list: shown,

    async refresh(): Promise<void> {
      await apply('read', () => deps.list(), false);
    },

    async touch(path: string): Promise<void> {
      const max = cap(deps.maxLength());
      // 0 is "off": nothing is recorded, and Rust is not asked to forget the rest.
      if (max === 0) return;
      await apply('updated', () => deps.touch(path, max), false);
    },

    remove(path: string): Promise<boolean> {
      return apply('updated', () => deps.remove(path), true);
    },

    clear(): Promise<boolean> {
      return apply('cleared', () => deps.clear(), true);
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
  maxLengthStore: derived(settings.values, (values) => values['files.recentLength']),
  notify: (text, detail) => status.show(text, { error: true, detail }),
});
