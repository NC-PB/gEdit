// The encoding picker's one destructive case (G8 M5).
//
// Changing the encoding of an ordinary file is reversible: pick the wrong one, pick again,
// nothing has been written. Changing it to UTF-16 on a program that came off a DNC line
// with a NUL leader is not. `encodeFile` leaves the leader out — a UTF-16 file has to
// begin with its byte order mark — and the save then clears the document's `nul` record,
// so switching back afterwards cannot bring it back. Until this test the only notice was a
// four-second, non-error status line *after* the bytes were on disk.
//
// `fileFeatures.test.ts` covers what this contribution declares; this file covers what
// `pickEncoding` does.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import encoding from './encoding';
import { t } from '$lib/i18n';
import type { CommandDef, DocMeta, FileEncoding } from '$lib/app/types';

const UTF8: FileEncoding = { encoding: 'utf-8', hasBom: false };
const UTF16: FileEncoding = { encoding: 'utf-16le', hasBom: true };
const CP1252: FileEncoding = { encoding: 'windows-1252', hasBom: false };

const fake = vi.hoisted(() => ({
  doc: null as unknown,
  picked: null as unknown,
  confirms: [] as { title: string; message: string }[],
  confirmAnswer: true,
  applied: [] as unknown[],
  messages: [] as string[],
}));

vi.mock('$lib/app/modals', () => ({
  modals: { quickPick: () => Promise.resolve(fake.picked) },
}));

vi.mock('$lib/app/dialogs', () => ({
  dialogs: {
    confirm: (request: { title: string; message: string }) => {
      fake.confirms.push({ title: request.title, message: request.message });
      return Promise.resolve(fake.confirmAnswer);
    },
  },
}));

vi.mock('$lib/app/fileOps', () => ({
  files: {
    setEncoding: (_id: string, e: FileEncoding) => fake.applied.push(e),
    setEol: () => {},
  },
  EOL_LABELS: { crlf: 'CRLF', lf: 'LF', cr: 'CR' },
}));

vi.mock('$lib/app/status', () => ({
  status: { show: (text: string) => fake.messages.push(text), clear: () => {} },
}));

vi.mock('$lib/stores/documents', () => ({
  docs: {
    getActiveId: () => (fake.doc as DocMeta | null)?.id ?? null,
    get: () => fake.doc as DocMeta | undefined,
  },
}));

const setEncoding = (encoding.commands ?? []).find(
  (def) => def.id === 'file.setEncoding',
) as CommandDef;

/** A document with the metadata `pickEncoding` reads, and nothing else. */
function doc(o: { encoding?: FileEncoding; leader?: number; trailer?: number } = {}): DocMeta {
  return {
    id: 'd1',
    title: 'tape.nc',
    encoding: o.encoding ?? UTF8,
    nul: { leader: o.leader ?? 0, trailer: o.trailer ?? 0, stripped: 0 },
  } as unknown as DocMeta;
}

const run = (): Promise<void> => setEncoding.run({ activeDocId: 'd1' } as never) as Promise<void>;

beforeEach(() => {
  fake.doc = doc();
  fake.picked = null;
  fake.confirms = [];
  fake.confirmAnswer = true;
  fake.applied = [];
  fake.messages = [];
});

describe('the encoding picker', () => {
  it('applies an ordinary change without asking anything', async () => {
    fake.picked = CP1252;
    await run();
    expect(fake.confirms).toEqual([]);
    expect(fake.applied).toEqual([CP1252]);
    expect(fake.messages).toHaveLength(1);
  });

  it('changes nothing when the picker is dismissed', async () => {
    fake.picked = null;
    await run();
    expect(fake.applied).toEqual([]);
    expect(fake.messages).toEqual([]);
  });

  it('changes nothing when the encoding picked is the one already set', async () => {
    fake.picked = UTF8;
    await run();
    expect(fake.applied).toEqual([]);
  });
});

describe('a punched-tape program picked as UTF-16', () => {
  it('asks first, and names the leader and the trailer that will go', async () => {
    fake.doc = doc({ leader: 32, trailer: 16 });
    fake.picked = UTF16;
    await run();

    expect(fake.confirms).toHaveLength(1);
    expect(fake.confirms[0].title).toBe(t('encoding.tapeTitle'));
    expect(fake.confirms[0].message).toContain('32');
    expect(fake.confirms[0].message).toContain('16');
    expect(fake.applied).toEqual([UTF16]);
  });

  it('leaves the document alone when the answer is no', async () => {
    fake.doc = doc({ leader: 32, trailer: 16 });
    fake.picked = UTF16;
    fake.confirmAnswer = false;
    await run();

    expect(fake.confirms).toHaveLength(1);
    expect(fake.applied).toEqual([]);
    expect(fake.messages).toEqual([]);
  });

  it('asks for a trailer on its own, not only for a leader', async () => {
    fake.doc = doc({ leader: 0, trailer: 16 });
    fake.picked = UTF16;
    await run();
    expect(fake.confirms).toHaveLength(1);
  });

  it('does not ask for a file that has no tape framing to lose', async () => {
    fake.picked = UTF16;
    await run();
    expect(fake.confirms).toEqual([]);
    expect(fake.applied).toEqual([UTF16]);
  });

  it('does not ask for an encoding that can carry the leader', async () => {
    fake.doc = doc({ leader: 32, trailer: 16 });
    fake.picked = CP1252;
    await run();
    expect(fake.confirms).toEqual([]);
    expect(fake.applied).toEqual([CP1252]);
  });
});
