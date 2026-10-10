// Formula parameters (Phase 3 plan §6.11, AD-38, P3.8; `docs/planning/code-assistant.md` "Formula
// parameters"). Built by P3.8.
//
// A formula parameter computes its value from the other parameters of its template, for example a
// feed from speed, teeth and chip load: `s * z * fz`, the depth of a drill's point from its
// diameter and point angle: `d / 2 / tan(a / 2)`, or the core diameter of a metric thread from
// the nominal diameter and the pitch: `d - 1.0825 * p`. The language (binding):
//
//   - numbers written as decimal text (`0.05`, `.5`, `12`, `12.`; no exponent, no comma), the
//     parameters of the template by id (number, integer, choice with a numeric value, and other
//     formulas), the constant `pi`;
//   - `+ - * / %` (`%` is the remainder with the sign of the left side), unary `-` and `+`,
//     parentheses; the usual precedence (`* / %` before `+ -`), left to right;
//   - the functions `abs floor ceil round sign sqrt ln log sin cos tan asin acos atan`, each with
//     one argument, and `round(x, n)` with a whole `n` from 0 to 6; angles in degrees (the
//     inverse functions answer degrees); `log` is base 10, `ln` the natural logarithm; `round`
//     rounds half away from zero, as everywhere in gEdit;
//   - `+ - * / %`, `abs`, `floor`, `ceil`, `round`, `sign` and `pi`'s neighbours are exact on
//     decimal text (integer arithmetic on scaled `bigint`, the rules of
//     `core/machines/numbers.ts`; a division is carried to 24 decimals, rounded half away from
//     zero there): `0.1 + 0.2` is `0.3`. `pi` and the other functions are computed in double
//     precision and kept to 15 significant digits; the trigonometric functions reduce the angle
//     exactly first, so `sin(30)` is `0.5`, `cos(90)` is `0` and `tan(90)` is an error;
//   - the result is rounded half away from zero to the parameter's own fixed `decimals`, and to
//     at most `FORMULA_LIMITS.maxDecimals` for `'as-entered'`, `'min1'` or no `decimals` (a
//     formula result is computed, not typed, so rounding it is no correction of the user's
//     input). `evaluateFormulas` answers that value as plain decimal text (`-2.5`, `10`, `0.3`:
//     no `+`, no padding, no trailing zeros); the engine writes it by the parameter's own
//     `decimals`/`digits`/`plusSign`/`prefix`/`suffix` (`engine.ts` rule 4), as a typed value;
//   - a formula that reads another formula reads its value as the form shows it (rounded to
//     that parameter's decimals), so what is inserted and what is computed from it agree;
//   - no units: a formula computes in the units the values are typed in (the document's mm or
//     inch, the template's degrees); a constant such as the `1000` of `pi * d * n / 1000` is the
//     template author's, and nothing is converted behind the user's back;
//   - never `eval`, `Function`, property access or a regex over the whole text: a tokenizer and
//     a recursive-descent parser with the limits of `FORMULA_LIMITS` (characters, tokens,
//     nesting). A name is only ever a function, `pi`, or a key looked up with `Map.get` in the
//     template's own parameters, so `constructor` or `__proto__` is "no parameter of this
//     template" and nothing else;
//   - a reference to an **empty** parameter makes the formula empty (`null`: its word drops, as
//     for any empty optional parameter; an empty **required** parameter is the engine's error);
//     a division by zero, a root or logarithm out of range, `tan(90)`, `asin(2)`, a `round` with
//     a bad `n`, a value that is no number, or a result beyond `FORMULA_LIMITS.magnitude` is an
//     error by parameter id (`cycleForm.formula.*`), shown in the form, and the template is not
//     inserted;
//   - references form no cycle (`a = b + 1`, `b = a * 2` is refused when the file is read, and
//     an error here for a template that did not come through the loader).

