// What the read-only contribution declares and what its command does (plan §5 WP7.3,
// §7.12, §7.13, AD-23).
//
// `file.toggleReadOnly` is a contract: §7.13 gives it no default shortcut, and the
// runtime scenarios call it by name. The document store is the real one, so the toggle
// really goes through `DocMeta`.
//
// The status item is rendered with `svelte/server`: no DOM, no `$effect`, and what a
// scenario reads (`data-item="readonly"`, `data-reason`) is in the markup.

import { render } from 'svelte/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentStore } from '$lib/stores/documents';
import { hasKey, t } from '$lib/i18n';
import type { DocId, DocumentStore, NewDocMeta } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  setReadOnly: vi.fn((): void => {}),
  shown: [] as string[],
  /** Filled in `beforeEach` with the real store, so the components read one source. */
  docs: null as unknown,
}));

vi.mock('$lib/app/fileOps', () => ({
  files: {
    setReadOnly: (...args: unknown[]) => fake.setReadOnly(...(args as [])),
  },
}));

vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string) => fake.shown.push(text),
  },
}));

vi.mock('$lib/stores/documents', async () => {
  const real = await vi.importActual<typeof import('$lib/stores/documents')>('$lib/stores/documents');
  return {
    ...real,
    docs: new Proxy(
      {},
      {
        get: (_target, key: string) => (fake.docs as Record<string, unknown>)[key],
      },
    ),
  };
});

vi.mock('$lib/app/registry/commands', () => ({
  commands: { run: vi.fn(async (): Promise<void> => {}) },
}));

const { default: contrib } = await import('./readOnly');
const { default: ReadOnlyStatus } = await import('$lib/components/status/ReadOnlyStatus.svelte');

let docs: DocumentStore;

function meta(patch: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
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
  };
}

function addDoc(patch: Partial<NewDocMeta> = {}): DocId {
  return docs.add(meta(patch));
}

beforeEach(() => {
  docs = createDocumentStore({ caseInsensitivePaths: false });
  fake.docs = docs;
  fake.setReadOnly.mockClear();
  fake.shown.length = 0;
});

describe('what it declares', () => {
  it('registers §7.13’s command and claims no shortcut', () => {
    expect(contrib.commands.map((c) => c.id)).toEqual(['file.toggleReadOnly']);
    expect(contrib.commands[0]).not.toHaveProperty('keys');
    expect(contrib.commands[0].global).toBe(true);
  });

  it('has an id that matches its file name, and every title has a message', () => {
    expect(contrib.id).toBe('readOnly');
    const keys = contrib.commands.flatMap((c) => [c.title, c.category]);
    expect(keys.filter((key): key is string => typeof key === 'string').filter((key) => !hasKey(key))).toEqual([]);
  });

  it('puts the lock at the end of the status row', () => {
    // It comes and goes, and an item that comes and goes in the middle of the row would
    // shift the ones beside it.
    expect(contrib.statusItems.map((item) => `${item.id}:${item.side}:${item.order}`)).toEqual([
      'readonly:right:60',
    ]);
  });

  it('offers the command only while a document is open', () => {
    const toggle = contrib.commands[0];
    expect(toggle.enabled?.({ activeDocId: null } as never)).toBe(false);
    expect(toggle.enabled?.({ activeDocId: 'd1' } as never)).toBe(true);
  });
});

describe('file.toggleReadOnly', () => {
  it('locks the active document and says so', () => {
    const id = addDoc();
    contrib.commands[0].run({ activeDocId: id } as never, undefined);
    expect(fake.setReadOnly).toHaveBeenCalledWith(id, true);
    expect(fake.shown).toEqual([t('readOnly.locked', { name: 'welle.nc' })]);
  });

  it('unlocks a locked document and says so', () => {
    const id = addDoc({ readOnly: true, readOnlyReason: 'attribute' });
    contrib.commands[0].run({ activeDocId: id } as never, undefined);
    expect(fake.setReadOnly).toHaveBeenCalledWith(id, false);
    expect(fake.shown).toEqual([t('readOnly.unlocked', { name: 'welle.nc' })]);
  });

  it('takes the document from the argument when the tab bar passes one', () => {
    const first = addDoc();
    const second = addDoc({ path: '/nc/flansch.nc' });
    docs.activate(second);
    contrib.commands[0].run({ activeDocId: second } as never, first);
    expect(fake.setReadOnly).toHaveBeenCalledWith(first, true);
  });

  it('does nothing without a document', () => {
    contrib.commands[0].run({ activeDocId: null } as never, undefined);
    expect(fake.setReadOnly).not.toHaveBeenCalled();
    expect(fake.shown).toEqual([]);
  });
});

describe('the status item', () => {
  it('is not rendered while the document can be edited', () => {
    addDoc();
    expect(render(ReadOnlyStatus).body).not.toContain('data-item="readonly"');
  });

  it.each([
    ['attribute' as const, 'itemAttribute'],
    ['user' as const, 'itemUser'],
  ])('names the %s lock in its tooltip', (reason, key) => {
    addDoc({ readOnly: true, readOnlyReason: reason });
    const body = render(ReadOnlyStatus).body;
    expect(body).toContain('data-item="readonly"');
    expect(body).toContain(`data-reason="${reason}"`);
    // The two locks are not the same thing: only one of them is about the file.
    expect(body).toContain(t(`readOnly.${key}`, { name: 'welle.nc' }).slice(0, 40));
  });
});
