// The Python script UI. Owner: **WP5.2**.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// The namespace covers the script registry UI — the Tools group, the `script.*` commands,
// the Output panel and the status item — plus every message the runner (`app/scripts.ts`,
// WP5.1) needs. The v1 block (pick a folder, list it, run one) went with
// `contrib/scriptsV1.ts` at I5 (plan D14).
//
// Three rules hold across the namespace:
//
//  1. A script's own name, description, parameter labels, `message` and findings are
//     **data and stay untranslated** (AD-14). They are interpolated into these messages,
//     never replaced by them.
//  2. `PythonStatus.message` and `ScriptEntry.headerError` are English detail from Rust.
//     They go into the `detail` of a status message or an error dialog, never into the
//     summary line.
//  3. `errExitCode` … `errReport` are the closed list `APPLY_ERROR_KEYS`
//     (`core/scripting/apply.ts`) — one message per reason `decideApply` may give, and
//     every one of them says that **nothing was applied**, because that is the part the
//     operator has to be sure of. The run-sequence keys below are the other closed list,
//     `SCRIPT_STATUS_KEYS`. Neither is reachable by the key scan (the runner returns a
//     `Msg`, not a literal `t()` call); `scripts.keys.test.ts` checks both instead.

import type { Messages } from '../types';

export default {
  // The palette category and the Tools group caption.
  category: 'Scripts',
  groupScripts: 'Python Scripts',

  // -------------------------------------------------------------------------
  // The run, as the status bar and the panel title say it
  // -------------------------------------------------------------------------
  running: 'Running {script}…',
  finished: '{script} finished',
  runFailed: 'Could not run {script}',
  desktopOnly: 'Python scripts are only available in the gEdit desktop app',

  outputTitle: 'Script Output',
  outputEmpty: 'Run a Python script to see its output here.',
  outputRunning: 'Running the script…',
  labelStdout: 'Raw stdout',
  labelStderr: 'stderr',
  labelJson: 'Structured result',
  statusRunning: 'Script: {script}',
  statusIdle: 'No script running',

  // -------------------------------------------------------------------------
  // commands (`contrib/scripts.ts`, plan §5 WP5.2, §7.11)
  // -------------------------------------------------------------------------
  groupManage: 'Manage',

  runPicker: 'Run Script',
  runPickerPlaceholder: 'Type to find a script…',
  runLast: 'Run Last Script',
  runLastTooltip: 'Run {script} again',
  cancel: 'Stop',
  cancelTooltip: 'Stop {script}',
  newScript: 'New Script',
  copyToUser: 'Copy to My Scripts',
  openSource: 'Edit Script',
  rescan: 'Rescan',
  addFolder: 'Add Folder',

  // -------------------------------------------------------------------------
  // the Tools group (`ScriptsMenu.svelte`)
  // -------------------------------------------------------------------------
  menuLabel: 'Scripts for this program',
  ungrouped: 'Scripts',
  scriptTooltip: '{script} — {description}',
  noneForProfile: 'No scripts for this dialect',
  noneAtAll: 'No scripts found. Use New Script or Add Folder.',
  headerProblem: '{script}: the header could not be read, so it runs in output mode',

  // -------------------------------------------------------------------------
  // Python
  // -------------------------------------------------------------------------
  pythonMissing: 'Python 3.9 or newer was not found, so the script commands are off',
  pythonChecking: 'Looking for a Python interpreter…',
  pythonFound: 'Python {version} ({interpreter})',

  // -------------------------------------------------------------------------
  // New script, folders, rescan
  // -------------------------------------------------------------------------
  newTitle: 'Name for the new script',
  newPlaceholder: 'scale_feed',
  nameEmpty: 'Enter a name',
  nameInvalid: 'Use a plain file name: no / \\ : and no leading _ or .',
  nameReserved: 'gedit_nc.py is the script library and cannot be used as a name',
  created: 'Created {name}',
  newFailed: 'Could not create the script',
  copied: 'Copied {script} to your scripts folder',
  copyFailed: 'Could not copy {script}',
  copyNothing: 'Every script is already in a folder you can edit',
  openFailed: 'Could not open {script}',
  openBundledTitle: 'Bundled script',
  openBundledMessage:
    '{script} ships with gEdit and cannot be edited in place. Copy it to your scripts folder and edit the copy?',
  copyButton: 'Copy and edit',
  addFolderTitle: 'Select a folder with Python scripts',
  // The folder *dialog* could not be opened, as opposed to `folderAddFailed` (the dialog
  // answered, but `scripts.folders` could not be written).
  folderFailed: 'Could not open the folder dialog',
  folderAdded: 'Added {folder} to the script folders',
  folderAlready: '{folder} is already a script folder',
  folderAddFailed: 'Could not add the script folder',
  rescanned_one: 'Found {count} script',
  rescanned_other: 'Found {count} scripts',
  rescanFailed: 'Could not read the script folders',
  pickPlaceholder: 'Select a script…',
  noScriptsToPick: 'There are no scripts to choose from',

  // -------------------------------------------------------------------------
  // the run sequence (`app/scripts.ts`, WP5.1)
  //
  // The key names here are `SCRIPT_STATUS_KEYS` in `app/scripts.ts`, and
  // `scripts.keys.test.ts` asserts that the two lists are the same set. The runner never
  // writes a literal `t('scripts.…')` — it returns a `Msg` — so the key scan cannot see
  // these, and that test is what stands in for it.
  // -------------------------------------------------------------------------
  noDocument: 'Open a program first',
  notFound: 'There is no script with the id {script}',
  notForProfile: '{script} is not offered for {profile}',
  noProfile: 'The dialect profile {profile} is not available',
  noLastScript: 'No script has been run yet',
  busy: 'A script is already running',
  needsSelection: '{script} needs a selection',
  noInputToReplace: '{script} has no input to replace; check its header',
  cancelling: 'Stopping the script…',
  cancelFailed: 'Could not stop the script',
  applied_one: '{script}: {count} line replaced',
  applied_other: '{script}: {count} lines replaced',
  appliedNone: '{script} changed nothing',
  openedNewTab: '{script}: the result is in a new tab',
  reported: '{script}: the result is in the Results panel',
  staleTitle: 'The program changed while the script ran',
  staleMessage:
    '{script} finished, but the program was edited while it ran, so nothing was applied. The result can still be opened in a new tab.',
  staleOpen: 'Open in new tab',
  staleDiscarded: '{script}: the result was discarded',

  // -------------------------------------------------------------------------
  // `decideApply` reasons (APPLY_ERROR_KEYS, `core/scripting/apply.ts`)
  // -------------------------------------------------------------------------
  errExitCode: 'The script exited with code {code}. Nothing was applied.',
  errKilled: 'The script was stopped by the system. Nothing was applied.',
  errTimeout: 'The script ran past its time limit and was stopped. Nothing was applied.',
  errCancelled: 'The script was stopped. Nothing was applied.',
  errEmptyOutput: 'The script produced no text, so nothing was replaced.',
  errTruncated: 'The output was too large and was cut off. Nothing was applied.',
  errEnvelope: 'The script did not return the expected result object. Nothing was applied.',
  errReport: 'The script did not return a usable report. Nothing was applied.',

  // -------------------------------------------------------------------------
  // the Output panel (`ScriptOutputPanel.svelte`, §7.9 `output-*`)
  // -------------------------------------------------------------------------
  outputHint: 'Run a script to see its stdout, stderr and structured result here.',
  outputCancel: 'Stop',
  outputRunningNamed: 'Running {script}…',
  outputExit: 'Exit code {code}',
  outputSignal: 'Stopped by a signal',
  outputDuration: '{seconds} s',
  outputInterpreter: 'Interpreter: {interpreter}',
  outputTimedOut: 'Timed out',
  outputCancelled: 'Stopped',
  outputTruncated: 'Output cut off',
  outputNoStdout: 'The script printed nothing on stdout.',
  outputCut_one: '… 1 more character, not shown here.',
  outputCut_other: '… {count} more characters, not shown here.',
} as const satisfies Messages;
