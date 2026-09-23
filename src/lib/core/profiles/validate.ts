// Profile validation (plan §7.4, §7.1, AD-11, AD-31). Owner: WP3.1, and WP6.1 for the
// M6 fields.
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
//
// M6 (WP6.1) adds the machine side (§7.1, §7.15, AD-31). Two things about it are worth
// knowing before reading the code:
//
//   - **A profile is checked twice, in two different roles.** The registry checks it as it
//     was *written* (built-in JSON, a user file, both after `extends` was merged), and
//     again after `applyMachine` has written a machine's parameters into it. The second
//     run passes `applied: true`, because three fields are then legitimately there that a
//     profile file may not carry itself (`modal.units`, `modal.diameter`, `modal.sources`,
//     all computed, AD-31) and because `syntax.decimalPointSignificant` then follows the
//     **machine's** number input and not the profile's default preset any more.
//   - **Two checks need the code databases** (a variant's `codes` names one, and
//     `machineParams.modalGroups` names groups of the profile's own). Neither is knowable
//     from the profile alone, so both are optional: the caller that has the databases in
//     hand passes them, and a caller that does not simply does not get those two checks.

import { normalizeCode } from '$lib/core/codes/lookup';
import type { Eol } from '$lib/app/types';
import type { NumberClass, NumberReading, ParamSource } from '$lib/core/machines/types';
import type { OutlineKind, Profile, ProfileValidation } from './types';

/** What `validateProfile` cannot see in the profile itself (see the header). */
export interface ProfileValidationOptions {
  /**
   * The profile has been through `applyMachine` (AD-31), so the computed `modal` fields
   * belong there and the decimal-point rule is the machine's, not the default preset's.
   */
  applied?: boolean;
  /** Dialect ids that resolve; a variant choice's `codes` has to name one of them. */
  codeDbs?: readonly string[];
  /** The modal group names of the profile's own database; `machineParams.modalGroups` names these. */
  modalGroups?: readonly string[];
}

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

/** The feed units a word may switch to by itself (`addresses.feedUnitWords`, §7.1). */
const FEED_UNITS = ['per-minute', 'per-rev', 'per-tooth', 'inverse-time'] as const;

/** Where an applied parameter came from (§7.15). */
const PARAM_SOURCES: readonly ParamSource[] = ['machine', 'detected', 'profile'];

/** How a control reads a numeric literal (§7.15). */
const READINGS: readonly NumberReading[] = ['increment', 'calculator', 'scale'];

/** The number classes a `NumberInput` may describe (§7.15). */
const NUMBER_CLASSES: readonly NumberClass[] = ['length', 'angle', 'feedPerMin', 'feedPerRev', 'dwell'];

/**
 * The classes that follow the program's units, and therefore have an inch increment.
 *
 * `angle` is degrees and `dwell` is seconds in a metric and in an inch program alike
 * (§7.15), so an inch increment on either is a mistake in the data, not a setting: it
 * would be read by nothing and hide the fact that the author expected a conversion.
 */
const UNIT_CLASSES: readonly NumberClass[] = ['length', 'feedPerMin', 'feedPerRev'];

/** A number-input preset id (`is-b`, `okuma-10um`): plain, because it is a stored key. */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

/** A variant id (`gcodeSystem`): a member name of a machine's `params.variants`. */
const VARIANT_ID = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * A least input increment, or the value of "1" in a scaling unit system: decimal text
 * that is a power of ten no larger than one (`1`, `0.1`, `0.001`, `0.00001`).
 *
 * Text, not a number: `0.0001` as a JSON number is a binary float, and the value ends up
 * in a `Decimal` multiplication that decides where a tool goes (F52).
 */
const INCREMENT = /^(?:1|0\.0*1)$/;

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

  // M6 (§7.1). `incremental` says which axis an incremental address moves, so its value
  // has to be one of the axes: `{ U: 'X' }` is what makes `U2.` a step along X, and a typo
  // there would move the wrong axis in every extent and every arithmetic answer.
  const axes = Array.isArray(addresses.axes) ? addresses.axes : [];
  const incremental = optObj(addresses.incremental, 'addresses.incremental', p);
  if (incremental) {
    for (const [word, axis] of Object.entries(incremental)) {
      const at = `addresses.incremental.${word}`;
      if (!ADDRESS.test(word)) p.add(at, 'has to be an address letter');
      const target = str(axis, at, p, ADDRESS);
      if (target !== null && axes.length > 0 && !axes.includes(target)) {
        p.add(at, `"${target}" is not in addresses.axes`);
      }
    }
  }
  optStrArr(addresses.diameter, 'addresses.diameter', p, { allow: ADDRESS });
  optStrArr(addresses.angular, 'addresses.angular', p, { allow: ADDRESS });

  const feedUnitWords = optObj(addresses.feedUnitWords, 'addresses.feedUnitWords', p);
  if (feedUnitWords) {
    for (const [word, unit] of Object.entries(feedUnitWords)) {
      const at = `addresses.feedUnitWords.${word}`;
      if (!ADDRESS.test(word)) p.add(at, 'has to be an address or a keyword');
      enumOf(unit, at, p, FEED_UNITS);
    }
  }
}

