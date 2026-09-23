// Dictionary-driven completion (plan §5 WP3.6). Owner: WP3.6.
//
// A thin shell around `core/codes/completionItems.ts`: this file reads the line out of
// the model and turns a `CompletionSpec` into a Monaco suggestion. Which codes are
// offered where, and what they insert, is decided in the core module, where node tests
// can reach it.
//
// `assist.completion` is read on every call, not at registration:
//   - `off`    answers with nothing, so not even Ctrl+Space opens the list. Monaco's own
//              `quickSuggestions` and `wordBasedSuggestions` are switched off from the
//              same setting in `monaco/editorOptions.ts`.
//   - `manual` leaves the provider working; only the automatic pop-up is off, which is
//              again `quickSuggestions`, not this file.
//   - `auto`   everything on.
//
// No `triggerCharacters`: an NC block is a run of words, so Monaco's word-based trigger
// is exactly right, and a space as a trigger character would open the list in the middle
// of every block.

import { completionsAt, type CompletionKind } from '$lib/core/codes/completionItems';
import { t } from '$lib/i18n';
import { settings } from '$lib/stores/settings';
import { stateBefore, viewOf } from './hover';
import type { Monaco } from '$lib/monaco/setup';
import type { Disposable } from '$lib/app/types';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';

/** Registers the completion provider for one profile (Monaco language id = profile id). */
export function registerCompletion(monaco: Monaco, profileId: string): Disposable {
  const kinds: Record<CompletionKind, MonacoApi.languages.CompletionItemKind> = {
    code: monaco.languages.CompletionItemKind.Function,
    cycle: monaco.languages.CompletionItemKind.Snippet,
    keyword: monaco.languages.CompletionItemKind.Keyword,
  };
  const asSnippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const empty: MonacoApi.languages.CompletionList = { suggestions: [] };

  const registration = monaco.languages.registerCompletionItemProvider(profileId, {
    provideCompletionItems(model, position) {
      if (settings.get('assist.completion') === 'off') return empty;

      // The document's effective view (AD-31): a system-B lathe document is offered the
      // codes of the database its machine selects, not the ones its profile id names.
      const { cp, db } = viewOf(model, profileId);
      const line = model.getLineContent(position.lineNumber);
      const result = completionsAt(line, position.column - 1, cp, db, {
        t,
        prev: stateBefore(model, position.lineNumber, cp),
      });
      // Null is "this is a comment or a string": answering with an empty list is what
      // keeps Monaco from falling back to anything of its own here.
      if (!result) return empty;

      const range: MonacoApi.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: result.start + 1,
        endLineNumber: position.lineNumber,
        endColumn: result.end + 1,
      };
      return {
        suggestions: result.items.map((item) => ({
          label: item.label,
          kind: kinds[item.kind],
          insertText: item.insertText,
          insertTextRules: item.snippet ? asSnippet : undefined,
          detail: item.detail,
          documentation: item.documentation,
          sortText: item.sortText,
          range,
        })),
      };
    },
  });
  return () => registration.dispose();
}
