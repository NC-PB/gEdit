// The code inspector's model: what the panel shows for the block at the cursor, and the edit of
// one value (Phase 3 plan P3.2b, §6.3, §6.8; Phase 2 plan AD-27). Owner: P3.2b.
//
// Two jobs, both behind `createInspectorService(deps)` plus the singleton wired to the real
// modules (AD-2), so a unit test drives them with a fake editor, a fake modal service and a
// fake frame clock:
//
//   1. **Following the cursor.** `follow()` is called by the panel while it is mounted; with
//      no panel nothing is listened to and nothing is computed. A cursor move, a content
//      change, a document switch and a machine or profile revision each do exactly one thing:
//      ask for a frame. The block is inspected once in that frame, whatever the number of
//      triggers, so the keystroke path pays for a flag and (once per frame) one
//      `requestAnimationFrame` and for nothing else (the P1 typing budget). A bump of
//      `modal.changed` (every idle slice of every document, and every edit) asks for a frame
//      only when `modal.revisionOf` of the active document is not the number the last frame
//      saw: the slice of another document, or one that did not reach anything this panel
//      waits for, costs a comparison. A frame that finds nothing different from what is
//      published (document, cursor line, version, view, revision, state) publishes nothing,
//      so a 300k-line build does not repaint the panel for every 16 ms slice.
//
//   2. **Editing one value.** `edit(word)` and `editAtCursor()` take a fresh inspection (never
//      the one on screen, which may be a frame old), refuse a locked document or a row that
//      cannot be edited with the reason in plain words, and otherwise prompt for the
//      **effective** value (mm or inch, degrees, seconds…). The prompt validates every
//      keystroke with `checkValue` and `rewriteWord` (so a refusal such as "0.0505 is not a
//      whole number of increments" shows next to the field, never a silent rounding); Esc
//      cancels without writing. A confirmed value is written with `applyLines` on the one
//      line, which is one undo step. The program must not have changed since the inspection
//      (`versionId`), or nothing is written.
//
// A line longer than `MAX_INSPECT_LINE` is not inspected (a program saved as one 10 MB line
// would otherwise tokenize it on every frame); the panel says so.

import { writable, type Readable } from 'svelte/store';
import InspectorEdit from '$lib/components/panels/InspectorEdit.svelte';
import {
  blockRange,
  checkValue,
  inspectBlock,
  type BlockInspection,
  type InspectedWord,
  type InspectInput,
  type InspectView,
} from '$lib/core/codes/inspect';
import { rewriteWord } from '$lib/core/nc/rewriteWord';
import { isNcDocumentPath } from '$lib/core/profiles/ncDocument';
import { applyLines as applyLinesToModel } from '$lib/monaco/applyLines';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { machines as appMachines } from '$lib/stores/machines';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { lockRefusal } from '$lib/app/readOnlyLock';
import { modal as appModal } from '$lib/app/modalService';
import { modals as appModals } from '$lib/app/modals';
import { status as appStatus } from '$lib/app/status';
import { t as translate } from '$lib/i18n';
import type { EffectiveProfile } from '$lib/core/machines/types';
import type { NcToken } from '$lib/core/nc/types';
import type {
  Disposable,
  DocId,
  DocumentStore,
  EditorService,
  ModalService,
  Msg,
  StatusService,
  Translate,
} from '$lib/app/types';

/** A line longer than this is not inspected; neither is the cursor line's neighbour read past it. */
export const MAX_INSPECT_LINE = 4000;

/** What the panel shows. */
export type InspectorSnapshot =
  /** No document is open. */
  | { kind: 'none' }
  /** The document is a profile, a code file, the settings or a script, not an NC program. */
  | { kind: 'notProgram' }
  /** The cursor's line is longer than `MAX_INSPECT_LINE`. */
  | { kind: 'tooLong'; line: number }
  | {
      kind: 'block';
      docId: DocId;
      cursorLine: number;
      /** `editor.versionId` when the block was read: an edit must find it unchanged. */
      version: number;
      view: InspectView;
      inspection: BlockInspection;
    };

export type BlockSnapshot = Extract<InspectorSnapshot, { kind: 'block' }>;

/** What the value prompt (`InspectorEdit.svelte`) is given. */
export type EditPromptProps = {
  /** Already translated: "Change X50.". */
  title: string;
  /** Already translated: "New value in mm". */
  label: string;
  /** The word's address, for `data-address`. */
  address: string;
  initial: string;
  /** A message while the typed value would be refused, else null. */
  validate: (typed: string) => Msg | null;
};

