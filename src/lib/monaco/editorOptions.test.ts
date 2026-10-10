// Settings → Monaco options (plan WP2.6): the two mappings, and the subscription that
// keeps the editor and every model in step.

import { get, writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { editorOptionsFor, installEditorSettings, modelOptionsFor } from './editorOptions';
import { DEFAULTS, type Settings } from '$lib/core/settings/schema';
import type { Disposable, DocId, DocMeta, DocumentStore, EditorService } from '$lib/app/types';

function withSettings(patch: Partial<Settings>): Settings {
  return { ...DEFAULTS, ...patch };
}

describe('editorOptionsFor', () => {
  it('maps the defaults', () => {
    const options = editorOptionsFor(DEFAULTS);
    expect(options.fontSize).toBe(14);
    expect(options.fontFamily).toBe(DEFAULTS['appearance.editorFontFamily']);
    expect(options.minimap).toEqual({ enabled: false });
    expect(options.lineNumbers).toBe('on');
    expect(options.wordWrap).toBe('off');
    expect(options.renderLineHighlight).toBe('line');
    expect(options.renderWhitespace).toBe('none');
    expect(options.dragAndDrop).toBe(false);
    expect(options.emptySelectionClipboard).toBe(true);
    expect(options.rulers).toEqual([]);
    expect(options.hover).toEqual({ enabled: true });
  });

  it('asks for the outline model behind sticky scroll', () => {
    expect(editorOptionsFor(DEFAULTS).stickyScroll).toEqual({
      enabled: true,
      defaultModel: 'outlineModel',
    });
    expect(editorOptionsFor(withSettings({ 'editor.stickyScroll': false })).stickyScroll).toEqual({
      enabled: false,
      defaultModel: 'outlineModel',
    });
  });

  it('turns the booleans into the words Monaco expects', () => {
    const options = editorOptionsFor(
      withSettings({
        'editor.wordWrap': true,
        'editor.lineNumbers': false,
        'editor.highlightCurrentLine': false,
        'editor.minimap': true,
      }),
    );
    expect(options.wordWrap).toBe('on');
    expect(options.lineNumbers).toBe('off');
    expect(options.renderLineHighlight).toBe('none');
    expect(options.minimap).toEqual({ enabled: true });
  });

  it('maps assist.completion onto the three suggest options', () => {
    const auto = editorOptionsFor(withSettings({ 'assist.completion': 'auto' }));
    // Not `true`: Monaco would then also suggest inside `(…)` comments.
    expect(auto.quickSuggestions).toEqual({ other: 'on', comments: 'off', strings: 'off' });
    expect(auto.suggestOnTriggerCharacters).toBe(true);
    expect(auto.wordBasedSuggestions).toBe('currentDocument');

    const manual = editorOptionsFor(withSettings({ 'assist.completion': 'manual' }));
    expect(manual.quickSuggestions).toBe(false);
    expect(manual.suggestOnTriggerCharacters).toBe(false);
    expect(manual.wordBasedSuggestions).toBe('currentDocument');

    const off = editorOptionsFor(withSettings({ 'assist.completion': 'off' }));
    expect(off.quickSuggestions).toBe(false);
    expect(off.wordBasedSuggestions).toBe('off');
  });

  it('copies the rulers instead of handing out the settings array', () => {
    const values = withSettings({ 'editor.rulers': [80] });
    const options = editorOptionsFor(values);
    (options.rulers as number[]).push(120);
    expect(values['editor.rulers']).toEqual([80]);
  });

  it('leaves the theme to app/theme.ts', () => {
    expect('theme' in editorOptionsFor(DEFAULTS)).toBe(false);
  });
});

describe('modelOptionsFor', () => {
  it('carries the indentation settings only', () => {
    expect(modelOptionsFor(withSettings({ 'editor.tabWidth': 2, 'editor.insertSpaces': false }))).toEqual({
      tabSize: 2,
      insertSpaces: false,
    });
  });
});

// ---------------------------------------------------------------------------
// installEditorSettings
// ---------------------------------------------------------------------------

interface FakeModel {
  updateOptions: (o: Record<string, unknown>) => void;
  options: Record<string, unknown>[];
}

function fakeModel(): FakeModel {
  const options: Record<string, unknown>[] = [];
  return { options, updateOptions: (o) => options.push(o) };
}

function fakeWorld(o: { docIds?: DocId[]; ready?: Promise<void> } = {}) {
  const models = new Map<DocId, FakeModel>();
  for (const id of o.docIds ?? []) models.set(id, fakeModel());
  const editorOptions: Record<string, unknown>[] = [];
  let onCreate: ((id: DocId) => void) | undefined;

  const editor = {
    ready: o.ready ?? Promise.resolve(),
    updateOptions: (options: Record<string, unknown>) => editorOptions.push(options),
    model: (id: DocId) => models.get(id),
    onDidCreateModel: (cb: (id: DocId) => void): Disposable => {
      onCreate = cb;
      return () => {
        onCreate = undefined;
      };
    },
  } as unknown as EditorService;

  const docs = {
    all: (): DocMeta[] => [...models.keys()].map((id) => ({ id }) as DocMeta),
  } as unknown as DocumentStore;

  return {
    editor,
    docs,
    editorOptions,
    models,
    addModel(id: DocId): FakeModel {
      const model = fakeModel();
      models.set(id, model);
      onCreate?.(id);
      return model;
    },
  };
}

describe('installEditorSettings', () => {
  it('applies the current settings at once, to the editor and to every model', () => {
    const values = writable<Settings>(withSettings({ 'editor.tabWidth': 2 }));
    const world = fakeWorld({ docIds: ['a', 'b'] });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });

    expect(world.editorOptions).toHaveLength(1);
    expect(world.editorOptions[0]?.fontSize).toBe(14);
    expect(world.models.get('a')?.options).toEqual([{ tabSize: 2, insertSpaces: true }]);
    expect(world.models.get('b')?.options).toEqual([{ tabSize: 2, insertSpaces: true }]);
    stop();
  });

  it('follows a change while the app runs', () => {
    const values = writable<Settings>(DEFAULTS);
    const world = fakeWorld({ docIds: ['a'] });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });

    values.set(withSettings({ 'appearance.editorFontSize': 18, 'editor.tabWidth': 8 }));
    expect(world.editorOptions.at(-1)?.fontSize).toBe(18);
    expect(world.models.get('a')?.options.at(-1)).toEqual({ tabSize: 8, insertSpaces: true });
    stop();
  });

  it('gives a model created later the same options', () => {
    const values = writable<Settings>(withSettings({ 'editor.insertSpaces': false }));
    const world = fakeWorld();
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });

    const model = world.addModel('late');
    expect(model.options).toEqual([{ tabSize: 4, insertSpaces: false }]);
    stop();
  });

  it('applies the settings again once the editor has attached', async () => {
    let attach: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      attach = resolve;
    });
    const values = writable<Settings>(DEFAULTS);
    const world = fakeWorld({ docIds: ['a'], ready });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });

    expect(world.editorOptions).toHaveLength(1);
    attach();
    await ready;
    await Promise.resolve();
    expect(world.editorOptions).toHaveLength(2);
    stop();
  });

  it('stops listening when it is disposed, twice is harmless', () => {
    const values = writable<Settings>(DEFAULTS);
    const world = fakeWorld({ docIds: ['a'] });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });
    stop();
    stop();

    values.set(withSettings({ 'appearance.editorFontSize': 20 }));
    expect(world.editorOptions).toHaveLength(1);
    expect(get(values)['appearance.editorFontSize']).toBe(20);
  });

  it('handles a rejected ready promise instead of leaving it unhandled', async () => {
    const values = writable<Settings>(DEFAULTS);
    // `editor.ready` is contracted never to reject; this is the guard that a change to
    // that contract cannot turn into the unhandled rejection the harness fails on.
    const ready = Promise.reject(new Error('monaco could not be loaded'));
    const world = fakeWorld({ docIds: ['a'], ready });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });
    await ready.catch(() => {});
    await Promise.resolve();
    expect(world.editorOptions).toHaveLength(1);
    stop();
  });
});
