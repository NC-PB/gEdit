// Typed `invoke` wrappers for the custom Rust commands (plan §7.6). Written by the
// preludes; this is the only module in `src/` that talks to a custom command, so the
// IPC surface can be reviewed in one place.
//
// Every Rust struct uses `#[serde(rename_all = "camelCase")]`, so the result types below
// are the wire format. A command that takes a struct passes it as `{ req }`.
//
// M1: `files_stat` (implemented by WP1.4). M2: the config, state and recent-files
// commands (implemented by WP2.1). M4: the scripting commands (implemented by WP4.5).
// M5 removes the two v1 script commands, which never had a wrapper here.

import { invoke } from '@tauri-apps/api/core';
import type { FieldSpec } from '$lib/core/forms/types';

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
  /**
   * M6: `<config>/machines.json`. The webview needs it for the same reason it needs
   * `settingsFile` — to tell the machines document from any other one it has open, so a
   * save of that document reloads the machines (`contrib/settings.ts` does it for
   * settings). Nothing is granted by knowing the path.
   */
  machinesFile: string;
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
  /**
   * M6: the contents of `<config>/machines.json`, read in the same round trip (AD-8 allows
   * exactly one). Always an object: `{}` when the file is missing or unusable.
   */
  machines: Record<string, unknown>;
  /** English detail for a machines file that could not be used; a write is refused while it is set. */
  machinesError: string | null;
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

/**
 * M6, §7.10. Replaces `<config>/machines.json` with `machines` — the whole file each
 * time, a JSON object of at most 1 MiB, written atomically and stamped with
 * `MACHINES_VERSION`. An unusable previous file is kept as `machines.json.bak`, and a
 * file on disk with a newer `$version` is never overwritten.
 *
 * The whole object, not a patch: a machine is a record with an id, and a partial write
 * would be the one way a rename could lose the parameters that decide how the control
 * reads numbers.
 */
export function machinesSave(machines: Record<string, unknown>): Promise<void> {
  return invoke<void>('machines_save', { machines });
}

/**
 * M6, §7.10. Makes sure `machines.json` exists (creating an empty one), grants that single
 * file to the fs scope and answers with its path, so "Open machines file" can open it as a
 * document. Only this one file is granted — never the folder.
 */
export function machinesOpenFile(): Promise<string> {
  return invoke<string>('machines_open_file');
}

/**
 * M6, AD-20. Tells the backend whether any document has unsaved changes.
 *
 * macOS asks the application whether it may terminate when the user picks Quit from the
 * Dock or logs out, and the answer has to be given on the spot — there is no time to ask
 * the webview. So the webview keeps this flag up to date (on every flip, not on every
 * keystroke) and the native side answers from it. Elsewhere the command only stores the
 * flag: Windows and Linux cannot veto a session end (F29, D28).
 */
