// Monaco's half of the theme (plan §7.3). Owner: WP2.6 in M2, WP3.4 from M3 on.
//
// The two generated themes, `gedit-light` and `gedit-dark`, built from the role palette in
// `core/grammar` (M2 named Monaco's own `vs` / `vs-dark` here; the signature did not
// change, so `app/theme.ts` keeps calling this the same way). `monaco/languages.ts`
// defines them while Monaco loads — a theme id Monaco does not know falls back to `vs`
// silently, which is exactly the kind of failure nobody reports.
//
// Both inherit from the built-in base of their mode, so `.monaco-editor` still carries the
// `vs` / `vs-dark` class that says which side of the theme the editor is on.
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

// The leaf module, not the barrel: this file is reached from `app/theme.ts` while the app
// is still starting, and the grammar generators have no business in the initial bundle.
import { THEME_IDS } from '$lib/core/grammar/roles';
import { editor as editorService } from '$lib/monaco/editorService';

let wanted: 'light' | 'dark' | null = null;
let waitingForEditor = false;

function apply(): void {
  if (wanted === null) return;
  editorService.updateOptions({ theme: THEME_IDS[wanted] });
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
