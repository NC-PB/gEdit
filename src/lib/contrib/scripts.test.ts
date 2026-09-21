// What the v2 script contribution declares and does (plan §5 WP5.2, §7.9, §7.11).
//
// Three things here are contracts rather than implementation details, and each one breaks
// something outside this file when it changes:
//
//  - **F9 and Mod+F9** are §7.11's. A key the plan does not list is a conflict the command
//    registry reports as a `console.error`, and the runtime harness turns an unexpected
//    console error into a failed scenario (same reasoning as `navigation.test.ts`).
//  - **The panel id `output` and the status-item id `script`** are what §7.9 pins
//    `output-panel` / `output-stdout` / `output-stderr` / `output-json` / `output-cancel`
//    and `data-item="script"` to. Renaming either silently drops M0 scenarios.
//  - **`script.run:<id>` follows the profile filter**, the same filter `ScriptService.run`
//    applies, so the palette cannot become a hole in it.
//
// `ScriptService` and `core/scripting/filter.ts` are faked here on purpose, even now that
// both are real: what is under test is the surface — which commands exist, when they are
// enabled, what each one calls — and not the run sequence, which `app/scripts.test.ts`
// covers against its own fake backend.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext, CommandDef } from '$lib/app/types';
import type { ScriptEntry, ScriptMeta } from '$lib/platform/commands';

const fake = vi.hoisted(() => ({
  isTauri: true,
  calls: [] as string[],
  messages: [] as string[],
  opened: [] as string[],
  /** What `modals.prompt` answers. */
  promptValue: undefined as string | undefined,
  /** What `modals.quickPick` answers. */
  pickValue: undefined as string | undefined,
  /** What `dialogs.confirm` answers. */
  confirmValue: false,
  /** What `dialogs.pickFolder` answers. */
  folderValue: null as string | null,
  reset(): void {
    fake.isTauri = true;
    fake.calls = [];
    fake.messages = [];
    fake.opened = [];
    fake.promptValue = undefined;
    fake.pickValue = undefined;
    fake.confirmValue = false;
    fake.folderValue = null;
  },
}));

vi.mock('$lib/utils/platform', async (original) => ({
  ...(await original<typeof import('$lib/utils/platform')>()),
  isTauriRuntime: () => fake.isTauri,
}));

vi.mock('$lib/core/scripting/filter', () => ({
  scriptLabel: (entry: ScriptEntry) => entry.meta?.name || entry.fileName,
  scriptsForProfile: (entries: ScriptEntry[], profileId: string | null) =>
    entries.filter(
      (entry) =>
        !entry.shadowed &&
        (entry.meta?.profiles == null ||
          profileId === null ||
          entry.meta.profiles.includes(profileId)),
    ),
  groupScripts: (entries: ScriptEntry[]) => [{ group: null, scripts: entries }],
}));

vi.mock('$lib/app/scripts', async () => {
  const { derived } = await import('svelte/store');
  const stores = await import('$lib/stores/scripts');
  const record =
    (name: string) =>
    async (...args: unknown[]): Promise<void> => {
      fake.calls.push(args.length > 0 ? `${name}:${String(args[0])}` : name);
    };
  return {
    formKey: (id: string) => `script:${id}`,
    scripts: {
      list: derived(stores.scriptList, (v) => v),
      python: derived(stores.pythonStatus, (v) => v),
      running: derived(stores.runningScript, (v) => v),
      rescan: record('rescan'),
      run: record('run'),
      runLast: record('runLast'),
      cancel: record('cancel'),
      checkPython: record('checkPython'),
    },
  };
});

