// The dialect profiles the app knows (plan §7.2, AD-11). Owner: WP1.6.
//
// M1 subset: a thin adapter over the legacy `DIALECTS` and `detectLanguage`, so that the
// file operations, the save dialog and the status bar can already speak the
// `ProfileRegistry` language. M3 (WP3.1) replaces this module with the real registry over
// `data/profiles/*.json`; the ids stay the same, so nothing that imports it changes.
//
// `profile()` and `compiled()` therefore still throw: no JSON profile exists yet.
//
// Dialog filters follow AD-7: macOS gets NONE, because rfd merges every filter into one
// `allowedFileTypes` list (F7), which would hide extension-less programs (`O1234`) and
// unlisted ones (`.tap`). Windows and Linux get a usable list.

import { readable } from 'svelte/store';
import { detectLanguage } from '$lib/utils/detectLanguage';
import { DIALECTS, isDialect, type Dialect } from '$lib/utils/dialects';
import { isMacPlatform } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { DialogFilter, Eol, ProfileInfo, ProfileRegistry } from '$lib/app/types';

/** The profile a new document and an undetectable file fall back to. */
const DEFAULT_ID: Dialect = 'fanuc-gcode';

/** `newFileLineEnding` from the spec; every P1 profile writes CRLF (AD-7). */
const NEW_FILE_EOL: Eol = 'crlf';

/** The order the picker and the filter list use: the default profile first. */
const ORDER: Dialect[] = [DEFAULT_ID, ...(Object.keys(DIALECTS) as Dialect[]).filter((id) => id !== DEFAULT_ID)];

const INFOS: ProfileInfo[] = ORDER.map((id) => ({
  id,
  name: DIALECTS[id].filterName,
  shortName: DIALECTS[id].label,
  extensions: DIALECTS[id].extensions,
  defaultFileName: DIALECTS[id].defaultFileName,
  newFileEol: NEW_FILE_EOL,
}));

const BY_ID = new Map<string, ProfileInfo>(INFOS.map((info) => [info.id, info]));

/** Every profile extension, each one once, in profile order. */
function allExtensions(): string[] {
  return [...new Set(INFOS.flatMap((info) => info.extensions))];
}

export interface ProfileRegistryDeps {
  /**
   * False on macOS: a filter list there hides every file whose extension is not in it
   * (F7), including the extension-less `O1234` programs that Fanuc controls write.
   */
  filtersSupported: boolean;
}

function m3(): never {
  throw new Error('not implemented: M3');
}

export function createProfileRegistry(deps: ProfileRegistryDeps): ProfileRegistry {
  /** The "everything we can open" filter plus an escape hatch. */
  function ncFilters(): DialogFilter[] {
    return [
      { name: t('profiles.filterNc'), extensions: allExtensions() },
      { name: t('profiles.filterAll'), extensions: ['*'] },
    ];
  }

  return {
    all: readable<ProfileInfo[]>(INFOS),

    list(): ProfileInfo[] {
      return INFOS;
    },

    get(id: string): ProfileInfo | undefined {
      return BY_ID.get(id);
    },

    defaultId(): string {
      return DEFAULT_ID;
    },

    /**
     * The extension decides when it is specific (`.h`, `.nc`, `.min`); anything else is
     * sniffed over the first 400 non-empty lines and falls back to `fallback`.
     * A path of `null` (an untitled buffer) is sniffed on its content alone.
     */
    detect(path: string | null, text: string, fallback: string): string {
      return detectLanguage(path ?? '', text, isDialect(fallback) ? fallback : DEFAULT_ID);
    },

    openFilters(): DialogFilter[] {
      return deps.filtersSupported ? ncFilters() : [];
    },

    /** The document's own profile first, so Save As appends its preferred extension. */
    saveFilters(id: string): DialogFilter[] {
      if (!deps.filtersSupported) return [];
      const own = BY_ID.get(id);
      const others = INFOS.filter((info) => info.id !== own?.id);
      return [
        ...(own ? [{ name: own.name, extensions: own.extensions }] : []),
        ...others.map((info) => ({ name: info.name, extensions: info.extensions })),
        { name: t('profiles.filterAll'), extensions: ['*'] },
      ];
    },

    profile(_id: string): Profile {
      return m3();
    },

    compiled(_id: string): CompiledProfile {
      return m3();
    },
  };
}

/** The application-wide profile registry. */
export const profiles: ProfileRegistry = createProfileRegistry({
  filtersSupported: !isMacPlatform(),
});
