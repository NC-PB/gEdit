// The Tools tab's script list (plan §5 WP5.2, §7.9: `scripts-group`, `script-item` with
// `data-script-id`). Rendered with `svelte/server`, so no DOM and no Monaco.
//
// The four empty states are the point of these tests: "not asked yet", "no Python", "the
// folders could not be read" and "nothing for this dialect" are four different problems
// with four different fixes, and a single "no scripts" for all of them sends the user
// looking in the wrong place. The fifth case pins the seam a scenario clicks.
//
// `core/scripting/filter.ts` is WP5.1's and still the P5 stub, so the filter is faked with
// the rules its header states.

import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocMeta } from '$lib/app/types';
import type { ScriptEntry, ScriptMeta } from '$lib/platform/commands';

const fake = vi.hoisted(() => ({ active: null as DocMeta | null }));

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
  groupScripts: (entries: ScriptEntry[]) => {
    const groups = new Map<string | null, ScriptEntry[]>();
    for (const entry of entries) {
      const list = groups.get(entry.group) ?? [];
      list.push(entry);
      groups.set(entry.group, list);
    }
    return [...groups].map(([group, scripts]) => ({ group, scripts }));
  },
}));

vi.mock('$lib/app/scripts', async () => {
  const { derived } = await import('svelte/store');
  const stores = await import('$lib/stores/scripts');
  return {
    formKey: (id: string) => `script:${id}`,
    scripts: {
      list: derived(stores.scriptList, (v) => v),
      python: derived(stores.pythonStatus, (v) => v),
      running: derived(stores.runningScript, (v) => v),
      rescan: async (): Promise<void> => undefined,
      run: async (): Promise<void> => undefined,
      runLast: async (): Promise<void> => undefined,
      cancel: async (): Promise<void> => undefined,
      checkPython: async () => null,
    },
  };
});

vi.mock('$lib/stores/documents', () => {
  const active = writable<DocMeta | null>(null);
  active.subscribe((value) => {
    fake.active = value;
  });
  return { docs: { active, setActive: (v: DocMeta | null) => active.set(v) } };
});

const ScriptsMenu = (await import('./ScriptsMenu.svelte')).default;
const { commands, resetCommandsForTest } = await import('$lib/app/registry/commands');
const { pythonStatus, resetScriptsForTest, scriptList, scriptListError } = await import(
  '$lib/stores/scripts'
);
const { docs } = (await import('$lib/stores/documents')) as unknown as {
  docs: { setActive(v: DocMeta | null): void };
};

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
    editable: true,
    ...patch,
  };
}

/** The registry is the single source of enablement, so the test drives it. */
function registerRun(id: string, enabled: boolean): void {
  commands.register({
    id: `script.run:${id}`,
    title: id,
    enabled: () => enabled,
    run: () => undefined,
  });
}

const menu = (): string => render(ScriptsMenu).body;

beforeEach(() => {
  resetScriptsForTest();
  resetCommandsForTest();
  docs.setActive({ id: 'd1', profileId: 'fanuc-gcode' } as DocMeta);
});

afterEach(() => {
  docs.setActive(null);
});

describe('empty states', () => {
  it('says nothing about Python until the probe has answered', () => {
    const html = menu();
    expect(html).not.toContain('Python 3.9 or newer was not found');
    expect(html).toContain('No scripts found.');
  });

  it('shows the notice, with the interpreter detail as the tooltip, when Python is missing', () => {
    pythonStatus.set({
      ok: false,
      interpreter: null,
      version: null,
      message: 'python3: command not found',
    });
    scriptList.set([entry('user:a.py')]);
    const html = menu();
    expect(html).toContain('Python 3.9 or newer was not found');
    expect(html).toContain('python3: command not found');
    expect(html).not.toContain('data-testid="script-item"');
  });

  it('names the folder problem instead of claiming there are no scripts', () => {
    scriptListError.set('/work/scripts: permission denied');
    const html = menu();
    expect(html).toContain('Could not read the script folders');
    expect(html).toContain('permission denied');
  });

  it('separates "nothing for this dialect" from "nothing at all"', () => {
    expect(menu()).toContain('No scripts found.');
    scriptList.set([entry('user:k.py', { meta: meta({ profiles: ['heidenhain-klartext'] }) })]);
    expect(menu()).toContain('No scripts for this dialect');
  });
});

describe('the script items', () => {
  it('renders one group per folder and one item per script, keyed by id', () => {
    scriptList.set([
      entry('user:a.py', { meta: meta({ name: 'Scale feed' }) }),
      entry('user:tools/b.py', { group: 'tools' }),
    ]);
    const html = menu();
    expect(html.match(/data-testid="scripts-group"/g)).toHaveLength(2);
    expect(html).toContain('data-script-id="user:a.py"');
    expect(html).toContain('data-script-id="user:tools/b.py"');
    expect(html).toContain('Scale feed');
    expect(html).toContain('tools');
  });

  it('uses the description as the tooltip and says when a header could not be read', () => {
    scriptList.set([
      entry('user:a.py', { meta: meta({ name: 'Scale feed', description: 'Scales F words' }) }),
      entry('user:b.py', { headerError: 'line 3: expected a table' }),
    ]);
    const html = menu();
    expect(html).toContain('Scale feed — Scales F words');
    expect(html).toContain('b.py: the header could not be read');
  });

  it('takes its disabled state from the registry and not from a second copy of the rules', () => {
    scriptList.set([entry('user:a.py'), entry('user:b.py')]);
    registerRun('user:a.py', true);
    registerRun('user:b.py', false);
    const html = menu();
    expect(html).toMatch(/data-script-id="user:b.py"[^>]*disabled/);
    expect(html).not.toMatch(/data-script-id="user:a.py"[^>]*disabled/);
  });

  it('still lists the scripts without a document, but none of them can be started', () => {
    docs.setActive(null);
    scriptList.set([entry('user:a.py', { meta: meta({ profiles: ['fanuc-gcode'] }) })]);
    // `profileId === null` hides nothing (the filter's rule); the item is there but the
    // registry has no command for it yet, so it cannot be started.
    const html = menu();
    expect(html).toContain('data-script-id="user:a.py"');
    expect(html).toMatch(/data-script-id="user:a.py"[^>]*disabled/);
  });
});