export function quitGuardSetDirty(dirty: boolean): Promise<void> {
  return invoke<void>('quit_guard_set_dirty', { dirty });
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
// M4: scripting (src-tauri/src/scripts/*)
//
// The webview sends a script **id** and never a path, never an interpreter and never a
// folder (plan §3, AD-13). Rust resolves the id against the three known roots, refuses
// `..`, separators and anything that canonicalizes out of its root, and reads the
// interpreter and the folder list from `settings.json` itself. That is what replaced the
// v1 `run_python_script(folder, name)` surface, removed at I5 (plan D14).
//
// Only `scriptNew`, `scriptCopyToUser` and `scriptSourcePath` widen the fs scope, and
// only for a file the user may edit; a `bundled:` id is refused.
//
// What the id grammar buys is **which file** runs: no path traversal, no editing of a
// bundled script, one source of truth for the interpreter and a bounded deadline. It says
// nothing about what is *in* that file — `scriptNew` hands back a writable path in the
// user folder on purpose, and that path runs by id. A script is an ordinary program with
// the user's rights (`src-tauri/src/scripts/mod.rs` spells this out; G8 M4 corrected the
// stronger claim that used to stand here).
// ---------------------------------------------------------------------------

/** Where a script wants its stdin from. */
export type ScriptInputMode = 'selection-or-document' | 'selection' | 'document' | 'none';

/** What the app does with a script's stdout. */
export type ScriptOutputMode = 'panel' | 'replace' | 'new-document' | 'report';

/** Which documents the context carries. P1 only supports `active`. */
export type ScriptDocumentsMode = 'active' | 'all-open' | 'pick';

/**
 * A script's `# /// gedit` TOML header, as Rust parsed it.
 *
 * `name`, `description` and every parameter `label` are **data and stay untranslated**
 * (AD-14). `warnings` are unknown fields and downgraded values; they do not stop the
 * script from running, unlike `ScriptEntry.headerError`.
 */
export interface ScriptMeta {
  name: string;
  description: string;
  /** null means "offered for every profile". */
  profiles: string[] | null;
  input: ScriptInputMode;
  output: ScriptOutputMode;
  /** Seconds; null falls back to `scripts.timeoutSeconds`. */
  timeout: number | null;
  /** stdout is `{ text, message, findings }` rather than plain text. */
  envelope: boolean;
  documents: ScriptDocumentsMode;
  /** Rendered by `modals.form()` exactly like a transform's options. */
  params: FieldSpec[];
  warnings: string[];
}

/** One discovered script. */
export interface ScriptEntry {
  /** `bundled:x.py`, `user:grp/x.py`, `extra0:x.py`. The only thing that goes back to Rust. */
  id: string;
  /** `bundled`, `user` or `extra<N>`. */
  root: string;
  /** The one subfolder level, when the script sits in one; it becomes a menu group. */
  group: string | null;
  fileName: string;
  /** null when the file has no header: the script runs in v1 (panel) mode. */
  meta: ScriptMeta | null;
  /** A header that is there but unusable. English detail text (AD-14). */
  headerError: string | null;
  /** A script of a later root has the same file name and wins. */
  shadowed: boolean;
  /** False for `bundled:`; the UI offers "Copy to user folder" instead of "Edit". */
  editable: boolean;
}

/** One script folder, for the settings UI and the empty-state hint. */
export interface FolderInfo {
  root: string;
  path: string;
  exists: boolean;
}

export interface ScriptList {
  scripts: ScriptEntry[];
  folders: FolderInfo[];
}

/** What `scriptRun` is asked to do. */
export interface RunRequest {
  /** The webview's id for this run; `scriptCancel` uses it. */
  runId: string;
  scriptId: string;
  /** The text for stdin, LF-joined. */
  stdin: string;
  /** `ScriptContextV2` (plan §7.5); Rust writes it to the `GEDIT_CONTEXT` file as-is. */
  context: unknown;
  /** Overrides the header's `timeout` and `scripts.timeoutSeconds`. */
  timeoutSecs: number | null;
}

/** The outcome of one run. A run that never started rejects instead. */
export interface RunResult {
  /** null when the process was killed by a signal. */
  exitCode: number | null;
  /** Exit code 0, and neither timed out nor cancelled. */
  success: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  /** stdout hit the runner's 64 MiB cap; what came after it was dropped. */
  stdoutTruncated: boolean;
  durationMs: number;
  /** The interpreter that ran it, for the output panel's header line. */
  interpreter: string;
}

/** The Python probe. `message` is English detail shown under a translated summary. */
export interface PythonStatus {
  ok: boolean;
  interpreter: string | null;
  version: string | null;
  message: string | null;
}

/** Every script in every root, with its header already parsed. */
export function scriptsList(): Promise<ScriptList> {
  return invoke<ScriptList>('scripts_list');
}

/**
 * Runs a script and answers with everything the output panel needs. It rejects only when
 * nothing ran (no such id, no interpreter); a script that exited non-zero is a resolved
 * `RunResult` with `success: false`.
 */
export function scriptRun(req: RunRequest): Promise<RunResult> {
  return invoke<RunResult>('script_run', { req });
}

/** Asks a run to stop. False when it had already finished. */
export function scriptCancel(runId: string): Promise<boolean> {
  return invoke<boolean>('script_cancel', { runId });
}

/** Whether there is a usable Python (3.9 or newer), and which one. Never rejects. */
export function pythonCheck(): Promise<PythonStatus> {
  return invoke<PythonStatus>('python_check');
}

/**
 * Creates `<config>/scripts/<name>.py` from the commented template, grants that one file
 * and returns its path, so it can be opened as a document.
 */
export function scriptNew(name: string): Promise<string> {
  return invoke<string>('script_new', { name });
}

/** Copies a bundled script into the user folder (where it shadows it) and grants the copy. */
export function scriptCopyToUser(scriptId: string): Promise<string> {
  return invoke<string>('script_copy_to_user', { scriptId });
}

/** The granted path behind an id, for editing. A `bundled:` id is refused. */
export function scriptSourcePath(scriptId: string): Promise<string> {
  return invoke<string>('script_source_path', { scriptId });
}
