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

import { readable } from 'svelte/store';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES, FALLBACK_PROFILE_ID } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectProfile, detectVariants as detectVariantsIn } from '$lib/core/profiles/detect';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { modalGroupsOf } from '$lib/core/codes/resolve';
import { applyMachine } from '$lib/core/machines/effective';
import { codes as appCodes } from '$lib/stores/codes';
import { settings } from '$lib/stores/settings';
import { isMacPlatform } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { CompiledProfile, Profile, ProfileSource, ResolvedProfile } from '$lib/core/profiles/types';
import type { EffectiveMachine, EffectiveProfile } from '$lib/core/machines/types';
import type { CodeDb } from '$lib/core/codes/types';
import type { DialogFilter, ProfileInfo, ProfileRegistry } from '$lib/app/types';

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
  /** The resolved database of a dialect id, for `effective` (M6, AD-31). */
  codeDb?: (dialect: string) => CodeDb;
  /**
   * The stored database files, keyed by dialect id (M6). Validation reads them for the two
   * checks a profile cannot answer alone: that a variant's `codes` names a database that
   * exists, and that `machineParams.modalGroups` names groups of the profile's own.
   *
   * The **raw** files, not the code service: the registry is built while the service that
   * would answer is still importing it, and a profile has to load without a database
   * anyway. The default is the built-ins.
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

/**
 * Resolves (AD-16), then validates, then compiles every source; a broken one is reported
 * and left out.
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
  onProblem: (message: string) => void,
): Entry[] {
  const entries: Entry[] = [];
  const codeDbs = Object.keys(files);
  const groups = new Map<string, string[]>();
  /** The modal groups of one dialect, read once per registry. */
  const modalGroups = (dialect: unknown): string[] | undefined => {
    if (typeof dialect !== 'string' || !(dialect in files)) return undefined;
    let known = groups.get(dialect);
    if (!known) {
      known = modalGroupsOf(files as Record<string, unknown>, dialect);
      groups.set(dialect, known);
    }
    return known;
  };
  const { resolved, problems } = resolveProfiles(sources);
  for (const problem of problems) {
    const where =
      problem.profileId ?? problem.file ?? `profile #${(problem.index ?? 0) + 1}`;
    const at = problem.path === '' ? '' : ` (${problem.path})`;
    onProblem(`${where} was not loaded: ${problem.message}${at}`);
  }

  resolved.forEach((entry, i) => {
    const id = (entry.profile as Partial<Profile>).id;
    const where = typeof id === 'string' && id !== '' ? id : `profile #${i + 1}`;
    const checked = validateProfile(entry.profile, {
      codeDbs,
      modalGroups: modalGroups(entry.profile.codes),
    });
    if (!checked.ok) {
      onProblem(`${where} was not loaded: ${checked.errors.join('; ')}`);
      return;
    }
    if (entries.some((loaded) => loaded.profile.id === checked.profile.id)) {
      onProblem(`${where} was not loaded: the id is already taken`);
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
    }
  });

  return entries;
}

export function createProfileRegistry(deps: ProfileRegistryDeps): ProfileRegistry {
  const onProblem = deps.onProblem ?? ((message: string) => console.warn(message));
  const sources: readonly ProfileSource[] =
    deps.profileSources ??
    (deps.sources === undefined
      ? BUILTIN_PROFILE_SOURCES
      : deps.sources.map((raw) => ({ raw, origin: 'builtin' as const })));
  const entries = load(sources, (deps.codeDbFiles ?? (() => BUILTIN_CODE_DB_JSON))(), onProblem);
  const infos: ProfileInfo[] = entries.map((entry) => entry.info);
  const byId = new Map<string, Entry>(entries.map((entry) => [entry.profile.id, entry]));
  const compiledList = entries.map((entry) => entry.compiled);
  /** The detection tie-break needs the origin, which a compiled profile does not carry. */
  const originOf = new Map(entries.map((entry) => [entry.compiled, entry.info.origin]));

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
    all: readable<ProfileInfo[]>(infos),

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

      const db = deps.codeDb ?? ((dialect: string) => appCodes.byId(dialect));
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
      const result: EffectiveProfile = { profile, cp: compiled, codes: db(dialect), machine: eff };
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
  };
}

/** The application-wide profile registry. */
export const profiles: ProfileRegistry = createProfileRegistry({
  filtersSupported: !isMacPlatform(),
  defaultProfileId: () => settings.get('files.defaultProfile'),
});
