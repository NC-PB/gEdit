// Compare (plan §5 WP2.5, §7.3): picking what a document is held against, the 50 MB
// guard (F8), and the bookkeeping around the overlay — one temporary model, one view
// state, and exactly one way out of a session.
//
// The real document store, the real layout store and the real i18n catalog are used; only
// the disk, the sizes and the editor's view state are fakes, so no test needs Monaco or a
// webview. The markup check at the end drives the real singleton, which is also the proof
// that `app/compare.ts` is wired to the stores the app ships.

import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoTarget,
  availableSources,
  compareTitle,
  createCompareService,
  documentTargets,
  withinCompareLimit,
  COMPARE_PANEL_ID,
  compare,
  compareController,
  type CompareController,
  type CompareDeps,
} from './compare';
import CompareView from '$lib/components/editor/CompareView.svelte';
import compareContribution from '$lib/contrib/compare';
import { MODEL_SYNC_LIMIT_CHARS } from '$lib/monaco/diff';
import { createDocumentStore, docs as appDocs } from '$lib/stores/documents';
import { createLayoutStore } from '$lib/stores/layout';
import { hasKey, t } from '$lib/i18n';
import { get } from 'svelte/store';
import type {
  CommandContext,
  DecodeResult,
  DocId,
  DocMeta,
  DocumentStore,
  LayoutStore,
  NewDocMeta,
  StatusService,
} from '$lib/app/types';

// ---------------------------------------------------------------------------
// Fixtures and fakes
// ---------------------------------------------------------------------------

function newDoc(over: Partial<NewDocMeta> = {}): NewDocMeta {
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
    ...over,
  };
}

function decoded(text: string): DecodeResult {
  return {
    ok: true,
    text,
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixed: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
  };
}

interface Harness {
  service: CompareController;
  docs: DocumentStore;
  layout: LayoutStore;
  /** Every status message, with `!` in front of an error. */
  messages: string[];
  disk: Map<string, DecodeResult | null>;
  sizes: Map<DocId, number>;
  detect: ReturnType<typeof vi.fn>;
  restored: unknown[];
  captured: number;
  /** What `files_stat` answers per path; a path that is not in here stats as unknown. */
  diskSizes: Map<string, number | null>;
  /** Every path `readDisk` was asked for, in order. */
  reads: string[];
}

function harness(): Harness {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const layout = createLayoutStore({ regionOf: () => 'overlay' });
  const messages: string[] = [];
  const disk = new Map<string, DecodeResult | null>();
  const diskSizes = new Map<string, number | null>();
  const reads: string[] = [];
  const sizes = new Map<DocId, number>();
  const restored: unknown[] = [];
  const detect = vi.fn((_path: string, _text: string, fallback: string) => `${fallback}-detected`);

  const status: StatusService = {
    current: { subscribe: () => () => {} },
    show(text, o) {
      messages.push(`${o?.error === true ? '!' : ''}${text}`);
    },
    clear() {},
  };

  const state: Harness = {
    docs,
    layout,
    messages,
    disk,
    diskSizes,
    reads,
    sizes,
    detect,
    restored,
    captured: 0,
    service: undefined as unknown as CompareController,
  };

  const deps: CompareDeps = {
    docs,
    layout,
    status,
    profiles: { detect: detect as unknown as CompareDeps['profiles']['detect'] },
    readDisk: (path) => {
      reads.push(path);
      return Promise.resolve(disk.has(path) ? (disk.get(path) ?? null) : decoded('DISK'));
    },
    statSize: (path) => Promise.resolve(diskSizes.has(path) ? (diskSizes.get(path) ?? null) : null),
    charCountOf: (id) => sizes.get(id) ?? 0,
    captureViewState: () => `view-${++state.captured}`,
    restoreViewState: (snapshot) => {
      restored.push(snapshot);
    },
  };
  state.service = createCompareService(deps);
  return state;
}

function meta(docs: DocumentStore, id: DocId): DocMeta {
  const doc = docs.get(id);
  if (!doc) throw new Error(`no document ${id}`);
  return doc;
}

// ---------------------------------------------------------------------------
// Target selection (pure)
// ---------------------------------------------------------------------------

