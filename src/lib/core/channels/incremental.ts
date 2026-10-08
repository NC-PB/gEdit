// The resolution after an edit, from the one before it (M12 performance fix F2).
//
// The channel service re-resolved the whole document 150 ms after every pause in typing:
// at 300,000 lines with 20,000 waits that read every line again, and the app froze for that
// long after each pause. An edit almost never changes a channel's sections: it changes the
// lines it touches, and shifts the ones after it. So when the edited lines held no line that
// decided a section (`boundaries`) and hold none now, the sections are the old ones with the
// lines after the edit shifted, and the marks are the old ones outside the edit (shifted the
// same way) plus whatever the edited lines hold now, read by the same `findMarks`.
//
// Whenever that reasoning does not hold — a section start or end touched or written, a line
// too long to read, a problem or a dropped mark in the old answer, a marker line of a
// `multi-file` header edited, counts that do not add up — `patchResolution` answers null and
// the caller resolves the whole document as before. The answer is never a guess: the unit test
// holds it to `resolveDocument` over random edits.

import type { CompiledProfile } from '$lib/core/profiles/types';
import { findMarks, maskForMarks, sectionOwners } from './marks';
import { compileChannelPattern, complementRanges } from './resolve';
import { lookbehindPrefilter } from './prefilter';
import { CHANNEL_CAPS, type ChannelBudget, type ChannelParams, type ChannelRef, type ChannelSection, type SyncHit } from './types';

/** The lines an edit replaced: `startLine..endLineOld` of the old text are `startLine..endLineNew` now. */
export interface DirtySpan {
  startLine: number;
  endLineOld: number;
  endLineNew: number;
}

/** What `patchResolution` reads and answers: one resolved document. */
export interface LineResolution {
  layout: 'single-file' | 'multi-file';
  /** `multi-file`: this document's channel. */
  self: ChannelRef | null;
  sections: ChannelSection[];
  outside: { startLine: number; endLine: number }[];
  marks: SyncHit[];
  /** `single-file`: the lines that decided a section (`FindSectionsResult.boundaries`). */
  boundaries: number[];
  lineCount: number;
}

/**
 * Two edits in a row as one span of the text before both (the second span is given in the
 * coordinates of the text after the first). The union may hold untouched lines between the
 * two; they are read again, which costs a little and changes nothing.
 */
export function mergeDirty(first: DirtySpan | null, next: DirtySpan): DirtySpan {
  if (first === null) return { ...next };
  const startLine = Math.min(first.startLine, next.startLine);
  const endNow = Math.max(first.endLineNew, next.endLineOld); // in the text between the two edits
  return {
    startLine,
    endLineOld: first.endLineOld + (endNow - first.endLineNew),
    endLineNew: endNow + (next.endLineNew - next.endLineOld),
  };
}

/** The index of the first hit on `line` or after it (`hits` in line order). */
function firstAtOrAfter(hits: readonly SyncHit[], line: number): number {
  let lo = 0;
  let hi = hits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hits[mid].line < line) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The resolution of the edited document, from `prev` and the edit, or null when only a full
 * resolution can say (see the file comment). `readLines(from, to)` reads the edited lines of
 * the new text (1-based, inclusive); `lineCount` is the new text's. `o.deadline` holds the
 * edited lines to the resolution's budget as `findMarks` holds a whole document: past it the
 * answer is null (M12 perf review PERF-4: a paste of many lines was read with no deadline).
 */
export function patchResolution(
  prev: LineResolution & { problems: readonly unknown[]; dropped: number },
  d: DirtySpan,
  lineCount: number,
  readLines: (from: number, to: number) => string[],
  cp: CompiledProfile,
  p: ChannelParams,
  o: ChannelBudget = {},
): LineResolution | null {
  const delta = d.endLineNew - d.endLineOld;
  if (prev.problems.length > 0 || prev.dropped > 0) return null;
  if (d.startLine < 1 || d.endLineOld < d.startLine || d.endLineNew < d.startLine || d.endLineOld > prev.lineCount) return null;
  if (prev.lineCount + delta !== lineCount) return null;
  if (prev.layout === 'single-file') {
    if (prev.boundaries.some((b) => b >= d.startLine && b <= d.endLineOld)) return null;
  } else if (prev.self === null || d.startLine <= CHANNEL_CAPS.markerLines) {
    return null; // the header marker is read from the first lines
  }

  const lines = readLines(d.startLine, d.endLineNew);
  if (lines.length !== d.endLineNew - d.startLine + 1) return null;
  const masked = lines.map((line) => maskForMarks(line, cp));
  if (lines.some((line) => line.length > CHANNEL_CAPS.lineLength)) return null;
  if (prev.layout === 'single-file') {
    for (const pattern of [p.sectionStart, p.sectionEnd]) {
      if (typeof pattern !== 'string') continue;
      const compiled = compileChannelPattern(pattern, cp.flags, '');
      if ('problem' in compiled) return null;
      const pre = lookbehindPrefilter(compiled.re);
      if (masked.some((m) => (pre === null || pre.test(m)) && ((compiled.re.lastIndex = 0), compiled.re.test(m)))) return null;
    }
  }

  const shift = (line: number): number => (line > d.endLineOld ? line + delta : line);
  let sections = prev.sections;
  if (prev.layout === 'single-file') {
    sections = [];
    for (const s of prev.sections) {
      const ranges: { startLine: number; endLine: number }[] = [];
      for (const r of s.ranges) {
        if (r.endLine < d.startLine) ranges.push(r);
        else if (r.startLine > d.endLineOld) ranges.push({ startLine: r.startLine + delta, endLine: r.endLine + delta });
        else if (r.startLine < d.startLine && r.endLine >= d.endLineOld) ranges.push({ startLine: r.startLine, endLine: r.endLine + delta });
        else return null; // a range that starts or ends inside the edit: a boundary moved
      }
      sections.push({ channel: s.channel, ranges });
    }
  }

  const owners =
    prev.layout === 'single-file'
      ? sectionOwners(sections)
      : (() => {
          const id = (prev.self as ChannelRef).id;
          return () => id;
        })();
  const offset = d.startLine - 1;
  const found = findMarks(lines, cp, p, { ...o, channelOf: (line) => owners(line + offset), masked: (i) => masked[i] });
  if (found.dropped > 0 || (found.longLines ?? 0) > 0 || found.abandoned) return null;

  const from = firstAtOrAfter(prev.marks, d.startLine);
  const to = firstAtOrAfter(prev.marks, d.endLineOld + 1);
  const count = from + found.marks.length + (prev.marks.length - to);
  if (count > CHANNEL_CAPS.marks) return null;
  const marks: SyncHit[] = prev.marks.slice(0, from);
  for (const hit of found.marks) marks.push({ ...hit, line: hit.line + offset });
  for (let i = to; i < prev.marks.length; i++) {
    const hit = prev.marks[i];
    marks.push(delta === 0 ? hit : { ...hit, line: hit.line + delta, partners: [...hit.partners] });
  }

  return {
    layout: prev.layout,
    self: prev.self,
    sections,
    outside: prev.layout === 'single-file' ? complementRanges(sections.flatMap((s) => s.ranges), lineCount) : [],
    marks,
    boundaries: prev.boundaries.map(shift),
    lineCount,
  };
}
