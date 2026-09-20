// The native dialogs (plan §7.2, AD-7). Owner: WP1.6.
//
// Thin, typed wrappers over `@tauri-apps/plugin-dialog`. The plugin grants every picked
// path in the fs scope (F3), so opening and saving need no capability beyond the
// `dialog:*` and `fs:allow-{read,write}-file` permissions the app already has.
//
// Native `message()` alerts are used only for decisions the user cannot take back:
// unsaved changes, quit, and the Windows-1252 fallback. Everything else is a QuickPick
// (`app/modals.ts`) or a status message.
//
// Filters follow AD-7: macOS gets NONE, because rfd merges every filter into one
// `allowedFileTypes` list (F7); Windows and Linux get the list from `profiles`.
//
// `exclusive` serializes whole dialog chains. The close guard, Cmd+Q and the ribbon all
// go through it, so a second chain cannot open a second native alert on top of the first;
// a re-entrant call resolves `undefined`, which every caller reads as "not now".
//
// Outside Tauri (`npm run dev` in a plain browser) the file pickers answer "cancelled"
// and the decisions fall back to `window.confirm`, so the app still runs.

import { message, open, save } from '@tauri-apps/plugin-dialog';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { isTauriRuntime } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { DialogFilter, NativeDialogs, ProfileRegistry } from '$lib/app/types';

/** The three plugin entry points, injected so a unit test never needs a webview. */
export interface DialogBackend {
  open: typeof open;
  save: typeof save;
  message: typeof message;
}

export interface NativeDialogsDeps {
  backend: DialogBackend;
  profiles: ProfileRegistry;
  /** False in a plain browser: the pickers then answer "cancelled". */
  isTauri(): boolean;
  /** Browser fallback for the two decision dialogs. */
  confirmFallback(message: string): boolean;
}

/** `filters: []` would still be a filter list to rfd, so an empty list is left out. */
function withFilters<T extends object>(options: T, filters: DialogFilter[]): T & { filters?: DialogFilter[] } {
  return filters.length > 0 ? { ...options, filters } : options;
}

/** The plugin answers a single pick with a string and a multi pick with an array. */
function asPaths(picked: string | string[] | null): string[] {
  if (picked === null) return [];
  return Array.isArray(picked) ? picked : [picked];
}

export function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function createNativeDialogs(deps: NativeDialogsDeps): NativeDialogs {
  const { backend } = deps;
  let busy = false;

  return {
    /**
     * Save / Don't Save / Cancel. With three custom buttons the plugin resolves
     * `message()` to the label of the clicked button; anything unexpected (Escape, a
     * failure) counts as Cancel, which is the choice that changes nothing.
     */
    async ask3(o: {
      title: string;
      message: string;
      yes: string;
      no: string;
      cancel: string;
      kind?: 'warning' | 'info';
    }): Promise<'yes' | 'no' | 'cancel'> {
      if (!deps.isTauri()) return deps.confirmFallback(o.message) ? 'no' : 'cancel';
      let choice: string | boolean;
      try {
        choice = await backend.message(o.message, {
          title: o.title,
          kind: o.kind ?? 'warning',
          buttons: { yes: o.yes, no: o.no, cancel: o.cancel },
        });
      } catch (err) {
        console.error('ask3 failed', err);
        return 'cancel';
      }
      if (choice === o.yes) return 'yes';
      if (choice === o.no) return 'no';
      return 'cancel';
    },

    /** Two custom buttons must be ok/cancel: the plugin ignores a yes/cancel pair. */
    async confirm(o: {
      title: string;
      message: string;
      ok: string;
      cancel?: string;
      kind?: 'warning' | 'info';
    }): Promise<boolean> {
      if (!deps.isTauri()) return deps.confirmFallback(o.message);
      try {
        const choice = await backend.message(o.message, {
          title: o.title,
          kind: o.kind ?? 'warning',
          buttons: { ok: o.ok, cancel: o.cancel ?? t('common.cancel') },
        });
        return choice === o.ok;
      } catch (err) {
        console.error('confirm failed', err);
        return false;
      }
    },

    /** Always logs; shows the native alert only where there is one. */
    async error(summary: string, detail: unknown): Promise<void> {
      const text = errorText(detail);
      console.error(summary, detail);
      if (!deps.isTauri()) return;
      try {
        await backend.message(text, { title: summary, kind: 'error' });
      } catch (err) {
        console.error('Failed to show the error dialog', err);
      }
    },

    async openFiles(o?: { multiple?: boolean }): Promise<string[]> {
      if (!deps.isTauri()) return [];
      const picked = await backend.open(
        withFilters(
          { title: t('files.openTitle'), multiple: o?.multiple ?? true, directory: false },
          deps.profiles.openFilters(),
        ),
      );
      return asPaths(picked);
    },

    async saveFile(o: { defaultPath: string; profileId?: string }): Promise<string | null> {
      if (!deps.isTauri()) return null;
      return backend.save(
        withFilters(
          { title: t('files.saveAsTitle'), defaultPath: o.defaultPath },
          o.profileId ? deps.profiles.saveFilters(o.profileId) : [],
        ),
      );
    },

    async pickFolder(o?: { title?: string }): Promise<string | null> {
      if (!deps.isTauri()) return null;
      const picked = await backend.open({ directory: true, multiple: false, title: o?.title });
      return asPaths(picked)[0] ?? null;
    },

    async pickFile(o?: { title?: string }): Promise<string | null> {
      if (!deps.isTauri()) return null;
      const picked = await backend.open({ directory: false, multiple: false, title: o?.title });
      return asPaths(picked)[0] ?? null;
    },

    /** One chain at a time; a re-entrant call resolves `undefined` instead of queueing. */
    async exclusive<T>(op: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try {
        return await op();
      } finally {
        busy = false;
      }
    },
  };
}

/** The application-wide native dialogs. */
export const dialogs: NativeDialogs = createNativeDialogs({
  backend: { open, save, message },
  profiles: appProfiles,
  isTauri: isTauriRuntime,
  confirmFallback: (text) => typeof window !== 'undefined' && window.confirm(text),
});
