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
// `contrib/compare.ts` need: the prepared original (`content`), the panes' content
// (`sides`), the raw view's two options (`view`) and the review bar's facts (`review`).
//
// M11 (§7.7, AD-26): the review mode, its toggles (`options`), the merge, the export and
// "compare two files". The P1 view options were called `options` too; they are `view`
// now (`DiffViewOptions`, §7.16 #138), so `options` is §7.7's alone.
//
//  - Review mode normalizes each side with its own document's effective profile and
//    machine (`normalizeLines`, §7.7) and shows the two results in read-only scratch
//    models (`monaco/diff.ts`); `lineMap` takes "go to line" back to the original lines. A
//    side that is a file not open as a document has no machine, and the bar says so.
//  - The toggles start from `compareDefaults(profile)` with the user's saved changes over
//    them. What is saved is `state.json` `ui.lastParams.compare` (`CompareMemo`, §7.11,
//    §7.16 #137): the mode, the raw view's two options, and per profile only the toggles
//    that differ from its defaults. It is read once, on first use (the UI state is loaded
//    after this module is), member by member, so a bad file only brings the defaults back.
//  - The merge is raw mode only. `mergePlan`/`mergeOperation` are pure: from a Monaco line
//    change they work out which lines to read and which to replace, and the one edit goes
//    into the target model between two undo stack elements, so one Cmd+Z takes it back.
//
// Closing is funnelled through one place. The overlay's own ✕ (PanelHost) and anything
// else that changes `layout.overlay` go through the layout subscription below, so the
// session ends and the editor's view state is restored no matter who closed the view. The
// temporary models are not disposed (see `monaco/diff.ts`).

