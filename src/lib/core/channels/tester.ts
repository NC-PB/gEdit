// The channel tester's report (plan §6 M12 WP12.3, "the tester"; AD-32).
//
// What the Machines page shows when the user pastes a program, or takes the active one, to
// try the channel settings they are editing: every channel with its sections, the lines
// that belong to no channel, the wait codes found with their partners, the problems, and
// how long each wait rule took. It runs the same pure functions as the app
// (`resolveDocument`, `findMarks`), never a second implementation, and it reads nothing but
// its arguments.

import type { CompiledProfile } from '$lib/core/profiles/types';
import { findMarks, resolveDocument } from './marks';
import { CHANNEL_CAPS } from './types';
import type { ChannelParams, ChannelProblem, ChannelRef, SyncHit } from './types';

/** A wait rule slower than this many milliseconds on the pasted text is flagged. */
export const SLOW_RULE_MS = 50;

export interface TesterSection {
  channel: ChannelRef;
  ranges: { startLine: number; endLine: number }[];
  /** Lines in all ranges. */
  lines: number;
}

export interface TesterRule {
  id: string;
  label: string;
  /** Marks the rule alone found. */
  marks: number;
  ms: number;
  slow: boolean;
}

export interface TesterReport {
  layout: ChannelParams['layout'];
  /** `multi-file`: the channel this text is, and how that was found. */
  self: ChannelRef | null;
  by: 'fileName' | 'marker' | null;
  sections: TesterSection[];
  outside: { startLine: number; endLine: number }[];
  marks: SyncHit[];
  problems: ChannelProblem[];
  rules: TesterRule[];
  /** The resolution ran out of time (then nothing else is shown). */
  abandoned: boolean;
  /** Marks beyond the cap, counted. */
  dropped: number;
  /** M12 review fix CODE-1: the per-rule timings share one budget (`CHANNEL_CAPS.resolveMs`);
   *  past it the remaining rules are not run and this is true (the last row is the slow one). */
  rulesAbandoned: boolean;
}

export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split(/\r\n|\r|\n/);
}

/**
 * Try `p` on `text`. `fileName` is the base name the file would have (only a `multi-file`
 * block reads it, to find the channel; the header marker is read from the text).
 */
export function testChannelRules(
  text: string,
  fileName: string,
  cp: CompiledProfile,
  p: ChannelParams,
  o: { now?: () => number } = {},
): TesterReport {
  const now = o.now ?? ((): number => performance.now());
  const lines = splitLines(text);
  const resolved = resolveDocument(fileName, lines, cp, p, { deadline: now() + CHANNEL_CAPS.resolveMs, now });
  const report: TesterReport = {
    layout: resolved.layout,
    self: resolved.self,
    by: resolved.by === 'assigned' ? null : resolved.by,
    sections: resolved.sections.map((s) => ({
      channel: s.channel,
      ranges: s.ranges,
      lines: s.ranges.reduce((n, r) => n + (r.endLine - r.startLine + 1), 0),
    })),
    outside: resolved.outside,
    marks: resolved.marks,
    problems: resolved.problems,
    rules: [],
    abandoned: resolved.abandoned,
    dropped: resolved.dropped,
    rulesAbandoned: false,
  };
  if (resolved.abandoned) return report;
  // Each rule alone, timed, on the text as it is (a rule that matches nothing is a row too).
  // One deadline for all of them: a slow rule stops the timings after its own line.
  const deadline = now() + CHANNEL_CAPS.resolveMs;
  for (const rule of Array.isArray(p.syncMarks) ? p.syncMarks : []) {
    const start = now();
    const found = findMarks(lines, cp, { ...p, syncMarks: [rule], stopsAndEndsWait: false }, { channelOf: () => '', deadline, now });
    const ms = Math.max(0, now() - start);
    report.rules.push({ id: rule.id, label: rule.label, marks: found.marks.length, ms, slow: found.abandoned || ms > SLOW_RULE_MS });
    if (found.abandoned) {
      report.rulesAbandoned = true;
      break;
    }
  }
  return report;
}
