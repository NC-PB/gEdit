// Every modal golden, unchanged, against the TypeScript interpreter (Phase 3 plan P3.1,
// exit criterion X15; Phase 2 plan §7.4).
//
// Each golden runs with its own effective profile, made here the way the app makes it: the
// built-in profile through the registry's gate, the golden's `machine` (a partial
// `MachineParams`) through `effectiveMachine` and `applyMachine`, and no machine at all when it
// names none. The same merge also wrote `tests/fixtures/resolved/effective/**`, which Python
// reads; this test checks that both are one merge result, so the TypeScript reading of a
// golden and the Python one can never differ by their input.
//
// Only the claims a golden lists are compared (`claimDiffers`, the TypeScript twin of
// `test_modal.check`); the per-line comparison with Python is `tests/unit/modalParity.test.ts`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { FIXTURES, RESOLVED, claimDiffers, goldenLines, goldenNames, walkTs } from '../../../../tests/unit/helpers/modalParity';
import type { MachineConfig } from '$lib/core/machines/types';
import type { Profile } from '$lib/core/profiles/types';

const PROFILES = new Map<string, Profile>(
  resolveProfiles(BUILTIN_PROFILE_SOURCES).resolved.map((entry) => {
    const checked = validateProfile(entry.profile);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return [checked.profile.id, checked.profile];
  }),
);

const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

const INDEX = JSON.parse(readFileSync(join(RESOLVED, 'effective', 'index.json'), 'utf8')) as Record<string, string>;

interface Golden {
  input: string;
  machine?: MachineConfig['params'];
  states: { line: number; after: Record<string, unknown> }[];
}

/** The golden's effective profile and database id, merged here (`applyMachine`). */
function effective(name: string, golden: Golden): { profile: Profile; codes: string } {
  const profileId = name.split('/')[1];
  const profile = PROFILES.get(profileId);
  if (!profile) throw new Error(`${name}: no built-in profile "${profileId}"`);
  const machine =
    golden.machine !== undefined
      ? effectiveMachine(profile, { id: 'golden', name: 'golden', profile: profileId, params: golden.machine }, 'document', {})
      : noMachine(profile);
  return applyMachine(profile, machine);
}

const names = goldenNames();

describe('the modal goldens (TypeScript)', () => {
  it('finds all of them', () => {
    expect(names.length).toBeGreaterThanOrEqual(26);
  });

  describe.each(names)('%s', (name) => {
    const golden = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Golden;
    const eff = effective(name, golden);

    it('runs with the effective profile Python reads (one merge result)', () => {
      const file = JSON.parse(readFileSync(join(RESOLVED, INDEX[name]), 'utf8')) as { profile: unknown; codes: string };
      expect(JSON.parse(JSON.stringify(eff.profile))).toEqual(file.profile);
      expect(eff.codes).toBe(file.codes);
    });

    it('reaches every claim', () => {
      const views = walkTs(eff.profile, CODE_DBS[eff.codes], goldenLines(name));
      for (const claim of golden.states) {
        expect(claim.line, 'a claim names a line of the program').toBeLessThanOrEqual(views.length);
        expect(claimDiffers(views[claim.line - 1], claim.after), `line ${claim.line}`).toEqual([]);
      }
    });
  });
});
