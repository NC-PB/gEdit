// The built-in dialect profiles (plan AD-11). Written by the M3 prelude (P3); owner from
// Wave A on: WP3.1.
//
// The JSON is imported statically, so the profiles are part of the bundle and the app
// starts with them in hand (no fetch, no fs permission). It is deliberately typed
// `unknown`: a profile becomes a `Profile` only after `validateProfile` has seen it, so
// that a built-in and a user profile go through exactly the same gate (WP3.1).
//
// The order is the registry order, which is also the detection tie-break and the order of
// the save-dialog filters.

import fanucGcode from './fanuc-gcode.json';
import heidenhainKlartext from './heidenhain-klartext.json';

/** The shipped profiles, as read from JSON. Validate before use. */
export const BUILTIN_PROFILE_JSON: readonly unknown[] = [fanucGcode, heidenhainKlartext];

/**
 * The profile that a new document and an undetectable file fall back to when the
 * `files.defaultProfile` setting is missing or names a profile that does not exist.
 */
export const FALLBACK_PROFILE_ID = 'fanuc-gcode';
