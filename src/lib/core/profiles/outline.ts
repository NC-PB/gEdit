// The outline index behind the program map, the quick outline and folding
// (plan §7.4, AD-12). Owner: WP3.5.
//
// `OutlineIndex` caches the classification of each line and splices that cache on a
// content change, so a one-line edit in a 300k-line program costs one line of work plus a
// linear aggregation, not a full re-parse. There is no worker: the first build runs after
// the first render, in 20k-line chunks (`OutlineService`, `app/outlineService.ts`).
//
// Two passes, and the split between them is the whole design:
//
//   classify(line)   pure, per line, no neighbours. Runs the profile's `outline` rules
//                    and the tool-call rule over one line and keeps the result in
//                    `marks`. Because it looks at nothing else, an edit only ever
//                    reclassifies the lines that changed.
//   aggregate()      linear over `marks`. Everything that needs neighbours happens here:
//                    the last `T` before a tool change, the descriptive comment near a
//                    tool line, the tree, and `endLine`. It is cheap because it reads the
//                    cached marks, never the text.
//
// Rules (plan §5 WP3.5, dialect-profiles.md "Outline (program map)"):
//   - The first matching `outline` rule of the profile wins. `comment` and `section`
//     rules see the raw line; every other rule sees the line with comments masked, so
//     `(T1 M6)` in a comment is never a tool change.
//   - A tool change outranks the `outline` rules: it is the spine of the map.
//   - `toolCall.toolFrom: 'same-line-or-last'` takes the tool from the same line or from
//     the last `T` word before it; a bare `T` word is not a tool change.
//   - The result is a two-level tree: an item inside a tool segment becomes a child of
//     it. The plan names comments and sections; a `stop` or a `label` between two tool
//     calls is inside that segment just as much, and leaving those at the top level
//     printed them *after* the segment's children, out of line order.
//   - A tool label is `T<n>` plus the nearest descriptive comment (trailing on the line,
//     else up to 3 lines above, else up to 2 lines below), filtered by
//     `toolList.commentFilter`. "Nearest" is not enough on its own: the scan stops at a
//     program header, whose comment is the program's title, and at another tool change,
//     and it drops a comment that names a different tool. A header tool-list line
//     (`(T5  D12 FLAT END MILL)`, `syntax-fanuc` §5.3) labels a tool that has no comment
//     of its own, and gives up its `T<n>` because the row already carries it.
//   - `endLine` closes a segment, which is what the folding provider ranges over. A tool
//     segment ends before the next tool change or the next program start; a program ends
//     before the next program; a section ends before the next section, tool or program.

import { maskComments } from '$lib/core/nc/mask';
import type { CompiledProfile, OutlineKind } from './types';

/** One row of the program map. Lines are 1-based, like Monaco's. */
export interface OutlineItem {
  kind: OutlineKind;
  line: number;
  /** Last line of the segment, for folding. */
  endLine?: number;
  /** Display text; already assembled, not an i18n key. */
  text: string;
  /** Tool number of a `tool` item, as written in the program. */
  tool?: string;
  children?: OutlineItem[];
}

/** Between the tool label and its descriptive comment (`T1 — CONTOUR ROUGH`). */
const LABEL_SEPARATOR = ' — ';

/** How far `toolList.description` looks for a comment that describes a tool call. */
const LOOK_ABOVE = 3;
const LOOK_BELOW = 2;

/** Above this many new lines, `applyChange` rebuilds the tail instead of spreading it. */
const MAX_SPREAD = 1024;

/** What one line contributes. `null` in `marks` means "this line says nothing". */
interface LineMark {
  /** The `outline` rule that matched, or null. Never `'tool'`: that comes from `isTool`. */
  kind: OutlineKind | null;
  /** Display text of `kind`. */
  text: string;
  /** The tool-call trigger fired on this line. */
  isTool: boolean;
  /** The tool written on this line, trigger or not (`T2` on its own preselects a tool). */
  tool: string | null;
  /** Comment or heading text of this line, usable as a tool description. */
  description: string | null;
}

