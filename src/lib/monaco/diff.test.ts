// The comparison, the read-only lock (AD-23, TODO Next up 6) and the scratch models
// (M11: reused, never disposed, which is what closes the compare race by ordering).
//
// The modified side of the diff editor is the document's own model, and the gutter's
// revert arrows write into it through that side. Monaco is a fake here: what is checked
// is which `readOnly` the diff editor is built with and given later, not Monaco itself.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { docs } from '$lib/stores/documents';
import type { DocId } from '$lib/app/types';
import type { DiffSides } from './diff';

interface FakeModel {
  text: string;
  language: string;
  disposed: boolean;
  isDisposed(): boolean;
  getLanguageId(): string;
  setValue(text: string): void;
  dispose(): void;
}

const fake = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  models: [] as FakeModel[],
  /** What each diff editor was last given. */
  shown: [] as unknown[],
  /** The listeners of the last diff editor: `content` (either pane's text), `model`, `diff` (updated). */
  listeners: { content: [] as (() => void)[], model: [] as (() => void)[], diff: [] as (() => void)[] },
  /** Document ids that have no model. */
  noModel: new Set<string>(),
  /** What the diff editor shows right now, and the models that were shown while `setValue` filled them. */
  current: null as { original: unknown; modified: unknown } | null,
  filledWhileShown: [] as FakeModel[],
  /**
   * Every diff view model, as Monaco 0.55 handles them: one it builds itself from a pair
   * given to `setModel` is disposed in a `setTimeout(0)` after it is replaced; one made
   * with `createViewModel` only when its owner disposes it. While a view model is not
   * disposed, a diff it asked for may still arrive and be laid over its models' text.
   */
  viewModels: [] as { model: { original: unknown; modified: unknown }; disposed: boolean; dispose(): void }[],
  /** Models whose text changed while a live view model held them. */
  filledWhileComputing: [] as FakeModel[],
}));

interface FakeViewModel {
  model: { original: unknown; modified: unknown };
  disposed: boolean;
  dispose(): void;
}

function viewModel(pair: { original: unknown; modified: unknown }): FakeViewModel {
  const vm: FakeViewModel = {
    model: pair,
    disposed: false,
    dispose: () => {
      vm.disposed = true;
    },
  };
  fake.viewModels.push(vm);
  return vm;
}

function listen(list: (() => void)[], fn: () => void): { dispose(): void } {
  list.push(fn);
  return { dispose: () => void list.splice(list.indexOf(fn), 1) };
}

vi.mock('$lib/monaco/setup', () => ({
  getMonaco: async () => ({
    editor: {
      createModel: (text: string, language: string) => {
        const model: FakeModel = {
          text,
          language,
          disposed: false,
          isDisposed: () => model.disposed,
          getLanguageId: () => model.language,
          setValue: (value: string) => {
            if (fake.current && (fake.current.original === model || fake.current.modified === model)) {
              fake.filledWhileShown.push(model);
            }
            if (fake.viewModels.some((vm) => !vm.disposed && (vm.model.original === model || vm.model.modified === model))) {
              fake.filledWhileComputing.push(model);
            }
            model.text = value;
          },
          dispose: () => {
            model.disposed = true;
          },
        };
        fake.models.push(model);
        return model;
      },
      setModelLanguage: (model: FakeModel, language: string) => {
        model.language = language;
      },
      createDiffEditor: (_container: unknown, options: Record<string, unknown>) => {
        fake.created.push(options);
        let current: FakeViewModel | null = null;
        let mine = false;
        fake.listeners.content.length = 0;
        fake.listeners.model.length = 0;
        fake.listeners.diff.length = 0;
        const editorStub = {
          onDidFocusEditorText: () => ({ dispose: () => {} }),
          onDidChangeModelContent: (fn: () => void) => listen(fake.listeners.content, fn),
          onDidChangeModel: (fn: () => void) => listen(fake.listeners.model, fn),
        };
        return {
          createViewModel: (pair: { original: unknown; modified: unknown }) => viewModel(pair),
          setModel: (given: FakeViewModel | { original: unknown; modified: unknown } | null) => {
            const previous = current;
            const previousMine = mine;
            mine = given !== null && !('model' in given);
            current = given === null ? null : 'model' in given ? (given as FakeViewModel) : viewModel(given);
            // Monaco's DiffEditorWidget.setDiffModel: the old reference is let go of a tick later.
            if (previous && previousMine) setTimeout(() => previous.dispose(), 0);
            fake.current = current?.model ?? null;
            fake.shown.push(fake.current);
          },
          getModel: () => current?.model ?? null,
          onDidUpdateDiff: (fn: () => void) => listen(fake.listeners.diff, fn),
          getOriginalEditor: () => editorStub,
          getModifiedEditor: () => editorStub,
          dispose: () => {},
          updateOptions: (o: Record<string, unknown>) => fake.updates.push(o),
        };
      },
    },
  }),
}));

vi.mock('$lib/monaco/editorService', () => ({
  editor: { model: (id: string) => (fake.noModel.has(id) ? undefined : {}) },
}));

const { createDiff, settleCreated } = await import('./diff');

