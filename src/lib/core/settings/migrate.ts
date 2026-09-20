// `$version` handling for `settings.json` (plan AD-8). Owner: WP2.6.
//
// There is one version in P1, so there is nothing to migrate yet. The module exists from
// M2 on because the *rule* already applies: a file whose `$version` is higher than
// `SETTINGS_VERSION` is read as far as it can be understood and is never written over,
// so switching back to an older build does not throw away a newer build's settings.
//
// When a key is renamed in a later version, the move belongs in `bringForward` below and
// nowhere else: everything downstream sees the current key names only.

import { SETTINGS_VERSION } from './schema';

/** What the raw file says about itself. */
export interface MigrateResult {
  /** The settings keys, with `$version` removed and any older shape brought forward. */
  raw: Record<string, unknown>;
  /** `$version` as found; 1 when the file has none. */
  version: number;
  /** True when `version` is above `SETTINGS_VERSION`: read only, never written. */
  readOnly: boolean;
}

/**
 * The `$version` the file declares. A missing, fractional or non-numeric marker counts
 * as version 1: a hand-written file that only carries settings keys is the common case,
 * and refusing to write it would be worse than reading it as the current version.
 */
function versionOf(file: Record<string, unknown>): number {
  const raw = file['$version'];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

/** Renames and re-shapes from older versions. Nothing to do at version 1. */
function bringForward(keys: Record<string, unknown>, version: number): Record<string, unknown> {
  void version;
  return keys;
}

/** Reads `$version` and brings an older file's keys forward. */
export function migrateSettings(file: Record<string, unknown>): MigrateResult {
  const version = versionOf(file);
  const keys: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(file)) {
    if (key !== '$version') keys[key] = value;
  }
  return {
    raw: bringForward(keys, version),
    version,
    readOnly: version > SETTINGS_VERSION,
  };
}
