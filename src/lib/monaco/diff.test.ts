// The comparison and the read-only lock (AD-23, TODO Next up 6).
//
// The modified side of the diff editor is the document's own model, and the gutter's
// revert arrows write into it through that side. Monaco is a fake here: what is checked
// is which `readOnly` the diff editor is built with and given later, not Monaco itself.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { docs } from '$lib/stores/documents';
import type { DocId } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
}));

vi.mock('$lib/monaco/setup', () => ({
  getMonaco: async () => ({
    editor: {
      createModel: () => ({ dispose: () => {} }),
      createDiffEditor: (_container: unknown, options: Record<string, unknown>) => {
        fake.created.push(options);
        return {
          setModel: () => {},
          dispose: () => {},
          updateOptions: (o: Record<string, unknown>) => fake.updates.push(o),
        };
      },
    },
  }),
}));

vi.mock('$lib/monaco/editorService', () => ({
  editor: { model: () => ({}) },
}));

const { createDiff } = await import('./diff');

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
    original: { kind: 'text', text: 'N10', languageId: 'nc' },
    inline: false,
    ignoreTrimWhitespace: false,
  });
}

afterEach(() => {
  for (const id of opened.splice(0)) docs.remove(id);
  fake.created.length = 0;
  fake.updates.length = 0;
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
