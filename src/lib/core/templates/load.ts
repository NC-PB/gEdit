// The template file format (Phase 3 plan §6.11). Built by P3.4
// (the formula check it calls belongs to P3.8, `formula.ts`).
//
// `templates` is an array member of a code database file: `src/lib/data/codes/<id>.json` for the
// built-ins, `<config>/codes/<id>.json` for the user's (M13, AD-29: at most 64 files of at most
// 1 MiB each, read by Rust). `core/codes/load.ts` hands the member to `loadTemplates`, so a
// built-in template passes the same gate as a user one, and `resolve.ts` merges the arrays of a
// file and its parents **by id** (a child's or a user's template with the id of a parent's one
// replaces it whole, in its place; a new id is appended).
//
// Strictness, as for the codes: a member that is not an array is one problem and no template; a
// broken template is dropped and reported with its JSON path, and the rest of the file loads. A
// template is broken when anything the engine relies on is wrong — its id, label, group or body;
// a parameter's id, label or type; a placeholder that names no parameter; a bound or a default
// that contradicts itself; a formula that cannot be read; a text over its limit. Text is never
// shortened and a value never corrected: a template that does not fit is refused, with the reason.
// An optional flag written as anything but `true`/`false` is reported and read as absent. Unknown
// members are ignored (a file may carry `$comment`).
//
// The limits (`TEMPLATE_LIMITS`) keep one file from making the Insert tab, the completion list
// or a form unusable; they are well above what a real template needs (the longest built-in
// template has a dozen lines and eight parameters).

import { checkFormula, formulaRefs, FORMULA_CONSTANTS, FORMULA_FUNCTIONS } from './formula';
import type {
  TemplateChoice,
  TemplateDecimals,
  TemplateDef,
  TemplateParam,
  TemplateParamType,
  TemplateProblem,
} from './types';

/** The bounds of one file's templates (P3b prelude). */
export const TEMPLATE_LIMITS = {
  /** Templates per database file. */
  templates: 200,
  /** Characters and lines of one body. */
  body: 8000,
  bodyLines: 200,
  /** Parameters per template, options per choice. */
  params: 40,
  choices: 50,
  /** Characters of a label, a group, a description, a help text, a prefix or suffix, a text default, a choice value. */
  label: 80,
  group: 40,
  description: 500,
  help: 300,
  affix: 16,
  text: 200,
  value: 80,
  /** Digits of `digits`, decimals of a fixed `decimals`. */
  digits: 9,
  decimals: 6,
  /** Bytes of one code file: what the program reads from the user's folder (`user_files_list`, 1 MiB). */
  fileBytes: 1024 * 1024,
} as const;

/** A template id: lower-case letters, digits and `-`, at most 64, starting and ending with a letter or digit. */
export const TEMPLATE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
/** A parameter id: a lower-case letter or `_`, then letters, digits or `_`, at most 32 (a formula reads it by this name). */
export const TEMPLATE_PARAM_ID = /^[a-z_][a-z0-9_]{0,31}$/;
/** The command that inserts template `<id>` of the active document's database (§6.7). */
export const TEMPLATE_COMMAND_PREFIX = 'insert.template:';
/** The template every built-in database has (P3.6), on the Insert tab (§6.7; its old Home-tab "Program" button is gone, B1 A9). */
export const PROGRAM_START_TEMPLATE_ID = 'program-start';
/** The placeholders that are no parameter. */
export const SYS_PLACEHOLDERS = ['sys.date', 'sys.time', 'sys.file', 'sys.stem'] as const;

/** `insert.template:<id>`. */
export function templateCommandId(id: string): string {
  return `${TEMPLATE_COMMAND_PREFIX}${id}`;
}

/** The template id of an `insert.template:<id>` command, or null for any other command. */
export function templateIdOfCommand(command: string): string | null {
  if (!command.startsWith(TEMPLATE_COMMAND_PREFIX)) return null;
  const id = command.slice(TEMPLATE_COMMAND_PREFIX.length);
  return TEMPLATE_ID.test(id) ? id : null;
}

