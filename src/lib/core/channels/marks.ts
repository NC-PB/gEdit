// Sync marks, pure (plan §7.17, AD-32). Implemented by the M12 prelude (P12); owned and
// hardened by WP12.1.
//
// A mark is found on the MASKED line with strings blanked too, so a wait written in a
// comment or inside a string is not a wait. Rules run in declaration order and the first
// rule that matches a line owns it; a line holds at most one mark. Four ways to match:
//
//   `codes`   the owner's plain list (`M100-M199, M300`, §10.1 2026-10-07): a code word as
//             the control reads it — the address, blanks allowed before the digits as the
//             tokenizer allows them, leading zeros not counted, no decimal point, not an
//             assignment (`M2=3` is a spindle's M3 on Sinumerik); id = the code read that
//             way, so `M0901`, `M 901` and `M901` are the one wait `M901`; the primary form
//   `prefix`  a literal prefix and digits (`M1` + two digits): id = the digits, shown
//             with the prefix in front (`shownMark`: `M130`, M13 review NC-10)
//   `regex`   a pattern with a `mark` capture (absent and not needed for `count`)
//   and, when `stopsAndEndsWait` is set, the profile's own `stop`/`end` outline lines
//
// The partners come from `all`, `fixed`, `word` (an address word read as R5 `digits` or
// `bitmask`) or `line` (a pattern with a `channels` capture, decoded `split`, `digits` or
// `bitmask`), with `whenAbsent` where the line says nothing. Every decoded piece goes
// through `resolveChannelToken`, so ids and aliases work everywhere; a piece that names no
// declared channel is kept as written, for the check to report (`unknown-channel`).
//
// What is never guessed (WP12.1): a `P` word the decode cannot read (`P12.`, `P#1`,
// `P[#5]`, a bare `P`) is one unknown piece written as on the line, never "no `P`" and so
// never `whenAbsent`; two `P` words that disagree on one wait line are one unknown piece
// too. Either way the check reports the wait instead of pairing it with channels the line
// may not name.

import type { CompiledProfile } from '$lib/core/profiles/types';
import { isWaitCode, parseWaitCodes, waitCodeId, waitCodeWordRe } from './codes';
import {
  budgetClock,
  compileChannelPattern,
  findSections,
  maskForMarks,
  resolveChannelToken,
  splitChannelTokens,
  type MaskedLines,
} from './resolve';
import { execAfterNonWord, lookbehindPrefilter, unguardedWordRe } from './prefilter';
import { documentChannel } from './siblings';
import {
  CHANNEL_CAPS,
  STOPS_AND_ENDS_RULE,
  type ChannelBudget,
  type ChannelParams,
  type ChannelProblem,
  type ChannelRef,
  type ChannelSection,
  type FindMarksResult,
  type PartnerDecode,
  type SyncHit,
  type SyncRule,
  type WaitCodeRange,
  type WhenAbsent,
} from './types';

export { maskForMarks };

/**
 * The prefix a mark of `rule` was written behind, or `''` (M13 review NC-10).
 *
 * A `prefix` rule keys its marks by the digits (`30` for `M130`), which is right for pairing
 * and stays so; only the text a user reads puts the prefix back ([`shownMark`]).
 */
export function markPrefixOf(rule: SyncRule | undefined): string {
  const match = rule?.match;
  return match?.kind === 'prefix' && typeof match.prefix === 'string' ? match.prefix : '';
}

/**
 * A mark id as a message or a program-map row shows it: `M130`, not `30`, which reads like a
 * block number (M13 review NC-10). `''` stays `''` (an id-less mark; the caller names the rule).
 */
export function shownMark(mark: string, rule: SyncRule | undefined): string {
  return mark === '' ? '' : markPrefixOf(rule) + mark;
}

/**
 * R5 `digits` / `bitmask`, and `split`: the channel tokens a capture names, before they
 * are resolved. A path number *n* is the token `"n"`.
 */
export function decodePartnerText(text: string, decode: PartnerDecode, separator = ','): string[] {
  const trimmed = text.trim();
  if (decode === 'split') return splitChannelTokens(trimmed, separator);
  if (!/^\d+$/.test(trimmed)) return trimmed === '' ? [] : [trimmed];
  if (decode === 'digits') {
    const out: string[] = [];
    // The control does not read a leading 0, so path 10 is never the first digit.
    for (const digit of trimmed.replace(/^0+/, '')) {
      const token = digit === '0' ? '10' : digit;
      if (!out.includes(token)) out.push(token);
    }
    return out;
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value >= 2 ** 32) return [trimmed];
  const out: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (Math.floor(value / 2 ** bit) % 2 === 1) out.push(String(bit + 1));
  }
  return out;
}

