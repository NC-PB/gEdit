// The template engine (Phase 2 plan §7.8, AD-28; Phase 3 plan §6.11, P3.4). Written by the P3b
// prelude as stubs; built by P3.4, who owns it from Wave A on.
//
// Pure: no Monaco, no store, no clock. The rules (binding; `docs/planning/code-assistant.md`
// "Parametric templates" and "Placeholders"):
//
//  1. `{{id}}` is the value of parameter `id`, formatted by its options and wrapped in its
//     `prefix`/`suffix`; it may repeat. An **empty optional** value drops the whole word, prefix
//     and suffix included, and one space next to it, so `G0 {{x}} {{z}}` with no `x` is `G0 Z2.`;
//     a line left with nothing but its block number (or nothing at all, where the body line had
//     a placeholder) is dropped.
//  2. `{{N}}` (only at a line start) is the next block number: `prevBlockNumber + step` (the
//     profile's `numbering.step`), then on from there for every later `{{N}}`, written as the
//     profile writes a block number (`numbering.digits`, the address, `spacesAfter`); with no
//     number above, `numbering.start`. In an unnumbered document (`numbered: false`) it is empty
//     and its separator goes with it. A `consecutive` profile (Klartext) is always numbered; the
//     caller renumbers the blocks after the insert in the same edit (`RenderResult.blocks`).
//  3. `{{sys.date}}`, `{{sys.time}}`, `{{sys.file}}`, `{{sys.stem}}` from `env.sys`; `\{{` is a
//     literal `{{`.
//  4. Numbers are decimal text from start to end (never a JS `number` on the way to the text):
//     `as-entered` writes the typed digits (`.5` as typed), `min1` adds a point to a whole number
//     (`10` → `10.`), a fixed count pads with zeros and **refuses** more typed decimals; `digits`
//     pads an integer with zeros; `plusSign` writes `+` before a positive value; a negative
//     value keeps its `-`.
//  5. `validateTemplateValues` and `renderTemplate` never correct a value: a required value
//     missing, a bound crossed, a fraction in an integer, a text that is not upper case where
//     `uppercase` asks for it, a choice that is not one of the choices — each is an error by
//     parameter id (`templates.value.*` messages), and nothing is rendered.
//  6. A `comment` text is wrapped in the profile's comment delimiters (the first pair of
//     `syntax.comments`); a text that contains the closing delimiter is refused.
//  7. Formula parameters (P3.8) are computed by `evaluateFormulas` before anything is written;
//     a template without a formula never calls it.
//  8. A snippet template (`snippet: true`) renders its `{{N}}` and `{{sys.*}}` and leaves the
//     rest (`${1:…}`) to the snippet controller.
//  9. The text has `\n` line breaks and ends without one; the caller adds the document's EOL.
//
// As built (P3.4), where the nine rules leave a choice:
//
//  a. **Empty** means absent, `null`, or a text that is only blanks. A number is read with its
//     surrounding blanks cut off (they are no part of the number); a text or a choice keeps
//     what was typed. Nothing else is touched: a value is written as typed or refused.
//  b. The word of an empty optional parameter goes with **one** space: the one before it, or,
//     at the start of a line (indentation does not count), the one after it. `{{N}}`'s
//     separator is not part of the word, so `{{N}}{{x}} G1` with no `x` is `N10 G1`.
//  c. A body line is dropped when it had a placeholder and, after the substitutions, only a block
//     number or blanks are left. A line without a placeholder is kept as written, blank or not.
//     A dropped line takes no block number. When the dropped line was the last of a continuation
//     chain (Klartext `~`), the continuation mark of the line above goes too, so the chain ends.
//  d. `{{N}}` writes the number as the profile's renumber does (`numbering.digits`, the
//     `blockNumber.prefix`; none for `leading-integer`), then the body's own blanks if it wrote
//     any behind it, else `numbering.spacesAfter` of them (at least one where words need
//     separating). A number beyond `numbering.max` is refused (error id `N`), never wrapped.
//     Unnumbered: `{{N}}` and the blanks the body wrote behind it are gone.
//  e. A number parameter is a text field (`templateFields`): the form must hand over what was
//     typed (`10.` is a millimetre value on a Fanuc control, `10` is not), and a numeric control
//     would give a JS number. The engine accepts numbers too (a default is one) and writes them
//     as plain decimal text.
//  f. A formula result is finished here, whatever the evaluator gave: rounded half away from zero
//     to a fixed `decimals`, to at most `FORMULA_LIMITS.maxDecimals` for `as-entered` and `min1`
//     (trailing zeros of those two cut off), then written like any number.
//  g. `validateTemplateValues(t, values, cp?)` with the compiled profile also checks the comment
//     delimiters; `renderTemplate` always does.

