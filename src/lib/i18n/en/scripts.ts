// The v1 Python script UI (pick a folder, list, run) and its output panel. Owner: WP1.5.
// M5 replaces the v1 commands with the script registry; this namespace goes with them.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Scripts',
  groupConfigure: 'Configure',
  groupScripts: 'Python Scripts',

  pickFolder: 'Scripts Dir',
  pickFolderTitle: 'Select the Python scripts folder',
  folderTooltip: 'Scripts: {folder}',
  noFolder: 'Set the scripts folder first',
  selectScript: 'Select a script…',
  selectScriptFirst: 'Select a script first',
  noScripts: 'No .py files found',
  run: 'Run',
  runTooltip: 'Run {script}',

  found_one: 'Found {count} script in {folder}',
  found_other: 'Found {count} scripts in {folder}',
  noneFound: 'No .py files found in {folder}',
  running: 'Running {script}…',
  finished: '{script} finished',
  failed: '{script} failed, see Script Output',
  runFailed: 'Could not run {script}',
  listFailed: 'Could not list the Python scripts',
  folderFailed: 'Could not open the folder dialog',
  desktopOnly: 'Python scripts are only available in the gEdit desktop app',

  outputTitle: 'Script Output',
  outputEmpty: 'Run a Python script to see its output here.',
  outputRunning: 'Running the script…',
  labelStdout: 'Raw stdout',
  labelStderr: 'stderr',
  labelJson: 'Structured result',
  statusRunning: 'Script: {script}',
  statusIdle: 'No script running',
} as const satisfies Messages;