const opened: DocId[] = [];

function open(readOnly: boolean): DocId {
  const id = docs.add({
    path: null,
    untitledIndex: 80 + opened.length,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly,
    readOnlyReason: readOnly ? 'user' : null,
  });
  opened.push(id);
  return id;
}

function compare(id: DocId) {
  return createDiff({
    container: {} as HTMLElement,
    modifiedDocId: id,
    sides: sides(id),
    inline: false,
    ignoreTrimWhitespace: false,
  });
}

function sides(id: DocId, text = 'N10'): DiffSides {
  return { original: { kind: 'text', text, languageId: 'nc' }, modified: { kind: 'document', docId: id } };
}

afterEach(() => {
  for (const id of opened.splice(0)) docs.remove(id);
  fake.created.length = 0;
  fake.updates.length = 0;
  fake.shown.length = 0;
  fake.noModel.clear();
  fake.filledWhileShown.length = 0;
  fake.filledWhileComputing.length = 0;
  fake.viewModels.length = 0;
  fake.current = null;
});

describe('createDiff and the read-only lock', () => {
  it('leaves an editable document editable', async () => {
    (await compare(open(false))).dispose();
    expect(fake.created[0]).toMatchObject({ readOnly: false, originalEditable: false });
  });

  it('locks the modified side of a locked document, revert arrows included', async () => {
    (await compare(open(true))).dispose();
    expect(fake.created[0]).toMatchObject({ readOnly: true });
  });

  it('follows the lock while the comparison is open, and stops when it closes', async () => {
    const id = open(false);
    const handle = await compare(id);
    docs.update(id, { readOnly: true, readOnlyReason: 'user' });
    docs.update(id, { readOnly: false, readOnlyReason: null });
    expect(fake.updates).toEqual([{ readOnly: true }, { readOnly: false }]);
    handle.dispose();
    docs.update(id, { readOnly: true, readOnlyReason: 'user' });
    expect(fake.updates).toHaveLength(2);
  });
});

describe('the scratch models', () => {
  it('creates one model for a text side and never disposes it', async () => {
    const id = open(false);
    const first = await compare(id);
    expect(fake.models).toHaveLength(1);
    expect(fake.models[0].text).toBe('N10');
    first.dispose();
    // Blanked, so a 50 MB file does not outlive its comparison; not disposed, so the
    // editor worker is never asked about a model that has gone.
    expect(fake.models[0]).toMatchObject({ text: '', disposed: false });
    (await compare(id)).dispose();
    expect(fake.models).toHaveLength(1);
    expect(fake.models.every((model) => !model.disposed)).toBe(true);
  });

  it('keeps one model per pane however many comparisons come and go', async () => {
    const id = open(false);
    for (let i = 0; i < 5; i++) {
      const handle = await createDiff({
        container: {} as HTMLElement,
        modifiedDocId: id,
        sides: { original: { kind: 'text', text: `A${i}`, languageId: 'nc' }, modified: { kind: 'text', text: `B${i}`, languageId: 'nc' } },
        inline: false,
        ignoreTrimWhitespace: false,
      });
      handle.dispose();
    }
    expect(fake.models).toHaveLength(2);
  });

  it('does not blank what a newer comparison shows when an older handle is disposed late', async () => {
    const id = open(false);
    const older = await compare(id);
    const newer = await createDiff({
      container: {} as HTMLElement,
      modifiedDocId: id,
      sides: sides(id, 'NEWER'),
      inline: false,
      ignoreTrimWhitespace: false,
    });
    older.dispose();
    expect(fake.models[0].text).toBe('NEWER');
    newer.dispose();
    expect(fake.models[0].text).toBe('');
  });

  it('puts new text into the same model with show() and locks a normalized modified side', async () => {
    const id = open(false);
    const handle = await compare(id);
    expect(fake.created[0]).toMatchObject({ readOnly: false });
    handle.show({
      original: { kind: 'text', text: 'G1', languageId: 'nc' },
      modified: { kind: 'text', text: 'G2', languageId: 'nc' },
    });
    expect(fake.models).toHaveLength(2);
    expect(fake.models.map((model) => model.text).sort()).toEqual(['G1', 'G2']);
    expect(fake.updates).toEqual([{ readOnly: true }]);
    handle.show(sides(id, 'RAW'));
    expect(fake.updates).toEqual([{ readOnly: true }, { readOnly: false }]);
    handle.dispose();
  });

  it('never fills a scratch model while the diff editor shows it (Illegal value for lineNumber)', async () => {
    const id = open(false);
    const handle = await compare(id);
    handle.show({
      original: { kind: 'text', text: 'G1', languageId: 'nc' },
      modified: { kind: 'text', text: 'G2', languageId: 'nc' },
    });
    handle.show({
      original: { kind: 'text', text: 'G1 X1', languageId: 'nc' },
      modified: { kind: 'text', text: 'G2 X1', languageId: 'nc' },
    });
    handle.show(sides(id, 'RAW'));
    expect(fake.filledWhileShown).toEqual([]);
    expect(fake.models).toHaveLength(2);
    expect(fake.models.every((model) => !model.disposed)).toBe(true);
    handle.dispose();
  });

  it('never changes a scratch model while a diff view model that holds it lives (the compare race)', async () => {
    // Monaco's worker diffs the text as it is when the request is posted, after a `$ping`,
    // and the view model then applies the edits it saw on top: a text change while its
    // view model lives lays an old diff over new text ("startLineNumber 5 cannot be after
    // endLineNumberExclusive 2"). Monaco disposes a view model it built itself a tick too
    // late, so the module builds and disposes them.
    const id = open(false);
    const handle = await compare(id);
    handle.show({
      original: { kind: 'text', text: 'G1', languageId: 'nc' },
      modified: { kind: 'text', text: 'G2', languageId: 'nc' },
    });
    handle.show(sides(id, 'RAW'));
    handle.dispose(); // closed before its first diff: the blank-on-close
    expect(fake.filledWhileComputing).toEqual([]);
    expect(fake.viewModels.length).toBeGreaterThan(0);
    expect(fake.viewModels.every((vm) => vm.disposed)).toBe(true);
    expect(fake.models).toHaveLength(2);
  });

  it('detaches an older comparison before a newer one refills the model it still shows', async () => {
    const id = open(false);
    const older = await compare(id);
    const newer = await createDiff({
      container: {} as HTMLElement,
      modifiedDocId: id,
      sides: sides(id, 'NEWER'),
      inline: false,
      ignoreTrimWhitespace: false,
    });
    expect(fake.filledWhileComputing).toEqual([]);
    older.dispose();
    newer.dispose();
    expect(fake.filledWhileComputing).toEqual([]);
    expect(fake.viewModels.every((vm) => vm.disposed)).toBe(true);
  });

  it('ignores a show() of the sides it already shows', async () => {
    const id = open(false);
    const given = sides(id);
    const handle = await createDiff({ container: {} as HTMLElement, modifiedDocId: id, sides: given, inline: false, ignoreTrimWhitespace: false });
    const before = fake.shown.length;
    handle.show(given);
    expect(fake.shown).toHaveLength(before);
    handle.dispose();
  });
});

