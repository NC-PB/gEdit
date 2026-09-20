// Typed `invoke` wrappers for the custom Rust commands (plan §7.6). Written by the
// preludes; this is the only module in `src/` that talks to a custom command, so the
// IPC surface can be reviewed in one place.
//
// Every Rust struct uses `#[serde(rename_all = "camelCase")]`, so the result types below
// are the wire format. A command that takes a struct passes it as `{ req }`.
//
// M1: `files_stat` (implemented by WP1.4). The result types of the M2, M4 and M5 commands
// are placeholders at the bottom of this file and are filled in by the P2 / P4 / P5 preludes.

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
// Placeholders for later milestones (§7 preamble): the home file exists from M1 on,
// so imports resolve; the P2 / P4 / P5 preludes replace these with the §7.6 definitions
// and add the matching wrappers.
// ---------------------------------------------------------------------------

/** `config_load` paths (M2). Placeholder until P2. */
export interface ConfigPaths {
  configDir: string;
  [field: string]: unknown;
}

/** One entry of the recent-files list (M2). Placeholder until P2. */
export interface RecentEntry {
  path: string;
  [field: string]: unknown;
}

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
