// The dialect-profile contract (plan §7.4, AD-11). Written by the M3 prelude (P3) and
// binding for every M3 work package: an implementation may change, a signature here may
// not (a deviation needs a hand-off note and integration approval).
//
// A profile is everything the app knows about one kind of NC file: extensions and
// detection, comment and block-number syntax, how a tool call looks, how blocks are
// numbered, which outline rules build the program map. The built-ins are JSON files in
// `$lib/data/profiles/`; `validateProfile` turns unknown JSON into a `Profile` and
// `compileProfile` turns a `Profile` into the `CompiledProfile` that every NC feature
// reads at runtime.
//
// This file holds types only (plus the two function signatures whose implementations live
// next to it), so it can be imported from anywhere, `core/` included (AD-1).
//
// **Pattern rule (AD-11).** Every `Pattern` stays inside the common subset of ECMAScript
// and Python `re`, because `gedit_nc.py` compiles the same profiles (§7.10): no
// variable-width lookbehind, no `\p{…}`, no `\k<…>`. Code patterns use `(?<![A-Z])`
// before the address and `(?!\d)` after the number instead of `\b`, because CAM output is
// packed (`N10T1M6`) and `\b` finds no boundary between a digit and the next letter.
// Flags are never written into a pattern; `compileProfile` adds `i` unless
// `syntax.caseSensitive` is set.

import type { Eol } from '$lib/app/types';

/** A regular expression as ECMAScript source, without delimiters and without flags. */
export type Pattern = string;

/** What an outline rule marks a line as. The program map has one icon per kind. */
export type OutlineKind = 'tool' | 'program' | 'section' | 'comment' | 'label' | 'stop' | 'end' | 'subprogram-call';

/** `profile.numbering`, read by renumbering, auto-numbering and go-to-block (WP4.2). */
export interface NumberingOptions {
  /** `free`: any start and step. `consecutive` (Klartext): every block, step 1, no gaps. */
  mode?: 'free' | 'consecutive';
  start: number;
  step: number;
  /** Zero padding; 0 or missing means none. */
  digits?: number;
  max?: number;
  onOverflow?: 'wrap' | 'stop';
  spacesAfter?: number;
  /** Lines starting with one of these (after trimming) keep their text unnumbered. */
  skipStartingWith?: string[];
  skipEmpty?: boolean;
  restartAtProgramStart?: boolean;
  /** Only renumber lines that already carry a block number. */
  onlyNumbered?: boolean;
  /** Block-number references that have to follow a renumber (`M99 P…`, `GOTO…`). */
  references?: { trigger: Pattern; addresses: string[] }[];
}

/** `profile.numberFormat`, read by `formatNumber` (WP3.2) and the M4 transforms. */
export interface NumberFormatOptions {
  /** `keep`: leave the written precision alone. A number rounds half away from zero. */
  decimals: 'keep' | number;
  trailingZeros: 'keep' | 'drop';
  /** Keep a trailing decimal point when the fraction is dropped (`10.` stays `10.`). */
  keepPoint: boolean;
  plusSign: 'keep' | 'always' | 'never';
}

/**
 * One dialect profile, as it is stored in JSON.
 *
 * P1 uses the subset below. Fields of later phases (`editing`, `onSave`, `compare`,
 * `highlight`, `colors`, `extends`, …) are kept as written by the index signature, so a
 * profile file survives a round trip through the app untouched.
 */
