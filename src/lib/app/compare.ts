// Comparing a document with another document, a file or its saved version
// (plan §7.3, §5 WP2.5). Owner: WP2.5.
//
// The comparison lives in the `overlay` region, so it replaces the editor rather than
// splitting the window. The modified side is the compared document's live model and stays
// editable; the original side is the other document's model, or a temporary read-only
// model built from `files.readDisk`, which is disposed on close. A side above 50 MB is
// refused with a status error, because Monaco does not sync such a model to the worker
// and the diff would never arrive (F8). A file side is measured by its stat *before* it is
// read, the way `files.open` does it, so an oversized pick never enters the webview.
//
// `createCompareService(deps)` plus a default singleton wired to the real modules (AD-2).
// Beyond the §7.3 contract the controller carries what only `CompareView` and
// `contrib/compare.ts` need: the prepared original (`content`), and the two toolbar
// options, which are remembered for the session so the next comparison opens the way the
// last one was left.
//
// Closing is funnelled through one place. The overlay's own ✕ (PanelHost) and anything
// else that changes `layout.overlay` go through the layout subscription below, so a
// temporary model is disposed and the editor's view state restored no matter who closed
// the view.

import { derived, get, writable, type Readable } from 'svelte/store';
import { files as appFiles, formatBytes, MAX_OPEN_BYTES } from '$lib/app/fileOps';
import { status as appStatus } from '$lib/app/status';
import { filesStat } from '$lib/platform/commands';
import { isTauriRuntime } from '$lib/utils/platform';
import { docs as appDocs } from '$lib/stores/documents';
import { layout as appLayout } from '$lib/stores/layout';
import { profiles as appProfiles } from '$lib/stores/profiles';
import {
  captureEditorViewState,
  modelCharCount,
  restoreEditorViewState,
  MODEL_SYNC_LIMIT_CHARS,
  type DiffOriginal,
} from '$lib/monaco/diff';
import { t } from '$lib/i18n';
import type {
  CompareService,
  CompareSource,
  DecodeResult,
  DocId,
  DocMeta,
  DocumentStore,
  LayoutStore,
  ProfileRegistry,
  StatusService,
} from '$lib/app/types';

/** The id `contrib/compare.ts` registers the overlay panel under. */
export const COMPARE_PANEL_ID = 'compare';

/** The open comparison, exactly as §7.3 describes it. */
export interface CompareSession {
  docId: DocId;
  source: CompareSource;
  title: string;
}

/** A session plus the prepared original side; `CompareView` reads this one. */
export interface CompareContent extends CompareSession {
  original: DiffOriginal;
}

/** The toolbar's two live options. */
export interface DiffOptions {
  inline: boolean;
  ignoreTrimWhitespace: boolean;
}

/** The §7.3 service plus what the view and the contribution need. Not part of §7.3. */
export interface CompareController extends CompareService {
  readonly content: Readable<CompareContent | null>;
  readonly options: Readable<DiffOptions>;
  setInline(inline: boolean): void;
  setIgnoreTrimWhitespace(ignore: boolean): void;
  toggleInline(): void;
}

export interface CompareDeps {
  docs: DocumentStore;
  layout: LayoutStore;
  status: StatusService;
  profiles: Pick<ProfileRegistry, 'detect'>;
  readDisk(path: string): Promise<DecodeResult | null>;
  /**
   * The file's size in bytes, or null when it cannot be told. Asked BEFORE `readDisk`,
   * so the 50 MB guard can refuse a pick without pulling it through IPC first (G8 M2).
   */
  statSize(path: string): Promise<number | null>;
  /** The document's length in UTF-16 code units, for the 50 MB guard (F8). */
  charCountOf(docId: DocId): number;
  captureViewState(): unknown;
  restoreViewState(snapshot: unknown): void;
}

// ---------------------------------------------------------------------------
// Pure helpers (target selection; exported for the unit tests)
// ---------------------------------------------------------------------------

export type CompareSourceKind = CompareSource['kind'];

