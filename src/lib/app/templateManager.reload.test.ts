// A template saved in the manager reaches the Insert tab, the quick pick and completion after the
// reload of the code files (Phase 3 plan §5 P3.9, P3b intB; M13 reload path, AD-29, AD-40), and a
// star in the manager is the star of the Insert tab.
//
// The registries are the application's own (code databases, profiles, documents, machines) and so
// is the user-config reload (`createUserConfig` over an in-memory `<config>/codes/` folder); the
// manager and the template service are the real factories with a fake editor. What is checked is the
// chain a user walks: Save in the manager -> `reloadUserFiles` -> `templates.list` -> the Insert tab's
// groups, the palette's items and the completion list.

import { get, writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completionsAt } from '$lib/core/codes/completionItems';
import { createUserConfig } from './userConfig';
import { baseTemplatesFrom, createTemplateManager, type TemplateManagerDeps } from './templateManager';
import { createTemplateService, templateGroups } from './templateService';
import { pickItems } from '$lib/contrib/templates';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { codes } from '$lib/stores/codes';
import { docs } from '$lib/stores/documents';
import { machines } from '$lib/stores/machines';
import { profiles } from '$lib/stores/profiles';
import { t } from '$lib/i18n';
import type { NewDocMeta } from '$lib/app/types';

// The Insert tab's component and the dialogs it never opens here.
vi.mock('$lib/components/forms/FormDialog.svelte', () => ({ default: {} }));
vi.mock('$lib/components/shell/TemplatesGroup.svelte', () => ({ default: {} }));

const meta: NewDocMeta = {
  path: '/nc/part.nc',
  untitledIndex: null,
  profileId: 'fanuc-gcode',
  encoding: { encoding: 'utf-8', hasBom: false },
  eol: 'lf',
  eolMixedOnLoad: false,
  nul: { leader: 0, trailer: 0, stripped: 0 },
  textDirty: false,
  metaDirty: false,
  disk: null,
  external: 'none',
  readOnly: false,
  readOnlyReason: null,
};

afterEach(() => {
  // The registries are the application's own: put the built-ins alone back for the next test.
  codes.reload([]);
  profiles.reload([]);
  for (const doc of docs.all()) docs.remove(doc.id);
});

function rig() {
  const id = docs.add(meta, { activate: true });
  const folder = new Map<string, string>();
  const memo = new Map<string, Record<string, unknown>>();
  const text = ['O1000', 'G0 X0'];
  const service = createTemplateService({
    docs,
    editor: {
      cursor: () => ({ line: 2, column: 1 }) as never,
      getLineCount: () => text.length,
      getLines: (_id, from, to) => text.slice(from - 1, to),
      insertSnippet: () => false,
      reveal: () => {},
      focus: () => {},
    },
    effective: (docId) => machines.effective(docId),
    revisions: [machines.revision, profiles.revision],
    modals: { form: async () => undefined },
    uiState: { getLastParams: (key) => memo.get(key), setLastParams: (key, value) => void memo.set(key, value) },
    applyLines: () => ({ changedLines: 0 }),
    status: { show: () => {} },
    now: () => new Date(2026, 9, 9, 8, 5),
    t,
  });
  // The M13 load: both folders read, the code registry first, then the profiles (nothing else changes).
  const userConfig = createUserConfig({
    available: () => true,
    list: async (kind) => (kind === 'codes' ? [...folder].map(([name, body]) => ({ name, text: body, error: null })) : []),
    codes,
    profiles,
    docs: () => docs.all(),
    text: () => '',
    setProfile: () => {},
    status: () => {},
    report: () => {},
    paths: writable(null),
    caseInsensitivePaths: false,
    backslashSeparator: false,
  });
  const deps: TemplateManagerDeps = {
    dialects: () => ['fanuc'],
    baseTemplates: (dialect) => baseTemplatesFrom(codes.files(), Object.keys(BUILTIN_CODE_DB_JSON), dialect),
    variants: () => [],
    userFiles: {
      list: async () => [...folder].map(([name, body]) => ({ name, text: body, error: null })),
      path: async (name) => `/cfg/codes/${name}`,
      create: async (name, body) => {
        folder.set(name, body);
        return `/cfg/codes/${name}`;
      },
    },
    reloadUserFiles: () => userConfig.load(),
    docs: { find: () => undefined, open: async () => null, text: () => '', replace: () => {}, refusal: () => null, markClean: () => {}, save: async () => true, activeId: () => id, activate: () => {} },
    confirm: async () => true,
    // The wiring of `contrib/templateManager.ts`: the stars are the service's own.
    favorites: { get: (dialect) => service.favorites(dialect), set: (dialect, tid, on) => service.setFavorite(dialect, tid, on) },
    env: () => null,
  };
  return { id, folder, service, userConfig, deps, memo, text };
}

describe('a template saved in the manager, after the reload of the code files', () => {
  it('is offered by the document’s template list, the Insert tab’s groups, the palette and the completion list', async () => {
    const r = rig();
    expect(r.service.list(r.id).some((d) => d.id === 'my-start')).toBe(false);

    const manager = createTemplateManager(r.deps);
    await manager.load('fanuc', { machineType: 'mill' });
    manager.add();
    const key = get(manager.state).selected!;
    manager.setField(key, 'id', 'my-start');
    manager.setField(key, 'label', 'Zeroth start');
    manager.setField(key, 'group', 'Shop');
    manager.setField(key, 'toolbar', true);
    manager.setBody(key, '{{N}}G54 G90');
    expect(await manager.save()).toEqual({ ok: true });

    // The file the manager wrote is in the folder, and the load read it back.
    expect(r.folder.has('fanuc.json')).toBe(true);
    const listed = r.service.list(r.id);
    const mine = listed.find((d) => d.id === 'my-start');
    expect(mine).toMatchObject({ label: 'Zeroth start', group: 'Shop' });

    // The Insert tab: its own group, the button in it.
    const group = templateGroups(listed, []).find((g) => g.key === 'Shop');
    expect(group?.buttons.map((d) => d.id)).toEqual(['my-start']);

    // The palette's quick pick.
    expect(pickItems(r.service, r.id).map((item) => item.value)).toContain('my-start');

    // Completion on an empty line.
    const cp = machines.effective(r.id).cp;
    const db = machines.effective(r.id).codes;
    const result = completionsAt('Zeroth', 6, cp, db, { t, templates: { list: listed, snippetText: () => null } });
    expect(result?.items.map((item) => item.label)).toContain('Zeroth start');
  });

  it('is the same star in the manager and on the Insert tab', async () => {
    const r = rig();
    const manager = createTemplateManager(r.deps);
    await manager.load('fanuc', { machineType: 'mill' });
    const first = get(manager.state).rows[0];
    manager.setFavorite(first.key, true);

    const dialect = r.service.dialectOf(r.id)!;
    expect(dialect).toBe('fanuc');
    expect(r.service.favorites(dialect)).toEqual([first.def!.id]);
    // The Insert tab lists it first, in the favourites group, as a button.
    const groups = templateGroups(r.service.list(r.id), r.service.favorites(dialect));
    expect(groups[0]).toMatchObject({ favorites: true });
    expect(groups[0].buttons.map((d) => d.id)).toEqual([first.def!.id]);

    // And a star set from the service (the Insert tab) shows in the manager when it is opened again.
    r.service.setFavorite(dialect, 'program-end', true);
    const again = createTemplateManager(r.deps);
    await again.load('fanuc', { machineType: 'mill' });
    expect(get(again.state).favorites).toEqual([first.def!.id, 'program-end']);
  });
});
