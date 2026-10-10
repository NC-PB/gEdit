// Applying a transform's lines to a model (plan §7.3, AD-5, AD-12). Owner: **WP4.1**.
//
// This is the one place that turns a `TransformResult` into edits, and the **one undo
// step** rule lives here: `pushStackElement()`, then `pushEditOperations()` with every edit
// `computeLineEdits` found (in batches, see below), then `pushStackElement()` again. One Cmd+Z has to
// put the program back exactly as it was — a renumber that takes four undos to reverse is
// a transform nobody trusts.
//
// Why minimal edits and not `replaceAll`: bookmarks (WP4.4), folds, the overview ruler and
// the cursor all sit on model positions. Rewriting the whole range moves every one of
// them; editing only the lines that differ leaves the untouched ones alone, which is what
// H4's "a bookmark on an untouched line survives remove-empty-lines and renumber" checks.
// Within a single rewritten line the edit narrows once more, to the characters that
// actually differ (`charSpan`), so renumbering `N100 G1 X12.5` to `N110 G1 X12.5` touches
// three characters and leaves a bookmark, a fold and the cursor at the end of the line
// exactly where they were.
//
// That narrowing has to be reached, though, and reaching it is what `splitEqualCountEdits`
// is for. The diff hands back one hunk per *run* of differing lines, and in a renumber
// every block changes, so a program is one hunk from its first block to its last and the
// per-line narrowing would never run. A hunk that replaces n lines by n lines is therefore
// split back into its lines before the ranges are built (H4 found this: after a renumber
// every bookmark and the cursor inside the renumbered run had moved).
//
// Monaco's `pieceTreeTextBuffer._reduceOperations` collapses a batch of **1000 or more**
// operations given to one `pushEditOperations` into a single edit spanning all of them, to
// avoid the allocation storm a formatter can cause, and every bookmark, fold and cursor
// between the first and the last of them then moves. So the narrow edits go to the model
// in **several calls of at most `MAX_OPERATIONS_PER_CALL`** (999), the last batch first so
// the line numbers of the earlier ones stay true (B1 A4; before that, a plan of 1000 or
// more narrow edits fell back to one whole hunk and a bookmark on an untouched line moved).
//
// **Undo has the same limit, and joining the batches in one stack element walks into it**
// (B1 fixperf). Monaco's undo element keeps *one* list of the changes of everything pushed
// into it (`compressConsecutiveTextChanges`), and `undo()` hands the whole list to one
// `applyEdits` — so 1,500 narrow edits, applied in two calls, were taken back as 1,500
// operations in one call, collapsed into one edit from the first to the last, and the
// bookmarks and folds in between landed elsewhere (3, 1501, 2999 became 2, 930, 1836; the
// text itself came back exactly). Redo has the same shape. So each batch is **its own undo
// element**, and the elements share one undo *group*, which Monaco's undo/redo service
// takes back as one step (`pushEditOperations`' fourth argument; the service undoes the
// group's elements newest first, each of at most 999 changes). One Cmd+Z, one Cmd+Shift+Z,
// every mark where it belongs. A plan of one batch needs no group and is pushed as before.
//
// Above ~20k changed lines, switch to chunked whole-line hunks (AD-12): past that point
// per-line edits cost more than they save, and Monaco's edit application is the bottleneck
// rather than the diff. The gaps between the merged edits are filled from the old lines,
// which are equal on both sides, so a chunked plan produces exactly the same text.
//
// What still leaves the decorations inside a hunk behind: above `CHUNK_LINES` changed lines
// the plan is merged into whole-line hunks on purpose, and a hunk that replaces several
// different lines (not n by n) is one operation whatever its size.
//
// Text always travels as LF (`monaco/editorService.ts`): Monaco normalizes what is
// inserted to the model's own EOL, so a CRLF document stays CRLF.
//
// **The read-only lock.** This writes the model, not the editor, so Monaco's `readOnly`
// option never sees it (AD-23). The callers refuse a locked document before they run and
// say why (`app/readOnlyLock.ts`); the check in `applyLines` below is the backstop that
// keeps a caller which forgot from writing a locked program anyway.

import { charSpan, computeLineEdits, type LineEdit } from '$lib/core/transforms/lineDiff';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import type { DocId } from '$lib/app/types';