/**
 * `modal` (§7.1, AD-19 rule 8, AD-31).
 *
 * `initial` is the power-on state a profile documents. `units`, `diameter` and `sources`
 * are **computed**: `applyMachine` writes them from the document's machine, and a profile
 * file that carries them would state as a fact of the dialect what is a setting of one
 * machine (AD-31). They are therefore accepted on the way in — the applied profile goes
 * through this same validator — and reported when a profile file itself carries one.
 */
function checkModal(value: unknown, p: Problems, o: ProfileValidationOptions): void {
  const modal = optObj(value, 'modal', p);
  if (!modal) return;

  const initial = optObj(modal.initial, 'modal.initial', p);
  if (initial) {
    for (const [group, code] of Object.entries(initial)) {
      checkModalCode(group, code, 'modal.initial', p);
    }
  }

  optEnum(modal.units, 'modal.units', p, ['mm', 'inch'] as const);
  optEnum(modal.diameter, 'modal.diameter', p, ['on', 'off'] as const);
  const sources = optObj(modal.sources, 'modal.sources', p);
  if (sources) {
    for (const [key, source] of Object.entries(sources)) {
      enumOf(source, `modal.sources.${key}`, p, PARAM_SOURCES);
    }
  }

  if (o.applied) return;
  for (const field of ['units', 'diameter', 'sources'] as const) {
    if (modal[field] !== undefined) {
      p.add(
        `modal.${field}`,
        'is written by the document\'s machine, not by a profile (use machineParams instead)',
      );
    }
  }
}

/** One `<group>: <code>` of a power-on state, wherever it is written. */
function checkModalCode(group: string, code: unknown, path: string, p: Problems): void {
  const at = `${path}.${group}`;
  if (group.trim() === '') p.add(at, 'a modal group needs a name');
  const written = str(code, at, p);
  if (written === null) return;
  // The interpreter matches this against the database's canonical codes, so a padded or
  // lower-case spelling would silently match nothing and leave the group unset.
  const canonical = normalizeCode(written);
  if (canonical !== written) p.add(at, `has to be written as "${canonical}"`);
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
  // M6 (§7.1): a trigger line whose masked text also matches this is not a tool change.
  optPattern(toolCall.ignore, 'toolCall.ignore', p);
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
      // M6 (§7.1, F42): `false` means "report, do not rewrite" — a Fanuc `M99 P` may name
      // a block in the caller, which a renumber of this file cannot see.
      optBool(rule.rewrite, `numbering.references[${i}].rewrite`, p);
    });
  }
}

// ---------------------------------------------------------------------------
// The machine-parameter declaration (M6, §7.1, §7.15, §8.8, AD-31)
// ---------------------------------------------------------------------------

/** A `NumberInput`, wherever it is written: a preset's value, or a stored machine's own. */
function checkNumberInput(value: unknown, path: string, p: Problems): void {
  const input = obj(value, path, p);
  if (!input) return;

  enumOf(input.mode, `${path}.mode`, p, READINGS);
  increment(input.incrementMm, `${path}.incrementMm`, p, true);
  increment(input.incrementInch, `${path}.incrementInch`, p);
  increment(input.incrementDeg, `${path}.incrementDeg`, p);
  increment(input.incrementSec, `${path}.incrementSec`, p);

  const classes = optObj(input.classes, `${path}.classes`, p);
  if (!classes) return;
  for (const [name, spec] of Object.entries(classes)) {
    const at = `${path}.classes.${name}`;
    if (!(NUMBER_CLASSES as readonly string[]).includes(name)) {
      p.add(at, `"${name}" is not a number class (${NUMBER_CLASSES.join(', ')})`);
      continue;
    }
    const entry = obj(spec, at, p);
    if (!entry) continue;
    if (entry.mode !== undefined) enumOf(entry.mode, `${at}.mode`, p, READINGS);
    increment(entry.increment, `${at}.increment`, p);
    if (entry.incrementInch !== undefined && !(UNIT_CLASSES as readonly string[]).includes(name)) {
      p.add(`${at}.incrementInch`, `the ${name} class does not follow the program's units`);
    } else {
      increment(entry.incrementInch, `${at}.incrementInch`, p);
    }
  }
}

