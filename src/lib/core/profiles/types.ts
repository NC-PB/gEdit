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
import type { NumberInput, ParamSource } from '$lib/core/machines/types';

/** A regular expression as ECMAScript source, without delimiters and without flags. */
export type Pattern = string;

/** What an outline rule marks a line as. The program map has one icon per kind. */
export type OutlineKind = 'tool' | 'program' | 'section' | 'comment' | 'label' | 'stop' | 'end' | 'subprogram-call';

/**
 * What kind of machine the profile describes (P6, §7.1). It is **not** a machine
 * configuration (AD-31): it says "turning" or "milling", not which control setting a
 * particular machine in the workshop runs with. Scripts, hover and the inspector read it
 * for their auto options and their wording ("diameter", "per revolution").
 */
export type MachineType = 'mill' | 'lathe';

/** The unit a feed word is in, once the modal state is known (AD-19). */
export type FeedUnit = 'per-minute' | 'per-rev' | 'per-tooth' | 'inverse-time' | 'unknown';

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
  /**
   * Block-number references that have to follow a renumber (`M99 P…`, `GOTO…`).
   *
   * P6: `rewrite` defaults to true — the value is rewritten with the number it points at.
   * `false` means "report only": a Fanuc `M99 P` may name a block in the **caller**, which
   * a renumber of this file cannot see, so rewriting it would point the return somewhere
   * else (F42).
   */
  references?: { trigger: Pattern; addresses: string[]; rewrite?: boolean }[];
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
  /**
   * P6, AD-16. Parent profile id. The child is merged over its **resolved** parent before
   * validation, and the field is kept on the result so the UI can show the chain. A child
   * must set its own `id`, `name` and `shortName`.
   */
  extends?: string;
  /** P6. Default `'mill'`. See [`MachineType`]: the kind of machine, not a machine. */
  machineType?: MachineType;
  /**
   * P6, AD-19 rule 8 and AD-31. The power-on state.
   *
   * `initial` is modal group → canonical code in force at the top of a program, as the
   * control comes up. A built-in JSON writes only `initial`; `units`, `diameter` and
   * `sources` are written by `applyMachine` from the document's machine or from the
   * defaults in `machineParams`. All of them are applied as **assumed** (line 0), and
   * `sources` says where each one came from, so the interpreter and the UI can tell a
   * value the machine states from one gEdit fell back on.
   */
  modal?: {
    initial?: Record<string, string>;
    units?: 'mm' | 'inch';
    diameter?: 'on' | 'off';
    /** A key per modal group, plus `units` and `diameter`. */
    sources?: Record<string, ParamSource>;
  };
  /**
   * P6, AD-31. What a machine configuration of this profile may set, with the documented
   * defaults (§7.15, §8.8). Absent: the profile has no machine parameters (Klartext) and
   * no machine item in the status bar.
   */
  machineParams?: MachineParamsDecl;
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
    /** P6. Incremental address → the axis it moves: `{ U: 'X', W: 'Z' }`. */
    incremental?: Record<string, string>;
    /** P6. Addresses written as a diameter while the diameter mode is on: `['X', 'U']`. */
    diameter?: string[];
    /** P6. Rotary axes, whose number class is `angle` (AD-31): `['A', 'B', 'C']`. */
    angular?: string[];
    /**
     * P6. Words that set the feed unit by themselves (Klartext `{ FU: 'per-rev',
     * FZ: 'per-tooth' }`); a plain feed word returns to the unit the modal group gives.
     */
    feedUnitWords?: Record<string, Exclude<FeedUnit, 'unknown'>>;
  };
  toolCall: {
    /** A line that changes the tool (`M6`, `TOOL CALL …`). */
    trigger: Pattern;
    /** Carries the named group `tool`. */
    tool: Pattern;
    /** `same-line-or-last`: the tool is the `T` on the line, or the last `T` before it. */
    toolFrom: 'same-line' | 'same-line-or-last';
    /**
     * P6. A trigger line whose **masked** text also matches this is not a tool change.
     * A Fanuc lathe writes `T0100` to cancel the offset of station 1 and `G00 X100. T0100`
     * to retract with it — neither is a tool change, and counting them would put a tool
     * step and a program-map row on every retract.
     */
    ignore?: Pattern;
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

// ---------------------------------------------------------------------------
// What a machine configuration of this profile may set (P6, AD-31, §7.1, §8.8)
//
// The declaration is **data**, inherited through `extends` like every other field, and
// reviewed by G10. No code names a dialect: the Fanuc lathe's A/B difference, Okuma's unit
// table and the Sinumerik diameter default are all written down here, in the profile.
//
// Every value in a declaration is a **documented default, not a fact** about anybody's
// machine (§8 header). That is why a preset carries `source` where the syntax notes give
// one and `verify: true` where they do not: the label the user reads has to say which of
// the two it is.
// ---------------------------------------------------------------------------

/** One way of reading numbers, offered by name ("Increments of 0.001 mm (IS-B)"). */
export interface NumberInputPreset {
  /** `'is-b'`, `'calculator'`, `'okuma-10um'`. */
  id: string;
  /** Display text; data, not a translation key. */
  label: string;
  value: NumberInput;
  /** Where the notes say so (`'syntax-okuma.md §3.3'`); absent with `verify: true` = a documented default. */
  source?: string;
  verify?: boolean;
}

/**
 * A profile overlay: merged like `extends` (AD-16) and limited to these members, so a
 * variant can change the power-on state, the tool rule, the numbering and the addresses —
 * and nothing else. The validator enforces the limit.
 */
export type ProfileOverlay = Partial<Pick<Profile, 'modal' | 'toolCall' | 'numbering' | 'addresses'>>;

/** One choice of a variant (`A` or `B` of the Fanuc lathe's G-code system). */
export interface VariantChoice {
  /** `'A'`. */
  value: string;
  /** `'G-code system A'`. */
  label: string;
  /** The code database for this choice (an AD-17 child of the profile's `codes`); absent = `codes`. */
  codes?: string;
  overlay?: ProfileOverlay;
  /**
   * Scored on the first 400 masked lines, and only when no machine is chosen (AD-31).
   *
   * Unlike `detect.content`, each pattern scores its weight **once** (presence). A marker
   * a post repeats in every block — a system-B `G99 G83 …` cycle-return line, which also
   * matches the system-A `G98`/`G99` rule — would otherwise outvote a single decisive
   * marker such as one `G92 S` clamp (WP6.1).
   */
  detect?: { pattern: Pattern; weight: number }[];
}

/** One machine parameter with a fixed set of choices (`gcodeSystem`: A or B). */
export interface VariantDecl {
  /** `'gcodeSystem'`. */
  id: string;
  label: string;
  /** One of the `choices` values; what applies when nothing is chosen and nothing detected. */
  default: string;
  choices: VariantChoice[];
}

/** `profile.machineParams` (§7.15, §8.8). */
export interface MachineParamsDecl {
  /** Absent: numbers are read as the profile's JSON says, with no choice (Klartext). */
  numberInput?: { default: string; presets: NumberInputPreset[] };
  /** Power-on default; absent = `'mm'`. */
  units?: 'mm' | 'inch';
  /** Lathes only; absent = not a parameter of this profile. */
  diameter?: 'on' | 'off';
  /** Modal groups whose power-on code a machine may set; the dialog offers their codes. */
  modalGroups?: string[];
  variants?: VariantDecl[];
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
    /** P6: `toolCall.ignore`. A trigger line that also matches this is not a tool change. */
    toolIgnore?: RegExp;
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

// ---------------------------------------------------------------------------
// Inheritance (P6, AD-16). The functions live in `core/profiles/resolve.ts`;
// their types live here, with every other profile type.
// ---------------------------------------------------------------------------

/** One profile file on its way in: the JSON, where it came from, and which file it was. */
export interface ProfileSource {
  raw: unknown;
  origin: 'builtin' | 'user';
  /** The user file's name; absent for a built-in. */
  file?: string;
}

/** One profile after its parents were merged into it. `profile` is still raw JSON. */
export interface ResolvedProfile {
  profile: Record<string, unknown>;
  origin: 'builtin' | 'user';
  file?: string;
  /** Own id first, then the parents (`['fanuc-lathe', 'fanuc-gcode']`). */
  chain: string[];
}

/**
 * Why a profile could not be used, with enough detail to fix the file: which file, which
 * profile, and the JSON path of the field at fault.
 */
export interface ProfileProblem {
  origin: 'builtin' | 'user';
  file: string | null;
  profileId: string | null;
  path: string;
  message: string;
  /** Which source it was, for a file that has no id and no name to be called by. */
  index?: number;
}