/** How many changed lines it takes to switch to chunked hunks, and how big a hunk gets. */
export const CHUNK_LINES = 20_000;

/**
 * The batch size at which Monaco stops applying the operations it was given and applies
 * one edit covering all of them instead (`pieceTreeTextBuffer._reduceOperations`: "a
 * thousand edits work fine regardless of their shape"). It is a limit of one
 * `pushEditOperations` call, so a plan is handed over in calls below it.
 */
export const MONACO_REDUCES_AT = 1000;

/** The most operations one `pushEditOperations` call carries: one under what Monaco collapses. */
export const MAX_OPERATIONS_PER_CALL = MONACO_REDUCES_AT - 1;

/** Monaco's `IRange`, spelled out so this module needs no value import of Monaco. */
export interface EditRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** One entry of the single `pushEditOperations` call. */
export interface LineOperation {
  range: EditRange;
  text: string;
}

/**
 * The part of `ITextModel` this module uses. Monaco's model satisfies it structurally,
 * and so does a plain object in a test, which is why the planning and the application
 * below can be checked without loading the editor.
 */
export interface EditableModel {
  getLineCount(): number;
  getLineContent(line: number): string;
  getLineMaxColumn(line: number): number;
  pushStackElement(): void;
  pushEditOperations(
    beforeCursorState: null,
    operations: LineOperation[],
    cursorStateComputer: () => null,
    group?: UndoGroup,
  ): unknown;
}

/**
 * What Monaco's undo/redo service reads from an `UndoRedoGroup` (`platform/undoRedo`):
 * the elements pushed with the same `id` are undone, and redone, together. The class itself
 * is not imported (this module keeps Monaco out of the initial bundle); `realModel.ts` and
 * `applyLinesUndo.test.ts` run the real service, so a Monaco that reads more than this
 * fails a test.
 */
export interface UndoGroup {
  readonly id: number;
  nextOrder(): number;
}

/**
 * Monaco numbers its own groups 1, 2, 3, ... (0 is "no group"); ours start far above, so a
 * group of ours never equals one of its own.
 */
let nextGroupId = 1_000_000_000;

/** A fresh undo group: the elements pushed with it undo as one step, in the order pushed. */
export function newUndoGroup(): UndoGroup {
  let order = 1;
  return { id: nextGroupId++, nextOrder: () => order++ };
}

/** What `planLineEdits` worked out: the operations, and what the summary reports. */
export interface ApplyPlan {
  operations: LineOperation[];
  /** Lines the minimal edit set touches, before any chunking widened it. */
  changedLines: number;
}

// ---------------------------------------------------------------------------
// Planning (pure; exported for the unit tests)
// ---------------------------------------------------------------------------

/** The lines an edit affects: whichever side of it is longer. */
function sizeOf(edit: LineEdit): number {
  return Math.max(edit.oldEnd - edit.oldStart, edit.newLines.length);
}

/**
 * Merges neighbouring edits into hunks of at most `chunkLines` old lines. The untouched
 * lines between two merged edits are copied from `oldLines`, so the text is unchanged;
 * only the number of operations Monaco has to apply comes down.
 */
function coalesceEdits(edits: LineEdit[], oldLines: string[], chunkLines: number): LineEdit[] {
  const out: LineEdit[] = [];
  let current: LineEdit | null = null;
  for (const edit of edits) {
    if (current !== null && edit.oldEnd - current.oldStart <= chunkLines) {
      for (let i = current.oldEnd; i < edit.oldStart; i++) current.newLines.push(oldLines[i]);
      for (const line of edit.newLines) current.newLines.push(line);
      current.oldEnd = edit.oldEnd;
      continue;
    }
    current = { oldStart: edit.oldStart, oldEnd: edit.oldEnd, newLines: [...edit.newLines] };
    out.push(current);
  }
  return out;
}