export interface Profile {
  /** Stable id; it is also the Monaco language id of the documents that use it. */
  id: string;
  /** Full name, e.g. for the profile list. */
  name: string;
  /** Short name for the status bar. */
  shortName: string;
  version: number;
  /** Which grammar generator builds the Monarch rules (WP3.4). */
  grammar: 'iso' | 'klartext';
  /** Id of the code database this profile reads (`data/codes/<codes>.json`). */
  codes: string;
  files: {
    /** Without the dot, preferred one first. */
    extensions: string[];
    defaultExtension: string;
    /** Name of the file-dialog filter (`[]` on macOS, F7/AD-7). */
    filterName: string;
    encoding: 'keep';
    lineEnding: 'keep';
    newFileLineEnding: Eol;
  };
  detect: {
    /** Extension (lower case, no dot) → weight. */
    extensions: Record<string, number>;
    /** Per line, only the strongest matching pattern counts (AD-11). */
    content: { pattern: Pattern; weight: number }[];
    /** A file inside one of these folders picks this profile outright. */
    folders?: string[];
    /** Tie-break; higher wins. */
    priority?: number;
  };
  syntax: {
    /** Default false: patterns and codes are matched case-insensitively. */
    caseSensitive?: boolean;
    /**
     * True when `"` opens a string in this dialect (Klartext tool and label names).
     * Default false: Fanuc has no strings, and a stray quote there is just a character.
     */
    strings?: boolean;
    /** `end: null` means the comment runs to the end of the line. */
    comments: { start: string; end: string | null }[];
    sectionHeading?: Pattern;
    /** Matches the trailing marker that joins this line to the next (Klartext `~`). */
    continuation?: Pattern;
    /**
     * The marker itself, for the places that have to *write* one (the multi-line cycle
     * snippet of the assistant). `continuation` can only recognise it.
     */
    continuationMark?: string;
    blockSkip?: { chars: string; position: 'before-number' | 'after-number' | 'either'; levels?: boolean };
    blockNumber: { mode: 'prefix' | 'leading-integer'; prefix?: string; altPrefixes?: string[]; mandatory: boolean };
    decimalSeparator: '.' | ',';
    /** True when `X10` and `X10.` mean different values (Fanuc increment system). */
    decimalPointSignificant: boolean;
    /** True when words must be separated by whitespace (Klartext); false for packed words. */
    wordSeparatorRequired: boolean;
    /** Letter in front of an axis word that makes it incremental (Klartext `I`). */
    incrementalPrefix?: string;
    /** Matches a variable reference (`#101`, `Q12`, `QL3`). */
    variables?: Pattern;
    /** Words the tokenizer reads before single-letter addresses (`GOTO`, `TOOL CALL`). */
    keywords?: string[];
    /** Longest block the control accepts; used by the lint rules and the rulers. */
    maxLineLength?: number;
  };
  addresses: {
    tool?: string;
    feed?: string;
    /** Rapid marker: an address letter, or a keyword such as `FMAX`. */
    rapid?: string;
    spindle?: string;
    axes: string[];
    arcCenter?: string[];
    arcCenterMode?: 'incremental' | 'absolute';
  };
  toolCall: {
    /** A line that changes the tool (`M6`, `TOOL CALL …`). */
    trigger: Pattern;
    /** Carries the named group `tool`. */
    tool: Pattern;
    /** `same-line-or-last`: the tool is the `T` on the line, or the last `T` before it. */
    toolFrom: 'same-line' | 'same-line-or-last';
  };
  program: { start: Pattern[]; end: Pattern[] };
  /** Ordered; the first matching rule wins. Named groups `text` and `name` give the label. */
  outline: { kind: OutlineKind; pattern: Pattern }[];
  numbering: NumberingOptions;
  numberFormat?: NumberFormatOptions;
  onLoad?: { stripNul?: boolean };
  toolList?: {
    /** Where the descriptive comment of a tool sits; `auto` tries trailing, above, below. */
    description: 'auto' | 'above' | 'below' | 'trailing';
    /** A comment that matches is decoration (`-----`), not a description. */
    commentFilter?: Pattern;
    dropLeadingZeros?: boolean;
    collapseOffsetDigits?: boolean;
  };
  /** Fields of later phases are preserved, not interpreted (see the note above). */
  [p2Field: string]: unknown;
}

/**
 * A profile with every pattern compiled once. Services take this, never a raw `Profile`,
 * so no regex is built per line.
 */
export interface CompiledProfile {
  profile: Profile;
  /** The flags every regex was built with: `i`, or `''` when `caseSensitive` is set. */
  flags: 'i' | '';
  re: {
    detectContent: { re: RegExp; weight: number }[];
    sectionHeading?: RegExp;
    continuation?: RegExp;
    variables?: RegExp;
    toolTrigger: RegExp;
    tool: RegExp;
    programStart: RegExp[];
    programEnd: RegExp[];
    outline: { kind: OutlineKind; re: RegExp }[];
    references: { trigger: RegExp; addresses: string[] }[];
    commentFilter?: RegExp;
  };
  /** `syntax.keywords`, upper-cased and longest first, so the tokenizer can match greedily. */
  keywords: string[];
}

/**
 * Where a profile is broken. `path` is the JSON path of the offending field, such as
 * `outline[2].pattern`, so the message points at the file and not at the app.
 */
export interface ProfileErrorInfo {
  path: string;
  message: string;
}

/** The result of `validateProfile`: either a profile, or the list of problems found. */
export type ProfileValidation = { ok: true; profile: Profile } | { ok: false; errors: string[] };
