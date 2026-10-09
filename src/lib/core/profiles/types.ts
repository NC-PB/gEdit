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
import type { ProfileCompare } from '$lib/core/compare/types';
import type { ChannelParams } from '$lib/core/channels/types';

/** A regular expression as ECMAScript source, without delimiters and without flags. */
export type Pattern = string;

/**
 * What an outline rule marks a line as. The program map has one icon per kind.
 *
 * M12 (P12, §7.14): `channel` and `sync` are produced by the **channel service** only — a
 * channel group row and a blocking wait mark (AD-32). `validateProfile` rejects them in a
 * profile's own `outline` rules, so no profile can invent a channel row. A `switch` without
 * a default must handle them.
 */
export type OutlineKind =
  | 'tool'
  | 'program'
  | 'section'
  | 'comment'
  | 'label'
  | 'stop'
  | 'end'
  | 'subprogram-call'
  | 'channel'
  | 'sync';

/**
 * What kind of machine the profile describes (P6, §7.1). It is **not** a machine
 * configuration (AD-31): it says "turning" or "milling", not which control setting a
 * particular machine in the workshop runs with. Scripts, hover and the inspector read it
 * for their auto options and their wording ("diameter", "per revolution").
 */
export type MachineType = 'mill' | 'lathe';

/** The unit a feed word is in, once the modal state is known (AD-19). */
export type FeedUnit = 'per-minute' | 'per-rev' | 'per-tooth' | 'inverse-time' | 'travel-time' | 'unknown';

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
 * P13 (AD-30). The typing options of a profile; both default to false when absent.
 *
 * - `forceUppercase`: a plain letter typed outside a comment, a string and kept text
 *   (`TokenKind` `'comment'`, `'string'`, `'text'`) is typed in upper case. Paste, a
 *   modifier, an IME composition and every edit that is not a keystroke are left alone.
 * - `preventLineJoin`: Backspace at column 1 and Delete at the end of a line, with one
 *   empty selection, do nothing and say why in the status bar. A selected line break can
 *   still be deleted.
 */
export interface ProfileEditing {
  forceUppercase?: boolean;
  preventLineJoin?: boolean;
}

