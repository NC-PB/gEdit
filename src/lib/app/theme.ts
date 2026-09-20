// Light, dark and "follow the system" (plan §7.3, WP2.6). Owner: WP2.6.
//
// One choice drives three things, which is why this is a service and not a CSS class:
//   - `data-theme` on `<html>`, which switches the variables in `app.css`
//   - `setMonacoTheme()` ('vs' / 'vs-dark' in M2; M3 swaps in the generated themes)
//   - `getCurrentWindow().setTheme()`, so the native title bar follows a manual choice
//     (null for 'system'). This is the one capability M2 adds: `core:window:allow-set-theme`.
// `system` follows `matchMedia('(prefers-color-scheme: dark)')` through a listener, so a
// change while the app runs is picked up without a restart.
//
// `applyTheme` only *applies*: `appearance.theme` is written by the `view.setTheme`
// command, and `contrib/theme.ts` calls `applyTheme` from its subscription to the
// settings. Persisting here as well would make the store and this module chase each
// other. (The P2 stub's doc comment said otherwise; the signature is unchanged.)
//
// `createTheme(deps)` plus the singleton wired to the real platform (AD-2), so a unit
// test needs neither a DOM nor a webview.

import { writable, type Readable } from 'svelte/store';
import { setMonacoTheme } from '$lib/monaco/theme';
import { isTauriRuntime } from '$lib/utils/platform';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** The slice of `MediaQueryList` this module uses, so a test can hand over a fake. */
export interface MediaQueryLike {
  matches: boolean;
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

export interface ThemeDeps {
  /** `(prefers-color-scheme: dark)`, or null where `matchMedia` is missing (SSR, node). */
  darkMedia: () => MediaQueryLike | null;
  /** Sets `data-theme` on the document element. */
  setDataTheme: (mode: ResolvedTheme) => void;
  setMonacoTheme: (mode: ResolvedTheme) => void;
  /** The native window theme; null means "follow the system". */
  setWindowTheme: (mode: ResolvedTheme | null) => void;
}

export interface ThemeController {
  applyTheme(mode: ThemeMode): void;
  effectiveTheme: Readable<ResolvedTheme>;
  /** The mode last applied; 'system' until `applyTheme` runs. */
  mode(): ThemeMode;
  /** Drops the `matchMedia` listener. Only the tests and a shutdown need this. */
  dispose(): void;
}

/** The app's dark palette is the one on `:root`, so that is what an unknown state shows. */
const FALLBACK: ResolvedTheme = 'dark';

export function createTheme(deps: ThemeDeps): ThemeController {
  const effective = writable<ResolvedTheme>(FALLBACK);

  let mode: ThemeMode = 'system';
  let resolved: ResolvedTheme | null = null;
  let media: MediaQueryLike | null = null;
  let listening = false;

  const onSystemChange = (event: { matches: boolean }): void => {
    if (mode !== 'system') return;
    push(event.matches ? 'dark' : 'light');
  };

  function stopListening(): void {
    if (!listening) return;
    listening = false;
    media?.removeEventListener('change', onSystemChange);
  }

  function startListening(): void {
    if (listening) return;
    if (media === null) media = deps.darkMedia();
    if (media === null) return;
    listening = true;
    media.addEventListener('change', onSystemChange);
  }

  /** Applies a resolved theme, skipping the work when nothing changed. */
  function push(next: ResolvedTheme): void {
    if (next === resolved) return;
    resolved = next;
    deps.setDataTheme(next);
    deps.setMonacoTheme(next);
    effective.set(next);
  }

  function systemTheme(): ResolvedTheme {
    if (media === null) media = deps.darkMedia();
    if (media === null) return FALLBACK;
    return media.matches ? 'dark' : 'light';
  }

  // 'system' is the starting mode, so the store answers with what the system says from
  // the first read on — the same value `guessThemeFromSystem()` puts on `<html>`.
  // `resolved` stays null, so the first `applyTheme` still applies everything.
  effective.set(systemTheme());

  return {
    applyTheme(next: ThemeMode): void {
      // The native title bar only has to be told when the *choice* changed, plus once at
      // startup; a system change while 'system' is selected is what the window does anyway.
      const changedMode = next !== mode || resolved === null;
      mode = next;
      if (next === 'system') startListening();
      else stopListening();
      push(next === 'system' ? systemTheme() : next);
      if (changedMode) deps.setWindowTheme(next === 'system' ? null : next);
    },

    effectiveTheme: { subscribe: effective.subscribe },

    mode(): ThemeMode {
      return mode;
    },

    dispose(): void {
      stopListening();
    },
  };
}

// ---------------------------------------------------------------------------
// The real platform
// ---------------------------------------------------------------------------

let cachedMedia: MediaQueryLike | null | undefined;

function darkMedia(): MediaQueryLike | null {
  if (cachedMedia === undefined) {
    cachedMedia =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
  }
  return cachedMedia;
}

function setDataTheme(mode: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
}

function setWindowTheme(mode: ResolvedTheme | null): void {
  if (!isTauriRuntime()) return;
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(mode))
    .catch((err: unknown) => console.error('Could not set the window theme', err));
}

/**
 * The system preference, applied to `<html>` while this module is evaluated.
 *
 * This module is part of the initial bundle (`contrib/theme.ts` is glob-loaded by
 * `app/contributions.ts`), so this runs before the shell is painted and a light desktop
 * never flashes the dark chrome. It sets the attribute and nothing else: Monaco is not
 * loaded yet and the settings have not been read. `applyTheme()` corrects the choice a
 * moment later if `appearance.theme` is not `system`.
 */
function guessThemeFromSystem(): void {
  if (typeof document === 'undefined') return;
  if (document.documentElement.hasAttribute('data-theme')) return;
  setDataTheme(darkMedia()?.matches === false ? 'light' : 'dark');
}

guessThemeFromSystem();

const controller = createTheme({ darkMedia, setDataTheme, setMonacoTheme, setWindowTheme });

/** Applies `mode` to the document, to Monaco and to the native window. */
export function applyTheme(mode: ThemeMode): void {
  controller.applyTheme(mode);
}

/** What `system` currently resolves to, for anything that needs the concrete theme. */
export const effectiveTheme: Readable<ResolvedTheme> = controller.effectiveTheme;

/** The mode last applied. `contrib/theme.ts` uses it to label the current choice. */
export function themeMode(): ThemeMode {
  return controller.mode();
}
