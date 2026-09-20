// `initialValues` (plan §7.5, WP2.2): defaults, remembered values and the rules that keep
// a stale `ui.lastParams` entry from opening a form that is already wrong.

import { describe, expect, it } from 'vitest';
import { initialValues } from './values';
import { validateFields } from './validate';
import { DEFAULTS, SETTING_FIELDS } from '$lib/core/settings/schema';
import type { FieldSpec } from './types';

const fields: FieldSpec[] = [
  { id: 'name', type: 'text', label: 'Name', default: 'part' },
  { id: 'feed', type: 'number', label: 'Feed', default: 100 },
  { id: 'step', type: 'integer', label: 'Step', default: 10 },
  { id: 'flag', type: 'bool', label: 'Flag', default: true },
  {
    id: 'mode',
    type: 'choice',
    label: 'Mode',
    default: 'a',
    choices: [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ],
  },
  {
    id: 'keep',
    type: 'address-list',
    label: 'Keep',
    default: ['X'],
    choices: [
      { label: 'X', value: 'X' },
      { label: 'Y', value: 'Y' },
    ],
  },
];

describe('without remembered values', () => {
  it('uses the defaults, one entry per field', () => {
    expect(initialValues(fields)).toEqual({
      name: 'part',
      feed: 100,
      step: 10,
      flag: true,
      mode: 'a',
      keep: ['X'],
    });
  });

  it('falls back to an empty value of the right kind when a field has no default', () => {
    const bare: FieldSpec[] = [
      { id: 'text', type: 'text', label: 'T' },
      { id: 'file', type: 'file', label: 'F' },
      { id: 'folder', type: 'folder', label: 'D' },
      { id: 'bool', type: 'bool', label: 'B' },
      { id: 'list', type: 'address-list', label: 'L' },
      { id: 'number', type: 'number', label: 'N' },
      { id: 'choice', type: 'choice', label: 'C', choices: [{ label: 'A', value: 'a' }] },
    ];
    const values = initialValues(bare);
    expect(values).toEqual({
      text: '',
      file: '',
      folder: '',
      bool: false,
      list: [],
      number: undefined,
      choice: undefined,
    });
    // Every field is present, even the ones whose starting value is "nothing yet".
    expect(Object.keys(values)).toHaveLength(bare.length);
  });

  it('never picks an option the user did not choose', () => {
    const c: FieldSpec = {
      id: 'c',
      type: 'choice',
      label: 'C',
      required: true,
      choices: [{ label: 'A', value: 'a' }],
    };
    expect(initialValues([c]).c).toBeUndefined();
    expect(validateFields([c], initialValues([c])).c?.key).toBe('forms.errors.required');
  });
});

describe('with remembered values', () => {
  it('prefers a remembered value over the default', () => {
    const values = initialValues(fields, { name: 'shaft', feed: 250, keep: ['Y'] });
    expect(values.name).toBe('shaft');
    expect(values.feed).toBe(250);
    expect(values.keep).toEqual(['Y']);
    expect(values.step).toBe(10);
  });

  it('drops a remembered entry the form no longer has', () => {
    const values = initialValues(fields, { gone: 'stale' });
    expect(values).not.toHaveProperty('gone');
    expect(values.name).toBe('part');
  });

  it('falls back when the remembered value no longer suits the field', () => {
    const values = initialValues(fields, {
      name: 7,
      feed: 'fast',
      step: 1.5,
      flag: 'yes',
      mode: 'c',
      keep: ['Z'],
    });
    expect(values).toEqual({
      name: 'part',
      feed: 100,
      step: 10,
      flag: true,
      mode: 'a',
      keep: ['X'],
    });
  });

  it('treats null and undefined as nothing remembered', () => {
    expect(initialValues(fields, { name: null, feed: undefined }).name).toBe('part');
    expect(initialValues(fields, { name: null, feed: undefined }).feed).toBe(100);
  });

  it('accepts a remembered choice while the choices are still empty', () => {
    const open: FieldSpec = { id: 'profile', type: 'choice', label: 'P', choices: [] };
    expect(initialValues([open], { profile: 'fanuc' }).profile).toBe('fanuc');
  });
});

describe('the returned record is the form to edit', () => {
  it('copies arrays, so the default and the remembered set are not shared', () => {
    const remembered = { keep: ['Y'] };
    const values = initialValues(fields, remembered);
    (values.keep as string[]).push('X');
    expect(remembered.keep).toEqual(['Y']);

    const fromDefault = initialValues(fields).keep as string[];
    fromDefault.push('Y');
    expect(initialValues(fields).keep).toEqual(['X']);
  });

  it('survives a frozen default, which is what `SETTINGS.DEFAULTS` hands over', () => {
    const rulers = SETTING_FIELDS.find((f) => f.key === 'editor.rulers');
    if (!rulers) throw new Error('expected an editor.rulers field');
    const spec: FieldSpec = { ...rulers.field, label: 'Rulers' };
    expect(Object.isFrozen(DEFAULTS['editor.rulers'])).toBe(true);
    const value = initialValues([spec])[spec.id];
    expect(value).toEqual(DEFAULTS['editor.rulers']);
    expect(() => (value as number[]).push(80)).not.toThrow();
    expect(DEFAULTS['editor.rulers']).toEqual([]);
  });

  it('starts every settings field at its default, and that form validates', () => {
    const specs = SETTING_FIELDS.map((meta) => ({ ...meta.field, label: meta.key }));
    const values = initialValues(specs);
    for (const meta of SETTING_FIELDS) expect(values[meta.key]).toEqual(DEFAULTS[meta.key]);
    expect(validateFields(specs, values)).toEqual({});
  });
});
