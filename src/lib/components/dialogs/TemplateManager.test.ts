// The template manager dialog (Phase 3 plan §5 P3.9, §6.8). Owner: P3.9.
//
// Rendered with `svelte/server` (no DOM), over the real model with fake files: what the markup
// carries is what the runtime harness addresses (the test ids and data attributes of §6.8), and what
// a user reads (origin, review mark, problems, locked fields). Clicks and typing are the harness's
// (`p3-template-manager`); the model behind every button is covered in `app/templateManager.test.ts`.

import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { TEMPLATE_TEST_IDS, templateFromSelection, type TemplateDef } from '$lib/core/templates';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { createTemplateManager, type TemplateManager } from '$lib/app/templateManager';
import TemplateManagerDialog from './TemplateManager.svelte';
import TemplateParamEditor from './TemplateParamEditor.svelte';

const BASE: TemplateDef[] = [
  { id: 'program-start', label: 'Program start', group: 'Program', body: '%\nO{{n}}', params: [{ id: 'n', label: 'Number', type: 'integer', required: true, default: 1000 }], review: 'pending' },
  { id: 'tool-start', label: 'Tool start', group: 'Tool change', body: 'T{{t}} M6', params: [{ id: 't', label: 'Tool', type: 'integer', required: true, default: 1 }] },
];

async function model(file?: unknown, o: { starred?: string[] } = {}): Promise<TemplateManager> {
  const files = new Map<string, string>(file === undefined ? [] : [['fanuc-lathe.json', JSON.stringify(file)]]);
  const m = createTemplateManager({
    dialects: () => ['fanuc', 'fanuc-lathe', 'my-lathe'],
    baseTemplates: () => structuredClone(BASE),
    variants: () => [{ dialect: 'fanuc-lathe-b', label: 'G-code system B', ids: ['tool-start'] }],
    userFiles: {
      list: async () => [...files].map(([name, text]) => ({ name, text, error: null })),
      path: async (name) => `/cfg/codes/${name}`,
      create: async (name, text) => {
        files.set(name, text);
        return name;
      },
    },
    reloadUserFiles: async () => {},
    docs: { find: () => undefined, open: async () => null, text: () => '', replace: () => {}, refusal: () => null, markClean: () => {}, save: async () => false, activeId: () => null, activate: () => {} },
    confirm: async () => true,
    favorites: { get: () => o.starred ?? [], set: () => {} },
    env: () => ({ cp: cpOf('fanuc-lathe'), prevBlockNumber: null, numbered: false, sys: { date: 'd', time: 't', file: 'f.nc', stem: 'f' } }),
  });
  await m.load('fanuc-lathe', { machineType: 'lathe' });
  return m;
}

function html(m: TemplateManager): string {
  return render(TemplateManagerDialog, { props: { model: m, close: () => {} } }).body;
}

/** The opening tags with this test id, as text. */
function tags(markup: string, testId: string): string[] {
  return markup.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, 'g')) ?? [];
}