/**
 * Splits every hunk that replaces n old lines by n new lines (n > 1) into one edit per
 * line, and drops the lines that are equal on both sides.
 *
 * This is what lets `operationFor` narrow to `charSpan`: it only does so for a hunk of
 * exactly one line, and `sameLengthEdits` merges a run of consecutive differing lines into
 * one. Splitting costs one Monaco operation per changed line instead of one per run, which
 * is the trade AD-12 already describes.
 *
 * However many pieces that makes, the plan goes to the model in calls of at most
 * `MAX_OPERATIONS_PER_CALL` (`batchOperations`), so Monaco never collapses them.
 *
 * The text is unaffected: the pieces cover exactly the same old lines with exactly the
 * same new ones. The order stays ascending, and two pieces of one hunk are adjacent rather
 * than overlapping (`[i, i+1)` then `[i+1, i+2)`), which is a range Monaco accepts because
 * the line break sits between them. No piece is ever a deletion, so the invariant that
 * guards a deletion's line break is not the one being relied on here.
 */
function splitEqualCountEdits(edits: LineEdit[], oldLines: string[]): LineEdit[] {
  const splittable = (edit: LineEdit): boolean =>
    edit.oldEnd - edit.oldStart > 1 && edit.oldEnd - edit.oldStart === edit.newLines.length;
  if (!edits.some(splittable)) return edits;

  const out: LineEdit[] = [];
  for (const edit of edits) {
    if (!splittable(edit)) {
      out.push(edit);
      continue;
    }
    for (let i = edit.oldStart; i < edit.oldEnd; i++) {
      const line = edit.newLines[i - edit.oldStart];
      if (oldLines[i] === line) continue;
      out.push({ oldStart: i, oldEnd: i + 1, newLines: [line] });
    }
  }
  return out;
}

/**
 * The Monaco operation for one edit.
 *
 * `startLine` is the document line `oldLines[0]` came from, `modelLineCount` the document's
 * length, and `maxColumn(line)` its `getLineMaxColumn`. The three shapes:
 *
 *  - a replacement narrows to `charSpan` when exactly one line becomes exactly one line;
 *  - a deletion takes a line break with it — the one after the block, or, at the end of
 *    the document, the one before it, because a document cannot lose its last line break
 *    and keep its line count;
 *  - an insertion writes at column 1 of the line it goes before, or after the last line.
 */
function operationFor(
  edit: LineEdit,
  oldLines: string[],
  startLine: number,
  modelLineCount: number,
  maxColumn: (line: number) => number,
): LineOperation {
  const first = startLine + edit.oldStart;
  const last = startLine + edit.oldEnd - 1;

  if (edit.oldEnd === edit.oldStart) {
    const text = edit.newLines.join('\n');
    if (first <= modelLineCount) {
      return {
        range: { startLineNumber: first, startColumn: 1, endLineNumber: first, endColumn: 1 },
        text: `${text}\n`,
      };
    }
    const end = maxColumn(modelLineCount);
    return {
      range: {
        startLineNumber: modelLineCount,
        startColumn: end,
        endLineNumber: modelLineCount,
        endColumn: end,
      },
      text: `\n${text}`,
    };
  }

  if (edit.newLines.length === 0) {
    if (last < modelLineCount) {
      return {
        range: { startLineNumber: first, startColumn: 1, endLineNumber: last + 1, endColumn: 1 },
        text: '',
      };
    }
    if (first > 1) {
      return {
        range: {
          startLineNumber: first - 1,
          startColumn: maxColumn(first - 1),
          endLineNumber: last,
          endColumn: maxColumn(last),
        },
        text: '',
      };
    }
    // The whole document goes; Monaco keeps one empty line, which is what an empty
    // document is.
    return {
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: last, endColumn: maxColumn(last) },
      text: '',
    };
  }

  if (edit.oldEnd - edit.oldStart === 1 && edit.newLines.length === 1) {
    const span = charSpan(oldLines[edit.oldStart], edit.newLines[0]);
    if (span !== null) {
      return {
        range: {
          startLineNumber: first,
          startColumn: span.start + 1,
          endLineNumber: first,
          endColumn: span.endOld + 1,
        },
        text: span.text,
      };
    }
  }

  return {
    range: {
      startLineNumber: first,
      startColumn: 1,
      endLineNumber: last,
      endColumn: maxColumn(last),
    },
    text: edit.newLines.join('\n'),
  };
}

/**
 * The operations in groups of at most `MAX_OPERATIONS_PER_CALL`, in document order. They are
 * applied from the last group to the first (`applyLinesTo`): every range is in the
 * coordinates of the document as it was, and an edit further down never moves a line above it.
 */
