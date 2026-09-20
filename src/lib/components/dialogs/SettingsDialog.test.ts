// The settings dialog (plan §5 WP2.7). The parts worth a unit test are pure and live in
// the component's module script: which pages exist, how a `SettingFieldMeta` becomes a
// translated `FieldSpec`, and what Save sends.
//
// The test the plan asks for is `i18n`: every label, help and choice key of
// `SETTING_FIELDS` has a message in the `settings` namespace. The table is static and its
// keys are built rather than written, so `i18n/keys.test.ts` cannot see them and this is
// the only thing standing between a new setting and a raw key on screen.
//
// The markup is rendered with `svelte/server`, which needs no DOM. Clicking a page,
// editing a value and saving are the M2 runtime scenarios' job.

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import SettingsDialog, {
  CATEGORY_ORDER,
  LIST_KEYS,
  changedValues,
  defaultValues,
  isListKey,
  pagesOf,
  sameValue,
  snapshotValues,
  specOf,
  type SpecDeps,
} from './SettingsDialog.svelte';
import { validateFields } from '$lib/core/forms/validate';
import {
  DEFAULTS,
  SETTING_FIELDS,
  type SettingFieldMeta,
  type Settings,
} from '$lib/core/settings/schema';
import { hasKey, t } from '$lib/i18n';
import type { FieldChoice } from '$lib/core/forms/types';

/** The two profiles M1 knows; M3 replaces the registry, not the shape. */
const PROFILE_CHOICES: FieldChoice[] = [
  { label: 'Fanuc', value: 'fanuc-gcode' },
  { label: 'Heidenhain', value: 'heidenhain-klartext' },
];

const deps: SpecDeps = {
  translate: t,
  hasKey,
  choicesFor: (key) => (key === 'files.defaultProfile' ? PROFILE_CHOICES : undefined),
};

/** A `deps` that reports every key as missing, so the fallbacks are visible. */
const noMessages: SpecDeps = { translate: (key) => key, hasKey: () => false };

function meta(over: Partial<SettingFieldMeta> = {}): SettingFieldMeta {
  return {
    key: 'editor.tabWidth',
    category: 'editor',
    field: { id: 'editor.tabWidth', type: 'integer', default: 4, min: 1, max: 16 },
    labelKey: 'settings.editor.tabWidth.label',
    helpKey: 'settings.editor.tabWidth.help',
    dialog: true,
    ...over,
  };
}

describe('i18n of SETTING_FIELDS', () => {
  it('every label key has a message in the settings namespace', () => {
    const missing = SETTING_FIELDS.filter((m) => !hasKey(m.labelKey)).map((m) => m.labelKey);
    expect(missing).toEqual([]);
  });

  it('every help key has a message', () => {
    const missing = SETTING_FIELDS.flatMap((m) =>
      m.helpKey !== undefined && !hasKey(m.helpKey) ? [m.helpKey] : [],
    );
    expect(missing).toEqual([]);
  });

  it('every choice label has a message', () => {
    const missing = SETTING_FIELDS.flatMap((m) =>
      (m.field.choices ?? []).map((c) => c.label).filter((label) => !hasKey(label)),
    );
    expect(missing).toEqual([]);
  });

  it('the keys really are the ones the schema builds, not a copy of this list', () => {
    expect(SETTING_FIELDS.length).toBeGreaterThan(20);
    for (const m of SETTING_FIELDS) {
      expect(m.labelKey).toBe(`settings.${m.key}.label`);
      expect(m.field.id).toBe(m.key);
    }
  });

  it('no label resolves to the key itself', () => {
    const raw = SETTING_FIELDS.map((m) => specOf(m, deps).label).filter((label) =>
      label.startsWith('settings.'),
    );
    expect(raw).toEqual([]);
  });

  it('the five page headings have messages', () => {
    for (const category of CATEGORY_ORDER) expect(hasKey(`settings.categories.${category}`)).toBe(true);
  });
});

describe('pagesOf', () => {
  const pages = pagesOf();

  it('has one page per category, in the order of §7.7', () => {
    expect(pages.map((p) => p.category)).toEqual([...CATEGORY_ORDER]);
  });

  it('shows every field marked dialog and no other', () => {
    const shown = pages.flatMap((p) => p.metas.map((m) => m.key));
    expect(shown).toEqual(SETTING_FIELDS.filter((m) => m.dialog).map((m) => m.key));
    expect(shown).not.toContain('editor.rulers');
  });

  it('keeps the table order inside a page', () => {
    const editor = pages.find((p) => p.category === 'editor');
    expect(editor?.metas.slice(0, 2).map((m) => m.key)).toEqual([
      'editor.tabWidth',
      'editor.insertSpaces',
    ]);
  });

  it('leaves out a category that has nothing to show', () => {
    expect(pagesOf([meta({ dialog: false })])).toEqual([]);
    expect(pagesOf([meta()]).map((p) => p.category)).toEqual(['editor']);
  });
});

