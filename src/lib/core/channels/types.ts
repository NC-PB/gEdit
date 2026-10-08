// Channel contracts (plan §7.17, AD-32). Written by the M12 prelude (P12); binding for
// WP12.1–WP12.6. A signature here changes only with a numbered §7.16 entry.
//
// What a channel is here, in one paragraph: a *channel* (turret, path, spindle, "Kanal")
// is one stream of blocks the control executes on its own. gEdit does not interpret
// channels. It **finds** them (sections of one document, or one document per channel),
// **groups** what it already computes per channel (the map, the tool list), and
// **compares the wait codes** between them. It never reorders, rewrites or synchronizes
// anything, and it says nothing about what a wait does at the machine.
//
// Where the definition lives: in the **machine configuration** (`MachineParams.channels`,
// §7.15), never in the profile, because two machines with the same control can lay their
// channels out differently and use different wait codes (D58). A profile may only offer
// **presets** a user starts from (`MachineParamsDecl.channels`, §8.9); no preset is ever
// applied without a machine.
//
// Every pattern below is the user's (standing rule 15): ≤ 1,000 characters, compiled with
// `new RegExp` only, inside the AD-11 subset, never `eval`. Named groups are written the
// ECMAScript way, `(?<name>…)`.

import type { DocId, Msg } from '$lib/app/types';
import type { Pattern } from '$lib/core/profiles/types';

/** The caps of §7.17, binding for both languages. */
export const CHANNEL_CAPS = {
  /** Declared channels per machine (and at least two). */
  channels: 32,
  /** Aliases per channel. */
  aliases: 8,
  /** Sync rules per machine. */
  rules: 32,
  /** Marks kept per document; the rest are counted (`FindMarksResult.dropped`), never dropped silently. */
  marks: 20_000,
  /** Characters per pattern. */
  patternLength: 1_000,
  /** A resolution of one document (sections + marks) is abandoned past this, with `layout: 'none'`. */
  resolveMs: 500,
  /** The check over one report is truncated past this (`ChannelSet.truncated`). */
  checkMs: 1_000,
  /** How many lines from the top `marker` reads. */
  markerLines: 400,
  /** Names per `channel_siblings` call (§7.10). */
  siblingNames: 32,
  /** M12 review fix CODE-1: a (masked or raw) line longer than this is never given to a
   *  channel pattern; it is counted and reported (`channels.problems.longLines`). */
  lineLength: 1_000,
} as const;

/** A channel the machine declares. `index` is the position in the list = the display order. */
export interface ChannelRef {
  id: string;
  name: string;
  index: number;
}

/**
 * R5 (accepted 2026-10-01, §10.1): how the `channels` capture of a `line` partner rule is
 * read. Every decoded piece is then matched, case-insensitively, against the declared ids
 * **and aliases** — the one code path for "this token names these channels".
 *
 *  - `split` (default) — the capture is split on `separator` (default `,`), each piece
 *    trimmed, empty pieces dropped: `WAITM(10,1,2)` → `1`, `2`; `WAIT_K1,WAIT_K2` through
 *    aliases.
 *  - `digits` — the Fanuc "path number" form of the `P` word (parameter 8103 bit 1 = 1):
 *    each digit is one path number, `0` is path 10, the order is free (`P123` = `P321`).
 *    A leading `0` is not read (the control reads `P013` as `P13`, so path 10 is never
 *    first). Path number *n* is matched as the text `"n"`. A capture that is not all
 *    digits is one unknown piece.
 *  - `bitmask` — the Fanuc binary form of the `P` word (parameter 8103 bit 1 = 0, the
 *    control's default): the decimal value is a sum of `2^(n-1)` for path *n*
 *    (`P7` = paths 1, 2, 3; `P341` = 1, 3, 5, 7, 9). Path number *n* is matched as `"n"`.
 *    `P0` names no path. A capture that is not all digits, or a value with a bit above
 *    the 32nd, is one unknown piece.
 */
export type PartnerDecode = 'split' | 'digits' | 'bitmask';

