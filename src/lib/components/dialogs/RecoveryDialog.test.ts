// The restore dialog (plan §5 WP7.4, §7.12, AD-21).
//
// The markup is rendered with `svelte/server` (no DOM), which is where the test-id
// contract of §7.12 is checked: `recovery-dialog`, `recovery-item` with `data-session`,
// `data-key` and `data-path`, and the three buttons with
// `data-action=restore|discard|later`.
//
// The test with teeth is the last one in "what the rows say": a snapshot whose file
// changed on disk has to *say so, in its own row*, before anything is restored. That is
// the difference between "your work came back" and "your colleague's revision is gone".

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import RecoveryDialog, { isWarning, restoreLabel, whereText } from './RecoveryDialog.svelte';
import { entryKey, type RestoreOutlook } from '$lib/app/recovery';
import type { DiskStamp, RecoveryEntry } from '$lib/app/types';

const STAMP: DiskStamp = { mtimeMs: 1000, size: 12, hash: 42 };

function entry(over: Partial<RecoveryEntry> = {}): RecoveryEntry {
  return {
    session: 's-1',
    key: 'd1',
    path: '/nc/prog.nc',
    title: 'prog.nc',
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'crlf',
    nul: { leader: 0, trailer: 0, stripped: 0 },
    diskStamp: STAMP,
    savedAt: 1_700_000_000_000,
    bytes: 4096,
    ...over,
  };
}

function html(entries: RecoveryEntry[], outlooks: RestoreOutlook[] = []): string {
  const outlook: Record<string, RestoreOutlook> = {};
  entries.forEach((e, i) => {
    outlook[entryKey(e)] = outlooks[i] ?? 'unchanged';
  });
  return render(RecoveryDialog, { props: { entries, outlook, close: () => {} } }).body;
}

/** The attributes of every `recovery-item` row, in order. */
function rows(markup: string): Record<string, string>[] {
  return [...markup.matchAll(/<label[^>]*data-testid="recovery-item"[^>]*>/g)].map(([tag]) =>
    Object.fromEntries(
      [...tag.matchAll(/data-([a-z]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
    ),
  );
}

describe('the frame', () => {
  it('is addressed like every other dialog, and names itself', () => {
    const markup = html([entry()]);
    expect(markup).toContain('data-testid="modal"');
    expect(markup).toContain('data-modal="recovery"');
    expect(markup).toContain('data-testid="recovery-dialog"');
  });

  it('offers exactly the three actions of the plan', () => {
    const markup = html([entry()]);
    const actions = [...markup.matchAll(/data-action="([a-z]+)"/g)].map(([, a]) => a);
    expect(actions).toEqual(['restore', 'discard', 'later']);
  });

  it('says that restoring writes nothing, before it says anything else', () => {
    const markup = html([entry()]);
    const promise = markup.indexOf('No file on disk is written');
    expect(promise).toBeGreaterThan(-1);
    expect(promise).toBeLessThan(markup.indexOf('recovery-item'));
  });
});

describe('the rows', () => {
  it('carries the session, the key and the path of each snapshot', () => {
    const markup = html([entry(), entry({ key: 'd2', path: null, title: 'Untitled-1' })], [
      'unchanged',
      'untitled',
    ]);
    expect(rows(markup)).toEqual([
      { testid: 'recovery-item', session: 's-1', key: 'd1', path: '/nc/prog.nc', outlook: 'unchanged', selected: '1' },
      { testid: 'recovery-item', session: 's-1', key: 'd2', path: '', outlook: 'untitled', selected: '1' },
    ]);
  });

  it('starts with everything ticked and offers "Restore all"', () => {
    const markup = html([entry(), entry({ key: 'd2' })]);
    expect(rows(markup).every((row) => row.selected === '1')).toBe(true);
    expect(markup).toContain('Restore all');
  });

  it('shows the file name and how much text is at stake', () => {
    const markup = html([entry()]);
    expect(markup).toContain('prog.nc');
    expect(markup).toContain('4.0 KB');
  });

  it('warns, in the row, when the file changed under the snapshot', () => {
    const markup = html([entry()], ['changed']);
    const [row] = rows(markup);
    expect(row.outlook).toBe('changed');
    // Not just a machine-readable flag: the sentence in the row names the file and says
    // what happens to it.
    expect(markup).toContain('CHANGED ON DISK');
    expect(markup).toContain('/nc/prog.nc');
    // And it is marked, so it stands out without being read.
    expect(markup).toMatch(/class="[^"]*\bwarn\b/);
  });

  it('offers a select-all only when there is something to select between', () => {
    expect(html([entry()])).not.toContain('recovery-select-all');
    expect(html([entry(), entry({ key: 'd2' })])).toContain('recovery-select-all');
  });
});

describe('what the rows say', () => {
  it('has a sentence for every outcome, and never a silent one', () => {
    const cases: [RestoreOutlook, string][] = [
      ['untitled', 'never saved'],
      ['unchanged', 'has not changed'],
      ['changed', 'CHANGED ON DISK'],
      ['missing', 'no longer there'],
      ['unknown', 'cannot tell'],
      ['unreachable', 'may not open'],
    ];
    for (const [outlook, fragment] of cases) {
      const text = whereText(entry(), outlook);
      expect(text, outlook).toContain(fragment);
      // Every sentence is a real message, not a key that fell through.
      expect(text.startsWith('recovery.'), outlook).toBe(false);
    }
  });

  // G8 M7. A snapshot whose sidecar never reached the disk is offered with Rust's
  // stand-in metadata (`recovery.rs::orphan_meta`), and `outlookOf` calls it
  // `untitled` — which would tell the user the document "was never saved to a file".
  // For a first snapshot that is usually false: it is a program that was open.
  it('says it does not know where an orphan snapshot came from', () => {
    const orphan = entry({ metaLost: true, path: null, title: '', diskStamp: null });
    const text = whereText(orphan, 'untitled');
    expect(text).toContain('could not tell which file');
    expect(text.startsWith('recovery.')).toBe(false);
    // And it is not confused with a document that really was untitled.
    expect(whereText(entry({ path: null, title: 'Untitled-2' }), 'untitled')).not.toContain(
      'could not tell',
    );
  });

  it('gives an orphan snapshot a name to click on', () => {
    const html = render(RecoveryDialog, {
      props: {
        entries: [entry({ metaLost: true, path: null, title: '', diskStamp: null })],
        outlook: { 's-1/d1': 'untitled' as RestoreOutlook },
        close: () => {},
      },
    }).body;
    expect(html).toContain('Unsaved text');
  });

  it('marks the two outcomes that mean "look before you save"', () => {
    expect(isWarning('changed')).toBe(true);
    expect(isWarning('unknown')).toBe(true);
    for (const calm of ['untitled', 'unchanged', 'missing', 'unreachable'] as RestoreOutlook[]) {
      expect(isWarning(calm), calm).toBe(false);
    }
  });

  it('names the untitled document by its title, since it has no path', () => {
    expect(whereText(entry({ path: null, title: 'Untitled-2' }), 'untitled')).not.toContain('null');
  });
});

describe('the restore button', () => {
  it('says what it will do', () => {
    expect(restoreLabel(3, 3)).toBe('Restore all');
    expect(restoreLabel(1, 3)).toContain('1 selected');
    expect(restoreLabel(0, 3)).toBe('Restore');
  });
});