/** The per-profile settings the two passes read, derived once. */
interface OutlineSpec {
  /** `toolCall.toolFrom === 'same-line-or-last'`. */
  toolFromLast: boolean;
  description: 'auto' | 'above' | 'below' | 'trailing';
  /** A description that matches is decoration (`------`), not a description. */
  commentFilter: RegExp | null;
  dropLeadingZeros: boolean;
  collapseOffsetDigits: boolean;
  comments: { start: string; end: string | null }[];
  /** True when any code rule needs the masked line (all of them but comment/section). */
  needsMask: boolean;
}

const SPECS = new WeakMap<CompiledProfile, OutlineSpec>();

function buildSpec(cp: CompiledProfile): OutlineSpec {
  const toolList = cp.profile.toolList;
  const comments = (cp.profile.syntax?.comments ?? [])
    .filter((marker) => typeof marker?.start === 'string' && marker.start !== '')
    .map((marker) => ({ start: marker.start, end: typeof marker.end === 'string' && marker.end !== '' ? marker.end : null }));
  return {
    toolFromLast: cp.profile.toolCall?.toolFrom === 'same-line-or-last',
    description: toolList?.description ?? 'auto',
    commentFilter: cp.re.commentFilter ?? null,
    dropLeadingZeros: toolList?.dropLeadingZeros === true,
    collapseOffsetDigits: toolList?.collapseOffsetDigits === true,
    comments,
    needsMask: comments.length > 0,
  };
}

function specOf(cp: CompiledProfile): OutlineSpec {
  let spec = SPECS.get(cp);
  if (!spec) {
    spec = buildSpec(cp);
    SPECS.set(cp, spec);
  }
  return spec;
}

/** True when the line is empty or holds nothing but whitespace. */
function isBlank(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0b && code !== 0x0c && code !== 0xa0) return false;
  }
  return true;
}

/**
 * The comment text of a line, read off the mask.
 *
 * `maskComments` blanks exactly the comment spans and keeps every offset, so a run of
 * blanks in the mask that is not blank in the line is a comment. The last one wins: a
 * trailing comment describes the code in front of it, which is what a tool call needs.
 */
function commentTextOf(line: string, masked: string): string | null {
  if (masked === line) return null;
  let found: string | null = null;
  let i = 0;
  while (i < line.length) {
    if (masked.charCodeAt(i) !== 0x20) {
      i++;
      continue;
    }
    let j = i;
    while (j < line.length && masked.charCodeAt(j) === 0x20) j++;
    const span = line.slice(i, j).trim();
    if (span !== '') found = span;
    i = j;
  }
  return found;
}

/** Drops the comment delimiters a span still carries (`(D8 DRILL)`, `; D8 DRILL`). */
function stripMarkers(text: string, spec: OutlineSpec): string {
  for (const marker of spec.comments) {
    if (!text.toUpperCase().startsWith(marker.start.toUpperCase())) continue;
    let inner = text.slice(marker.start.length);
    if (marker.end !== null && inner.toUpperCase().endsWith(marker.end.toUpperCase())) {
      inner = inner.slice(0, inner.length - marker.end.length);
    }
    return inner.trim();
  }
  return text.trim();
}

/**
 * What an outline rule shows: its `text` group, else the whole match, else the line.
 *
 * The match is preferred over the `name` group, because `O1001` and `LBL 1` read better
 * in the map than the bare `1001` and `1` the group carries.
 */
function displayText(match: RegExpExecArray, line: string): string {
  const named = match.groups?.text;
  if (typeof named === 'string' && named.trim() !== '') return named.trim();
  const whole = match[0].trim();
  return whole !== '' ? whole : line.trim();
}

/**
 * Classifies one line on its own. This is the only function that touches the text, and it
 * never looks at another line, which is what makes `applyChange` a splice.
 */
