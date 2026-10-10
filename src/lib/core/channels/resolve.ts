// Channel resolution, pure (plan §7.17, AD-32). Built and hardened by WP12.1.
//
// Four questions, each a pure function over lines and the machine's `ChannelParams`:
//
//   `findSections`   which line ranges of a `single-file` document belong to which channel,
//                    and which belong to none (`outside`)
//   `readMarker`     which channel a `multi-file` document says it is, from a header line
//                    (`markerChannel` is its one-value form)
//   `channelAt`      which channel a line of a resolved set is in (`channelsAt`: all of them,
//                    for a section several channels share)
//
// and the helpers every pattern that names a channel shares: `channelRefs`,
// `resolveChannelToken` and `splitChannelTokens` — the one code path for "this token names
// these channels" (a section start naming `S1/S3/S4`, a `line` partner capture, a marker).
//
// What this file may not do: guess. A token that names no declared channel or alias is a
// problem with its line, never the nearest channel; a token two channels claim (an alias
// equal to another channel's id or alias, which validation refuses) names none; two header
// lines that name different channels name none; a pattern that does not compile is a
// problem, never a crash. Every pattern runs on the line with its comments and the inside
// of its strings blanked (`maskForMarks`), except `marker`, which reads header comments. Validation proper (every rule of §7.17 with a JSON path) is
// WP12.3's `validateChannels` (`core/machines/validate.ts`); this file only refuses to run
// on what it cannot compile.

import { maskComments } from '$lib/core/nc/mask';
import { lookbehindPrefilter } from './prefilter';
import type { CompiledProfile } from '$lib/core/profiles/types';
import {
  CHANNEL_CAPS,
  type ChannelBudget,
  type ChannelParams,
  type ChannelProblem,
  type ChannelRef,
  type ChannelSection,
  type ChannelSet,
  type FindSectionsResult,
} from './types';

type Range = { startLine: number; endLine: number };

const refCache = new WeakMap<ChannelParams, ChannelRef[]>();

/** The declared channels as refs, in display order; one set of objects per params object, so
 *  refs compare by identity. */
function refsOf(p: ChannelParams): ChannelRef[] {
  let refs = refCache.get(p);
  if (!refs) {
    refs = (Array.isArray(p.list) ? p.list : []).map((c, index) => ({ id: String(c?.id), name: String(c?.name), index }));
    refCache.set(p, refs);
  }
  return refs;
}

/** The declared channels as refs, in display order. */
export function channelRefs(p: ChannelParams): ChannelRef[] {
  return refsOf(p).slice();
}

/** Token (lower case) → its channel, or `null` when two channels claim it. */
const tokenMaps = new WeakMap<ChannelParams, Map<string, ChannelRef | null>>();

/**
 * Id or alias → channel, keys lower case and trimmed. A token that two different channels
 * claim — two ids equal but for case, an alias equal to another channel's id, one alias on
 * two channels — maps to `null`: it names no channel, so whatever it stands in is reported
 * rather than given to the first channel that happened to declare it. WP12.3's validation
 * refuses such a block; this is what keeps a block that got past it from guessing.
 */
function tokenMap(p: ChannelParams): Map<string, ChannelRef | null> {
  let map = tokenMaps.get(p);
  if (map) return map;
  const built = new Map<string, ChannelRef | null>();
  const claim = (token: unknown, ref: ChannelRef): void => {
    if (typeof token !== 'string') return;
    const key = token.trim().toLowerCase();
    if (key === '') return;
    const held = built.get(key);
    if (held === undefined) built.set(key, ref);
    else if (held !== null && held.index !== ref.index) built.set(key, null);
  };
  const list = Array.isArray(p.list) ? p.list : [];
  const refs = refsOf(p);
  list.forEach((c, i) => claim(c?.id, refs[i]));
  list.forEach((c, i) => {
    for (const alias of Array.isArray(c?.aliases) ? c.aliases : []) claim(alias, refs[i]);
  });
  tokenMaps.set(p, built);
  return built;
}

/** All-digit ids and aliases by value (`01` → `1`), or `null` when two channels claim one value. */
const valueMaps = new WeakMap<ChannelParams, Map<string, ChannelRef | null>>();

function digitValue(token: string): string | null {
  return /^\d+$/.test(token) ? token.replace(/^0+(?=\d)/, '') : null;
}

