// The document store (plan §7.2): tab order, the active document and the derived
// fields. The platform rule for `byPath` is injected, so these run the same everywhere.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentStore, pathKey } from './documents';
import type { DocMeta, DocumentStore, NewDocMeta } from '$lib/app/types';

function meta(patch: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
    path: null,
    untitledIndex: 1,
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

function file(path: string, patch: Partial<NewDocMeta> = {}): NewDocMeta {
  return meta({ path, untitledIndex: null, ...patch });
}

let docs: DocumentStore;

beforeEach(() => {
  docs = createDocumentStore({ caseInsensitivePaths: false });
});

describe('adding documents', () => {
  it('hands out ids in order and never reuses one', () => {
    const first = docs.add(meta());
    const second = docs.add(meta({ untitledIndex: 2 }));
    docs.remove(first);
    const third = docs.add(meta({ untitledIndex: 3 }));
    expect([first, second, third]).toEqual(['d1', 'd2', 'd3']);
  });

  it('derives the title from the path or the untitled index', () => {
    docs.add(file('/nc/parts/O1234.nc'));
    docs.add(file('C:\\nc\\part.h'));
    docs.add(meta({ untitledIndex: 7 }));
    expect(docs.all().map((d) => d.title)).toEqual(['O1234.nc', 'part.h', 'Untitled-7']);
  });

  it('derives dirty from textDirty and metaDirty', () => {
    const clean = docs.add(meta());
    const text = docs.add(meta({ untitledIndex: 2, textDirty: true }));
    const onlyMeta = docs.add(meta({ untitledIndex: 3, metaDirty: true }));
    expect(docs.get(clean)?.dirty).toBe(false);
    expect(docs.get(text)?.dirty).toBe(true);
    expect(docs.get(onlyMeta)?.dirty).toBe(true);
  });

  it('activates the new document unless told not to', () => {
    const first = docs.add(meta());
    expect(docs.getActiveId()).toBe(first);
    const background = docs.add(meta({ untitledIndex: 2 }), { activate: false });
    expect(docs.getActiveId()).toBe(first);
    docs.activate(background);
    expect(docs.getActiveId()).toBe(background);
  });

  it('inserts at the requested index and clamps out-of-range ones', () => {
    const a = docs.add(file('/a.nc'));
    const c = docs.add(file('/c.nc'));
    const b = docs.add(file('/b.nc'), { index: 1 });
    const z = docs.add(file('/z.nc'), { index: 99 });
    const first = docs.add(file('/first.nc'), { index: -5 });
    expect(docs.all().map((d) => d.id)).toEqual([first, a, b, c, z]);
  });

  it('publishes the list, the active id and the active document as stores', () => {
    const seen: (DocMeta | null)[] = [];
    const stop = docs.active.subscribe((d) => seen.push(d));
    const id = docs.add(file('/a.nc'));
    expect(get(docs.list).map((d) => d.id)).toEqual([id]);
    expect(get(docs.activeId)).toBe(id);
    expect(seen.at(-1)?.title).toBe('a.nc');
    stop();
  });
});

describe('updating documents', () => {
  it('recomputes title and dirty and leaves the rest alone', () => {
    const id = docs.add(meta({ untitledIndex: 4 }));
    docs.update(id, { path: '/nc/O99.nc', untitledIndex: null, textDirty: true });
    const doc = docs.get(id);
    expect(doc?.title).toBe('O99.nc');
    expect(doc?.dirty).toBe(true);
    expect(doc?.profileId).toBe('fanuc-gcode');
  });

  it('does not notify when nothing changes', () => {
    const id = docs.add(meta());
    const listener = vi.fn();
    const stop = docs.list.subscribe(listener);
    listener.mockClear();
    docs.update(id, { textDirty: false, profileId: 'fanuc-gcode' });
    expect(listener).not.toHaveBeenCalled();
    docs.update(id, { textDirty: true });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ignores an unknown id and an explicit undefined', () => {
    const id = docs.add(file('/a.nc'));
    docs.update('d404', { textDirty: true });
    docs.update(id, { path: undefined });
    expect(docs.get(id)?.path).toBe('/a.nc');
    expect(docs.get(id)?.dirty).toBe(false);
  });
});

describe('removing documents', () => {
  it('activates the right neighbour', () => {
    const a = docs.add(file('/a.nc'));
    const b = docs.add(file('/b.nc'));
    const c = docs.add(file('/c.nc'));
    docs.activate(b);
    docs.remove(b);
    expect(docs.getActiveId()).toBe(c);
    expect(docs.all().map((d) => d.id)).toEqual([a, c]);
  });

  it('falls back to the left neighbour, then to nothing', () => {
    const a = docs.add(file('/a.nc'));
    const b = docs.add(file('/b.nc'));
    docs.activate(b);
    docs.remove(b);
    expect(docs.getActiveId()).toBe(a);
    docs.remove(a);
    expect(docs.getActiveId()).toBeNull();
    expect(get(docs.active)).toBeNull();
  });

  it('keeps the active document when another one is removed', () => {
    const a = docs.add(file('/a.nc'));
    const b = docs.add(file('/b.nc'));
    docs.activate(a);
    docs.remove(b);
    expect(docs.getActiveId()).toBe(a);
  });
});

describe('ordering', () => {
  it('moves a document and clamps the target index', () => {
    const a = docs.add(file('/a.nc'));
    const b = docs.add(file('/b.nc'));
    const c = docs.add(file('/c.nc'));
    docs.move(a, 2);
    expect(docs.all().map((d) => d.id)).toEqual([b, c, a]);
    docs.move(a, 99);
    expect(docs.all().map((d) => d.id)).toEqual([b, c, a]);
    docs.move(a, -1);
    expect(docs.all().map((d) => d.id)).toEqual([a, b, c]);
  });

  it('ignores a move of an unknown document', () => {
    const a = docs.add(file('/a.nc'));
    docs.move('d404', 0);
    expect(docs.all().map((d) => d.id)).toEqual([a]);
  });
});

describe('byPath', () => {
  it('matches exactly when paths are case-sensitive', () => {
    const id = docs.add(file('/nc/Part.NC'));
    docs.add(meta({ untitledIndex: 2 }));
    expect(docs.byPath('/nc/Part.NC')?.id).toBe(id);
    expect(docs.byPath('/nc/part.nc')).toBeUndefined();
  });

  it('ignores case on macOS and Windows', () => {
    const insensitive = createDocumentStore({ caseInsensitivePaths: true });
    const id = insensitive.add(file('C:\\NC\\Part.NC'));
    expect(insensitive.byPath('c:\\nc\\part.nc')?.id).toBe(id);
  });

  it('never matches an untitled document', () => {
    docs.add(meta());
    expect(docs.byPath('')).toBeUndefined();
  });

  // G8: two spellings of one file gave two tabs that each believed they owned it, and
  // `saveAs`'s "already open" guard missed it too, so the second save discarded the first.
  it('sees through duplicate separators, `.` segments and a trailing slash', () => {
    const id = docs.add(file('/Volumes/cam/job/prog.nc'));
    expect(docs.byPath('/Volumes/cam/./job/prog.nc')?.id).toBe(id);
    expect(docs.byPath('/Volumes//cam/job/prog.nc')?.id).toBe(id);
    expect(docs.byPath('/Volumes/cam/job/prog.nc/.')?.id).toBe(id);
    const dir = docs.add(file('/Volumes/cam/job/'));
    expect(docs.byPath('/Volumes/cam/job')?.id).toBe(dir);
  });

  it('leaves `..` alone rather than resolving it lexically', () => {
    // `/a/b/../prog.nc` is only `/a/prog.nc` when `b` is a real directory, not a symlink.
    // A wrong merge would put two different files in one tab; a missed one only costs a
    // duplicate tab, which is what the canonical path from Rust fixes in M2.
    const id = docs.add(file('/a/prog.nc'));
    expect(docs.byPath('/a/b/../prog.nc')).toBeUndefined();
    expect(docs.byPath('/a/prog.nc')?.id).toBe(id);
  });

  it('treats a backslash as a separator only where it is one', () => {
    const windows = createDocumentStore({ caseInsensitivePaths: true, backslashSeparator: true });
    const id = windows.add(file('C:\\NC\\job\\Part.NC'));
    expect(windows.byPath('c:/nc/job/part.nc')?.id).toBe(id);
    expect(windows.byPath('C:\\NC\\.\\job\\Part.NC')?.id).toBe(id);

    // On a Unix file system a backslash is an ordinary character in a file name.
    const unix = createDocumentStore({ caseInsensitivePaths: false });
    const odd = unix.add(file('/nc/a\\b.nc'));
    expect(unix.byPath('/nc/a\\b.nc')?.id).toBe(odd);
    expect(unix.byPath('/nc/a/b.nc')).toBeUndefined();
  });

  // M8: `canonicalize` answers with `\\?\C:\…` on Windows while every dialog answers
  // with `C:\…`, so a script opened through `script_source_path` and the same file
  // opened again from Recent were two tabs over one file — and the second save
  // discarded the first. Rust folds them (`paths::plain`); this is the net under it.
  it('sees through the `\\\\?\\` spelling of a Windows path', () => {
    const windows = createDocumentStore({ caseInsensitivePaths: true, backslashSeparator: true });
    const id = windows.add(file('C:\\Users\\peter\\scripts\\deburr.py'));
    expect(windows.byPath('\\\\?\\C:\\Users\\peter\\scripts\\deburr.py')?.id).toBe(id);

    // And the other way round, for a tab that was opened under the long spelling.
    const other = createDocumentStore({ caseInsensitivePaths: true, backslashSeparator: true });
    const verbatim = other.add(file('\\\\?\\C:\\nc\\WELLE.NC'));
    expect(other.byPath('C:\\nc\\WELLE.NC')?.id).toBe(verbatim);

    // A share, whose two spellings are `\\?\UNC\nas\cam` and `\\nas\cam`.
    const share = createDocumentStore({ caseInsensitivePaths: true, backslashSeparator: true });
    const onShare = share.add(file('\\\\nas\\cam\\WELLE.NC'));
    expect(share.byPath('\\\\?\\UNC\\nas\\cam\\WELLE.NC')?.id).toBe(onShare);
    // Still two files when they are two files.
    expect(share.byPath('\\\\?\\UNC\\nas\\other\\WELLE.NC')).toBeUndefined();
  });
});

describe('pathKey', () => {
  it('normalizes what it can and nothing else', () => {
    expect(pathKey('/nc/a.nc')).toBe('/nc/a.nc');
    expect(pathKey('/nc//./a.nc')).toBe('/nc/a.nc');
    expect(pathKey('/nc/')).toBe('/nc');
    expect(pathKey('/')).toBe('/');
    expect(pathKey('')).toBe('');
    expect(pathKey('.')).toBe('');
    expect(pathKey('nc/./a.nc')).toBe('nc/a.nc');
    expect(pathKey('./prog.nc')).toBe('prog.nc');
    // A UNC share root keeps its double slash, so `//server/share` stays distinct.
    expect(pathKey('\\\\server\\share\\a.nc', { backslashSeparator: true })).toBe('//server/share/a.nc');
    expect(pathKey('/server/share/a.nc')).toBe('/server/share/a.nc');
  });

  it('folds the two Windows spellings of one path onto one key', () => {
    const win = { backslashSeparator: true };
    expect(pathKey('\\\\?\\C:\\nc\\a.nc', win)).toBe(pathKey('C:\\nc\\a.nc', win));
    expect(pathKey('\\\\?\\UNC\\nas\\cam\\a.nc', win)).toBe(pathKey('\\\\nas\\cam\\a.nc', win));
    // The prefix is what keeps a device name from being a device, so a path that
    // needs it keeps it — and stays a key of its own.
    expect(pathKey('\\\\?\\C:\\nc\\NUL.nc', win)).not.toBe(pathKey('C:\\nc\\NUL.nc', win));
  });
});

describe('untitled indices', () => {
  it('starts at 1 and takes the lowest free index', () => {
    expect(docs.nextUntitledIndex()).toBe(1);
    const one = docs.add(meta({ untitledIndex: 1 }));
    docs.add(meta({ untitledIndex: 2 }));
    docs.add(meta({ untitledIndex: 3 }));
    expect(docs.nextUntitledIndex()).toBe(4);
    docs.remove(one);
    expect(docs.nextUntitledIndex()).toBe(1);
  });

  it('skips the indices of saved documents', () => {
    docs.add(file('/a.nc'));
    expect(docs.nextUntitledIndex()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// M7 (WP7.3): the file a restored snapshot is named after but not bound to (AD-21)
// ---------------------------------------------------------------------------

describe('proposedPath', () => {
  it('names an untitled document after the file it was restored from', () => {
    // Recovered text with `Untitled-1` on the tab says nothing about which program it
    // belongs to, and that is the one thing the programmer needs to know at that moment.
    const id = docs.add(meta({ untitledIndex: 1, proposedPath: '/jobs/2214/welle.nc' }));
    expect(docs.get(id)?.title).toBe('welle.nc');
    expect(docs.get(id)?.path).toBeNull();
  });

  it('is only a name: the document is not findable by that path', () => {
    // A weaker `path` would be worse than none: the external-change poll, the save and
    // the reload all key on `path`, and the fs scope may not allow this one at all.
    docs.add(meta({ untitledIndex: 1, proposedPath: '/jobs/2214/welle.nc' }));
    expect(docs.byPath('/jobs/2214/welle.nc')).toBeUndefined();
  });

  it('gives way to a real path, and the untitled index gives way to both', () => {
    const id = docs.add(meta({ untitledIndex: 4, proposedPath: '/jobs/welle.nc' }));
    docs.update(id, { path: '/nc/welle-copy.nc', untitledIndex: null, proposedPath: null });
    expect(docs.get(id)?.title).toBe('welle-copy.nc');
    expect(docs.byPath('/nc/welle-copy.nc')?.id).toBe(id);
  });

  it('falls back to the untitled index once it is cleared', () => {
    const id = docs.add(meta({ untitledIndex: 4, proposedPath: '/jobs/welle.nc' }));
    docs.update(id, { proposedPath: null });
    expect(docs.get(id)?.title).toBe('Untitled-4');
  });
});
