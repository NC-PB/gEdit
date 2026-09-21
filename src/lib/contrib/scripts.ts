// The v2 script UI: the Tools group, the `script.*` commands, the Output panel and the
// status item (plan §5 WP5.2, §7.9, §7.11). Owner: **WP5.2**.
// One feature per file (plan AD-3); see ./README.md.
//
// **This file replaced `contrib/scriptsV1.ts`, which I5 deleted (plan D14).** The panel id
// `output` and the status-item id `script` are pinned by §7.9 (`output-panel`,
// `output-stdout`, `output-stderr`, `output-json`, `output-cancel`, `data-item="script"`),
// so v2 keeps them rather than inventing `output2`. A duplicate panel id throws and
// `loadContributions` skips the contribution that threw, so the two could never load
// together — which is why the removal and this file had to arrive in the same commit.
//
// **What lives here and what does not.** Running a script is `ScriptService.run()`
// (`app/scripts.ts`, WP5.1) from its first step to its last: the profile filter, the
// parameter form, the input scope, the context, the version guard, `script_run`,
// `decideApply` and the apply. Nothing in this file repeats any of it, so a script
// started from the ribbon, from the palette, from F9 or from `script.run:<id>` goes
// through exactly the same sequence and the same safety bar. What this file owns is the
// *surface*: which commands exist, when they are enabled, and what the three components
// show.
//
// **Nothing here runs a script on its own** (plan §3, standing rule 5). `activate()`
// lists the folders and probes nothing; there is no run-on-open, no run-on-save and no
// timer.
//
// **One filter, two readers.** `scriptsForProfile` (`core/scripting/filter.ts`, WP5.1) is
// the only answer to "is this script offered here". The ribbon builds the menu from it and
// `run()` applies it again before it starts, so a script hidden for the active dialect
// cannot be reached through the palette either.
//
// **Why the dynamic commands are re-registered.** `script.run:<id>` is one command per
// discovered script, so the palette lists scripts by name and a shortcut could later be
// bound to one. The set changes whenever `scripts.list` changes (startup, `script.rescan`,
// `script.new`, `script.addFolder`), and `commands.register` throws on a duplicate id —
// so the previous batch is disposed before the next one is registered.
//
// **Who reveals the Output panel.** `ScriptService` does, and only it (I5 decision: WP5.1
// and WP5.2 had each written the policy once, and two owners meant a `replace` run got the
// panel thrown open over the program it had just edited). The service reveals it *before* a
// `panel`-mode run — where the output is the result — and *after any failure*, which is the
// safety bar's "failures are visible". A `replace` or `report` run that worked leaves the
// layout alone: the edit is in the editor and the findings are in Results, and the bottom
// region flipping from Output to Results mid-run would only hide the one the user wants.
// Cancel stays reachable throughout because the status item *is* the Cancel control.
//
// **Why `notifyContextChanged`.** `CommandContext` carries `scriptRunning` and
// `bootstrap.ts` already watches it, but nothing tells the ribbon when the *Python probe*
// or the *script list* answers. Both decide enablement here, so this file nudges the
// registry itself instead of widening `CommandContext` (which `bootstrap.ts`, and not
// WP5.2, owns).

import CircleStop from 'lucide-svelte/icons/circle-stop';
import Copy from 'lucide-svelte/icons/copy';
import FileCode from 'lucide-svelte/icons/file-code';
import FilePlus from 'lucide-svelte/icons/file-plus';
import FolderPlus from 'lucide-svelte/icons/folder-plus';
import Play from 'lucide-svelte/icons/play';
import RefreshCw from 'lucide-svelte/icons/refresh-cw';
import { get } from 'svelte/store';
import ScriptsMenu from '$lib/components/menus/ScriptsMenu.svelte';
import ScriptOutputPanel from '$lib/components/panels/ScriptOutputPanel.svelte';
import ScriptStatusItem from '$lib/components/status/ScriptStatusItem.svelte';
import { asIcon } from '$lib/app/icons';
import { dialogs } from '$lib/app/dialogs';
import { files } from '$lib/app/fileOps';
import { modals } from '$lib/app/modals';
import { commands, notifyContextChanged } from '$lib/app/registry/commands';
import { scripts } from '$lib/app/scripts';
import { status } from '$lib/app/status';
import { scriptsForProfile, scriptLabel } from '$lib/core/scripting/filter';
import { lastScriptId } from '$lib/stores/scripts';
import { settings } from '$lib/stores/settings';
import { t } from '$lib/i18n';
import { baseName, isTauriRuntime } from '$lib/utils/platform';
import {
  scriptCopyToUser,
  scriptNew,
  scriptSourcePath,
  type ScriptEntry,
} from '$lib/platform/commands';
import type { CommandDef, Contribution, Disposable, Msg, QuickPickItem } from '$lib/app/types';

