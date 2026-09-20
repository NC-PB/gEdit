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

/** What `blockNumberOf` returns; `text` is the number as written, without the prefix. */
export interface BlockNumberInfo {
  value: number;
  text: string;
  /** Offset of the whole block number, prefix included. */
  start: number;
  end: number;
}