describe('isCurrent (CODE-1)', () => {
  it('is false until the first diff, true after an update, false again after an edit of either pane', async () => {
    const handle = await compare(open(false));
    expect(handle.isCurrent()).toBe(false);
    fake.listeners.diff.forEach((fn) => fn());
    expect(handle.isCurrent()).toBe(true);
    // The merge's own edit: the old blocks are stale from this moment, not 200 ms later.
    fake.listeners.content.forEach((fn) => fn());
    expect(handle.isCurrent()).toBe(false);
    fake.listeners.diff.forEach((fn) => fn());
    expect(handle.isCurrent()).toBe(true);
    fake.listeners.model.forEach((fn) => fn());
    expect(handle.isCurrent()).toBe(false);
    handle.dispose();
    expect(handle.isCurrent()).toBe(false);
  });

  it('lets go of its listeners when it is disposed', async () => {
    const handle = await compare(open(false));
    handle.dispose();
    expect(fake.listeners.content).toHaveLength(0);
    expect(fake.listeners.diff).toHaveLength(0);
  });
});

describe('show() that cannot work (CODE-12)', () => {
  it('changes nothing when a document has no model, so the same call can be retried', async () => {
    const id = open(false);
    const other = open(false);
    const handle = await compare(id);
    const before = fake.models.map((m) => m.text);
    fake.noModel.add(other);
    const next: DiffSides = {
      original: { kind: 'text', text: 'SCRATCH', languageId: 'nc' },
      modified: { kind: 'document', docId: other },
    };
    expect(() => handle.show(next)).toThrow(/no model/);
    expect(fake.models.map((m) => m.text)).toEqual(before);
    fake.noModel.clear();
    handle.show(next); // not swallowed as "already shown"
    expect(fake.models.find((m) => m.text === 'SCRATCH')).toBeDefined();
    handle.dispose();
  });

  it('blanks the scratch text of a side that is a document again', async () => {
    const id = open(false);
    const handle = await compare(id);
    handle.show({
      original: { kind: 'text', text: 'REVIEW-A', languageId: 'nc' },
      modified: { kind: 'text', text: 'REVIEW-B', languageId: 'nc' },
    });
    expect(fake.models.map((m) => m.text).sort()).toEqual(['REVIEW-A', 'REVIEW-B']);
    handle.show({ original: { kind: 'text', text: 'RAW', languageId: 'nc' }, modified: { kind: 'document', docId: id } });
    expect(fake.models.map((m) => m.text).sort()).toEqual(['', 'RAW']);
    handle.dispose();
  });
});

describe('settleCreated (CODE-11)', () => {
  it('applies the toggles that were pressed while the editor was being built', () => {
    const calls: string[] = [];
    settleCreated(
      {
        show: () => calls.push('show'),
        setInline: (v) => calls.push(`inline:${v}`),
        setIgnoreTrimWhitespace: (v) => calls.push(`trim:${v}`),
      },
      { sides: null, inline: true, ignoreTrimWhitespace: true },
    );
    expect(calls).toEqual(['inline:true', 'trim:true']);
  });
});
