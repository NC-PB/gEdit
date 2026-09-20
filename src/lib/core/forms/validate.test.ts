// `validateFields` (plan §7.5, WP2.2): every field type, `required`, `min`/`max`,
// integer and decimals, plus the rule the module exists for — a bad value produces a
// message and is never corrected.

import { describe, expect, it } from 'vitest';
import { decimalPlaces, isEmptyValue, validateFields } from './validate';
import { hasKey } from '$lib/i18n';
import type { FieldSpec } from './types';

/** The message key for one field, or null when it passes. */
function keyFor(field: FieldSpec, value: unknown): string | null {
  return validateFields([field], { [field.id]: value })[field.id]?.key ?? null;
}

const text: FieldSpec = { id: 'name', type: 'text', label: 'Name' };
const bool: FieldSpec = { id: 'flag', type: 'bool', label: 'Flag' };
const file: FieldSpec = { id: 'python', type: 'file', label: 'Python' };
const folder: FieldSpec = { id: 'dir', type: 'folder', label: 'Folder' };
const number: FieldSpec = { id: 'feed', type: 'number', label: 'Feed' };
const integer: FieldSpec = { id: 'size', type: 'integer', label: 'Size' };
const choice: FieldSpec = {
  id: 'theme',
  type: 'choice',
  label: 'Theme',
  choices: [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ],
};
const addresses: FieldSpec = {
  id: 'keep',
  type: 'address-list',
  label: 'Keep',
  choices: [
    { label: 'X', value: 'X' },
    { label: 'Y', value: 'Y' },
  ],
};

describe('validateFields', () => {
  it('reports nothing for a form whose values all fit', () => {
    const values = { name: 'a', flag: false, feed: 12.5, size: 3, theme: 'dark', keep: ['X'] };
    expect(validateFields([text, bool, number, integer, choice, addresses], values)).toEqual({});
  });

  it('keys the messages by field id and leaves the passing fields out', () => {
    const errors = validateFields([text, number], { name: 'a', feed: 'nope' });
    expect(Object.keys(errors)).toEqual(['feed']);
    expect(errors.feed).toEqual({ key: 'forms.errors.notANumber' });
  });

  it('ignores values that belong to no field', () => {
    expect(validateFields([text], { name: 'a', gone: 'stale' })).toEqual({});
  });
});

describe('required', () => {
  it('rejects an empty value only when the field asks for one', () => {
    expect(keyFor(text, '')).toBeNull();
    expect(keyFor({ ...text, required: true }, '')).toBe('forms.errors.required');
    expect(keyFor({ ...text, required: true }, '   ')).toBe('forms.errors.required');
    expect(keyFor({ ...number, required: true }, undefined)).toBe('forms.errors.required');
    expect(keyFor({ ...addresses, required: true }, [])).toBe('forms.errors.required');
  });

  it('treats false and 0 as answers, not as blanks', () => {
    expect(keyFor({ ...bool, required: true }, false)).toBeNull();
    expect(keyFor({ ...number, required: true }, 0)).toBeNull();
  });

  it('lets an empty optional field skip the other checks', () => {
    expect(keyFor({ ...number, min: 10 }, undefined)).toBeNull();
    expect(keyFor({ ...choice }, undefined)).toBeNull();
  });
});

describe('text, file and folder', () => {
  it('accept any string and reject anything else', () => {
    for (const field of [text, file, folder]) {
      expect(keyFor(field, '/nc/a.nc')).toBeNull();
      expect(keyFor(field, 42)).toBe('forms.errors.invalid');
    }
  });
});

describe('bool', () => {
  it('accepts booleans only', () => {
    expect(keyFor(bool, true)).toBeNull();
    expect(keyFor(bool, false)).toBeNull();
    expect(keyFor(bool, 'true')).toBe('forms.errors.invalid');
  });
});