function classify(line: string, cp: CompiledProfile, spec: OutlineSpec): LineMark | null {
  if (isBlank(line)) return null;

  const masked = spec.needsMask ? maskComments(line, cp) : line;

  let kind: OutlineKind | null = null;
  let text = '';
  for (const rule of cp.re.outline) {
    const raw = rule.kind === 'comment' || rule.kind === 'section';
    const match = rule.re.exec(raw ? line : masked);
    if (match === null) continue;
    kind = rule.kind;
    text = displayText(match, line);
    break;
  }

  // A trigger line that also matches `toolCall.ignore` is not a tool change: a Fanuc lathe
  // writes `T0100` to cancel the offset of station 1, and `G00 X100. Z100. T0100` to
  // retract with it. Counting those would put a tool step on every retract (§7.1).
  const isTool = cp.re.toolTrigger.test(masked) && !(cp.re.toolIgnore?.test(masked) ?? false);
  let tool: string | null = null;
  if (isTool || spec.toolFromLast) {
    const match = cp.re.tool.exec(masked);
    if (match !== null) {
      const group = match.groups?.tool;
      tool = (typeof group === 'string' && group !== '' ? group : match[0]).trim();
    }
  }

  let description: string | null = null;
  if (kind === 'comment' || kind === 'section') description = text;
  else {
    const span = commentTextOf(line, masked);
    if (span !== null) description = stripMarkers(span, spec);
  }
  if (description !== null && (description === '' || spec.commentFilter?.test(description) === true)) {
    description = null;
  }

  if (kind === null && !isTool && tool === null && description === null) return null;
  // A tool change with neither a tool number nor a comment still needs a label, so the
  // line itself is kept as the last fallback (`M6` on its own after no `T` at all).
  if (isTool && kind === null && text === '') text = line.trim();
  return { kind, text, isTool, tool, description };
}

/** The tool as it identifies a station: quotes gone, a lathe offset pair collapsed. */
function bareTool(tool: string, spec: OutlineSpec): string {
  let value = tool;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
  if (spec.collapseOffsetDigits && /^\d+$/.test(value) && value.length >= 4 && value.length % 2 === 0) {
    value = value.slice(0, value.length / 2);
  }
  return value;
}

const LEADING_ZEROS = /^0+(?=\d)/;

/** `T01` → `T1`, `T0101` → `T1` on a lathe profile, `"MILL_D10"` → `MILL_D10`. */
function toolLabel(tool: string, spec: OutlineSpec): string {
  let value = bareTool(tool, spec);
  if (!/^\d/.test(value)) return value;
  if (spec.dropLeadingZeros) value = value.replace(LEADING_ZEROS, '');
  return `T${value}`;
}

/**
 * The tool's number for comparing, or null for a name or a `QS` parameter.
 *
 * Always without leading zeros, whatever the profile does for display: `T01` and `T1` are
 * the same station, and the header tool list may write either.
 */
function toolNumberOf(tool: string, spec: OutlineSpec): string | null {
  const value = bareTool(tool, spec);
  return /^\d+$/.test(value) ? value.replace(LEADING_ZEROS, '') : null;
}

/**
 * A comment that names a tool in front: `T5  D12 FLAT END MILL`, the line a CAM post
 * prints in the header tool list (`syntax-fanuc` §5.3).
 */
const TOOL_LIST_ENTRY = /^T0*(\d+)(?![\d.])[\s:\-–—]*/i;

/** `T5  D12 FLAT END MILL` → `{ number: '5', text: 'D12 FLAT END MILL' }`, else null. */
function toolListEntry(description: string | null): { number: string; text: string } | null {
  if (description === null) return null;
  const match = TOOL_LIST_ENTRY.exec(description);
  if (match === null) return null;
  const text = description.slice(match[0].length).trim();
  return text === '' ? null : { number: match[1].replace(LEADING_ZEROS, ''), text };
}

/**
 * The part of a comment that describes tool `number`, or null when it describes another.
 *
 * Without this, the nearest comment wins whoever it belongs to, and a header tool list
 * two lines up labels `T5` with the line that describes `T6` — the most damaging thing a
 * program map can say. A comment that names *this* tool loses the number, because the row
 * already carries it (`T4 — D16 FACE MILL`, not `T4 — T4  D16 FACE MILL`).
 */
function ownDescription(description: string, number: string | null): string | null {
  if (!TOOL_LIST_ENTRY.test(description)) return description;
  const listed = toolListEntry(description);
  if (listed === null || listed.number !== number) return null;
  return listed.text;
}