/**
 * What `compare.with` can offer for `doc` right now, in the order the QuickPick shows:
 * the saved version needs a path, another document needs a second tab, a file always
 * works. An empty list means there is nothing to compare at all.
 */
export function availableSources(doc: DocMeta | undefined, openCount: number): CompareSourceKind[] {
  if (!doc) return [];
  const kinds: CompareSourceKind[] = [];
  if (doc.path !== null) kinds.push('saved');
  if (openCount > 1) kinds.push('document');
  kinds.push('file');
  return kinds;
}

/** Every open document but `docId`: what `compare.withDocument` may be held against. */
export function documentTargets(all: DocMeta[], docId: DocId): DocMeta[] {
  return all.filter((doc) => doc.id !== docId);
}

/**
 * The document to compare with without asking. With exactly two tabs open there is only
 * one answer, so the QuickPick would be a pointless keystroke; with more, the user picks.
 */
export function autoTarget(all: DocMeta[], docId: DocId): DocId | null {
  const others = documentTargets(all, docId);
  return others.length === 1 ? others[0].id : null;
}

/** False when a side is too large for Monaco's diff worker (F8). */
export function withinCompareLimit(chars: number): boolean {
  return chars <= MODEL_SYNC_LIMIT_CHARS;
}

/** The translated title of a comparison; `other` is the document or file it is held against. */
export function compareTitle(docTitle: string, source: CompareSource, other: string): string {
  if (source.kind === 'saved') return t('compare.titleSaved', { name: docTitle });
  if (source.kind === 'document') return t('compare.titleDocument', { name: docTitle, other });
  return t('compare.titleFile', { name: docTitle, file: other });
}