interface CompiledRule {
  rule: SyncRule;
  /** Returns the mark id, or null when the line is not one of this rule's marks. */
  find(masked: string): string | null;
  /** The partner ids, and whether they came from `whenAbsent` (NC-01). */
  partners(masked: string): { ids: string[]; absent: boolean };
  blocking: boolean;
}

function resolveTokens(p: ChannelParams, tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    const id = resolveChannelToken(p, token)?.id ?? token;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function allIds(p: ChannelParams): string[] {
  return (Array.isArray(p.list) ? p.list : []).map((c) => c.id);
}

function absent(p: ChannelParams, w: WhenAbsent | undefined): { ids: string[]; absent: boolean } {
  if (w?.kind === 'all') return { ids: allIds(p), absent: true };
  if (w?.kind === 'fixed') return { ids: resolveTokens(p, Array.isArray(w.channels) ? w.channels : []), absent: true };
  return { ids: [], absent: true };
}

/**
 * Every word of one address on a masked line, read as the tokenizer reads a word: the
 * letter not preceded by a letter or `_` and not followed by one (so the `P` of `PA=` or
 * of `SPOS` is not a `P` word), blanks allowed before the value, the value up to the next
 * blank, letter, `(` or `;`. `value` is the value text with blanks taken out (`12`, `12.`,
 * `#1`, `[#5]`, or `''` for a bare letter); `text` is the word as written, trimmed.
 * An assignment (`P1=5`) is not a word of the address.
 *
 * M12 review fix NC-08: a value followed by blanks and more digits (`P1 2`) is not read as
 * `P1`: whether the control joins the digits is not known, and gEdit's tokenizer does not,
 * so the whole text is the value, which no decode reads (one unknown piece, reported).
 */
function addressWords(address: string): (masked: string) => { text: string; value: string }[] {
  const re = new RegExp(`(?<![A-Za-z_])${address}(?![A-Za-z_])[ \\t]*([^\\sA-Za-z_(;=]*)((?:[ \\t]+\\d[^\\sA-Za-z_(;=]*)*)`, 'gi');
  const bare = unguardedWordRe(re) as RegExp; // M12 fix F3, see `execAfterNonWord`
  const assigned = /^[ \t]*=/;
  return (masked) => {
    const out: { text: string; value: string }[] = [];
    bare.lastIndex = 0;
    for (let m = execAfterNonWord(bare, masked); m !== null; m = execAfterNonWord(bare, masked)) {
      if (assigned.test(masked.slice(bare.lastIndex))) continue;
      const text = m[0].trim();
      out.push({ text, value: m[2] !== '' ? text : m[1] });
    }
    return out;
  };
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileRule(rule: SyncRule, index: number, p: ChannelParams, cp: CompiledProfile): CompiledRule | null {
  const at = `syncMarks[${index}]`;
  const counted = rule.semantics === 'count';
  let find: CompiledRule['find'];

  const match = rule.match;
  if (match?.kind === 'codes') {
    const parsed = parseWaitCodes(typeof match.codes === 'string' ? match.codes : '');
    const ranges: WaitCodeRange[] = parsed.ranges;
    const re = parsed.errors.length > 0 ? null : waitCodeWordRe(ranges);
    if (re === null) return null;
    // The same search without the lookbehind WebKit runs slowly (M12 fix F3).
    const bare = unguardedWordRe(re) as RegExp;
    find = (masked) => {
      bare.lastIndex = 0;
      for (let m = execAfterNonWord(bare, masked); m !== null; m = execAfterNonWord(bare, masked)) {
        if (isWaitCode(ranges, m[1], Number(m[2]))) return counted ? '' : waitCodeId(m[1], m[2]);
      }
      return null;
    };
  } else if (match?.kind === 'prefix') {
    if (typeof match.prefix !== 'string' || match.prefix === '') return null;
    const digits = match.idDigits ? `\\d{${match.idDigits.min},${match.idDigits.max}}` : '\\d+';
    const re = new RegExp(`(?<![A-Za-z_])${escapeRe(match.prefix)}(${digits})(?![\\d.]|[ \\t]*=)`, 'i');
    const pre = lookbehindPrefilter(re);
    find = (masked) => {
      const m = pre !== null && !pre.test(masked) ? null : re.exec(masked);
      return m ? (counted ? '' : m[1]) : null;
    };
  } else if (match?.kind === 'regex') {
    const compiled = compileChannelPattern(match.pattern, cp.flags, `${at}.match.pattern`);
    if ('problem' in compiled) return null;
    const re = compiled.re;
    const pre = lookbehindPrefilter(re);
    find = (masked) => {
      const m = pre !== null && !pre.test(masked) ? null : re.exec(masked);
      if (!m) return null;
      if (counted) return '';
      const mark = m.groups?.mark;
      return typeof mark === 'string' ? mark.trim() : null;
    };
  } else return null;

  let partners: CompiledRule['partners'];
  const rp = rule.partners;
  if (rp?.kind === 'fixed') {
    const ids = resolveTokens(p, Array.isArray(rp.channels) ? rp.channels : []);
    partners = () => ({ ids, absent: false });
  } else if (rp?.kind === 'word') {
    if (typeof rp.address !== 'string' || !/^[A-Za-z]$/.test(rp.address)) return null;
    const decode = rp.decode === 'bitmask' ? 'bitmask' : 'digits';
    const read = addressWords(rp.address);
    partners = (masked) => {
      const words = read(masked);
      if (words.length === 0) return absent(p, rp.whenAbsent);
      // `P012` and `P12` are one value (the control reads no leading zero).
      const values = [...new Set(words.map((w) => (/^\d+$/.test(w.value) ? w.value.replace(/^0+(?=\d)/, '') : w.value)))];
      // Two P words that disagree, or one the decode cannot read: one unknown piece, as written.
      if (values.length > 1 || !/^\d+$/.test(values[0])) return { ids: [words.map((w) => w.text).join(' ')], absent: false };
      return { ids: resolveTokens(p, decodePartnerText(values[0], decode)), absent: false };
    };
  } else if (rp?.kind === 'line') {
    const compiled = compileChannelPattern(rp.pattern, cp.flags, `${at}.partners.pattern`);
    if ('problem' in compiled) return null;
    const re = compiled.re;
    const decode: PartnerDecode = rp.decode ?? 'split';
    const separator = typeof rp.separator === 'string' && rp.separator !== '' ? rp.separator : ',';
    partners = (masked) => {
      const text = re.exec(masked)?.groups?.channels;
      if (typeof text !== 'string' || text.trim() === '') return absent(p, rp.whenAbsent);
      return { ids: resolveTokens(p, decodePartnerText(text, decode, separator)), absent: false };
    };
  } else {
    const ids = allIds(p);
    partners = () => ({ ids, absent: false });
  }
  return { rule, find, partners, blocking: rule.blocking !== false };
}

const compiledRules = new WeakMap<ChannelParams, Map<string, (CompiledRule | null)[]>>();

function rulesOf(p: ChannelParams, cp: CompiledProfile): (CompiledRule | null)[] {
  let byFlags = compiledRules.get(p);
  if (!byFlags) {
    byFlags = new Map();
    compiledRules.set(p, byFlags);
  }
  let rules = byFlags.get(cp.flags);
  if (!rules) {
    const list = Array.isArray(p.syncMarks) ? p.syncMarks.slice(0, CHANNEL_CAPS.rules) : [];
    rules = list.map((rule, i) => compileRule(rule, i, p, cp));
    byFlags.set(cp.flags, rules);
  }
  return rules;
}

/**
 * The sync marks of a document (§7.17, WP12.1 deliver), in line order. `o.channelOf(line)`
 * says which channel a line is in (`''` outside every section; the document's own channel
 * in `multi-file`). It may answer several channels for a line of a section that several
 * channels share (`+S1/S3/S4`): the line runs in each of them, so the mark is listed once
 * per channel, in the order given; an empty list is `''`. A rule that does not compile
 * finds nothing — WP12.3's validation is what reports it. Every hit has its own `partners`
 * array.
 *
 * M12 review fix CODE-1: the deadline is read on EVERY line (a slow user pattern stops the
 * read after the line it is on, not after 1,024 lines), and a line longer than
 * `CHANNEL_CAPS.lineLength` is never given to a pattern: it is counted in `longLines`.
 */
export function findMarks(
  lines: readonly string[],
  cp: CompiledProfile,
  p: ChannelParams,
  o: { channelOf(line: number): string | readonly string[] } & ChannelBudget & MaskedLines,
): FindMarksResult {
  const rules = rulesOf(p, cp).filter((r): r is CompiledRule => r !== null);
  const stopsAndEnds = p.stopsAndEndsWait === true ? cp.re.outline.filter((r) => r.kind === 'stop' || r.kind === 'end') : [];
  const stopsPre = stopsAndEnds.map((r) => lookbehindPrefilter(r.re));
  const marks: SyncHit[] = [];
  let dropped = 0;
  let longLines = 0;
  const late = budgetClock(o);
  if (rules.length === 0 && stopsAndEnds.length === 0) return { marks, dropped, abandoned: false, longLines };
  const everyChannel = allIds(p);

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && late()) return { marks, dropped, abandoned: true, longLines };
    if (lines[i].length > CHANNEL_CAPS.lineLength) {
      longLines++;
      continue;
    }
    const masked = o.masked ? o.masked(i) : maskForMarks(lines[i], cp);
    let hit: Omit<SyncHit, 'channel'> | null = null;
    for (const r of rules) {
      const mark = r.find(masked);
      if (mark === null) continue;
      const partners = r.partners(masked);
      hit = { ruleId: r.rule.id, mark, line: i + 1, partners: partners.ids, blocking: r.blocking, ...(partners.absent ? { absent: true as const } : {}) };
      break;
    }
    if (hit === null && stopsAndEnds.some((r, k) => (stopsPre[k] === null || (stopsPre[k] as RegExp).test(masked)) && r.re.test(masked))) {
      hit = { ruleId: STOPS_AND_ENDS_RULE, mark: '', line: i + 1, partners: everyChannel, blocking: true };
    }
    if (hit === null) continue;
    const at = o.channelOf(i + 1);
    const channels = typeof at === 'string' ? [at] : at.length > 0 ? at : [''];
    for (const channel of channels) {
      if (marks.length >= CHANNEL_CAPS.marks) {
        dropped++;
        continue;
      }
      marks.push({ ...hit, channel, partners: [...hit.partners] });
    }
  }
  return { marks, dropped, abandoned: false, longLines };
}