/** A least increment: decimal text, a power of ten no larger than one. */
function increment(value: unknown, path: string, p: Problems, required = false): void {
  if (value === undefined) {
    if (required) p.add(path, 'is required');
    return;
  }
  const text = str(value, path, p);
  if (text !== null && !INCREMENT.test(text)) {
    p.add(path, 'has to be decimal text such as "0.001" or "1"');
  }
}

/**
 * A variant overlay (§7.1): a partial profile, limited to the four members a variant may
 * change. The limit is the point — a G-code system decides the power-on state, the tool
 * rule, the numbering and the addresses, and nothing else. It is checked here and again in
 * `applyMachine`, which drops anything else before it merges.
 *
 * The merge result goes through this validator in full when the variant is chosen, so this
 * pass only checks what would otherwise first fail on the user's document: the members it
 * may set, its power-on codes, and that its patterns compile.
 */
function checkOverlay(value: unknown, path: string, p: Problems): void {
  const overlay = optObj(value, path, p);
  if (!overlay) return;

  for (const key of Object.keys(overlay)) {
    if (key !== 'modal' && key !== 'toolCall' && key !== 'numbering' && key !== 'addresses') {
      p.add(`${path}.${key}`, 'an overlay may only set modal, toolCall, numbering and addresses');
    }
  }

  const modal = optObj(overlay.modal, `${path}.modal`, p);
  const initial = modal === null ? null : optObj(modal.initial, `${path}.modal.initial`, p);
  if (initial) {
    for (const [group, code] of Object.entries(initial)) {
      checkModalCode(group, code, `${path}.modal.initial`, p);
    }
  }

  const toolCall = optObj(overlay.toolCall, `${path}.toolCall`, p);
  if (toolCall) {
    for (const key of ['trigger', 'tool', 'ignore'] as const) {
      optPattern(toolCall[key], `${path}.toolCall.${key}`, p);
    }
  }

  const numbering = optObj(overlay.numbering, `${path}.numbering`, p);
  const references = numbering?.references;
  if (Array.isArray(references)) {
    references.forEach((entry, i) => {
      if (isRecord(entry)) optPattern(entry.trigger, `${path}.numbering.references[${i}].trigger`, p);
    });
  }
}

/** One `machineParams.variants` entry (§7.15): the choices, their databases and their rules. */
function checkVariant(value: unknown, path: string, p: Problems, o: ProfileValidationOptions): void {
  const variant = obj(value, path, p);
  if (!variant) return;

  str(variant.id, `${path}.id`, p, VARIANT_ID);
  str(variant.label, `${path}.label`, p);

  const choices = arr(variant.choices, `${path}.choices`, p, 1);
  const values = new Set<string>();
  choices?.forEach((entry, i) => {
    const at = `${path}.choices[${i}]`;
    const choice = obj(entry, at, p);
    if (!choice) return;
    const value = str(choice.value, `${at}.value`, p);
    if (value !== null) {
      if (values.has(value)) p.add(`${at}.value`, `"${value}" is already taken`);
      values.add(value);
    }
    str(choice.label, `${at}.label`, p);

    if (choice.codes !== undefined) {
      const dialect = str(choice.codes, `${at}.codes`, p, PROFILE_ID);
      if (dialect !== null && o.codeDbs !== undefined && !o.codeDbs.includes(dialect)) {
        p.add(`${at}.codes`, `the code database "${dialect}" was not found`);
      }
    }
    checkOverlay(choice.overlay, `${at}.overlay`, p);

    if (choice.detect !== undefined) {
      const rules = arr(choice.detect, `${at}.detect`, p);
      rules?.forEach((raw, j) => {
        const rule = obj(raw, `${at}.detect[${j}]`, p);
        if (!rule) return;
        pattern(rule.pattern, `${at}.detect[${j}].pattern`, p);
        num(rule.weight, `${at}.detect[${j}].weight`, p, { min: 0 });
      });
    }
  });

  const fallback = str(variant.default, `${path}.default`, p);
  if (fallback !== null && choices !== null && !values.has(fallback)) {
    p.add(`${path}.default`, `"${fallback}" is not one of the choices`);
  }
}

/**
 * `machineParams` (§7.1, §8.8): what a machine configuration of this profile may set.
 *
 * Everything here is **data about a documented default**, never a fact about anybody's
 * machine (AD-31), which is why the checks are strict about the two things a reader cannot
 * see: that the presets can be told apart by id, and that the profile's own
 * `syntax.decimalPointSignificant` says the same as its default preset. The second one is
 * what makes "no machine" behave exactly like Phase 1 — the JSON and the default reading
 * of a number are then one statement, not two that may drift.
 */