/** The id the Output panel registers under; §7.9 pins `output-*` to it. */
export const OUTPUT_PANEL_ID = 'output';

/** The prefix of the per-script commands. `script.run:bundled:scale_feed.py`. */
export const RUN_COMMAND_PREFIX = 'script.run:';

/** `gedit_nc.py` is the script library, not a script (`scripts/discovery.rs`). */
const LIBRARY_FILE_NAME = 'gedit_nc.py';

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** The script list, without the entries a later root shadows. */
export function visibleScripts(): ScriptEntry[] {
  return get(scripts.list).filter((entry) => !entry.shadowed);
}

/** The scripts offered for `profileId`, through the one filter WP5.1 owns. */
function offeredScripts(profileId: string | null): ScriptEntry[] {
  return scriptsForProfile(get(scripts.list), profileId);
}

function entryById(scriptId: string): ScriptEntry | undefined {
  return get(scripts.list).find((entry) => entry.id === scriptId);
}

/** A script's display name. Data, untranslated (AD-14). */
function labelOf(scriptId: string): string {
  const entry = entryById(scriptId);
  return entry ? scriptLabel(entry) : scriptId;
}

/**
 * Whether a run may start: a usable interpreter, a document to run against and no run
 * already in flight.
 *
 * `python === null` means "not asked yet" (the probe is fired detached after the first
 * render), which disables the commands exactly like a missing interpreter but without the
 * "Python not found" notice — `ScriptsMenu` makes that distinction visible.
 */
export function canRun(activeDocId: string | null): boolean {
  return (
    activeDocId !== null && get(scripts.python)?.ok === true && get(scripts.running) === null
  );
}

/** The script backend needs Tauri; in a plain browser say so instead of failing. */
function desktopOnly(): boolean {
  if (isTauriRuntime()) return true;
  status.show(t('scripts.desktopOnly'), { error: true });
  return false;
}

/**
 * A rescan that cannot become an unhandled rejection.
 *
 * `ScriptService.rescan` records the reason in `scriptListError`, which `ScriptsMenu`
 * shows; a second status error on top of it would only repeat what the ribbon already
 * says. `activate()` uses this, so a folder that cannot be read never breaks startup.
 */