/** The `ui.lastParams` key of a template's remembered values: per database, because every database has a `program-start`. */
export function templateMemoKey(dialect: string, id: string): string {
  return `template:${dialect}:${id}`;
}

/**
 * The templates a document sees: those of its effective database whose `machineType` is absent
 * or the document profile's machine type (a profile without one sees only the unmarked ones).
 */
export function templatesForMachine(templates: readonly TemplateDef[] | undefined, machineType: string | undefined): TemplateDef[] {
  return (templates ?? []).filter((t) => offeredToMachine(t, machineType));
}

/** The one rule behind `templatesForMachine`: a template without a `machineType` is for every machine, one with it for that type only. */
export function offeredToMachine(template: Pick<TemplateDef, 'machineType'>, machineType: string | undefined): boolean {
  return template.machineType === undefined || template.machineType === machineType;
}

/**
 * The templates a code set offers to the programs that use it: those `templatesForMachine` gives for the
 * machine type of at least one of them (`machineTypes`, one entry per profile that names the set, `undefined`
 * for a profile without a type). With no program that uses the set (a code set of the user's own that no
 * profile names), nothing is left out.
 */
export function templatesForMachines(templates: readonly TemplateDef[] | undefined, machineTypes: readonly (string | undefined)[]): TemplateDef[] {
  if (machineTypes.length === 0) return [...(templates ?? [])];
  return (templates ?? []).filter((t) => machineTypes.some((type) => offeredToMachine(t, type)));
}

const TYPES: readonly TemplateParamType[] = ['number', 'integer', 'text', 'choice', 'formula'];
const MACHINE_TYPES = ['mill', 'lathe'] as const;
/**
 * Not usable as a parameter id: `sys`, the formula's functions and constants, and the one name that
 * is no property of an object (`__proto__` would be a prototype in the records of errors and values).
 * Ids that start with `_` stay valid: "from selection" names `#101` `_101`.
 */
const RESERVED_PARAM_IDS = new Set<string>(['sys', '__proto__', ...FORMULA_FUNCTIONS, ...FORMULA_CONSTANTS]);
/** A number as decimal text: an optional sign, digits with an optional point, or a point and digits (one unambiguous way to match, no backtracking). */
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
/** A decimal default is never longer than this: it is checked before the pattern runs. */
const DECIMAL_MAX_CHARS = 40;
/** A control character the engine could mistake for its own marks (tab and line break excepted). */
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f]/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Thrown inside one template's reader; the template is dropped with this problem. */
class Broken extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

type Report = (p: TemplateProblem) => void;

/** A required single-line text of at most `max` characters, trimmed. */
function text(raw: unknown, path: string, what: string, max: number, required: true): string;
function text(raw: unknown, path: string, what: string, max: number, required: false): string | undefined;
function text(raw: unknown, path: string, what: string, max: number, required: boolean): string | undefined {
  if (raw === undefined && !required) return undefined;
  if (typeof raw !== 'string' || raw.trim() === '') {
    if (!required && raw === '') return undefined;
    throw new Broken(path, `${what} has to be a text`);
  }
  const value = raw.trim();
  if (value.length > max) throw new Broken(path, `${what} is longer than ${max} characters`);
  if (/[\r\n]/.test(value)) throw new Broken(path, `${what} has to be one line`);
  return value;
}

/** A prefix or suffix: kept as written (spaces count), one line, at most `TEMPLATE_LIMITS.affix`. */
function affix(raw: unknown, path: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') throw new Broken(path, 'has to be a text');
  if (raw.length > TEMPLATE_LIMITS.affix) throw new Broken(path, `is longer than ${TEMPLATE_LIMITS.affix} characters`);
  if (/[\r\n{}]/.test(raw)) throw new Broken(path, 'has to be one line without { or }');
  if (CONTROL_CHARS.test(raw)) throw new Broken(path, 'has an invisible control character');
  return raw;
}