/** The problem for lines too long to read (CODE-1), or none. */
export function longLinesProblem(count: number): ChannelProblem[] {
  return count > 0
    ? [{ path: 'lines', message: { key: 'channels.problems.longLines', params: { count, max: CHANNEL_CAPS.lineLength } } }]
    : [];
}

/** `resolveDocument`'s answer: what the channel service turns into a `ChannelSet`. */
export interface ResolvedDocument {
  /** `none` when nothing matched, the document is no channel file, or the budget ran out. */
  layout: ChannelParams['layout'];
  /** `multi-file`: the channel this document is; null otherwise. */
  self: ChannelRef | null;
  /** `multi-file`: how `self` was found. */
  by: 'fileName' | 'marker' | 'assigned' | null;
  /** `multi-file`: the stem its file name gives (`''` when the name is no channel file). */
  stem: string;
  sections: ChannelSection[];
  outside: { startLine: number; endLine: number }[];
  marks: SyncHit[];
  /** Marks past `CHANNEL_CAPS.marks`, counted. */
  dropped: number;
  problems: ChannelProblem[];
  /** The deadline passed (`layout` is then `none`): the status item says so. */
  abandoned: boolean;
  /** `single-file`: `FindSectionsResult.boundaries`. */
  boundaries?: number[];
}