import type { Msg } from '$lib/app/types';
import type { FormulaResult, TemplateDef, TemplateParam, TemplateParamType } from './types';

/** The functions a formula may call. */
export const FORMULA_FUNCTIONS = [
  'abs',
  'floor',
  'ceil',
  'round',
  'sign',
  'sqrt',
  'ln',
  'log',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
] as const;

/** The constants a formula may read. */
export const FORMULA_CONSTANTS = ['pi'] as const;

/** Bounds of one formula: characters, tokens, nesting, the largest result, digits a function result keeps, decimals for `as-entered`/`min1`. */
export const FORMULA_LIMITS = {
  length: 400,
  tokens: 200,
  depth: 32,
  magnitude: 1e9,
  significant: 15,
  maxDecimals: 4,
} as const;

/** The parameter types a formula may read. */
export const FORMULA_READABLE: readonly TemplateParamType[] = ['number', 'integer', 'choice', 'formula'];

const NAME = /[A-Za-z_][A-Za-z0-9_]*/g;
const ALLOWED = /^[0-9A-Za-z_.+\-*/%(),\s]*$/;
const RESERVED = new Set<string>([...FORMULA_FUNCTIONS, ...FORMULA_CONSTANTS]);
const FUNCTIONS = new Set<string>(FORMULA_FUNCTIONS);