// Partial: `stores/settings.ts` reaches into the same module for `configLoad` and
// `settingsSave`, and those must stay the real (inert outside Tauri) wrappers.
vi.mock('$lib/platform/commands', async (original) => ({
  ...(await original<typeof import('$lib/platform/commands')>()),
  // `isTauriRuntime` is faked to true above, so the settings store would really try to
  // write the file when `script.addFolder` saves. The assertion is on the stored value,
  // not on the write, so the write is silenced rather than recorded.
  settingsSave: async (): Promise<void> => undefined,
  scriptNew: async (name: string) => {
    fake.calls.push(`scriptNew:${name}`);
    return `/cfg/scripts/${name}.py`;
  },
  scriptCopyToUser: async (id: string) => {
    fake.calls.push(`scriptCopyToUser:${id}`);
    return '/cfg/scripts/copy.py';
  },
  scriptSourcePath: async (id: string) => {
    fake.calls.push(`scriptSourcePath:${id}`);
    return '/cfg/scripts/source.py';
  },
}));

vi.mock('$lib/app/dialogs', () => ({
  dialogs: {
    confirm: async () => {
      fake.calls.push('confirm');
      return fake.confirmValue;
    },
    error: async () => {
      fake.calls.push('errorDialog');
    },
    pickFolder: async () => {
      fake.calls.push('pickFolder');
      return fake.folderValue;
    },
    exclusive: <T>(op: () => Promise<T>) => op(),
  },
}));

vi.mock('$lib/app/modals', () => ({
  modals: {
    prompt: async () => {
      fake.calls.push('prompt');
      return fake.promptValue;
    },
    quickPick: async () => {
      fake.calls.push('quickPick');
      return fake.pickValue;
    },
  },
}));

vi.mock('$lib/app/fileOps', () => ({
  files: {
    open: async (paths: string[]) => {
      fake.opened.push(...paths);
      return [];
    },
  },
}));

vi.mock('$lib/app/status', () => ({
  status: { show: (text: string) => fake.messages.push(text) },
}));

const contribution = (await import('./scripts')).default;
const { OUTPUT_PANEL_ID, RUN_COMMAND_PREFIX, canRun, runCommandsFor, validateScriptName } =
  await import('./scripts');
const { registerContributions } = await import('$lib/app/contributions');
const { commands, resetCommandsForTest } = await import('$lib/app/registry/commands');
const { layout } = await import('$lib/stores/layout');
const { pythonStatus, resetScriptsForTest, runningScript, scriptList, lastScriptId } =
  await import('$lib/stores/scripts');
const { settings } = await import('$lib/stores/settings');
const { hasKey, t } = await import('$lib/i18n');
const { get } = await import('svelte/store');

const byId = new Map<string, CommandDef>((contribution.commands ?? []).map((d) => [d.id, d]));

function meta(patch: Partial<ScriptMeta> = {}): ScriptMeta {
  return {
    name: '',
    description: '',
    profiles: null,
    input: 'selection-or-document',
    output: 'panel',
    timeout: null,
    envelope: false,
    documents: 'active',
    params: [],
    warnings: [],
    ...patch,
  };
}

function entry(id: string, patch: Partial<ScriptEntry> = {}): ScriptEntry {
  return {
    id,
    root: id.split(':')[0],
    group: null,
    fileName: id.split(':')[1] ?? id,
    meta: null,
    headerError: null,
    shadowed: false,
    editable: !id.startsWith('bundled:'),
    ...patch,
  };
}

const CONTEXT: CommandContext = {
  activeDocId: 'd1',
  profileId: 'fanuc-gcode',
  hasSelection: false,
  editorFocused: true,
  compareOpen: false,
  modalOpen: false,
  scriptRunning: false,
};

const ctx = (patch: Partial<CommandContext> = {}): CommandContext => ({ ...CONTEXT, ...patch });

async function run(id: string, arg?: unknown): Promise<void> {
  await byId.get(id)?.run(CONTEXT, arg);
}

/** A usable interpreter; the probe answers null until it has run. */
function pythonOk(): void {
  pythonStatus.set({ ok: true, interpreter: '/usr/bin/python3', version: '3.12.1', message: null });
}

beforeEach(async () => {
  resetScriptsForTest();
  resetCommandsForTest();
  layout.restore({ bottom: { visible: false, height: 200, active: null } });
  await settings.reset(['scripts.folders', 'scripts.python']);
  // Last, so the reset above does not show up in what a test is looking at.
  fake.reset();
});