function valueMap(p: ChannelParams): Map<string, ChannelRef | null> {
  let map = valueMaps.get(p);
  if (map) return map;
  const built = new Map<string, ChannelRef | null>();
  for (const [token, ref] of tokenMap(p)) {
    const value = digitValue(token);
    if (value === null) continue;
    const held = built.get(value);
    if (held === undefined) built.set(value, ref);
    else if (held === null || ref === null || held.index !== ref.index) built.set(value, null);
  }
  valueMaps.set(p, built);
  return built;
}

/** The channel a token names (id or alias, ignoring case and surrounding blanks), or null —
 *  also for a token two channels claim. M12 review fix NC-06: an all-digit token the text
 *  does not find is read by value against the all-digit ids and aliases, as the control
 *  reads a channel number (`WAITM(1,01,02)` names channels 1 and 2); a value two channels
 *  claim names none. */
export function resolveChannelToken(p: ChannelParams, token: string): ChannelRef | null {
  const key = token.trim().toLowerCase();
  const map = tokenMap(p);
  if (map.has(key)) return map.get(key) ?? null;
  const value = digitValue(key);
  return value === null ? null : (valueMap(p).get(value) ?? null);
}

/**
 * The line every channel pattern reads: comments blanked by the profile's own rules
 * (`maskComments`), and the inside of every `"…"` string blanked as well, same length.
 * So `MSG("WAITM(1,1,2)")` holds no wait and `MSG("G14")` starts no section.
 */
export function maskForMarks(line: string, cp: CompiledProfile): string {
  const masked = maskComments(line, cp);
  if (!masked.includes('"')) return masked;
  let out = '';
  let inString = false;
  for (const c of masked) {
    if (c === '"') {
      inString = !inString;
      out += c;
    } else out += inString ? ' ' : c;
  }
  return out;
}

/** Splits a capture that may name several channels; pieces trimmed, empty ones dropped. */
export function splitChannelTokens(text: string, separator: string): string[] {
  const parts = separator === '' ? [text] : text.split(separator);
  return parts.map((piece) => piece.trim()).filter((piece) => piece !== '');
}

/** Compiles one user pattern, or answers the problem. `d` is added where offsets are needed. */
export function compileChannelPattern(
  pattern: string,
  flags: string,
  path: string,
): { re: RegExp } | { problem: ChannelProblem } {
  if (pattern.length > CHANNEL_CAPS.patternLength) {
    return { problem: { path, message: { key: 'channels.problems.tooLong', params: { max: CHANNEL_CAPS.patternLength } } } };
  }
  try {
    return { re: new RegExp(pattern, flags) };
  } catch (e) {
    return { problem: { path, message: { key: 'channels.problems.badPattern', params: { error: String((e as Error).message ?? e) } } } };
  }
}

function hasGroup(pattern: string, name: string): boolean {
  return pattern.includes(`(?<${name}>`);
}

/**
 * A caller that runs several passes over one document (`resolveDocument`) masks each line
 * once: `masked(i)` answers `maskForMarks(lines[i], cp)` for the 0-based line `i`.
 */
export interface MaskedLines {
  masked?: (index: number) => string;
}

/** The time a budget reads, and whether it has passed. */
export function budgetClock(o: ChannelBudget | undefined): () => boolean {
  if (o?.deadline === undefined) return () => false;
  const now = o.now ?? (() => performance.now());
  const deadline = o.deadline;
  return () => now() > deadline;
}

/** Ranges of the 1-based lines `1..count` that no range covers, in order. */
export function complementRanges(covered: readonly Range[], count: number): Range[] {
  const sorted = [...covered].sort((a, b) => a.startLine - b.startLine);
  const out: Range[] = [];
  let next = 1;
  for (const r of sorted) {
    if (r.startLine > next) out.push({ startLine: next, endLine: r.startLine - 1 });
    next = Math.max(next, r.endLine + 1);
  }
  if (next <= count) out.push({ startLine: next, endLine: count });
  return out;
}

function pushRange(ranges: Range[], r: Range): void {
  const last = ranges[ranges.length - 1];
  if (last && r.startLine <= last.endLine + 1) last.endLine = Math.max(last.endLine, r.endLine);
  else ranges.push({ ...r });
}

/**
 * The sections of a `single-file` document (WP12.1 deliver, §7.17). A section starts on a
 * masked line that matches `sectionStart` and ends on a line that matches `sectionEnd`
 * (inclusive), else just before the next start, else at the last line. A channel may hold
 * any number of ranges, and a start may name several channels (`sectionSeparator`). A
 * start that names no declared channel is a problem; its lines belong to no channel.
 *
 * For any other layout, or a block without `sectionStart`, the answer is empty.
 *
 * M12 review fix CODE-1: the deadline is read on every line, and a line longer than
 * `CHANNEL_CAPS.lineLength` is never given to a pattern (it starts and ends no section);
 * such lines are counted in one problem, `channels.problems.longLines`.
 */
