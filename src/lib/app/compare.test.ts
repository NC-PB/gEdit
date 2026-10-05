// Compare (plan §5 WP2.5, §7.3): picking what a document is held against, the 50 MB
// guard (F8), and the bookkeeping around the overlay — one view state, and exactly one way
// out of a session. M11 (WP11.3, AD-26): review mode, the saved options, the merge (the
// target and direction rules and the edit are pure functions; the service runs against a
// fake diff handle), the export and two files.
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
  buildReview,
  changeAtCursor,
  changedToggles,
  compareMemoOf,
  compareTitle,
  copyBlocker,
  createCompareService,
  documentTargets,
  mergeOperation,
  mergePlan,
  reviewLineOf,
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
import { profiles as appProfiles } from '$lib/stores/profiles';
import { COMPARE_FALLBACK, type CompareMemo } from '$lib/core/compare/types';
import { compareDefaults } from '$lib/core/compare';
import type { DiffCursor, DiffHandle, DiffLineChange, DiffSide } from '$lib/monaco/diff';
import type { LineOperation } from '$lib/monaco/applyLines';
import type { EffectiveMachine, EffectiveProfile } from '$lib/core/machines/types';
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
    readOnly: false,
    readOnlyReason: null,
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
  /** The text `textOf` answers per document. */
  texts: Map<DocId, string>;
  /** The effective machine per document (default: none chosen, the profile's own readings). */
  machines: Map<DocId, EffectiveMachine>;
  /** `ui.lastParams.compare`: what `memory.read` answers and every `write`. */
  memory: { value: unknown; writes: CompareMemo[] };
  /** What the file picker answers, one per call. */
  picks: (string | null)[];
  /** Every path `files.open` was given, per call, and the documents it answers. */
  opened: string[][];
  openAnswer: ((paths: string[]) => DocId[]) | null;
  /** The new untitled documents `files.newUntitled` made. */
  untitled: { id: DocId; text: string; profileId: string | undefined; activate: boolean | undefined }[];
  diff: FakeDiff | null;
}

/**
 * A fake machine: its name and key matter to the review bar. A named one states its own
 * number input (calculator type), so nothing is left for the "no machine" note to say; an
 * unnamed one is "none chosen", which leaves the profile's presets in play.
 */
function machine(name: string | null, key: string): EffectiveMachine {
  return {
    id: name,
    name,
    choice: name === null ? 'none' : 'document',
    key,
    params: { numberInput: { mode: 'calculator' } },
    source: { numberInput: name === null ? 'profile' : 'machine' },
  } as unknown as EffectiveMachine;
}

/** A model made of text: edits apply for real, and the stack elements are logged. */
class FakeModel {
  log: string[] = [];
  constructor(public text: string) {}
  private get lines(): string[] {
    return this.text.split('\n');
  }
  getLineCount(): number {
    return this.lines.length;
  }
  getLineContent(line: number): string {
    return this.lines[line - 1];
  }
  getLineMaxColumn(line: number): number {
    return this.lines[line - 1].length + 1;
  }
  pushStackElement(): void {
    this.log.push('stack');
  }
  pushEditOperations(_before: null, ops: LineOperation[], _compute: () => null): void {
    this.log.push('edit');
    for (const op of ops) {
      const offset = (line: number, column: number): number =>
        this.lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1;
      const from = offset(op.range.startLineNumber, op.range.startColumn);
      const to = offset(op.range.endLineNumber, op.range.endColumn);
      this.text = this.text.slice(0, from) + op.text + this.text.slice(to);
    }
  }
}

/** A diff handle with no Monaco: changes and cursor are given, models are `FakeModel`s. */
class FakeDiff implements DiffHandle {
  changes: DiffLineChange[] | null = [];
  cursorAt: DiffCursor | null = { side: 'modified', line: 1 };
  models: Record<DiffSide, FakeModel> = { original: new FakeModel(''), modified: new FakeModel('') };
  calls: string[] = [];
  /** False while Monaco has not recomputed after an edit. */
  current = true;
  isCurrent(): boolean {
    return this.current;
  }
  goToDiff(direction: 'next' | 'previous'): void {
    this.calls.push(`go:${direction}`);
  }
  setInline(): void {}
  setIgnoreTrimWhitespace(): void {}
  focus(): void {}
  show(): void {}
  cursor(): DiffCursor | null {
    return this.cursorAt;
  }
  lineChanges(): DiffLineChange[] | null {
    return this.changes;
  }
  model(side: DiffSide): FakeModel {
    return this.models[side];
  }
  reveal(side: DiffSide, line: number): void {
    this.calls.push(`reveal:${side}:${line}`);
  }
  nextWhenUpdated(): void {
    this.calls.push('next');
  }
  dispose(): void {}
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
    texts: new Map(),
    machines: new Map(),
    memory: { value: undefined, writes: [] },
    picks: [],
    opened: [],
    openAnswer: null,
    untitled: [],
    diff: null,
    service: undefined as unknown as CompareController,
  };

  const deps: CompareDeps = {
    docs,
    layout,
    status,
    profiles: { detect: detect as unknown as CompareDeps['profiles']['detect'], compiled: (id) => appProfiles.compiled(id) },
    files: {
      open: (paths) => {
        state.opened.push(paths ?? []);
        return Promise.resolve(state.openAnswer ? state.openAnswer(paths ?? []) : []);
      },
      newUntitled: (o) => {
        const id = docs.add(newDoc({ untitledIndex: docs.nextUntitledIndex(), profileId: o?.profileId ?? 'fanuc-gcode' }), {
          activate: false,
        });
        state.untitled.push({ id, text: o?.text ?? '', profileId: o?.profileId, activate: o?.activate });
        return id;
      },
    },
    readDisk: (path) => {
      reads.push(path);
      return Promise.resolve(disk.has(path) ? (disk.get(path) ?? null) : decoded('DISK'));
    },
    statSize: (path) => Promise.resolve(diskSizes.has(path) ? (diskSizes.get(path) ?? null) : null),
    charCountOf: (id) => sizes.get(id) ?? 0,
    textOf: (id) => state.texts.get(id) ?? '',
    effectiveOf: (id): EffectiveProfile => {
      const profileId = docs.get(id)?.profileId ?? 'fanuc-gcode';
      return {
        profile: appProfiles.profile(profileId),
        cp: appProfiles.compiled(profileId),
        codes: undefined as never,
        machine: state.machines.get(id) ?? machine(null, `${profileId}:none`),
      };
    },
    pickFile: () => Promise.resolve(state.picks.shift() ?? null),
    diff: () => state.diff,
    memory: {
      read: () => state.memory.value,
      write: (memo) => {
        state.memory.value = memo;
        state.memory.writes.push(memo);
      },
    },
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

    expect(get(h.service.view)).toEqual({ inline: false, ignoreTrimWhitespace: false });

    h.service.toggleInline();
    h.service.setIgnoreTrimWhitespace(true);
    expect(get(h.service.view)).toEqual({ inline: true, ignoreTrimWhitespace: true });

    await h.service.open(a, { kind: 'document', docId: b });
    h.service.close();
    expect(get(h.service.view)).toEqual({ inline: true, ignoreTrimWhitespace: true });

    h.service.setInline(false);
    expect(get(h.service.view).inline).toBe(false);
  });

  it('keeps the store identity when a setter changes nothing', () => {
    const h = harness();
    const before = get(h.service.view);
    h.service.setInline(false);
    expect(get(h.service.view)).toBe(before);
  });
});