/**
 * R5: the partners of a mark whose line the `line` pattern does not match, or matches with
 * an empty `channels` capture — a Fanuc wait M-code written without `P`.
 *
 *  - `none` (default) — no partner at all. A blocking `rendezvous` mark with no partner is
 *    `unmatched` (WP12.2), which is what a Fanuc control with three or more paths does with
 *    a `P`-less wait (an alarm).
 *  - `all` — every declared channel.
 *  - `fixed` — these channels (ids or aliases): `["1", "2"]` is the Fanuc two-path rule
 *    ("without `P`, paths 1 and 2 wait for each other").
 */
export type WhenAbsent = { kind: 'none' } | { kind: 'all' } | { kind: 'fixed'; channels: string[] };

/** What kind of coordination a rule's marks are, and therefore what the check may conclude from
 *  them (WP12.2). Three mechanisms exist on the owner's own controls and they are not the same
 *  check; a rule that names the wrong one produces findings on a correct program. */
export type SyncSemantics =
  /** A rendezvous with an id: the k-th mark of an id in one channel meets the k-th of that id in
   *  the partner (a Fanuc wait M-code, a Siemens `WAITM(<id>,…)`). Default. */
  | 'rendezvous'
  /** A rendezvous with NO id: only the number and the order of the marks matter, and both sides
   *  must carry the same count (the documented Okuma `M100` rule: the same number of them on
   *  the `G13` and the `G14` side). `mark` is optional for this kind. */
  | 'count'
  /** An ORDERING mechanism, not a rendezvous: the ids order the two channels against each other
   *  and need not appear in both (the documented Okuma `P` codes: execution proceeds from the
   *  smaller number to the larger, and the manual's own correct example is P10/P20/P40 against
   *  P10/P30/P40). The check only reports a number that DECREASES inside one channel; a number
   *  present on one side only is legal and is never "missing" or "unmatched". */
  | 'ordered';

export interface SyncRule {
  /** Stable, unique per machine; used by problems and goldens. */
  id: string;
  /** Display text (data, untranslated). */
  label: string;
  /** Default `rendezvous`. It decides which findings the rule can produce (WP12.2). */
  semantics?: SyncSemantics;
  match:
    /**
     * The owner's decision of 2026-10-07 (§10.1): the PRIMARY form, what the machine page
     * offers first. A plain list of codes and ranges as an NC programmer writes it —
     * `M100-M199`, `M100-M199, M300 M350`, `P1-9999` — parsed by `parseWaitCodes`
     * (`core/channels/codes.ts`). A word of one of these codes on a masked line is a mark;
     * its id is the code by value, letter upper case and no leading zeros (`M0101`, `M 101`
     * and `m101` are all `M101`). Read the way the control reads a code: a word with a decimal
     * point (`M101.5`) or an assignment (`M101=1`) is not one of them.
     */
    | { kind: 'codes'; codes: string }
    | {
        kind: 'prefix';
        /** A literal, matched case-insensitively, not preceded by a letter (`M1`, `P`). */
        prefix: string;
        /** The id's digits right after the prefix; absent = one or more. Never followed by a
         *  digit or a point, so `M1` + two digits does not find `M1001` or `M10.5`. */
        idDigits?: { min: number; max: number };
      }
    /** A named capture `mark` is REQUIRED except for `count`. */
    | { kind: 'regex'; pattern: Pattern };
  partners:
    /** Every channel of the machine. */
    | { kind: 'all' }
    /** A list written once per rule (ids or aliases). */
    | { kind: 'fixed'; channels: string[] }
    /**
     * P12, the owner's decision of 2026-10-07: the plain form of R5 for the machine page — the
     * value of one address word on the mark's own line (`P` of `M101 P12`), read as `digits`
     * or `bitmask` (a dropdown with an example each: "P12 = channels 1 and 2", "P3 = channels
     * 1 and 2 (1 + 2)"). Found like a code word: the address not preceded by a letter, then
     * digits, no decimal point. No word on the line: `whenAbsent`.
     */
    | { kind: 'word'; address: string; decode: 'digits' | 'bitmask'; whenAbsent?: WhenAbsent }
    /** Advanced: a second pattern on the mark's own line, whose `channels` capture names the partners. */
    | {
        kind: 'line';
        pattern: Pattern;
        /** `split` only; default `,`. */
        separator?: string;
        /** R5; default `split`. */
        decode?: PartnerDecode;
        /** R5; default `{ kind: 'none' }`. */
        whenAbsent?: WhenAbsent;
      };
  /** Only a blocking wait is checked (D60). A `false` mark is shown in the map and the navigation
   *  and never checked, because a marker that sets a flag is not a rendezvous. Default true. */
  blocking?: boolean;
  /**
   * M12 review fix NC-02 (§7.16 #167): a NON-blocking mark of this rule ANSWERS a wait for
   * the same id in another channel (the Siemens `SETM`: it sets the mark in its own channel
   * without stopping, and a `WAITM` that names this channel waits for it). The waiting side
   * is then never `missing`, its count is not judged (a set mark stays set until cleared)
   * and the order of that id is not judged; the answering mark itself is never reported.
   * A `CLEARM` rule must not carry it. Default false.
   */
  answers?: boolean;
  /**
   * M12 review fix NC-01 (§7.16 #167): two marks that meet must name the SAME set of
   * channels (each counted with its own channel), and both must be written with the
   * partner word or both without it (`whenAbsent`). The Fanuc wait M-code: a different
   * `P` on the paths of one wait, or a `P`-less wait meeting one with `P`, is alarm 0160.
   * A difference is `partners-differ`. Off for Siemens `WAITM`, whose lists may differ
   * (the own channel is optional). Default false.
   */
  samePartners?: boolean;
}