/** How an edit ended. */
export type EditOutcome = 'applied' | 'cancelled' | 'refused';

export interface InspectorDeps {
  docs: Pick<DocumentStore, 'getActiveId' | 'get'>;
  editor: Pick<
    EditorService,
    | 'cursor'
    | 'getLineCount'
    | 'getLines'
    | 'versionId'
    | 'reveal'
    | 'onDidChangeCursor'
    | 'onDidChangeContent'
    | 'onDidActivate'
  >;
  /** `machines.effective`: the document's profile, compiled profile, code database and machine (AD-31). */
  effective(id: DocId): EffectiveProfile;
  modal: Pick<ModalService, 'stateAfter' | 'changed' | 'revisionOf'>;
  /** Stores that bump when the effective view of a document may have changed (`machines.revision`, `profiles.revision`). */
  revisions: Readable<number>[];
  /** Runs `fn` on the next animation frame (a timer where there is no frame clock); the disposer cancels it. */
  frame(fn: () => void): Disposable;
  /** `monaco/applyLines.ts`: replaces lines as one undo step. */
  applyLines(id: DocId, startLine: number, endLine: number, newLines: string[]): { changedLines: number; locked?: true };
  /** Opens the value prompt; resolves the typed text, or undefined on Esc / Cancel. */
  prompt(props: EditPromptProps): Promise<string | undefined>;
  status: Pick<StatusService, 'show'>;
  t: Translate;
}

export interface InspectorService {
  /** What the panel shows; updated once per frame while someone follows. */
  readonly snapshot: Readable<InspectorSnapshot>;
  /** Starts following the cursor (the panel does this while it is mounted). The disposer stops it. */
  follow(): Disposable;
  /** The block at the cursor, read now. */
  inspectNow(): InspectorSnapshot;
  /** Edits the value of a row of the panel. */
  edit(word: InspectedWord): Promise<EditOutcome>;
  /** `inspector.editValue`: edits the value of the word at the cursor. */
  editAtCursor(): Promise<EditOutcome>;
  /** Moves the cursor to a line of the active document (a source line link). */
  reveal(line: number): void;
}

const NONE: InspectorSnapshot = { kind: 'none' };
const NOT_PROGRAM: InspectorSnapshot = { kind: 'notProgram' };

/** The word of `snapshot` that stands on `line` at the 1-based `column`; null when none does. */
export function wordAt(snapshot: BlockSnapshot, line: number, column: number): InspectedWord | null {
  const at = column - 1;
  let touching: InspectedWord | null = null;
  for (const word of snapshot.inspection.words) {
    if (word.line !== line) continue;
    if (word.token.start <= at && at < word.token.end) return word;
    if (word.token.end === at) touching = word;
  }
  return touching;
}

function sameToken(a: NcToken, b: NcToken): boolean {
  return a.start === b.start && a.end === b.end && a.text === b.text;
}

/** The row of `fresh` that is the row `word` was, or null when the line no longer has it. */
function findWord(fresh: BlockSnapshot, word: InspectedWord): InspectedWord | null {
  return fresh.inspection.words.find((w) => w.line === word.line && sameToken(w.token, word.token)) ?? null;
}

/** The text the prompt starts with: the effective value, else the number as written. */
export function initialValue(word: InspectedWord): string {
  return word.value?.effective ?? word.token.valueText ?? '';
}