/**
 * One dialect profile, as it is stored in JSON.
 *
 * P1 uses the subset below. Fields of later phases (`editing`, `onSave`,
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
  /**
   * Which grammar generator builds the Monarch rules (WP3.4).
   *
   * P8 widens the P1 union. `okuma` and `sinumerik` are word-address dialects too, but
   * each breaks the ISO shape in a way a flag cannot express: Okuma reads `( … )` as a
   * comment and `[ … ]` as expression brackets, names its blocks (`NLAP1`) and writes
   * two-letter addresses with `=`; Sinumerik comments with `;`, keeps `( … )` for call
   * arguments and strings, and labels a block with `NAME:`.
   */
  grammar: 'iso' | 'klartext' | 'okuma' | 'sinumerik';
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
    /**
     * Evidence that a file is **not** this profile's (M9 NC review F3): when one of these
     * patterns matches any scanned line, the profile scores nothing for that file,
     * whatever its content rules add up to. Presence, not weight: the Siemens milling
     * profile lists the turning words, because one `DIAMON` or `LIMS=` makes a program a
     * turning (or mill-turn) program however many milling operations it has (R2).
     */
    vetoes?: Pattern[];
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
    /**
     * M8 (§7.16 #27). A line whose start matches this belongs to the block **above** it: the
     * leading marker of Okuma's `$` lines (`N001 G71 X27.55 Z-30 B60 D0.7 U0.1`, then
     * `$ H2.45 L2 F2 M23 M32 M73`). Anchored with `^`. The line tokenizes as it did — the
     * marker is not a token kind of its own — but every reader that works in blocks
     * (the modal interpreters, the scripts, the program checks) reads it as part of the
     * block above, so the lead on it is still the lead of that block's thread cycle.
     */
    continuationStart?: Pattern;
    /**
     * `plainLevel` (M10 review, NC-9): the level a bare mark (`/`) is, `'0'` to `'9'`.
     * Sinumerik reads `/` as `/0` (absent: `'0'`); a Fanuc control reads `/` and `/1` as one
     * switch (BDT1), so its profiles say `'1'`. Insert and remove block skip treat the bare
     * mark and that digit as one level.
     */
    blockSkip?: {
      chars: string;
      position: 'before-number' | 'after-number' | 'either';
      levels?: boolean;
      plainLevel?: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
    };
    blockNumber: {
      mode: 'prefix' | 'leading-integer';
      prefix?: string;
      altPrefixes?: string[];
      mandatory: boolean;
      /**
       * P9 (§7.1, §7.16, R4). The prefix of a **main** block number, the second kind of
       * block number a control may have (Sinumerik `:123`, syntax-sinumerik §3.1): a
       * block number and a jump target like `N123`, which marks the block that starts a
       * machining section. One character that is not a letter, a digit or a blank.
       *
       * At the head of a block it reads as one `blockNumber` token whose `address` is
       * this character, never as the `:1234` tape marker beside `O1234`; renumbering
       * numbers it in sequence with the others and keeps its prefix, so a main block stays
       * one. Unlike `altPrefixes`, which a renumber rewrites to `prefix`. Absent: no main
       * blocks, and `:` keeps its P1 reading. WP9.3 reads it (tokenizers, grammar), WP9.5
       * (renumber).
       */
      mainPrefix?: string;
    };
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
    /**
     * M10 (WP10.2, the program checks). The most digits a word may have once the control
     * has converted it to increments (Fanuc: 8). The program checks report a longer one.
     */
    maxWordDigits?: number;
    /** M10 (WP10.2). The most M codes the control takes in one block (Okuma: 8). */
    maxMCodes?: number;
    /**
     * P8. The block-number prefix also carries **names**: `N` followed by a letter-led
     * name (Okuma `NLAP1`) is a `label` token, never a block number, so renumbering never
     * touches it and go-to-block never offers it. M8 integration: the separator behind the
     * field belongs to it, behind a number as much as behind a name, so `removeSpaces`
     * never joins a block number to its block on such a profile (syntax-okuma §3.1).
     */
    sequenceNames?: boolean;
    /**
     * P8. An address that matches this at the start of a word takes `=` and an expression
     * (Okuma `SB=1200`, Sinumerik `CR=15`, `S3=2500`, `R1=R2*2`).
     *
     * The token stays a `word`: `address` is the letters (`'SB'`), `valueText` the
     * right-hand side, and `value` is null unless the right-hand side is a plain number.
     * The address is the whole identifier (letters, digits, `_`) in front of the `=`: the
     * pattern is tried only at the start of an identifier with an `=` (not `==`) behind it,
     * and its match has to be that identifier (§7.16 #18).
     */
    assignment?: Pattern;
    /**
     * P8. A label definition at the start of a block (Sinumerik `LOOP_A:`), with the named
     * group `name`. The rule has to run **before** the block-number rule, because a label
     * may start with the block-number prefix (`NEXT_PART:`).
     */
    labels?: Pattern;
    /**
     * P8. An identifier written directly in front of `(` is one `call` token up to the
     * matching `)` (`CYCLE81(10,0,2,-12)`, `MSG("TEXT")`, `L10(1)`). Nothing inside the
     * brackets is tokenized: the arguments are the call's `valueText`.
     * A name of [`names`] is the same call with blanks between it and its bracket
     * (`MSG ("TEXT")`, `CYCLE840 (…)`); a letter with a number is a call only with its
     * bracket touching it (`L10(1)`, while `L10 (1)` is an `L` word) (§7.16 #17).
     */
    calls?: boolean;
    /**
     * P8. System variables, which are read but never written by a program: Sinumerik
     * `\$[A-Z_][A-Z0-9_]*`, Okuma `V[A-Z][A-Z0-9]{3}`. Tried before [`variables`], so
     * Okuma's `VZOFZ` does not read as the common variable `V` with a value.
     */
    systemVariables?: Pattern;
    /**
     * P8. A header on the **first line** of the file, read as one `programMarker`: Okuma
     * `^\$[^%]*%`, Sinumerik `^%_N_\w+_(MPF|SPF)`. It is not an NC block, and the `$` of
     * the Okuma form is not the hexadecimal constant of an expression.
     */
    header?: Pattern;
    /**
     * M8 integration (§7.16). A name the program gives itself — a variable, a jump target,
     * a subprogram called by its name — where a word could stand: Sinumerik
     * `[A-Z_]{2}[A-Z0-9_]*` (a name starts with two letters or underscores), Okuma
     * `[A-Z]{2}[A-Z0-9]*` (a local variable, or a function in front of `[`).
     *
     * The whole match is one `unknown` token, never a run of one-letter words, so `XBOT`
     * is not an X word, `PASS2` carries no S word of 2 and `LOOP_N2` no block number. A
     * keyword is only a keyword where the name at its position is no longer than it
     * (`LOOP_A` is a name, `LOOP` a keyword). Tried after every other rule except the
     * packed one-letter words, so an assignment (`XNOW=62`), a call and a label keep
     * their own tokens.
     */
    names?: Pattern;
    /**
     * Decimal comma (§7.16 / R4). A second character that also starts a fraction when a
     * number is *read*, alongside `decimalSeparator` (Klartext CAM output writes both:
     * the manual's `.` and the owner's post's `,`). It never changes what a *new* number
     * is written with — `decimalSeparator` alone still decides that — but a number that
     * is rewritten keeps the separator it was written with, point or comma.
     */
    decimalSeparatorAlt?: '.' | ',';
    /**
     * Phase 2 (§7.16). A program **name** written in place of a program number: Fanuc
     * `<[A-Za-z0-9+\-_.]+>` (`<SHAFT_T12>`), at the head of a program and behind the call
     * words (`M98 <SUB_1> L2`, `G65 <MACRO_A> A1.`).
     *
     * The whole match is one `programMarker` token wherever it stands outside a comment,
     * never a run of address words, so no transform or script reads a word inside it. It
     * carries no `address` and no value: what the program is called is `program.start`'s
     * answer. The comment mask writes `_` for each of its letters and digits and keeps the
     * rest (`<SHAFT-T12>` masks as `<_____-___>`), so the tool, end and map rules cannot
     * find a `T12` or an `M30` in it while a rule that looks for the name's shape still
     * finds it — and the map shows the name as written, read off the real line.
     */
    programNames?: Pattern;
    /**
     * P9 (§7.1, §7.16, R4). An assignment word may carry **one bracket index** between its
     * identifier and the `=`: Sinumerik `LIMS[2]=1800`, `S[2]=500`, `M[SPI]=3`,
     * `T[1]=5` (syntax-sinumerik §3.2, "indexed address"). The whole is one `word` whose
     * `address` is the identifier (`LIMS`, `S`), `index` the text inside the brackets
     * (`'2'`, `'SPI'`) and `valueText` the right-hand side — never a word, an `expression`
     * and an `operator` with the address lost. Default false: `[` keeps its P1 reading.
     */
    assignmentIndex?: boolean;
    /**
     * P9 (§7.1, §7.16, R4). Which identifiers of `assignment` are the **control's own**
     * multi-letter addresses (Okuma `SB=`, `QA=`, `TL=`, `CP=`; syntax-okuma §3.2), as one
     * pattern the whole identifier has to match. Every other identifier an assignment
     * reads is a name the program gives a local variable (`DIA1=50` in a `CALL` block).
     *
     * The tokenizers read both the same way, one `word` with its `address`, so no token
     * changes; the grammar paints an address as one and a variable as one, and hover
     * explains the address and calls the rest a local variable. Absent: the grammar's
     * reading of P8 (every assignment identifier is looked up as an address).
     */
    extendedAddresses?: Pattern;
    /**
     * P9 (§7.1, §7.16, R4). The letters that introduce an exponent inside a number:
     * Sinumerik `EX` (`X=-.1EX-3`, `1.5EX3`; syntax-sinumerik §3.3). With it, `1.5EX3` is
     * one value of the word in front of it, never a value and an `unknown` token. The
     * token's `valueText` is the whole text and its `value` is `null`: no reading in
     * `numbers.ts` computes with an exponent yet, so nothing scales or compares it, and a
     * script reports it as a value it cannot read. Absent: no exponents (P1 reading).
     */
    exponentMarker?: string;
    /**
     * M9-2 (the owner's answers of 2026-10-08; syntax-heidenhain §6.4). One-character marks,
     * none of them a letter, that are the address of the value packed directly behind them:
     * Klartext `#` in `CYCL DEF 7.1 #5` / `#Q5`, the row of the datum table. Read only where
     * words are separated (`wordSeparatorRequired`); `#5` and `#Q5` are one `word` with
     * `address` `#`, while `# 5` and a lone `#` stay as before. Absent: no such mark.
     */
    symbolAddresses?: string[];
    /**
     * Owner decision of 2026-10-08. What *Remove Spaces* may do on this profile besides the
     * general rules: `'refuse'` (Sinumerik: names, keywords and multi-letter addresses need
     * their blanks, so the command is not offered) or `'keepAroundLongAddresses'` (Okuma: the
     * blank on either side of a word whose address has more than one letter stays, `SB=1200`).
     * Absent: the general rules only. Read by `transforms/removeSpaces.ts`; no tokenizer reads it.
     */
    removeSpaces?: 'refuse' | 'keepAroundLongAddresses';
    /**
     * M12.5 (§7.16 #179; WP-RP2, both tokenizers on shared goldens). Text the control keeps
     * and shows but does not execute. Each pattern is tried at the start of a block (behind
     * the block number) and must have the named group `text`; that group becomes **one**
     * `text` token (§7.5) and tokenizing goes on behind it. Klartext: the cycle name behind
     * `CYCL DEF <n>` up to `~`, `;` or the end (`CYCL DEF 207 TAP.-RIGID NEW`), the program
     * name between `BEGIN PGM`/`END PGM` and `MM`/`INCH` (`BEGIN PGM 7-AXLE PART MM`), the
     * `FN 16: F-PRINT` and `CALL PGM` paths. No transform rewrites a `text` token, no check
     * reads a word inside it, and hover says nothing about it.
     */
    freeText?: Pattern[];
    /**
     * M12.5 (§7.16 #179). Multi-letter addresses whose value stands behind a colon: Klartext
     * `VCONST:ON`, `VC:120` (`FUNCTION TURNDATA SPIN`), `HSC-MODE:1` (cycle 32). One `word`
     * with `address` = the name as listed and `valueText` = what follows the colon (a number
     * or a plain upper-case word such as `ON`).
     */
    colonWords?: string[];
    /**
     * M12.5 (§7.16 #179). A program name written behind a call keyword: Okuma `CALL OABCD`,
     * `MODIN O1234` (the outline rule already accepts `O[A-Z0-9]{1,4}`). `after` are the
     * keywords, `pattern` the name; the match is one `programMarker` token, as a Fanuc
     * `<NAME>` behind `M98` is.
     */
    callTargets?: { after: string[]; pattern: Pattern };
    /**
     * M12.5 (§7.16 #179). Keywords behind which a name is a jump **target**: Sinumerik
     * `GOTO`, `GOTOF`, `GOTOB`, `GOTOC`. That name is a `label` token (as a label behind a
     * jump already is for the program checks' `defines_label`), not `unknown`. A string or
     * an expression behind the keyword (`GOTOF "STEP_"<<N`) keeps its own tokens.
     */
    labelAfter?: string[];
    /**
     * M12.5 (§7.16 #179). Declaration keywords: Sinumerik `DEF`. On a line that starts with
     * one (behind the block number), the names it declares (behind the type keyword, split
     * on `,`, an `=` initializer and a `[…]` size excepted) are `variable` tokens. The use of
     * such a name on a later line stays one `unknown` token — the tokenizer reads one line at
     * a time; G11 counts a name declared in the same file as known (WP-RP8).
     */
    declareAfter?: string[];
    /**
     * M12.5 (§7.16 #179). A run of this many or more letters with no
     * digit between them, outside comments and strings, that is no keyword, function or name
     * of the profile, is **one** `unknown` token instead of a row of one-letter words: free
     * text written outside a comment (`M797 SPINDLE ONE DONE`) no longer reads as `S`, `P`,
     * `I`, … words. Fanuc mill and lathe: 3. Absent: off.
     */
    plainTextRun?: number;
    /**
     * M12.5 (§7.16 #179). `false`: a lone `%` is **not** a tape marker in
     * this dialect (Klartext has no tape; a `%` in a Q-parameter comment is text), so neither
     * tokenizer reads it as a `programMarker` and the program checks' tape rules stay off.
     * Absent or `true`: today's reading (a `%` that is no comment start or skip code is the
     * tape marker).
     */
    tapeMarker?: boolean;
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
    /**
     * P8. Assignment words whose value clamps the spindle speed instead of setting it
     * (Sinumerik `LIMS=3000` under `G96`).
     *
     * A script that scales speeds has to know the difference: raising the clamp with the
     * speed is at best pointless and at worst removes the guard the programmer put there,
     * so the word is reported and left alone (WP8.7).
     */
    speedLimitWords?: string[];
    /**
     * 2026-09 (owner decision of 2026-09-27). The number of the machine's main spindle
     * (Sinumerik `'1'`). A plain `S` while this spindle is the master (the default, or
     * after `SETMS(1)`) and the spindle word with this number (`S1=`) are the main
     * spindle's speed; any other numbered spindle is another spindle. Absent: the profile
     * names no main spindle, and every numbered spindle is another one.
     */
    mainSpindle?: string;
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
  /**
   * `endRecord` (M10 review, NC-8): a line that matches `end` is the closing record of the
   * program in the file (Klartext `END PGM`), the counterpart of the `start` line, and not a
   * block the program could skip. Absent: an `end` line is an ordinary block (`M30`).
   */
  program: { start: Pattern[]; end: Pattern[]; endRecord?: boolean };
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
  /**
   * P11 (§7.1, §7.7, AD-26). The review-mode defaults of a comparison and the comments the
   * control reads (`keepComments`). Read through `compareDefaults` (`core/compare`); the
   * built-in values are the G10 table of §8.11. A carried `tolerance` is ignored (§2.1).
   * §7.16 #148: `cycleNames` declares where the dialog-language cycle names stand, and
   * only a profile that declares them offers `ignoreCycleNames` (Klartext, off by default).
   */
  compare?: ProfileCompare;
  /**
   * P13 (§7.1, AD-30). How typing behaves in a document of this profile. Every built-in sets
   * both to true (the owner's decision of 2026-10-08: upper case on every control); a user
   * profile may turn either off. `convertCase` reads `forceUppercase` as "the control
   * expects upper case" and asks before writing lower case (P1). Other members (`tabWidth`
   * on `fanuc-gcode`) are carried, not read (§2.1: per-profile tab width is deferred).
   */
  editing?: ProfileEditing;
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
  /**
   * M12 (P12, §8.9; the owner's decisions of 2026-10-07): starting points for a machine's
   * channel block, offered on the machine page's Channels step and **never applied without a
   * machine** — a document whose machine has no `channels` has no channels (AD-32). Each
   * preset is a documented default from the control's manual, labelled with its source and
   * `verify: true` until the owner confirms it for their machine (D64). A user's machine keeps
   * its own copy; editing a preset later changes no machine.
   */
  channels?: ChannelPresetsDecl;
}

