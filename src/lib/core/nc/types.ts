// NC token contract (plan §7.4, AD-12). Written by the M3 prelude (P3); binding.
//
// The tokenizer works line by line and is stateful only in the one bit Klartext needs
// (`LineState.continuation`), so any line can be re-tokenized on its own as long as the
// state of the line before it is known. Positions are UTF-16 offsets into the line, with
// `start` inclusive and `end` exclusive, which is what Monaco's ranges use.
//
// Numbers are kept as text (`NumericLiteral`), never as JS `number`: `10.` and `10` are
// different values on a Fanuc control (`syntax.decimalPointSignificant`), trailing zeros
// carry the programmer's intent, and the Python side (§7.10) has to reach the same result
// with `Decimal` arithmetic. Everything that computes with NC numbers therefore works on
// decimal strings and rounds half away from zero.
//
// The implementations live in the modules WP3.2 owns, one concern per file:
//
//   tokenizeLine, blockNumberOf   core/nc/tokenizer.ts
//   maskComments                  core/nc/mask.ts
//   parseNumber                   core/nc/numbers.ts
//   formatNumber                  core/nc/numberFormat.ts

import type { ParamSource } from '$lib/core/machines/types';
import type { FeedUnit } from '$lib/core/profiles/types';

/**
 * What a token is.
 *
 * - `word`: an address letter (or `,R`, `,C`) plus its value, e.g. `X10.`, `G0`, `T1`.
 * - `keyword`: a word from `syntax.keywords`, e.g. `GOTO`, `TOOL CALL`, `CYCL DEF`.
 * - `expression`: a bracket expression, e.g. `[#2+1]`.
 * - `continuation`: the trailing marker that joins the line to the next (Klartext `~`).
 * - `programMarker`: `%`, and the `O1234` / `:1234` program number.
 * - `unknown`: anything the profile does not describe. It is never `invalid`; marking
 *   errors is the linter's job (M4+).
 */
export type TokenKind =
  | 'blockNumber'
  | 'skip'
  | 'word'
  | 'keyword'
  | 'comment'
  | 'string'
  | 'variable'
  | 'expression'
  | 'operator'
  | 'continuation'
  | 'programMarker'
  | 'whitespace'
  | 'unknown';

/**
 * A number exactly as it was written. `raw` is the text, and the parts are what it is
 * made of: `'-10.'` is `{ sign: '-', intPart: '10', fracPart: '', hasPoint: true }`,
 * `'.5'` is `{ sign: '', intPart: '', fracPart: '5', hasPoint: true }`, and `'10'` is
 * `{ sign: '', intPart: '10', fracPart: null, hasPoint: false }`.
 */
export interface NumericLiteral {
  raw: string;
  sign: '+' | '-' | '';
  intPart: string;
  /** The digits after the separator; `null` when the number has no separator. */
  fracPart: string | null;
  hasPoint: boolean;
}

export interface NcToken {
  kind: TokenKind;
  /** UTF-16 offset of the first character, from the start of the line. */
  start: number;
  /** UTF-16 offset one past the last character. */
  end: number;
  /** The exact source text, `line.slice(start, end)`. */
  text: string;
  /** The address of a word (`'G'`, `'X'`, `',R'`), or the text of a keyword. */
  address?: string;
  /** What follows the address (`'10.'`, `'#101'`). */
  valueText?: string;
  /** The parsed value, or `null` when the value is a variable or an expression. */
  value?: NumericLiteral | null;
  /** Klartext `I` prefix: the axis word is incremental. */
  incremental?: boolean;
}

/** What one line hands to the next. */
export interface LineState {
  /** The line before ended with the continuation marker, so this line is its tail. */
  continuation: boolean;
}

/** What `tokenizeLine` returns: the tokens of the line, and the state for the next one. */
export interface TokenizeResult {
  tokens: NcToken[];
  state: LineState;
}

// ---------------------------------------------------------------------------
// The modal state (P6, §7.4, AD-19). Python fills it in M6 (`_nc_modal.py`,
// WP6.4), TypeScript in M11 (`core/nc/modal.ts`, WP11.1); both are held to the
// goldens in `tests/fixtures/modal/<profileId>/<case>.json`.
//
// NC is a modal language: `G95`, a tapping cycle or `G96` stays in force until
// something cancels it. Everything below is what "in force" means, and every
// value that gEdit did not read out of the program carries `assumed: true` and
// the source it came from, so nothing is ever presented as if the program had
// said it.
// ---------------------------------------------------------------------------

/** The code in force in one modal group. `line` 0 together with `assumed` means power-on. */
export interface ModalValue {
  code: string;
  /** Where it was set; 0 for an assumed power-on value. */
  line: number;
  assumed: boolean;
  /**
   * For an assumed value: where it came from — the document's machine, a detected
   * variant's overlay, or the profile's documented default (`modal.sources`, AD-19 rule 8).
   */
  from?: ParamSource;
}

/** A word the interpreter kept: its text, its line, and whether it was a variable. */
export interface WordSeen {
  valueText: string;
  line: number;
  /** The value is a variable or an expression, so it has no literal. */
  variable: boolean;
}

/** Everything that is in force after a block (§7.4). */
export interface ModalState {
  /** Modal group → the code in force (`'motion'` → `'G1'`, `'feedmode'` → `'G99'`). */
  groups: Record<string, ModalValue>;
  feedUnit: FeedUnit;
  speedUnit: 'rpm' | 'surface' | 'unknown';
  /**
   * `'absolute'` **without** a line on a database that declares no distance codes at all
   * (Fanuc G-code system A, which has no `G91`, and Klartext): it is the only reading the
   * database allows, so it is not assumed, it is known (AD-19 rule 8).
   */
  distance: 'absolute' | 'incremental' | 'unknown';
  /** The power-on value is assumed; `G20`/`G21` set it with their line. */
  units: { value: 'mm' | 'inch' | 'unknown'; line: number; assumed: boolean; from?: ParamSource };
  plane: 'XY' | 'ZX' | 'YZ' | 'unknown';
  /**
   * Diameter programming of the `addresses.diameter` words; `null` on a profile without
   * the parameter (a mill). Whether one word is a diameter or a radius value also depends
   * on `distance` (AD-19 rule 11), so a consumer asks for that answer, never for the mode.
   */
  diameter: { mode: 'on' | 'off' | 'absolute-only'; line: number; assumed: boolean; from?: ParamSource } | null;
  /** The tool of the last tool line: `station` as the profile's `tool` group captured it. */
  tool: { station: string; written: string; line: number } | null;
  feed: WordSeen | null;
  speed: WordSeen | null;
  /** The last clamp value: an `S` in a `sets.speedLimit` block, or a `speedLimitWords` assignment. */
  speedLimit: WordSeen | null;
  activeCycle: { code: string; line: number; pitchFeed: boolean } | null;
  pitchFeedAmbiguous: string | null;
  /** Flags of the block just applied, and of that block only. */
  block: { cycle: string | null; pitchFeed: boolean; speedLimit: boolean; fNotFeed: boolean; toolChange: boolean };
}

/** What `blockNumberOf` returns; `text` is the number as written, without the prefix. */
export interface BlockNumberInfo {
  value: number;
  text: string;
  /** Offset of the whole block number, prefix included. */
  start: number;
  end: number;
}
