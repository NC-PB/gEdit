// The built-in dialect profiles (plan AD-11, AD-16). Written by the M3 prelude (P3);
// owner from Wave A on: WP3.1, and WP6.2 for the content of the files themselves.
//
// The JSON is imported statically, so the profiles are part of the bundle and the app
// starts with them in hand (no fetch, no fs permission). It is deliberately typed
// `unknown`: a profile becomes a `Profile` only after `validateProfile` has seen it, so
// that a built-in and a user profile go through exactly the same gate (WP3.1).
//
// The order is the registry order, which is also the detection tie-break and the order of
// the save-dialog filters. A child is listed next to its parent for readability only —
// `resolveProfiles` resolves parents before children whatever the order (AD-16).
//
// M6: `BUILTIN_PROFILE_JSON` holds the **resolved** built-ins, so every test that iterates
// it sees the lathe profile the way the app uses it, with `fanuc-gcode` merged in.
// `BUILTIN_PROFILE_SOURCES` is the same list unresolved, which is what the registry takes
// (it resolves user profiles alongside them from M12).

import { resolveProfiles } from '$lib/core/profiles/resolve';
import type { ProfileSource } from '$lib/core/profiles/types';
import fanucGcode from './fanuc-gcode.json';
import fanucLathe from './fanuc-lathe.json';
import heidenhainKlartext from './heidenhain-klartext.json';

/** The shipped profiles as they are written, parents unmerged. Resolve before use. */
export const BUILTIN_PROFILE_SOURCES: readonly ProfileSource[] = [
  { raw: fanucGcode, origin: 'builtin' },
  { raw: fanucLathe, origin: 'builtin' },
  { raw: heidenhainKlartext, origin: 'builtin' },
];

/**
 * The shipped profiles, resolved, in registry order. Validate before use.
 *
 * A built-in that cannot be resolved is a build error, not a user's problem: it fails
 * `compile.test.ts`, which is why nothing is reported here.
 */
export const BUILTIN_PROFILE_JSON: readonly unknown[] = resolveProfiles(BUILTIN_PROFILE_SOURCES).resolved.map(
  (entry) => entry.profile,
);

/**
 * The profile that a new document and an undetectable file fall back to when the
 * `files.defaultProfile` setting is missing or names a profile that does not exist.
 */
export const FALLBACK_PROFILE_ID = 'fanuc-gcode';