describe('commands', () => {
  it('declares exactly the §5 WP5.2 commands, with the §7.11 shortcuts', () => {
    expect([...byId.keys()]).toEqual([
      'script.runPicker',
      'script.runLast',
      'script.cancel',
      'script.new',
      'script.copyToUser',
      'script.openSource',
      'script.rescan',
      'script.addFolder',
    ]);
    expect(Object.fromEntries([...byId].map(([id, def]) => [id, def.keys ?? null]))).toEqual({
      'script.runPicker': 'F9',
      'script.runLast': 'Mod+F9',
      'script.cancel': null,
      'script.new': null,
      'script.copyToUser': null,
      'script.openSource': null,
      'script.rescan': null,
      'script.addFolder': null,
    });
  });

  it('runs outside the editor, because the ribbon and the status bar start them', () => {
    for (const def of byId.values()) expect(def.global, def.id).toBe(true);
  });

  it('has a message for every title and category it names', () => {
    for (const def of byId.values()) {
      expect(hasKey(def.title), def.title).toBe(true);
      expect(def.category !== undefined && hasKey(def.category), def.id).toBe(true);
    }
  });
});

describe('canRun', () => {
  it('needs a document, a usable interpreter and no run in flight', () => {
    expect(canRun('d1')).toBe(false); // the probe has not answered yet
    pythonOk();
    expect(canRun('d1')).toBe(true);
    expect(canRun(null)).toBe(false);

    runningScript.set({ runId: 'r1', scriptId: 'bundled:a.py', startedAt: 0 });
    expect(canRun('d1')).toBe(false);
    runningScript.set(null);

    pythonStatus.set({ ok: false, interpreter: null, version: null, message: 'not found' });
    expect(canRun('d1')).toBe(false);
  });

  it('turns the two run commands off exactly when a run cannot start', () => {
    const picker = byId.get('script.runPicker');
    const last = byId.get('script.runLast');
    expect(picker?.enabled?.(ctx())).toBe(false);
    pythonOk();
    expect(picker?.enabled?.(ctx())).toBe(true);
    // `runLast` also needs something to repeat.
    expect(last?.enabled?.(ctx())).toBe(false);
    lastScriptId.set('bundled:a.py');
    expect(last?.enabled?.(ctx())).toBe(true);
  });

  it('enables Cancel only while a run is in flight, whatever Python says', () => {
    const cancel = byId.get('script.cancel');
    expect(cancel?.enabled?.(ctx())).toBe(false);
    runningScript.set({ runId: 'r1', scriptId: 'bundled:a.py', startedAt: 0 });
    expect(cancel?.enabled?.(ctx())).toBe(true);
  });

  it('leaves the folder and file commands on without an interpreter', () => {
    // Adding a folder or writing a script is how a user gets *ready* to run one; the
    // `m5-no-python` scenario only asks that running is off.
    scriptList.set([entry('bundled:a.py')]);
    expect(byId.get('script.new')?.enabled).toBeUndefined();
    expect(byId.get('script.rescan')?.enabled).toBeUndefined();
    expect(byId.get('script.addFolder')?.enabled).toBeUndefined();
    expect(byId.get('script.openSource')?.enabled?.(ctx())).toBe(true);
    expect(byId.get('script.copyToUser')?.enabled?.(ctx())).toBe(true);
  });
});

