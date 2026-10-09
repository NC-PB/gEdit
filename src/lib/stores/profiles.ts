// The dialect profiles the app knows (plan §7.2, §7.4, AD-11). Owner: WP3.1.
//
// The real registry: it validates and compiles `data/profiles/*.json` once, at
// construction, and is the only place that turns profile data into the answers the rest
// of the app asks for — the status bar's short name, the dialog filters, the file name a
// new document is offered, the line ending it is written with, and the profile a file is
// opened as.
//
// A profile that does not validate is **skipped**, not fatal: the app has to start even
// when a (P2) user profile is broken, and the problem is reported through `onProblem`
// with the JSON path of the field. The built-ins are covered by `compile.test.ts`, so a
// broken one is a build error, not a user's problem.
//
// Dialog filters follow AD-7: macOS gets NONE, because rfd merges every filter into one
// `allowedFileTypes` list (F7), which would hide extension-less programs (`O1234`) and
// unlisted ones (`.tap`). Windows and Linux get a usable list.
//
// `createProfileRegistry(deps)` plus the singleton wired to the real modules (AD-2), so a
// unit test can build a registry over its own profile JSON without touching Tauri.

import { get, writable } from 'svelte/store';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES, FALLBACK_PROFILE_ID } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectProfile, detectResult as detectResultIn, detectVariants as detectVariantsIn } from '$lib/core/profiles/detect';
import type { DetectResult } from '$lib/core/profiles/detect';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { modalGroupsOf } from '$lib/core/codes/resolve';
import { applyMachine } from '$lib/core/machines/effective';
import { codes as appCodes } from '$lib/stores/codes';
import { settings } from '$lib/stores/settings';
import { isMacPlatform } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { CompiledProfile, Profile, ProfileProblem, ProfileSource, ResolvedProfile } from '$lib/core/profiles/types';
import type { EffectiveMachine, EffectiveProfile } from '$lib/core/machines/types';
import type { CodeDb } from '$lib/core/codes/types';
import type { DialogFilter, ProfileInfo, ProfileRegistry, UserFileText } from '$lib/app/types';

export interface ProfileRegistryDeps {
  /**
   * False on macOS: a filter list there hides every file whose extension is not in it
   * (F7), including the extension-less `O1234` programs that Fanuc controls write.
   */
  filtersSupported: boolean;
  /**
   * The profile JSON, in registry order, as built-in sources. Defaults to the built-ins.
   * A test that hands over plain JSON gets `origin: 'builtin'` for each entry.
   */
  sources?: readonly unknown[];
  /** The same, with the origin and file of each source (M6, AD-16). Wins over `sources`. */
  profileSources?: readonly ProfileSource[];
  /**
   * The resolved database of a dialect id, for `effective` (M6, AD-31). `own` is the
   * database the profile itself names (M13, §7.16 #195): a user database follows a machine's
   * variant, so the answer for `dialect` depends on it.
   */
  codeDb?: (dialect: string, own: string) => CodeDb;
  /**
   * The stored database files, keyed by dialect id (M6). Validation reads them for the two
   * checks a profile cannot answer alone: that a variant's `codes` names a database that
   * exists, and that `machineParams.modalGroups` names groups of the profile's own.
   *
   * The **raw** files, not the code service: the registry is built while the service that
   * would answer is still importing it, and a profile has to load without a database
   * anyway. The default is the built-ins. A reload (M13) asks again, so it sees the
   * databases that exist after `codes.reload`.
   */
  codeDbFiles?: () => Readonly<Record<string, unknown>>;
  /** `files.defaultProfile`; an unknown id falls back to the first built-in. */
  defaultProfileId?: () => string;
  /** Where a profile that could not be loaded is reported (English detail, AD-14). */
  onProblem?: (message: string) => void;
}

/** One loaded profile: the JSON, its compiled form and what the UI shows of it. */
interface Entry {
  info: ProfileInfo;
  profile: Profile;
  compiled: CompiledProfile;
  /** The effective compiles of this profile, by `EffectiveMachine.key` (M6, AD-31). */
  effective: Map<string, EffectiveProfile>;
}