export function createInspectorService(deps: InspectorDeps): InspectorService {
  const { t } = deps;
  const snapshot = writable<InspectorSnapshot>(NONE);

  const say = (msg: Msg, error = false): void => {
    deps.status.show(t(msg.key, msg.params), error ? { error: true } : undefined);
  };

  // -- reading the block ------------------------------------------------------------------

  /** The block around `line` of document `docId`, read now. */
  function inspectAt(docId: DocId, line: number): InspectorSnapshot {
    const doc = deps.docs.get(docId);
    if (doc === undefined) return NONE;
    if (!isNcDocumentPath(doc.path)) return NOT_PROGRAM;

    let effective: EffectiveProfile;
    try {
      effective = deps.effective(docId);
    } catch {
      // A reload can take a document's profile away for a moment (AD-29).
      return NONE;
    }

    const lineCount = deps.editor.getLineCount(docId);
    const at = Math.min(Math.max(1, Math.trunc(line) || 1), Math.max(1, lineCount));
    const read = (n: number): string => deps.editor.getLines(docId, n, n)[0] ?? '';
    if (read(at).length > MAX_INSPECT_LINE) return { kind: 'tooLong', line: at };
    // A neighbour that long is read as empty: it cannot continue the block.
    const input: InspectInput = {
      line: at,
      lineCount,
      getLine: (n) => {
        const text = read(n);
        return text.length > MAX_INSPECT_LINE ? '' : text;
      },
    };
    const view: InspectView = {
      profile: effective.profile,
      cp: effective.cp,
      db: effective.codes,
      machine: effective.machine,
    };
    const { first, last } = blockRange(input, effective.cp);
    // AD-35: a word is read in the state after its block; `before` only marks what the block changed.
    const before = deps.modal.stateAfter(docId, first - 1);
    const after = deps.modal.stateAfter(docId, last);
    const inspection = inspectBlock(input, view, before, after);
    return { kind: 'block', docId, cursorLine: at, version: deps.editor.versionId(docId), view, inspection };
  }

  function inspectNow(): InspectorSnapshot {
    const docId = deps.docs.getActiveId();
    if (docId === null) return NONE;
    const cursor = deps.editor.cursor();
    return inspectAt(docId, cursor?.line ?? 1);
  }

  // -- following the cursor ---------------------------------------------------------------

  let followers = 0;
  let stops: Disposable[] = [];
  let pending: Disposable | null = null;
  let published: InspectorSnapshot = NONE;
  /** `modal.revisionOf` of the document the published snapshot is of, as read before it was inspected. */
  let publishedRevision = -1;

  /** Publishing a snapshot the panel already shows would repaint it for nothing. */
  function worthPublishing(next: InspectorSnapshot, revision: number): boolean {
    if (next.kind !== 'block' || published.kind !== 'block') return true;
    return (
      next.docId !== published.docId ||
      next.cursorLine !== published.cursorLine ||
      next.version !== published.version ||
      next.view.cp !== published.view.cp ||
      next.view.db !== published.view.db ||
      next.view.machine.key !== published.view.machine.key ||
      next.inspection.stateReady !== published.inspection.stateReady ||
      revision !== publishedRevision
    );
  }

  /** The revision of the active document's index; -1 without a document. */
  function revisionNow(): number {
    const docId = deps.docs.getActiveId();
    return docId === null ? -1 : deps.modal.revisionOf(docId);
  }

  function frame(): void {
    pending = null;
    if (followers === 0) return;
    // Read before the block is, so an index that moves during the reading asks again.
    const revision = revisionNow();
    const next = inspectNow();
    if (!worthPublishing(next, revision)) return;
    published = next;
    publishedRevision = revision;
    snapshot.set(next);
  }

  /** The index of the active document moved on in a way a reading can see: ask for a frame. */
  function onModalChanged(): void {
    if (revisionNow() !== publishedRevision) schedule();
  }

  /** The only thing a trigger does: one frame is enough for any number of them. */
  function schedule(): void {
    if (pending !== null || followers === 0) return;
    pending = deps.frame(frame);
  }

  function follow(): Disposable {
    followers++;
    if (followers === 1) {
      stops = [
        deps.editor.onDidChangeCursor(schedule),
        deps.editor.onDidChangeContent(schedule),
        deps.editor.onDidActivate(schedule),
        deps.modal.changed.subscribe(onModalChanged),
        ...deps.revisions.map((store) => store.subscribe(schedule)),
      ];
      schedule();
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      followers--;
      if (followers > 0) return;
      for (const stop of stops.reverse()) stop();
      stops = [];
      pending?.();
      pending = null;
      published = NONE;
      publishedRevision = -1;
      snapshot.set(NONE);
    };
  }

  // -- editing one value ------------------------------------------------------------------

  type Plan =
    | { ok: true; line: number; oldLine: string; newLine: string; text: string }
    | { ok: false; reason: Msg };

  /** What writing `typed` into `word` does, or the reason it is refused. */
  function planEdit(fresh: BlockSnapshot, word: InspectedWord, typed: string): Plan {
    if (!word.edit.ok) return { ok: false, reason: word.edit.reason };
    if (word.how === undefined) return { ok: false, reason: { key: 'inspector.why.noValue' } };
    const refusal = checkValue(word, typed, fresh.view);
    if (refusal !== null) return { ok: false, reason: refusal };
    const oldLine = deps.editor.getLines(fresh.docId, word.line, word.line)[0] ?? '';
    const written = rewriteWord(oldLine, word.token, typed, word.how);
    if (!written.ok) return { ok: false, reason: written.reason };
    return { ok: true, line: word.line, oldLine, newLine: written.line, text: written.text };
  }

  async function editIn(fresh: BlockSnapshot, found: InspectedWord): Promise<EditOutcome> {
    const doc = deps.docs.get(fresh.docId);
    const locked = doc === undefined ? null : lockRefusal(doc, t('inspector.edit.action'));
    if (locked !== null) {
      say(locked, true);
      return 'refused';
    }
    if (!found.edit.ok) {
      say(found.edit.reason);
      return 'refused';
    }

    const unit = found.value?.unit ?? null;
    const typed = await deps.prompt({
      title: t('inspector.edit.title', { word: found.written }),
      label: unit === null ? t('inspector.edit.label') : t('inspector.edit.labelUnit', { unit }),
      address: found.address ?? '',
      initial: initialValue(found),
      validate: (v) => {
        const plan = planEdit(fresh, found, v);
        return plan.ok ? null : plan.reason;
      },
    });
    if (typed === undefined) return 'cancelled';

    // The prompt is modal, but a reload or a script can still change the program meanwhile.
    if (deps.editor.versionId(fresh.docId) !== fresh.version) {
      say({ key: 'inspector.edit.changed' }, true);
      return 'refused';
    }
    const plan = planEdit(fresh, found, typed);
    if (!plan.ok) {
      say(plan.reason, true);
      return 'refused';
    }
    // The same value again writes nothing and says nothing.
    if (plan.newLine === plan.oldLine) return 'cancelled';
    const written = deps.applyLines(fresh.docId, plan.line, plan.line, [plan.newLine]);
    if (written.locked === true) {
      // Locked while the prompt was open (the first look was before it).
      const current = deps.docs.get(fresh.docId);
      say((current === undefined ? null : lockRefusal(current, t('inspector.edit.action'))) ?? { key: 'inspector.edit.changed' }, true);
      return 'refused';
    }
    if (written.changedLines === 0) {
      say({ key: 'inspector.edit.changed' }, true);
      return 'refused';
    }
    say({ key: 'inspector.edit.done', params: { from: found.written, to: plan.text } });
    schedule();
    return 'applied';
  }

  async function edit(word: InspectedWord): Promise<EditOutcome> {
    const fresh = inspectNow();
    if (fresh.kind !== 'block') {
      say({ key: fresh.kind === 'notProgram' ? 'inspector.edit.notProgram' : 'inspector.edit.noDocument' });
      return 'refused';
    }
    const found = findWord(fresh, word);
    if (found === null) {
      say({ key: 'inspector.edit.changed' }, true);
      return 'refused';
    }
    return editIn(fresh, found);
  }

  async function editAtCursor(): Promise<EditOutcome> {
    const fresh = inspectNow();
    if (fresh.kind !== 'block') {
      say({ key: fresh.kind === 'notProgram' ? 'inspector.edit.notProgram' : 'inspector.edit.noDocument' });
      return 'refused';
    }
    const cursor = deps.editor.cursor();
    const found = cursor === null ? null : wordAt(fresh, cursor.line, cursor.column);
    if (found === null) {
      say({ key: 'inspector.edit.noWord' });
      return 'refused';
    }
    return editIn(fresh, found);
  }

  return {
    snapshot: { subscribe: snapshot.subscribe },
    follow,
    inspectNow,
    edit,
    editAtCursor,
    reveal(line) {
      const docId = deps.docs.getActiveId();
      if (docId !== null) deps.editor.reveal(docId, line);
    },
  };
}

/** The next animation frame; a 16 ms timer where there is no frame clock (node, a hidden webview). */
function frame(fn: () => void): Disposable {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(() => fn());
    return () => cancelAnimationFrame(handle);
  }
  const handle = setTimeout(fn, 16);
  return () => clearTimeout(handle);
}

/** The application-wide inspector; the panel and `contrib/inspector.ts` use it. */
export const inspector: InspectorService = createInspectorService({
  docs: appDocs,
  editor: appEditor,
  effective: (id) => appMachines.effective(id),
  modal: appModal,
  revisions: [appMachines.revision, appProfiles.revision],
  frame,
  applyLines: applyLinesToModel,
  prompt: (props) => appModals.open<EditPromptProps, string>(InspectorEdit, props),
  status: appStatus,
  t: translate,
});