function checkMachineParams(root: Record<string, unknown>, p: Problems, o: ProfileValidationOptions): void {
  const decl = optObj(root.machineParams, 'machineParams', p);
  if (!decl) return;

  optEnum(decl.units, 'machineParams.units', p, ['mm', 'inch'] as const);
  optEnum(decl.diameter, 'machineParams.diameter', p, ['on', 'off'] as const);

  const groups = decl.modalGroups;
  if (groups !== undefined) {
    strArr(groups, 'machineParams.modalGroups', p);
    if (Array.isArray(groups) && o.modalGroups !== undefined) {
      groups.forEach((group, i) => {
        if (typeof group === 'string' && !o.modalGroups?.includes(group)) {
          p.add(`machineParams.modalGroups[${i}]`, `"${group}" is not a modal group of this profile's codes`);
        }
      });
    }
  }

  const variants = decl.variants;
  if (variants !== undefined) {
    const list = arr(variants, 'machineParams.variants', p);
    const ids = new Set<string>();
    list?.forEach((entry, i) => {
      checkVariant(entry, `machineParams.variants[${i}]`, p, o);
      const id = isRecord(entry) && typeof entry.id === 'string' ? entry.id : null;
      if (id === null) return;
      if (ids.has(id)) p.add(`machineParams.variants[${i}].id`, `"${id}" is already taken`);
      ids.add(id);
    });
  }

  const numberInput = optObj(decl.numberInput, 'machineParams.numberInput', p);
  if (!numberInput) return;

  const presets = arr(numberInput.presets, 'machineParams.numberInput.presets', p, 1);
  const ids = new Set<string>();
  let defaultValue: unknown;
  presets?.forEach((entry, i) => {
    const at = `machineParams.numberInput.presets[${i}]`;
    const preset = obj(entry, at, p);
    if (!preset) return;
    const id = str(preset.id, `${at}.id`, p, PRESET_ID);
    if (id !== null) {
      if (ids.has(id)) p.add(`${at}.id`, `"${id}" is already taken`);
      ids.add(id);
      if (id === numberInput.default) defaultValue = preset.value;
    }
    // The label is what the user picks by, so it says what the control does to a number.
    str(preset.label, `${at}.label`, p);
    optStr(preset.source, `${at}.source`, p);
    optBool(preset.verify, `${at}.verify`, p);
    checkNumberInput(preset.value, `${at}.value`, p);
  });

  const fallback = str(numberInput.default, 'machineParams.numberInput.default', p);
  if (fallback !== null && presets !== null && !ids.has(fallback)) {
    p.add('machineParams.numberInput.default', `"${fallback}" is not one of the presets`);
    return;
  }
  if (o.applied || !isRecord(defaultValue)) return;

  // "No machine" has to mean what the JSON says (X10): a point-less word is a count of
  // increments exactly where the default preset reads it as one.
  const classes = isRecord(defaultValue.classes) ? defaultValue.classes : {};
  const length = isRecord(classes.length) ? classes.length : {};
  const mode = typeof length.mode === 'string' ? length.mode : defaultValue.mode;
  const significant = mode === 'increment';
  const syntax = isRecord(root.syntax) ? root.syntax : {};
  if (typeof syntax.decimalPointSignificant === 'boolean' && syntax.decimalPointSignificant !== significant) {
    p.add(
      'syntax.decimalPointSignificant',
      `has to be ${significant} for the default number input "${String(numberInput.default)}", which reads a length ${
        significant ? 'in increments' : 'as written'
      }`,
    );
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
 * Checks `raw` against the profile schema (§7.4 and the M6 fields of §7.1).
 *
 * On success the returned `profile` is `raw` itself, unknown fields included; on failure
 * every problem is listed as `<json.path>: <what is wrong>`. Never throws.
 *
 * `o` carries what the profile cannot say about itself; see [`ProfileValidationOptions`].
 */
export function validateProfile(raw: unknown, o: ProfileValidationOptions = {}): ProfileValidation {
  const p = new Problems();
  const root = obj(raw, '(profile)', p);
  if (!root) return { ok: false, errors: p.list };

  str(root.id, 'id', p, PROFILE_ID);
  str(root.name, 'name', p);
  str(root.shortName, 'shortName', p);
  num(root.version, 'version', p, { int: true, min: 1 });
  enumOf(root.grammar, 'grammar', p, ['iso', 'klartext'] as const);
  str(root.codes, 'codes', p, PROFILE_ID);
  optStr(root.extends, 'extends', p, PROFILE_ID);
  optEnum(root.machineType, 'machineType', p, ['mill', 'lathe'] as const);

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
  checkModal(root.modal, p, o);
  checkMachineParams(root, p, o);

  const onLoad = optObj(root.onLoad, 'onLoad', p);
  if (onLoad) optBool(onLoad.stripNul, 'onLoad.stripNul', p);

  checkToolList(root.toolList, p);

  return p.list.length === 0 ? { ok: true, profile: raw as Profile } : { ok: false, errors: p.list };
}