describe('target selection', () => {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const untitled = docs.add(newDoc());
  const saved = docs.add(newDoc({ path: '/nc/O1234.nc', untitledIndex: null }));

  it('offers the saved version only for a document with a path', () => {
    expect(availableSources(meta(docs, untitled), 2)).toEqual(['document', 'file']);
    expect(availableSources(meta(docs, saved), 2)).toEqual(['saved', 'document', 'file']);
  });

  it('offers another document only when a second one is open', () => {
    expect(availableSources(meta(docs, saved), 1)).toEqual(['saved', 'file']);
  });

  it('offers nothing when there is no document', () => {
    expect(availableSources(undefined, 3)).toEqual([]);
  });

  it('never offers the document itself as a target', () => {
    const all = docs.all();
    expect(documentTargets(all, saved).map((d) => d.id)).toEqual([untitled]);
    expect(documentTargets(all, 'nope')).toHaveLength(2);
  });

  it('picks the only other document without asking, and asks above two', () => {
    const all = docs.all();
    expect(all).toHaveLength(2);
    expect(autoTarget(all, saved)).toBe(untitled);
    const third = { ...meta(docs, untitled), id: 'd99' };
    expect(autoTarget([...all, third], saved)).toBeNull();
    expect(autoTarget(all.slice(0, 1), untitled)).toBeNull(); // nothing to compare with
  });

  it('refuses a side above Monaco’s model sync limit (F8)', () => {
    expect(withinCompareLimit(0)).toBe(true);
    expect(withinCompareLimit(MODEL_SYNC_LIMIT_CHARS)).toBe(true);
    expect(withinCompareLimit(MODEL_SYNC_LIMIT_CHARS + 1)).toBe(false);
  });

  it('names the comparison after both sides', () => {
    expect(compareTitle('O1234.nc', { kind: 'saved' }, 'O1234.nc')).toBe(
      t('compare.titleSaved', { name: 'O1234.nc' }),
    );
    expect(compareTitle('A.nc', { kind: 'document', docId: 'd2' }, 'B.nc')).toContain('B.nc');
    expect(compareTitle('A.nc', { kind: 'file', path: '/x/B.nc' }, 'B.nc')).toContain('B.nc');
  });
});

// ---------------------------------------------------------------------------
// Opening a comparison
// ---------------------------------------------------------------------------

