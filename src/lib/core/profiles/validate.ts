// Profile validation (plan §7.4, AD-11). Owner: WP3.1.
//
// Hand-written on purpose (no ajv, F6: the CSP has no `unsafe-eval`, so a generated
// validator could not run, and the bundle stays free of a new dependency).
//
// What it guarantees to its callers:
//   - Every field the P1 code reads is present and has the type `Profile` promises, so
//     the registry, the tokenizer and the grammar generator never type-guard again.
//   - Unknown fields are kept. A profile written for a later phase (`onSave`, `colors`,
//     `extends`, …) still loads here, and a round trip through the app leaves it intact.
//   - Every problem is reported with the JSON path of the field it belongs to
//     (`outline[2].pattern`), because the fix is in the file, not in the app.
//   - Every pattern compiles **and** stays inside the AD-11 subset, so `gedit_nc.py`
//     (§7.10) can compile the same profile with Python's `re` after the mechanical
//     `(?<name>` → `(?P<name>` rename.
//
// It collects every problem instead of stopping at the first one, so the settings UI can
// show a profile's full error list in one go.
//
// It never throws and never mutates `raw`; the returned profile is the very object that
// was passed in.

import type { Eol } from '$lib/app/types';
import type { OutlineKind, Profile, ProfileValidation } from './types';

/** An extension as it may be written in a profile: lower case, no dot, no separator. */
const EXTENSION = /^[a-z0-9][a-z0-9_+-]*$/;

/** An address or keyword-like name: a letter, then letters and digits (`X`, `FMAX`, `GOTO`). */
const ADDRESS = /^[A-Za-z][A-Za-z0-9]*$/;

/** A profile id is also a Monaco language id, so it stays plain. */
const PROFILE_ID = /^[a-z0-9][a-z0-9._-]*$/;

const EOLS: readonly Eol[] = ['crlf', 'lf', 'cr'];

const OUTLINE_KINDS: readonly OutlineKind[] = [
  'tool',
  'program',
  'section',
  'comment',
  'label',
  'stop',
  'end',
  'subprogram-call',
];

// ---------------------------------------------------------------------------
// The AD-11 pattern subset
// ---------------------------------------------------------------------------

/**
 * Reports why `pattern` leaves the common subset of ECMAScript and Python `re`, or
 * `null` when it stays inside it (AD-11). The rules:
 *
 *   - no Unicode property escape (`\p{…}`, `\P{…}`): Python has no equivalent;
 *   - no named back-reference (`\k<name>`): Python spells it `(?P=name)`;
 *   - no variable-width lookbehind: Python only accepts a fixed width, so `*`, `+`,
 *     a non-group `?`, `{n,}`/`{n,m}` and `|` are rejected inside `(?<=…)` / `(?<!…)`.
 *
 * Whether the pattern compiles at all is a separate question, answered by `new RegExp`.
 * This scan is also what the P2 pattern tester shows next to the field.
 */
export function patternSubsetProblem(pattern: string): string | null {
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];

    if (c === '\\') {
      const next = pattern[i + 1] ?? '';
      if (next === 'p' || next === 'P') return 'a Unicode property escape (\\p{…}) has no Python equivalent';
      if (next === 'k' && pattern[i + 2] === '<') return 'a named back-reference (\\k<…>) has no Python equivalent';
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '(' && (pattern.startsWith('(?<=', i) || pattern.startsWith('(?<!', i))) {
      const end = closingParen(pattern, i);
      const body = pattern.slice(i + 4, end === -1 ? pattern.length : end);
      const problem = variableWidth(body);
      if (problem !== null) return `a lookbehind must be fixed width (${problem})`;
      // The scan continues inside the body, so an escape it does not know about
      // (`\p{…}`, `\k<…>`) is still caught.
    }
  }
  return null;
}

