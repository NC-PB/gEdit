// Typed `invoke` wrappers for the custom Rust commands (plan §7.6). Written by the
// preludes; this is the only module in `src/` that talks to a custom command, so the
// IPC surface can be reviewed in one place.
//
// Every Rust struct uses `#[serde(rename_all = "camelCase")]`, so the result types below
// are the wire format. A command that takes a struct passes it as `{ req }`.
//
// M1: `files_stat` (implemented by WP1.4). M2: the config, state and recent-files
// commands (implemented by WP2.1). The result types of the M4 and M5 commands are
// placeholders at the bottom of this file and are filled in by the P4 / P5 preludes.

import { invoke } from '@tauri-apps/api/core';

/**
 * One entry of `files_stat`. A path the fs scope does not allow comes back with
 * `allowed: false` and everything else false or null, so callers never learn whether
 * a forbidden path exists.
 */
export interface FileStat {
  /** The path exactly as it was passed in. */
  path: string;
  allowed: boolean;
  exists: boolean;
  isDir: boolean;
  /** Modification time in milliseconds since the epoch; null when the platform has none. */
  mtimeMs: number | null;
  size: number | null;
  readonly: boolean;
}

/**
 * Stats several paths in one round trip; answers only for paths the fs scope already
 * allows (AD-10). Used for the external-change poll, the no-op save check and the
 * folder filter of drag and drop. The result has one entry per input, in order.
 */
export function filesStat(paths: string[]): Promise<FileStat[]> {
  return invoke<FileStat[]>('files_stat', { paths });
}

// ---------------------------------------------------------------------------
// M2: settings, UI state and the recent-files list (src-tauri/src/{paths,config,state}.rs)
//
// Rust owns these files under fixed names, so the webview never gets fs-scope access to
// the config or the data folder (AD-8). The paths below are for display and for
// `settingsOpenFile`, which grants that one file.
// ---------------------------------------------------------------------------

/** Where the app keeps its own files. Absolute paths; for display only. */
export interface ConfigPaths {
  configDir: string;
  dataDir: string;
  settingsFile: string;
  stateFile: string;
  userScriptsDir: string;
}

/**
 * Everything the webview needs from disk at startup, in one round trip.
 *
 * `settings` and `ui` are always objects: a missing, unreadable or malformed file comes
 * back as `{}` plus the matching error, so startup falls back to the defaults and shows
 * a notice instead of failing. The error texts are English detail (AD-14).
 */
export interface ConfigLoad {
  /** The contents of `<config>/settings.json`, including `$version`. */
  settings: Record<string, unknown>;
  settingsError: string | null;
  /** The `ui` member of `<data>/state.json`. */
  ui: Record<string, unknown>;
  stateError: string | null;
  paths: ConfigPaths;
}

/** One entry of the recent-files list. `exists` is a fresh check at read time. */
export interface RecentEntry {
  path: string;
  exists: boolean;
}

/** Reads `settings.json` and `state.json` and reports the app's paths. */
export function configLoad(): Promise<ConfigLoad> {
  return invoke<ConfigLoad>('config_load');
}

/**
 * Replaces `settings.json` with `settings` (an object of at most 1 MiB, written
 * atomically). Rejects when the file on disk carries a newer `$version`.
 */
export function settingsSave(settings: Record<string, unknown>): Promise<void> {
  return invoke<void>('settings_save', { settings });
}

/** Merges `ui` into the `ui` member of `state.json`, leaving `recent` alone. */
export function uiStateSave(ui: Record<string, unknown>): Promise<void> {
  return invoke<void>('ui_state_save', { ui });
}

/**
 * Makes sure `settings.json` exists, grants that one file and returns its path, so the
 * settings dialog can open it as a document.
 */
export function settingsOpenFile(): Promise<string> {
  return invoke<string>('settings_open_file');
}

/** The recent list, newest first. Never fails: a broken state file answers with `[]`. */
export function recentList(): Promise<RecentEntry[]> {
  return invoke<RecentEntry[]>('recent_list');
}

/**
 * Moves `path` to the front and truncates the list to `max` entries, answering with the
 * new list. Rejects unless the fs scope already allows `path` (AD-9), so only a file the
 * user picked, dropped or reopened can get in.
 */
export function recentTouch(path: string, max: number): Promise<RecentEntry[]> {
  return invoke<RecentEntry[]>('recent_touch', { path, max });
}

/** Drops `path` from the list and answers with what is left. */
export function recentRemove(path: string): Promise<RecentEntry[]> {
  return invoke<RecentEntry[]>('recent_remove', { path });
}

/** Empties the list. */
export function recentClear(): Promise<RecentEntry[]> {
  return invoke<RecentEntry[]>('recent_clear');
}

// ---------------------------------------------------------------------------
// Placeholders for later milestones (§7 preamble): the home file exists from M1 on,
// so imports resolve; the P4 / P5 preludes replace these with the §7.6 definitions
// and add the matching wrappers.
// ---------------------------------------------------------------------------

/** One discovered script (M4). Placeholder until P4. */
export interface ScriptEntry {
  id: string;
  [field: string]: unknown;
}

/** The TOML header of a script (M4). Placeholder until P4. */
export interface ScriptMeta {
  name: string;
  [field: string]: unknown;
}

/** The outcome of one script run (M4). Placeholder until P4. */
export interface RunResult {
  success: boolean;
  [field: string]: unknown;
}

/** Result of the Python interpreter probe (M4). Placeholder until P4. */
export interface PythonStatus {
  ok: boolean;
  [field: string]: unknown;
}