describe('the dynamic script.run:<id> commands', () => {
  it('makes one per script, titled with the script name and not with an i18n key', () => {
    const defs = runCommandsFor([
      entry('bundled:scale_feed.py', { meta: meta({ name: 'Scale feed' }) }),
      entry('user:x.py'),
    ]);
    expect(defs.map((d) => d.id)).toEqual([
      `${RUN_COMMAND_PREFIX}bundled:scale_feed.py`,
      `${RUN_COMMAND_PREFIX}user:x.py`,
    ]);
    expect(defs[0].title).toBe('Scale feed');
    expect(defs[1].title).toBe('x.py');
  });

  it('leaves out a shadowed script, which is unreachable by id', () => {
    expect(runCommandsFor([entry('bundled:a.py', { shadowed: true })])).toEqual([]);
  });

  it('follows the profile filter, so the palette is not a hole in it', () => {
    const klartext = entry('bundled:k.py', { meta: meta({ profiles: ['heidenhain-klartext'] }) });
    scriptList.set([klartext]);
    pythonOk();
    const [def] = runCommandsFor([klartext]);
    expect(def.enabled?.(ctx({ profileId: 'heidenhain-klartext' }))).toBe(true);
    expect(def.enabled?.(ctx({ profileId: 'fanuc-gcode' }))).toBe(false);
  });

  it('hands the run to the service and never to a backend command of its own', async () => {
    const [def] = runCommandsFor([entry('user:x.py')]);
    await def.run(CONTEXT);
    expect(fake.calls).toEqual(['run:user:x.py']);
  });
});

describe('registration', () => {
  it('keeps the §7.9 ids the M0 scenarios are pinned to', () => {
    expect(contribution.panels?.map((p) => p.id)).toEqual([OUTPUT_PANEL_ID]);
    expect(OUTPUT_PANEL_ID).toBe('output');
    expect(contribution.panels?.[0].region).toBe('bottom');
    expect(contribution.statusItems?.map((s) => s.id)).toEqual(['script']);
  });

  it('puts its buttons on the Tools tab and its script list in the Scripts group', () => {
    for (const item of contribution.ribbon ?? []) expect(item.tab, item.command).toBe('tools');
    expect(contribution.ribbon?.map((i) => i.command)).toEqual([
      'script.runPicker',
      'script.cancel',
      'script.new',
      'script.openSource',
      'script.rescan',
      'script.addFolder',
    ]);
    expect(contribution.ribbonGroups?.[0].group).toBe('scripts.groupScripts');
    for (const group of new Set((contribution.ribbon ?? []).map((i) => i.group))) {
      expect(hasKey(group), group).toBe(true);
    }
  });

  it('registers a run command per script and drops them again when torn down', async () => {
    const dispose = await registerContributions([contribution]);
    scriptList.set([entry('bundled:a.py'), entry('user:b.py')]);
    expect(commands.has(`${RUN_COMMAND_PREFIX}bundled:a.py`)).toBe(true);
    expect(commands.has(`${RUN_COMMAND_PREFIX}user:b.py`)).toBe(true);

    // A rescan usually returns most of the same ids; registering a duplicate throws, so
    // the previous batch has to go first.
    scriptList.set([entry('bundled:a.py')]);
    expect(commands.has(`${RUN_COMMAND_PREFIX}bundled:a.py`)).toBe(true);
    expect(commands.has(`${RUN_COMMAND_PREFIX}user:b.py`)).toBe(false);

    dispose();
    expect(commands.has(`${RUN_COMMAND_PREFIX}bundled:a.py`)).toBe(false);
    expect(commands.has('script.runPicker')).toBe(false);
  });

  it('lists the folders once at startup and never runs anything by itself', async () => {
    const dispose = await registerContributions([contribution]);
    expect(fake.calls).toEqual(['rescan']);
    dispose();
  });

  // I5: the reveal policy is `ScriptService`'s alone (panel mode before the run, any
  // failure after it). This file used to reveal on every run start too, which threw the
  // panel open over a `replace` run that had just rewritten the program. Cancel does not
  // depend on it — the status item is itself the Cancel control.
  it('does not reveal the Output panel just because a run started', async () => {
    const dispose = await registerContributions([contribution]);
    expect(get(layout.state).bottom.active).toBeNull();
    runningScript.set({ runId: 'r1', scriptId: 'bundled:a.py', startedAt: 0 });
    expect(get(layout.state).bottom).toMatchObject({ visible: false, active: null });
    dispose();
  });
});