/** Every parameter id a formula reads, in first-seen order (names that are no function and no constant). */
export function formulaRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NAME)) {
    // A name glued to a number's digits (`2e5`) is not a reference; `checkFormula` refuses it.
    const before = m.index === 0 ? '' : text[m.index - 1];
    if (/[0-9.]/.test(before)) continue;
    const name = m[0];
    if (!RESERVED.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Why a formula cannot be used, in plain words, or null. `params` maps the template's parameter
 * ids to their types. The loader calls it for every formula of a file (`load.ts`), so a formula
 * that does not parse (`s * * z`) is refused when the file is read, not when the form opens.
 */
export function checkFormula(text: string, params: ReadonlyMap<string, TemplateParamType>): string | null {
  if (typeof text !== 'string' || text.trim() === '') return 'the formula is empty';
  if (text.length > FORMULA_LIMITS.length) return `the formula is longer than ${FORMULA_LIMITS.length} characters`;
  if (!ALLOWED.test(text)) return 'the formula may use numbers, parameter names, + - * / %, parentheses, commas and the functions only';
  const parsed = parseFormula(text);
  if ('error' in parsed) return `the formula cannot be read: ${parsed.error}`;
  for (const name of parsed.refs) {
    const type = params.get(name);
    if (type === undefined) return `the formula reads "${name}", which is no parameter of this template`;
    if (!FORMULA_READABLE.includes(type)) return `the formula reads "${name}", a ${type} parameter; a formula reads numbers only`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Tokens and the parser
// ---------------------------------------------------------------------------------------------

type Tok =
  | { k: 'num'; text: string; at: number }
  | { k: 'name'; text: string; at: number }
  | { k: 'op'; text: '+' | '-' | '*' | '/' | '%' | '(' | ')' | ','; at: number };

/** The parsed tree. Internal: callers hold a `ParsedFormula` and hand it back. */
type Node =
  | { k: 'num'; text: string }
  | { k: 'ref'; name: string }
  | { k: 'pi' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '%'; a: Node; b: Node }
  | { k: 'call'; fn: (typeof FORMULA_FUNCTIONS)[number]; args: Node[] };

/** A parsed formula: its text, the parameter ids it reads (first-seen order) and its tree (opaque). */
export interface ParsedFormula {
  readonly text: string;
  readonly refs: readonly string[];
  /** The tree `evaluateFormulas` walks; opaque to every other caller. */
  readonly root: unknown;
}

class ParseError extends Error {}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isNameStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (out.length >= FORMULA_LIMITS.tokens) throw new ParseError(`more than ${FORMULA_LIMITS.tokens} parts`);
    if (isDigit(c) || c === '.') {
      const start = i;
      while (i < text.length && isDigit(text[i])) i++;
      if (i < text.length && text[i] === '.') {
        i++;
        while (i < text.length && isDigit(text[i])) i++;
      }
      const num = text.slice(start, i);
      if (num === '.') throw new ParseError(`a point without digits at ${start + 1}`);
      if (i < text.length && (text[i] === '.' || isNameStart(text[i]))) {
        throw new ParseError(`"${text.slice(start, i + 1)}" is no number (write numbers as 12.5, without an exponent)`);
      }
      out.push({ k: 'num', text: num, at: start });
      continue;
    }
    if (isNameStart(c)) {
      const start = i;
      while (i < text.length && (isNameStart(text[i]) || isDigit(text[i]))) i++;
      out.push({ k: 'name', text: text.slice(start, i), at: start });
      continue;
    }
    if ('+-*/%(),'.includes(c)) {
      out.push({ k: 'op', text: c as '+', at: i });
      i++;
      continue;
    }
    throw new ParseError(`"${c}" at ${i + 1} is not part of a formula`);
  }
  return out;
}

class Parser {
  private i = 0;
  private depth = 0;
  readonly refs: string[] = [];

  constructor(private readonly toks: readonly Tok[]) {}

  parse(): Node {
    if (this.toks.length === 0) throw new ParseError('the formula is empty');
    const node = this.expr();
    const rest = this.toks[this.i];
    if (rest) throw new ParseError(`"${rest.text}" at ${rest.at + 1} does not belong there`);
    return node;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private isOp(text: string): boolean {
    const t = this.peek();
    return t !== undefined && t.k === 'op' && t.text === text;
  }

  private expect(text: string, what: string): void {
    if (!this.isOp(text)) {
      const t = this.peek();
      throw new ParseError(t ? `${what} expected at ${t.at + 1}, found "${t.text}"` : `${what} expected at the end`);
    }
    this.i++;
  }

  private enter(): void {
    if (++this.depth > FORMULA_LIMITS.depth) throw new ParseError(`nested deeper than ${FORMULA_LIMITS.depth} levels`);
  }

  private expr(): Node {
    this.enter();
    let a = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.toks[this.i++] as { text: '+' | '-' }).text;
      a = { k: 'bin', op, a, b: this.term() };
    }
    this.depth--;
    return a;
  }

  private term(): Node {
    let a = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.toks[this.i++] as { text: '*' | '/' | '%' }).text;
      a = { k: 'bin', op, a, b: this.unary() };
    }
    return a;
  }

  private unary(): Node {
    if (this.isOp('-') || this.isOp('+')) {
      const minus = this.isOp('-');
      this.i++;
      this.enter();
      const a = this.unary();
      this.depth--;
      return minus ? { k: 'neg', a } : a;
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.peek();
    if (t === undefined) throw new ParseError('a value expected at the end');
    if (t.k === 'num') {
      this.i++;
      return { k: 'num', text: t.text };
    }
    if (t.k === 'name') {
      this.i++;
      const call = this.isOp('(');
      if (FUNCTIONS.has(t.text)) {
        if (!call) throw new ParseError(`${t.text} needs its argument in parentheses`);
        return this.call(t.text as (typeof FORMULA_FUNCTIONS)[number]);
      }
      if (call) throw new ParseError(`"${t.text}" is no function`);
      if (t.text === 'pi') return { k: 'pi' };
      if (!this.refs.includes(t.text)) this.refs.push(t.text);
      return { k: 'ref', name: t.text };
    }
    if (t.text === '(') {
      this.i++;
      const node = this.expr();
      this.expect(')', 'a ")"');
      return node;
    }
    throw new ParseError(`"${t.text}" at ${t.at + 1} does not belong there`);
  }

  private call(fn: (typeof FORMULA_FUNCTIONS)[number]): Node {
    this.expect('(', 'a "("');
    const args = [this.expr()];
    while (this.isOp(',')) {
      this.i++;
      args.push(this.expr());
    }
    this.expect(')', 'a ")"');
    const most = fn === 'round' ? 2 : 1;
    if (args.length > most) throw new ParseError(fn === 'round' ? 'round takes a value and at most a number of decimals' : `${fn} takes one value`);
    return { k: 'call', fn, args };
  }
}