export class OutlineIndex {
  private readonly cp: CompiledProfile;
  private readonly spec: OutlineSpec;
  /** One entry per line, `marks[i]` for line `i + 1`; null when the line says nothing. */
  private marks: (LineMark | null)[] = [];
  /** The last aggregation, dropped by every change. */
  private tree: OutlineItem[] | null = null;
  private tools: number[] | null = null;

  constructor(cp: CompiledProfile) {
    this.cp = cp;
    this.spec = specOf(cp);
  }

  /** Rebuilds the whole index from `lines` (1-based when read back). */
  reset(lines: string[]): void {
    const marks: (LineMark | null)[] = new Array<LineMark | null>(lines.length);
    for (let i = 0; i < lines.length; i++) marks[i] = classify(lines[i], this.cp, this.spec);
    this.marks = marks;
    this.invalidate();
  }

  /**
   * Replaces lines `startLine`..`endLineOld` (1-based, inclusive) with `newLines`.
   *
   * The common case — one line replaced by one line — writes a single slot, so an edit in
   * a 300k-line program costs one `classify` call and nothing else.
   */
  applyChange(startLine: number, endLineOld: number, newLines: string[]): void {
    const count = this.marks.length;
    const start = Math.max(1, Math.min(startLine, count + 1)) - 1;
    const end = Math.max(start, Math.min(endLineOld, count));
    const removed = end - start;

    if (removed === newLines.length) {
      for (let i = 0; i < newLines.length; i++) this.marks[start + i] = classify(newLines[i], this.cp, this.spec);
      this.invalidate();
      return;
    }

    const fresh: (LineMark | null)[] = new Array<LineMark | null>(newLines.length);
    for (let i = 0; i < newLines.length; i++) fresh[i] = classify(newLines[i], this.cp, this.spec);
    if (fresh.length <= MAX_SPREAD) {
      this.marks.splice(start, removed, ...fresh);
    } else {
      // `splice(..., ...fresh)` passes one argument per line, and a 20k-line chunk or a
      // pasted program would be an argument list the engine may refuse. Rebuilding the
      // tail is linear either way, and it is free while the build appends at the end.
      const tail = this.marks.slice(start + removed);
      this.marks.length = start;
      for (const mark of fresh) this.marks.push(mark);
      for (const mark of tail) this.marks.push(mark);
    }
    this.invalidate();
  }

  /** The two-level tree, in line order. */
  items(): OutlineItem[] {
    if (this.tree === null) this.aggregate();
    return this.tree ?? [];
  }

  /** The lines that change the tool, ascending; what F7 and Shift+F7 step through. */
  toolLines(): number[] {
    if (this.tools === null) this.aggregate();
    return this.tools ?? [];
  }

  /** The innermost item that covers `line`, or null. */
  itemAt(line: number): OutlineItem | null {
    let best: OutlineItem | null = null;
    let bestSpan = Number.POSITIVE_INFINITY;
    const consider = (item: OutlineItem): void => {
      const end = item.endLine ?? item.line;
      if (line < item.line || line > end) return;
      const span = end - item.line;
      if (span <= bestSpan) {
        best = item;
        bestSpan = span;
      }
    };
    for (const item of this.items()) {
      consider(item);
      if (item.children) for (const child of item.children) consider(child);
    }
    return best;
  }

  private invalidate(): void {
    this.tree = null;
    this.tools = null;
  }

  /**
   * Walks `count` lines in `step` direction for a comment that describes this tool.
   *
   * It stops at a program header, whose comment is the program's title, and at another
   * tool change, which owns the comments around it. Without those two stops the scan
   * happily labels a tool with the program name or with the next tool's description.
   */
  private scanFor(line: number, step: 1 | -1, count: number, number: string | null): string | null {
    for (let i = 1; i <= count; i++) {
      const n = line + step * i;
      if (n < 1 || n > this.marks.length) return null;
      const mark = this.marks[n - 1];
      if (mark === null) continue;
      if (mark.kind === 'program' || mark.isTool) return null;
      if (mark.description === null) continue;
      const found = ownDescription(mark.description, number);
      if (found !== null) return found;
    }
    return null;
  }

