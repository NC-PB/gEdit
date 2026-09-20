// State of the v1 Python script UI. Owner: WP1.5.
//
// Legacy, and deliberately small: M5 replaces the whole v1 flow (a folder the user picks,
// `list_python_scripts`, `run_python_script`) with the script registry and
// `src/lib/stores/scripts.ts`, which WP1.5 does not own. Until then the state lives here,
// next to the two components that read it, rather than in a store module a later
// milestone has to delete again.
//
// This module holds state only: no Tauri, no dialogs, no i18n. `contrib/scriptsV1.ts`
// owns the actions, so `bootstrap.ts` can read `scriptRunning` for the command context
// without pulling the Tauri API into its import graph, and so the two components can be
// imported by the contribution without a cycle.

import { get, writable } from 'svelte/store';

/** Result of the `run_python_script` command (v1 shape). */
export interface ScriptResult {
  stdout: string;
  stderr: string;
  success: boolean;
  data: unknown;
}

/** Absolute path of the folder the user picked, or '' when there is none yet. */
export const scriptsFolder = writable('');
/** The `.py` file names in that folder, as the backend listed them. */
export const availableScripts = writable<string[]>([]);
/** The name chosen in the ribbon's script select. */
export const selectedScript = writable('');

export const scriptStdout = writable('');
export const scriptStderr = writable('');
export const scriptData = writable<unknown>(null);
/** True while a run is in flight; the ribbon's Run button and `scriptRunning` follow it. */
export const scriptRunning = writable(false);
/** Name of the script that is running, or the last one that ran. */
export const lastScript = writable('');

export function isScriptRunning(): boolean {
  return get(scriptRunning);
}

/** Clears the previous run's output; called just before a new run starts. */
export function resetScriptOutput(): void {
  scriptStdout.set('');
  scriptStderr.set('');
  scriptData.set(null);
}

/** Test seam: back to the state of a fresh app. */
export function resetScriptsV1ForTest(): void {
  scriptsFolder.set('');
  availableScripts.set([]);
  selectedScript.set('');
  lastScript.set('');
  scriptRunning.set(false);
  resetScriptOutput();
}
