// `$version` handling (plan WP2.6 "Tests": migrate). There is one version in P1, so the
// rules under test are "strip the marker" and "never write a newer file".

import { describe, expect, it } from 'vitest';
import { migrateSettings } from './migrate';
import { SETTINGS_VERSION } from './schema';

describe('migrateSettings', () => {
  it('reads the current version and hands the keys on without it', () => {
    const result = migrateSettings({ $version: 1, 'editor.tabWidth': 2 });
    expect(result.version).toBe(1);
    expect(result.readOnly).toBe(false);
    expect(result.raw).toEqual({ 'editor.tabWidth': 2 });
  });

  it('treats a file without a marker as version 1', () => {
    const result = migrateSettings({ 'editor.tabWidth': 2 });
    expect(result.version).toBe(1);
    expect(result.readOnly).toBe(false);
  });

  it('treats an unusable marker as version 1, so the file is still read and written', () => {
    for (const marker of ['2', 1.5, null, {}, 0, -1]) {
      const result = migrateSettings({ $version: marker, 'editor.tabWidth': 2 });
      expect(result.version, JSON.stringify(marker)).toBe(1);
      expect(result.readOnly, JSON.stringify(marker)).toBe(false);
      expect(result.raw).toEqual({ 'editor.tabWidth': 2 });
    }
  });

  it('reads a newer file but marks it read-only', () => {
    const result = migrateSettings({ $version: SETTINGS_VERSION + 1, 'editor.tabWidth': 2 });
    expect(result.version).toBe(SETTINGS_VERSION + 1);
    expect(result.readOnly).toBe(true);
    expect(result.raw).toEqual({ 'editor.tabWidth': 2 });
  });

  it('does not change the object it was given', () => {
    const file = { $version: 1, 'editor.tabWidth': 2 };
    migrateSettings(file);
    expect(file).toEqual({ $version: 1, 'editor.tabWidth': 2 });
  });

  it('answers with an empty record for an empty file', () => {
    expect(migrateSettings({})).toEqual({ raw: {}, version: 1, readOnly: false });
  });
});