  /**
   * The description of the tool call on `line`, following `toolList.description`.
   *
   * `fromList` is the header tool list collected so far. `syntax-fanuc` §5.3 gives it to
   * tools that have no comment of their own, so it is the last source, not the first.
   */
  private describeTool(line: number, tool: string | null, fromList: Map<string, string>): string | null {
    const mode = this.spec.description;
    const number = tool === null ? null : toolNumberOf(tool, this.spec);

    if (mode === 'trailing' || mode === 'auto') {
      const own = this.marks[line - 1]?.description ?? null;
      const found = own === null ? null : ownDescription(own, number);
      if (found !== null) return found;
    }
    if (mode === 'auto' || mode === 'above') {
      const found = this.scanFor(line, -1, LOOK_ABOVE, number);
      if (found !== null) return found;
    }
    if (mode === 'auto' || mode === 'below') {
      const found = this.scanFor(line, 1, LOOK_BELOW, number);
      if (found !== null) return found;
    }
    return number === null ? null : fromList.get(number) ?? null;
  }

  /**
   * Walks the marks once and builds the tree. Everything that needs more than one line
   * happens here, so `classify` can stay a pure per-line function.
   */
  private aggregate(): void {
    const items: OutlineItem[] = [];
    const tools: number[] = [];
    /** The open tool segment, so a comment below it becomes its child. */
    let segment: OutlineItem | null = null;
    /** The open program, so its `endLine` can be closed by the next one. */
    let program: OutlineItem | null = null;
    /** The open section, closed by the next section, tool or program. */
    let section: OutlineItem | null = null;
    /** The last `T` word seen, for `toolFrom: 'same-line-or-last'`. */
    let lastTool: string | null = null;
    /** Tool number → text of the header tool list, filled as the walk passes it. */
    const fromList = new Map<string, string>();

    const closeSection = (before: number): void => {
      if (section !== null) section.endLine = before - 1;
      section = null;
    };
    const closeSegment = (before: number): void => {
      closeSection(before);
      if (segment !== null) segment.endLine = before - 1;
      segment = null;
    };

    for (let i = 0; i < this.marks.length; i++) {
      const mark = this.marks[i];
      if (mark === null) continue;
      const line = i + 1;

      if (mark.tool !== null) lastTool = mark.tool;

      // A comment line of the header tool list (`(T5  D12 FLAT END MILL)`). The first
      // one per number wins, and it is registered before the tool change that uses it,
      // because a post prints the list above the program.
      if (mark.kind === 'comment' || mark.kind === 'section') {
        const listed = toolListEntry(mark.description);
        if (listed !== null && !fromList.has(listed.number)) fromList.set(listed.number, listed.text);
      }

      if (mark.isTool) {
        closeSegment(line);
        const tool = mark.tool ?? (this.spec.toolFromLast ? lastTool : null);
        const label = tool === null ? '' : toolLabel(tool, this.spec);
        const description = this.describeTool(line, tool, fromList);
        const text = [label, description].filter((part) => part !== null && part !== '').join(LABEL_SEPARATOR);
        const item: OutlineItem = { kind: 'tool', line, text: text !== '' ? text : mark.text };
        if (tool !== null) item.tool = tool;
        items.push(item);
        tools.push(line);
        segment = item;
        continue;
      }

      if (mark.kind === null) continue;

      if (mark.kind === 'program') {
        closeSegment(line);
        if (program !== null) program.endLine = line - 1;
        const item: OutlineItem = { kind: 'program', line, text: mark.text };
        items.push(item);
        program = item;
        continue;
      }

      const item: OutlineItem = { kind: mark.kind, line, text: mark.text };
      if (mark.kind === 'section') {
        closeSection(line);
        section = item;
      }
      // Everything inside an open tool segment is a child of it, not only comments and
      // sections: a `stop` or a `label` between two tool calls sits inside that segment
      // too, and leaving it at the top level would print it after the segment's children,
      // out of line order.
      if (segment !== null) (segment.children ??= []).push(item);
      else items.push(item);
    }

    const last = this.marks.length;
    closeSegment(last + 1);
    if (program !== null) program.endLine = last;

    this.tree = items;
    this.tools = tools;
  }
}