/** §7.2 `ProfileInfo` as it is read off a profile (see the P3 hand-off for the mapping). */
function infoOf(profile: Profile, resolved: ResolvedProfile): ProfileInfo {
  return {
    id: profile.id,
    // The dialog-filter name, not `profile.name`: that one is the display name ("Fanuc (ISO)").
    name: profile.files.filterName,
    shortName: profile.shortName,
    extensions: [...profile.files.extensions],
    defaultFileName: `program.${profile.files.defaultExtension}`,
    newFileEol: profile.files.newFileLineEnding,
    machineType: profile.machineType === 'lathe' ? 'lathe' : 'mill',
    origin: resolved.origin,
    parent: typeof profile.extends === 'string' && profile.extends !== '' ? profile.extends : null,
    file: resolved.file ?? null,
    chain: [...resolved.chain],
    hasMachineParams: profile.machineParams !== undefined,
  };
}

/** Every string of the built-in profiles' JSON, collected once (see `isUserPattern`). */
let builtinTexts: Set<string> | undefined;

function builtinTextSet(): Set<string> {
  if (builtinTexts !== undefined) return builtinTexts;
  const out = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') out.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(visit);
  };
  for (const source of BUILTIN_PROFILE_SOURCES) visit(source.raw);
  builtinTexts = out;
  return out;
}

/**
 * M13 review fix CODE-1: the repeated-group shape check is for the patterns a user's file wrote
 * or changed. A pattern whose text is one of the built-in profiles' own (inherited, or copied
 * into a child) is the shipped one and is not held to it: 13 of the 199 shipped patterns are
 * flagged by the heuristic, all of them bounded by a delimiter.
 */
function isUserPattern(source: string): boolean {
  return !builtinTextSet().has(source);
}

/** How many problems one load prints to the console; the rest are counted (CODE-5). */
const MAX_LOGGED = 20;

/**
 * Resolves (AD-16), then validates, then compiles every source; a broken one is reported
 * and left out. One source cannot cost the others: whatever it throws is its own problem
 * (M13 review fix CODE-2).
 *
 * The order matters: a child is checked on the merge result, exactly like a built-in, so
 * nothing reaches the compiler that the validator has not seen (F20).
 *
 * `files` is the raw code databases; the two validation checks that need them are skipped
 * for a dialect that is not among them (M6).
 */
