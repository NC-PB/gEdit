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

import { templates } from '$lib/app/templateService';
import { completionsAt, type CompletionKind } from '$lib/core/codes/completionItems';
import { TEMPLATE_ID } from '$lib/core/templates';
import { t } from '$lib/i18n';
import { settings } from '$lib/stores/settings';
import { docs } from '$lib/stores/documents';
import { editor } from '$lib/monaco/editorService';
import { stateBefore, viewOf } from './hover';
import type { Monaco } from '$lib/monaco/setup';
import type { Disposable } from '$lib/app/types';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';

/**
 * The editor command a form template's completion item runs on acceptance (P3.5). The item
 * carries the template id; the handler runs the template's own command, which opens the form.
 * Registered once per Monaco instance (`registerCompletion` runs once per profile).
 */
export const TEMPLATE_COMPLETION_COMMAND = 'gedit.completion.runTemplate';
const commandRegistered = new WeakSet<object>();

/** What accepting a form template does; the real ones are below, the tests give their own. */
export interface TemplateCompletionPorts {
  /** Runs the template's form and insert; false when nothing was inserted (cancelled, refused). */
  insert(id: string): Promise<boolean>;
  /** Puts the typed word back, when the line it was on is still blank. */
  restorePrefix(prefix: string): void;
}

/**
 * Accepting a form template deletes the word that was typed (the item inserts nothing) and opens
 * the form. When the form does not insert anything the word comes back, so a cancelled form leaves
 * the line as it was (CODE-15).
 */
export async function acceptTemplateCompletion(ports: TemplateCompletionPorts, id: string, prefix: string): Promise<void> {
  const inserted = await ports.insert(id);
  if (!inserted && prefix !== '') ports.restorePrefix(prefix);
}

const realPorts: TemplateCompletionPorts = {
  insert: (id) => templates.insert(id),
  restorePrefix: (prefix) => {
    const docId = docs.getActiveId();
    const line = editor.cursor()?.line;
    if (docId === null || line === undefined) return;
    // Only a line that is still blank: if the user typed or inserted anything meanwhile, it stays theirs.
    if ((editor.getLines(docId, line, line)[0] ?? '').trim() !== '') return;
    editor.insertText(prefix);
  },
};

function ensureTemplateCommand(monaco: Monaco): void {
  if (commandRegistered.has(monaco)) return;
  commandRegistered.add(monaco);
  monaco.editor.registerCommand(TEMPLATE_COMPLETION_COMMAND, (_accessor: unknown, id: unknown, prefix: unknown) => {
    if (typeof id === 'string' && TEMPLATE_ID.test(id)) void acceptTemplateCompletion(realPorts, id, typeof prefix === 'string' ? prefix : '');
  });
}

/** Registers the completion provider for one profile (Monaco language id = profile id). */
export function registerCompletion(monaco: Monaco, profileId: string): Disposable {
  ensureTemplateCommand(monaco);
  const kinds: Record<CompletionKind, MonacoApi.languages.CompletionItemKind> = {
    code: monaco.languages.CompletionItemKind.Function,
    cycle: monaco.languages.CompletionItemKind.Snippet,
    keyword: monaco.languages.CompletionItemKind.Keyword,
    template: monaco.languages.CompletionItemKind.Module,
  };
  const asSnippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const empty: MonacoApi.languages.CompletionList = { suggestions: [] };

  const registration = monaco.languages.registerCompletionItemProvider(profileId, {
    provideCompletionItems(model, position) {
      if (settings.get('assist.completion') === 'off') return empty;

      // The document's effective view (AD-31): a system-B lathe document is offered the
      // codes of the database its machine selects, not the ones its profile id names.
      const { cp, db, docId } = viewOf(model, profileId);
      const line = model.getLineContent(position.lineNumber);
      // P3.5: the document's templates (its effective database, its machine type), offered on a
      // line that is empty up to the word being typed. A model that is no document has none.
      const offered = docId === null ? [] : templates.list(docId);
      const result = completionsAt(line, position.column - 1, cp, db, {
        t,
        prev: stateBefore(model, position.lineNumber, cp),
        templates:
          docId === null || offered.length === 0
            ? undefined
            : {
                list: offered,
                snippetText: (def) => {
                  const rendered = templates.render(docId, def.id, {}, position.lineNumber);
                  return rendered.ok ? rendered.text : null;
                },
              },
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
          filterText: item.filterText,
          // A form template inserts nothing: accepting it opens its form.
          command: item.template?.form
            ? { id: TEMPLATE_COMPLETION_COMMAND, title: item.label, arguments: [item.template.id, line.slice(result.start, result.end)] }
            : undefined,
          range,
        })),
      };
    },
  });
  return () => registration.dispose();
}
