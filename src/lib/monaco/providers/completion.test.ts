// The completion provider's form-template item (P3.5; P3b code review CODE-15). Accepting such an
// item deletes the word that was typed (the item inserts nothing) and opens the form; a form that
// does not insert anything must give the word back. Monaco, the template service and the editor
// are fakes; the completion list itself is the real one.

import { describe, expect, it, vi } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { cpOf } from '../../../../tests/unit/helpers/profiles';

const cp = cpOf('fanuc-gcode');
const db = loadCodeDb(resolveCodeDbFiles(BUILTIN_CODE_DB_JSON)['fanuc']);

const fake = vi.hoisted(() => ({
  inserted: [] as string[],
  insertAnswer: false,
  runs: [] as string[],
  line: '',
  cursorLine: 1 as number | null,
}));

vi.mock('$lib/app/templateService', () => ({
  templates: {
    list: () => [{ id: 'peck-drill', label: 'Peck drilling (G83)', group: 'Drilling', body: '{{N}}G83 {{z}}', params: [{ id: 'z', label: 'Depth', type: 'number' }] }],
    render: () => ({ ok: false, errors: {} }),
    insert: async (id: string) => {
      fake.runs.push(id);
      return fake.insertAnswer;
    },
  },
}));
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    cursor: () => (fake.cursorLine === null ? null : { line: fake.cursorLine }),
    getLines: () => [fake.line],
    insertText: (text: string) => fake.inserted.push(text),
  },
}));
vi.mock('$lib/stores/documents', () => ({ docs: { getActiveId: () => 'd1' } }));
vi.mock('$lib/stores/settings', () => ({ settings: { get: () => 'auto' } }));
vi.mock('./hover', () => ({ viewOf: () => ({ cp, db, docId: 'd1' }), stateBefore: () => undefined }));

const { acceptTemplateCompletion, registerCompletion, TEMPLATE_COMPLETION_COMMAND } = await import('./completion');

function setup() {
  let command: ((accessor: unknown, ...args: unknown[]) => void) | null = null;
  let provider: { provideCompletionItems(model: unknown, position: unknown): { suggestions: { label: string; command?: { id: string; arguments: unknown[] }; insertText: string }[] } } | null = null;
  const monaco = {
    editor: { registerCommand: (_id: string, fn: typeof command) => (command = fn) },
    languages: {
      CompletionItemKind: new Proxy({}, { get: () => 0 }),
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: (_id: string, p: typeof provider) => {
        provider = p;
        return { dispose: () => {} };
      },
    },
  } as unknown as Parameters<typeof registerCompletion>[0];
  registerCompletion(monaco, 'fanuc-gcode');
  return { command: () => command!, provider: () => provider! };
}

describe('accepting a form template (CODE-15)', () => {
  it('hands the typed word to the command with the template id', () => {
    const h = setup();
    const result = h.provider().provideCompletionItems({ getLineContent: () => 'pec' }, { lineNumber: 1, column: 4 });
    const item = result.suggestions.find((s) => s.label === 'Peck drilling (G83)');
    expect(item?.insertText).toBe('');
    expect(item?.command).toMatchObject({ id: TEMPLATE_COMPLETION_COMMAND, arguments: ['peck-drill', 'pec'] });
  });

  it('puts the typed word back when the form is cancelled and the line is still blank', async () => {
    fake.inserted.length = 0;
    fake.runs.length = 0;
    fake.insertAnswer = false;
    fake.line = '';
    fake.cursorLine = 1;
    const h = setup();
    h.command()({}, 'peck-drill', 'pec');
    await vi.waitFor(() => expect(fake.inserted).toEqual(['pec']));
    expect(fake.runs).toEqual(['peck-drill']);
  });

  it('leaves the line alone when the form inserted something, when the line is no longer blank, or when no word was typed', async () => {
    const h = setup();
    fake.runs.length = 0;
    fake.inserted.length = 0;
    fake.insertAnswer = true;
    fake.line = 'N10 G83 Z-5.';
    h.command()({}, 'peck-drill', 'pec');
    await vi.waitFor(() => expect(fake.runs).toHaveLength(1));
    fake.insertAnswer = false;
    h.command()({}, 'peck-drill', 'pec');
    await vi.waitFor(() => expect(fake.runs).toHaveLength(2));
    fake.line = '';
    h.command()({}, 'peck-drill', '');
    await vi.waitFor(() => expect(fake.runs).toHaveLength(3));
    // A command with an id that is no template id does nothing at all.
    h.command()({}, '../x', 'pec');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.runs).toHaveLength(3);
    expect(fake.inserted).toEqual([]);
  });

  it('acceptTemplateCompletion restores only when nothing was inserted', async () => {
    const restored: string[] = [];
    await acceptTemplateCompletion({ insert: async () => false, restorePrefix: (p) => restored.push(p) }, 'x', 'ab');
    await acceptTemplateCompletion({ insert: async () => true, restorePrefix: (p) => restored.push(p) }, 'x', 'cd');
    expect(restored).toEqual(['ab']);
  });
});
