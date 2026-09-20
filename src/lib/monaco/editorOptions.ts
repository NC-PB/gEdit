// Settings → Monaco options (plan WP2.6). Owner: WP2.6.
//
// Two kinds of option, which is why there are two functions:
//   - *editor* options (font, minimap, whitespace, sticky scroll, quick suggestions) go
//     to `editor.updateOptions()` and take effect at once for every model;
//   - *model* options (`tabSize`, `insertSpaces`) live on each `ITextModel`, so they have
//     to be applied to the models that already exist and again in `onDidCreateModel`.
// `installEditorSettings()` subscribes to the settings store and keeps both in step, and
// is the only thing `contrib/theme.ts` has to call.
//
// The theme is NOT set here: `app/theme.ts` owns it, because the choice also drives
// `data-theme` and the native window.
//
// Monaco is only reached through `EditorService`, so this module needs no value import
// of `$lib/monaco/core` and Monaco stays out of the initial bundle. The option object is
// built against Monaco's own types, so a typo is a compile error, and handed on as a
// plain record because that is what `EditorService.updateOptions` takes.

import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { editor as editorService } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { settings as appSettings } from '$lib/stores/settings';
import type { Settings } from '$lib/core/settings/schema';
import type { Disposable, DocumentStore, EditorService } from '$lib/app/types';
import type { Readable } from 'svelte/store';

/**
 * What `EditorService.updateOptions` takes. `wordBasedSuggestions` lives in
 * `IGlobalEditorOptions` rather than in `IEditorOptions`, so both halves are needed.
 */
type EditorOptions = MonacoApi.editor.IEditorOptions & MonacoApi.editor.IGlobalEditorOptions;

/**
 * `assist.completion`:
 *   - `auto`   suggestions pop up while typing, but not inside a comment or a string:
 *              `(TOOL: 10MM END MILL)` is prose, and `quickSuggestions: true` would make
 *              Monaco offer G-codes in the middle of it
 *   - `manual` only Ctrl+Space opens them
 *   - `off`    no suggestions at all, not even word-based ones
 */
function completionOptions(mode: Settings['assist.completion']): EditorOptions {
  return {
    quickSuggestions:
      mode === 'auto' ? { other: 'on', comments: 'off', strings: 'off' } : false,
    suggestOnTriggerCharacters: mode === 'auto',
    wordBasedSuggestions: mode === 'off' ? 'off' : 'currentDocument',
  };
}

/** Everything `updateOptions()` understands, typed so that a wrong name does not compile. */
function typedEditorOptions(s: Settings): EditorOptions {
  return {
    fontFamily: s['appearance.editorFontFamily'],
    fontSize: s['appearance.editorFontSize'],
    renderWhitespace: s['editor.renderWhitespace'],
    wordWrap: s['editor.wordWrap'] ? 'on' : 'off',
    minimap: { enabled: s['editor.minimap'] },
    lineNumbers: s['editor.lineNumbers'] ? 'on' : 'off',
    renderLineHighlight: s['editor.highlightCurrentLine'] ? 'line' : 'none',
    // `outlineModel` is what M3's symbol provider feeds; until then Monaco falls back to
    // the indentation model on its own.
    stickyScroll: { enabled: s['editor.stickyScroll'], defaultModel: 'outlineModel' },
    dragAndDrop: s['editor.dragAndDrop'],
    emptySelectionClipboard: s['editor.emptySelectionClipboard'],
    rulers: [...s['editor.rulers']],
    hover: { enabled: s['assist.hover'] },
    ...completionOptions(s['assist.completion']),
  };
}

/** The `IEditorOptions` that `s` implies, including `stickyScroll` and `quickSuggestions`. */
export function editorOptionsFor(s: Settings): Record<string, unknown> {
  return typedEditorOptions(s) as Record<string, unknown>;
}

/** The per-model options that `s` implies (`tabSize`, `insertSpaces`). */
export function modelOptionsFor(s: Settings): Record<string, unknown> {
  const options: MonacoApi.editor.ITextModelUpdateOptions = {
    tabSize: s['editor.tabWidth'],
    insertSpaces: s['editor.insertSpaces'],
  };
  return options as Record<string, unknown>;
}

export interface EditorSettingsDeps {
  values: Readable<Settings>;
  editor: EditorService;
  docs: DocumentStore;
}

const LIVE: EditorSettingsDeps = {
  values: appSettings.values,
  editor: editorService,
  docs: appDocs,
};

/**
 * Applies the settings to the editor and to every model, now and on every change.
 *
 * Called once from `contrib/theme.ts`. Three places need the same values:
 *   - the subscription, for a change while the app runs;
 *   - `onDidCreateModel`, for a document opened later;
 *   - `editor.ready`, because the very first subscriber call usually arrives before
 *     `EditorHost` has attached, when there is no editor and no model to update yet.
 *
 * A **re-attach** is not one of them, and must not be: `ready` resolves on the first
 * attach only, so nothing here would fire when the compare overlay unmounts `EditorHost`
 * and mounts it again. `EditorService` replays the last `updateOptions` payload onto the
 * new instance itself (G8 M2); the model options survive because they live on the models,
 * which a re-attach does not touch.
 */
export function installEditorSettings(deps: EditorSettingsDeps = LIVE): Disposable {
  let current: Settings | undefined;

  function applyModels(s: Settings): void {
    const options = modelOptionsFor(s);
    for (const doc of deps.docs.all()) deps.editor.model(doc.id)?.updateOptions(options);
  }

  function applyAll(s: Settings): void {
    deps.editor.updateOptions(editorOptionsFor(s));
    applyModels(s);
  }

  const stopValues = deps.values.subscribe((s) => {
    current = s;
    applyAll(s);
  });

  const stopCreate = deps.editor.onDidCreateModel((id) => {
    if (current) deps.editor.model(id)?.updateOptions(modelOptionsFor(current));
  });

  // `editor.ready` resolves on the first attach and never rejects; the catch is there so
  // that a future change cannot turn it into an unhandled rejection (the harness counts
  // those as console errors).
  void deps.editor.ready.then(
    () => {
      if (current) applyAll(current);
    },
    () => {},
  );

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    stopValues();
    stopCreate();
  };
}
