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
import { BUILTIN_PROFILE_JSON, FALLBACK_PROFILE_ID } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectProfile } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { settings } from '$lib/stores/settings';
import { isMacPlatform } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { DialogFilter, ProfileInfo, ProfileRegistry } from '$lib/app/types';

export interface ProfileRegistryDeps {
  /**
   * False on macOS: a filter list there hides every file whose extension is not in it
   * (F7), including the extension-less `O1234` programs that Fanuc controls write.
   */
  filtersSupported: boolean;
  /** The profile JSON, in registry order. Defaults to the built-ins. */
  sources?: readonly unknown[];
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
}

/** §7.2 `ProfileInfo` as it is read off a profile (see the P3 hand-off for the mapping). */
function infoOf(profile: Profile): ProfileInfo {
  return {
    id: profile.id,
    // The dialog-filter name, not `profile.name`: that one is the display name ("Fanuc (ISO)").
    name: profile.files.filterName,
    shortName: profile.shortName,
    extensions: [...profile.files.extensions],
    defaultFileName: `program.${profile.files.defaultExtension}`,
    newFileEol: profile.files.newFileLineEnding,
  };
}

/** Validates and compiles every source; a broken one is reported and left out. */
function load(sources: readonly unknown[], onProblem: (message: string) => void): Entry[] {
  const entries: Entry[] = [];

  sources.forEach((raw, i) => {
    const id = (raw as Partial<Profile> | null)?.id;
    const where = typeof id === 'string' && id !== '' ? id : `profile #${i + 1}`;
    const checked = validateProfile(raw);
    if (!checked.ok) {
      onProblem(`${where} was not loaded: ${checked.errors.join('; ')}`);
      return;
    }
    if (entries.some((entry) => entry.profile.id === checked.profile.id)) {
      onProblem(`${where} was not loaded: the id is already taken`);
      return;
    }
    try {
      const compiled = compileProfile(checked.profile);
      entries.push({ info: infoOf(checked.profile), profile: checked.profile, compiled });
    } catch (error) {
      onProblem(`${where} was not loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return entries;
}

export function createProfileRegistry(deps: ProfileRegistryDeps): ProfileRegistry {
  const onProblem = deps.onProblem ?? ((message: string) => console.warn(message));
  const entries = load(deps.sources ?? BUILTIN_PROFILE_JSON, onProblem);
  const infos: ProfileInfo[] = entries.map((entry) => entry.info);
  const byId = new Map<string, Entry>(entries.map((entry) => [entry.profile.id, entry]));
  const compiledList = entries.map((entry) => entry.compiled);

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
      return detectProfile(compiledList, path, text, byId.has(fallback) ? fallback : defaultId());
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
  };
}

/** The application-wide profile registry. */
export const profiles: ProfileRegistry = createProfileRegistry({
  filtersSupported: !isMacPlatform(),
  defaultProfileId: () => settings.get('files.defaultProfile'),
});