describe('specOf', () => {
  it('resolves the label and the help text through t()', () => {
    const spec = specOf(meta(), deps);
    expect(spec.label).toBe(t('settings.editor.tabWidth.label'));
    expect(spec.help).toBe(t('settings.editor.tabWidth.help'));
    expect(spec.label).not.toContain('settings.');
  });

  it('keeps the id, the type and the constraints of the schema row', () => {
    expect(specOf(meta(), deps)).toMatchObject({
      id: 'editor.tabWidth',
      type: 'integer',
      default: 4,
      min: 1,
      max: 16,
    });
  });

  it('translates the choice labels but not their values', () => {
    const spec = specOf(
      SETTING_FIELDS.find((m) => m.key === 'appearance.theme') as SettingFieldMeta,
      deps,
    );
    expect(spec.choices?.map((c) => c.value)).toEqual(['system', 'light', 'dark']);
    expect(spec.choices?.map((c) => c.label)).toEqual(['System', 'Light', 'Dark']);
  });

  it('takes the choices of a data-driven field from the caller', () => {
    const spec = specOf(
      SETTING_FIELDS.find((m) => m.key === 'files.defaultProfile') as SettingFieldMeta,
      deps,
    );
    expect(spec.choices).toEqual(PROFILE_CHOICES);
    expect(spec.default).toBe(DEFAULTS['files.defaultProfile']);
  });

  it('gives a choice field an empty list rather than none when nothing supplies one', () => {
    const bare = specOf(
      SETTING_FIELDS.find((m) => m.key === 'files.defaultProfile') as SettingFieldMeta,
      { translate: t, hasKey },
    );
    expect(bare.choices).toEqual([]);
  });

  it('falls back to the key and drops the help text when a message is missing', () => {
    const spec = specOf(meta(), noMessages);
    expect(spec.label).toBe('editor.tabWidth');
    expect(spec.help).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(spec, 'help')).toBe(false);
  });

  it('leaves the schema row alone', () => {
    const row = meta();
    const before = JSON.stringify(row);
    specOf(row, deps);
    expect(JSON.stringify(row)).toBe(before);
  });
});

describe('the fields the dialog renders', () => {
  /** What the component builds: every dialog field except the list-valued ones. */
  const specs = pagesOf()
    .flatMap((p) => p.metas)
    .filter((m) => !isListKey(m.key))
    .map((m) => specOf(m, deps));

  it('accepts the shipped defaults without a single error', () => {
    expect(validateFields(specs, snapshotValues(DEFAULTS))).toEqual({});
  });

  it('keeps scripts.folders out, because a list would fail a folder field', () => {
    expect(LIST_KEYS).toEqual(['scripts.folders']);
    expect(specs.map((s) => s.id)).not.toContain('scripts.folders');
    const folder = specOf(
      SETTING_FIELDS.find((m) => m.key === 'scripts.folders') as SettingFieldMeta,
      deps,
    );
    expect(validateFields([folder], { 'scripts.folders': ['/tmp/a'] })).toEqual({
      'scripts.folders': { key: 'forms.errors.invalid' },
    });
  });

  it('reports a value outside its bounds instead of correcting it', () => {
    const values = { ...snapshotValues(DEFAULTS), 'editor.tabWidth': 99 };
    expect(validateFields(specs, values)['editor.tabWidth']).toEqual({
      key: 'forms.errors.range',
      params: { min: 1, max: 16 },
    });
  });

  it('rejects a profile id the registry does not offer', () => {
    const values = { ...snapshotValues(DEFAULTS), 'files.defaultProfile': 'nonesuch' };
    expect(validateFields(specs, values)['files.defaultProfile']).toEqual({
      key: 'forms.errors.notInChoices',
    });
  });
});

