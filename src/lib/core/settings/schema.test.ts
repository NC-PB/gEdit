// The settings table has to stay in step with the `Settings` type: every key is a row,
// every row's `field.id` is its key, and every default is the one in `DEFAULTS`. Nothing
// enforces that at compile time once a key is added, so it is checked here.

import { describe, expect, it } from 'vitest';
import { DEFAULTS, SETTINGS_VERSION, SETTING_FIELDS, type Settings } from './schema';
import { mergeSettings } from './merge';
import { validateFields } from '$lib/core/forms/validate';
import type { FieldSpec } from '$lib/core/forms/types';

const keys = Object.keys(DEFAULTS) as (keyof Settings)[];

describe('settings schema', () => {
  it('writes version 1', () => {
    expect(SETTINGS_VERSION).toBe(1);
  });

  it('has one row per key, and no row without a key', () => {
    expect(SETTING_FIELDS.map((f) => f.key).sort()).toEqual([...keys].sort());
  });

  it("uses the key as the field id and DEFAULTS as the field's default", () => {
    for (const row of SETTING_FIELDS) {
      expect(row.field.id).toBe(row.key);
      expect(row.field.default).toEqual(DEFAULTS[row.key]);
    }
  });

  it('names its label and help keys in the settings namespace', () => {
    for (const row of SETTING_FIELDS) {
      expect(row.labelKey).toBe(`settings.${row.key}.label`);
      expect(row.helpKey).toBe(`settings.${row.key}.help`);
      for (const c of row.field.choices ?? []) {
        expect(c.label.startsWith(`settings.${row.key}.choices.`)).toBe(true);
      }
    }
  });

  it('gives every choice field its options, except the profile list', () => {
    const empty = SETTING_FIELDS.filter(
      (f) => f.field.type === 'choice' && (f.field.choices ?? []).length === 0,
    );
    expect(empty.map((f) => f.key)).toEqual(['files.defaultProfile']);
  });

  it('freezes the defaults, arrays included', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
    expect(Object.isFrozen(DEFAULTS['editor.rulers'])).toBe(true);
    expect(Object.isFrozen(DEFAULTS['scripts.folders'])).toBe(true);
  });

  // G8 M2: `appearance.editorFontFamily` was `{ type: 'text' }` with no `required`, so
  // `validateFields` let an empty value through, Save stayed enabled, and the store then
  // dropped the value one layer down and restored the default. `required` is now the one
  // place that rule lives — `core/settings/merge.ts` reads the same flag.
  it('marks the strings that may not be empty as required', () => {
    const required = SETTING_FIELDS.filter((f) => f.field.required === true).map((f) => f.key);
    expect(required).toEqual(['appearance.editorFontFamily', 'files.defaultProfile']);
  });

  it('blocks the form and the file on the same empty value', () => {
    for (const key of ['appearance.editorFontFamily', 'files.defaultProfile'] as const) {
      const row = SETTING_FIELDS.find((f) => f.key === key);
      const spec = { ...row?.field, label: key } as FieldSpec;

      expect(validateFields([spec], { [key]: '' })).toEqual({
        [key]: { key: 'forms.errors.required' },
      });
      // …and a hand-edited file is refused the same way, with the default kept.
      const merged = mergeSettings({ [key]: '' });
      expect(merged.values[key]).toBe(DEFAULTS[key]);
      expect(merged.warnings).toHaveLength(1);
    }
  });

  it('leaves scripts.python optional, because empty means "find one"', () => {
    const row = SETTING_FIELDS.find((f) => f.key === 'scripts.python');
    expect(row?.field.required).toBeUndefined();
    expect(mergeSettings({ 'scripts.python': '' }).warnings).toEqual([]);
  });

  it('keeps every key out of the dialog only on purpose', () => {
    expect(SETTING_FIELDS.filter((f) => !f.dialog).map((f) => f.key)).toEqual(['editor.rulers']);
  });
});
