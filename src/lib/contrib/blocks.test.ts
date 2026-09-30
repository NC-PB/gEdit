// The Insert tab's blocks on a locked document (AD-23, TODO Next up 6).
//
// Monaco's `readOnly` already refuses `executeEdits`, but silently; what is checked here
// is that the command says why nothing happened and never reaches the editor.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentStore } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { DocId, DocumentStore, NewDocMeta } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  inserted: [] as string[],
  shown: [] as { text: string; error: boolean }[],
  /** Filled in `beforeEach` with a real store. */
  docs: null as unknown,
}));

vi.mock('$lib/monaco/editorService', () => ({
  editor: { insertText: (text: string) => fake.inserted.push(text) },
}));

vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string, o?: { error?: boolean }) => fake.shown.push({ text, error: o?.error === true }),
  },
}));

vi.mock('$lib/stores/documents', async () => {
  const real = await vi.importActual<typeof import('$lib/stores/documents')>('$lib/stores/documents');
  return {
    ...real,
    docs: new Proxy({}, { get: (_target, key: string) => (fake.docs as Record<string, unknown>)[key] }),
  };
});

const { default: contrib } = await import('./blocks');
const { blockFor } = await import('$lib/utils/insertBlock');

let docs: DocumentStore;

function open(patch: Partial<NewDocMeta> = {}): DocId {
  return docs.add({
    path: '/nc/welle.nc',
    untitledIndex: null,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'crlf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
    ...patch,
  });
}

function runStart(): void {
  const command = contrib.commands.find((c) => c.id === 'insert.block:start');
  if (!command) throw new Error('no insert.block:start');
  void command.run({} as never);
}

beforeEach(() => {
  docs = createDocumentStore({ caseInsensitivePaths: false });
  fake.docs = docs;
  fake.inserted.length = 0;
  fake.shown.length = 0;
});

describe('insert.block on a locked document', () => {
  it('inserts into an editable document', () => {
    open();
    runStart();
    expect(fake.inserted).toEqual([blockFor('fanuc-gcode', 'start')!.TextBlock]);
    expect(fake.shown).toEqual([]);
  });

  it('refuses a locked one and says how to unlock it', () => {
    const id = open({ readOnly: true, readOnlyReason: 'user' });
    runStart();
    expect(fake.inserted).toEqual([]);
    const action = t('readOnly.insertBlock', { block: blockFor('fanuc-gcode', 'start')!.Text });
    expect(fake.shown).toEqual([
      { text: t('readOnly.refusedUser', { name: docs.get(id)!.title, action }), error: true },
    ]);
  });
});