export function batchOperations(operations: LineOperation[]): LineOperation[][] {
  const batches: LineOperation[][] = [];
  for (let at = 0; at < operations.length; at += MAX_OPERATIONS_PER_CALL) {
    batches.push(operations.slice(at, at + MAX_OPERATIONS_PER_CALL));
  }
  return batches;
}

/** The whole plan: the diff, the chunking decision and the Monaco ranges. */
export function planLineEdits(o: {
  oldLines: string[];
  newLines: string[];
  /** The document line `oldLines[0]` came from, 1-based. */
  startLine: number;
  modelLineCount: number;
  maxColumn: (line: number) => number;
  lineMap?: Int32Array;
  chunkLines?: number;
}): ApplyPlan {
  const edits = computeLineEdits(o.oldLines, o.newLines, o.lineMap);
  if (edits.length === 0) return { operations: [], changedLines: 0 };

  let changedLines = 0;
  for (const edit of edits) changedLines += sizeOf(edit);

  const chunkLines = o.chunkLines ?? CHUNK_LINES;
  const planned =
    changedLines > chunkLines
      ? coalesceEdits(edits, o.oldLines, chunkLines)
      : splitEqualCountEdits(edits, o.oldLines);
  const operations = planned.map((edit) =>
    operationFor(edit, o.oldLines, o.startLine, o.modelLineCount, o.maxColumn),
  );
  return { operations, changedLines };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * `applyLines` against any model-shaped object. The document lookup is the only thing
 * the exported entry point adds.
 */
export function applyLinesTo(
  model: EditableModel,
  startLine: number,
  endLine: number,
  newLines: string[],
  lineMap?: Int32Array,
): { changedLines: number } {
  const modelLineCount = model.getLineCount();
  const first = Math.min(Math.max(Math.floor(startLine), 1), modelLineCount);
  const last = Math.min(Math.max(Math.floor(endLine), first), modelLineCount);

  const oldLines: string[] = [];
  for (let line = first; line <= last; line++) oldLines.push(model.getLineContent(line));

  const plan = planLineEdits({
    oldLines,
    newLines,
    startLine: first,
    modelLineCount,
    maxColumn: (line) => model.getLineMaxColumn(line),
    lineMap,
  });
  if (plan.operations.length === 0) return { changedLines: 0 };

  // One undo step, whatever the plan turned out to be (AD-12). Last batch first, so the
  // ranges of the earlier ones still point at the lines they were computed for. A plan of
  // one batch is one undo element between the two stack elements. A longer plan puts every
  // batch into an element of its own and ties them with a group, because Monaco takes back
  // an element's changes in one call and would collapse 1000 of them (see the header).
  const batches = batchOperations(plan.operations);
  const group = batches.length > 1 ? newUndoGroup() : undefined;
  model.pushStackElement();
  for (let i = batches.length - 1; i >= 0; i--) {
    model.pushEditOperations(null, batches[i], () => null, group);
    if (group !== undefined) model.pushStackElement();
  }
  if (group === undefined) model.pushStackElement();
  return { changedLines: plan.changedLines };
}

/**
 * Replaces lines `startLine..endLine` (1-based, inclusive) of document `id` with
 * `newLines`, as **one** undo step, editing only what differs.
 *
 * `lineMap` is `TransformResult.lineMap` and is passed straight to `computeLineEdits`.
 * Returns how many lines were actually touched, which is what the status summary and the
 * G7 budget are measured against.
 *
 * Does nothing (and answers `{ changedLines: 0 }`) when the document has no model or
 * nothing differs, so a transform that changed nothing does not dirty the document — and
 * nothing when the document is locked (`locked: true`), which a caller should have
 * refused already.
 */
export function applyLines(
  id: DocId,
  startLine: number,
  endLine: number,
  newLines: string[],
  lineMap?: Int32Array,
): { changedLines: number; locked?: true } {
  if (appDocs.get(id)?.readOnly === true) {
    console.error(`applyLines: document ${id} is locked; the caller should have refused`);
    return { changedLines: 0, locked: true };
  }
  const model = appEditor.model(id);
  if (!model) return { changedLines: 0 };
  return applyLinesTo(model, startLine, endLine, newLines, lineMap);
}