import type { Msg } from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import { parseNumber } from '$lib/core/nc/numbers';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { evaluateFormulas, FORMULA_LIMITS } from './formula';
import type { RenderResult, TemplateDef, TemplateEnv, TemplateParam } from './types';

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

function msg(key: string, params?: Record<string, string | number>): Msg {
  return params === undefined ? { key: `templates.value.${key}` } : { key: `templates.value.${key}`, params };
}

/** A JS number as plain decimal text (no exponent). */
function plainNumber(n: number): string {
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

/** A control character other than a tab (a line break has its own message). */
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f]/;
const CONTROL_CHARS_ALL = new RegExp(CONTROL_CHARS.source, 'g');

/** The typed text of a value, or null when it is empty (absent, null, blanks only). Rule a. */
function textOf(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() === '' ? null : raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? plainNumber(raw) : String(raw);
  if (typeof raw === 'boolean') return String(raw);
  return null;
}

/** The default of a parameter as the form's text. */
function defaultText(p: TemplateParam): string | undefined {
  if (p.default === undefined) return undefined;
  return typeof p.default === 'number' ? plainNumber(p.default) : p.default;
}

/** Rounds the decimal digits `int.frac` to `n` decimals, half away from zero (the sign is kept apart). */
function roundDigits(int: string, frac: string, n: number): { int: string; frac: string } {
  if (frac.length <= n) return { int, frac };
  let whole = BigInt((int === '' ? '0' : int) + frac.slice(0, n));
  if (frac.charCodeAt(n) >= 0x35) whole += 1n;
  const digits = whole.toString().padStart(n + 1, '0');
  return { int: digits.slice(0, digits.length - n), frac: digits.slice(digits.length - n) };
}

/**
 * One number as the parameter writes it (rule 4). `typed` text is checked and never changed
 * (too many decimals for a fixed count is an error); a `computed` one (a formula result) is
 * rounded first (rule f).
 */
function formatNumber(p: TemplateParam, text: string, separator: string, computed: boolean): { word: string } | { error: Msg } {
  const n = parseNumber(text.trim());
  if (n === null) return { error: msg('notANumber') };
  const whole = p.type === 'integer';
  if (whole && n.hasPoint) return { error: msg('notAnInteger') };

  let int = n.intPart;
  let frac: string | null = n.fracPart;
  const decimals = p.decimals ?? 'as-entered';

  if (computed) {
    const to = typeof decimals === 'number' ? decimals : FORMULA_LIMITS.maxDecimals;
    if (frac !== null) {
      const rounded = roundDigits(int, frac, to);
      int = rounded.int;
      frac = rounded.frac;
    }
    if (typeof decimals !== 'number') {
      frac = (frac ?? '').replace(/0+$/, '');
      if (frac === '' && decimals === 'as-entered') frac = null;
    }
  } else if (!whole && typeof decimals === 'number' && frac !== null && frac.length > decimals) {
    return { error: msg('tooManyDecimals', { decimals }) };
  }

  if (!computed) {
    const value = Number(`${n.sign === '-' ? '-' : ''}${n.intPart === '' ? '0' : n.intPart}.${n.fracPart ?? '0'}`);
    if (p.min !== undefined && value < p.min) return { error: msg('belowMin', { min: p.min }) };
    if (p.max !== undefined && value > p.max) return { error: msg('aboveMax', { max: p.max }) };
  }

  // The fraction as it is written.
  let point = false;
  let fraction = '';
  if (!whole) {
    if (decimals === 'as-entered') {
      point = frac !== null;
      fraction = frac ?? '';
    } else if (decimals === 'min1') {
      point = true;
      fraction = frac ?? '';
    } else {
      point = decimals > 0;
      fraction = (frac ?? '').padEnd(decimals, '0');
    }
  }
  if (p.digits !== undefined) int = int.padStart(p.digits, '0');

  const zero = /^0*$/.test(int) && /^0*$/.test(fraction);
  let sign = '';
  if (n.sign === '-' && !(computed && zero)) sign = '-';
  else if (n.sign !== '-' && p.plusSign === true && !zero) sign = '+';
  return { word: sign + int + (point ? separator + fraction : '') };
}

