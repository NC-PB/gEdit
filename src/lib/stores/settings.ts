// The effective settings (plan §7.3, AD-8). Owner: WP2.6.
//
// Rust owns the file; this store owns what the app makes of it:
//   - `load()` reads it once at startup (one `config_load` round trip, together with the
//     UI state) and never throws. A missing, unreadable or malformed file falls back to
//     the defaults and reports the reason, because the app has to start either way.
//   - The effective values are `DEFAULTS` with every *valid* user value applied. An
//     invalid one is dropped with a warning (`core/settings/merge.ts`).
//   - Keys this build does not know are kept and written back, so a file from a newer
//     build survives a round trip.
//   - `save()` writes `{"$version":1, …}` with only the non-default values, sorted.
//   - A file whose `$version` is newer than this build's is read and never written.
//
// The notice for a broken file is shown from here rather than from `bootstrap` (the P2
// hand-off): `load()` runs before the contributions, so the message is queued through
// `status` and is on screen as soon as the status bar renders.
//
// `createSettingsStore(deps)` plus the singleton wired to the real modules (AD-2), so a
// unit test never needs Tauri.

import { writable } from 'svelte/store';
import { diffFromDefaults, mergeSettings } from '$lib/core/settings/merge';
import { migrateSettings } from '$lib/core/settings/migrate';
import { DEFAULTS, SETTINGS_VERSION, type Settings } from '$lib/core/settings/schema';
import { status } from '$lib/app/status';
import { configLoad, settingsSave, type ConfigLoad, type ConfigPaths } from '$lib/platform/commands';
import { loadConfigOnce } from '$lib/stores/uiState';
import { t } from '$lib/i18n';
import { isTauriRuntime } from '$lib/utils/platform';
import type { SettingsStore } from '$lib/app/types';

/** What `load()` and `reloadFromDisk()` found, kept so that a late consumer can still report it. */
export interface SettingsLoadReport {
  /** English detail for a file that could not be read or parsed; absent when it was fine. */
  error?: string;
  /** English detail, one per value that was dropped (AD-14). */
  warnings: string[];
}

export interface SettingsStoreDeps {
  configLoad: () => Promise<ConfigLoad>;
  /**
   * The startup read (mergeA): `config_load` answers with `settings.json` **and** the
   * `ui` member of `state.json`, and AD-8 allows exactly one round trip, so `load()` goes
   * through the memo in `stores/uiState.ts` while `reloadFromDisk()` keeps asking the
   * backend for fresh bytes. Defaults to `configLoad`, which is what a unit test wants.
   */
  configLoadStartup?: () => Promise<ConfigLoad>;
  settingsSave: (settings: Record<string, unknown>) => Promise<void>;
  /** False in a plain browser build, where there is no config file to read. */
  isTauri: () => boolean;
  /** Shows the "your settings file is broken" notice. */
  notify: (report: SettingsLoadReport) => void;
}

/** The message text for `notify`; kept next to the store so both callers agree. */
function showReport(report: SettingsLoadReport): void {
  if (report.error !== undefined) {
    status.show(t('theme.settingsUnreadable'), { error: true, detail: report.error });
    return;
  }
  if (report.warnings.length > 0) {
    status.show(t('theme.settingsIgnored', { count: report.warnings.length }), {
      error: true,
      detail: report.warnings.join(' · '),
    });
  }
}