/** Parses one formula (the grammar above); never throws on bad input. */
export function parseFormula(text: string): ParsedFormula | { error: string } {
  if (typeof text !== 'string') return { error: 'the formula is no text' };
  if (text.length > FORMULA_LIMITS.length) return { error: `the formula is longer than ${FORMULA_LIMITS.length} characters` };
  try {
    const parser = new Parser(tokenize(text));
    const root = parser.parse();
    return { text, refs: parser.refs, root };
  } catch (error) {
    if (error instanceof ParseError) return { error: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Exact decimals: `n / 10^s`, `s >= 0`
// ---------------------------------------------------------------------------------------------

interface Dec {
  n: bigint;
  s: number;
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
/** Decimals a division is carried to (as `writeBack` in `core/machines/numbers.ts`). */
const DIVISION_SCALE = 24;

function pow10(k: number): bigint {
  let out = ONE;
  for (let i = 0; i < k; i++) out *= TEN;
  return out;
}

function abs(n: bigint): bigint {
  return n < ZERO ? -n : n;
}

/** Drops trailing zeros of the fraction. */
function norm(d: Dec): Dec {
  const { n, s } = d;
  if (s <= 0) return { n, s };
  if (n === ZERO) return { n, s: 0 };
  // Count the trailing zeros once and divide once (a loop of divisions is quadratic in the digits).
  const digits = abs(n).toString();
  let zeros = 0;
  while (zeros < s && digits.charCodeAt(digits.length - 1 - zeros) === 0x30) zeros++;
  return zeros === 0 ? { n, s } : { n: n / pow10(zeros), s: s - zeros };
}

/** `[+-] digits [. digits]` or `[+-] . digits` as an exact decimal, or null. */
function decOf(text: string): Dec | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const frac = m[3] ?? '';
  const n = BigInt(`${m[2] || '0'}${frac}`);
  return norm({ n: m[1] === '-' ? -n : n, s: frac.length });
}

/** Plain decimal text: no exponent, no `+`, no trailing zeros, `0` for zero. */
function decText(d: Dec): string {
  const { n, s } = norm(d);
  const digits = abs(n).toString();
  if (s === 0) return `${n < ZERO ? '-' : ''}${digits}`;
  const padded = digits.padStart(s + 1, '0');
  return `${n < ZERO ? '-' : ''}${padded.slice(0, padded.length - s)}.${padded.slice(padded.length - s)}`;
}

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
}

function add(a: Dec, b: Dec): Dec {
  const [x, y, s] = align(a, b);
  return norm({ n: x + y, s });
}

function sub(a: Dec, b: Dec): Dec {
  const [x, y, s] = align(a, b);
  return norm({ n: x - y, s });
}

function mul(a: Dec, b: Dec): Dec {
  return norm({ n: a.n * b.n, s: a.s + b.s });
}

/** `a / b` carried to `DIVISION_SCALE` decimals, half away from zero; `b` is not zero. */
function div(a: Dec, b: Dec): Dec {
  // a/b = (a.n / 10^a.s) / (b.n / 10^b.s) = a.n * 10^(b.s + S) / (b.n * 10^a.s) / 10^S
  const num = abs(a.n) * pow10(b.s + DIVISION_SCALE);
  const den = abs(b.n) * pow10(a.s);
  let q = num / den;
  if ((num % den) * TWO >= den) q += ONE;
  return norm({ n: a.n < ZERO !== b.n < ZERO ? -q : q, s: DIVISION_SCALE });
}

/** The remainder with the sign of the left side (`a - b * trunc(a / b)`); `b` is not zero. */
function rem(a: Dec, b: Dec): Dec {
  const [x, y, s] = align(a, b);
  return norm({ n: x % y, s });
}

/** Rounded half away from zero to `k` decimals. */
function roundTo(d: Dec, k: number): Dec {
  if (d.s <= k) return d;
  const f = pow10(d.s - k);
  let q = abs(d.n) / f;
  if ((abs(d.n) % f) * TWO >= f) q += ONE;
  return norm({ n: d.n < ZERO ? -q : q, s: k });
}

/** Toward minus infinity (`up` false) or plus infinity (`up` true) to a whole number. */
function wholeTo(d: Dec, up: boolean): Dec {
  if (d.s === 0) return d;
  const f = pow10(d.s);
  let q = d.n / f; // truncates toward zero
  const exact = d.n % f === ZERO;
  if (!exact && up && d.n > ZERO) q += ONE;
  if (!exact && !up && d.n < ZERO) q -= ONE;
  return { n: q, s: 0 };
}

function cmp(a: Dec, b: Dec): number {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

const DEC_ZERO: Dec = { n: ZERO, s: 0 };
const DEC_ONE: Dec = { n: ONE, s: 0 };
const D90: Dec = { n: BigInt(90), s: 0 };
const D180: Dec = { n: BigInt(180), s: 0 };
const D360: Dec = { n: BigInt(360), s: 0 };
const MAGNITUDE = decOf(String(FORMULA_LIMITS.magnitude)) as Dec;

/** A double kept to 15 significant digits, as an exact decimal (null for a non-finite value). */
function fromDouble(x: number): Dec | null {
  if (!Number.isFinite(x)) return null;
  if (x === 0) return DEC_ZERO;
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(x.toExponential(FORMULA_LIMITS.significant - 1));
  if (!m) return null;
  const digits = `${m[2]}${m[3] ?? ''}`;
  const exp = Number(m[4]) - (digits.length - 1);
  const n = BigInt(digits) * (exp > 0 ? pow10(exp) : ONE);
  return norm({ n: m[1] === '-' ? -n : n, s: exp < 0 ? -exp : 0 });
}

function toDouble(d: Dec): number {
  return Number(decText(d));
}

/** 15 significant digits of pi. */
const PI = fromDouble(Math.PI) as Dec;

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

/** Why one formula has no value: a message without the parameter's name (added by the caller). */
class FormulaError extends Error {
  constructor(
    readonly reason: 'divisionByZero' | 'outOfRange' | 'tooLarge' | 'notANumber',
    readonly params: Record<string, string> = {},
  ) {
    super(reason);
  }
}

/** A referenced parameter that is empty: the formula is empty. */
class Empty extends Error {}

/** A formula that reads itself through others (only a template that did not pass the loader). */
class CycleError extends Error {}

/** The angle reduced exactly to 0 ≤ a < 360. */
function reduceAngle(a: Dec): Dec {
  let r = rem(a, D360);
  if (r.n < ZERO) r = add(r, D360);
  return r;
}

/** sin of an angle in degrees, exact at the multiples of 90°. */
function sinDeg(a: Dec): Dec {
  let r = reduceAngle(a);
  let negative = false;
  if (cmp(r, D180) >= 0) {
    r = sub(r, D180);
    negative = true;
  }
  if (cmp(r, D90) > 0) r = sub(D180, r);
  // 0 ≤ r ≤ 90
  let v: Dec;
  if (r.n === ZERO) v = DEC_ZERO;
  else if (cmp(r, D90) === 0) v = DEC_ONE;
  else v = fromDouble(Math.sin((toDouble(r) * Math.PI) / 180)) as Dec;
  return negative ? { n: -v.n, s: v.s } : v;
}

function cosDeg(a: Dec): Dec {
  return sinDeg(add(a, D90));
}

function fn1(fn: string, x: Dec, show: () => string): Dec {
  const out = (v: number): Dec => {
    const d = fromDouble(v);
    if (d === null) throw new FormulaError('outOfRange', { fn, value: show() });
    return d;
  };
  switch (fn) {
    case 'abs':
      return { n: abs(x.n), s: x.s };
    case 'floor':
      return wholeTo(x, false);
    case 'ceil':
      return wholeTo(x, true);
    case 'round':
      return roundTo(x, 0);
    case 'sign':
      return { n: x.n > ZERO ? ONE : x.n < ZERO ? -ONE : ZERO, s: 0 };
    case 'sqrt':
      if (x.n < ZERO) throw new FormulaError('outOfRange', { fn, value: show() });
      return out(Math.sqrt(toDouble(x)));
    case 'ln':
    case 'log':
      if (x.n <= ZERO) throw new FormulaError('outOfRange', { fn, value: show() });
      return out(fn === 'ln' ? Math.log(toDouble(x)) : Math.log10(toDouble(x)));
    case 'sin':
      return sinDeg(x);
    case 'cos':
      return cosDeg(x);
    case 'tan': {
      const c = cosDeg(x);
      if (c.n === ZERO) throw new FormulaError('outOfRange', { fn, value: show() });
      const s = sinDeg(x);
      if (s.n === ZERO) return DEC_ZERO;
      // tan from the reduced angle in double, so 45° is 1 and not 0.9999999999999999.
      const r = reduceAngle(x);
      return out(Math.tan((toDouble(r) * Math.PI) / 180));
    }
    case 'asin':
    case 'acos':
      if (cmp({ n: abs(x.n), s: x.s }, DEC_ONE) > 0) throw new FormulaError('outOfRange', { fn, value: show() });
      return out(((fn === 'asin' ? Math.asin(toDouble(x)) : Math.acos(toDouble(x))) * 180) / Math.PI);
    case 'atan':
      return out((Math.atan(toDouble(x)) * 180) / Math.PI);
    default:
      throw new FormulaError('outOfRange', { fn, value: show() });
  }
}

function evalNode(node: Node, read: (name: string) => Dec): Dec {
  switch (node.k) {
    case 'num':
      return decOf(node.text) as Dec;
    case 'pi':
      return PI;
    case 'ref':
      return read(node.name);
    case 'neg': {
      const a = evalNode(node.a, read);
      return { n: -a.n, s: a.s };
    }
    case 'bin': {
      const a = evalNode(node.a, read);
      const b = evalNode(node.b, read);
      switch (node.op) {
        case '+':
          return add(a, b);
        case '-':
          return sub(a, b);
        case '*':
          return mul(a, b);
        case '/':
          if (b.n === ZERO) throw new FormulaError('divisionByZero');
          return div(a, b);
        case '%':
          if (b.n === ZERO) throw new FormulaError('divisionByZero');
          return rem(a, b);
      }
      break;
    }
    case 'call': {
      const x = evalNode(node.args[0], read);
      const show = (): string => decText(roundTo(x, FORMULA_LIMITS.significant));
      if (node.fn === 'round' && node.args.length === 2) {
        const k = evalNode(node.args[1], read);
        if (k.s !== 0 || k.n < ZERO || k.n > BigInt(6)) throw new FormulaError('outOfRange', { fn: 'round', value: decText(k) });
        return roundTo(x, Number(k.n));
      }
      return fn1(node.fn, x, show);
    }
  }
  throw new FormulaError('outOfRange');
}

/** The decimals a formula's result is rounded to. */
function decimalsOf(p: TemplateParam): number {
  return typeof p.decimals === 'number' ? p.decimals : FORMULA_LIMITS.maxDecimals;
}

/** A typed number is never longer than this: a longer text is no number the control takes (and costs time to read). */
const TYPED_MAX_CHARS = 40;

/** A typed value as an exact decimal; `'empty'` for nothing typed; null for a value that is no number. */
function typedValue(raw: unknown): Dec | 'empty' | null {
  if (raw === undefined || raw === null) return 'empty';
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    // A JS number from a form or a default: its shortest text, without an exponent.
    const text = Math.abs(raw) >= 1e-6 || raw === 0 ? String(raw) : raw.toFixed(20);
    return /e/i.test(text) ? null : decOf(text);
  }
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return 'empty';
  if (text.length > TYPED_MAX_CHARS) return null;
  return decOf(text);
}

function own(values: Record<string, unknown>, id: string): unknown {
  return values !== null && typeof values === 'object' && Object.prototype.hasOwnProperty.call(values, id) ? values[id] : undefined;
}

function msg(reason: string, params: Record<string, string>): Msg {
  return { key: `cycleForm.formula.${reason}`, params };
}

/**
 * The value of every formula parameter of `t` for the typed `values` (decimal text or numbers; a
 * missing or empty value is empty), in dependency order. Pure; never throws on bad input (an
 * error is a `Msg` of the `cycleForm` namespace, `cycleForm.formula.*`, by parameter id).
 */
export function evaluateFormulas(t: TemplateDef, values: Record<string, unknown>): FormulaResult {
  const result: FormulaResult = { values: {}, errors: {} };
  const params = Array.isArray(t?.params) ? t.params : [];
  const byId = new Map<string, TemplateParam>(params.map((p) => [p.id, p]));
  const formulas = params.filter((p) => p.type === 'formula');
  if (formulas.length === 0) return result;

  const parsed = new Map<string, ParsedFormula>();
  for (const p of formulas) {
    const name = p.label || p.id;
    const found = parseFormula(p.formula ?? '');
    if ('error' in found) {
      result.values[p.id] = null;
      result.errors[p.id] = msg('syntax', { name, detail: found.error });
    } else {
      parsed.set(p.id, found);
    }
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const computed = new Map<string, Dec | null>();

  const compute = (p: TemplateParam): Dec | null => {
    if (computed.has(p.id)) return computed.get(p.id) ?? null;
    const name = p.label || p.id;
    const formula = parsed.get(p.id);
    if (!formula) return null; // its syntax error is already recorded
    state.set(p.id, 'visiting');
    let value: Dec | null = null;
    try {
      const read = (ref: string): Dec => {
        const q = byId.get(ref);
        if (q === undefined || !FORMULA_READABLE.includes(q.type)) {
          throw new FormulaError('notANumber', { param: ref });
        }
        if (q.type === 'formula') {
          if (state.get(q.id) === 'visiting') throw new CycleError();
          const v = compute(q);
          if (v === null) throw new Empty();
          return v;
        }
        const typed = typedValue(own(values, ref));
        if (typed === 'empty') throw new Empty();
        if (typed === null) throw new FormulaError('notANumber', { param: q.label || ref });
        return typed;
      };
      const raw = evalNode(formula.root as Node, read);
      if (cmp({ n: abs(raw.n), s: raw.s }, MAGNITUDE) > 0) throw new FormulaError('tooLarge');
      const rounded = roundTo(raw, decimalsOf(p));
      value = rounded.n === ZERO ? DEC_ZERO : rounded;
      result.values[p.id] = decText(value);
    } catch (error) {
      result.values[p.id] = null;
      if (error instanceof Empty) {
        // Empty: its word drops; no error of its own.
      } else if (error instanceof CycleError) {
        result.errors[p.id] = msg('circular', { name });
      } else if (error instanceof FormulaError) {
        result.errors[p.id] = msg(error.reason, { name, ...error.params });
      } else {
        throw error;
      }
      value = null;
    }
    state.set(p.id, 'done');
    computed.set(p.id, value);
    return value;
  };

  for (const p of formulas) compute(p);
  return result;
}