import { derived, get, writable, type Readable } from 'svelte/store';
import { dialogs as appDialogs } from '$lib/app/dialogs';
import { files as appFiles, formatBytes, MAX_OPEN_BYTES } from '$lib/app/fileOps';
import { status as appStatus } from '$lib/app/status';
import { filesStat } from '$lib/platform/commands';
import { isTauriRuntime } from '$lib/utils/platform';
import { docs as appDocs } from '$lib/stores/documents';
import { layout as appLayout } from '$lib/stores/layout';
import { machines as appMachines } from '$lib/stores/machines';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { uiState as appUiState } from '$lib/stores/uiState';
import {
  captureEditorViewState,
  currentDiff,
  modelCharCount,
  restoreEditorViewState,
  MODEL_SYNC_LIMIT_CHARS,
  type DiffCursor,
  type DiffHandle,
  type DiffLineChange,
  type DiffOriginal,
  type DiffSides,
} from '$lib/monaco/diff';
import type { LineOperation } from '$lib/monaco/applyLines';
import { editor as appEditor } from '$lib/monaco/editorService';
import { t } from '$lib/i18n';
import {
  compareDefaults,
  COMPARE_FALLBACK,
  COMPARE_MEMO_KEY,
  COMPARE_NOTE_KEYS,
  COMPARE_OPTION_KEYS,
  normalizeLines,
  pointSignificant,
  unifiedDiff,
  type CompareMemo,
  type CompareOptions,
  type Normalized,
  type NormalizeOverrides,
} from '$lib/core/compare';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { EffectiveMachine, EffectiveProfile } from '$lib/core/machines/types';
import type {
  CompareService,
  CompareSource,
  DecodeResult,
  DocId,
  DocMeta,
  DocumentStore,
  FileOps,
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

/** The raw view's two live options (the P1 toolbar). Not the review toggles of §7.7. */
export interface DiffViewOptions {
  inline: boolean;
  ignoreTrimWhitespace: boolean;
}

export type CompareMode = 'raw' | 'review';
export type CopyDirection = 'toModified' | 'toOriginal';

/** Why a copy is refused before the diff is even asked. */
export type CopyBlock = 'review' | 'notDocument' | 'locked';

/** One line of the review bar: what the user has to know to read the result. */
export interface ReviewNote {
  reason: 'machines' | 'blockNumbers' | 'noMachine' | 'profiles';
  text: string;
}

/** One normalized side: the text of its scratch model and the way back to the file's lines. */
export interface ReviewSide {
  text: string;
  /** `lineMap[i]` = the 1-based line of the file that review line `i + 1` came from. */
  lineMap: Int32Array;
  languageId: string;
}

/** The two normalized sides with what the bar says about them. */
export interface ReviewView {
  original: ReviewSide;
  modified: ReviewSide;
  notes: ReviewNote[];
}

/** Which profile the toggles belong to and what that profile starts them at. */
export interface ReviewInfo {
  profileId: string;
  defaults: CompareOptions;
}

/** The §7.3 service plus what the view and the contribution need. Not part of §7.3. */
export interface CompareController extends CompareService {
  readonly content: Readable<CompareContent | null>;
  /** P1's `options`, renamed in M11 (§7.16 #138). */
  readonly view: Readable<DiffViewOptions>;
  /** What the two panes show: the documents as they are, or the normalized copies. */
  readonly sides: Readable<DiffSides | null>;
  /** The review bar's facts; null in raw mode and with no comparison. */
  readonly review: Readable<ReviewView | null>;
  /** The profile of the compared document and its defaults (the "Profile defaults" button). */
  readonly reviewInfo: Readable<ReviewInfo | null>;
  /** Per direction: why a copy is not offered right now, or null. */
  readonly copyBlock: Readable<Record<CopyDirection, CopyBlock | null>>;
  setInline(inline: boolean): void;
  setIgnoreTrimWhitespace(ignore: boolean): void;
  toggleInline(): void;
  /** Raw ↔ review. */
  toggleMode(): void;
  /** Forgets this profile's saved toggles. */
  resetOptions(): void;
  /**
   * Puts the cursor on `line` of one side's file, mapped through that side's `lineMap` in
   * review mode. False when there is no comparison or no such line.
   */
  goToLine(line: number, side?: 'original' | 'modified'): boolean;
}

export interface CompareDeps {
  docs: DocumentStore;
  layout: LayoutStore;
  status: StatusService;
  profiles: Pick<ProfileRegistry, 'detect' | 'compiled'>;
  files: Pick<FileOps, 'open' | 'newUntitled'>;
  readDisk(path: string): Promise<DecodeResult | null>;
  /**
   * The file's size in bytes, or null when it cannot be told. Asked BEFORE `readDisk`,
   * so the 50 MB guard can refuse a pick without pulling it through IPC first (G8 M2).
   */
  statSize(path: string): Promise<number | null>;
  /** The document's length in UTF-16 code units, for the 50 MB guard (F8). */
  charCountOf(docId: DocId): number;
  /** The document's text, LF-joined. */
  textOf(docId: DocId): string;
  /** The document's effective profile and machine (AD-31). */
  effectiveOf(docId: DocId): EffectiveProfile;
  /** One native file pick; null when cancelled. Grants the path (F3). */
  pickFile(title: string): Promise<string | null>;
  /** The diff editor on screen, or null. */
  diff(): DiffHandle | null;
  /** `ui.lastParams.compare`, untrusted (§7.11). */
  memory: {
    read(): unknown;
    write(memo: CompareMemo): void;
  };
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
// The saved options (pure)
// ---------------------------------------------------------------------------

/**
 * `ui.lastParams.compare` as it may be read from a hand-edited file: member by member, and
 * anything that is not the declared type is dropped, so a bad file can only bring the
 * defaults back (§7.11). Profile entries keep only the five toggles, as booleans.
 */
export function compareMemoOf(raw: unknown): CompareMemo {
  const out: CompareMemo = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const memo = raw as Record<string, unknown>;
  if (memo.mode === 'raw' || memo.mode === 'review') out.mode = memo.mode;
  if (typeof memo.inline === 'boolean') out.inline = memo.inline;
  if (typeof memo.ignoreTrimWhitespace === 'boolean') out.ignoreTrimWhitespace = memo.ignoreTrimWhitespace;
  const review = memo.review;
  if (review !== null && typeof review === 'object' && !Array.isArray(review)) {
    // No prototype: a profile id of `__proto__` (a hand-edited file) is an entry like any other.
    const kept: Record<string, Partial<CompareOptions>> = Object.create(null);
    for (const [profileId, entry] of Object.entries(review as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const toggles: Partial<CompareOptions> = {};
      for (const key of COMPARE_OPTION_KEYS) {
        const value = (entry as Record<string, unknown>)[key];
        if (typeof value === 'boolean') toggles[key] = value;
      }
      if (Object.keys(toggles).length > 0) kept[profileId] = toggles;
    }
    if (Object.keys(kept).length > 0) out.review = kept;
  }
  return out;
}

/** The toggles of `options` that differ from `defaults`: all a profile's entry keeps. */
export function changedToggles(options: CompareOptions, defaults: CompareOptions): Partial<CompareOptions> {
  const changed: Partial<CompareOptions> = {};
  for (const key of COMPARE_OPTION_KEYS) if (options[key] !== defaults[key]) changed[key] = options[key];
  return changed;
}

// ---------------------------------------------------------------------------
// Review mode (pure)
// ---------------------------------------------------------------------------

/** One side of a review comparison, ready to normalize. */
export interface ReviewInput {
  lines: string[];
  cp: CompiledProfile;
  /** Null: a file that is not open as a document has no machine. */
  machine: EffectiveMachine | null;
  profileId: string;
  /** What `side` is called in a note (already translated). */
  label: string;
}

function machineName(machine: EffectiveMachine): string {
  return machine.name ?? t('compare.machineNone');
}

function sideOf(
  input: ReviewInput,
  o: CompareOptions,
  over: NormalizeOverrides,
): { normalized: Normalized; side: ReviewSide } {
  const normalized = normalizeLines(input.lines, input.cp, o, input.machine, over);
  return {
    normalized,
    // An empty side has no lines at all, which is the empty text and not one empty line.
    side: { text: normalized.text, lineMap: normalized.lineMap, languageId: input.profileId },
  };
}

/**
 * Normalizes both sides, each with its own profile and machine (AD-26) but with one
 * decimal-point rule, the stricter of the two (§7.16 #144, review NC-6), and collects what
 * the review bar says: that the two effective machines differ, that the sides are read
 * under different profiles or a side with no machine, and the notes of `normalizeLines`
 * itself (block numbers kept for a computed jump, a decimal point that counts because no
 * machine says how numbers are read).
 */
export function buildReview(modified: ReviewInput, original: ReviewInput, o: CompareOptions): ReviewView {
  // One rule for both sides: an increment-reading side would see `X10` and `X10.` apart,
  // so the calculator-reading side must not make them equal on its own.
  const over: NormalizeOverrides = {
    pointSignificant:
      pointSignificant(modified.cp.profile, modified.machine) || pointSignificant(original.cp.profile, original.machine),
  };
  const m = sideOf(modified, o, over);
  const a = sideOf(original, o, over);
  const notes: ReviewNote[] = [];

  if (modified.profileId !== original.profileId) {
    notes.push({
      reason: 'profiles',
      text: t('compare.noteProfiles', { original: original.profileId, modified: modified.profileId }),
    });
  } else if (original.machine !== null && modified.machine !== null && original.machine.key !== modified.machine.key) {
    notes.push({
      reason: 'machines',
      text: t('compare.noteMachines', {
        original: machineName(original.machine),
        modified: machineName(modified.machine),
      }),
    });
  }
  if (original.machine === null) notes.push({ reason: 'noMachine', text: t('compare.noteNoMachine', { side: original.label }) });

  for (const [input, normalized] of [
    [modified, m.normalized],
    [original, a.normalized],
  ] as const) {
    for (const note of normalized.notes) {
      const params = { ...note.params, side: input.label };
      notes.push({
        reason: note.key === COMPARE_NOTE_KEYS.blockNumbers ? 'blockNumbers' : 'noMachine',
        text: t(note.key, params),
      });
    }
  }
  return { original: a.side, modified: m.side, notes };
}

/** `text` as the lines `normalizeLines` takes. */
function linesOf(text: string): string[] {
  return text.split('\n');
}

/** The lines of a normalized side; an empty side has none. */
function reviewLines(side: ReviewSide): string[] {
  return side.lineMap.length === 0 ? [] : side.text.split('\n');
}

/**
 * The review line that file line `line` shows on, through `lineMap` (nondecreasing): the
 * first one at or after it, so a line the options dropped lands on the next that is shown.
 * Null for an empty side or a line past the last one shown.
 */
export function reviewLineOf(lineMap: Int32Array, line: number): number | null {
  let low = 0;
  let high = lineMap.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lineMap[mid] < line) low = mid + 1;
    else high = mid;
  }
  return low < lineMap.length ? low + 1 : null;
}

// ---------------------------------------------------------------------------
// The merge (pure)
// ---------------------------------------------------------------------------

/** Lines `start..start + count - 1`; an empty span (`count` 0) names the line *before* it. */
interface Span {
  start: number;
  count: number;
}

function spanOf(change: DiffLineChange, side: 'original' | 'modified'): Span {
  const start = side === 'original' ? change.originalStartLineNumber : change.modifiedStartLineNumber;
  const end = side === 'original' ? change.originalEndLineNumber : change.modifiedEndLineNumber;
  return end === 0 || end < start ? { start, count: 0 } : { start, count: end - start + 1 };
}

/** Whether `line` is "at" a span: inside it, or, for an empty one, next to where it would be. */
function spanHolds(span: Span, line: number): 'inside' | 'next' | null {
  if (span.count > 0) return line >= span.start && line < span.start + span.count ? 'inside' : null;
  return line === span.start || line === span.start + 1 ? 'next' : null;
}

/**
 * The change the cursor is in: the one that holds its line in the pane it is in. A line
 * inside a block wins over a line next to an empty one (a deletion or an insertion).
 */
export function changeAtCursor(changes: readonly DiffLineChange[], cursor: DiffCursor): DiffLineChange | null {
  let adjacent: DiffLineChange | null = null;
  for (const change of changes) {
    const held = spanHolds(spanOf(change, cursor.side), cursor.line);
    if (held === 'inside') return change;
    if (held === 'next' && adjacent === null) adjacent = change;
  }
  return adjacent;
}

/**
 * Why a copy cannot happen, from what is known before the diff is asked: review mode (the
 * panes are normalized copies), a right-to-left copy whose original side is a file or the
 * saved version (not an open document, so there is nothing to write), and a locked target
 * (AD-23).
 */
export function copyBlocker(
  direction: CopyDirection,
  state: { mode: CompareMode; originalIsDocument: boolean; targetLocked: boolean },
): CopyBlock | null {
  if (state.mode === 'review') return 'review';
  if (direction === 'toOriginal' && !state.originalIsDocument) return 'notDocument';
  if (state.targetLocked) return 'locked';
  return null;
}

/** Which lines to read from the source pane and which to replace in the target pane. */
export interface MergePlan {
  sourceFrom: number;
  sourceCount: number;
  /** The first target line replaced, or, with `targetRemove` 0, the line the text goes in front of. */
  targetAt: number;
  targetRemove: number;
}

/**
 * The plan for copying `change` in `direction`. A block copy replaces the target's lines of
 * the change by the source's (an insertion where the target has none, a deletion where the
 * source has none). With `lineOnly` one line is copied: the cursor's line of its pane and
 * the line at the same place in the other pane's block, paired by position in the block.
 * Null when `lineOnly` finds nothing on either side.
 */
export function mergePlan(
  change: DiffLineChange,
  direction: CopyDirection,
  o: { lineOnly?: boolean; cursor: DiffCursor },
): MergePlan | null {
  const sourceSide = direction === 'toModified' ? 'original' : 'modified';
  const source = spanOf(change, sourceSide);
  const target = spanOf(change, direction === 'toModified' ? 'modified' : 'original');
  const blockAt = target.count > 0 ? target.start : target.start + 1;

  if (o.lineOnly !== true) {
    return { sourceFrom: source.start, sourceCount: source.count, targetAt: blockAt, targetRemove: target.count };
  }
  const own = spanOf(change, o.cursor.side);
  const k = own.count > 0 ? Math.min(Math.max(o.cursor.line - own.start, 0), own.count - 1) : 0;
  const hasSource = k < source.count;
  const hasTarget = k < target.count;
  if (hasSource && hasTarget) {
    return { sourceFrom: source.start + k, sourceCount: 1, targetAt: target.start + k, targetRemove: 1 };
  }
  if (hasSource) {
    // Past the end of the target's block: the line goes in behind it.
    const behind = target.count > 0 ? target.start + target.count : target.start + 1;
    return { sourceFrom: source.start + k, sourceCount: 1, targetAt: behind, targetRemove: 0 };
  }
  if (hasTarget) return { sourceFrom: source.start, sourceCount: 0, targetAt: target.start + k, targetRemove: 1 };
  return null;
}

/**
 * The edit that carries out `plan`, with `lines` read from the source: one operation for
 * Monaco. Inserting at the end of the document puts the break in front of the text, and
 * deleting through the last line takes the break before it, as `applyLines` does.
 */
export function mergeOperation(
  plan: MergePlan,
  lines: readonly string[],
  target: { getLineCount(): number; getLineMaxColumn(line: number): number },
): LineOperation | null {
  const count = target.getLineCount();
  const at = Math.min(Math.max(plan.targetAt, 1), count + 1);

  if (plan.targetRemove === 0) {
    if (lines.length === 0) return null;
    const text = lines.join('\n');
    if (at <= count) {
      return { range: { startLineNumber: at, startColumn: 1, endLineNumber: at, endColumn: 1 }, text: `${text}\n` };
    }
    const column = target.getLineMaxColumn(count);
    return { range: { startLineNumber: count, startColumn: column, endLineNumber: count, endColumn: column }, text: `\n${text}` };
  }

  const first = at;
  const last = Math.min(at + plan.targetRemove - 1, count);
  if (first > count) return null;
  if (lines.length > 0) {
    return {
      range: { startLineNumber: first, startColumn: 1, endLineNumber: last, endColumn: target.getLineMaxColumn(last) },
      text: lines.join('\n'),
    };
  }
  if (last < count) {
    return { range: { startLineNumber: first, startColumn: 1, endLineNumber: last + 1, endColumn: 1 }, text: '' };
  }
  if (first > 1) {
    return {
      range: {
        startLineNumber: first - 1,
        startColumn: target.getLineMaxColumn(first - 1),
        endLineNumber: last,
        endColumn: target.getLineMaxColumn(last),
      },
      text: '',
    };
  }
  return { range: { startLineNumber: 1, startColumn: 1, endLineNumber: last, endColumn: target.getLineMaxColumn(last) }, text: '' };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createCompareService(deps: CompareDeps): CompareController {
  const content = writable<CompareContent | null>(null);
  const view = writable<DiffViewOptions>({ inline: false, ignoreTrimWhitespace: false });
  const mode = writable<CompareMode>('raw');
  const reviewOptions = writable<CompareOptions>({ ...COMPARE_FALLBACK });
  const info = writable<ReviewInfo | null>(null);
  const reviewView = writable<ReviewView | null>(null);
  let snapshot: unknown = null;

  // The saved options (§7.11): read on first use, because the UI state is loaded after
  // this module is created.
  let loaded = false;
  let savedReview: Record<string, Partial<CompareOptions>> = {};

  function ensureLoaded(): void {
    if (loaded) return;
    loaded = true;
    const memo = compareMemoOf(deps.memory.read());
    mode.set(memo.mode ?? 'raw');
    // A store that is told what it holds already tells its subscribers again; a view that
    // is the same stays the same object.
    const saved = { inline: memo.inline ?? false, ignoreTrimWhitespace: memo.ignoreTrimWhitespace ?? false };
    const now = get(view);
    if (saved.inline !== now.inline || saved.ignoreTrimWhitespace !== now.ignoreTrimWhitespace) view.set(saved);
    savedReview = memo.review ?? {};
  }

  function persist(): void {
    const memo: CompareMemo = {
      mode: get(mode),
      inline: get(view).inline,
      ignoreTrimWhitespace: get(view).ignoreTrimWhitespace,
    };
    if (Object.keys(savedReview).length > 0) memo.review = savedReview;
    deps.memory.write(memo);
  }

  function fail(key: string, params?: Record<string, string | number>): false {
    deps.status.show(t(key, params), { error: true });
    return false;
  }

  function tooLarge(): false {
    return fail('compare.tooLarge', { limit: formatBytes(MODEL_SYNC_LIMIT_CHARS) });
  }

  /** Clears the session, closes the overlay if it is still ours, and restores the editor. */
  function finish(o: { restore?: boolean } = {}): void {
    if (get(content) === null) return;
    content.set(null);
    info.set(null);
    reviewView.set(null);
    if (get(deps.layout.state).overlay === COMPARE_PANEL_ID) deps.layout.closeOverlay();
    const restoring = snapshot;
    snapshot = null;
    if (o.restore !== false) deps.restoreViewState(restoring);
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

  // -- review ---------------------------------------------------------------

  /** The modified document's side. */
  function modifiedInput(docId: DocId): ReviewInput {
    const eff = deps.effectiveOf(docId);
    return {
      lines: linesOf(deps.textOf(docId)),
      cp: eff.cp,
      machine: eff.machine,
      profileId: eff.profile.id,
      label: t('compare.labelModified'),
    };
  }

  /** The original side: a document with its own profile and machine, or a file's text. */
  function originalInput(session: CompareContent, modifiedDocId: DocId): ReviewInput {
    const label = t('compare.labelOriginal');
    const original = session.original;
    if (original.kind === 'document') {
      const eff = deps.effectiveOf(original.docId);
      return { lines: linesOf(deps.textOf(original.docId)), cp: eff.cp, machine: eff.machine, profileId: eff.profile.id, label };
    }
    if (session.source.kind === 'saved') {
      // The same file, so the same dialect and the same machine.
      const eff = deps.effectiveOf(modifiedDocId);
      return { lines: linesOf(original.text), cp: eff.cp, machine: eff.machine, profileId: eff.profile.id, label };
    }
    // A file that is not open as a document: its detected profile, and no machine (AD-26).
    return {
      lines: linesOf(original.text),
      cp: deps.profiles.compiled(original.languageId),
      machine: null,
      profileId: original.languageId,
      label,
    };
  }

  function buildCurrentReview(): ReviewView | null {
    const session = get(content);
    if (!session) return null;
    return buildReview(modifiedInput(session.docId), originalInput(session, session.docId), get(reviewOptions));
  }

  /** Rebuilds the normalized sides when the comparison is in review mode. */
  function rebuild(): void {
    reviewView.set(get(content) !== null && get(mode) === 'review' ? buildCurrentReview() : null);
  }

  /** The toggles of the compared document's profile: its defaults, with what the user saved. */
  function applyProfile(docId: DocId): void {
    const profile = deps.effectiveOf(docId).profile;
    const defaults = compareDefaults(profile);
    info.set({ profileId: profile.id, defaults });
    reviewOptions.set({ ...defaults, ...savedReview[profile.id] });
  }

  // -- open -----------------------------------------------------------------

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

  /** The newest `open()`: an older one that is still reading gives way (CODE-10). */
  let openSeq = 0;

  async function open(docId: DocId, source: CompareSource): Promise<boolean> {
    const mine = ++openSeq;
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
    // The read took time: the tab may be gone, or a newer open may have started.
    if (mine !== openSeq) return false;
    if (!deps.docs.get(docId)) return fail('compare.noDocument');

    // The modified side is the document on screen, so it has to be the active tab; the
    // view state is taken after the switch, because that is what `close()` puts back.
    // Comparing again without closing keeps the first snapshot: the editor is unmounted
    // while the overlay is up, so a second capture would only record the state the
    // detached editor already had.
    if (deps.docs.getActiveId() !== docId) deps.docs.activate(docId);
    if (get(content) === null) snapshot = deps.captureViewState();

    ensureLoaded();
    content.set({ docId, source, title: compareTitle(doc.title, source, other), original });
    applyProfile(docId);
    rebuild();
    deps.layout.openOverlay(COMPARE_PANEL_ID);
    return true;
  }

  // -- the toolbar ----------------------------------------------------------

  function setMode(m: CompareMode): void {
    ensureLoaded();
    if (get(mode) === m) return;
    mode.set(m);
    persist();
    rebuild();
  }

  function setOptions(patch: Partial<CompareOptions>): void {
    ensureLoaded();
    reviewOptions.update((o) => ({ ...o, ...patch }));
    const known = get(info);
    if (known) {
      const changed = changedToggles(get(reviewOptions), known.defaults);
      if (Object.keys(changed).length > 0) savedReview = { ...savedReview, [known.profileId]: changed };
      else delete savedReview[known.profileId];
      persist();
    }
    rebuild();
  }

  function resetOptions(): void {
    ensureLoaded();
    const known = get(info);
    if (!known) return;
    delete savedReview[known.profileId];
    reviewOptions.set({ ...known.defaults });
    persist();
    rebuild();
  }

  function setView(patch: Partial<DiffViewOptions>): void {
    ensureLoaded();
    const before = get(view);
    const next = { ...before, ...patch };
    if (next.inline === before.inline && next.ignoreTrimWhitespace === before.ignoreTrimWhitespace) return;
    view.set(next);
    persist();
  }

  // -- copy -----------------------------------------------------------------

  /** The document a copy in `direction` writes, or null when the original is not one. */
  function targetDoc(direction: CopyDirection): DocId | null {
    const session = get(content);
    if (!session) return null;
    if (direction === 'toModified') return session.docId;
    return session.original.kind === 'document' ? session.original.docId : null;
  }

  function blockOf(direction: CopyDirection): CopyBlock | null {
    const session = get(content);
    const target = targetDoc(direction);
    return copyBlocker(direction, {
      mode: get(mode),
      originalIsDocument: session?.original.kind === 'document',
      targetLocked: target !== null && deps.docs.get(target)?.readOnly === true,
    });
  }

  const copyBlock = derived([content, mode, deps.docs.list], () => ({
    toModified: blockOf('toModified'),
    toOriginal: blockOf('toOriginal'),
  }));

  async function copyChange(
    direction: CopyDirection,
    o?: { lineOnly?: boolean; thenNext?: boolean },
  ): Promise<boolean> {
    if (get(content) === null) return fail('compare.noDocument');
    const blocked = blockOf(direction);
    if (blocked === 'review') return fail('compare.copyReview');
    if (blocked === 'notDocument') return fail('compare.copyNotDocument');
    if (blocked === 'locked') return fail('compare.copyLocked');

    const handle = deps.diff();
    // CODE-1: Monaco serves the old blocks until it has recomputed after an edit, and a
    // copy planned from them (a held key, a double click) would insert twice or delete
    // lines that are not part of the change.
    if (handle && !handle.isCurrent()) return fail('compare.copyBusy');
    const changes = handle?.lineChanges() ?? null;
    const cursor = handle?.cursor() ?? null;
    if (!handle || !changes || !cursor) return fail('compare.copyNoChange');
    const change = changeAtCursor(changes, cursor);
    if (!change) return fail('compare.copyNoChange');
    const plan = mergePlan(change, direction, { lineOnly: o?.lineOnly, cursor });
    if (!plan) return fail('compare.copyNoChange');

    const from = handle.model(direction === 'toModified' ? 'original' : 'modified');
    const to = handle.model(direction === 'toModified' ? 'modified' : 'original');
    if (!from || !to) return fail('compare.copyNoChange');
    const lines: string[] = [];
    for (let line = plan.sourceFrom; line < plan.sourceFrom + plan.sourceCount; line++) {
      lines.push(from.getLineContent(line));
    }
    const operation = mergeOperation(plan, lines, to);
    if (!operation) return fail('compare.copyNoChange');

    // One undo step: the edit sits between two stack elements, so it neither merges into
    // what the user typed before nor into what they type next.
    to.pushStackElement();
    to.pushEditOperations(null, [operation], () => null);
    to.pushStackElement();

    if (o?.thenNext === true) {
      // The modified pane's cursor is where "next" starts from: behind the block just
      // dealt with, so the next change is the next one and not this one again.
      const modified = spanOf(change, 'modified');
      const line =
        direction === 'toModified'
          ? Math.max(plan.targetAt + lines.length - 1, 1)
          : modified.count > 0
            ? modified.start + modified.count - 1
            : modified.start;
      handle.reveal('modified', line);
      handle.nextWhenUpdated();
    }
    return true;
  }

  // -- export ---------------------------------------------------------------

  async function exportDiff(o: { normalized: boolean }): Promise<DocId | null> {
    const session = get(content);
    const doc = session ? deps.docs.get(session.docId) : undefined;
    if (!session || !doc) {
      fail('compare.noDocument');
      return null;
    }

    const originalName =
      session.original.kind === 'document'
        ? (deps.docs.get(session.original.docId)?.title ?? session.title)
        : session.source.kind === 'saved'
          ? t('compare.sideSaved', { name: doc.title })
          : fileName(session.source.kind === 'file' ? session.source.path : doc.title);

    let originalLines: string[];
    let modifiedLines: string[];
    if (o.normalized) {
      const built = get(reviewView) ?? buildCurrentReview();
      if (!built) return null;
      originalLines = reviewLines(built.original);
      modifiedLines = reviewLines(built.modified);
    } else {
      modifiedLines = linesOf(deps.textOf(session.docId));
      originalLines =
        session.original.kind === 'document' ? linesOf(deps.textOf(session.original.docId)) : linesOf(session.original.text);
    }

    const text = unifiedDiff({ name: originalName, lines: originalLines }, { name: doc.title, lines: modifiedLines });
    if (text === '') {
      deps.status.show(t('compare.noDifferences'));
      return null;
    }
    // The new tab takes the editor's place, so the comparison ends first and the editor's
    // view state goes back to the compared document, not to the new one.
    const id = deps.files.newUntitled({ profileId: doc.profileId, text, activate: false });
    // CODE-5: the view state is not put back here. The restore runs a frame or two later,
    // into whatever the remounted editor shows by then, and that is the new tab; the
    // compared document gets its own state back from the editor service when it is
    // activated again.
    finish({ restore: false });
    deps.docs.activate(id);
    return id;
  }

  // -- two files ------------------------------------------------------------

  async function openFiles(a?: string, b?: string): Promise<boolean> {
    const original = a ?? (await deps.pickFile(t('compare.pickOriginalTitle')));
    if (!original) return false;
    const modified = b ?? (await deps.pickFile(t('compare.pickModifiedTitle')));
    if (!modified) return false;
    if (original === modified) return fail('compare.sameFile');

    // `files.open` shows its own refusal (binary, too large) and answers the ones it opened.
    const opened = await deps.files.open([original, modified]);
    if (opened.length < 2) return false;
    return open(opened[1], { kind: 'document', docId: opened[0] });
  }

  // -- go to line -----------------------------------------------------------

  function goToLine(line: number, side: 'original' | 'modified' = 'modified'): boolean {
    const handle = deps.diff();
    if (!handle || get(content) === null) return false;
    if (!Number.isInteger(line) || line < 1) return fail('compare.noSuchLine');
    const review = get(reviewView);
    if (review === null) {
      handle.reveal(side, line);
      return true;
    }
    const target = reviewLineOf(review[side].lineMap, line);
    if (target === null) return fail('compare.noSuchLine');
    handle.reveal(side, target);
    return true;
  }

  const sides = derived([content, reviewView], ([session, review]): DiffSides | null => {
    if (!session) return null;
    if (review) {
      return {
        original: { kind: 'text', text: review.original.text, languageId: review.original.languageId },
        modified: { kind: 'text', text: review.modified.text, languageId: review.modified.languageId },
      };
    }
    return { original: session.original, modified: { kind: 'document', docId: session.docId } };
  });

  return {
    session: derived(content, (c) =>
      c === null ? null : { docId: c.docId, source: c.source, title: c.title },
    ),
    open,
    close: () => finish(),

    mode: derived(mode, (m) => m),
    setMode,
    options: derived(reviewOptions, (o) => o),
    setOptions,
    copyChange,
    exportDiff,
    openFiles,

    content: derived(content, (c) => c),
    view: derived(view, (o) => o),
    sides,
    review: derived(reviewView, (r) => r),
    reviewInfo: derived(info, (i) => i),
    copyBlock,
    setInline(inline: boolean): void {
      setView({ inline });
    },
    setIgnoreTrimWhitespace(ignore: boolean): void {
      setView({ ignoreTrimWhitespace: ignore });
    },
    toggleInline(): void {
      setView({ inline: !get(view).inline });
    },
    toggleMode(): void {
      setMode(get(mode) === 'review' ? 'raw' : 'review');
    },
    resetOptions,
    goToLine,
  };
}

/** The application-wide compare service. */
export const compareController: CompareController = createCompareService({
  docs: appDocs,
  layout: appLayout,
  status: appStatus,
  profiles: appProfiles,
  files: appFiles,
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
  textOf: (docId) => appEditor.getText(docId),
  effectiveOf: (docId) => appMachines.effective(docId),
  pickFile: async (title) => (await appDialogs.exclusive(() => appDialogs.pickFile({ title }))) ?? null,
  diff: currentDiff,
  memory: {
    read: () => appUiState.getLastParams(COMPARE_MEMO_KEY),
    write: (memo) => appUiState.setLastParams(COMPARE_MEMO_KEY, memo as Record<string, unknown>),
  },
  captureViewState: captureEditorViewState,
  restoreViewState: (snapshot) =>
    restoreEditorViewState(snapshot as ReturnType<typeof captureEditorViewState>),
});

/** The §7.3 view of the same object. */
export const compare: CompareService = compareController;