export function findSections(
  lines: readonly string[],
  cp: CompiledProfile,
  p: ChannelParams,
  o?: ChannelBudget & MaskedLines,
): FindSectionsResult {
  const problems: ChannelProblem[] = [];
  const empty = (abandoned = false): FindSectionsResult => ({ sections: [], outside: [], problems, abandoned });
  if (p.layout !== 'single-file' || typeof p.sectionStart !== 'string') return empty();

  const start = compileChannelPattern(p.sectionStart, cp.flags, 'sectionStart');
  if ('problem' in start) {
    problems.push(start.problem);
    return empty();
  }
  let end: RegExp | null = null;
  const startPre = lookbehindPrefilter(start.re);
  if (typeof p.sectionEnd === 'string') {
    const compiled = compileChannelPattern(p.sectionEnd, cp.flags, 'sectionEnd');
    if ('problem' in compiled) {
      problems.push(compiled.problem);
      return empty();
    }
    end = compiled.re;
  }
  const endPre = end === null ? null : lookbehindPrefilter(end);

  const refs = refsOf(p);
  const separator = typeof p.sectionSeparator === 'string' && p.sectionSeparator !== '' ? p.sectionSeparator : '/';
  const captures = hasGroup(p.sectionStart, 'channel');
  const perChannel = new Map<string, Range[]>();
  const covered: Range[] = [];
  const late = budgetClock(o);

  let open: { channels: ChannelRef[]; startLine: number } | null = null;
  let starts = 0;
  const boundaries: number[] = [];
  let longLines = 0;
  const close = (endLine: number): void => {
    if (open === null) return;
    if (open.channels.length > 0 && endLine >= open.startLine) {
      const r = { startLine: open.startLine, endLine };
      for (const ref of open.channels) {
        const list = perChannel.get(ref.id) ?? [];
        pushRange(list, r);
        perChannel.set(ref.id, list);
      }
      pushRange(covered, r);
    }
    open = null;
  };

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && late()) return empty(true);
    const lineNo = i + 1;
    if (lines[i].length > CHANNEL_CAPS.lineLength) {
      longLines++;
      continue;
    }
    const masked = o?.masked ? o.masked(i) : maskForMarks(lines[i], cp);
    const m = startPre !== null && !startPre.test(masked) ? null : start.re.exec(masked);
    if (m) {
      close(lineNo - 1);
      starts++;
      boundaries.push(lineNo);
      const channels: ChannelRef[] = [];
      if (captures) {
        const text = m.groups?.channel;
        const tokens = typeof text === 'string' ? splitChannelTokens(text, separator) : [];
        if (tokens.length === 0) {
          problems.push({ path: `line:${lineNo}`, message: { key: 'channels.problems.noChannelInStart', params: { line: lineNo } } });
        }
        for (const token of tokens) {
          const ref = resolveChannelToken(p, token);
          if (ref === null) {
            problems.push({
              path: `line:${lineNo}`,
              message: { key: 'channels.problems.unknownChannel', params: { line: lineNo, token } },
            });
          } else if (!channels.includes(ref)) channels.push(ref);
        }
      } else if (starts <= refs.length) {
        channels.push(refs[starts - 1]);
      } else {
        problems.push({
          path: `line:${lineNo}`,
          message: { key: 'channels.problems.tooManyStarts', params: { line: lineNo, count: refs.length } },
        });
      }
      open = { channels, startLine: lineNo };
      continue;
    }
    if (open !== null && end !== null && (endPre === null || endPre.test(masked)) && end.test(masked)) {
      close(lineNo);
      boundaries.push(lineNo);
    }
  }
  close(lines.length);
  if (longLines > 0) {
    problems.push({ path: 'lines', message: { key: 'channels.problems.longLines', params: { count: longLines, max: CHANNEL_CAPS.lineLength } } });
  }

  const sections: ChannelSection[] = [];
  for (const ref of refs) {
    const ranges = perChannel.get(ref.id);
    if (ranges && ranges.length > 0) sections.push({ channel: ref, ranges });
  }
  if (sections.length > 0) {
    for (const ref of refs) {
      if (!perChannel.has(ref.id)) {
        problems.push({ path: `list[${ref.index}]`, message: { key: 'channels.problems.channelNotFound', params: { channel: ref.name } } });
      }
    }
  }
  return { sections, outside: complementRanges(covered, lines.length), problems, abandoned: false, boundaries };
}

