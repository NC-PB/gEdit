// Applying a transform's lines to a model (plan §7.3, AD-5, AD-12). Owner: **WP4.1**.
//
// This is the one place that turns a `TransformResult` into edits, and the **one undo
// step** rule lives here: `pushStackElement()`, then a single `pushEditOperations()` with
// every edit `computeLineEdits` found, then `pushStackElement()` again. One Cmd+Z has to
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
// The split stops at `MONACO_REDUCES_AT`, and that number is not ours. Monaco's
// `pieceTreeTextBuffer._reduceOperations` collapses a batch of **1000 or more** operations
// into one edit spanning all of them, to avoid the allocation storm a formatter can cause.
// Past that point per-line edits are not merely wasted, they are worse than one hunk: the
// batch is collapsed anyway and building it cost a thousand ranges first. So a program
// with fewer than 1000 changed blocks keeps every decoration exactly where it was, and a
// bigger one falls back to the hunk it used to get. What that leaves open is below.
//
// Above ~20k changed lines, switch to chunked whole-line hunks (AD-12): past that point
// per-line edits cost more than they save, and Monaco's edit application is the bottleneck
// rather than the diff. The gaps between the merged edits are filled from the old lines,
// which are equal on both sides, so a chunked plan produces exactly the same text.
//
// **Known gap, for WP4.1 or M5.** `MONACO_REDUCES_AT` caps the *split*; it does not cap the
// plan. A transform that changes 1000 or more lines in 1000 or more separate places —
// `remove-comments` over a big CAM program, say — still hands Monaco a batch it collapses,
// and then every decoration between the first and the last edit moves. Capping the whole
// plan (merge neighbours until at most 999 operations are left, which `coalesceEdits`
// already knows how to do) would fix that case too, and would make the 20k line budget
// above redundant. It is a change to how every large transform applies, so it wants its
// own budget run rather than a place in an integration commit.
//
// Text always travels as LF (`monaco/editorService.ts`): Monaco normalizes what is
// inserted to the model's own EOL, so a CRLF document stays CRLF.

import { charSpan, computeLineEdits, type LineEdit } from '$lib/core/transforms/lineDiff';
import { editor as appEditor } from '$lib/monaco/editorService';
import type { DocId } from '$lib/app/types';

/** How many changed lines it takes to switch to chunked hunks, and how big a hunk gets. */
export const CHUNK_LINES = 20_000;

/**
 * The batch size at which Monaco stops applying the operations it was given and applies
 * one edit covering all of them instead (`pieceTreeTextBuffer._reduceOperations`: "a
 * thousand edits work fine regardless of their shape"). A plan of this many narrow edits
 * buys nothing — the collapsed edit moves the decorations inside it exactly as one hunk
 * would — so the split below stops here.
 */
export const MONACO_REDUCES_AT = 1000;

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
  ): unknown;
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
 * It is worth it only while the batch stays under `MONACO_REDUCES_AT`, so the answer is
 * `edits` unchanged when the split would reach that — Monaco would collapse the batch back
 * into one edit and the narrowing would have been thrown away.
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

  // What the split would cost, before building any of it.
  let count = 0;
  for (const edit of edits) count += splittable(edit) ? edit.oldEnd - edit.oldStart : 1;
  if (count >= MONACO_REDUCES_AT) return edits;

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

  // One undo step, whatever the plan turned out to be (AD-12).
  model.pushStackElement();
  model.pushEditOperations(null, plan.operations, () => null);
  model.pushStackElement();
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
 * nothing differs, so a transform that changed nothing does not dirty the document.
 */
export function applyLines(
  id: DocId,
  startLine: number,
  endLine: number,
  newLines: string[],
  lineMap?: Int32Array,
): { changedLines: number } {
  const model = appEditor.model(id);
  if (!model) return { changedLines: 0 };
  return applyLinesTo(model, startLine, endLine, newLines, lineMap);
}