/** `true`, or absent; anything but a boolean is reported and read as absent. */
function flag(raw: unknown, path: string, report: Report): true | undefined {
  if (raw === true) return true;
  if (raw !== undefined && raw !== false) report({ path, message: 'has to be true or false; read as false' });
  return undefined;
}

function finite(raw: unknown, path: string): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Broken(path, 'has to be a number');
  return raw;
}

function decimalsOf(raw: unknown, path: string): TemplateDecimals | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'as-entered' || raw === 'min1') return raw;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= TEMPLATE_LIMITS.decimals) return raw;
  throw new Broken(path, `has to be "as-entered", "min1" or a whole number from 0 to ${TEMPLATE_LIMITS.decimals}`);
}

function choicesOf(raw: unknown, path: string): TemplateChoice[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Broken(path, 'a choice parameter needs a list of choices');
  if (raw.length > TEMPLATE_LIMITS.choices) throw new Broken(path, `has more than ${TEMPLATE_LIMITS.choices} choices`);
  const seen = new Set<string>();
  return raw.map((item, i) => {
    const at = `${path}[${i}]`;
    if (!isRecord(item)) throw new Broken(at, 'a choice has to be an object with a label and a value');
    const label = text(item.label, `${at}.label`, 'the label', TEMPLATE_LIMITS.label, true);
    const rawValue = typeof item.value === 'number' && Number.isFinite(item.value) ? String(item.value) : item.value;
    if (typeof rawValue !== 'string') throw new Broken(`${at}.value`, 'the value has to be a text or a number');
    if (rawValue.length > TEMPLATE_LIMITS.value || /[\r\n{}]/.test(rawValue)) {
      throw new Broken(`${at}.value`, `the value has to be one line of at most ${TEMPLATE_LIMITS.value} characters without { or }`);
    }
    if (CONTROL_CHARS.test(rawValue)) throw new Broken(`${at}.value`, 'the value has an invisible control character');
    if (seen.has(rawValue)) throw new Broken(`${at}.value`, `the value "${rawValue}" is listed twice`);
    seen.add(rawValue);
    return { label, value: rawValue };
  });
}