function rescanQuietly(): Promise<void> {
  return scripts.rescan().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// New script names
// ---------------------------------------------------------------------------

/**
 * The same rules `scripts/discovery.rs` applies to a new script name
 * (`new_script_name` + `is_safe_segment`), checked in the prompt so the user sees the
 * problem under the field instead of an error dialog after the round trip. Rust stays the
 * authority: this only moves the message earlier.
 *
 * Returns a `Msg` **key** while the value is unusable, which is what `modals.prompt`
 * expects and what `data-error` carries (§7.9).
 */
export function validateScriptName(value: string): Msg | null {
  const title = value.trim();
  const stem = (title.endsWith('.py') ? title.slice(0, -'.py'.length) : title).trimEnd();
  if (stem === '') return { key: 'scripts.nameEmpty' };
  if (`${stem}.py` === LIBRARY_FILE_NAME) return { key: 'scripts.nameReserved' };
  const unsafe =
    stem.startsWith('_') ||
    stem.startsWith('.') ||
    stem.endsWith('.') ||
    /[/\\:]/.test(stem) ||
    // Control characters, which `is_safe_segment` refuses too.
    [...stem].some((ch) => ch < ' ' || ch === '\u007f');
  return unsafe ? { key: 'scripts.nameInvalid' } : null;
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

function pickItem(entry: ScriptEntry): QuickPickItem<string> {
  return {
    label: scriptLabel(entry),
    description: entry.meta?.description || undefined,
    detail: entry.group ?? undefined,
    value: entry.id,
  };
}

/** Asks which script to use; `undefined` when the user cancelled or there are none. */
async function pickScript(
  entries: ScriptEntry[],
  placeholder: string,
): Promise<string | undefined> {
  if (entries.length === 0) {
    status.show(t('scripts.noScriptsToPick'));
    return undefined;
  }
  return modals.quickPick(entries.map(pickItem), { placeholder });
}

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

/** F9: choose one of the scripts offered for the active dialect, then run it. */
async function runPicker(profileId: string | null): Promise<void> {
  const scriptId = await pickScript(
    offeredScripts(profileId),
    t('scripts.runPickerPlaceholder'),
  );
  if (scriptId === undefined) return;
  await scripts.run(scriptId);
}

async function cancelRun(): Promise<void> {
  // The service owns the "stopping…" message (sticky, `scripts.cancelling`, cleared when the
  // run's own promise ends), so the command only forwards. A second message here would be
  // overwritten in the same tick, and the panel's and the status bar's Cancel buttons reach
  // `scripts.cancel()` directly, where one command's wording could not reach them.
  if (get(scripts.running) === null) return;
  await scripts.cancel();
}

/** Creates `<config>/scripts/<name>.py` from the template and opens it for editing. */
async function newScript(): Promise<void> {
  if (!desktopOnly()) return;
  const name = await modals.prompt({
    title: t('scripts.newTitle'),
    placeholder: t('scripts.newPlaceholder'),
    validate: validateScriptName,
  });
  if (name === undefined) return;
  let path: string;
  try {
    path = await scriptNew(name);
  } catch (err) {
    status.show(t('scripts.newFailed'), { error: true, detail: detailOf(err) });
    await dialogs.error(t('scripts.newFailed'), err);
    return;
  }
  await files.open([path]);
  await rescanQuietly();
  status.show(t('scripts.created', { name: baseName(path) }));
}

/** Copies a script into the user folder, where it shadows the original, and opens it. */
async function copyToUser(scriptId?: string): Promise<void> {
  if (!desktopOnly()) return;
  let wanted = scriptId;
  if (wanted === undefined) {
    const editable = visibleScripts().filter((entry) => !entry.editable);
    if (editable.length === 0) {
      status.show(t('scripts.copyNothing'));
      return;
    }
    wanted = await pickScript(editable, t('scripts.pickPlaceholder'));
    if (wanted === undefined) return;
  }
  const label = labelOf(wanted);
  let path: string;
  try {
    path = await scriptCopyToUser(wanted);
  } catch (err) {
    status.show(t('scripts.copyFailed', { script: label }), { error: true, detail: detailOf(err) });
    await dialogs.error(t('scripts.copyFailed', { script: label }), err);
    return;
  }
  // The copy is opened, not just made: the grant `script_copy_to_user` hands back exists
  // so the user can edit it (§7.6), and "Copy to My Scripts" with nothing on screen
  // afterwards leaves them hunting for a folder they were never shown.
  await files.open([path]);
  await rescanQuietly();
  status.show(t('scripts.copied', { script: label }));
}

/**
 * Opens a script's source.
 *
 * A bundled script has no editable source — Rust refuses `script_source_path` for a
 * `bundled:` id (plan §3) — so instead of showing that error the user is offered the copy
 * that *is* editable, which is what `ScriptEntry.editable` exists for.
 */
async function openSource(scriptId?: string): Promise<void> {
  if (!desktopOnly()) return;
  let wanted = scriptId;
  if (wanted === undefined) {
    wanted = await pickScript(visibleScripts(), t('scripts.pickPlaceholder'));
    if (wanted === undefined) return;
  }
  const entry = entryById(wanted);
  const label = labelOf(wanted);

  if (entry && !entry.editable) {
    const copy = await dialogs.confirm({
      title: t('scripts.openBundledTitle'),
      message: t('scripts.openBundledMessage', { script: label }),
      ok: t('scripts.copyButton'),
      cancel: t('common.cancel'),
      kind: 'info',
    });
    if (!copy) return;
    await copyToUser(wanted);
    return;
  }

  try {
    const path = await scriptSourcePath(wanted);
    await files.open([path]);
  } catch (err) {
    status.show(t('scripts.openFailed', { script: label }), { error: true, detail: detailOf(err) });
    await dialogs.error(t('scripts.openFailed', { script: label }), err);
  }
}

async function rescan(): Promise<void> {
  if (!desktopOnly()) return;
  try {
    await scripts.rescan();
  } catch (err) {
    status.show(t('scripts.rescanFailed'), { error: true, detail: detailOf(err) });
    return;
  }
  status.show(t('scripts.rescanned', { count: visibleScripts().length }));
}

/**
 * Adds a folder to `scripts.folders`.
 *
 * The setting is written through `settings.save`, like every other key: Rust reads the
 * list straight from `settings.json` and it never crosses IPC in the other direction
 * (AD-8). Adding a folder therefore widens where scripts may come from, which is the
 * user's decision to make and is why this is a command and not something a script can do.
 */
async function addFolder(): Promise<void> {
  if (!desktopOnly()) return;
  let folder: string | null;
  try {
    folder = await dialogs.pickFolder({ title: t('scripts.addFolderTitle') });
  } catch (err) {
    status.show(t('scripts.folderFailed'), { error: true, detail: detailOf(err) });
    await dialogs.error(t('scripts.folderFailed'), err);
    return;
  }
  if (folder === null) return;

  const current = settings.get('scripts.folders');
  if (current.includes(folder)) {
    status.show(t('scripts.folderAlready', { folder: baseName(folder) }));
    return;
  }
  try {
    await settings.save({ 'scripts.folders': [...current, folder] });
  } catch (err) {
    status.show(t('scripts.folderAddFailed'), { error: true, detail: detailOf(err) });
    await dialogs.error(t('scripts.folderAddFailed'), err);
    return;
  }
  // No rescan here: the `scripts.folders` subscription in `activate()` is the one owner of
  // "the folder list changed, re-list", and it covers a folder added in the settings dialog
  // too. This command only exists while that subscription does, so it cannot be missed.
  status.show(t('scripts.folderAdded', { folder: baseName(folder) }));
}

function detailOf(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** A command id passed by the ribbon or the palette; anything else means "ask". */
function idArg(arg: unknown): string | undefined {
  return typeof arg === 'string' && arg.length > 0 ? arg : undefined;
}

// ---------------------------------------------------------------------------
// The dynamic `script.run:<id>` commands
// ---------------------------------------------------------------------------

/**
 * One command per discovered script, so F1 lists scripts by name and the ribbon buttons
 * go through the registry like every other control.
 *
 * The title is the script's own name and therefore **not** an i18n key: `t()` returns an
 * unknown key unchanged, which is exactly the fallback `contrib/blocks.ts` relies on for
 * block names (AD-14).
 */
export function runCommandsFor(entries: readonly ScriptEntry[]): CommandDef[] {
  return entries
    .filter((entry) => !entry.shadowed)
    .map((entry) => ({
      id: `${RUN_COMMAND_PREFIX}${entry.id}`,
      title: scriptLabel(entry),
      category: 'scripts.category',
      global: true,
      enabled: (c) =>
        canRun(c.activeDocId) &&
        offeredScripts(c.profileId).some((offered) => offered.id === entry.id),
      run: () => scripts.run(entry.id),
    }));
}

// ---------------------------------------------------------------------------
// The contribution
// ---------------------------------------------------------------------------

export default {
  id: 'scripts',
  commands: [
    {
      id: 'script.runPicker',
      title: 'scripts.runPicker',
      category: 'scripts.category',
      icon: asIcon(Play),
      keys: 'F9',
      global: true,
      enabled: (c) => canRun(c.activeDocId),
      run: (c) => runPicker(c.profileId),
    },
    {
      id: 'script.runLast',
      title: 'scripts.runLast',
      category: 'scripts.category',
      keys: 'Mod+F9',
      global: true,
      enabled: (c) => canRun(c.activeDocId) && get(lastScriptId) !== null,
      run: () => scripts.runLast(),
    },
    {
      id: 'script.cancel',
      title: 'scripts.cancel',
      category: 'scripts.category',
      icon: asIcon(CircleStop),
      global: true,
      enabled: () => get(scripts.running) !== null,
      run: () => cancelRun(),
    },
    {
      id: 'script.new',
      title: 'scripts.newScript',
      category: 'scripts.category',
      icon: asIcon(FilePlus),
      global: true,
      run: () => dialogs.exclusive(() => newScript()),
    },
    {
      id: 'script.copyToUser',
      title: 'scripts.copyToUser',
      category: 'scripts.category',
      icon: asIcon(Copy),
      global: true,
      enabled: () => visibleScripts().some((entry) => !entry.editable),
      run: (_c, arg) => dialogs.exclusive(() => copyToUser(idArg(arg))),
    },
    {
      id: 'script.openSource',
      title: 'scripts.openSource',
      category: 'scripts.category',
      icon: asIcon(FileCode),
      global: true,
      enabled: () => visibleScripts().length > 0,
      run: (_c, arg) => dialogs.exclusive(() => openSource(idArg(arg))),
    },
    {
      id: 'script.rescan',
      title: 'scripts.rescan',
      category: 'scripts.category',
      icon: asIcon(RefreshCw),
      global: true,
      run: () => rescan(),
    },
    {
      id: 'script.addFolder',
      title: 'scripts.addFolder',
      category: 'scripts.category',
      icon: asIcon(FolderPlus),
      global: true,
      run: () => dialogs.exclusive(() => addFolder()),
    },
  ],
  ribbon: [
    { tab: 'tools', group: 'scripts.groupScripts', command: 'script.runPicker', order: 10 },
    { tab: 'tools', group: 'scripts.groupScripts', command: 'script.cancel', order: 20 },
    { tab: 'tools', group: 'scripts.groupManage', command: 'script.new', order: 10 },
    { tab: 'tools', group: 'scripts.groupManage', command: 'script.openSource', order: 20 },
    { tab: 'tools', group: 'scripts.groupManage', command: 'script.rescan', order: 30 },
    { tab: 'tools', group: 'scripts.groupManage', command: 'script.addFolder', order: 40 },
  ],
  ribbonGroups: [
    // Joins the "Python Scripts" group and renders after its two buttons (`ribbonModel`).
    { tab: 'tools', group: 'scripts.groupScripts', order: 30, component: ScriptsMenu },
  ],
  panels: [
    {
      id: OUTPUT_PANEL_ID,
      region: 'bottom',
      title: 'scripts.outputTitle',
      component: ScriptOutputPanel,
      order: 10,
    },
  ],
  statusItems: [{ id: 'script', side: 'right', order: 50, component: ScriptStatusItem }],
  activate(): Disposable {
    let runCommands: Disposable | null = null;

    // The ribbon re-reads enablement when `commands.changed` bumps, and `bootstrap.ts`
    // only watches the pieces of `CommandContext`. The Python probe and the script list
    // decide enablement here, so they have to nudge the registry themselves.
    const stopPython = scripts.python.subscribe(() => notifyContextChanged());
    const stopLast = lastScriptId.subscribe(() => notifyContextChanged());

    // Follow the two settings this feature reads (I5). `script.addFolder` already rescans
    // after its own write, but the settings dialog writes both keys too, and before this
    // nothing reacted: a user who fixed `scripts.python` had to restart before the script
    // commands came back on — exactly the moment they are trying to recover from — and a
    // folder added in the dialog stayed invisible until the next rescan.
    //
    // The first subscriber call carries the values `settings.load()` already put there, so
    // it only records them: the startup probe and the startup listing are in flight below.
    let interpreter: string | undefined;
    let folders: string | undefined;
    const stopSettings = settings.values.subscribe((values) => {
      const nextInterpreter = values['scripts.python'];
      const nextFolders = values['scripts.folders'].join('\u0000');
      const first = interpreter === undefined;
      const changedInterpreter = !first && nextInterpreter !== interpreter;
      const changedFolders = !first && nextFolders !== folders;
      interpreter = nextInterpreter;
      folders = nextFolders;
      // A new interpreter changes what a run *uses*, not what discovery *finds* (the scan
      // and the header parse are Rust's and read no Python), so the two are separate.
      if (changedInterpreter) void scripts.checkPython();
      if (changedFolders) void rescanQuietly();
    });

    const stopList = scripts.list.subscribe((entries) => {
      // Dispose first: `commands.register` throws on an id that is already registered,
      // and a rescan usually returns most of the same ids.
      runCommands?.();
      runCommands = commands.register(runCommandsFor(entries));
    });

    // The list is Rust's. Read it once so the Tools group and the palette have something
    // on the first render; a failure lands in `scriptListError`, which the menu shows.
    void rescanQuietly();

    return () => {
      stopList();
      stopSettings();
      stopLast();
      stopPython();
      runCommands?.();
      runCommands = null;
    };
  },
} satisfies Contribution;