describe('numbers', () => {
  it('accepts a number and numeric text, and names what is not one', () => {
    expect(keyFor(number, 12.5)).toBeNull();
    expect(keyFor(number, '12.5')).toBeNull();
    expect(keyFor(number, ' 12.5 ')).toBeNull();
    expect(keyFor(number, '1e')).toBe('forms.errors.notANumber');
    expect(keyFor(number, '12,5')).toBe('forms.errors.notANumber');
    expect(keyFor(number, Number.NaN)).toBe('forms.errors.notANumber');
    expect(keyFor(number, Number.POSITIVE_INFINITY)).toBe('forms.errors.notANumber');
    expect(keyFor(number, {})).toBe('forms.errors.notANumber');
  });

  it('rejects a fraction in an integer field', () => {
    expect(keyFor(integer, 3)).toBeNull();
    expect(keyFor(integer, '3')).toBeNull();
    expect(keyFor(integer, 3.5)).toBe('forms.errors.notAnInteger');
    expect(keyFor(integer, '3.5')).toBe('forms.errors.notAnInteger');
  });

  it('counts decimals of the value, so a trailing zero is not an error', () => {
    const two: FieldSpec = { ...number, decimals: 2 };
    expect(keyFor(two, 1.25)).toBeNull();
    expect(keyFor(two, '1.500')).toBeNull();
    expect(validateFields([two], { feed: 1.255 }).feed).toEqual({
      key: 'forms.errors.decimals',
      params: { count: 2 },
    });
  });

  it('reads decimals: 0 as "whole numbers only"', () => {
    expect(keyFor({ ...number, decimals: 0 }, 3)).toBeNull();
    expect(keyFor({ ...number, decimals: 0 }, 3.5)).toBe('forms.errors.notAnInteger');
  });

  it('reports min, max and both bounds together', () => {
    expect(validateFields([{ ...number, min: 10 }], { feed: 9 }).feed).toEqual({
      key: 'forms.errors.min',
      params: { min: 10 },
    });
    expect(validateFields([{ ...number, max: 10 }], { feed: 11 }).feed).toEqual({
      key: 'forms.errors.max',
      params: { max: 10 },
    });
    const bounded: FieldSpec = { ...integer, min: 8, max: 32 };
    expect(validateFields([bounded], { size: 40 }).size).toEqual({
      key: 'forms.errors.range',
      params: { min: 8, max: 32 },
    });
    expect(keyFor(bounded, 8)).toBeNull();
    expect(keyFor(bounded, 32)).toBeNull();
    expect(keyFor(bounded, 7)).toBe('forms.errors.range');
  });

  it('never corrects: the failing value is only reported', () => {
    const values = { size: 99 };
    validateFields([{ ...integer, min: 1, max: 16 }], values);
    expect(values).toEqual({ size: 99 });
  });
});

describe('choices', () => {
  it('accepts an offered value and rejects any other', () => {
    expect(keyFor(choice, 'dark')).toBeNull();
    expect(keyFor(choice, 'solarized')).toBe('forms.errors.notInChoices');
  });

  it('accepts anything while the choices are still empty', () => {
    expect(keyFor({ ...choice, choices: [] }, 'fanuc')).toBeNull();
    expect(keyFor({ id: 'p', type: 'choice', label: 'P' }, 'fanuc')).toBeNull();
  });

  it('compares by value, so a non-string choice works too', () => {
    const numeric: FieldSpec = {
      id: 'n',
      type: 'choice',
      label: 'N',
      choices: [{ label: 'Ten', value: 10 }],
    };
    expect(keyFor(numeric, 10)).toBeNull();
    expect(keyFor(numeric, '10')).toBe('forms.errors.notInChoices');
  });
});

describe('address-list', () => {
  it('accepts a subset of the choices', () => {
    expect(keyFor(addresses, ['X'])).toBeNull();
    expect(keyFor(addresses, ['X', 'Y'])).toBeNull();
  });

  it('rejects an entry that is not offered, and a value that is no list', () => {
    expect(keyFor(addresses, ['X', 'Z'])).toBe('forms.errors.notInChoices');
    expect(keyFor(addresses, 'X')).toBe('forms.errors.invalid');
  });
});

describe('the messages', () => {
  // The keys are built by this module and handed to `t()` at render time, so the key scan
  // in i18n/keys.test.ts cannot see them (AD-14 asks their owner to check with hasKey).
  it('every message this module can produce has an English string', () => {
    const produced = new Set<string>();
    const probes: [FieldSpec, unknown][] = [
      [{ ...text, required: true }, ''],
      [text, 42],
      [number, 'x'],
      [integer, 1.5],
      [{ ...number, decimals: 2 }, 1.255],
      [{ ...number, min: 10 }, 1],
      [{ ...number, max: 10 }, 11],
      [{ ...number, min: 1, max: 10 }, 99],
      [choice, 'nope'],
    ];
    for (const [field, value] of probes) {
      const message = validateFields([field], { [field.id]: value })[field.id];
      if (!message) throw new Error(`expected ${field.id} to fail`);
      produced.add(message.key);
    }
    expect(produced.size).toBe(9);
    expect([...produced].filter((key) => !hasKey(key))).toEqual([]);
  });

  it('names every label the form controls use', () => {
    for (const key of [
      'forms.pickFile',
      'forms.pickFolder',
      'forms.browseFor',
      'forms.choosePlaceholder',
      'forms.noChoices',
      'forms.noFields',
      'forms.promptValue',
      'common.browse',
      'common.ok',
      'common.cancel',
    ]) {
      expect(hasKey(key), key).toBe(true);
    }
  });
});

describe('helpers', () => {
  it('isEmptyValue sees blanks, not answers', () => {
    expect(isEmptyValue(text, undefined)).toBe(true);
    expect(isEmptyValue(text, null)).toBe(true);
    expect(isEmptyValue(text, ' ')).toBe(true);
    expect(isEmptyValue(addresses, [])).toBe(true);
    expect(isEmptyValue(bool, false)).toBe(false);
    expect(isEmptyValue(number, 0)).toBe(false);
  });

  it('decimalPlaces reads the value, including exponent form', () => {
    expect(decimalPlaces(3)).toBe(0);
    expect(decimalPlaces(1.5)).toBe(1);
    expect(decimalPlaces(1.505)).toBe(3);
    expect(decimalPlaces(1e-7)).toBe(7);
    expect(decimalPlaces(1.5e21)).toBe(0);
    expect(decimalPlaces(Number.NaN)).toBe(0);
  });
});