/** `basename` of a path, for the title of a file comparison. */
function fileName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? path : path.slice(cut + 1);
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createCompareService(deps: CompareDeps): CompareController {
  const content = writable<CompareContent | null>(null);
  const options = writable<DiffOptions>({ inline: false, ignoreTrimWhitespace: false });
  let snapshot: unknown = null;

  function fail(key: string, params?: Record<string, string | number>): false {
    deps.status.show(t(key, params), { error: true });
    return false;
  }

  function tooLarge(): false {
    return fail('compare.tooLarge', { limit: formatBytes(MODEL_SYNC_LIMIT_CHARS) });
  }

  /** Clears the session, closes the overlay if it is still ours, and restores the editor. */
  function finish(): void {
    if (get(content) === null) return;
    content.set(null);
    if (get(deps.layout.state).overlay === COMPARE_PANEL_ID) deps.layout.closeOverlay();
    const restoring = snapshot;
    snapshot = null;
    deps.restoreViewState(restoring);
  }

  // Whoever closes the overlay closes the comparison: the ✕ in the panel header, another
  // overlay panel taking the region, or a restored layout. `finish()` clears the session
  // first, so the `closeOverlay()` it may call cannot come back around.
  deps.layout.state.subscribe((state) => {
    if (state.overlay !== COMPARE_PANEL_ID) finish();
  });

  // A comparison belongs to one document: switching tabs or closing it ends the session
  // rather than leaving a diff that no longer matches the tab bar.
  deps.docs.activeId.subscribe((id) => {
    const open = get(content);
    if (open && id !== open.docId) finish();
  });
  deps.docs.list.subscribe((list) => {
    const open = get(content);
    if (open && !list.some((doc) => doc.id === open.docId)) finish();
  });

  /** The read-only side of a file or saved-version comparison. */
  async function originalFromDisk(
    path: string,
    fallbackProfileId: string,
    detect: boolean,
  ): Promise<DiffOriginal | null> {
    // The stat runs BEFORE the read, the way `files.open` does it (fileOps.ts, G8 F4):
    // `dialogs.pickFile` has no filters, so the user can pick a disk image or a database,
    // and reading first would mean a multi-gigabyte file is already in the webview by the
    // time it is refused. `MAX_OPEN_BYTES` and `MODEL_SYNC_LIMIT_CHARS` are the same 50 MB
    // and a byte is never fewer than a UTF-16 code unit's worth of file, so this refuses
    // only what the exact check below would refuse anyway.
    const size = await deps.statSize(path);
    if (size !== null && size > MAX_OPEN_BYTES) {
      tooLarge();
      return null;
    }
    const decoded = await deps.readDisk(path);
    if (!decoded) {
      fail('compare.readFailed', { file: fileName(path) });
      return null;
    }
    if (!decoded.ok) {
      deps.status.show(t(decoded.message.key, decoded.message.params), { error: true });
      return null;
    }
    if (!withinCompareLimit(decoded.text.length)) {
      tooLarge();
      return null;
    }
    return {
      kind: 'text',
      text: decoded.text,
      languageId: detect ? deps.profiles.detect(path, decoded.text, fallbackProfileId) : fallbackProfileId,
    };
  }

  async function open(docId: DocId, source: CompareSource): Promise<boolean> {
    const doc = deps.docs.get(docId);
    if (!doc) return fail('compare.noDocument');
    if (!withinCompareLimit(deps.charCountOf(docId))) return tooLarge();

    let original: DiffOriginal | null;
    let other: string;

    if (source.kind === 'document') {
      if (source.docId === docId) return fail('compare.sameDocument');
      const target = deps.docs.get(source.docId);
      if (!target) return fail('compare.noDocument');
      if (!withinCompareLimit(deps.charCountOf(source.docId))) return tooLarge();
      original = { kind: 'document', docId: source.docId };
      other = target.title;
    } else if (source.kind === 'saved') {
      if (doc.path === null) return fail('compare.untitled');
      original = await originalFromDisk(doc.path, doc.profileId, false);
      other = fileName(doc.path);
    } else {
      original = await originalFromDisk(source.path, doc.profileId, true);
      other = fileName(source.path);
    }
    if (!original) return false;

    // The modified side is the document on screen, so it has to be the active tab; the
    // view state is taken after the switch, because that is what `close()` puts back.
    // Comparing again without closing keeps the first snapshot: the editor is unmounted
    // while the overlay is up, so a second capture would only record the state the
    // detached editor already had.
    if (deps.docs.getActiveId() !== docId) deps.docs.activate(docId);
    if (get(content) === null) snapshot = deps.captureViewState();

    content.set({ docId, source, title: compareTitle(doc.title, source, other), original });
    deps.layout.openOverlay(COMPARE_PANEL_ID);
    return true;
  }

  return {
    session: derived(content, (c) =>
      c === null ? null : { docId: c.docId, source: c.source, title: c.title },
    ),
    open,
    close: finish,

    content: derived(content, (c) => c),
    options: derived(options, (o) => o),
    setInline(inline: boolean): void {
      options.update((o) => (o.inline === inline ? o : { ...o, inline }));
    },
    setIgnoreTrimWhitespace(ignore: boolean): void {
      options.update((o) => (o.ignoreTrimWhitespace === ignore ? o : { ...o, ignoreTrimWhitespace: ignore }));
    },
    toggleInline(): void {
      options.update((o) => ({ ...o, inline: !o.inline }));
    },
  };
}

/** The application-wide compare service. */
export const compareController: CompareController = createCompareService({
  docs: appDocs,
  layout: appLayout,
  status: appStatus,
  profiles: appProfiles,
  readDisk: (path) => appFiles.readDisk(path),
  async statSize(path) {
    if (!isTauriRuntime()) return null;
    try {
      const [stat] = await filesStat([path]);
      return stat?.allowed === true && stat.exists ? stat.size : null;
    } catch (err) {
      // A stat decides nothing on its own: the read that follows reports the real problem.
      console.warn('files_stat failed', err);
      return null;
    }
  },
  charCountOf: modelCharCount,
  captureViewState: captureEditorViewState,
  restoreViewState: (snapshot) =>
    restoreEditorViewState(snapshot as ReturnType<typeof captureEditorViewState>),
});

/** The §7.3 view of the same object. */
export const compare: CompareService = compareController;