/** How a machine's channels are laid out. Stored in `MachineParams.channels` (§7.15). */
export interface ChannelParams {
  layout: 'none' | 'single-file' | 'multi-file';
  /** 2–32 channels (empty for `layout: 'none'`); ids `^[a-z0-9][a-z0-9_-]{0,15}$`, unique ignoring
   *  case; names 1–32 characters. The array order is the display order. */
  list: {
    id: string;
    name: string;
    /** Other spellings of THIS channel, matched case-insensitively wherever a pattern names a
     *  channel: the `channel` capture of `sectionStart` and `marker`, and every piece of a `line`
     *  partner capture. Real programs use three different tokens for one channel — Okuma starts a
     *  section with `G13`, a Siemens post writes the partners as `WAIT_K1`, the file is called
     *  `…_CH1` — so the id must not have to be all three (≤ 8 per channel, 1–32 characters each,
     *  unique across the whole list ignoring case, and never equal to another channel's id). */
    aliases?: string[];
    /** `multi-file` only: this channel's own base-name template, `{{stem}}` and `{{channel}}` only.
     *  Tried before `fileNameFor`, so a set whose names share no one pattern (`%_N_1000_MPF` /
     *  `%_N_2000_MPF`, `PART.MPF` / `PART_GS.MPF`) is expressible. */
    fileName?: string;
  }[];

  // --- single-file -------------------------------------------------------------------
  /** Starts a channel section, on the MASKED line. A named group `channel` gives the id (or an
   *  alias); without one the Nth match is the Nth declared channel (allowed only when the counts
   *  can match, WP12.3). A capture that names SEVERAL channels is split on `sectionSeparator` and
   *  the section then belongs to each of them (`+S1/S3/S4`). A channel may start a section any
   *  number of times; the ranges are collected in document order. */
  sectionStart?: Pattern;
  /** The separator inside a `sectionStart` `channel` capture; default `/`. */
  sectionSeparator?: string;
  /** Ends a section, on the masked line; the end line belongs to the section. Absent: a section
   *  runs to the next start, else to the last line. Lines between a `sectionEnd` and the next
   *  start belong to no channel: they are `ChannelSet.outside`. */
  sectionEnd?: Pattern;

  // --- multi-file --------------------------------------------------------------------
  /** Matched on the BASE NAME, always case-insensitively, with named groups `stem` and `channel`:
   *  `^(?<stem>.+)_CH(?<channel>\\d+)\\.nc$`. Optional: a set whose members are named by
   *  `list[].fileName`, or assigned by hand (`channels.assign`, WP12.5), needs none. */
  fileName?: Pattern;
  /** The shared fallback template for a channel without its own `list[].fileName`; `{{stem}}` and
   *  `{{channel}}` (the channel's id) only, no expressions. Absent: derived from `fileName` by
   *  replacing the `channel` capture with the other channel's id — `siblingNames` answers `name:
   *  null` when it cannot. */
  fileNameFor?: string;
  /** A line in the first 400 lines that names this document's channel (`channel` capture, id or
   *  alias). P12: matched on the RAW line, not the masked one, because the documented use is a
   *  header comment (`%_N_1000_MPF` says which channel it is in a comment; §7.16 #151). It WINS
   *  over the file name; a disagreement is a problem, never a silent choice. A marker naming an
   *  undeclared channel, or two markers naming different channels, name none. */
  marker?: Pattern;