/** English detail for anything thrown across the IPC boundary. */
function detailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface SettingsStoreApi extends SettingsStore {
  /** What the last `load()` or `reloadFromDisk()` found. Empty before the first load. */
  report(): SettingsLoadReport;
  /** True while the file on disk carries a newer `$version`: nothing may be written. */
  isReadOnly(): boolean;
  /**
   * The values the last `save()` or `reset()` could not use, as English detail (AD-14);
   * empty when the whole patch went in.
   *
   * `write()` is tolerant on purpose (see below), so a caller that handed over a value the
   * merge rejects gets the default back plus a `notify()`. Whoever called has to know
   * that: the settings dialog would otherwise put its own "Settings saved" over the
   * warning the store just raised, and §7.5 is explicit that a form never corrects a
   * value silently (G8 M2).
   */
  lastWriteWarnings(): string[];
}

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStoreApi {
  const values = writable<Settings>({ ...DEFAULTS });
  const paths = writable<ConfigPaths | null>(null);

  let current: Settings = { ...DEFAULTS };
  let unknown: Record<string, unknown> = {};
  let readOnly = false;
  let lastReport: SettingsLoadReport = { warnings: [] };
  let lastWrite: string[] = [];

  values.subscribe((next) => {
    current = next;
  });

  /** Applies the raw file contents and answers with what went wrong, if anything. */
  function apply(file: Record<string, unknown>, error?: string | null): SettingsLoadReport {
    const migrated = migrateSettings(file);
    const merged = mergeSettings(migrated.raw);
    readOnly = migrated.readOnly;
    unknown = merged.unknown;
    values.set(merged.values);
    const report: SettingsLoadReport = {
      ...(error === null || error === undefined ? {} : { error }),
      warnings: merged.warnings,
    };
    lastReport = report;
    return report;
  }

  /** The object that goes into `settings.json`: `$version` first, then the sorted diff. */
  function fileFor(next: Settings, nextUnknown: Record<string, unknown>): Record<string, unknown> {
    return { $version: SETTINGS_VERSION, ...diffFromDefaults(next, nextUnknown) };
  }

  /**
   * Writes `patch` over the current values. The patch goes through `mergeSettings` as
   * well, so a value that a caller built by hand can never reach the file: the round trip
   * is the one code path that decides what is valid.
   *
   * Outside the webview (`npm run dev` in a browser) there is no file to write, so the
   * new values are kept in memory only and the UI still follows them.
   */
  async function write(patch: Record<string, unknown>): Promise<void> {
    lastWrite = [];
    if (readOnly) {
      throw new Error(
        'settings.json was written by a newer version of gEdit and is not overwritten',
      );
    }
    const merged = mergeSettings({ ...diffFromDefaults(current, unknown), ...patch });
    if (deps.isTauri()) await deps.settingsSave(fileFor(merged.values, merged.unknown));
    unknown = merged.unknown;
    values.set(merged.values);
    lastWrite = merged.warnings;
    if (merged.warnings.length > 0) deps.notify({ warnings: merged.warnings });
  }

  return {
    values: { subscribe: values.subscribe },

    get<K extends keyof Settings>(k: K): Settings[K] {
      return current[k];
    },

    async load(): Promise<SettingsLoadReport> {
      if (!deps.isTauri()) return lastReport;
      let loaded: ConfigLoad;
      try {
        loaded = await (deps.configLoadStartup ?? deps.configLoad)();
      } catch (err) {
        // The config folder is unreadable, or the backend is older than this webview.
        lastReport = { error: detailOf(err), warnings: [] };
        deps.notify(lastReport);
        return lastReport;
      }
      paths.set(loaded.paths);
      const report = apply(loaded.settings, loaded.settingsError);
      if (report.error !== undefined || report.warnings.length > 0) deps.notify(report);
      return report;
    },

    async save(patch: Partial<Settings>): Promise<void> {
      await write(patch as Record<string, unknown>);
    },

    async reset(keys: (keyof Settings)[]): Promise<void> {
      const patch: Record<string, unknown> = {};
      for (const key of keys) patch[key] = DEFAULTS[key];
      await write(patch);
    },

    async reloadFromDisk(): Promise<void> {
      if (!deps.isTauri()) return;
      const loaded = await deps.configLoad();
      paths.set(loaded.paths);
      const report = apply(loaded.settings, loaded.settingsError);
      if (report.error !== undefined || report.warnings.length > 0) deps.notify(report);
    },

    paths: { subscribe: paths.subscribe },

    report(): SettingsLoadReport {
      return lastReport;
    },

    isReadOnly(): boolean {
      return readOnly;
    },

    lastWriteWarnings(): string[] {
      return [...lastWrite];
    },
  };
}

/** The application-wide settings store. */
export const settings: SettingsStoreApi = createSettingsStore({
  configLoad,
  configLoadStartup: loadConfigOnce,
  settingsSave,
  isTauri: isTauriRuntime,
  notify: showReport,
});