const attr = (tag: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

describe('the frame', () => {
  it('is a modal the harness finds by name, with the database and the file on its root', async () => {
    const markup = html(await model());
    expect(markup).toContain('data-modal="template-manager"');
    const [root] = tags(markup, TEMPLATE_TEST_IDS.manager);
    expect(attr(root, 'data-dialect')).toBe('fanuc-lathe');
    expect(attr(root, 'data-file')).toBe('');
    expect(attr(root, 'data-dirty')).toBe('false');
    // No confirm button: Enter in a field must never save. Save is its own button.
    expect(markup).not.toContain('data-testid="modal-ok"');
    expect(markup).toContain('data-testid="modal-cancel"');
    expect(markup).toContain('will be kept in fanuc-lathe.json, a new file');
  });

  it('names the file once it exists and offers every code set', async () => {
    const markup = html(await model({ dialect: 'fanuc-lathe', version: 1, templates: [] }));
    expect(attr(tags(markup, TEMPLATE_TEST_IDS.manager)[0], 'data-file')).toBe('fanuc-lathe.json');
    expect(markup).toContain('Your templates are kept in fanuc-lathe.json.');
    for (const id of ['fanuc', 'fanuc-lathe', 'my-lathe']) expect(markup).toContain(`<option value="${id}"`);
  });
});

describe('the list', () => {
  const file = {
    dialect: 'fanuc-lathe',
    version: 1,
    templates: [
      { id: 'mine', label: 'Mine', group: 'Tool change', body: 'M0' },
      { id: 'tool-start', label: 'My tool start', group: 'Tool change', body: 'T{{t}}', params: [{ id: 't', label: 'Tool', type: 'integer' }] },
      { id: 'Bad Id', label: 'Broken', group: 'G', body: 'M0' },
    ],
  };

  it('has a row per template with its origin, group, review mark, favourite and problem count', async () => {
    const markup = html(await model(file, { starred: ['mine'] }));
    const rows = tags(markup, TEMPLATE_TEST_IDS.row).map((tag) => ({
      id: attr(tag, 'data-template-id'),
      origin: attr(tag, 'data-origin'),
      group: attr(tag, 'data-group'),
      review: attr(tag, 'data-review'),
      favorite: attr(tag, 'data-favorite'),
      problems: attr(tag, 'data-problems'),
    }));
    expect(rows).toEqual([
      { id: 'program-start', origin: 'builtin', group: 'Program', review: 'pending', favorite: 'false', problems: '0' },
      // The built-in template yours replaces is not listed twice.
      { id: 'mine', origin: 'user', group: 'Tool change', review: '', favorite: 'true', problems: '0' },
      { id: 'tool-start', origin: 'override', group: 'Tool change', review: '', favorite: 'false', problems: '0' },
      { id: '', origin: 'user', group: '', review: '', favorite: 'false', problems: '1' },
    ]);
    expect(markup).toContain('Review pending');
    expect(markup).toContain('Yours, replaces the built-in');
    expect(markup).toContain('1 problem');
    expect(markup).not.toContain('1 problems');
  });

  it('has the star on every template with a template id', async () => {
    const markup = html(await model(file));
    const stars = tags(markup, TEMPLATE_TEST_IDS.action).filter((tag) => attr(tag, 'data-action') === 'favorite');
    expect(stars.map((tag) => attr(tag, 'data-template-id'))).toEqual(['program-start', 'mine', 'tool-start']);
  });

  it('has the actions, the ones that do not apply disabled', async () => {
    const m = await model(file);
    const state = (markup: string): Record<string, string> =>
      Object.fromEntries(tags(markup, TEMPLATE_TEST_IDS.action).map((tag) => [attr(tag, 'data-action') as string, attr(tag, 'data-disabled') as string]));
    // A built-in template is selected: copy it, but not delete or move it; nothing to save yet.
    const builtin = state(html(m));
    expect(builtin).toMatchObject({ add: 'false', duplicate: 'false', override: 'false', delete: 'true', up: 'true', down: 'true', save: 'true', revert: 'true', 'open-file': 'false' });
    // One of yours: delete and move are open; the first cannot go up.
    const rows = (await m.load('fanuc-lathe'), undefined);
    void rows;
    let s: { rows: { key: string; def: TemplateDef | null }[] } | undefined;
    m.state.subscribe((x) => (s = x))();
    m.select((s?.rows.find((r) => r.def?.id === 'mine') as { key: string }).key);
    m.setField((s?.rows.find((r) => r.def?.id === 'mine') as { key: string }).key, 'label', 'Mine 2');
    const mine = state(html(m));
    expect(mine).toMatchObject({ delete: 'false', up: 'true', down: 'false', save: 'false', revert: 'false' });
    expect(mine.override).toBeUndefined();
    expect(attr(tags(html(m), TEMPLATE_TEST_IDS.manager)[0], 'data-dirty')).toBe('true');
  });
});

describe('the editor', () => {
  it('shows a built-in template locked, with the review mark and the variant that has its own version', async () => {
    const m = await model();
    let s: { rows: { key: string; def: TemplateDef | null }[] } | undefined;
    m.state.subscribe((x) => (s = x))();
    m.select((s?.rows.find((r) => r.def?.id === 'tool-start') as { key: string }).key);
    const markup = html(m);
    const [editor] = tags(markup, 'template-editor');
    expect(attr(editor, 'data-template-id')).toBe('tool-start');
    expect(attr(editor, 'data-origin')).toBe('builtin');
    expect(attr(editor, 'data-locked')).toBe('true');
    expect(markup).toContain('G-code system B documents use their own version of this template (fanuc-lathe-b).');
    expect(tags(markup, 'template-note').map((tag) => attr(tag, 'data-kind'))).toEqual(['builtin', 'variant']);
    // The text is read-only and no placeholder buttons are offered.
    expect(tags(markup, TEMPLATE_TEST_IDS.body)[0]).toContain('readonly');
    expect(tags(markup, TEMPLATE_TEST_IDS.placeholder)).toEqual([]);
    expect(tags(markup, 'template-field').every((tag) => tag.includes('disabled'))).toBe(true);
    expect(tags(markup, TEMPLATE_TEST_IDS.param).map((tag) => attr(tag, 'data-locked'))).toEqual(['true']);
    // The preview is the engine's text with the starting value.
    expect(markup).toMatch(/data-testid="template-preview"[^>]*>T1 M6<\/pre>/);
  });

  it('shows the review note of a built-in template that has not been reviewed', async () => {
    const markup = html(await model());
    expect(tags(markup, 'template-note').map((tag) => attr(tag, 'data-kind'))).toEqual(['builtin', 'review']);
    expect(markup).toContain('has not been checked against the manuals and a machine yet');
  });

  it('offers a template of yours for editing: placeholders for the block number, the system values and each parameter', async () => {
    const m = await model();
    m.add();
    const key = (() => {
      let k = '';
      m.state.subscribe((x) => (k = x.selected as string))();
      return k;
    })();
    m.setBody(key, '{{N}}T{{t}}');
    m.addParam(key);
    m.setParam(key, 0, 'id', 't');
    m.setParamType(key, 0, 'integer');
    m.setParam(key, 0, 'default', '2');
    const markup = html(m);
    const [editor] = tags(markup, 'template-editor');
    expect(attr(editor, 'data-origin')).toBe('user');
    expect(attr(editor, 'data-locked')).toBe('false');
    expect(tags(markup, TEMPLATE_TEST_IDS.placeholder).map((tag) => attr(tag, 'data-placeholder'))).toEqual(['N', 'sys.date', 'sys.time', 'sys.file', 'sys.stem', 't']);
    const [param] = tags(markup, TEMPLATE_TEST_IDS.param);
    expect(attr(param, 'data-param-id')).toBe('t');
    expect(attr(param, 'data-type')).toBe('integer');
    expect(tags(markup, 'template-field').some((tag) => tag.includes('disabled'))).toBe(false);
    expect(markup).toMatch(/data-testid="template-preview"[^>]*>T2<\/pre>/);
    expect(attr(tags(markup, TEMPLATE_TEST_IDS.manager)[0], 'data-dirty')).toBe('true');
  });

  it('CODE-14: two parameters with one id (reachable while an id is typed) render, one placeholder button each', async () => {
    const m = await model();
    m.add();
    let key = '';
    m.state.subscribe((x) => (key = x.selected as string))();
    m.addParam(key);
    m.addParam(key);
    m.setParam(key, 0, 'id', 'x');
    m.setParam(key, 1, 'id', 'x');
    const markup = html(m);
    expect(tags(markup, TEMPLATE_TEST_IDS.placeholder).map((tag) => attr(tag, 'data-placeholder'))).toEqual(['N', 'sys.date', 'sys.time', 'sys.file', 'sys.stem', 'x', 'x']);
  });

  it('CODE-14: the placeholder buttons are keyed by place, not by name (a repeated name is a duplicate key in the running dialog)', () => {
    // The key check runs in the client build only, so the markup test above cannot fail on it; the source can.
    const source = readFileSync(new URL('./TemplateManager.svelte', import.meta.url), 'utf8');
    expect(source).toMatch(/\{#each placeholderNames as name, i \(i\)\}/);
    expect(source).not.toMatch(/\{#each placeholderNames as name \(name\)\}/);
  });

  it('lists the problems of a template in plain words, with the place and the path', async () => {
    const m = await model();
    m.add();
    let key = '';
    m.state.subscribe((x) => (key = x.selected as string))();
    m.setBody(key, 'T{{gone}}');
    const markup = html(m);
    expect(markup).toContain('New template › Text: line 1: {{gone}} is no parameter of this template');
    expect(tags(markup, 'template-problem').map((tag) => attr(tag, 'data-path'))).toEqual(['.body']);
    expect(markup).toMatch(/data-testid="template-preview"[^>]*data-error="templateManager.preview.problems"/);
  });

  it('shows what the user wrote as text, never as markup', async () => {
    const m = await model({
      dialect: 'fanuc-lathe',
      version: 1,
      templates: [{ id: 'x', label: '<img src=x onerror=alert(1)>', group: '<b>bold</b>', description: '<script>alert(1)</script>', body: '<i>M0</i>' }],
    });
    let key = '';
    m.state.subscribe((s) => (key = s.rows.find((r) => r.def?.id === 'x')?.key as string))();
    m.select(key);
    const markup = html(m);
    expect(markup).not.toContain('<img src=x');
    expect(markup).not.toContain('<script>alert');
    expect(markup).not.toContain('<b>bold</b>');
    expect(markup).not.toContain('<i>M0</i>');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)');
    expect(markup).toContain('&lt;b>bold&lt;/b>');
  });

  it('shows an entry it cannot read with its problems and the entry as it is', async () => {
    const m = await model({ dialect: 'fanuc-lathe', version: 1, templates: [{ id: 'Bad Id', label: 'Broken', group: 'G', body: 'M0' }] });
    let key = '';
    m.state.subscribe((s) => (key = s.rows.find((r) => r.def === null)?.key as string))();
    m.select(key);
    const markup = html(m);
    expect(markup).toContain('data-testid="template-unreadable"');
    expect(markup).toContain('It stays in the file as it is.');
    expect(tags(markup, 'template-problem').map((tag) => attr(tag, 'data-path'))).toEqual(['[0].id']);
    expect(markup).toContain('"id": "Bad Id"');
  });

  it('shows a file it cannot edit, and the save closed', async () => {
    const m = createTemplateManager({
      dialects: () => ['fanuc-lathe'],
      baseTemplates: () => [],
      variants: () => [],
      userFiles: { list: async () => [{ name: 'fanuc-lathe.json', text: '{ nope', error: null }], path: async () => '', create: async () => '' },
      reloadUserFiles: async () => {},
      docs: { find: () => undefined, open: async () => null, text: () => '', replace: () => {}, refusal: () => null, markClean: () => {}, save: async () => false, activeId: () => null, activate: () => {} },
      confirm: async () => true,
      favorites: { get: () => [], set: () => {} },
      env: () => null,
    });
    await m.load('fanuc-lathe');
    const markup = html(m);
    expect(markup).toContain('data-testid="template-file-error"');
    expect(markup).toContain('is not valid JSON');
    const actions = Object.fromEntries(tags(markup, TEMPLATE_TEST_IDS.action).map((tag) => [attr(tag, 'data-action') as string, tag]));
    expect(actions.add).toContain('disabled');
  });
});

describe('New Template from Selection', () => {
  const db = loadCodeDb(resolveCodeDbFiles(BUILTIN_CODE_DB_JSON)['fanuc']);

  it('shows the text of the selection with its numbers as buttons to tick, the ticked ones marked', async () => {
    const m = await model();
    const draft = templateFromSelection(['N10 G83 X20. Z-5. R3. Q4. F240.', 'N20 G80'], cpOf('fanuc-gcode'), db);
    m.startDraft(draft, {});
    const z = draft.candidates.find((c) => c.address === 'Z');
    m.toggleCandidate(z?.key as string);
    const markup = html(m);
    expect(markup).toContain('data-testid="template-draft"');
    const candidates = tags(markup, TEMPLATE_TEST_IDS.candidate).map((tag) => ({ address: attr(tag, 'data-address'), line: attr(tag, 'data-line'), checked: attr(tag, 'data-checked') }));
    expect(candidates).toEqual(draft.candidates.map((c) => ({ address: c.address, line: String(c.line), checked: String(c === z) })));
    expect(markup).toMatch(/data-testid="template-draft-result"[^>]*>\{\{N\}\}G83 X20\. \{\{z\}\} R3\. Q4\. F240\.\n\{\{N\}\}G80<\/pre>/);
    // P3b fix H, finding 3: one number is "1 number", one value is "1 value".
    expect(markup).toContain('1 number selected, 1 value in the template');
    expect(markup).not.toContain('1 numbers');
    expect(markup).not.toContain('1 values');
    // The database cannot change under a draft; the other actions of the list stay out of the way.
    expect(tags(markup, 'template-database')[0]).toContain('disabled');
    const actions = tags(markup, TEMPLATE_TEST_IDS.action).map((tag) => attr(tag, 'data-action'));
    expect(actions).toEqual(expect.arrayContaining(['draft-apply', 'draft-cancel', 'draft-all', 'draft-none']));
    expect(tags(markup, 'template-draft-field').map((tag) => attr(tag, 'data-field'))).toEqual(['label', 'id', 'group']);
  });

  it('counts the ticked numbers and the values they make in the singular and the plural form of each', async () => {
    const m = await model();
    const draft = templateFromSelection(['N10 G83 X20. Z-5. R3. Q4. F240.', 'N20 G80'], cpOf('fanuc-gcode'), db);
    m.startDraft(draft, {});
    const count = (): string => /data-testid="template-draft-count"[^>]*>([^<]*)</.exec(html(m))?.[1] ?? '';
    expect(count()).toBe('0 numbers selected, 0 values in the template');
    m.toggleCandidate(draft.candidates.find((c) => c.address === 'Z')?.key as string);
    expect(count()).toBe('1 number selected, 1 value in the template');
    m.toggleCandidate(draft.candidates.find((c) => c.address === 'R')?.key as string);
    expect(count()).toBe('2 numbers selected, 2 values in the template');
  });

  it('says so when no number can become a value, and shows a refusal of the name', async () => {
    const m = await model();
    m.startDraft(templateFromSelection(['G80', 'M30'], cpOf('fanuc-gcode'), db), {});
    expect(m.applyDraft()).toBe(false);
    const markup = html(m);
    expect(markup).toContain('No numbers in the selection can become values');
    expect(attr(tags(markup, 'template-draft-error')[0], 'data-error')).toBe('templateManager.draft.needsName');
    expect(markup).toContain('Give the template a name.');
  });
});

describe('the parameter form', () => {
  const noop = { setParam: () => {}, setParamType: () => {}, setChoice: () => {}, addChoice: () => {}, removeChoice: () => {} } as unknown as TemplateManager;
  const show = (param: Record<string, unknown>, locked = false): string =>
    render(TemplateParamEditor, { props: { model: noop, rowKey: 'u1', index: 0, param: { id: 'z', label: 'Depth', ...param } as never, locked, formulaProblem: null } }).body;
  const fields = (markup: string): string[] => tags(markup, 'template-param-field').map((tag) => attr(tag, 'data-field') as string);

  it('shows the members the loader allows for each kind, and no others', () => {
    expect(fields(show({ type: 'number' }))).toEqual(['label', 'id', 'type', 'help', 'prefix', 'suffix', 'min', 'max', 'default', 'decimals', 'required', 'plusSign', 'remember']);
    expect(fields(show({ type: 'integer' }))).toEqual(['label', 'id', 'type', 'help', 'prefix', 'suffix', 'min', 'max', 'default', 'digits', 'required', 'plusSign', 'remember']);
    expect(fields(show({ type: 'text' }))).toEqual(['label', 'id', 'type', 'help', 'prefix', 'suffix', 'default', 'required', 'uppercase', 'comment', 'remember']);
    expect(fields(show({ type: 'choice', choices: [{ label: 'One', value: '1' }] }))).toEqual(['label', 'id', 'type', 'help', 'prefix', 'suffix', 'default', 'required', 'remember']);
    expect(fields(show({ type: 'formula', formula: 'a*2' }))).toEqual(['label', 'id', 'type', 'help', 'prefix', 'suffix', 'decimals', 'digits', 'formula', 'plusSign', 'hidden']);
  });

  it('lists the choices, locked when the template is a built-in one', () => {
    const markup = show({ type: 'choice', choices: [{ label: 'Mist', value: 'M7' }, { label: 'Flood', value: 'M8' }] }, true);
    expect(tags(markup, 'template-choice')).toHaveLength(2);
    expect(markup).toContain('value="M8"');
    expect(markup).not.toContain('data-action="add-choice"');
    expect(tags(markup, 'template-param-field').every((tag) => tag.includes('disabled'))).toBe(true);
  });

  it('shows the check of a formula under it', () => {
    const markup = render(TemplateParamEditor, {
      props: { model: noop, rowKey: 'u1', index: 0, param: { id: 'f', label: 'Feed', type: 'formula', formula: 'x*' } as never, locked: false, formulaProblem: 'the formula ends too early' },
    }).body;
    expect(markup).toContain('data-testid="template-formula-problem"');
    expect(markup).toContain('the formula ends too early');
  });
});