  // --- sync marks --------------------------------------------------------------------
  syncMarks: SyncRule[];
  /**
   * The owner's decision of 2026-10-07 (a checkbox on the machine page, default off): every
   * line the profile's outline marks as a program `stop` or `end` is also a blocking, id-less
   * mark of every channel (rule id `STOPS_AND_ENDS_RULE`, semantics `count`, partners `all`).
   * On a Fanuc two-path control `M02`/`M30` finish only once both paths reached theirs, so a
   * post may rely on it (verify per machine, D64).
   */
  stopsAndEndsWait?: boolean;
}

/** The rule id of the marks `stopsAndEndsWait` adds; never a user rule's id (WP12.3). */
export const STOPS_AND_ENDS_RULE = 'stops-and-ends';

/** One item of a parsed wait-code list: an address letter and an inclusive range of values. */
export interface WaitCodeRange {
  /** Upper case (`M`, `P`). */
  letter: string;
  from: number;
  to: number;
}

/**
 * What `parseWaitCodes` makes of the machine page's text. `errors` name the bad item in
 * plain words (`channels.codes.notNumber` with `{ item: 'M2O0' }`); a list with an error is
 * not used, the rest of the machine is.
 */
export interface ParsedWaitCodes {
  ranges: WaitCodeRange[];
  errors: Msg[];
}

export interface SyncHit {
  ruleId: string;
  /** `''` for a `count` rule, which has no id. For a `codes` rule the code by value: letter upper
   *  case, no leading zeros (`M0101` = `M101`). For other rules the id as written, trimmed; two ids
   *  are the same when their text is the same, and, when both are all digits, when their values
   *  are. Nothing else is normalized. */
  mark: string;
  /** 1-based, in the document that holds it. */
  line: number;
  /** Channel id, or `''` for a hit outside every section. */
  channel: string;
  /** Resolved partner channel ids; a piece the machine does not declare is kept as written and
   *  reported by the check (`unknown-channel`). May contain the mark's own channel (a Fanuc
   *  `P12` names both paths); the check ignores it. */
  partners: string[];
  blocking: boolean;
  /** M12 review fix NC-01: `true` when the line had no partner word (or an empty `channels`
   *  capture) and `partners` came from `whenAbsent`; absent otherwise. */
  absent?: true;
}

/** One channel's lines inside a `single-file` document: a channel may have SEVERAL ranges, because
 *  the turret sections of a real 2S program alternate (`G13 … G14 … G13 … G14 …`). Ranges are in
 *  document order, 1-based and inclusive, never overlapping, adjacent ones merged. */
export interface ChannelSection {
  channel: ChannelRef;
  ranges: { startLine: number; endLine: number }[];
}

export type ChannelMember =
  | { kind: 'section'; channel: ChannelRef; docId: DocId; ranges: { startLine: number; endLine: number }[] }
  | {
      kind: 'file';
      channel: ChannelRef;
      name: string;
      path: string | null;
      exists: boolean;
      docId: DocId | null;
      /** How this document was tied to the channel: a pattern, or the user's own assignment
       *  (`channels.assign`, remembered by M7's per-file memory). The status item says which. */
      by: 'fileName' | 'marker' | 'assigned';
    };

/**
 * A problem of the configuration or of the resolution. `path` is a JSON path inside the
 * machine's `params.channels` (`syncMarks[2].match.pattern`, `list[1]`), or `line:<n>` for a
 * line of the document.
 */
export interface ChannelProblem {
  path: string;
  message: Msg;
}

