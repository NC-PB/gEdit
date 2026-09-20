// The code database service (plan §7.3). Owner: WP3.3.
//
// One database per dialect, shared by every profile that names it in `profile.codes`, so
// a Fanuc mill and a Fanuc lathe profile will read the same file. A database is loaded
// and indexed on first use and then cached, which makes a hover or a completion a map
// lookup.
//
// A database that fails to load never breaks the editor: the profile gets an empty
// database, the assistant answers "unknown" for every word, and the reason is logged
// once.
//
// P2 adds user databases from `<config>/codes/` on top of the built-ins, which is why
// this is a service with injected sources and not a plain import.

import { loadCodeDb, emptyCodeDb, type CodeDbProblem } from '$lib/core/codes/load';
import { completionsFor, lookupWord as lookupWordIn } from '$lib/core/codes/lookup';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { profiles } from '$lib/stores/profiles';
import type { CodeDbService } from '$lib/app/types';
import type { CodeDb, CodeEntry, CodeLookup } from '$lib/core/codes/types';
import type { NcToken } from '$lib/core/nc/types';

export interface CodeDbServiceDeps {
  /** The database id a profile points at, `profile.codes`; undefined for an unknown profile. */
  dialectOf(profileId: string): string | undefined;
  /** The stored JSON of one database; undefined when the dialect has no file. */
  source(dialect: string): unknown | undefined;
  /** Where a broken database is reported. Defaults to `console.warn`. */
  warn?(message: string, detail?: unknown): void;
}

export function createCodeDbService(deps: CodeDbServiceDeps): CodeDbService {
  const warn = deps.warn ?? ((message: string, detail?: unknown) => console.warn(message, detail));
  const cache = new Map<string, CodeDb>();
  /** One object, so the lookup index behind it is built once and not per call. */
  const none = emptyCodeDb('');

  function byDialect(dialect: string): CodeDb {
    const cached = cache.get(dialect);
    if (cached) return cached;

    let db = emptyCodeDb(dialect);
    const raw = deps.source(dialect);
    if (raw === undefined) {
      warn(`code database "${dialect}" is not available`);
    } else {
      const problems: CodeDbProblem[] = [];
      try {
        db = loadCodeDb(raw, (p) => problems.push(p));
      } catch (err) {
        warn(`code database "${dialect}" could not be read`, err);
      }
      for (const p of problems) warn(`code database "${dialect}": ${p.path}: ${p.message}`);
    }
    cache.set(dialect, db);
    return db;
  }

  function forProfile(profileId: string): CodeDb {
    const dialect = deps.dialectOf(profileId);
    if (dialect === undefined) return none;
    return byDialect(dialect);
  }

  return {
    forProfile,

    lookupWord(profileId: string, token: NcToken): CodeLookup | null {
      return lookupWordIn(forProfile(profileId), token);
    },

    completions(profileId: string, prefix: string, atBlockStart: boolean): CodeEntry[] {
      return completionsFor(forProfile(profileId), prefix, atBlockStart);
    },

    forScripts(profileId: string): CodeEntry[] {
      return forProfile(profileId).codes;
    },
  };
}

/**
 * Profile id → database id, asked of the profile registry (WP3.1 made `profile()` real
 * at the M3 merge; WP3.3 read the built-in JSON directly while it still threw).
 *
 * `get()` is the existence check, so an id the registry does not know answers `undefined`
 * instead of throwing, and a user profile from `<config>/profiles/` (P2) will resolve
 * here for free once the registry loads it.
 */
function dialectOf(profileId: string): string | undefined {
  if (!profiles.get(profileId)) return undefined;
  const dialect = profiles.profile(profileId).codes;
  return typeof dialect === 'string' && dialect !== '' ? dialect : undefined;
}

/** The application-wide code database. */
export const codes: CodeDbService = createCodeDbService({
  dialectOf,
  source: (dialect) => BUILTIN_CODE_DB_JSON[dialect],
});
