// The built-in code databases (plan §7.4, `docs/planning/code-assistant.md`). Owner: WP3.3.
//
// The JSON is imported statically, the same way the profiles are: the CSP has no `'self'`
// in `connect-src`, so a bundled file cannot be fetched at runtime (F6). One file per
// dialect, keyed by the id a profile names in its `codes` field.
//
// The JSON is deliberately typed `unknown`: a database becomes a `CodeDb` only after
// `loadCodeDb` has seen it, so a built-in goes through exactly the same gate as a user
// database from `<config>/codes/` will in P2.

import fanuc from './fanuc.json';
import heidenhain from './heidenhain.json';

/** Dialect id → the database as it is stored on disk. Load before use. */
export const BUILTIN_CODE_DB_JSON: Readonly<Record<string, unknown>> = {
  fanuc,
  heidenhain,
};