/** Index of the `)` that closes the group opening at `open`, or -1 when there is none. */
function closingParen(pattern: string, open: number): number {
  let depth = 0;
  let inClass = false;
  for (let i = open; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Names the first construct in a lookbehind body that can match more than one width. */
function variableWidth(body: string): string | null {
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === '*' || c === '+') return `\`${c}\` repeats`;
    else if (c === '|') return '`|` may take branches of different length';
    else if (c === '?' && body[i - 1] !== '(') return '`?` makes a part optional';
    else if (c === '{') {
      const end = body.indexOf('}', i);
      const inner = end === -1 ? body.slice(i + 1) : body.slice(i + 1, end);
      if (!/^\d+$/.test(inner)) return '`{n,m}` repeats a variable number of times';
      i = end === -1 ? body.length : end;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Problem collection and field checks
// ---------------------------------------------------------------------------

/** The problems found so far, each one prefixed with the JSON path of its field. */
class Problems {
  readonly list: string[] = [];

  add(path: string, message: string): void {
    this.list.push(`${path}: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A present, plain object, or `null` plus a problem. */
function obj(value: unknown, path: string, p: Problems): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  p.add(path, value === undefined ? 'is required' : 'has to be an object');
  return null;
}

/** An optional plain object: absent is fine, a non-object is not. */
function optObj(value: unknown, path: string, p: Problems): Record<string, unknown> | null {
  return value === undefined ? null : obj(value, path, p);
}

function str(value: unknown, path: string, p: Problems, allow?: RegExp): string | null {
  if (typeof value !== 'string' || value === '') {
    p.add(path, value === undefined ? 'is required' : 'has to be a non-empty string');
    return null;
  }
  if (allow && !allow.test(value)) {
    p.add(path, `"${value}" does not match ${String(allow)}`);
    return null;
  }
  return value;
}

function optStr(value: unknown, path: string, p: Problems, allow?: RegExp): void {
  if (value !== undefined) str(value, path, p, allow);
}

function enumOf<T extends string>(value: unknown, path: string, p: Problems, values: readonly T[]): T | null {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  p.add(path, `has to be one of ${values.map((v) => `"${v}"`).join(', ')}`);
  return null;
}

function optEnum<T extends string>(value: unknown, path: string, p: Problems, values: readonly T[]): void {
  if (value !== undefined) enumOf(value, path, p, values);
}

function bool(value: unknown, path: string, p: Problems): void {
  if (typeof value !== 'boolean') p.add(path, value === undefined ? 'is required' : 'has to be true or false');
}

function optBool(value: unknown, path: string, p: Problems): void {
  if (value !== undefined) bool(value, path, p);
}

function num(value: unknown, path: string, p: Problems, o: { int?: boolean; min?: number; max?: number } = {}): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    p.add(path, value === undefined ? 'is required' : 'has to be a number');
    return;
  }
  if (o.int && !Number.isInteger(value)) p.add(path, 'has to be a whole number');
  if (o.min !== undefined && value < o.min) p.add(path, `has to be at least ${o.min}`);
  if (o.max !== undefined && value > o.max) p.add(path, `has to be at most ${o.max}`);
}

function optNum(value: unknown, path: string, p: Problems, o: { int?: boolean; min?: number; max?: number } = {}): void {
  if (value !== undefined) num(value, path, p, o);
}

/** A present array, or `null` plus a problem. `min` is the smallest useful length. */
function arr(value: unknown, path: string, p: Problems, min = 0): unknown[] | null {
  if (!Array.isArray(value)) {
    p.add(path, value === undefined ? 'is required' : 'has to be an array');
    return null;
  }
  if (value.length < min) {
    p.add(path, `has to list at least ${min} ${min === 1 ? 'entry' : 'entries'}`);
    return null;
  }
  return value;
}

function strArr(value: unknown, path: string, p: Problems, o: { min?: number; allow?: RegExp } = {}): void {
  const list = arr(value, path, p, o.min ?? 0);
  if (!list) return;
  list.forEach((entry, i) => str(entry, `${path}[${i}]`, p, o.allow));
}

function optStrArr(value: unknown, path: string, p: Problems, o: { min?: number; allow?: RegExp } = {}): void {
  if (value !== undefined) strArr(value, path, p, o);
}

/** A required pattern: a string that compiles and stays inside the AD-11 subset. */
function pattern(value: unknown, path: string, p: Problems): void {
  const source = str(value, path, p);
  if (source === null) return;
  try {
    new RegExp(source);
  } catch (error) {
    p.add(path, error instanceof Error ? error.message : String(error));
    return;
  }
  const problem = patternSubsetProblem(source);
  if (problem !== null) p.add(path, problem);
}

function optPattern(value: unknown, path: string, p: Problems): void {
  if (value !== undefined) pattern(value, path, p);
}

function patternList(value: unknown, path: string, p: Problems): void {
  const list = arr(value, path, p);
  if (!list) return;
  list.forEach((entry, i) => pattern(entry, `${path}[${i}]`, p));
}

// ---------------------------------------------------------------------------
// The sections
// ---------------------------------------------------------------------------

function checkFiles(value: unknown, p: Problems): void {
  const files = obj(value, 'files', p);
  if (!files) return;
  strArr(files.extensions, 'files.extensions', p, { min: 1, allow: EXTENSION });
  const preferred = str(files.defaultExtension, 'files.defaultExtension', p, EXTENSION);
  if (preferred !== null && Array.isArray(files.extensions) && !files.extensions.includes(preferred)) {
    p.add('files.defaultExtension', `"${preferred}" is not in files.extensions`);
  }
  str(files.filterName, 'files.filterName', p);
  // P1 never rewrites a file it opened: both are `keep` until the P2 `onSave` block.
  enumOf(files.encoding, 'files.encoding', p, ['keep'] as const);
  enumOf(files.lineEnding, 'files.lineEnding', p, ['keep'] as const);
  enumOf(files.newFileLineEnding, 'files.newFileLineEnding', p, EOLS);
}

function checkDetect(value: unknown, p: Problems): void {
  const detect = obj(value, 'detect', p);
  if (!detect) return;

  const extensions = obj(detect.extensions, 'detect.extensions', p);
  if (extensions) {
    for (const [ext, weight] of Object.entries(extensions)) {
      if (!EXTENSION.test(ext)) p.add(`detect.extensions.${ext}`, 'has to be a lower-case extension without a dot');
      num(weight, `detect.extensions.${ext}`, p, { min: 0 });
    }
  }

  const content = arr(detect.content, 'detect.content', p);
  if (content) {
    content.forEach((entry, i) => {
      const rule = obj(entry, `detect.content[${i}]`, p);
      if (!rule) return;
      pattern(rule.pattern, `detect.content[${i}].pattern`, p);
      num(rule.weight, `detect.content[${i}].weight`, p, { min: 0 });
    });
  }

  optStrArr(detect.folders, 'detect.folders', p);
  optNum(detect.priority, 'detect.priority', p);
}

function checkSyntax(value: unknown, p: Problems): void {
  const syntax = obj(value, 'syntax', p);
  if (!syntax) return;

  optBool(syntax.caseSensitive, 'syntax.caseSensitive', p);

  const comments = arr(syntax.comments, 'syntax.comments', p, 1);
  if (comments) {
    comments.forEach((entry, i) => {
      const comment = obj(entry, `syntax.comments[${i}]`, p);
      if (!comment) return;
      str(comment.start, `syntax.comments[${i}].start`, p);
      // `null` is the line comment that runs to the end of the line.
      if (comment.end !== null) str(comment.end, `syntax.comments[${i}].end`, p);
    });
  }

  optBool(syntax.strings, 'syntax.strings', p);
  optPattern(syntax.sectionHeading, 'syntax.sectionHeading', p);
  optPattern(syntax.continuation, 'syntax.continuation', p);
  optStr(syntax.continuationMark, 'syntax.continuationMark', p);
  optPattern(syntax.variables, 'syntax.variables', p);

  const blockSkip = optObj(syntax.blockSkip, 'syntax.blockSkip', p);
  if (blockSkip) {
    str(blockSkip.chars, 'syntax.blockSkip.chars', p);
    enumOf(blockSkip.position, 'syntax.blockSkip.position', p, ['before-number', 'after-number', 'either'] as const);
    optBool(blockSkip.levels, 'syntax.blockSkip.levels', p);
  }

  const blockNumber = obj(syntax.blockNumber, 'syntax.blockNumber', p);
  if (blockNumber) {
    const mode = enumOf(blockNumber.mode, 'syntax.blockNumber.mode', p, ['prefix', 'leading-integer'] as const);
    if (mode === 'prefix') str(blockNumber.prefix, 'syntax.blockNumber.prefix', p, ADDRESS);
    else optStr(blockNumber.prefix, 'syntax.blockNumber.prefix', p, ADDRESS);
    optStrArr(blockNumber.altPrefixes, 'syntax.blockNumber.altPrefixes', p, { allow: ADDRESS });
    bool(blockNumber.mandatory, 'syntax.blockNumber.mandatory', p);
  }

  enumOf(syntax.decimalSeparator, 'syntax.decimalSeparator', p, ['.', ','] as const);
  bool(syntax.decimalPointSignificant, 'syntax.decimalPointSignificant', p);
  bool(syntax.wordSeparatorRequired, 'syntax.wordSeparatorRequired', p);
  optStr(syntax.incrementalPrefix, 'syntax.incrementalPrefix', p, ADDRESS);
  optStrArr(syntax.keywords, 'syntax.keywords', p);
  optNum(syntax.maxLineLength, 'syntax.maxLineLength', p, { int: true, min: 1 });
}

function checkAddresses(value: unknown, p: Problems): void {
  const addresses = obj(value, 'addresses', p);
  if (!addresses) return;
  for (const key of ['tool', 'feed', 'rapid', 'spindle'] as const) {
    optStr(addresses[key], `addresses.${key}`, p, ADDRESS);
  }
  strArr(addresses.axes, 'addresses.axes', p, { min: 1, allow: ADDRESS });
  optStrArr(addresses.arcCenter, 'addresses.arcCenter', p, { allow: ADDRESS });
  optEnum(addresses.arcCenterMode, 'addresses.arcCenterMode', p, ['incremental', 'absolute'] as const);
}

function checkToolCall(value: unknown, p: Problems): void {
  const toolCall = obj(value, 'toolCall', p);
  if (!toolCall) return;
  pattern(toolCall.trigger, 'toolCall.trigger', p);
  pattern(toolCall.tool, 'toolCall.tool', p);
  // The program map and the tool list read the number out of the named group.
  if (typeof toolCall.tool === 'string' && !toolCall.tool.includes('(?<tool>')) {
    p.add('toolCall.tool', 'has to carry the named group (?<tool>…)');
  }
  enumOf(toolCall.toolFrom, 'toolCall.toolFrom', p, ['same-line', 'same-line-or-last'] as const);
}

function checkOutline(value: unknown, p: Problems): void {
  const outline = arr(value, 'outline', p);
  if (!outline) return;
  outline.forEach((entry, i) => {
    const rule = obj(entry, `outline[${i}]`, p);
    if (!rule) return;
    enumOf(rule.kind, `outline[${i}].kind`, p, OUTLINE_KINDS);
    pattern(rule.pattern, `outline[${i}].pattern`, p);
  });
}

function checkNumbering(value: unknown, p: Problems): void {
  const numbering = obj(value, 'numbering', p);
  if (!numbering) return;
  optEnum(numbering.mode, 'numbering.mode', p, ['free', 'consecutive'] as const);
  num(numbering.start, 'numbering.start', p, { int: true, min: 0 });
  num(numbering.step, 'numbering.step', p, { int: true, min: 1 });
  optNum(numbering.digits, 'numbering.digits', p, { int: true, min: 0, max: 12 });
  optNum(numbering.max, 'numbering.max', p, { int: true, min: 1 });
  optEnum(numbering.onOverflow, 'numbering.onOverflow', p, ['wrap', 'stop'] as const);
  optNum(numbering.spacesAfter, 'numbering.spacesAfter', p, { int: true, min: 0, max: 16 });
  optStrArr(numbering.skipStartingWith, 'numbering.skipStartingWith', p);
  optBool(numbering.skipEmpty, 'numbering.skipEmpty', p);
  optBool(numbering.restartAtProgramStart, 'numbering.restartAtProgramStart', p);
  optBool(numbering.onlyNumbered, 'numbering.onlyNumbered', p);

  if (numbering.references !== undefined) {
    const references = arr(numbering.references, 'numbering.references', p);
    references?.forEach((entry, i) => {
      const rule = obj(entry, `numbering.references[${i}]`, p);
      if (!rule) return;
      pattern(rule.trigger, `numbering.references[${i}].trigger`, p);
      strArr(rule.addresses, `numbering.references[${i}].addresses`, p, { min: 1, allow: ADDRESS });
    });
  }
}

function checkNumberFormat(value: unknown, p: Problems): void {
  const fmt = optObj(value, 'numberFormat', p);
  if (!fmt) return;
  if (fmt.decimals !== 'keep') num(fmt.decimals, 'numberFormat.decimals', p, { int: true, min: 0, max: 9 });
  enumOf(fmt.trailingZeros, 'numberFormat.trailingZeros', p, ['keep', 'drop'] as const);
  bool(fmt.keepPoint, 'numberFormat.keepPoint', p);
  enumOf(fmt.plusSign, 'numberFormat.plusSign', p, ['keep', 'always', 'never'] as const);
}

function checkToolList(value: unknown, p: Problems): void {
  const toolList = optObj(value, 'toolList', p);
  if (!toolList) return;
  enumOf(toolList.description, 'toolList.description', p, ['auto', 'above', 'below', 'trailing'] as const);
  optPattern(toolList.commentFilter, 'toolList.commentFilter', p);
  optBool(toolList.dropLeadingZeros, 'toolList.dropLeadingZeros', p);
  optBool(toolList.collapseOffsetDigits, 'toolList.collapseOffsetDigits', p);
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Checks `raw` against the P1 profile schema (§7.4).
 *
 * On success the returned `profile` is `raw` itself, unknown fields included; on failure
 * every problem is listed as `<json.path>: <what is wrong>`. Never throws.
 */
export function validateProfile(raw: unknown): ProfileValidation {
  const p = new Problems();
  const root = obj(raw, '(profile)', p);
  if (!root) return { ok: false, errors: p.list };

  str(root.id, 'id', p, PROFILE_ID);
  str(root.name, 'name', p);
  str(root.shortName, 'shortName', p);
  num(root.version, 'version', p, { int: true, min: 1 });
  enumOf(root.grammar, 'grammar', p, ['iso', 'klartext'] as const);
  str(root.codes, 'codes', p, PROFILE_ID);

  checkFiles(root.files, p);
  checkDetect(root.detect, p);
  checkSyntax(root.syntax, p);
  checkAddresses(root.addresses, p);
  checkToolCall(root.toolCall, p);

  const program = obj(root.program, 'program', p);
  if (program) {
    patternList(program.start, 'program.start', p);
    patternList(program.end, 'program.end', p);
  }

  checkOutline(root.outline, p);
  checkNumbering(root.numbering, p);
  checkNumberFormat(root.numberFormat, p);

  const onLoad = optObj(root.onLoad, 'onLoad', p);
  if (onLoad) optBool(onLoad.stripNul, 'onLoad.stripNul', p);

  checkToolList(root.toolList, p);

  return p.list.length === 0 ? { ok: true, profile: raw as Profile } : { ok: false, errors: p.list };
}