/**
 * One document resolved the way every caller must resolve it (§7.17; the service, the
 * goldens of `tests/fixtures/channels/resolve/` and the script context read the same answer):
 *
 *  - `single-file`: `findSections`; no section → `layout: 'none'` and no marks (an ordinary
 *    program opened with a multi-channel machine is untouched, X12 c); else the marks, each
 *    keyed to the channel of its line (every channel of a shared section, `''` outside).
 *  - `multi-file`: `documentChannel` (the header marker wins over the file name), or
 *    `o.assigned`, the user's own assignment, which wins over both; no channel → `none`.
 *    The marks are the document's own channel's.
 *  - The budget (`o.deadline`) covers the whole resolution; past it the answer is `none`
 *    with `abandoned` (§7.17: 500 ms per document).
 */
export function resolveDocument(
  baseName: string,
  lines: readonly string[],
  cp: CompiledProfile,
  p: ChannelParams,
  o: ChannelBudget & { assigned?: string | null } = {},
): ResolvedDocument {
  const none = (problems: ChannelProblem[], abandoned = false, stem = ''): ResolvedDocument => ({
    layout: 'none',
    self: null,
    by: null,
    stem,
    sections: [],
    outside: [],
    marks: [],
    dropped: 0,
    problems,
    abandoned,
  });
  const cache: (string | undefined)[] = new Array(lines.length);
  const masked = (i: number): string => (cache[i] ??= maskForMarks(lines[i], cp));
  if (p.layout === 'single-file') {
    const found = findSections(lines, cp, p, { ...o, masked });
    if (found.abandoned) return none(found.problems, true);
    if (found.sections.length === 0) return none(found.problems);
    // `findSections` already reported the lines too long to read (`longLines`).
    const m = findMarks(lines, cp, p, { ...o, masked, channelOf: sectionOwners(found.sections) });
    if (m.abandoned) return none(found.problems, true);
    return { layout: 'single-file', self: null, by: null, stem: '', sections: found.sections, outside: found.outside, marks: m.marks, dropped: m.dropped, problems: found.problems, abandoned: false, boundaries: found.boundaries };
  }
  if (p.layout !== 'multi-file') return none([]);
  const doc = documentChannel(baseName, lines, cp, p, o);
  if (doc.abandoned === true) return none(doc.problems, true, doc.stem);
  let self = doc.channel;
  let by: ResolvedDocument['by'] = doc.by;
  if (typeof o.assigned === 'string') {
    const ref = resolveChannelToken(p, o.assigned);
    if (ref !== null) {
      self = ref;
      by = 'assigned';
    }
  }
  if (self === null) return none(doc.problems, false, doc.stem);
  const id = self.id;
  const m = findMarks(lines, cp, p, { ...o, channelOf: () => id });
  if (m.abandoned) return none(doc.problems, true, doc.stem);
  const problems = [...doc.problems, ...longLinesProblem(m.longLines ?? 0)];
  return { layout: 'multi-file', self, by, stem: doc.stem, sections: [], outside: [], marks: m.marks, dropped: m.dropped, problems, abandoned: false };
}