/** One parameter's value: the word to write (null: empty and optional) or why it is refused. */
function prepare(p: TemplateParam, raw: unknown, cp: CompiledProfile | undefined): { word: string | null } | { error: Msg } {
  const typed = textOf(raw);
  if (typed === null) return p.required === true ? { error: msg('required') } : { word: null };
  const around = (core: string): string => (p.prefix ?? '') + core + (p.suffix ?? '');

  if (p.type === 'choice') {
    if (!(p.choices ?? []).some((c) => c.value === typed)) return { error: msg('notAChoice') };
    return { word: around(typed) };
  }

  if (p.type === 'text') {
    if (/[\r\n]/.test(typed)) return { error: msg('oneLine') };
    // U+0001 stands for `{{N}}` while a line is built: a typed control character would be numbered.
    if (CONTROL_CHARS.test(typed)) return { error: msg('control') };
    if (p.uppercase === true && typed !== typed.toUpperCase()) return { error: msg('notUppercase') };
    let core = typed;
    if (p.comment === true && cp !== undefined) {
      const pair = cp.profile.syntax.comments[0];
      if (pair === undefined) return { error: msg('noComments') };
      if (pair.end !== null && typed.includes(pair.end)) return { error: msg('commentDelimiter', { delimiter: pair.end }) };
      core = pair.start + typed + (pair.end ?? '');
    }
    return { word: around(core) };
  }

  // number, integer (typed), formula (computed: `prepare` is not called for it)
  const done = formatNumber(p, typed, cp?.profile.syntax.decimalSeparator ?? '.', false);
  return 'error' in done ? done : { word: around(done.word) };
}

interface Analysis {
  errors: Record<string, Msg>;
  /** By parameter id: the word to write, or null for an empty optional one. */
  words: Map<string, string | null>;
}

/** Checks every value and builds every word (formulas first, rule 7). */
function analyse(t: TemplateDef, values: Record<string, unknown>, cp: CompiledProfile | undefined): Analysis {
  // Records without a prototype: a parameter id never meets `__proto__` (reserved by the loader, but a
  // definition built in code is not loaded), and `errors[id] = …` is always a member.
  const errors: Record<string, Msg> = Object.create(null) as Record<string, Msg>;
  const words = new Map<string, string | null>();
  const params = t.params ?? [];
  const inputs: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const p of params) {
    if (p.type === 'formula') continue;
    const value = Object.hasOwn(values, p.id) ? values[p.id] : undefined;
    const done = prepare(p, value, cp);
    if ('error' in done) {
      errors[p.id] = done.error;
      continue;
    }
    words.set(p.id, done.word);
    const typed = textOf(value);
    if (typed !== null) inputs[p.id] = p.type === 'number' || p.type === 'integer' ? typed.trim() : typed;
  }
  if (params.some((p) => p.type === 'formula')) {
    const result = evaluateFormulas(t, inputs);
    for (const p of params) {
      if (p.type !== 'formula') continue;
      const failed = result.errors[p.id];
      if (failed !== undefined) {
        errors[p.id] = failed;
        continue;
      }
      const value = result.values[p.id];
      if (value === null || value === undefined || value === '') {
        words.set(p.id, null);
        continue;
      }
      const done = formatNumber(p, value, cp?.profile.syntax.decimalSeparator ?? '.', true);
      if ('error' in done) errors[p.id] = done.error;
      else words.set(p.id, (p.prefix ?? '') + done.word + (p.suffix ?? ''));
    }
  }
  return { errors, words };
}

