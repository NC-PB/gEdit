// Monaco's half of the theme (plan §7.3). Owner: WP2.6 in M2, WP3.4 from M3 on.
//
// In M2 this is Monaco's own `vs` / `vs-dark`. M3 replaces the body with the two
// generated themes (`gedit-light` and `gedit-dark`), built from the role palettes of the
// dialect profiles; the signature does not change, so `app/theme.ts` keeps calling it the
// same way.
//
// The theme is set through `EditorService.updateOptions`, not through
// `monaco.editor.setTheme`, for two reasons: nothing here has to reach into
// `$lib/monaco/core` (which would pull Monaco into the initial bundle and evaluate it
// during prerender), and a standalone editor applies `theme` to the whole standalone
// theme service, so the diff editor of the compare view follows along.
//
// `app/theme.ts` calls this while the app is still starting, long before `EditorHost` has
// attached, so the wanted theme is remembered and applied again once the editor is up.
//
// `EditorService` also remembers the last `updateOptions` payload and replays it onto
// every editor instance it builds (G8 M2), which is what keeps the theme after the
// compare overlay has unmounted and remounted `EditorHost`. The `ready` hook below is a
// second belt: it is what settles the very first attach if that replay is ever removed.

import { editor as editorService } from '$lib/monaco/editorService';

/** The Monaco theme id per mode. M3 swaps in `gedit-light` / `gedit-dark`. */
export const MONACO_THEMES: Readonly<Record<'light' | 'dark', string>> = {
  light: 'vs',
  dark: 'vs-dark',
};

let wanted: 'light' | 'dark' | null = null;
let waitingForEditor = false;

function apply(): void {
  if (wanted === null) return;
  editorService.updateOptions({ theme: MONACO_THEMES[wanted] });
}

/** Switches Monaco to the light or the dark theme. Safe to call before Monaco is up. */
export function setMonacoTheme(mode: 'light' | 'dark'): void {
  wanted = mode;
  apply();
  if (waitingForEditor) return;
  waitingForEditor = true;
  // Resolves on the first successful attach and never rejects; the second handler only
  // guards against a future change turning that into an unhandled rejection.
  void editorService.ready.then(apply, () => {});
}