function readParam(raw: unknown, path: string, report: Report): TemplateParam {
  if (!isRecord(raw)) throw new Broken(path, 'a parameter has to be an object');
  const id = raw.id;
  if (typeof id !== 'string' || !TEMPLATE_PARAM_ID.test(id)) {
    throw new Broken(`${path}.id`, 'the id has to start with a lower-case letter or _, then letters, digits or _, at most 32');
  }
  if (RESERVED_PARAM_IDS.has(id)) throw new Broken(`${path}.id`, `"${id}" is a reserved name`);
  const label = text(raw.label, `${path}.label`, 'the label', TEMPLATE_LIMITS.label, true);
  const type = raw.type;
  if (typeof type !== 'string' || !(TYPES as readonly string[]).includes(type)) {
    throw new Broken(`${path}.type`, `the type has to be one of ${TYPES.join(', ')}`);
  }
  const p: TemplateParam = { id, label, type: type as TemplateParamType };
  const help = text(raw.help, `${path}.help`, 'the help text', TEMPLATE_LIMITS.help, false);
  if (help !== undefined) p.help = help;

  const isNumber = p.type === 'number' || p.type === 'integer';
  const notFor = (member: string, types: string): never => {
    throw new Broken(`${path}.${member}`, `${member} is only for ${types} parameters`);
  };

  // Bounds.
  const min = finite(raw.min, `${path}.min`);
  const max = finite(raw.max, `${path}.max`);
  if ((min !== undefined || max !== undefined) && !isNumber) notFor(min !== undefined ? 'min' : 'max', 'number and integer');
  if (min !== undefined && max !== undefined && min > max) throw new Broken(`${path}.min`, 'min is larger than max');
  if (p.type === 'integer') {
    if (min !== undefined && !Number.isInteger(min)) throw new Broken(`${path}.min`, 'an integer parameter needs a whole min');
    if (max !== undefined && !Number.isInteger(max)) throw new Broken(`${path}.max`, 'an integer parameter needs a whole max');
  }
  if (min !== undefined) p.min = min;
  if (max !== undefined) p.max = max;

  // Choices.
  if (p.type === 'choice') p.choices = choicesOf(raw.choices, `${path}.choices`);
  else if (raw.choices !== undefined) notFor('choices', 'choice');

  // Number style.
  const decimals = decimalsOf(raw.decimals, `${path}.decimals`);
  if (decimals !== undefined) {
    if (p.type !== 'number' && p.type !== 'formula') notFor('decimals', 'number and formula');
    p.decimals = decimals;
  }
  if (raw.digits !== undefined) {
    const d = raw.digits;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > TEMPLATE_LIMITS.digits) {
      throw new Broken(`${path}.digits`, `has to be a whole number from 1 to ${TEMPLATE_LIMITS.digits}`);
    }
    if (p.type !== 'integer' && p.type !== 'formula') notFor('digits', 'integer and formula');
    p.digits = d;
  }
  const prefix = affix(raw.prefix, `${path}.prefix`);
  if (prefix !== undefined) p.prefix = prefix;
  const suffix = affix(raw.suffix, `${path}.suffix`);
  if (suffix !== undefined) p.suffix = suffix;
  if (flag(raw.plusSign, `${path}.plusSign`, report)) {
    if (!isNumber && p.type !== 'formula') notFor('plusSign', 'number, integer and formula');
    p.plusSign = true;
  }
  if (flag(raw.uppercase, `${path}.uppercase`, report)) {
    if (p.type !== 'text') notFor('uppercase', 'text');
    p.uppercase = true;
  }
  if (flag(raw.comment, `${path}.comment`, report)) {
    if (p.type !== 'text') notFor('comment', 'text');
    p.comment = true;
  }

  // Formula.
  if (p.type === 'formula') {
    if (typeof raw.formula !== 'string') throw new Broken(`${path}.formula`, 'a formula parameter needs its formula');
    p.formula = raw.formula;
    if (raw.required !== undefined) notFor('required', 'non-formula');
    if (raw.default !== undefined) notFor('default', 'non-formula');
    if (raw.remember !== undefined) notFor('remember', 'non-formula');
    if (flag(raw.hidden, `${path}.hidden`, report)) p.hidden = true;
    return p;
  }
  if (raw.formula !== undefined) notFor('formula', 'formula');
  if (raw.hidden !== undefined) notFor('hidden', 'formula');
  if (flag(raw.required, `${path}.required`, report)) p.required = true;
  if (flag(raw.remember, `${path}.remember`, report)) p.remember = true;

  // Default.
  if (raw.default !== undefined) p.default = defaultOf(raw.default, p, `${path}.default`);
  return p;
}