// ---------------------------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------------------------

/**
 * The form of a template (P2 §7.8): one field per parameter in `params` order, a formula as a
 * read-only field (`readOnly: true`) unless it is `hidden`; `default` from the parameter (a
 * remembered value is laid over it by the caller, `core/forms/values.ts`).
 *
 * A `number` and an `integer` are **text** fields (rule e): what was typed reaches the engine
 * as typed. Their bounds, decimals and the rest are checked by `validateTemplateValues`, which
 * the form's `live` hook calls; the form's own numeric checks do not apply to them.
 */
export function templateFields(t: TemplateDef): FieldSpec[] {
  const fields: FieldSpec[] = [];
  for (const p of t.params ?? []) {
    if (p.type === 'formula') {
      if (p.hidden === true) continue;
      const field: FieldSpec = { id: p.id, type: 'text', label: p.label, readOnly: true };
      if (p.help !== undefined) field.help = p.help;
      fields.push(field);
      continue;
    }
    const field: FieldSpec = { id: p.id, type: p.type === 'choice' ? 'choice' : 'text', label: p.label };
    if (p.help !== undefined) field.help = p.help;
    if (p.required === true) field.required = true;
    const initial = defaultText(p);
    if (initial !== undefined) field.default = initial;
    if (p.type === 'choice') field.choices = (p.choices ?? []).map((c) => ({ label: c.label, value: c.value }));
    fields.push(field);
  }
  return fields;
}

/**
 * The errors of `values` by parameter id (empty when every value fits); never corrects (rule 5).
 * With the compiled profile `cp` the comment delimiters are checked too (rule g). A formula's
 * error is the evaluator's (`cycleForm.formula.*`).
 */