// The review toggles of §7.7 and the raw view's two options (`view`, §7.16 #138) are two
// different sets; they must not leak into one another.
describe('options and view', () => {
  it('keeps the review toggles apart from the raw view options', () => {
    const h = harness();
    expect(get(h.service.mode)).toBe('raw');
    expect(get(h.service.options)).toEqual(COMPARE_FALLBACK);
    h.service.setMode('review');
    h.service.setOptions({ ignoreCase: true });
    expect(get(h.service.mode)).toBe('review');
    expect(get(h.service.options)).toEqual({ ...COMPARE_FALLBACK, ignoreCase: true });
    expect(get(h.service.view)).toEqual({ inline: false, ignoreTrimWhitespace: false });
  });

  it('exposes the §7.7 members on the §7.3 view of the service', () => {
    for (const member of ['mode', 'setMode', 'options', 'setOptions', 'copyChange', 'exportDiff', 'openFiles']) {
      expect(member in compare, member).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The saved options (pure)
// ---------------------------------------------------------------------------

describe('compareMemoOf', () => {
  it('keeps a profile called __proto__ as an entry, not as a prototype (CODE-20)', () => {
    const raw = JSON.parse('{"review": {"__proto__": {"ignoreCase": true}, "fanuc-gcode": {"ignoreCase": false}}}');
    const memo = compareMemoOf(raw);
    expect(Object.keys(memo.review ?? {}).sort()).toEqual(['__proto__', 'fanuc-gcode']);
    expect(Object.getPrototypeOf(memo.review)).toBeNull();
    expect(({} as Record<string, unknown>).ignoreCase).toBeUndefined();
  });

  it('keeps what is of the declared type, member by member', () => {
    expect(
      compareMemoOf({
        mode: 'review',
        inline: true,
        ignoreTrimWhitespace: false,
        review: { 'fanuc-gcode': { ignoreCase: true, ignoreComments: false } },
      }),
    ).toEqual({
      mode: 'review',
      inline: true,
      ignoreTrimWhitespace: false,
      review: { 'fanuc-gcode': { ignoreCase: true, ignoreComments: false } },
    });
  });

  it('drops anything else, so a bad file brings the defaults back', () => {
    expect(compareMemoOf(undefined)).toEqual({});
    expect(compareMemoOf('x')).toEqual({});
    expect(compareMemoOf([1])).toEqual({});
    expect(
      compareMemoOf({
        mode: 'sideways',
        inline: 1,
        ignoreTrimWhitespace: 'yes',
        review: { a: { ignoreCase: 'true', other: true }, b: 5, c: [], d: {} },
      }),
    ).toEqual({});
    expect(compareMemoOf({ review: [] })).toEqual({});
  });

  it('keeps only the five toggles of a profile entry', () => {
    expect(compareMemoOf({ review: { p: { ignoreCase: true, tolerance: true } } })).toEqual({
      review: { p: { ignoreCase: true } },
    });
  });

  it('lists the toggles that differ from the defaults', () => {
    expect(changedToggles({ ...COMPARE_FALLBACK }, { ...COMPARE_FALLBACK })).toEqual({});
    expect(changedToggles({ ...COMPARE_FALLBACK, ignoreCase: true, ignoreComments: true }, { ...COMPARE_FALLBACK })).toEqual({
      ignoreCase: true,
      ignoreComments: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Review mode (pure)
// ---------------------------------------------------------------------------

describe('buildReview', () => {
  const fanuc = appProfiles.compiled('fanuc-gcode');
  const input = (lines: string[], over: Partial<Parameters<typeof buildReview>[0]> = {}) => ({
    lines,
    cp: fanuc,
    machine: machine('Mill', 'fanuc-gcode:mill'),
    profileId: 'fanuc-gcode',
    label: 'side',
    ...over,
  });
  const options = compareDefaults(appProfiles.profile('fanuc-gcode'));

  it('makes a re-post and its original read the same, and maps back to the file’s lines', () => {
    const modified = ['N10 G01 X10.000', '(NEW COMMENT)', 'N20 G0 Z5.'];
    const original = ['G1 X10.', 'G0 Z5.'];
    const review = buildReview(input(modified), input(original), options);
    expect(review.modified.text).toBe(review.original.text);
    expect(Array.from(review.modified.lineMap)).toEqual([1, 3]);
    expect(Array.from(review.original.lineMap)).toEqual([1, 2]);
    expect(review.notes).toEqual([]);
  });

  it('says so when the two effective machines differ', () => {
    const review = buildReview(
      input(['G1 X1.'], { machine: machine('Mill 1', 'a') }),
      input(['G1 X1.'], { machine: machine('Mill 2', 'b') }),
      options,
    );
    expect(review.notes.map((n) => n.reason)).toEqual(['machines']);
    expect(review.notes[0].text).toContain('Mill 1');
    expect(review.notes[0].text).toContain('Mill 2');
  });

  it('says nothing when two machines read numbers alike', () => {
    const same = buildReview(
      input(['G1 X1.'], { machine: machine('Mill 1', 'k') }),
      input(['G1 X1.'], { machine: machine('Mill copy', 'k') }),
      options,
    );
    expect(same.notes).toEqual([]);
  });

  it('reads the decimal point by the stricter side, so an increment machine’s difference shows (NC-6)', () => {
    const increments = {
      ...machine('Mill IS-B', 'isb'),
      params: { numberInput: { mode: 'increment' } },
    } as unknown as ReturnType<typeof machine>;
    const review = buildReview(
      input(['G1 X10'], { machine: increments }),
      input(['G1 X10.'], { machine: machine('Mill calc', 'calc') }),
      options,
    );
    expect(review.modified.text).not.toBe(review.original.text);
  });

  it('keeps identical text equal between a calculator side and a side with no machine (NC-6)', () => {
    const lines = ['G0 X10. Y20.'];
    const review = buildReview(input(lines), input(lines, { machine: null }), options);
    expect(review.modified.text).toBe(review.original.text);
  });

  it('says so for a side with no machine, and for two dialects', () => {
    const review = buildReview(input(['G1 X1.']), input(['G1 X1.'], { machine: null, label: 'the original' }), options);
    expect(review.notes.map((n) => n.reason)).toContain('noMachine');
    expect(review.notes.find((n) => n.reason === 'noMachine')?.text).toContain('the original');

    const profiles = buildReview(
      input(['G1 X1.']),
      input(['G1 X1.'], { profileId: 'sinumerik', cp: appProfiles.compiled('sinumerik') }),
      options,
    );
    expect(profiles.notes.map((n) => n.reason)).toEqual(['profiles']);
  });

  it('carries the notes of the normalization, with the side and the line', () => {
    const review = buildReview(input(['N10 G1 X1.', 'GOTO #1', 'N20 G0']), input(['G1 X1.']), options);
    const note = review.notes.find((n) => n.reason === 'blockNumbers');
    expect(note?.text).toContain('line 2');
    expect(note?.text).toContain('side');
    // every message it can show has a text
    expect(hasKey('compare.noteBlockNumbers')).toBe(true);
    expect(hasKey('compare.notePointWithoutMachine')).toBe(true);
  });

  it('gives an empty side no lines at all', () => {
    const review = buildReview(input(['G1 X1.']), input(['(ONLY A COMMENT)']), options);
    expect(review.original.text).toBe('');
    expect(review.original.lineMap).toHaveLength(0);
  });

  it('finds the review line of a file line through the map', () => {
    const map = Int32Array.from([1, 3, 4, 9]);
    expect(reviewLineOf(map, 1)).toBe(1);
    expect(reviewLineOf(map, 2)).toBe(2); // dropped: the next one shown
    expect(reviewLineOf(map, 3)).toBe(2);
    expect(reviewLineOf(map, 9)).toBe(4);
    expect(reviewLineOf(map, 10)).toBeNull();
    expect(reviewLineOf(new Int32Array(0), 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The merge (pure)
// ---------------------------------------------------------------------------

describe('copy target and direction', () => {
  const free = { mode: 'raw' as const, originalIsDocument: true, targetLocked: false };

  it('copies nowhere in review mode, whatever else holds', () => {
    expect(copyBlocker('toModified', { ...free, mode: 'review' })).toBe('review');
    expect(copyBlocker('toOriginal', { ...free, mode: 'review' })).toBe('review');
  });

  it('writes the original only when it is an open document', () => {
    expect(copyBlocker('toOriginal', { ...free, originalIsDocument: false })).toBe('notDocument');
    expect(copyBlocker('toModified', { ...free, originalIsDocument: false })).toBeNull();
    expect(copyBlocker('toOriginal', free)).toBeNull();
  });

  it('refuses a locked target', () => {
    expect(copyBlocker('toModified', { ...free, targetLocked: true })).toBe('locked');
    expect(copyBlocker('toOriginal', { ...free, targetLocked: true })).toBe('locked');
  });
});

describe('the change at the cursor', () => {
  const modify: DiffLineChange = { originalStartLineNumber: 2, originalEndLineNumber: 3, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 };
  const insert: DiffLineChange = { originalStartLineNumber: 5, originalEndLineNumber: 0, modifiedStartLineNumber: 6, modifiedEndLineNumber: 7 };
  const remove: DiffLineChange = { originalStartLineNumber: 9, originalEndLineNumber: 10, modifiedStartLineNumber: 9, modifiedEndLineNumber: 0 };
  const all = [modify, insert, remove];

  it('finds the block that holds the line in the cursor’s own pane', () => {
    expect(changeAtCursor(all, { side: 'modified', line: 2 })).toBe(modify);
    expect(changeAtCursor(all, { side: 'original', line: 3 })).toBe(modify);
    expect(changeAtCursor(all, { side: 'modified', line: 7 })).toBe(insert);
    expect(changeAtCursor(all, { side: 'original', line: 10 })).toBe(remove);
  });

  it('takes the line next to an empty side for that change', () => {
    expect(changeAtCursor(all, { side: 'original', line: 5 })).toBe(insert);
    expect(changeAtCursor(all, { side: 'original', line: 6 })).toBe(insert);
    expect(changeAtCursor(all, { side: 'modified', line: 9 })).toBe(remove);
    expect(changeAtCursor(all, { side: 'modified', line: 10 })).toBe(remove);
  });

  it('finds nothing where no change is', () => {
    expect(changeAtCursor(all, { side: 'modified', line: 4 })).toBeNull();
    expect(changeAtCursor([], { side: 'modified', line: 1 })).toBeNull();
  });
});

describe('the merge edit', () => {
  /** Copies one change from `source` to `target` and answers the target's text and its log. */
  function merge(
    sourceText: string,
    targetText: string,
    change: DiffLineChange,
    direction: 'toModified' | 'toOriginal',
    o: { lineOnly?: boolean; cursor?: DiffCursor } = {},
  ): { text: string; log: string[] } | null {
    const source = new FakeModel(sourceText);
    const target = new FakeModel(targetText);
    const plan = mergePlan(change, direction, { lineOnly: o.lineOnly, cursor: o.cursor ?? { side: 'modified', line: change.modifiedStartLineNumber || 1 } });
    if (!plan) return null;
    const lines: string[] = [];
    for (let line = plan.sourceFrom; line < plan.sourceFrom + plan.sourceCount; line++) lines.push(source.getLineContent(line));
    const op = mergeOperation(plan, lines, target);
    if (!op) return null;
    target.pushEditOperations(null, [op], () => null);
    return { text: target.text, log: target.log };
  }

  const change = (os: number, oe: number, ms: number, me: number): DiffLineChange => ({
    originalStartLineNumber: os,
    originalEndLineNumber: oe,
    modifiedStartLineNumber: ms,
    modifiedEndLineNumber: me,
  });

  it('modifies: replaces the target’s lines by the source’s', () => {
    // original A B C, modified A X Y C (lines 2..3 replace 2..2)
    expect(merge('A\nB\nC', 'A\nX\nY\nC', change(2, 2, 2, 3), 'toModified')?.text).toBe('A\nB\nC');
    expect(merge('A\nX\nY\nC', 'A\nB\nC', change(2, 2, 2, 3), 'toOriginal')?.text).toBe('A\nX\nY\nC');
  });

  it('inserts where the target has nothing, in the middle', () => {
    // modified has lines 2..3 more, after original line 1
    expect(merge('A\nX\nY\nB', 'A\nB', change(1, 0, 2, 3), 'toOriginal')?.text).toBe('A\nX\nY\nB');
  });

  it('deletes where the source has nothing', () => {
    expect(merge('A\nB', 'A\nX\nY\nB', change(1, 0, 2, 3), 'toModified')?.text).toBe('A\nB');
  });

  it('inserts at the start of the file', () => {
    expect(merge('X\nA', 'A', change(0, 0, 1, 1), 'toOriginal')?.text).toBe('X\nA');
  });

  it('inserts at the end of the file, breaking the line in front', () => {
    expect(merge('A\nB\nC', 'A\nB', change(2, 0, 3, 3), 'toOriginal')?.text).toBe('A\nB\nC');
  });

  it('inserts after the empty last line of a file that ends in a line break', () => {
    // 'A\n' is the lines A and ''; the new line goes in front of the empty one
    expect(merge('A\nX\n', 'A\n', change(1, 0, 2, 2), 'toOriginal')?.text).toBe('A\nX\n');
  });

  it('deletes the last lines, taking the break in front of them', () => {
    expect(merge('A', 'A\nB\nC', change(1, 0, 2, 3), 'toModified')?.text).toBe('A');
  });

  it('deletes the whole document', () => {
    // an empty document is one empty line, which replaces the one line
    expect(merge('', 'A', change(1, 1, 1, 1), 'toModified')?.text).toBe('');
  });

  it('copies one line of a modified block, paired by position', () => {
    // block of two lines on each side; the cursor is on the second modified line
    const c = change(2, 3, 2, 3);
    const result = merge('A\nB1\nB2\nC', 'A\nX1\nX2\nC', c, 'toModified', { lineOnly: true, cursor: { side: 'modified', line: 3 } });
    expect(result?.text).toBe('A\nX1\nB2\nC');
    expect(merge('A\nB1\nB2\nC', 'A\nX1\nX2\nC', c, 'toModified', { lineOnly: true, cursor: { side: 'modified', line: 2 } })?.text).toBe('A\nB1\nX2\nC');
  });

  it('copies one line from the pane the cursor is in, by position in its block', () => {
    const c = change(2, 3, 2, 3);
    expect(merge('A\nB1\nB2\nC', 'A\nX1\nX2\nC', c, 'toModified', { lineOnly: true, cursor: { side: 'original', line: 3 } })?.text).toBe('A\nX1\nB2\nC');
  });

  it('copies one line into the end of a shorter block, and deletes one past a shorter source', () => {
    // original has B1 B2, modified has only X1: the second original line goes in behind
    const c = change(2, 3, 2, 2);
    expect(merge('A\nB1\nB2\nC', 'A\nX1\nC', c, 'toModified', { lineOnly: true, cursor: { side: 'original', line: 3 } })?.text).toBe('A\nX1\nB2\nC');
    // the other way: line 2 of the modified block has no original line, so it goes
    expect(merge('A\nB1\nC', 'A\nX1\nX2\nC', change(2, 2, 2, 3), 'toModified', { lineOnly: true, cursor: { side: 'modified', line: 3 } })?.text).toBe('A\nX1\nC');
  });

  it('copies one inserted line into a target with no block', () => {
    expect(merge('A\nN1\nN2\nB', 'A\nB', change(1, 0, 2, 3), 'toOriginal', { lineOnly: true, cursor: { side: 'modified', line: 3 } })?.text).toBe('A\nN2\nB');
  });

  it('plans nothing for a line-only copy with nothing on either side', () => {
    expect(mergePlan(change(2, 0, 3, 0), 'toModified', { lineOnly: true, cursor: { side: 'modified', line: 3 } })).toBeNull();
  });

  it('is one operation between two stack elements, so one undo takes it back', () => {
    // The service pushes the stack elements around it; here the operation itself is single.
    const target = new FakeModel('A\nB');
    const op = mergeOperation({ sourceFrom: 1, sourceCount: 1, targetAt: 2, targetRemove: 1 }, ['X'], target);
    expect(op).not.toBeNull();
    expect(op?.range).toEqual({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 });
  });
});

// ---------------------------------------------------------------------------
// The service: review mode, saved options, merge, export, two files
// ---------------------------------------------------------------------------

describe('review mode and the saved options', () => {
  let h: Harness;
  let a: DocId;
  let b: DocId;

  beforeEach(() => {
    h = harness();
    a = h.docs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    b = h.docs.add(newDoc({ path: '/nc/B.nc', untitledIndex: null }));
    h.docs.activate(a);
    h.texts.set(a, 'N10 G01 X10.000\n(NOTE)\nN20 G0 Z5.');
    h.texts.set(b, 'G1 X10.\nG0 Z5.');
    h.machines.set(a, machine('Mill', 'k'));
    h.machines.set(b, machine('Mill', 'k'));
  });

  it('starts from the profile’s defaults and shows the documents themselves in raw mode', async () => {
    await h.service.open(a, { kind: 'document', docId: b });
    expect(get(h.service.options)).toEqual(compareDefaults(appProfiles.profile('fanuc-gcode')));
    expect(get(h.service.reviewInfo)).toMatchObject({ profileId: 'fanuc-gcode' });
    expect(get(h.service.review)).toBeNull();
    expect(get(h.service.sides)).toEqual({
      original: { kind: 'document', docId: b },
      modified: { kind: 'document', docId: a },
    });
  });

  it('switches to the normalized copies and back', async () => {
    await h.service.open(a, { kind: 'document', docId: b });
    h.service.setMode('review');
    const review = get(h.service.review);
    expect(review?.modified.text).toBe(review?.original.text);
    expect(get(h.service.sides)).toEqual({
      // a calculator-type machine: the point means nothing, so `X10.` is `X10`
      original: { kind: 'text', text: 'G1 X10\nG0 Z5', languageId: 'fanuc-gcode' },
      modified: { kind: 'text', text: 'G1 X10\nG0 Z5', languageId: 'fanuc-gcode' },
    });
    h.service.toggleMode();
    expect(get(h.service.mode)).toBe('raw');
    expect(get(h.service.review)).toBeNull();
    expect(get(h.service.sides)?.modified).toEqual({ kind: 'document', docId: a });
  });

  it('rebuilds the copies when a toggle changes', async () => {
    await h.service.open(a, { kind: 'document', docId: b });
    h.service.setMode('review');
    h.service.setOptions({ ignoreComments: false });
    expect(get(h.service.review)?.modified.text).toContain('(NOTE)');
    expect(get(h.service.review)?.modified.text).not.toBe(get(h.service.review)?.original.text);
  });

  it('reads each side with its own machine and says when they differ', async () => {
    h.machines.set(a, machine('Mill 1', 'k1'));
    h.machines.set(b, machine('Mill 2', 'k2'));
    await h.service.open(a, { kind: 'document', docId: b });
    h.service.setMode('review');
    expect(get(h.service.review)?.notes.map((n) => n.reason)).toEqual(['machines']);
  });

  it('reads a file that is not a document with no machine, in its own detected profile', async () => {
    h.disk.set('/other/C.nc', decoded('G1 X10.'));
    h.detect.mockReturnValue('sinumerik');
    h.machines.set(a, machine('Mill 1', 'k1'));
    await h.service.open(a, { kind: 'file', path: '/other/C.nc' });
    h.service.setMode('review');
    const reasons = get(h.service.review)?.notes.map((n) => n.reason) ?? [];
    expect(reasons).toContain('noMachine');
    expect(reasons).toContain('profiles');
    expect(get(h.service.review)?.original.languageId).toBe('sinumerik');
  });

  it('reads the saved version with the document’s own profile and machine', async () => {
    h.disk.set('/nc/A.nc', decoded('G1 X10.\nG0 Z5.'));
    h.machines.set(a, machine('Mill 1', 'k1'));
    await h.service.open(a, { kind: 'saved' });
    h.service.setMode('review');
    expect(get(h.service.review)?.notes).toEqual([]);
  });

  it('saves only what differs from the profile’s defaults, with the mode and the view', async () => {
    await h.service.open(a, { kind: 'document', docId: b });
    h.service.setOptions({ ignoreCase: true });
    expect(h.memory.value).toEqual({
      mode: 'raw',
      inline: false,
      ignoreTrimWhitespace: false,
      review: { 'fanuc-gcode': { ignoreCase: true } },
    });
    h.service.setOptions({ ignoreCase: false });
    expect(h.memory.value).toEqual({ mode: 'raw', inline: false, ignoreTrimWhitespace: false });
    h.service.setMode('review');
    h.service.toggleInline();
    h.service.setIgnoreTrimWhitespace(true);
    expect(h.memory.value).toEqual({ mode: 'review', inline: true, ignoreTrimWhitespace: true });
  });

  it('opens the next session the way the last one was left, from the saved memory', async () => {
    h.memory.value = {
      mode: 'review',
      inline: true,
      review: { 'fanuc-gcode': { ignoreCase: true }, other: { ignoreComments: false } },
    };
    await h.service.open(a, { kind: 'document', docId: b });
    expect(get(h.service.mode)).toBe('review');
    expect(get(h.service.view)).toEqual({ inline: true, ignoreTrimWhitespace: false });
    expect(get(h.service.options)).toEqual({ ...compareDefaults(appProfiles.profile('fanuc-gcode')), ignoreCase: true });
    expect(get(h.service.review)).not.toBeNull();
    // a profile's entry the user never touches stays where it was
    h.service.setOptions({ ignoreWhitespace: false });
    expect((h.memory.value as CompareMemo).review).toEqual({
      'fanuc-gcode': { ignoreCase: true, ignoreWhitespace: false },
      other: { ignoreComments: false },
    });
  });

  it('falls back to the defaults on a memory that is not what it should be', async () => {
    h.memory.value = { mode: 7, review: 'x', inline: 'no' };
    await h.service.open(a, { kind: 'document', docId: b });
    expect(get(h.service.mode)).toBe('raw');
    expect(get(h.service.view)).toEqual({ inline: false, ignoreTrimWhitespace: false });
    expect(get(h.service.options)).toEqual(compareDefaults(appProfiles.profile('fanuc-gcode')));
  });

  it('forgets a profile’s saved toggles with "Profile defaults"', async () => {
    await h.service.open(a, { kind: 'document', docId: b });
    h.service.setOptions({ ignoreCase: true, ignoreComments: false });
    h.service.resetOptions();
    expect(get(h.service.options)).toEqual(compareDefaults(appProfiles.profile('fanuc-gcode')));
    expect((h.memory.value as CompareMemo).review).toBeUndefined();
  });

  it('goes to a line of the file through the line map in review mode', async () => {
    h.diff = new FakeDiff();
    await h.service.open(a, { kind: 'document', docId: b });
    expect(h.service.goToLine(3)).toBe(true); // raw: the line itself
    h.service.setMode('review');
    expect(h.service.goToLine(3)).toBe(true); // line 3 of the file is review line 2
    expect(h.service.goToLine(2, 'original')).toBe(true);
    expect(h.service.goToLine(99)).toBe(false);
    expect(h.service.goToLine(0)).toBe(false);
    expect(h.diff.calls).toEqual(['reveal:modified:3', 'reveal:modified:2', 'reveal:original:2']);
  });

  it('says so when there is no such line (CODE-13)', async () => {
    h.diff = new FakeDiff();
    await h.service.open(a, { kind: 'document', docId: b });
    h.service.setMode('review');
    h.messages.length = 0;
    expect(h.service.goToLine(9999)).toBe(false);
    expect(h.service.goToLine(Number(''))).toBe(false);
    expect(h.messages).toEqual([`!${t('compare.noSuchLine')}`, `!${t('compare.noSuchLine')}`]);
  });

  it('forgets the review with the session', async () => {
    await h.service.open(a, { kind: 'document', docId: b });
    h.service.setMode('review');
    h.service.close();
    expect(get(h.service.review)).toBeNull();
    expect(get(h.service.sides)).toBeNull();
    expect(get(h.service.reviewInfo)).toBeNull();
    expect(get(h.service.mode)).toBe('review'); // the mode is the user's, not the session's
  });
});

describe('open while the world moves (CODE-10)', () => {
  it('gives up when the document is closed during the read', async () => {
    const h = harness();
    const a = h.docs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    h.docs.activate(a);
    const opening = h.service.open(a, { kind: 'saved' });
    h.docs.remove(a);
    expect(await opening).toBe(false);
    expect(get(h.service.session)).toBeNull();
    expect(get(h.layout.state).overlay).not.toBe(COMPARE_PANEL_ID);
  });

  it('lets only the newest of two overlapping opens commit', async () => {
    const h = harness();
    const a = h.docs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    h.docs.activate(a);
    h.disk.set('/nc/A.nc', decoded('SAVED'));
    h.disk.set('/nc/other.nc', decoded('OTHER'));
    const first = h.service.open(a, { kind: 'saved' });
    const second = h.service.open(a, { kind: 'file', path: '/nc/other.nc' });
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(get(h.service.content)?.original).toMatchObject({ text: 'OTHER' });
  });
});

describe('copyChange', () => {
  let h: Harness;
  let a: DocId;
  let b: DocId;
  let diff: FakeDiff;

  beforeEach(async () => {
    h = harness();
    a = h.docs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    b = h.docs.add(newDoc({ path: '/nc/B.nc', untitledIndex: null }));
    h.docs.activate(a);
    diff = new FakeDiff();
    diff.models.original = new FakeModel('A\nB\nC');
    diff.models.modified = new FakeModel('A\nX\nY\nC');
    diff.changes = [{ originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 3 }];
    diff.cursorAt = { side: 'modified', line: 3 };
    h.diff = diff;
    await h.service.open(a, { kind: 'document', docId: b });
  });

  it('refuses while the diff is stale, so a held key or a double click copies once (CODE-1)', async () => {
    diff.current = false;
    h.messages.length = 0;
    expect(await h.service.copyChange('toModified')).toBe(false);
    expect(diff.models.modified.text).toBe('A\nX\nY\nC'); // nothing written
    expect(diff.models.modified.log).toEqual([]);
    expect(h.messages).toEqual([`!${t('compare.copyBusy')}`]);
    diff.current = true;
    expect(await h.service.copyChange('toModified')).toBe(true);
    expect(diff.models.modified.text).toBe('A\nB\nC');
  });

  it('copies the block to the modified side as one undo step', async () => {
    expect(await h.service.copyChange('toModified')).toBe(true);
    expect(diff.models.modified.text).toBe('A\nB\nC');
    expect(diff.models.modified.log).toEqual(['stack', 'edit', 'stack']);
    expect(diff.models.original.log).toEqual([]);
    expect(diff.calls).toEqual([]);
  });

  it('copies the block to the original when it is an open document', async () => {
    expect(await h.service.copyChange('toOriginal')).toBe(true);
    expect(diff.models.original.text).toBe('A\nX\nY\nC');
    expect(diff.models.original.log).toEqual(['stack', 'edit', 'stack']);
  });

  it('copies one line with lineOnly', async () => {
    expect(await h.service.copyChange('toOriginal', { lineOnly: true })).toBe(true);
    // the cursor is on the second modified line of the block, the original has one line
    expect(diff.models.original.text).toBe('A\nB\nY\nC');
  });

  it('moves on to the next change once the diff has been updated, past the block it dealt with', async () => {
    expect(await h.service.copyChange('toModified', { thenNext: true })).toBe(true);
    expect(diff.calls).toEqual(['reveal:modified:2', 'next']);
    diff.calls.length = 0;
    diff.models.original = new FakeModel('A\nB\nC');
    diff.models.modified = new FakeModel('A\nX\nY\nC');
    expect(await h.service.copyChange('toOriginal', { thenNext: true })).toBe(true);
    expect(diff.calls).toEqual(['reveal:modified:3', 'next']);
  });

  it('refuses in review mode, and says so', async () => {
    h.service.setMode('review');
    expect(await h.service.copyChange('toModified')).toBe(false);
    expect(h.messages).toEqual([`!${t('compare.copyReview')}`]);
    expect(diff.models.modified.log).toEqual([]);
    expect(get(h.service.copyBlock)).toEqual({ toModified: 'review', toOriginal: 'review' });
  });

  it('refuses to write an original that is not an open document', async () => {
    h.service.close();
    h.disk.set('/nc/A.nc', decoded('SAVED'));
    await h.service.open(a, { kind: 'saved' });
    expect(get(h.service.copyBlock)).toEqual({ toModified: null, toOriginal: 'notDocument' });
    expect(await h.service.copyChange('toOriginal')).toBe(false);
    expect(h.messages).toEqual([`!${t('compare.copyNotDocument')}`]);
    expect(diff.models.original.log).toEqual([]);
    // the modified side is still a target
    expect(await h.service.copyChange('toModified')).toBe(true);
  });

  it('refuses a locked target', async () => {
    h.docs.update(a, { readOnly: true, readOnlyReason: 'user' });
    expect(await h.service.copyChange('toModified')).toBe(false);
    expect(h.messages).toEqual([`!${t('compare.copyLocked')}`]);
    expect(get(h.service.copyBlock).toModified).toBe('locked');
    expect(await h.service.copyChange('toOriginal')).toBe(true);
    h.docs.update(a, { readOnly: false, readOnlyReason: null });
    h.docs.update(b, { readOnly: true, readOnlyReason: 'user' });
    expect(await h.service.copyChange('toOriginal')).toBe(false);
  });

  it('says when there is no change at the cursor, or no diff yet', async () => {
    diff.cursorAt = { side: 'modified', line: 1 };
    expect(await h.service.copyChange('toModified')).toBe(false);
    diff.changes = null;
    expect(await h.service.copyChange('toModified')).toBe(false);
    h.diff = null;
    expect(await h.service.copyChange('toModified')).toBe(false);
    expect(h.messages).toEqual(Array(3).fill(`!${t('compare.copyNoChange')}`));
  });

  it('does nothing with no comparison open', async () => {
    h.service.close();
    expect(await h.service.copyChange('toModified')).toBe(false);
    expect(diff.models.modified.log).toEqual([]);
  });
});

describe('exportDiff', () => {
  let h: Harness;
  let a: DocId;
  let b: DocId;

  beforeEach(() => {
    h = harness();
    a = h.docs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null, title: 'A.nc' } as Partial<NewDocMeta>));
    b = h.docs.add(newDoc({ path: '/nc/B.nc', untitledIndex: null }));
    h.docs.activate(a);
    h.texts.set(a, 'N10 G01 X10.000\nG0 Z5.');
    h.texts.set(b, 'G1 X10.\nG0 Z6.');
  });

  it('writes the raw unified diff into a new untitled document and ends the comparison', async () => {
    await h.service.open(a, { kind: 'document', docId: b });
    const id = await h.service.exportDiff({ normalized: false });
    expect(id).not.toBeNull();
    expect(h.untitled).toHaveLength(1);
    const text = h.untitled[0].text;
    expect(text).toContain('--- ');
    expect(text).toContain('-G1 X10.');
    expect(text).toContain('+N10 G01 X10.000');
    expect(text).toContain('-G0 Z6.');
    expect(h.untitled[0]).toMatchObject({ profileId: 'fanuc-gcode', activate: false });
    expect(get(h.service.session)).toBeNull();
    expect(h.docs.getActiveId()).toBe(id);
    // CODE-5: the view state is not restored into whatever the editor shows a frame later
    // (the new tab); the compared document gets its own state from the editor service.
    expect(h.restored).toEqual([]);
  });

  it('exports the normalized sides in review mode, where only the real change is left', async () => {
    await h.service.open(a, { kind: 'document', docId: b });
    h.service.setMode('review');
    await h.service.exportDiff({ normalized: true });
    const text = h.untitled[0].text;
    expect(text).not.toContain('N10');
    expect(text).toContain('-G0 Z6.');
    expect(text).toContain('+G0 Z5.');
    expect(text).toContain(' G1 X10.');
  });

  it('exports the normalized sides from raw mode too, when asked', async () => {
    await h.service.open(a, { kind: 'document', docId: b });
    await h.service.exportDiff({ normalized: true });
    expect(h.untitled[0].text).not.toContain('N10');
  });

  it('says so, and opens nothing, when there is no difference', async () => {
    h.texts.set(b, 'N10 G01 X10.000\nG0 Z5.');
    await h.service.open(a, { kind: 'document', docId: b });
    expect(await h.service.exportDiff({ normalized: false })).toBeNull();
    expect(h.untitled).toEqual([]);
    expect(h.messages).toEqual([t('compare.noDifferences')]);
    expect(get(h.service.session)).not.toBeNull();
  });

  it('names a file or saved original by its file name', async () => {
    h.disk.set('/other/C.nc', decoded('G1 X1.'));
    await h.service.open(a, { kind: 'file', path: '/other/C.nc' });
    await h.service.exportDiff({ normalized: false });
    expect(h.untitled[0].text.split('\n')[0]).toBe('--- C.nc');
    h.service.close();
    h.disk.set('/nc/A.nc', decoded('G1 X1.'));
    h.docs.activate(a);
    await h.service.open(a, { kind: 'saved' });
    await h.service.exportDiff({ normalized: false });
    expect(h.untitled[1].text.split('\n')[0]).toBe(`--- ${t('compare.sideSaved', { name: meta(h.docs, a).title })}`);
  });

  it('does nothing with no comparison open', async () => {
    expect(await h.service.exportDiff({ normalized: false })).toBeNull();
    expect(h.messages).toEqual([`!${t('compare.noDocument')}`]);
  });
});

describe('openFiles', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  function answer(ids: DocId[]): void {
    h.openAnswer = () => ids;
  }

  it('picks what is missing, opens both as documents and compares the second with the first', async () => {
    const x = h.docs.add(newDoc({ path: '/nc/X.nc', untitledIndex: null }));
    const y = h.docs.add(newDoc({ path: '/nc/Y.nc', untitledIndex: null }));
    answer([x, y]);
    h.picks.push('/nc/X.nc', '/nc/Y.nc');
    expect(await h.service.openFiles()).toBe(true);
    expect(h.opened).toEqual([['/nc/X.nc', '/nc/Y.nc']]);
    expect(get(h.service.session)).toMatchObject({ docId: y, source: { kind: 'document', docId: x } });
    expect(h.docs.getActiveId()).toBe(y);
  });

  it('asks only for the second file when the first is given, and for none when both are', async () => {
    const x = h.docs.add(newDoc({ path: '/nc/X.nc', untitledIndex: null }));
    const y = h.docs.add(newDoc({ path: '/nc/Y.nc', untitledIndex: null }));
    answer([x, y]);
    h.picks.push('/nc/Y.nc');
    expect(await h.service.openFiles('/nc/X.nc')).toBe(true);
    expect(h.picks).toEqual([]);
    h.service.close();
    expect(await h.service.openFiles('/nc/X.nc', '/nc/Y.nc')).toBe(true);
  });

  it('stops quietly when a pick is cancelled', async () => {
    h.picks.push(null);
    expect(await h.service.openFiles()).toBe(false);
    h.picks.push('/nc/X.nc', null);
    expect(await h.service.openFiles()).toBe(false);
    expect(h.opened).toEqual([]);
    expect(h.messages).toEqual([]);
  });

  it('refuses the same file twice', async () => {
    expect(await h.service.openFiles('/nc/X.nc', '/nc/X.nc')).toBe(false);
    expect(h.messages).toEqual([`!${t('compare.sameFile')}`]);
    expect(h.opened).toEqual([]);
  });

  it('does not compare when a file was refused (the open reported why)', async () => {
    const x = h.docs.add(newDoc({ path: '/nc/X.nc', untitledIndex: null }));
    answer([x]);
    expect(await h.service.openFiles('/nc/X.nc', '/nc/bin')).toBe(false);
    expect(get(h.service.session)).toBeNull();
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

  it('registers exactly the compare commands, and only `compare.with` and the two copy keys claim one', () => {
    expect([...byId.keys()]).toEqual([
      'compare.with',
      'compare.withDocument',
      'compare.withFile',
      'compare.withSaved',
      'compare.close',
      'compare.nextDiff',
      'compare.prevDiff',
      'compare.toggleInline',
      'compare.toggleReview',
      'compare.copyToModified',
      'compare.copyToOriginal',
      'compare.exportDiff',
      'compare.files',
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
      'compare.toggleReview': null,
      'compare.copyToModified': 'Mod+Alt+Right',
      'compare.copyToOriginal': 'Mod+Alt+Left',
      'compare.exportDiff': null,
      'compare.files': null,
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
    for (const id of [
      'compare.close',
      'compare.nextDiff',
      'compare.prevDiff',
      'compare.toggleInline',
      'compare.toggleReview',
      'compare.copyToModified',
      'compare.copyToOriginal',
      'compare.exportDiff',
    ]) {
      expect(byId.get(id)?.enabled?.(context()), id).toBe(false);
      expect(byId.get(id)?.enabled?.(context({ compareOpen: true })), id).toBe(true);
    }
  });

  it('needs no document for `compare.files`, and puts it next to `compare.with` on the Tools tab', () => {
    expect(byId.get('compare.files')?.enabled).toBeUndefined();
    expect(compareContribution.ribbon).toContainEqual({ tab: 'tools', group: 'compare.group', command: 'compare.files', order: 11 });
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
    compare.setMode('raw');
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

  it('carries the mode, the toggles, the copy and export controls (§7.12)', async () => {
    const a = appDocs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    const b = appDocs.add(newDoc({ path: '/nc/B.nc', untitledIndex: null }));
    await compare.open(a, { kind: 'document', docId: b });

    const raw = render(CompareView).body;
    expect(raw).toContain('data-mode="raw"');
    expect(raw).toContain('data-testid="compare-copy"');
    expect(raw).toContain('data-testid="compare-export"');
    expect(raw).not.toContain('data-testid="compare-option"');

    compare.setMode('review');
    const review = render(CompareView).body;
    expect(review).toContain('data-testid="compare-view" data-source="document" data-mode="review"');
    for (const option of ['ignoreBlockNumbers', 'ignoreWhitespace', 'ignoreComments', 'ignoreCase', 'ignoreNumberFormat']) {
      expect(review).toContain(`data-option="${option}"`);
    }
    expect(review).toContain('data-testid="compare-defaults"');
    expect(review).toContain('data-profile-id="fanuc-gcode"');
    // review mode copies nothing
    expect(review).toMatch(/data-direction="toModified"[^>]*data-disabled="true"/);
    expect(review).toMatch(/data-direction="toModified"[^>]*aria-disabled="true"/); // CODE-18
    expect(review).toContain(t('compare.copyTitle', { action: t('compare.copyToModified') }));
    expect(review).toMatch(/data-normalized="true"/);
  });

  it('says so instead of mounting a diff when there is no session', () => {
    const html = render(CompareView).body;
    expect(html).toContain('data-source=""');
    expect(html).toContain(t('compare.empty'));
  });
});
