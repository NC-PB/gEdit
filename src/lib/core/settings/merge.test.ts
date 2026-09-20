// The tolerant read and the strict write of `settings.json` (plan WP2.6 "Tests": merge,
// diff to defaults, unknown keys kept, invalid values dropped).

import { describe, expect, it } from 'vitest';
import { diffFromDefaults, mergeSettings } from './merge';
import { DEFAULTS, type Settings } from './schema';

describe('mergeSettings', () => {
  it('answers with the defaults for an empty file', () => {
    const result = mergeSettings({});
    expect(result.values).toEqual(DEFAULTS);
    expect(result.warnings).toEqual([]);
    expect(result.unknown).toEqual({});
  });

  it('applies every valid value and leaves the rest at the default', () => {
    const result = mergeSettings({ 'editor.tabWidth': 2, 'appearance.theme': 'light' });
    expect(result.values['editor.tabWidth']).toBe(2);
    expect(result.values['appearance.theme']).toBe('light');
    expect(result.values['editor.insertSpaces']).toBe(DEFAULTS['editor.insertSpaces']);
    expect(result.warnings).toEqual([]);
  });

  it('does not change DEFAULTS itself', () => {
    mergeSettings({ 'editor.tabWidth': 2, 'editor.rulers': [80] });
    expect(DEFAULTS['editor.tabWidth']).toBe(4);
    expect(DEFAULTS['editor.rulers']).toEqual([]);
  });

  it('keeps a key it does not know, and does not warn about it', () => {
    const result = mergeSettings({ 'editor.tabWidth': 2, 'future.option': { deep: [1, 2] } });
    expect(result.unknown).toEqual({ 'future.option': { deep: [1, 2] } });
    expect(result.values['editor.tabWidth']).toBe(2);
    expect(result.warnings).toEqual([]);
    expect('future.option' in result.values).toBe(false);
  });

  it('drops a value of the wrong type and warns once', () => {
    const result = mergeSettings({ 'editor.tabWidth': '2' });
    expect(result.values['editor.tabWidth']).toBe(DEFAULTS['editor.tabWidth']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('"editor.tabWidth"');
    expect(result.warnings[0]).toContain('whole number');
  });

  it('drops a number out of range and one that is not whole', () => {
    const tooBig = mergeSettings({ 'appearance.editorFontSize': 99 });
    expect(tooBig.values['appearance.editorFontSize']).toBe(14);
    expect(tooBig.warnings).toHaveLength(1);

    const fraction = mergeSettings({ 'appearance.editorFontSize': 12.5 });
    expect(fraction.values['appearance.editorFontSize']).toBe(14);
    expect(fraction.warnings).toHaveLength(1);

    const edge = mergeSettings({ 'appearance.editorFontSize': 8 });
    expect(edge.values['appearance.editorFontSize']).toBe(8);
    expect(edge.warnings).toEqual([]);
  });

  it('drops a choice that is not offered, and names the ones that are', () => {
    const result = mergeSettings({ 'assist.completion': 'sometimes' });
    expect(result.values['assist.completion']).toBe('auto');
    expect(result.warnings[0]).toContain('auto, manual, off');
  });

  it('takes any non-empty string where the choices are data', () => {
    const result = mergeSettings({ 'files.defaultProfile': 'siemens-840d' });
    expect(result.values['files.defaultProfile']).toBe('siemens-840d');
    expect(result.warnings).toEqual([]);
    expect(mergeSettings({ 'files.defaultProfile': '' }).warnings).toHaveLength(1);
  });

  it('accepts an empty python path, because empty means "find one"', () => {
    const result = mergeSettings({ 'scripts.python': '' });
    expect(result.values['scripts.python']).toBe('');
    expect(result.warnings).toEqual([]);
  });

  it('takes a list whole, or not at all', () => {
    const good = mergeSettings({ 'editor.rulers': [40, 80], 'scripts.folders': ['/a', '/b'] });
    expect(good.values['editor.rulers']).toEqual([40, 80]);
    expect(good.values['scripts.folders']).toEqual(['/a', '/b']);
    expect(good.warnings).toEqual([]);

    const mixed = mergeSettings({ 'editor.rulers': [40, '80'] });
    expect(mixed.values['editor.rulers']).toEqual([]);
    expect(mixed.warnings).toHaveLength(1);

    const notAList = mergeSettings({ 'scripts.folders': '/a' });
    expect(notAList.values['scripts.folders']).toEqual([]);
    expect(notAList.warnings).toHaveLength(1);
  });

  it('copies a list instead of sharing the caller’s array', () => {
    const raw = { 'editor.rulers': [40] };
    const result = mergeSettings(raw);
    raw['editor.rulers'].push(80);
    expect(result.values['editor.rulers']).toEqual([40]);
  });

  it('rejects a boolean written as a string, and keeps a real false', () => {
    expect(mergeSettings({ 'editor.minimap': 'true' }).warnings).toHaveLength(1);
    const off = mergeSettings({ 'editor.lineNumbers': false });
    expect(off.values['editor.lineNumbers']).toBe(false);
    expect(off.warnings).toEqual([]);
  });

  it('warns once per bad value and still applies the good ones', () => {
    const result = mergeSettings({
      'editor.tabWidth': 0,
      'assist.hover': 'yes',
      'editor.wordWrap': true,
    });
    expect(result.warnings).toHaveLength(2);
    expect(result.values['editor.wordWrap']).toBe(true);
    expect(result.values['editor.tabWidth']).toBe(4);
    expect(result.values['assist.hover']).toBe(true);
  });

  it('cuts a long value out of the warning text', () => {
    const result = mergeSettings({ 'editor.tabWidth': 'x'.repeat(200) });
    expect(result.warnings[0]?.length).toBeLessThan(140);
    expect(result.warnings[0]).toContain('…');
  });
});

describe('diffFromDefaults', () => {
  it('writes nothing when everything is at its default', () => {
    expect(diffFromDefaults({ ...DEFAULTS })).toEqual({});
  });

  it('writes only what differs, with sorted keys', () => {
    const values: Settings = {
      ...DEFAULTS,
      'editor.tabWidth': 2,
      'appearance.theme': 'light',
      'editor.minimap': true,
    };
    const file = diffFromDefaults(values);
    expect(Object.keys(file)).toEqual(['appearance.theme', 'editor.minimap', 'editor.tabWidth']);
    expect(file).toEqual({
      'appearance.theme': 'light',
      'editor.minimap': true,
      'editor.tabWidth': 2,
    });
  });

  it('compares lists by value, not by identity', () => {
    const same: Settings = { ...DEFAULTS, 'editor.rulers': [] };
    expect(diffFromDefaults(same)).toEqual({});
    const changed: Settings = { ...DEFAULTS, 'editor.rulers': [80] };
    expect(diffFromDefaults(changed)).toEqual({ 'editor.rulers': [80] });
  });

  it('writes the unknown keys back, sorted in among the known ones', () => {
    const values: Settings = { ...DEFAULTS, 'editor.tabWidth': 2 };
    const file = diffFromDefaults(values, { 'future.option': 1, 'aaa.first': true });
    expect(Object.keys(file)).toEqual(['aaa.first', 'editor.tabWidth', 'future.option']);
  });

  it('never lets an unknown entry shadow a real key or $version', () => {
    const values: Settings = { ...DEFAULTS, 'editor.tabWidth': 2 };
    const file = diffFromDefaults(values, { 'editor.tabWidth': 99, $version: 7 });
    expect(file['editor.tabWidth']).toBe(2);
    expect('$version' in file).toBe(false);
  });

  it('keeps a __proto__ member through a round trip, like any other unknown key', () => {
    // G8 M2: `unknown[key] = value` handed this one to `Object.prototype`'s setter, so it
    // was never stored and the first save by an older build dropped it (AD-8).
    // Built with JSON.parse, which is how the file really arrives (Rust → IPC → parse):
    // an object *literal* with a `__proto__` key would set the prototype instead.
    const raw = JSON.parse('{"__proto__":{"poisoned":true},"editor.tabWidth":2}') as Record<
      string,
      unknown
    >;
    const merged = mergeSettings(raw);

    expect(Object.prototype.hasOwnProperty.call(merged.unknown, '__proto__')).toBe(true);
    expect(merged.warnings).toEqual([]);
    const file = diffFromDefaults(merged.values, merged.unknown);
    expect(Object.prototype.hasOwnProperty.call(file, '__proto__')).toBe(true);
    // Compared as text: an expected object *literal* could not carry the key either.
    expect(JSON.stringify(file)).toBe('{"__proto__":{"poisoned":true},"editor.tabWidth":2}');
    // Nothing was poisoned on the way: this is a plain own property, not a prototype.
    expect(Object.getPrototypeOf(merged.unknown)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).poisoned).toBeUndefined();
  });

  it('round-trips a file: merge, diff, merge again', () => {
    const raw = { 'editor.tabWidth': 2, 'editor.rulers': [80], 'future.option': 'keep me' };
    const first = mergeSettings(raw);
    const file = diffFromDefaults(first.values, first.unknown);
    expect(file).toEqual(raw);
    const second = mergeSettings(file);
    expect(second.values).toEqual(first.values);
    expect(second.unknown).toEqual(first.unknown);
    expect(second.warnings).toEqual([]);
  });
});