/**
 * Which channels hold a line, as a lookup for lines asked in increasing order (as
 * `findMarks` asks): the section ranges cut into segments with one owner list each, so a
 * 300k-line document costs one entry per range, not one per line.
 */
export function sectionOwners(sections: readonly ChannelSection[]): (line: number) => readonly string[] {
  // A sweep over the range ends: at most 32 channels are open at once, so a document with
  // thousands of alternating sections stays linear.
  const events: { at: number; index: number; delta: 1 | -1 }[] = [];
  for (const s of sections) {
    for (const r of s.ranges) {
      events.push({ at: r.startLine, index: s.channel.index, delta: 1 }, { at: r.endLine + 1, index: s.channel.index, delta: -1 });
    }
  }
  events.sort((a, b) => a.at - b.at);
  const idOf = new Map(sections.map((s) => [s.channel.index, s.channel.id]));
  const open = new Map<number, number>();
  const segments: { start: number; end: number; ids: string[] }[] = [];
  for (let k = 0; k < events.length; ) {
    const at = events[k].at;
    for (; k < events.length && events[k].at === at; k++) {
      const e = events[k];
      const n = (open.get(e.index) ?? 0) + e.delta;
      if (n > 0) open.set(e.index, n);
      else open.delete(e.index);
    }
    if (open.size > 0 && k < events.length) {
      const ids = [...open.keys()].sort((a, b) => a - b).map((index) => idOf.get(index) ?? '');
      segments.push({ start: at, end: events[k].at - 1, ids });
    }
  }
  let at = 0;
  const empty: readonly string[] = [];
  return (line) => {
    if (at > 0 && segments[at - 1] && line < segments[at - 1].start) at = 0;
    while (at < segments.length && segments[at].end < line) at++;
    const seg = segments[at];
    return seg && seg.start <= line ? seg.ids : empty;
  };
}