/** `machineParams.channels` (§8.9). */
export interface ChannelPresetsDecl {
  /**
   * The address letters this control's wait codes may use, upper case (`["M"]` on Fanuc,
   * `["M", "P"]` on Okuma). `parseWaitCodes` refuses an item with another letter in plain
   * words ("`G4`: wait codes are M codes on this control"). Absent: any letter.
   */
  waitLetters?: string[];
  presets: ChannelPreset[];
}

/** One channel preset: a whole `ChannelParams`, offered by name. */
export interface ChannelPreset {
  /** `^[a-z0-9][a-z0-9-]*$`, unique in the profile. */
  id: string;
  /** Display text; data, not a translation key. */
  label: string;
  value: ChannelParams;
  /** Where the notes or the manual say so (`'syntax-okuma.md §11.7a'`). */
  source?: string;
  verify?: boolean;
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
    /** `detect.vetoes`, compiled; empty when the profile has none. */
    detectVetoes: RegExp[];
    sectionHeading?: RegExp;
    continuation?: RegExp;
    /** M8: `syntax.continuationStart`, the leading marker of a line that continues a block. */
    continuationStart?: RegExp;
    variables?: RegExp;
    /** P8: `syntax.assignment`, `syntax.labels`, `syntax.systemVariables`, `syntax.header`. */
    assignment?: RegExp;
    labels?: RegExp;
    systemVariables?: RegExp;
    header?: RegExp;
    /** M8 integration: `syntax.names`. */
    names?: RegExp;
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
  /**
   * How serious the row is. `error` (the default when unset): the file or entry is not used.
   * `info`: a notice that changes nothing, e.g. a user code entry that changes what a built-in
   * code means (owner, 2026-10-09).
   */
  severity?: 'error' | 'info';
  /**
   * Which folder the file is in (`<config>/profiles` or `<config>/codes`): a profile file and a
   * code file may have the same name, and only this tells their problems apart. Unset on a
   * problem that belongs to no file (a folder that could not be read).
   */
  kind?: 'profiles' | 'codes';
  /** Which source it was, for a file that has no id and no name to be called by. */
  index?: number;
}