/** What the `marker` pattern says about a document (`readMarker`). */
export interface MarkerReading {
  /** The channel the header names; null when nothing names one, or when it is not certain. */
  channel: ChannelRef | null;
  /** 1-based line of the marker that gave `channel` (the first of several that agree). */
  line: number | null;
  /** A marker naming no declared channel, or two markers naming different channels. */
  problems: ChannelProblem[];
  /** M12 review fix CODE-1: the deadline (`o.deadline`) passed; `channel` is then null. */
  abandoned?: boolean;
}

/**
 * The channel a `multi-file` document names in its first 400 lines (`marker`), resolved
 * against ids and aliases. Read on the RAW lines, because the documented place is a header
 * comment (§7.16 #151).
 *
 * Nothing is guessed: a marker whose token names no declared channel is a problem, and so
 * are two markers that name different channels; either way the answer is null (the user's
 * pattern matches more than the header, or the header contradicts itself), and the file
 * name does not stand in for it (`documentChannel`). Several markers naming the same
 * channel are fine.
 *
 * M12 review fix CODE-1: with `o.deadline`, the deadline is read on every line and, once
 * past, the answer is no channel with `abandoned`. A line longer than
 * `CHANNEL_CAPS.lineLength` is not read (the document's resolution counts and reports it).
 */
export function readMarker(lines: readonly string[], cp: CompiledProfile, p: ChannelParams, o?: ChannelBudget): MarkerReading {
  const none: MarkerReading = { channel: null, line: null, problems: [] };
  if (p.layout !== 'multi-file' || typeof p.marker !== 'string') return none;
  const compiled = compileChannelPattern(p.marker, cp.flags, 'marker');
  if ('problem' in compiled) return { ...none, problems: [compiled.problem] };
  const problems: ChannelProblem[] = [];
  let found: { ref: ChannelRef; line: number } | null = null;
  let conflict = false;
  const count = Math.min(lines.length, CHANNEL_CAPS.markerLines);
  const late = budgetClock(o);
  for (let i = 0; i < count; i++) {
    if (i > 0 && late()) return { channel: null, line: null, problems, abandoned: true };
    if (lines[i].length > CHANNEL_CAPS.lineLength) continue;
    const text = compiled.re.exec(lines[i])?.groups?.channel;
    if (typeof text !== 'string' || text.trim() === '') continue;
    const lineNo = i + 1;
    const ref = resolveChannelToken(p, text);
    if (ref === null) {
      conflict = true;
      problems.push({ path: `line:${lineNo}`, message: { key: 'channels.problems.unknownChannel', params: { line: lineNo, token: text.trim() } } });
    } else if (found === null) {
      found = { ref, line: lineNo };
    } else if (found.ref !== ref) {
      conflict = true;
      problems.push({
        path: `line:${lineNo}`,
        message: {
          key: 'channels.problems.markerConflict',
          params: { line: lineNo, channel: ref.name, other: found.line, otherChannel: found.ref.name },
        },
      });
    }
  }
  if (found === null || conflict) return { channel: null, line: null, problems };
  return { channel: found.ref, line: found.line, problems };
}

/** `readMarker`'s channel id, or null (no marker, a marker naming no channel, or a conflict). */
export function markerChannel(lines: readonly string[], cp: CompiledProfile, p: ChannelParams): string | null {
  return readMarker(lines, cp, p).channel?.id ?? null;
}

/**
 * Every channel that holds `line` in a resolved set, in declared order: several for a section
 * that a start named for several channels (`+S1/S3/S4`), the document's own channel in
 * `multi-file`, none outside every section.
 */
export function channelsAt(set: ChannelSet, line: number): ChannelRef[] {
  if (set.layout === 'multi-file') return set.self ? [set.self] : [];
  if (set.layout !== 'single-file') return [];
  const out: ChannelRef[] = [];
  for (const member of set.members) {
    if (member.kind !== 'section') continue;
    if (member.ranges.some((r) => line >= r.startLine && line <= r.endLine)) out.push(member.channel);
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * The channel that holds `line` in a resolved set: the first declared channel with a range
 * over it (`single-file`; a shared section answers its first channel, `channelsAt` answers
 * all of them), this document's own channel (`multi-file`), else null.
 */
export function channelAt(set: ChannelSet, line: number): ChannelRef | null {
  return channelsAt(set, line)[0] ?? null;
}