describe('open', () => {
  let h: Harness;
  let a: DocId;
  let b: DocId;

  beforeEach(() => {
    h = harness();
    a = h.docs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    b = h.docs.add(newDoc({ path: '/nc/B.nc', untitledIndex: null }));
    h.docs.activate(a);
  });

  it('compares with the saved version and shows the overlay', async () => {
    h.disk.set('/nc/A.nc', decoded('SAVED'));
    expect(await h.service.open(a, { kind: 'saved' })).toBe(true);

    const session = get(h.service.session);
    expect(session).toEqual({ docId: a, source: { kind: 'saved' }, title: t('compare.titleSaved', { name: 'A.nc' }) });
    expect(get(h.layout.state).overlay).toBe(COMPARE_PANEL_ID);
    expect(get(h.service.content)?.original).toEqual({
      kind: 'text',
      text: 'SAVED',
      languageId: 'fanuc-gcode',
    });
    // The saved version is the same file, so there is nothing to detect.
    expect(h.detect).not.toHaveBeenCalled();
  });

  it('refuses the saved version of an untitled document', async () => {
    const untitled = h.docs.add(newDoc());
    expect(await h.service.open(untitled, { kind: 'saved' })).toBe(false);
    expect(h.messages).toEqual([`!${t('compare.untitled')}`]);
    expect(get(h.layout.state).overlay).toBeNull();
  });

  it('compares with another document by reference, not by copy', async () => {
    expect(await h.service.open(a, { kind: 'document', docId: b })).toBe(true);
    expect(get(h.service.content)?.original).toEqual({ kind: 'document', docId: b });
  });

  it('refuses a document against itself', async () => {
    expect(await h.service.open(a, { kind: 'document', docId: a })).toBe(false);
    expect(h.messages).toEqual([`!${t('compare.sameDocument')}`]);
  });

  it('refuses a document that is not open', async () => {
    expect(await h.service.open(a, { kind: 'document', docId: 'gone' })).toBe(false);
    expect(await h.service.open('gone', { kind: 'saved' })).toBe(false);
    expect(h.messages).toEqual([`!${t('compare.noDocument')}`, `!${t('compare.noDocument')}`]);
  });

  it('detects the profile of a picked file, falling back to the document’s', async () => {
    h.disk.set('/other/C.NC', decoded('C'));
    expect(await h.service.open(a, { kind: 'file', path: '/other/C.NC' })).toBe(true);
    expect(h.detect).toHaveBeenCalledWith('/other/C.NC', 'C', 'fanuc-gcode');
    expect(get(h.service.content)?.original).toMatchObject({ languageId: 'fanuc-gcode-detected' });
    expect(get(h.service.session)?.title).toBe(t('compare.titleFile', { name: 'A.nc', file: 'C.NC' }));
  });

  it('reports a file it cannot read and stays closed', async () => {
    h.disk.set('/other/C.nc', null);
    expect(await h.service.open(a, { kind: 'file', path: '/other/C.nc' })).toBe(false);
    expect(h.messages).toEqual([`!${t('compare.readFailed', { file: 'C.nc' })}`]);
    expect(get(h.layout.state).overlay).toBeNull();
  });

  it('passes a decoder refusal (a binary file) straight through', async () => {
    h.disk.set('/other/bin', {
      ok: false,
      reason: 'binary',
      message: { key: 'files.binaryRefused', params: { percent: 42 } },
    });
    expect(await h.service.open(a, { kind: 'file', path: '/other/bin' })).toBe(false);
    expect(h.messages).toEqual([`!${t('files.binaryRefused', { percent: 42 })}`]);
  });

  it('refuses either side above 50 MB and never builds a diff (F8)', async () => {
    const limit = `!${t('compare.tooLarge', { limit: '50 MB' })}`;

    h.sizes.set(a, MODEL_SYNC_LIMIT_CHARS + 1);
    expect(await h.service.open(a, { kind: 'document', docId: b })).toBe(false);

    h.sizes.set(a, 10);
    h.sizes.set(b, MODEL_SYNC_LIMIT_CHARS + 1);
    expect(await h.service.open(a, { kind: 'document', docId: b })).toBe(false);

    h.sizes.set(b, 10);
    h.disk.set('/big.nc', decoded('x'.repeat(16)));
    // The disk side is measured on its decoded text, not on a stat.
    h.disk.set('/big.nc', decoded('x'.repeat(MODEL_SYNC_LIMIT_CHARS + 1)));
    expect(await h.service.open(a, { kind: 'file', path: '/big.nc' })).toBe(false);

    expect(h.messages).toEqual([limit, limit, limit]);
    expect(get(h.layout.state).overlay).toBeNull();
    expect(get(h.service.session)).toBeNull();
  });

  it('refuses an oversized file on its stat, without reading it (G8 M2)', async () => {
    // `dialogs.pickFile` has no filters, so the pick can be a disk image. Reading first
    // would pull it through IPC and decode it into a UTF-16 string before refusing it.
    h.diskSizes.set('/huge.img', MODEL_SYNC_LIMIT_CHARS + 1);

    expect(await h.service.open(a, { kind: 'file', path: '/huge.img' })).toBe(false);

    expect(h.reads).toEqual([]);
    expect(h.messages).toEqual([`!${t('compare.tooLarge', { limit: '50 MB' })}`]);
    expect(get(h.service.session)).toBeNull();
  });

  it('refuses a saved version that grew past the limit on disk, without reading it', async () => {
    const doc = meta(h.docs, a);
    h.diskSizes.set(doc.path as string, MODEL_SYNC_LIMIT_CHARS + 1);

    expect(await h.service.open(a, { kind: 'saved' })).toBe(false);

    expect(h.reads).toEqual([]);
    expect(h.messages).toEqual([`!${t('compare.tooLarge', { limit: '50 MB' })}`]);
  });

  it('reads a file whose size is at the limit, or unknown', async () => {
    h.diskSizes.set('/edge.nc', MODEL_SYNC_LIMIT_CHARS);
    expect(await h.service.open(a, { kind: 'file', path: '/edge.nc' })).toBe(true);
    h.service.close();
    // A stat that could not answer never refuses: the exact check on the decoded text does.
    expect(await h.service.open(a, { kind: 'file', path: '/unknown.nc' })).toBe(true);
    expect(h.reads).toEqual(['/edge.nc', '/unknown.nc']);
  });

  it('activates the compared document and takes the view state afterwards', async () => {
    h.docs.activate(b);
    expect(await h.service.open(a, { kind: 'document', docId: b })).toBe(true);
    expect(h.docs.getActiveId()).toBe(a);
    expect(h.captured).toBe(1);
    expect(h.restored).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

describe('close', () => {
  let h: Harness;
  let a: DocId;
  let b: DocId;

  beforeEach(async () => {
    h = harness();
    a = h.docs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    b = h.docs.add(newDoc({ path: '/nc/B.nc', untitledIndex: null }));
    h.docs.activate(a);
    await h.service.open(a, { kind: 'document', docId: b });
  });

  it('clears the session, hides the overlay and puts the editor back', () => {
    h.service.close();
    expect(get(h.service.session)).toBeNull();
    expect(get(h.service.content)).toBeNull();
    expect(get(h.layout.state).overlay).toBeNull();
    expect(h.restored).toEqual(['view-1']);
  });

  it('is harmless a second time', () => {
    h.service.close();
    h.service.close();
    expect(h.restored).toEqual(['view-1']);
  });

  it('follows the overlay when something else closes it (the panel header ✕)', () => {
    h.layout.closeOverlay();
    expect(get(h.service.session)).toBeNull();
    expect(h.restored).toEqual(['view-1']);
  });

  it('follows the overlay when another panel takes the region', () => {
    h.layout.openOverlay('somethingElse');
    expect(get(h.service.session)).toBeNull();
    expect(get(h.layout.state).overlay).toBe('somethingElse');
    expect(h.restored).toEqual(['view-1']);
  });

  it('ends when the user switches to another tab', () => {
    h.docs.activate(b);
    expect(get(h.service.session)).toBeNull();
    expect(get(h.layout.state).overlay).toBeNull();
  });

  it('ends when the compared document is closed', () => {
    h.docs.remove(a);
    expect(get(h.service.session)).toBeNull();
    expect(get(h.layout.state).overlay).toBeNull();
  });

  it('takes a fresh view state for every session', async () => {
    h.service.close();
    await h.service.open(a, { kind: 'document', docId: b });
    h.service.close();
    expect(h.restored).toEqual(['view-1', 'view-2']);
  });

  it('keeps the first view state when a comparison is replaced without closing', async () => {
    h.disk.set('/nc/A.nc', decoded('SAVED'));
    expect(await h.service.open(a, { kind: 'saved' })).toBe(true);
    expect(h.captured).toBe(1);
    h.service.close();
    expect(h.restored).toEqual(['view-1']);
  });
});

// ---------------------------------------------------------------------------
// The toolbar options
// ---------------------------------------------------------------------------

describe('toolbar options', () => {
  it('start side by side with whitespace counted, and survive a session', async () => {
    const h = harness();
    const a = h.docs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    const b = h.docs.add(newDoc({ path: '/nc/B.nc', untitledIndex: null }));

    expect(get(h.service.options)).toEqual({ inline: false, ignoreTrimWhitespace: false });

    h.service.toggleInline();
    h.service.setIgnoreTrimWhitespace(true);
    expect(get(h.service.options)).toEqual({ inline: true, ignoreTrimWhitespace: true });

    await h.service.open(a, { kind: 'document', docId: b });
    h.service.close();
    expect(get(h.service.options)).toEqual({ inline: true, ignoreTrimWhitespace: true });

    h.service.setInline(false);
    expect(get(h.service.options).inline).toBe(false);
  });

  it('keeps the store identity when a setter changes nothing', () => {
    const h = harness();
    const before = get(h.service.options);
    h.service.setInline(false);
    expect(get(h.service.options)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// What the contribution declares (plan §5 WP2.5, §7.11)
// ---------------------------------------------------------------------------

describe('contrib/compare', () => {
  const byId = new Map((compareContribution.commands ?? []).map((def) => [def.id, def]));

  function context(over: Partial<CommandContext> = {}): CommandContext {
    return {
      activeDocId: null,
      profileId: null,
      hasSelection: false,
      editorFocused: false,
      compareOpen: false,
      modalOpen: false,
      scriptRunning: false,
      ...over,
    };
  }

  it('registers exactly the WP2.5 commands, and only `compare.with` claims a key', () => {
    expect([...byId.keys()]).toEqual([
      'compare.with',
      'compare.withDocument',
      'compare.withFile',
      'compare.withSaved',
      'compare.close',
      'compare.nextDiff',
      'compare.prevDiff',
      'compare.toggleInline',
    ]);
    expect(Object.fromEntries([...byId].map(([id, def]) => [id, def.keys ?? null]))).toEqual({
      'compare.with': 'Mod+Alt+C',
      'compare.withDocument': null,
      'compare.withFile': null,
      'compare.withSaved': null,
      'compare.close': null,
      'compare.nextDiff': null,
      'compare.prevDiff': null,
      'compare.toggleInline': null,
    });
  });

  it('puts the view in the overlay region, where it takes the editor’s place', () => {
    expect(compareContribution.panels).toEqual([
      expect.objectContaining({ id: COMPARE_PANEL_ID, region: 'overlay', title: 'compare.title' }),
    ]);
  });

  it('has a message for every key it declares', () => {
    const keys = [
      ...[...byId.values()].flatMap((def) => [def.title, def.category ?? 'common.ok']),
      ...(compareContribution.panels ?? []).map((panel) => panel.title),
      ...(compareContribution.ribbon ?? []).map((item) => item.group),
    ];
    expect(keys.filter((key) => !hasKey(key))).toEqual([]);
  });

  it('enables the navigation only while a comparison is open', () => {
    for (const id of ['compare.close', 'compare.nextDiff', 'compare.prevDiff', 'compare.toggleInline']) {
      expect(byId.get(id)?.enabled?.(context()), id).toBe(false);
      expect(byId.get(id)?.enabled?.(context({ compareOpen: true })), id).toBe(true);
    }
  });

  it('enables the saved version only for a document with a path', () => {
    const docId = appDocs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    const untitled = appDocs.add(newDoc());
    try {
      expect(byId.get('compare.withSaved')?.enabled?.(context({ activeDocId: docId }))).toBe(true);
      expect(byId.get('compare.withSaved')?.enabled?.(context({ activeDocId: untitled }))).toBe(false);
      expect(byId.get('compare.withSaved')?.enabled?.(context())).toBe(false);
      // A second tab is what `compare.withDocument` needs.
      expect(byId.get('compare.withDocument')?.enabled?.(context({ activeDocId: docId }))).toBe(true);
      expect(byId.get('compare.with')?.enabled?.(context())).toBe(false);
    } finally {
      for (const doc of appDocs.all()) appDocs.remove(doc.id);
    }
  });
});

// ---------------------------------------------------------------------------
// The overlay markup (plan §7.9: `compare-view` with `data-source`)
// ---------------------------------------------------------------------------

describe('CompareView markup', () => {
  afterEach(() => {
    compare.close();
    for (const doc of appDocs.all()) appDocs.remove(doc.id);
  });

  it('carries the test id, the source kind and the session title', async () => {
    const a = appDocs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    const b = appDocs.add(newDoc({ path: '/nc/B.nc', untitledIndex: null }));
    expect(await compare.open(a, { kind: 'document', docId: b })).toBe(true);
    expect(get(compareController.content)?.original).toEqual({ kind: 'document', docId: b });

    const html = render(CompareView).body;
    expect(html).toContain('data-testid="compare-view"');
    expect(html).toContain('data-source="document"');
    expect(html).toContain(t('compare.titleDocument', { name: 'A.nc', other: 'B.nc' }));
    expect(html).toContain(t('compare.nextDiff'));
    expect(html).toContain(t('compare.ignoreWhitespace'));
    // Side by side is the default, so the toggle offers the state it is in.
    expect(html).toContain(t('compare.sideBySide'));
  });

  it('says so instead of mounting a diff when there is no session', () => {
    const html = render(CompareView).body;
    expect(html).toContain('data-source=""');
    expect(html).toContain(t('compare.empty'));
  });
});
