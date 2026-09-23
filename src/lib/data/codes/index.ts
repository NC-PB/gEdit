// The built-in code databases (plan §7.4, AD-17, `docs/planning/code-assistant.md`).
// Owner: WP3.3, and WP6.2 for the Fanuc content.
//
// The JSON is imported statically, the same way the profiles are: the CSP has no `'self'`
// in `connect-src`, so a bundled file cannot be fetched at runtime (F6). One file per
// dialect, keyed by the id a profile names in its `codes` field.
//
// The JSON is deliberately typed `unknown`: a database becomes a `CodeDb` only after
// `loadCodeDb` has seen it, so a built-in goes through exactly the same gate as a user
// database from `<config>/codes/` will in P2.
//
// M6: a file may name a parent with `extends` (AD-17), so the whole map goes to
// `resolveCodeDbs` — a child cannot be merged without its parent in hand. The variant
// databases (`fanuc-lathe-b`) are listed here like any other: a machine chooses one
// through its profile's `machineParams.variants`, not by loading a file of its own.

import fanuc from './fanuc.json';
import fanucLathe from './fanuc-lathe.json';
import fanucLatheB from './fanuc-lathe-b.json';
import heidenhain from './heidenhain.json';

/** Dialect id → the database as it is stored on disk. Resolve and load before use. */
export const BUILTIN_CODE_DB_JSON: Readonly<Record<string, unknown>> = {
  fanuc,
  'fanuc-lathe': fanucLathe,
  'fanuc-lathe-b': fanucLatheB,
  heidenhain,
};