export function validateTemplateValues(t: TemplateDef, values: Record<string, unknown>, cp?: CompiledProfile): Record<string, Msg> {
  return analyse(t, values, cp).errors;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

/** Stands for a `{{N}}` until the numbers are counted out (rule c: a dropped line takes none). */
const NUMBER_MARK = '\u0001';

/** One body line with its placeholders replaced; `touched` when it had any. */
function expandLine(src: string, words: Map<string, string | null>, env: TemplateEnv, snippet: boolean): { text: string; touched: boolean } {
  let out = '';
  let touched = false;
  let eatSpace = false;
  let buf = '';

  const append = (s: string): void => {
    if (s === '') return;
    if (eatSpace) {
      eatSpace = false;
      if (s[0] === ' ') s = s.slice(1);
    }
    out += s;
  };
  const flush = (): void => {
    append(buf);
    buf = '';
  };
  /** Rule b: an empty optional word goes with one space. */
  const drop = (): void => {
    flush();
    if (out.endsWith(' ') && out.trim() !== '') out = out.slice(0, -1);
    else eatSpace = true;
  };
  // A file name may hold a control character (U+0001 is the block-number mark): it is left out.
  const sysText = (raw: string): string => {
    const s = raw.replace(CONTROL_CHARS_ALL, '');
    return snippet ? s.replace(/[\\$}]/g, '\\$&') : s;
  };

  let i = 0;
  while (i < src.length) {
    if (src[i] === '\\' && src.startsWith('{{', i + 1)) {
      buf += '{{';
      i += 3;
      continue;
    }
    if (src.startsWith('{{', i)) {
      const close = src.indexOf('}}', i + 2);
      if (close >= 0) {
        const name = src.slice(i + 2, close);
        if (name === 'N') {
          flush();
          touched = true;
          out += NUMBER_MARK;
          i = close + 2;
          continue;
        }
        if (name === 'sys.date' || name === 'sys.time' || name === 'sys.file' || name === 'sys.stem') {
          flush();
          touched = true;
          append(sysText(env.sys[name.slice(4) as 'date' | 'time' | 'file' | 'stem']));
          i = close + 2;
          continue;
        }
        if (words.has(name)) {
          touched = true;
          const word = words.get(name) ?? null;
          if (word === null) drop();
          else {
            flush();
            append(word);
          }
          i = close + 2;
          continue;
        }
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return { text: out, touched };
}

/** The profile's way to write a block number (the same reading the renumber transform has of `numbering`). */
function numberingOf(cp: CompiledProfile, env: TemplateEnv) {
  const numbering = cp.profile.numbering;
  const consecutive = numbering.mode === 'consecutive';
  const separated = cp.profile.syntax.wordSeparatorRequired === true;
  const blockNumber = cp.profile.syntax.blockNumber;
  const spaces = Math.max(consecutive ? 1 : separated ? 1 : 0, Math.trunc(numbering.spacesAfter ?? 1));
  return {
    numbered: consecutive || env.numbered,
    start: Math.max(0, Math.trunc(numbering.start ?? (consecutive ? 0 : 10))),
    step: consecutive ? 1 : Math.max(1, Math.trunc(numbering.step ?? 10)),
    digits: consecutive ? 0 : Math.max(0, Math.trunc(numbering.digits ?? 0)),
    max: consecutive ? null : (numbering.max ?? null),
    prefix: blockNumber.mode === 'leading-integer' ? '' : (blockNumber.prefix ?? 'N'),
    spaces,
  };
}

/** The text of `t` for `values` at the insertion point `env` (rules 1–9). */
export function renderTemplate(t: TemplateDef, values: Record<string, unknown>, env: TemplateEnv): RenderResult {
  const { errors, words } = analyse(t, values, env.cp);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // Pass 1: the placeholders, and the lines that go.
  const mark = env.cp.profile.syntax.continuationMark;
  const kept: string[] = [];
  /** Every parameter with a value, to see how a dropped line would have ended. */
  let probed: Map<string, string | null> | undefined;
  const probe = (): Map<string, string | null> =>
    (probed ??= new Map((t.params ?? []).map((p) => [p.id, `${p.prefix ?? ''}0${p.suffix ?? ''}`])));
  for (const src of t.body.split(/\r\n?|\n/)) {
    const line = expandLine(src, words, env, t.snippet === true);
    if (line.touched && line.text.split(NUMBER_MARK).join('').trim() === '') {
      // The last line of a continuation chain went (it would not have ended with the mark): the
      // line above must not point at it.
      const above = kept[kept.length - 1];
      if (mark !== undefined && mark !== '' && above !== undefined && above.trimEnd().endsWith(mark)) {
        const full = expandLine(src, probe(), env, t.snippet === true).text;
        if (!full.trimEnd().endsWith(mark)) kept[kept.length - 1] = above.trimEnd().slice(0, -mark.length).trimEnd();
      }
      continue;
    }
    kept.push(line.text);
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();

  // Pass 2: the block numbers, in order, for the lines that stay.
  const nb = numberingOf(env.cp, env);
  let next = env.prevBlockNumber === null ? nb.start : env.prevBlockNumber + nb.step;
  let used = 0;
  let over = false;
  const lines = kept.map((line) =>
    line.includes(NUMBER_MARK)
      ? line.replace(/\u0001([ \t]*)/g, (_m, blanks: string) => {
          if (!nb.numbered) return '';
          const value = next;
          next += nb.step;
          used++;
          if (nb.max !== null && value > nb.max) over = true;
          const digits = nb.digits > 0 ? String(value).padStart(nb.digits, '0') : String(value);
          return nb.prefix + digits + (blanks !== '' ? blanks : ' '.repeat(nb.spaces));
        })
      : line,
  );
  if (over && nb.max !== null) return { ok: false, errors: { N: msg('blockNumberMax', { max: nb.max }) } };
  return { ok: true, text: lines.join('\n'), blocks: used };
}
