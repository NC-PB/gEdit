// Motion colours in the editor (Phase 3 plan AD-34, §6.6; P3.7). Owner: P3.7.
//
// A thin coloured mark in the line-decorations margin beside every line that moves: rapid,
// straight, arc, thread or cycle. The kind of a line is `core/nc/motion.ts`; this file is
// the part that talks to the editor.
//
//  - **Only the visible lines** (plus `MOTION_BUDGETS.marginLines` above and below) carry
//    marks, never the whole program, and never more than `maxMarks` at once. One decorations
//    collection per editor instance, replaced in one `set()` call.
//  - **One update per animation frame.** A scroll, an edit, a state that became known
//    (`modal.changed`), a document or model switch, a machine or profile change and the
//    setting only *schedule* the update; the editor's keystroke path does nothing else.
//  - **One `statesAfter` call per update**, for the lines `first - 1 … last`: the state
//    after the line above is the `before` of the first line. A state the index has not
//    reached yet is `null`, and then nothing is marked: a guess is never painted. The
//    service bumps `changed` for every slice of every document, which is too often to ask
//    again each time: the update is asked for only when `modal.revisionOf` of the active
//    document is not the number the last update saw (an edit, a rebuild, or a slice that
//    reached a line this update waited for), and a repaint that would set the marks that
//    are already there (and no edit moved them) sets nothing.
//  - A scroll inside the range that was marked last time, away from its edges, needs no
//    update (the margin is what makes a short scroll free). Everything else asks again.
//  - The colours are CSS custom properties `--gedit-motion-<kind>` on the document element,
//    set from `MOTION_COLORS` for the theme in force and again when it changes.
//
// The tokens of the lines come from the tokenizer with the profile and database the
// modal index was built from: the document's effective view. That view is asked for once
// per document and kept; it is asked again when a machine or a profile changes, when the
// document's profile id changes, and once after a pause in typing (the variant a lathe's
// program is detected as can change with the text; asking `machines.effective` on every
// keystroke would detect over the whole program each time).
//
// Nothing here imports Monaco: the editor is reached through the slice below, so a unit
// test hands over a fake. `contrib/motionColors.ts` wires the real services.

import './motionColors.css';
import { maskComments } from '$lib/core/nc/mask';
import { MOTION_BUDGETS, MOTION_CLASS_PREFIX, MOTION_COLORS, MOTION_KINDS, motionOfLine } from '$lib/core/nc/motion';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { Disposable, DocId, DocumentStore, EditorService, ModalService } from '$lib/app/types';
import type { Readable } from 'svelte/store';

/** The class every mark carries; the colour class `gedit-motion-<kind>` follows it. */
export const MOTION_MARK_CLASS = 'gedit-motion-mark';

/**
 * Lines of the document read in front of the first marked line, so that a block continued
 * over several lines (a Klartext `~` list) is tokenized the way the index tokenized it.
 */
export const LOOKBACK_LINES = 8;

/** How long after the last edit the document's view is asked for again (the modal service's `KEY_CHECK_DELAY_MS`). */
export const VIEW_CHECK_DELAY_MS = 300;

/** The most lines one update looks at: `statesAfter` reads one state more than there are lines, and takes at most 1,000. */
export const MAX_LINES = Math.min(MOTION_BUDGETS.maxMarks, 999);

/** The slice of Monaco's decorations collection used here. */
export interface MotionCollection {
  set(decorations: MotionDecoration[]): unknown;
  clear(): void;
}

/** One mark: an empty range at the start of a line, with the margin class. */
export interface MotionDecoration {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  options: { linesDecorationsClassName: string };
}

/** The slice of an `IStandaloneCodeEditor` used here. */
export interface MotionEditor {
  getModel(): unknown;
  getVisibleRanges(): { startLineNumber: number; endLineNumber: number }[];
  onDidScrollChange(cb: () => void): { dispose(): void };
  onDidChangeModel(cb: () => void): { dispose(): void };
  onDidLayoutChange(cb: () => void): { dispose(): void };
  createDecorationsCollection(decorations?: MotionDecoration[]): MotionCollection;
}

/** One document's effective view: what the modal index was built from. */
export interface MotionView {
  cp: CompiledProfile;
  db: CodeDb;
}

export interface MotionColorsDeps {
  editor: Pick<
    EditorService,
    'getLines' | 'getLineCount' | 'onDidAttach' | 'onDidActivate' | 'onDidChangeContent'
  > & {
    model(id: DocId): unknown;
    editorInstance(): MotionEditor | undefined;
  };
  docs: Pick<DocumentStore, 'getActiveId' | 'get' | 'list'>;
  modal: Pick<ModalService, 'statesAfter' | 'changed' | 'revisionOf'>;
  /** The document's effective view, or null while its profile is unknown. Called rarely (see the header). */
  effective(id: DocId): MotionView | null;
  /** Whether a document is an NC program (a `.json` or `.py` file is not). */
  isNc(id: DocId): boolean;
  /** `assist.motionColors`. */
  enabled: Readable<boolean>;
  /** The theme in force. */
  theme: Readable<'light' | 'dark'>;
  machineRevision?: Readable<number>;
  profileRevision?: Readable<number>;
  /** Runs `fn` on the next animation frame. */
  frame(fn: () => void): Disposable;
  /** Runs `fn` after `ms`. */
  schedule(fn: () => void, ms: number): Disposable;
  /** Sets a custom property on the document element. */
  setProperty(name: string, value: string): void;
  viewCheckDelayMs?: number;
}