function load(
  sources: readonly ProfileSource[],
  files: Readonly<Record<string, unknown>>,
  report: (message: string) => void,
): { entries: Entry[]; problems: ProfileProblem[] } {
  const entries: Entry[] = [];
  const found: ProfileProblem[] = [];
  const codeDbs = Object.keys(files);
  const groups = new Map<string, string[]>();
  let logged = 0;
  const onProblem = (message: string): void => {
    logged += 1;
    if (logged <= MAX_LOGGED) report(message.length > 400 ? `${message.slice(0, 400)}…` : message);
  };
  /** The modal groups of one dialect, read once per registry. */
  const modalGroups = (dialect: unknown): string[] | undefined => {
    // `Object.hasOwn`: a profile's `codes` may be "constructor", which `in` finds on every object.
    if (typeof dialect !== 'string' || !Object.hasOwn(files, dialect)) return undefined;
    let known = groups.get(dialect);
    if (!known) {
      known = modalGroupsOf(files as Record<string, unknown>, dialect);
      groups.set(dialect, known);
    }
    return known;
  };
  const { resolved, problems } = resolveProfiles(sources);
  found.push(...problems);
  for (const problem of problems) {
    const where =
      problem.profileId ?? problem.file ?? `profile #${(problem.index ?? 0) + 1}`;
    const at = problem.path === '' ? '' : ` (${problem.path})`;
    onProblem(`${where} was not loaded: ${problem.message}${at}`);
  }

  resolved.forEach((entry, i) => {
    const id = (entry.profile as Partial<Profile>).id;
    const where = typeof id === 'string' && id !== '' ? id : `profile #${i + 1}`;
    const origin = entry.origin;
    const file = entry.file ?? null;
    const profileId = typeof id === 'string' && id !== '' ? id : null;
    const fail = (path: string, message: string): void => {
      found.push({ origin, file, profileId, path, message, kind: 'profiles' });
    };
    let checked: ReturnType<typeof validateProfile>;
    try {
      checked = validateProfile(entry.profile, {
        codeDbs,
        modalGroups: modalGroups(entry.profile.codes),
        ...(origin === 'user' ? { checkShape: isUserPattern } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onProblem(`${where} was not loaded: ${message}`);
      fail('', message);
      return;
    }
    if (!checked.ok) {
      onProblem(`${where} was not loaded: ${checked.errors.slice(0, 5).join('; ')}${checked.errors.length > 5 ? `; and ${checked.errors.length - 5} more` : ''}`);
      for (const error of checked.errors) {
        // `<json.path>: <what is wrong>` (`validateProfile`); a path never contains ": ".
        const at = error.indexOf(': ');
        if (at < 0) fail('', error);
        else fail(error.slice(0, at), error.slice(at + 2));
      }
      return;
    }
    if (entries.some((loaded) => loaded.profile.id === checked.profile.id)) {
      onProblem(`${where} was not loaded: the id is already taken`);
      fail('id', 'the id is already taken');
      return;
    }
    try {
      const compiled = compileProfile(checked.profile);
      entries.push({
        info: infoOf(checked.profile, entry),
        profile: checked.profile,
        compiled,
        effective: new Map(),
      });
    } catch (error) {
      onProblem(`${where} was not loaded: ${error instanceof Error ? error.message : String(error)}`);
      fail('', error instanceof Error ? error.message : String(error));
    }
  });

  if (logged > MAX_LOGGED) report(`and ${logged - MAX_LOGGED} more profile problems (not printed here)`);
  return { entries, problems: found };
}

/** The raw code files of the code service as it stands, or the built-ins before it exists (module cycle). */
function codeFilesNow(): Readonly<Record<string, unknown>> {
  try {
    return appCodes.files();
  } catch {
    return BUILTIN_CODE_DB_JSON;
  }
}

export function createProfileRegistry(deps: ProfileRegistryDeps): ProfileRegistry {
  const onProblem = deps.onProblem ?? ((message: string) => console.warn(message));
  const builtin: readonly ProfileSource[] =
    deps.profileSources ??
    (deps.sources === undefined
      ? BUILTIN_PROFILE_SOURCES
      : deps.sources.map((raw) => ({ raw, origin: 'builtin' as const })));
  const codeFiles = deps.codeDbFiles ?? (() => BUILTIN_CODE_DB_JSON);

  // The loaded set. Everything below reads these, so `reload` replaces them in one go and the
  // answers (`list`, `get`, `compiled`, `detect`) follow without anything to unsubscribe.
  let entries: Entry[] = [];
  let infos: ProfileInfo[] = [];
  let byId = new Map<string, Entry>();
  let compiledList: CompiledProfile[] = [];
  /** The detection tie-break needs the origin, which a compiled profile does not carry. */
  let originOf = new Map<CompiledProfile, 'builtin' | 'user'>();
  let problems: ProfileProblem[] = [];

  function install(loaded: { entries: Entry[]; problems: ProfileProblem[] }): void {
    entries = loaded.entries;
    infos = entries.map((entry) => entry.info);
    byId = new Map<string, Entry>(entries.map((entry) => [entry.profile.id, entry]));
    compiledList = entries.map((entry) => entry.compiled);
    originOf = new Map(entries.map((entry) => [entry.compiled, entry.info.origin]));
    problems = loaded.problems;
  }
  install(load(builtin, codeFiles(), onProblem));

  const all = writable<ProfileInfo[]>(infos);
  const revision = writable(0);

  /** Every profile extension, each one once, in profile order. */
  function allExtensions(): string[] {
    return [...new Set(infos.flatMap((info) => info.extensions))];
  }

  /** The "everything we can open" filter plus an escape hatch. */
  function ncFilters(): DialogFilter[] {
    return [
      { name: t('profiles.filterNc'), extensions: allExtensions() },
      { name: t('profiles.filterAll'), extensions: ['*'] },
    ];
  }

  function defaultId(): string {
    const wanted = deps.defaultProfileId?.();
    if (wanted !== undefined && byId.has(wanted)) return wanted;
    if (byId.has(FALLBACK_PROFILE_ID)) return FALLBACK_PROFILE_ID;
    return infos[0]?.id ?? FALLBACK_PROFILE_ID;
  }

  function need(id: string): Entry {
    const entry = byId.get(id);
    if (!entry) throw new Error(`Unknown profile: ${id}`);
    return entry;
  }

  return {
    all: { subscribe: all.subscribe },

    list(): ProfileInfo[] {
      return infos;
    },

    get(id: string): ProfileInfo | undefined {
      return byId.get(id)?.info;
    },

    defaultId,

    /**
     * AD-11 scoring: a matching folder wins, otherwise the extension weight plus the
     * content weights over the first 400 non-empty lines decide. A fallback that names
     * no known profile becomes the default one.
     */
    detect(path: string | null, text: string, fallback: string): string {
      return detectProfile(compiledList, path, text, byId.has(fallback) ? fallback : defaultId(), {
        origin: (cp) => originOf.get(cp) ?? 'builtin',
      });
    },

    /**
     * M12.5: `detect` with how sure the answer is (`core/profiles/detect.ts`, `DetectResult`).
     * `id` is always what `detect` answers for the same arguments; `uncertain` drives the
     * "dialect uncertain" status and the picker's "keep the guess" (plan §7.16 #177).
     */
    detectResult(path: string | null, text: string, fallback: string): DetectResult {
      return detectResultIn(compiledList, path, text, byId.has(fallback) ? fallback : defaultId(), {
        origin: (cp) => originOf.get(cp) ?? 'builtin',
      });
    },

    openFilters(): DialogFilter[] {
      return deps.filtersSupported ? ncFilters() : [];
    },

    /** The document's own profile first, so Save As appends its preferred extension. */
    saveFilters(id: string): DialogFilter[] {
      if (!deps.filtersSupported) return [];
      const own = byId.get(id)?.info;
      const others = infos.filter((info) => info.id !== own?.id);
      return [
        ...(own ? [{ name: own.name, extensions: own.extensions }] : []),
        ...others.map((info) => ({ name: info.name, extensions: info.extensions })),
        { name: t('profiles.filterAll'), extensions: ['*'] },
      ];
    },

    profile(id: string): Profile {
      return need(id).profile;
    },

    compiled(id: string): CompiledProfile {
      return need(id).compiled;
    },

    /**
     * The profile with a machine applied (AD-31), cached by `eff.key`, so two documents on
     * the same machine — and two machines set up the same way — share one compiled
     * profile. The cache lives on the entry, so a reload of the registry (M12) drops it
     * with the profile it belongs to.
     *
     * `applyMachine` only ever writes fields the validator knows, so a result that does not
     * validate means a **variant overlay** is wrong — data, not a setting the user made.
     * It is reported once per key and the profile's own compile and database are used
     * instead, which is the behaviour of "no machine": the document stays readable and the
     * one thing gEdit will not do is read it by a rule it could not check.
     */
    effective(id: string, eff: EffectiveMachine): EffectiveProfile {
      const entry = need(id);
      const cached = entry.effective.get(eff.key);
      if (cached) return cached;

      const db = deps.codeDb ?? ((dialect: string, own: string) => appCodes.over(own, dialect));
      let profile = entry.profile;
      let compiled = entry.compiled;
      let dialect = entry.profile.codes;
      try {
        const applied = applyMachine(entry.profile, eff);
        const checked = validateProfile(applied.profile, { applied: true });
        if (!checked.ok) throw new Error(checked.errors.join('; '));
        compiled = compileProfile(checked.profile);
        profile = checked.profile;
        dialect = applied.codes;
      } catch (error) {
        onProblem(
          `${id}: the machine settings could not be applied: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const result: EffectiveProfile = { profile, cp: compiled, codes: db(dialect, entry.profile.codes), machine: eff };
      entry.effective.set(eff.key, result);
      return result;
    },

    /**
     * Which choice each declared variant's rules make for this text, and how far ahead of
     * the runner-up it is (`core/profiles/detect.ts`). An unknown profile and one that
     * declares no variant both answer `{}`.
     *
     * The caller acts on a margin of 3 or more and otherwise keeps the variant's default
     * (`effectiveMachine`), and it asks at all only while the document has no machine: a
     * machine the user set up always wins over what a program looks like (AD-31).
     */
    detectVariants(id: string, text: string): Record<string, { value: string; margin: number }> {
      const entry = byId.get(id);
      return entry ? detectVariantsIn(entry.compiled, text) : {};
    },

    /**
     * M13 (§7.3, AD-29): one bump per `reload`, after the new set is in place. It is the one
     * signal for the profile files and the code files (`userConfig.load` reloads the code
     * databases first and always follows with this).
     */
    revision: { subscribe: revision.subscribe },

    /** The problems of the last load: the built-ins' (none, `compile.test.ts` covers them) and the user's files. */
    problems(): ProfileProblem[] {
      return problems;
    },

    /**
     * M13 (AD-29, §7.16 #192): the built-ins plus `user`, resolved, validated and compiled
     * again against the databases that exist now (`codeDbFiles`). Every entry is new, so every
     * `effective` cache is gone with the old ones; `all` is set to the new list; `revision`
     * bumps once. Open documents are not touched here: one whose profile no longer exists is
     * `userConfig.load`'s to detect again.
     *
     * The user files are read in name order, so of two with one id the first loads and the
     * second is reported; a user id equal to a built-in id, a file that is not JSON or not an
     * object, a broken or unfinished profile are reported with their file and JSON path and
     * left out. The built-ins load whatever `user` holds (they are resolved first, a built-in
     * never extends a user profile). Never throws.
     */
    reload(user: UserFileText[]): ProfileProblem[] {
      const sources: ProfileSource[] = [...builtin];
      const bad: ProfileProblem[] = [];
      for (const f of [...user].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        let raw: unknown;
        try {
          raw = JSON.parse(f.text);
        } catch (error) {
          const message = f.text.charCodeAt(0) === 0xfeff
            ? 'the file starts with a byte order mark; save it as UTF-8 without one'
            : `not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
          onProblem(`${f.name} was not loaded: ${message}`);
          bad.push({ origin: 'user', file: f.name, profileId: null, path: '', message, kind: 'profiles' });
          continue;
        }
        sources.push({ raw, origin: 'user', file: f.name });
      }
      let loaded: { entries: Entry[]; problems: ProfileProblem[] };
      try {
        loaded = load(sources, codeFiles(), onProblem);
      } catch (error) {
        // `load` reports what it can; this is the net under it, so the old set stays.
        const message = error instanceof Error ? error.message : String(error);
        onProblem(`the profiles could not be reloaded: ${message}`);
        return [{ origin: 'user', file: null, profileId: null, path: '', message, kind: 'profiles' }];
      }
      loaded.problems = [...bad, ...loaded.problems];
      install(loaded);
      all.set(infos);
      revision.set(get(revision) + 1);
      return problems;
    },
  };
}

/** The application-wide profile registry. */
export const profiles: ProfileRegistry = createProfileRegistry({
  filtersSupported: !isMacPlatform(),
  defaultProfileId: () => settings.get('files.defaultProfile'),
  // A reload validates against the databases the code service holds after its own reload.
  codeDbFiles: codeFilesNow,
});
