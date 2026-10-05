// The folding and document-symbol providers after their await of the outline index.
//
// `outline.whenReady` also resolves when the document closes, and Monaco has disposed its
// model by then: a provider that reads the model after the await throws "Model is
// disposed!" (m9-detect on the runner: open, close, open, close…). Monaco is a fake here.

import { describe, expect, it, vi } from 'vitest';
import type { OutlineItem } from '$lib/core/profiles/outline';

const fake = vi.hoisted(() => ({
  release: null as (() => void) | null,
  items: [] as OutlineItem[],
  folding: null as null | { provideFoldingRanges(model: unknown, context: unknown, token: unknown): Promise<unknown> },
  symbols: null as null | { provideDocumentSymbols(model: unknown, token: unknown): Promise<unknown> },
}));

vi.mock('$lib/app/outlineService', () => ({
  outline: {
    whenReady: () =>
      new Promise<void>((resolve) => {
        fake.release = resolve;
      }),
    snapshot: () => fake.items,
  },
}));

const { registerFolding } = await import('./folding');
const { registerSymbols } = await import('./symbols');

const monaco = {
  languages: {
    FoldingRangeKind: { Region: 'region' },
    SymbolKind: new Proxy({}, { get: () => 0 }),
    registerFoldingRangeProvider: (_id: string, provider: typeof fake.folding) => {
      fake.folding = provider;
      return { dispose: () => {} };
    },
    registerDocumentSymbolProvider: (_id: string, provider: typeof fake.symbols) => {
      fake.symbols = provider;
      return { dispose: () => {} };
    },
  },
} as unknown as Parameters<typeof registerFolding>[0];

function model() {
  const m = {
    disposed: false,
    uri: { scheme: 'inmemory', authority: 'doc', path: '/d1' },
    isDisposed: () => m.disposed,
    getLineCount: () => {
      if (m.disposed) throw new Error('Model is disposed!');
      return 20;
    },
    getLineMaxColumn: (line: number) => {
      if (m.disposed) throw new Error('Model is disposed!');
      return line + 1;
    },
  };
  return m;
}

const live = { isCancellationRequested: false };

describe('the outline providers after the index is ready', () => {
  fake.items = [{ kind: 'tool', line: 3, endLine: 9, text: 'T1' }];
  registerFolding(monaco, 'fanuc-gcode');
  registerSymbols(monaco, 'fanuc-gcode');

  it('fold the items of a document that is still open', async () => {
    const m = model();
    const pending = fake.folding!.provideFoldingRanges(m, {}, live);
    fake.release!();
    expect(await pending).toEqual([{ start: 3, end: 9, kind: 'region' }]);
    const symbols = fake.symbols!.provideDocumentSymbols(m, live);
    fake.release!();
    expect(await symbols).toHaveLength(1);
  });

  it('answer nothing, and read nothing, for a document that closed while they waited', async () => {
    const m = model();
    const folding = fake.folding!.provideFoldingRanges(m, {}, live);
    m.disposed = true; // the tab closes: the model goes, then `drop` resolves the wait
    fake.release!();
    await expect(folding).resolves.toEqual([]);

    const n = model();
    const symbols = fake.symbols!.provideDocumentSymbols(n, live);
    n.disposed = true;
    fake.release!();
    await expect(symbols).resolves.toEqual([]);
  });

  it('answer nothing for a request Monaco cancelled while they waited', async () => {
    const token = { isCancellationRequested: false };
    const folding = fake.folding!.provideFoldingRanges(model(), {}, token);
    token.isCancellationRequested = true;
    fake.release!();
    await expect(folding).resolves.toEqual([]);
  });
});