export interface MotionColors {
  /** Installs the listeners. The disposer removes every mark and every listener. */
  start(): Disposable;
  /** Runs the update now instead of in the next frame (tests, the harness). */
  flush(): void;
}

/** The custom property of a kind. */
export function motionVariable(kind: string): string {
  return `--${MOTION_CLASS_PREFIX}${kind}`;
}

interface Painted {
  id: DocId;
  model: unknown;
  /** The lines the marks cover (the visible range plus the margin). */
  from: number;
  to: number;
  /** The visible lines at the time. */
  visibleFirst: number;
  visibleLast: number;
  /** The states were all there (no null answer). */
  complete: boolean;
  /** The marks as set, as `line:class` text; null when none were set (an incomplete update). */
  key: string | null;
}

export function createMotionColors(deps: MotionColorsDeps): MotionColors {
  const delay = deps.viewCheckDelayMs ?? VIEW_CHECK_DELAY_MS;
  let started = false;
  let frame: Disposable | null = null;
  let viewCheck: Disposable | null = null;
  /** Something that can change a mark happened since the last update (an edit, the setting, a revision). */
  let dirty = true;
  let enabled = true;
  let bound: MotionEditor | undefined;
  let collection: MotionCollection | null = null;
  let hooks: { dispose(): void }[] = [];
  let painted: Painted | null = null;
  /** `modal.revisionOf` of the active document as the last update read it. */
  let seenRevision = -1;
  /** An edit happened since the marks were set: the editor has moved them, so they are set again. */
  let edited = true;
  const views = new Map<DocId, { profileId: string; view: MotionView | null }>();
  let stops: Disposable[] = [];

  function schedule(): void {
    if (!started || frame !== null) return;
    frame = deps.frame(() => {
      frame = null;
      update();
    });
  }

  function markDirty(): void {
    dirty = true;
    schedule();
  }

  function viewOf(id: DocId): MotionView | null {
    const profileId = deps.docs.get(id)?.profileId ?? '';
    const known = views.get(id);
    if (known !== undefined && known.profileId === profileId) return known.view;
    const view = deps.effective(id);
    views.set(id, { profileId, view });
    return view;
  }

  function clearMarks(): void {
    collection?.clear();
    painted = null;
    edited = true;
  }

  /** `modal.changed` fired: ask for an update only when the active document's index changed in a way a mark can show. */
  function onModalChanged(): void {
    const id = deps.docs.getActiveId();
    if (id !== null && deps.modal.revisionOf(id) === seenRevision) return;
    markDirty();
  }

  /** Binds the collection to the editor instance the service has now. */
  function bind(editor: MotionEditor | undefined): void {
    if (editor === bound) return;
    for (const hook of hooks) hook.dispose();
    hooks = [];
    collection = null;
    painted = null;
    bound = editor;
    if (editor === undefined) return;
    collection = editor.createDecorationsCollection();
    hooks.push(
      editor.onDidScrollChange(() => schedule()),
      editor.onDidLayoutChange(() => schedule()),
      editor.onDidChangeModel(() => markDirty()),
    );
    dirty = true;
  }

  /** The kinds of lines `from … to` of `id`, one `statesAfter` call. Null while a state is unknown. */
  function paint(id: DocId, view: MotionView, from: number, to: number): MotionDecoration[] | null {
    const states = deps.modal.statesAfter(id, from - 1, to);
    if (states === null) return null;
    const start = Math.max(1, from - LOOKBACK_LINES);
    const lines = deps.editor.getLines(id, start, to);
    let lineState: LineState | undefined;
    const marks: MotionDecoration[] = [];
    for (let n = start; n <= to; n++) {
      const text = lines[n - start] ?? '';
      const result = tokenizeLine(text, view.cp, lineState);
      lineState = result.state;
      if (n < from) continue;
      const before = states[n - from];
      const after = states[n - from + 1];
      if (before === undefined || after === undefined) break; // the document ended inside the range
      const kind = motionOfLine(result.tokens as NcToken[], before, after, view.cp, view.db);
      if (kind === null) continue;
      marks.push({
        range: { startLineNumber: n, startColumn: 1, endLineNumber: n, endColumn: 1 },
        options: { linesDecorationsClassName: `${MOTION_MARK_CLASS} ${MOTION_CLASS_PREFIX}${kind}` },
      });
    }
    return marks;
  }

  function update(): void {
    const editor = deps.editor.editorInstance();
    bind(editor);
    if (editor === undefined || collection === null) return;
    const id = deps.docs.getActiveId();
    // Before the states are read, so an index that moves during the update asks again.
    seenRevision = id === null ? -1 : deps.modal.revisionOf(id);
    if (!enabled || id === null || !deps.isNc(id)) {
      if (painted !== null || dirty) clearMarks();
      dirty = false;
      return;
    }
    const model = deps.editor.model(id);
    if (model === undefined || editor.getModel() !== model) {
      clearMarks();
      return;
    }
    const ranges = editor.getVisibleRanges();
    if (ranges.length === 0) return; // hidden, or not laid out yet
    let first = Infinity;
    let last = 0;
    for (const range of ranges) {
      first = Math.min(first, range.startLineNumber);
      last = Math.max(last, range.endLineNumber);
    }
    const count = deps.editor.getLineCount(id);
    last = Math.min(last, count);
    if (last < first) return;

    // A scroll that stays inside what is marked, away from its edges, needs no update. Near
    // an edge the marks are recentred before the lines run out.
    const was = painted;
    if (!dirty && was !== null && was.complete && was.id === id && was.model === model) {
      const slack = MOTION_BUDGETS.marginLines / 2;
      const topOk = was.from === 1 || first - was.from >= slack;
      const bottomOk = was.to >= count || was.to - last >= slack;
      if (first >= was.from && last <= was.to && topOk && bottomOk) return;
    }

    const view = viewOf(id);
    if (view === null) {
      clearMarks();
      dirty = false;
      return;
    }
    let from = Math.max(1, first - MOTION_BUDGETS.marginLines);
    let to = Math.min(count, last + MOTION_BUDGETS.marginLines);
    if (to - from + 1 > MAX_LINES) {
      // A very tall editor: the visible lines first, then as much margin as the budget leaves.
      const spare = Math.max(0, MAX_LINES - (last - first + 1));
      from = Math.max(1, first - Math.floor(spare / 2));
      to = Math.min(count, from + MAX_LINES - 1);
    }
    const marks = paint(id, view, from, to);
    dirty = false;
    if (marks === null) {
      // Not known yet: no mark, and ask again when the index moves (`modal.changed`).
      collection.clear();
      edited = true;
      painted = { id, model, from, to, visibleFirst: first, visibleLast: last, complete: false, key: null };
      return;
    }
    const key = marks.map((mark) => `${mark.range.startLineNumber}:${mark.options.linesDecorationsClassName}`).join('|');
    const same = !edited && was !== null && was.complete && was.id === id && was.model === model && was.key === key;
    if (!same) collection.set(marks);
    edited = false;
    painted = { id, model, from, to, visibleFirst: first, visibleLast: last, complete: true, key };
  }

  function applyTheme(mode: 'light' | 'dark'): void {
    const colors = MOTION_COLORS[mode];
    for (const kind of MOTION_KINDS) deps.setProperty(motionVariable(kind), colors[kind]);
  }

  /** After a pause in typing the document's view is read again (a detected variant can have changed). */
  function armViewCheck(): void {
    viewCheck?.();
    viewCheck = deps.schedule(() => {
      viewCheck = null;
      views.clear();
      markDirty();
    }, delay);
  }

  return {
    start(): Disposable {
      if (started) return () => {};
      started = true;
      dirty = true;
      let firstEnabled = true;
      let firstChanged = true;
      let activeProfile: string | undefined;
      stops = [
        deps.theme.subscribe((mode) => applyTheme(mode)),
        deps.enabled.subscribe((value) => {
          enabled = value;
          if (firstEnabled) {
            firstEnabled = false;
            return;
          }
          markDirty();
        }),
        // The index moved (an edit, an idle slice, a rebuild after a machine switch): ask
        // again. Coalesced into one update per frame; nothing is cached across it, because
        // a state can change without any other sign.
        deps.modal.changed.subscribe(() => {
          if (firstChanged) {
            firstChanged = false;
            return;
          }
          onModalChanged();
        }),
        deps.editor.onDidChangeContent((id) => {
          if (id !== deps.docs.getActiveId()) return;
          // The keystroke path: schedule and nothing else.
          dirty = true;
          edited = true;
          schedule();
          armViewCheck();
        }),
        deps.editor.onDidActivate(() => markDirty()),
        deps.editor.onDidAttach(() => markDirty()),
        // A dialect switch changes the document's profile id; the list emits for many other reasons.
        deps.docs.list.subscribe(() => {
          const id = deps.docs.getActiveId();
          const profile = id === null ? undefined : deps.docs.get(id)?.profileId;
          if (profile === activeProfile) return;
          activeProfile = profile;
          markDirty();
        }),
      ];
      for (const revision of [deps.machineRevision, deps.profileRevision]) {
        if (revision === undefined) continue;
        let first = true;
        stops.push(
          revision.subscribe(() => {
            if (first) {
              first = false;
              return;
            }
            views.clear();
            markDirty();
          }),
        );
      }
      schedule();
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        started = false;
        for (const stop of stops) stop();
        stops = [];
        frame?.();
        frame = null;
        viewCheck?.();
        viewCheck = null;
        clearMarks();
        for (const hook of hooks) hook.dispose();
        hooks = [];
        collection = null;
        bound = undefined;
        views.clear();
      };
    },

    flush(): void {
      frame?.();
      frame = null;
      update();
    },
  };
}