export interface ChannelSet {
  /** `none` also when the machine's block is broken: then `problems` says why (the status item
   *  reads "the channel rules of this machine are broken"). */
  layout: ChannelParams['layout'];
  /** P12 (§7.16 #150): which channel THIS document is — the member that holds it in
   *  `multi-file`; `null` in `single-file` (the document holds several) and for `none`. */
  self: ChannelRef | null;
  /** Empty for `none`; otherwise one entry per channel that was found, in declared order. */
  members: ChannelMember[];
  /** Declared channels that were not found; shown, never silently empty. */
  missing: ChannelRef[];
  /** `single-file`: every line range that belongs to NO channel, in document order — the lines
   *  before the first section, the lines after a `sectionEnd` and before the next start, and the
   *  lines after the last section. A group of their own in the map, never dropped. Empty for
   *  `multi-file`. */
  outside: { startLine: number; endLine: number }[];
  /** Blocking and non-blocking marks of THIS document, in line order. */
  marks: SyncHit[];
  problems: ChannelProblem[];
  /** True when a cap or the budget stopped the resolution or the check; the UI says so. */
  truncated: boolean;
}

export type SyncFindingKind =
  /** `rendezvous`: an id occurs in channel A and names channel C, and C has fewer of it than A
   *  has (the ordinal partner is absent). */
  | 'missing'
  /** `rendezvous`/`count`: the two channels carry a different NUMBER of this mark. */
  | 'count-mismatch'
  /** `rendezvous`: the two ordered mark sequences of a channel pair disagree (a linear diff),
   *  with the first disagreeing pair named. */
  | 'out-of-order'
  /** `ordered` only: a mark id smaller than the previous one in the SAME channel. */
  | 'not-increasing'
  /** A mark's partner set names a channel the machine does not declare (`line` rules only). */
  | 'unknown-channel'
  /** A blocking `rendezvous` mark whose partner set names no channel but its own. NOT raised
   *  for a mark that already produced `missing` or `count-mismatch`. */
  | 'unmatched'
  /** A mark found outside every channel section (`SyncHit.channel === ''`). */
  | 'outside-channels'
  /** The order of this pair is not judged: a jump target or a backward jump lies between them. */
  | 'order-not-checked'
  /** M12 review fix NC-01: a `samePartners` rule's two paired marks name different channel
   *  sets, or one is written without the partner word and the other with it. Once per mark
   *  of the earlier declared channel. */
  | 'partners-differ'
  /** M12 review fix NC-04: the two channels carry a different number of this mark, but a
   *  mark of it sits between jump lines (inside a loop or a `GOTO` loop) in its channel, so
   *  the written count says nothing about the count run. Info, instead of `count-mismatch`. */
  | 'count-not-checked';

export interface SyncFinding {
  kind: SyncFindingKind;
  /** `''` for a `count` rule; the message then names the rule label. */
  mark: string;
  ruleId: string;
  /** The channel the finding is about. */
  channel: string;
  /** The other channel of a pair. */
  other?: string;
  /** `count-mismatch`. */
  counts?: { channel: number; other: number };
  line: number;
  /** `Located.document` semantics (F58). */
  document?: string;
  otherLine?: number;
  message: Msg;
}

/** P12 (§7.16 #150): `findMarks` reports what the cap and the budget cost. */
export interface FindMarksResult {
  /** At most `CHANNEL_CAPS.marks`, in line order. */
  marks: SyncHit[];
  /** Marks found past the cap: counted, not kept. */
  dropped: number;
  /** The deadline passed: the marks are those of the lines read so far. */
  abandoned: boolean;
  /** M12 review fix CODE-1: lines longer than `CHANNEL_CAPS.lineLength` that were not read
   *  (counted, never silent; `resolveDocument` turns a count above 0 into the problem
   *  `channels.problems.longLines`). Optional for older callers; absent = 0. */
  longLines?: number;
}

/** P12 (§7.16 #150): `findSections`' answer. */
export interface FindSectionsResult {
  /** One entry per channel found, in declared order, ranges in document order. */
  sections: ChannelSection[];
  /** Leading, inter-section and trailing lines. */
  outside: { startLine: number; endLine: number }[];
  problems: ChannelProblem[];
  /** The deadline passed: the caller answers `layout: 'none'` with a status message. */
  abandoned: boolean;
  /**
   * The lines that decided the sections, ascending: every line that matched `sectionStart`,
   * and every line whose `sectionEnd` closed one (M12 performance fix F2: the channel service
   * re-reads only the edited lines while an edit touches none of them).
   */
  boundaries?: number[];
}

/** The deadline of one resolution (`CHANNEL_CAPS.resolveMs`), and a clock for the tests. */
export interface ChannelBudget {
  /** An absolute time in `now()`'s units; absent = no deadline. */
  deadline?: number;
  now?: () => number;
}