describe('running a script', () => {
  it('F9 asks which one, filtered by the active dialect, then hands it to the service', async () => {
    scriptList.set([
      entry('bundled:mill.py', { meta: meta({ profiles: ['fanuc-gcode'] }) }),
      entry('bundled:klartext.py', { meta: meta({ profiles: ['heidenhain-klartext'] }) }),
    ]);
    fake.pickValue = 'bundled:mill.py';
    await run('script.runPicker');
    expect(fake.calls).toEqual(['quickPick', 'run:bundled:mill.py']);
  });

  it('says so instead of opening an empty picker when nothing is offered', async () => {
    await run('script.runPicker');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([t('scripts.noScriptsToPick')]);
  });

  it('starts nothing when the picker is cancelled', async () => {
    scriptList.set([entry('user:a.py')]);
    fake.pickValue = undefined;
    await run('script.runPicker');
    expect(fake.calls).toEqual(['quickPick']);
  });

  it('cancel goes through the service, which owns the message', async () => {
    scriptList.set([entry('user:a.py', { meta: meta({ name: 'Renumber' }) })]);
    runningScript.set({ runId: 'r1', scriptId: 'user:a.py', startedAt: 0 });
    await run('script.cancel');
    expect(fake.calls).toEqual(['cancel']);
    expect(fake.messages).toEqual([]);
  });

  it('cancel does nothing at all when no run is in flight', async () => {
    await run('script.cancel');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([]);
  });
});

describe('new script names', () => {
  it('accepts a plain name, with or without the extension', () => {
    expect(validateScriptName('scale_feed')).toBeNull();
    expect(validateScriptName('scale_feed.py')).toBeNull();
    expect(validateScriptName('  tool list  ')).toBeNull();
  });

  it('refuses what `scripts/discovery.rs` would refuse, before the round trip', () => {
    expect(validateScriptName('')?.key).toBe('scripts.nameEmpty');
    expect(validateScriptName('   ')?.key).toBe('scripts.nameEmpty');
    expect(validateScriptName('.py')?.key).toBe('scripts.nameEmpty');
    expect(validateScriptName('_private')?.key).toBe('scripts.nameInvalid');
    expect(validateScriptName('.hidden')?.key).toBe('scripts.nameInvalid');
    expect(validateScriptName('a/b')?.key).toBe('scripts.nameInvalid');
    expect(validateScriptName('a\\b')?.key).toBe('scripts.nameInvalid');
    expect(validateScriptName('C:name')?.key).toBe('scripts.nameInvalid');
    expect(validateScriptName('trailing.')?.key).toBe('scripts.nameInvalid');
    expect(validateScriptName('a\nb')?.key).toBe('scripts.nameInvalid');
    expect(validateScriptName('gedit_nc')?.key).toBe('scripts.nameReserved');
    expect(validateScriptName('gedit_nc.py')?.key).toBe('scripts.nameReserved');
  });

  it('has a message for every reason it can give', () => {
    for (const key of ['scripts.nameEmpty', 'scripts.nameInvalid', 'scripts.nameReserved']) {
      expect(hasKey(key), key).toBe(true);
    }
  });
});

