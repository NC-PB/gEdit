// The v1 Python script flow: pick a folder, list it, run one (plan §5 WP1.5).
// Owner: WP1.5. One feature per file (plan AD-3); see ./README.md.
//
// Unchanged from M0 apart from where the output goes: the backend commands are still
// `list_python_scripts(folderPath)` and `run_python_script(folderPath, scriptName,
// inputText)`, and the ribbon controls keep the `scripts-*` test ids. Intentional M1
// change: the output is a bottom-region panel instead of a right-hand drawer.
//
// M5 removes the v1 commands (a folder the user picks is the widest path this app grants)
// and replaces this file with the script registry.

import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { dialogs } from '$lib/app/dialogs';
import { status } from '$lib/app/status';
import { editor } from '$lib/monaco/editorService';
import { docs } from '$lib/stores/documents';
import { layout } from '$lib/stores/layout';
import { t } from '$lib/i18n';
import { baseName, isTauriRuntime } from '$lib/utils/platform';
import ScriptOutputPanel from '$lib/components/panels/ScriptOutputPanel.svelte';
import ScriptsGroup from '$lib/components/shell/ScriptsGroup.svelte';
import ScriptStatus from '$lib/components/panels/ScriptStatus.svelte';
import {
  availableScripts,
  lastScript,
  resetScriptOutput,
  scriptData,
  scriptRunning,
  scriptStderr,
  scriptStdout,
  scriptsFolder,
  selectedScript,
  type ScriptResult,
} from '$lib/components/panels/scriptsV1State';
import type { Contribution } from '$lib/app/types';

const OUTPUT_PANEL = 'output';

function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** The script backend needs Tauri; in a plain browser say so instead of failing. */
function desktopOnly(): boolean {
  if (isTauriRuntime()) return true;
  status.show(t('scripts.desktopOnly'), { error: true });
  return false;
}

async function pickFolder(): Promise<void> {
  if (!desktopOnly()) return;
  let folder: string | null;
  try {
    folder = await dialogs.pickFolder({ title: t('scripts.pickFolderTitle') });
  } catch (err) {
    // Same shape as M0's reportError: the status bar keeps the summary, the dialog the detail.
    status.show(t('scripts.folderFailed'), { error: true, detail: errorText(err) });
    await dialogs.error(t('scripts.folderFailed'), err);
    return;
  }
  if (folder === null) return;

  scriptsFolder.set(folder);
  selectedScript.set('');
  try {
    const found = await invoke<string[]>('list_python_scripts', { folderPath: folder });
    availableScripts.set(found);
    status.show(
      found.length > 0
        ? t('scripts.found', { count: found.length, folder: baseName(folder) })
        : t('scripts.noneFound', { folder: baseName(folder) }),
    );
  } catch (err) {
    availableScripts.set([]);
    status.show(t('scripts.listFailed'), { error: true, detail: errorText(err) });
    await dialogs.error(t('scripts.listFailed'), err);
  }
}

/** What the script reads on stdin: the selection, or the whole active document. */
function scriptInput(): string {
  const id = docs.getActiveId();
  if (id === null) return '';
  return editor.selectedText() || editor.getText(id);
}

async function runSelected(): Promise<void> {
  if (!desktopOnly()) return;
  const folder = get(scriptsFolder);
  const name = get(selectedScript);
  if (!folder || !name || get(scriptRunning)) return;

  const inputText = scriptInput();
  scriptRunning.set(true);
  lastScript.set(name);
  resetScriptOutput();
  layout.show(OUTPUT_PANEL);
  status.show(t('scripts.running', { script: name }), { sticky: true });

  try {
    // The backend joins folder + name and validates the name.
    const result = await invoke<ScriptResult>('run_python_script', {
      folderPath: folder,
      scriptName: name,
      inputText,
    });
    scriptStdout.set(result.stdout || '');
    scriptStderr.set(result.stderr || '');
    scriptData.set(result.data ?? null);
    if (result.success) status.show(t('scripts.finished', { script: name }));
    else status.show(t('scripts.failed', { script: name }), { error: true });
  } catch (err) {
    const detail = errorText(err) || t('common.unknownError');
    scriptStderr.set(detail);
    status.show(t('scripts.runFailed', { script: name }), { error: true, detail });
  } finally {
    scriptRunning.set(false);
  }
}

export default {
  id: 'scriptsV1',
  commands: [
    {
      id: 'scripts.pickFolder',
      title: 'scripts.pickFolder',
      category: 'scripts.category',
      global: true,
      run: () => pickFolder(),
    },
    {
      id: 'scripts.run',
      title: 'scripts.run',
      category: 'scripts.category',
      global: true,
      enabled: (c) => !c.scriptRunning && get(selectedScript) !== '',
      run: () => runSelected(),
    },
  ],
  ribbonGroups: [
    { tab: 'tools', group: 'scripts.groupScripts', order: 10, component: ScriptsGroup },
  ],
  panels: [
    {
      id: OUTPUT_PANEL,
      region: 'bottom',
      title: 'scripts.outputTitle',
      component: ScriptOutputPanel,
      order: 10,
    },
  ],
  statusItems: [{ id: 'script', side: 'right', order: 50, component: ScriptStatus }],
} satisfies Contribution;