describe('snapshotValues', () => {
  it('has one entry per dialog field and none for the others', () => {
    const values = snapshotValues(DEFAULTS);
    expect(Object.keys(values)).toEqual(SETTING_FIELDS.filter((m) => m.dialog).map((m) => m.key));
    expect(values['editor.tabWidth']).toBe(4);
  });

  it('copies a list, so the frozen defaults cannot be edited through the form', () => {
    const values = snapshotValues(DEFAULTS);
    const folders = values['scripts.folders'] as string[];
    expect(folders).toEqual([]);
    expect(folders).not.toBe(DEFAULTS['scripts.folders']);
    expect(() => folders.push('/tmp/x')).not.toThrow();
    expect(DEFAULTS['scripts.folders']).toEqual([]);
  });

  it('takes the effective values, not the defaults', () => {
    const effective: Settings = { ...DEFAULTS, 'editor.tabWidth': 2, 'scripts.folders': ['/a'] };
    const values = snapshotValues(effective);
    expect(values['editor.tabWidth']).toBe(2);
    expect(values['scripts.folders']).toEqual(['/a']);
    expect(values['scripts.folders']).not.toBe(effective['scripts.folders']);
  });
});

describe('sameValue', () => {
  it('compares lists entry by entry', () => {
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameValue(['a'], ['a', 'b'])).toBe(false);
    expect(sameValue(['a'], 'a')).toBe(false);
    expect(sameValue([], [])).toBe(true);
  });

  it('compares everything else by identity', () => {
    expect(sameValue(4, 4)).toBe(true);
    expect(sameValue(4, '4')).toBe(false);
    expect(sameValue(undefined, undefined)).toBe(true);
  });
});

describe('changedValues', () => {
  it('is empty while nothing was touched', () => {
    expect(changedValues(snapshotValues(DEFAULTS), DEFAULTS)).toEqual({});
  });

  it('holds only what the user changed', () => {
    const values = { ...snapshotValues(DEFAULTS), 'editor.tabWidth': 2 };
    expect(changedValues(values, DEFAULTS)).toEqual({ 'editor.tabWidth': 2 });
  });

  it('notices a changed list and ignores one that only looks new', () => {
    const effective: Settings = { ...DEFAULTS, 'scripts.folders': ['/a'] };
    expect(changedValues({ 'scripts.folders': ['/a'] }, effective)).toEqual({});
    expect(changedValues({ 'scripts.folders': ['/a', '/b'] }, effective)).toEqual({
      'scripts.folders': ['/a', '/b'],
    });
    expect(changedValues({ 'scripts.folders': [] }, effective)).toEqual({ 'scripts.folders': [] });
  });

  it('is a patch against the effective values, not against the defaults', () => {
    const effective: Settings = { ...DEFAULTS, 'editor.tabWidth': 2 };
    expect(changedValues({ 'editor.tabWidth': 2 }, effective)).toEqual({});
    expect(changedValues({ 'editor.tabWidth': 4 }, effective)).toEqual({ 'editor.tabWidth': 4 });
  });

  it('never carries a key the dialog does not render', () => {
    const values = { ...snapshotValues(DEFAULTS), 'editor.rulers': [80], 'not.a.setting': 1 };
    expect(changedValues(values, DEFAULTS)).toEqual({});
  });
});

describe('defaultValues', () => {
  it('answers with the defaults of the given rows, as copies', () => {
    const scripts = SETTING_FIELDS.filter((m) => m.category === 'scripts');
    const values = defaultValues(scripts);
    expect(values['scripts.timeoutSeconds']).toBe(60);
    expect(values['scripts.folders']).toEqual([]);
    expect(values['scripts.folders']).not.toBe(DEFAULTS['scripts.folders']);
  });
});

describe('SettingsDialog markup', () => {
  const html = render(SettingsDialog, { props: { close: () => {} } }).body;

  it('is a modal the harness finds by name, with Save and Cancel', () => {
    expect(html).toContain('data-modal="settings"');
    expect(html).toContain('data-testid="modal-ok"');
    expect(html).toContain('data-testid="modal-cancel"');
  });

  it('offers the five pages, with the first one selected', () => {
    for (const category of CATEGORY_ORDER) expect(html).toContain(`data-category="${category}"`);
    expect(html).toContain('data-testid="settings-page"');
    expect(html).toMatch(/data-testid="settings-category"[^>]*data-category="appearance"/);
  });

  it('renders the fields of the open page and not those of another', () => {
    expect(html).toContain('data-field="appearance.theme"');
    expect(html).toContain('data-field="appearance.editorFontSize"');
    expect(html).not.toContain('data-field="editor.tabWidth"');
    expect(html).not.toContain('data-field="scripts.folders"');
  });

  it('has the two footer actions', () => {
    expect(html).toContain('data-testid="settings-reset"');
    expect(html).toContain('data-testid="settings-open-file"');
  });

  it('says nothing about a broken or read-only file when there is none', () => {
    expect(html).not.toContain('data-testid="settings-notice"');
    expect(html).not.toContain('data-testid="settings-readonly"');
  });
});