describe('managing scripts', () => {
  it('creates a script, opens it and re-lists the folders', async () => {
    fake.promptValue = 'my_script';
    await run('script.new');
    expect(fake.calls).toEqual(['prompt', 'scriptNew:my_script', 'rescan']);
    expect(fake.opened).toEqual(['/cfg/scripts/my_script.py']);
    expect(fake.messages).toEqual([t('scripts.created', { name: 'my_script.py' })]);
  });

  it('creates nothing when the name prompt is cancelled', async () => {
    fake.promptValue = undefined;
    await run('script.new');
    expect(fake.calls).toEqual(['prompt']);
    expect(fake.opened).toEqual([]);
  });

  it('says the desktop app is needed instead of failing in a browser', async () => {
    fake.isTauri = false;
    await run('script.new');
    await run('script.rescan');
    await run('script.addFolder');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([
      t('scripts.desktopOnly'),
      t('scripts.desktopOnly'),
      t('scripts.desktopOnly'),
    ]);
  });

  it('offers the editable copy instead of the error for a bundled script', async () => {
    scriptList.set([entry('bundled:a.py', { meta: meta({ name: 'Scale feed' }) })]);
    fake.confirmValue = true;
    await run('script.openSource', 'bundled:a.py');
    expect(fake.calls).toEqual(['confirm', 'scriptCopyToUser:bundled:a.py', 'rescan']);
    expect(fake.opened).toEqual(['/cfg/scripts/copy.py']);
    expect(fake.messages).toEqual([t('scripts.copied', { script: 'Scale feed' })]);
  });

  it('copies a bundled script and opens the copy, because that is what the grant is for', async () => {
    scriptList.set([entry('bundled:a.py')]);
    await run('script.copyToUser', 'bundled:a.py');
    expect(fake.calls).toEqual(['scriptCopyToUser:bundled:a.py', 'rescan']);
    expect(fake.opened).toEqual(['/cfg/scripts/copy.py']);
  });

  it('says there is nothing to copy rather than opening an empty picker', async () => {
    scriptList.set([entry('user:a.py')]);
    await run('script.copyToUser');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([t('scripts.copyNothing')]);
  });

  it('leaves a bundled script alone when the copy is declined', async () => {
    scriptList.set([entry('bundled:a.py')]);
    fake.confirmValue = false;
    await run('script.openSource', 'bundled:a.py');
    expect(fake.calls).toEqual(['confirm']);
    expect(fake.opened).toEqual([]);
  });

  it('opens a user script directly, through the granted path Rust hands back', async () => {
    scriptList.set([entry('user:a.py')]);
    await run('script.openSource', 'user:a.py');
    expect(fake.calls).toEqual(['scriptSourcePath:user:a.py']);
    expect(fake.opened).toEqual(['/cfg/scripts/source.py']);
  });

  it('reports how many scripts a rescan found', async () => {
    scriptList.set([entry('user:a.py'), entry('bundled:b.py', { shadowed: true })]);
    await run('script.rescan');
    expect(fake.calls).toEqual(['rescan']);
    expect(fake.messages).toEqual(['Found 1 script']);
  });

  // The re-list is the `scripts.folders` subscription's, not the command's (I5), so the
  // contribution has to be active for it — which it always is when the command can run.
  // The same subscription is what makes a folder added in the *settings dialog* show up.
  it('adds a picked folder to `scripts.folders`, and that re-lists', async () => {
    const dispose = await registerContributions([contribution]);
    fake.calls = [];
    fake.folderValue = '/work/nc-scripts';
    await run('script.addFolder');
    expect(settings.get('scripts.folders')).toEqual(['/work/nc-scripts']);
    expect(fake.calls).toEqual(['pickFolder', 'rescan']);
    expect(fake.messages).toEqual([t('scripts.folderAdded', { folder: 'nc-scripts' })]);
    dispose();
  });

  it('re-probes Python when `scripts.python` changes, and re-lists when the folders do', async () => {
    const dispose = await registerContributions([contribution]);
    fake.calls = [];
    await settings.save({ 'scripts.python': '/opt/py/bin/python3' });
    expect(fake.calls).toEqual(['checkPython']);
    await settings.save({ 'scripts.folders': ['/work/a'] });
    expect(fake.calls).toEqual(['checkPython', 'rescan']);
    // Saving the same values again is not a change and starts nothing.
    await settings.save({ 'scripts.python': '/opt/py/bin/python3' });
    expect(fake.calls).toEqual(['checkPython', 'rescan']);
    dispose();
  });

  it('does not add the same folder twice', async () => {
    await settings.save({ 'scripts.folders': ['/work/nc-scripts'] });
    fake.folderValue = '/work/nc-scripts';
    await run('script.addFolder');
    expect(settings.get('scripts.folders')).toEqual(['/work/nc-scripts']);
    expect(fake.calls).toEqual(['pickFolder']);
    expect(fake.messages).toEqual([t('scripts.folderAlready', { folder: 'nc-scripts' })]);
  });

  it('changes no setting when the folder dialog is dismissed', async () => {
    fake.folderValue = null;
    await run('script.addFolder');
    expect(settings.get('scripts.folders')).toEqual([]);
    expect(fake.calls).toEqual(['pickFolder']);
  });
});