/** A default that fits its parameter; never corrected. */
function defaultOf(raw: unknown, p: TemplateParam, path: string): string | number {
  if (p.type === 'text') {
    if (typeof raw !== 'string') throw new Broken(path, 'the default of a text parameter has to be a text');
    if (raw.length > TEMPLATE_LIMITS.text || /[\r\n]/.test(raw)) {
      throw new Broken(path, `the default has to be one line of at most ${TEMPLATE_LIMITS.text} characters`);
    }
    if (CONTROL_CHARS.test(raw)) throw new Broken(path, 'the default has an invisible control character');
    if (p.uppercase && raw !== raw.toUpperCase()) throw new Broken(path, 'the default is not upper case');
    return raw;
  }
  if (p.type === 'choice') {
    const value = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw;
    if (typeof value !== 'string' || !(p.choices ?? []).some((c) => c.value === value)) {
      throw new Broken(path, 'the default has to be the value of one of the choices');
    }
    return value;
  }
  // number, integer: decimal text or a finite number.
  const asText = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw;
  if (typeof asText !== 'string') throw new Broken(path, 'the default has to be a number');
  if (asText.trim().length > DECIMAL_MAX_CHARS) throw new Broken(path, `the default has to be a number of at most ${DECIMAL_MAX_CHARS} characters`);
  if (!DECIMAL_TEXT.test(asText.trim())) throw new Broken(path, 'the default has to be a number');
  const value = Number(asText);
  if (p.type === 'integer' && !/^[+-]?\d+$/.test(asText.trim())) throw new Broken(path, 'the default of an integer parameter has to be a whole number');
  if (p.min !== undefined && value < p.min) throw new Broken(path, `the default is below the minimum ${p.min}`);
  if (p.max !== undefined && value > p.max) throw new Broken(path, `the default is above the maximum ${p.max}`);
  if (typeof p.decimals === 'number') {
    const point = asText.indexOf('.');
    const written = point < 0 ? 0 : asText.trim().length - point - 1;
    if (written > p.decimals) throw new Broken(path, `the default has more than ${p.decimals} decimals`);
  }
  return typeof raw === 'number' ? raw : asText.trim();
}

/**
 * The placeholders of a body, checked: every `{{name}}` is a parameter, `N` at the very start of
 * a line, or one of `SYS_PLACEHOLDERS`; `\{{` is a literal `{{`; a `{{` that is not closed on its
 * line is an error. Answers the parameter ids it uses.
 */
export function placeholdersOf(body: string, params: ReadonlySet<string>): { used: Set<string> } | { error: string } {
  const used = new Set<string>();
  const lines = body.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    let at = 0;
    for (;;) {
      const open = line.indexOf('{{', at);
      if (open < 0) break;
      if (open > 0 && line[open - 1] === '\\') {
        at = open + 2;
        continue;
      }
      const close = line.indexOf('}}', open + 2);
      if (close < 0) return { error: `line ${n + 1}: a {{ without its }}` };
      const name = line.slice(open + 2, close);
      if (name === 'N') {
        if (open !== 0) return { error: `line ${n + 1}: {{N}} has to stand at the start of a line` };
      } else if (!(SYS_PLACEHOLDERS as readonly string[]).includes(name)) {
        if (name.trim() !== name) return { error: `line ${n + 1}: write {{${name.trim()}}} without spaces` };
        if (!params.has(name)) return { error: `line ${n + 1}: {{${name}}} is no parameter of this template` };
        used.add(name);
      }
      at = close + 2;
    }
  }
  return { used };
}

