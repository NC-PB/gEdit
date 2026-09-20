// Quick outline (Mod+Shift+O) and sticky scroll, from the outline index
// (plan §5 WP3.5). Owner: WP3.5.
//
// The provider answers from `app/outlineService.ts`; it never parses the document itself,
// so opening the quick outline on a 300k-line program costs a lookup, not a parse. The
// editor options set `stickyScroll.defaultModel: 'outlineModel'` (WP2.6), so the tool
// call of the segment the cursor is in is what stays pinned at the top.

import { outline } from '$lib/app/outlineService';
import type { OutlineItem } from '$lib/core/profiles/outline';
import type { Monaco } from '$lib/monaco/setup';
import type { Disposable, DocId } from '$lib/app/types';

/** The slice of an `ITextModel` the providers read. */
export interface ModelLike {
  uri: { scheme: string; authority: string; path: string };
  getLineCount(): number;
  getLineMaxColumn(line: number): number;
}

/**
 * The document a Monaco model belongs to, or null.
 *
 * `EditorService` creates every document model as `inmemory://doc/<encoded id>`, so the
 * id is in the uri and no lookup over the open documents is needed. Models Monaco or the
 * compare view makes for themselves have another authority and answer null, which keeps
 * the providers off the diff editor's temporary models.
 *
 * @internal Shared with `folding.ts`; not a §7 contract.
 */
export function docIdOf(model: ModelLike): DocId | null {
  if (model.uri.scheme !== 'inmemory' || model.uri.authority !== 'doc') return null;
  const path = model.uri.path.replace(/^\//, '');
  if (path === '') return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/** Every item of the two-level tree, in line order. */
export function flatten(items: OutlineItem[]): OutlineItem[] {
  const flat: OutlineItem[] = [];
  for (const item of items) {
    flat.push(item);
    for (const child of item.children ?? []) flat.push(child);
  }
  return flat;
}

/** The range an item covers, clamped to the model. */
export function rangeOf(item: OutlineItem, model: ModelLike): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } {
  const lines = model.getLineCount();
  const start = Math.max(1, Math.min(item.line, lines));
  const end = Math.max(start, Math.min(item.endLine ?? item.line, lines));
  return { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: model.getLineMaxColumn(end) };
}

/** Registers the document-symbol provider for one profile (Monaco language id). */
export function registerSymbols(monaco: Monaco, profileId: string): Disposable {
  const kinds: Record<OutlineItem['kind'], number> = {
    tool: monaco.languages.SymbolKind.Method,
    program: monaco.languages.SymbolKind.Module,
    section: monaco.languages.SymbolKind.Namespace,
    comment: monaco.languages.SymbolKind.String,
    label: monaco.languages.SymbolKind.Key,
    stop: monaco.languages.SymbolKind.Event,
    end: monaco.languages.SymbolKind.Null,
    'subprogram-call': monaco.languages.SymbolKind.Function,
  };

  function symbolOf(item: OutlineItem, model: ModelLike): import('monaco-editor/esm/vs/editor/editor.api.js').languages.DocumentSymbol {
    const range = rangeOf(item, model);
    const line = Math.max(1, Math.min(item.line, model.getLineCount()));
    return {
      name: item.text !== '' ? item.text : item.kind,
      detail: '',
      kind: kinds[item.kind],
      tags: [],
      range,
      selectionRange: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: model.getLineMaxColumn(line) },
      children: item.children?.map((child) => symbolOf(child, model)),
    };
  }

  const registration = monaco.languages.registerDocumentSymbolProvider(profileId, {
    displayName: 'gEdit program map',
    async provideDocumentSymbols(model) {
      const id = docIdOf(model);
      if (id === null) return [];
      await outline.whenReady(id);
      return outline.snapshot(id).map((item) => symbolOf(item, model));
    },
  });
  return () => registration.dispose();
}
