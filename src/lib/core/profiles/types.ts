// Placeholder (plan §7 preamble). The real dialect-profile contract is §7.4 and is
// written into this same file by the M3 prelude (P3); the index signature keeps the
// placeholder assignable from the full definition, so M1 imports keep resolving.
//
// Owner from M3 on: P3 / WP3.1. Nothing in M1 constructs these: `ProfileRegistry.profile()`
// and `.compiled()` throw until M3.

/** Dialect profile, §7.4. Placeholder until P3. */
export interface Profile {
  id: string;
  [field: string]: unknown;
}

/** Compiled dialect profile (precompiled regexes and keyword list), §7.4. Placeholder until P3. */
export interface CompiledProfile {
  profile: Profile;
  [field: string]: unknown;
}