/** Formula references form no cycle: answers the ids of one cycle, or null. */
function formulaCycle(params: readonly TemplateParam[]): string[] | null {
  const formulas = new Map(params.filter((p) => p.type === 'formula').map((p) => [p.id, formulaRefs(p.formula ?? '')]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'visiting');
    stack.push(id);
    for (const ref of formulas.get(id) ?? []) {
      if (!formulas.has(ref)) continue;
      const cycle = visit(ref);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const id of formulas.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

function readTemplate(raw: unknown, path: string, report: Report): TemplateDef {
  if (!isRecord(raw)) throw new Broken(path, 'a template has to be an object');
  const id = raw.id;
  if (typeof id !== 'string' || !TEMPLATE_ID.test(id)) {
    throw new Broken(`${path}.id`, 'the id has to be lower-case letters, digits and -, at most 64 characters');
  }
  const t: TemplateDef = {
    id,
    label: text(raw.label, `${path}.label`, 'the label', TEMPLATE_LIMITS.label, true),
    group: text(raw.group, `${path}.group`, 'the group', TEMPLATE_LIMITS.group, true),
    body: '',
  };
  const description = text(raw.description, `${path}.description`, 'the description', TEMPLATE_LIMITS.description, false);
  if (description !== undefined) t.description = description;
  if (flag(raw.toolbar, `${path}.toolbar`, report)) t.toolbar = true;
  if (flag(raw.snippet, `${path}.snippet`, report)) t.snippet = true;
  if (raw.machineType !== undefined) {
    if (!(MACHINE_TYPES as readonly unknown[]).includes(raw.machineType)) {
      throw new Broken(`${path}.machineType`, 'has to be "mill" or "lathe"');
    }
    t.machineType = raw.machineType as 'mill' | 'lathe';
  }
  if (raw.review !== undefined) {
    if (raw.review === 'pending') t.review = 'pending';
    else report({ path: `${path}.review`, message: 'has to be "pending"; read as reviewed' });
  }

  // Body.
  if (typeof raw.body !== 'string' || raw.body.trim() === '') throw new Broken(`${path}.body`, 'the body has to be a text');
  const body = raw.body.replace(/\r\n?/g, '\n');
  if (body.length > TEMPLATE_LIMITS.body) throw new Broken(`${path}.body`, `the body is longer than ${TEMPLATE_LIMITS.body} characters`);
  if (body.split('\n').length > TEMPLATE_LIMITS.bodyLines) {
    throw new Broken(`${path}.body`, `the body has more than ${TEMPLATE_LIMITS.bodyLines} lines`);
  }
  if (CONTROL_CHARS.test(body)) throw new Broken(`${path}.body`, 'the body has an invisible control character');
  t.body = body;

  // Parameters.
  const params: TemplateParam[] = [];
  if (raw.params !== undefined) {
    if (!Array.isArray(raw.params)) throw new Broken(`${path}.params`, 'params has to be a list');
    if (raw.params.length > TEMPLATE_LIMITS.params) throw new Broken(`${path}.params`, `has more than ${TEMPLATE_LIMITS.params} parameters`);
    const ids = new Set<string>();
    raw.params.forEach((item, i) => {
      const p = readParam(item, `${path}.params[${i}]`, report);
      if (ids.has(p.id)) throw new Broken(`${path}.params[${i}].id`, `the id "${p.id}" is used twice`);
      ids.add(p.id);
      params.push(p);
    });
  }
  if (t.snippet && params.length > 0) throw new Broken(`${path}.params`, 'a snippet template has no parameters (its tab stops are in the body)');
  const types = new Map(params.map((p) => [p.id, p.type]));
  params.forEach((p, i) => {
    if (p.type !== 'formula') return;
    const problem = checkFormula(p.formula ?? '', types);
    if (problem !== null) throw new Broken(`${path}.params[${i}].formula`, problem);
  });
  const cycle = formulaCycle(params);
  if (cycle) throw new Broken(`${path}.params`, `the formulas read each other in a circle: ${cycle.join(' → ')}`);
  const found = placeholdersOf(body, new Set(types.keys()));
  if ('error' in found) throw new Broken(`${path}.body`, found.error);
  if (params.length > 0) t.params = params;
  return t;
}

/**
 * Reads the `templates` member of one code database file (P2 §7.8). `raw` undefined: no
 * templates and no problem. Broken templates are dropped and reported through `onProblem` with a
 * path below the member (`[2].params[0].id`); a template whose id was already read is dropped too.
 */
export function loadTemplates(raw: unknown, onProblem?: (p: TemplateProblem) => void): TemplateDef[] {
  const report: Report = onProblem ?? (() => {});
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    report({ path: '', message: 'templates has to be a list' });
    return [];
  }
  const out: TemplateDef[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const path = `[${i}]`;
    if (i >= TEMPLATE_LIMITS.templates) {
      if (i === TEMPLATE_LIMITS.templates) {
        report({ path, message: `more than ${TEMPLATE_LIMITS.templates} templates; the rest are not read` });
      }
      return;
    }
    try {
      const t = readTemplate(item, path, report);
      if (seen.has(t.id)) {
        report({ path: `${path}.id`, message: `the id "${t.id}" is used twice in this file` });
        return;
      }
      seen.add(t.id);
      out.push(t);
    } catch (error) {
      if (!(error instanceof Broken)) throw error;
      report({ path: error.path, message: error.message });
    }
  });
  return out;
}
