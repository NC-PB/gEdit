// The template engine (Phase 3 plan §6.11, P3.4; Phase 2 plan §7.8): fields, validation, rendering.
//
// Templates are built through `loadTemplates`, so every body and parameter used here also passes
// the file format's gate. The formula evaluator is P3.8's: it is a spy that runs the real one by
// default; the tests of the engine's own rounding of a result put a fake in its place. Per dialect the compiled built-in profiles are
// used: Fanuc mill and lathe, Klartext, Okuma and Sinumerik (mill and lathe share a database, not a
// profile).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import type { Msg } from '$lib/app/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { evaluateFormulas } from './formula';
import { loadTemplates, renderTemplate, templateFields, validateTemplateValues } from './index';
import type { FormulaResult, TemplateDef, TemplateEnv } from './index';

vi.mock('./formula', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./formula')>()),
  evaluateFormulas: vi.fn(),
}));
const realFormulas = (await vi.importActual<typeof import('./formula')>('./formula')).evaluateFormulas;
const fakeFormulas = vi.mocked(evaluateFormulas);

beforeEach(() => {
  fakeFormulas.mockReset();
  fakeFormulas.mockImplementation(realFormulas);
});

/** A template through the loader: a problem fails the test. */
function def(body: string, params: unknown[] = [], extra: Record<string, unknown> = {}): TemplateDef {
  const problems: string[] = [];
  const [t] = loadTemplates([{ id: 't', label: 'T', group: 'G', body, params, ...extra }], (p) => problems.push(`${p.path}: ${p.message}`));
  if (!t) throw new Error(problems.join('; '));
  return t;
}

const SYS = { date: '2026-10-09', time: '08:30', file: 'part-1.nc', stem: 'part-1' };

function envOf(cp: CompiledProfile, o: { prev?: number | null; numbered?: boolean; sys?: Partial<typeof SYS> } = {}): TemplateEnv {
  return { cp, prevBlockNumber: o.prev ?? null, numbered: o.numbered ?? false, sys: { ...SYS, ...o.sys } };
}

const FANUC = cpOf('fanuc-gcode');
const LATHE = cpOf('fanuc-lathe');
const KLAR = cpOf('heidenhain-klartext');
const OKUMA = cpOf('okuma-osp');
const SINU = cpOf('sinumerik');
const SINU_MILL = cpOf('sinumerik-mill');

function text(t: TemplateDef, values: Record<string, unknown>, env: TemplateEnv): string {
  const r = renderTemplate(t, values, env);
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.errors)}`);
  return r.text;
}

/** A one-parameter template whose body is `{{v}}`. */
function one(param: Record<string, unknown>): TemplateDef {
  return def('{{v}}', [{ id: 'v', label: 'V', ...param }]);
}

function word(param: Record<string, unknown>, value: unknown, cp: CompiledProfile = FANUC): string {
  return text(one(param), { v: value }, envOf(cp));
}

function error(param: Record<string, unknown>, value: unknown): Msg | undefined {
  return validateTemplateValues(one(param), { v: value }).v;
}

describe('templateFields', () => {
  const t = def('{{a}} {{b}} {{c}} {{d}} {{e}} {{f}}', [
    { id: 'a', label: 'A', type: 'number', required: true, default: 2.5, help: 'Approach', min: 0 },
    { id: 'b', label: 'B', type: 'integer', default: '7' },
    { id: 'c', label: 'C', type: 'text', default: 'HI' },
    { id: 'd', label: 'D', type: 'choice', choices: [{ label: 'Flood', value: 'M8' }, { label: 'Mist', value: 'M7' }], default: 'M8' },
    { id: 'e', label: 'E', type: 'formula', formula: 'a * 2', decimals: 2 },
    { id: 'f', label: 'F', type: 'formula', formula: 'a * 3', hidden: true },
  ]);

  it('gives one field per parameter in params order, a hidden formula left out', () => {
    expect(templateFields(t).map((f) => f.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps a number typed as text, so the form hands over what was typed (a default is text too)', () => {
    const [a, b, c] = templateFields(t);
    expect(a).toEqual({ id: 'a', type: 'text', label: 'A', help: 'Approach', required: true, default: '2.5' });
    expect(b).toEqual({ id: 'b', type: 'text', label: 'B', default: '7' });
    expect(c).toEqual({ id: 'c', type: 'text', label: 'C', default: 'HI' });
  });

  it('maps a choice with its labels and values, and a formula to a read-only field', () => {
    const fields = templateFields(t);
    expect(fields[3]).toEqual({
      id: 'd',
      type: 'choice',
      label: 'D',
      default: 'M8',
      choices: [
        { label: 'Flood', value: 'M8' },
        { label: 'Mist', value: 'M7' },
      ],
    });
    expect(fields[4]).toEqual({ id: 'e', type: 'text', label: 'E', readOnly: true });
  });

  it('gives a template without parameters no fields', () => {
    expect(templateFields(def('M30'))).toEqual([]);
  });
});

describe('number options, alone', () => {
  it('as-entered writes the typed digits and nothing else (the default)', () => {
    for (const typed of ['10', '10.', '10.50', '.5', '-.5', '-12.340', '007', '0']) {
      expect(word({ type: 'number', decimals: 'as-entered' }, typed), typed).toBe(typed);
      expect(word({ type: 'number' }, typed), `${typed} by default`).toBe(typed);
    }
  });

  it('as-entered drops a typed plus unless plusSign asks for it', () => {
    expect(word({ type: 'number' }, '+5.5')).toBe('5.5');
    expect(word({ type: 'number', plusSign: true }, '+5.5')).toBe('+5.5');
  });

  it('min1 gives a whole number its point and leaves the rest as typed', () => {
    expect(word({ type: 'number', decimals: 'min1' }, '10')).toBe('10.');
    expect(word({ type: 'number', decimals: 'min1' }, '10.')).toBe('10.');
    expect(word({ type: 'number', decimals: 'min1' }, '10.250')).toBe('10.250');
    expect(word({ type: 'number', decimals: 'min1' }, '-3')).toBe('-3.');
    expect(word({ type: 'number', decimals: 'min1' }, '.5')).toBe('.5');
  });

  it('a fixed count pads with zeros and never rounds', () => {
    expect(word({ type: 'number', decimals: 3 }, '5')).toBe('5.000');
    expect(word({ type: 'number', decimals: 3 }, '5.1')).toBe('5.100');
    expect(word({ type: 'number', decimals: 3 }, '-0.5')).toBe('-0.500');
    expect(word({ type: 'number', decimals: 3 }, '5.')).toBe('5.000');
    expect(word({ type: 'number', decimals: 0 }, '150')).toBe('150');
    expect(word({ type: 'number', decimals: 0 }, '150.')).toBe('150');
    expect(error({ type: 'number', decimals: 3 }, '5.1234')).toEqual({ key: 'templates.value.tooManyDecimals', params: { decimals: 3 } });
    expect(error({ type: 'number', decimals: 0 }, '150.5')).toEqual({ key: 'templates.value.tooManyDecimals', params: { decimals: 0 } });
    expect(error({ type: 'number', decimals: 2 }, '5.10')).toBeUndefined();
  });

  it('digits pads an integer with zeros, keeps a sign and never cuts', () => {
    expect(word({ type: 'integer', digits: 4 }, '42')).toBe('0042');
    expect(word({ type: 'integer', digits: 4 }, '-42')).toBe('-0042');
    expect(word({ type: 'integer', digits: 2 }, '12345')).toBe('12345');
    expect(word({ type: 'integer', digits: 3 }, '0')).toBe('000');
    expect(word({ type: 'integer' }, '42')).toBe('42');
  });

  it('plusSign writes + before a positive number, not before zero or a negative one', () => {
    expect(word({ type: 'number', plusSign: true }, '5')).toBe('+5');
    expect(word({ type: 'number', plusSign: true, decimals: 'min1' }, '5')).toBe('+5.');
    expect(word({ type: 'integer', plusSign: true }, '7')).toBe('+7');
    expect(word({ type: 'number', plusSign: true }, '0')).toBe('0');
    expect(word({ type: 'number', plusSign: true, decimals: 2 }, '0.00')).toBe('0.00');
    expect(word({ type: 'number', plusSign: true }, '-5')).toBe('-5');
  });

  it('prefix and suffix wrap the value, spaces and all', () => {
    expect(word({ type: 'number', prefix: 'Z' }, '-5.')).toBe('Z-5.');
    expect(word({ type: 'number', prefix: 'Q201=', suffix: ' ;depth' }, '-12')).toBe('Q201=-12 ;depth');
    expect(word({ type: 'integer', prefix: 'T', digits: 2 }, '3')).toBe('T03');
    expect(word({ type: 'text', prefix: 'O', suffix: 'X' }, 'AB')).toBe('OABX');
    expect(word({ type: 'choice', choices: [{ label: 'On', value: '8' }], prefix: 'M' }, '8')).toBe('M8');
  });

  it('accepts a JS number and writes it as plain decimal text', () => {
    expect(word({ type: 'number', decimals: 'min1' }, 2)).toBe('2.');
    expect(word({ type: 'number' }, 0.25)).toBe('0.25');
    expect(word({ type: 'number' }, 1e-7)).toBe('0.0000001');
    expect(word({ type: 'integer', digits: 3 }, 5)).toBe('005');
  });

  it('cuts the blanks around a number off, nothing else', () => {
    expect(word({ type: 'number', decimals: 'min1' }, ' 12 ')).toBe('12.');
  });

  it('writes the profile’s decimal separator', () => {
    const profile = structuredClone(FANUC.profile);
    profile.syntax.decimalSeparator = ',';
    const comma = compileProfile(profile);
    expect(word({ type: 'number', decimals: 2 }, '5.5', comma)).toBe('5,50');
    expect(word({ type: 'number', decimals: 'min1' }, '5', comma)).toBe('5,');
  });
});

describe('number options, together', () => {
  it('prefix, min1, plus sign and bounds on one parameter', () => {
    const p = { type: 'number', prefix: 'X', decimals: 'min1', plusSign: true, min: -100, max: 100 };
    expect(word(p, '25')).toBe('X+25.');
    expect(word(p, '-25.5')).toBe('X-25.5');
    expect(error(p, '100.5')).toEqual({ key: 'templates.value.aboveMax', params: { max: 100 } });
    expect(error(p, '-100.1')).toEqual({ key: 'templates.value.belowMin', params: { min: -100 } });
  });

  it('integer: prefix, padding, plus sign and suffix', () => {
    expect(word({ type: 'integer', prefix: 'N', digits: 5, plusSign: true, suffix: '/' }, '12')).toBe('N+00012/');
  });

  it('fixed decimals with a prefix and a suffix', () => {
    expect(word({ type: 'number', prefix: 'F', decimals: 2, suffix: ' ' }, '150')).toBe('F150.00 ');
  });
});

describe('text, choice and comment options', () => {
  it('uppercase refuses a lower-case text and writes an upper-case one as typed', () => {
    expect(word({ type: 'text', uppercase: true }, 'ABC 12')).toBe('ABC 12');
    expect(error({ type: 'text', uppercase: true }, 'Abc')).toEqual({ key: 'templates.value.notUppercase' });
    expect(error({ type: 'text' }, 'Abc')).toBeUndefined();
  });

  it('a text keeps the blanks it was typed with', () => {
    expect(word({ type: 'text' }, '  a  b ')).toBe('  a  b ');
  });

  it('a text on two lines is refused', () => {
    expect(error({ type: 'text' }, 'a\nb')).toEqual({ key: 'templates.value.oneLine' });
  });

  it('a choice writes its value, not its label, and refuses anything else', () => {
    const p = { type: 'choice', choices: [{ label: 'Flood', value: 'M8' }, { label: 'Off', value: 'M9' }] };
    expect(word(p, 'M9')).toBe('M9');
    expect(error(p, 'Flood')).toEqual({ key: 'templates.value.notAChoice' });
    expect(error(p, 'M7')).toEqual({ key: 'templates.value.notAChoice' });
    expect(error(p, 'M8')).toBeUndefined();
  });

  const comment = { type: 'text', comment: true };

  it('wraps a comment text in the first comment pair of the profile', () => {
    expect(word(comment, 'ROUGHING', FANUC)).toBe('(ROUGHING)');
    expect(word(comment, 'ROUGHING', LATHE)).toBe('(ROUGHING)');
    expect(word(comment, 'ROUGHING', OKUMA)).toBe('(ROUGHING)');
    expect(word(comment, 'ROUGHING', SINU)).toBe(';ROUGHING');
    expect(word(comment, 'ROUGHING', SINU_MILL)).toBe(';ROUGHING');
    expect(word(comment, 'ROUGHING', KLAR)).toBe(';ROUGHING');
    expect(word({ ...comment, prefix: ' ' }, 'x', FANUC)).toBe(' (x)');
  });

  it('refuses a text that holds the closing delimiter, and a profile without comments', () => {
    expect(() => word(comment, 'A)B', FANUC)).toThrow(/commentDelimiter/);
    const t = one(comment);
    expect(renderTemplate(t, { v: 'A)B' }, envOf(FANUC))).toEqual({
      ok: false,
      errors: { v: { key: 'templates.value.commentDelimiter', params: { delimiter: ')' } } },
    });
    // A comment that runs to the end of the line has no closing delimiter to hold.
    expect(word(comment, 'A)B', SINU)).toBe(';A)B');
    // Validation sees it when it is given the profile.
    expect(validateTemplateValues(t, { v: 'A)B' }, FANUC).v).toEqual({ key: 'templates.value.commentDelimiter', params: { delimiter: ')' } });
    expect(validateTemplateValues(t, { v: 'A)B' }).v).toBeUndefined();
    const bare = structuredClone(FANUC.profile);
    bare.syntax.comments = [];
    expect(renderTemplate(t, { v: 'x' }, envOf(compileProfile(bare)))).toEqual({ ok: false, errors: { v: { key: 'templates.value.noComments' } } });
  });
});

describe('validation never corrects a value', () => {
  const t = def('{{a}} {{b}} {{c}} {{d}} {{e}}', [
    { id: 'a', label: 'A', type: 'number', required: true, min: -50, max: 0, decimals: 2 },
    { id: 'b', label: 'B', type: 'integer', min: 1, max: 99 },
    { id: 'c', label: 'C', type: 'text', uppercase: true },
    { id: 'd', label: 'D', type: 'choice', choices: [{ label: 'x', value: 'M8' }] },
    { id: 'e', label: 'E', type: 'number' },
  ]);
  const ok = { a: '-5', b: '3', c: 'AB', d: 'M8', e: '' };

  it('accepts a fitting set', () => {
    expect(validateTemplateValues(t, ok)).toEqual({});
  });

  it('names the problem of each parameter by id, with its numbers', () => {
    const errors = validateTemplateValues(t, { a: '5', b: '100', c: 'ab', d: 'M9', e: 'abc' });
    expect(errors).toEqual({
      a: { key: 'templates.value.aboveMax', params: { max: 0 } },
      b: { key: 'templates.value.aboveMax', params: { max: 99 } },
      c: { key: 'templates.value.notUppercase' },
      d: { key: 'templates.value.notAChoice' },
      e: { key: 'templates.value.notANumber' },
    });
    expect(validateTemplateValues(t, { ...ok, a: '-50.01', b: '0' })).toEqual({
      a: { key: 'templates.value.belowMin', params: { min: -50 } },
      b: { key: 'templates.value.belowMin', params: { min: 1 } },
    });
  });

  it('refuses a fraction in an integer, a number that is not one, and a missing required value', () => {
    expect(validateTemplateValues(t, { ...ok, b: '2.5' }).b).toEqual({ key: 'templates.value.notAnInteger' });
    expect(validateTemplateValues(t, { ...ok, b: '2.' }).b).toEqual({ key: 'templates.value.notAnInteger' });
    for (const typed of ['1e3', '1,5', '--5', '5mm', '.', '+', '0x10']) {
      expect(validateTemplateValues(t, { ...ok, e: typed }).e, typed).toEqual({ key: 'templates.value.notANumber' });
    }
    expect(validateTemplateValues(t, { ...ok, a: '' }).a).toEqual({ key: 'templates.value.required' });
    expect(validateTemplateValues(t, { ...ok, a: undefined }).a).toEqual({ key: 'templates.value.required' });
    expect(validateTemplateValues(t, { ...ok, a: '   ' }).a).toEqual({ key: 'templates.value.required' });
    expect(validateTemplateValues(t, { b: '1' }).a).toEqual({ key: 'templates.value.required' });
  });

  it('too many decimals are an error, not a rounding', () => {
    expect(validateTemplateValues(t, { ...ok, a: '-5.123' }).a).toEqual({ key: 'templates.value.tooManyDecimals', params: { decimals: 2 } });
  });

  it('renders nothing while any value is refused, and leaves the values alone', () => {
    const values = Object.freeze({ a: '5', b: '3', c: 'ab', d: 'M8', e: '' });
    const r = renderTemplate(t, values, envOf(FANUC));
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : Object.keys(r.errors)).toEqual(['a', 'c']);
    expect(values).toEqual({ a: '5', b: '3', c: 'ab', d: 'M8', e: '' });
  });

  it('an empty optional value is no error, whatever its bounds', () => {
    expect(validateTemplateValues(t, { a: '-5', b: undefined, c: null, d: '', e: ' ' })).toEqual({});
  });

  it('ignores a value that belongs to no parameter', () => {
    expect(validateTemplateValues(t, { ...ok, zzz: 'junk' })).toEqual({});
  });
});

describe('empty optional parameters drop their word', () => {
  const g0 = def('G0 {{x}} {{y}} {{z}}', [
    { id: 'x', label: 'X', type: 'number', prefix: 'X', decimals: 'min1' },
    { id: 'y', label: 'Y', type: 'number', prefix: 'Y', decimals: 'min1' },
    { id: 'z', label: 'Z', type: 'number', prefix: 'Z', decimals: 'min1' },
  ]);

  it('drops the word, its prefix and one space, wherever it stands', () => {
    const env = envOf(FANUC);
    expect(text(g0, { x: '1', y: '2', z: '3' }, env)).toBe('G0 X1. Y2. Z3.');
    expect(text(g0, { y: '2', z: '3' }, env)).toBe('G0 Y2. Z3.');
    expect(text(g0, { x: '1', z: '3' }, env)).toBe('G0 X1. Z3.');
    expect(text(g0, { x: '1', y: '2' }, env)).toBe('G0 X1. Y2.');
    expect(text(g0, { z: '3' }, env)).toBe('G0 Z3.');
    expect(text(g0, {}, env)).toBe('G0');
  });

  it('at the start of a line the space after it goes, and indentation stays', () => {
    const t = def('  {{x}} {{y}} G1', [
      { id: 'x', label: 'X', type: 'number', prefix: 'X' },
      { id: 'y', label: 'Y', type: 'number', prefix: 'Y' },
    ]);
    expect(text(t, { y: '2' }, envOf(FANUC))).toBe('  Y2 G1');
    expect(text(t, {}, envOf(FANUC))).toBe('  G1');
  });

  it('a placeholder that repeats drops everywhere it is empty', () => {
    const t = def('{{v}} A {{v}} B', [{ id: 'v', label: 'V', type: 'integer', prefix: 'S' }]);
    expect(text(t, {}, envOf(FANUC))).toBe('A B');
    expect(text(t, { v: '5' }, envOf(FANUC))).toBe('S5 A S5 B');
  });

  it('a line left with nothing at all drops, a blank line of the body stays', () => {
    const t = def('(HEAD)\n{{c}}\n\n{{x}}\nM30', [
      { id: 'c', label: 'C', type: 'text', comment: true },
      { id: 'x', label: 'X', type: 'number', prefix: 'X' },
    ]);
    expect(text(t, {}, envOf(FANUC))).toBe('(HEAD)\n\nM30');
    expect(text(t, { c: 'HI', x: '1' }, envOf(FANUC))).toBe('(HEAD)\n(HI)\n\nX1\nM30');
  });

  it('a line left with only its block number drops, and takes no number', () => {
    const t = def('{{N}}{{x}}\n{{N}}G1 {{y}}\n{{N}}{{y}}\n{{N}}M30', [
      { id: 'x', label: 'X', type: 'number', prefix: 'X' },
      { id: 'y', label: 'Y', type: 'number', prefix: 'Y' },
    ]);
    const r = renderTemplate(t, {}, envOf(FANUC, { numbered: true, prev: 100 }));
    expect(r).toEqual({ ok: true, text: 'N110 G1\nN120 M30', blocks: 2 });
    const full = renderTemplate(t, { x: '1', y: '2' }, envOf(FANUC, { numbered: true, prev: 100 }));
    expect(full).toEqual({ ok: true, text: 'N110 X1\nN120 G1 Y2\nN130 Y2\nN140 M30', blocks: 4 });
  });

  it('the number’s separator goes with an empty word that follows it', () => {
    const t = def('{{N}}{{x}} G1', [{ id: 'x', label: 'X', type: 'number', prefix: 'X' }]);
    expect(text(t, {}, envOf(FANUC, { numbered: true, prev: 10 }))).toBe('N20 G1');
    expect(text(t, { x: '5' }, envOf(FANUC, { numbered: true, prev: 10 }))).toBe('N20 X5 G1');
  });

  it('the text ends without a line break, and without blank lines at its end', () => {
    expect(text(def('G0 X1.\nG1\n\n'), {}, envOf(FANUC))).toBe('G0 X1.\nG1');
    expect(text(def('A\r\nB\rC'), {}, envOf(FANUC))).toBe('A\nB\nC');
  });
});

describe('{{N}}', () => {
  const body = def('{{N}}G90 G54\n{{N}}G0 X0. Y0.\n{{N}}M30');

  it('continues the document’s numbers by the profile’s step', () => {
    expect(renderTemplate(body, {}, envOf(FANUC, { numbered: true, prev: 100 }))).toEqual({
      ok: true,
      text: 'N110 G90 G54\nN120 G0 X0. Y0.\nN130 M30',
      blocks: 3,
    });
  });

  it('starts at numbering.start when no number is above', () => {
    expect(text(body, {}, envOf(FANUC, { numbered: true, prev: null })).split('\n')[0]).toBe('N10 G90 G54');
    const profile = structuredClone(FANUC.profile);
    profile.numbering = { ...profile.numbering, start: 100, step: 5 };
    expect(text(body, {}, envOf(compileProfile(profile), { numbered: true })).split('\n')).toEqual(['N100 G90 G54', 'N105 G0 X0. Y0.', 'N110 M30']);
  });

  it('is empty in an unnumbered document, with its separator', () => {
    const r = renderTemplate(body, {}, envOf(FANUC, { numbered: false, prev: 100 }));
    expect(r).toEqual({ ok: true, text: 'G90 G54\nG0 X0. Y0.\nM30', blocks: 0 });
    // The blanks the body writes behind it go too.
    expect(text(def('{{N}} G1\n{{N}}G0'), {}, envOf(FANUC))).toBe('G1\nG0');
    expect(text(def('{{N}} G1\n{{N}}G0'), {}, envOf(FANUC, { numbered: true }))).toBe('N10 G1\nN20 G0');
  });

  it('uses the digits of the profile', () => {
    const profile = structuredClone(FANUC.profile);
    profile.numbering = { ...profile.numbering, digits: 4 };
    expect(text(def('{{N}}G0'), {}, envOf(compileProfile(profile), { numbered: true, prev: 20 }))).toBe('N0030 G0');
  });

  it('uses the spaces after the number, and the body’s own blanks when it writes any', () => {
    const profile = structuredClone(FANUC.profile);
    profile.numbering = { ...profile.numbering, spacesAfter: 3 };
    const cp = compileProfile(profile);
    expect(text(def('{{N}}G0'), {}, envOf(cp, { numbered: true, prev: 0 }))).toBe('N10   G0');
    expect(text(def('{{N}} G0'), {}, envOf(cp, { numbered: true, prev: 0 }))).toBe('N10 G0');
    profile.numbering = { ...profile.numbering, spacesAfter: 0 };
    expect(text(def('{{N}}G0'), {}, envOf(compileProfile(profile), { numbered: true, prev: 0 }))).toBe('N10G0');
  });

  it('refuses a number beyond the maximum of the profile and wraps nothing', () => {
    const r = renderTemplate(body, {}, envOf(FANUC, { numbered: true, prev: 99980 }));
    expect(r).toEqual({ ok: false, errors: { N: { key: 'templates.value.blockNumberMax', params: { max: 99999 } } } });
    expect(renderTemplate(body, {}, envOf(FANUC, { numbered: true, prev: 99960 })).ok).toBe(true);
  });

  it('per dialect: Fanuc lathe, Okuma and Sinumerik number with N', () => {
    const t = def('{{N}}G0 X10.\n{{N}}G1 Z-5.');
    expect(text(t, {}, envOf(LATHE, { numbered: true, prev: 5 }))).toBe('N15 G0 X10.\nN25 G1 Z-5.');
    expect(text(t, {}, envOf(OKUMA, { numbered: true, prev: 5 }))).toBe('N15 G0 X10.\nN25 G1 Z-5.');
    expect(text(t, {}, envOf(SINU, { numbered: true, prev: 5 }))).toBe('N15 G0 X10.\nN25 G1 Z-5.');
    expect(text(t, {}, envOf(SINU_MILL, { numbered: true }))).toBe('N10 G0 X10.\nN20 G1 Z-5.');
  });

  describe('Klartext numbers every block, one by one, with no prefix', () => {
    const t = def('{{N}}L X+{{x}} R0 FMAX\n{{N}}L Z+100 R0 FMAX', [{ id: 'x', label: 'X', type: 'number' }]);

    it('is numbered whatever the document says, and counts the blocks for the renumber', () => {
      expect(renderTemplate(t, { x: '10' }, envOf(KLAR, { numbered: false, prev: 7 }))).toEqual({
        ok: true,
        text: '8 L X+10 R0 FMAX\n9 L Z+100 R0 FMAX',
        blocks: 2,
      });
    });

    it('starts at 0 when there is no block above', () => {
      expect(text(t, { x: '1' }, envOf(KLAR, { prev: null })).split('\n')[0]).toBe('0 L X+1 R0 FMAX');
    });

    it('keeps a continuation chain whole: only the first line carries a number', () => {
      const cycle = def(
        '{{N}}CYCL DEF 200 DRILLING ~\n  Q200={{q200}} ;SET-UP CLEARANCE ~\n  Q201={{q201}} ;DEPTH ~\n  Q202={{q202}} ;PLUNGING DEPTH\n{{N}}L X+0 Y+0 R0 FMAX M99',
        [
          { id: 'q200', label: 'Clearance', type: 'number', decimals: 'min1', required: true },
          { id: 'q201', label: 'Depth', type: 'number', decimals: 'min1', required: true },
          { id: 'q202', label: 'Plunge', type: 'number', decimals: 'min1', required: true },
        ],
      );
      expect(renderTemplate(cycle, { q200: '2', q201: '-15', q202: '5' }, envOf(KLAR, { prev: 11 }))).toEqual({
        ok: true,
        text: '12 CYCL DEF 200 DRILLING ~\n  Q200=2. ;SET-UP CLEARANCE ~\n  Q201=-15. ;DEPTH ~\n  Q202=5. ;PLUNGING DEPTH\n13 L X+0 Y+0 R0 FMAX M99',
        blocks: 2,
      });
    });

    it('a dropped last line of a chain takes the mark of the line above with it', () => {
      const cycle = def('{{N}}CYCL DEF 200 DRILLING ~\n  Q200={{a}} ~\n{{opt}}\n{{N}}L X+0', [
        { id: 'a', label: 'A', type: 'number', required: true },
        { id: 'opt', label: 'Opt', type: 'text', prefix: '  Q211=', required: false },
      ]);
      expect(text(cycle, { a: '2' }, envOf(KLAR, { prev: 0 }))).toBe('1 CYCL DEF 200 DRILLING ~\n  Q200=2\n2 L X+0');
      expect(text(cycle, { a: '2', opt: '0.5' }, envOf(KLAR, { prev: 0 }))).toBe('1 CYCL DEF 200 DRILLING ~\n  Q200=2 ~\n  Q211=0.5\n2 L X+0');
    });

    it('a dropped middle line of a chain leaves the chain alone', () => {
      const cycle = def('{{N}}CYCL DEF 200 ~\n{{o}}\n  Q202={{b}}', [
        { id: 'o', label: 'O', type: 'number', prefix: '  Q211=', suffix: ' ~' },
        { id: 'b', label: 'B', type: 'number', required: true },
      ]);
      expect(text(cycle, { b: '1' }, envOf(KLAR, { prev: 0 }))).toBe('1 CYCL DEF 200 ~\n  Q202=1');
      expect(text(cycle, { b: '1', o: '3' }, envOf(KLAR, { prev: 0 }))).toBe('1 CYCL DEF 200 ~\n  Q211=3 ~\n  Q202=1');
    });
  });
});

describe('system placeholders, escapes and snippets', () => {
  it('writes date, time, file and stem from the environment', () => {
    const t = def('({{sys.stem}} {{sys.file}} {{sys.date}} {{sys.time}})');
    expect(text(t, {}, envOf(FANUC))).toBe('(part-1 part-1.nc 2026-10-09 08:30)');
    expect(text(t, {}, envOf(FANUC, { sys: { file: '', stem: '' } }))).toBe('(  2026-10-09 08:30)');
  });

  it('writes \\{{ as a literal {{ and does not read it as a placeholder', () => {
    const t = def('( \\{{x}} ) {{x}}', [{ id: 'x', label: 'X', type: 'number', prefix: 'X' }]);
    expect(text(t, { x: '1' }, envOf(FANUC))).toBe('( {{x}} ) X1');
  });

  it('a snippet template keeps its tab stops, and renders {{N}} and {{sys.*}}', () => {
    const t = def('{{N}}G1 Z${1:-5.} F${2:100.} ; {{sys.stem}}\n{{N}}G0 Z${3|2.,5.|}', [], { snippet: true });
    expect(renderTemplate(t, {}, envOf(FANUC, { numbered: true, prev: 40 }))).toEqual({
      ok: true,
      text: 'N50 G1 Z${1:-5.} F${2:100.} ; part-1\nN60 G0 Z${3|2.,5.|}',
      blocks: 2,
    });
    expect(text(t, {}, envOf(FANUC))).toBe('G1 Z${1:-5.} F${2:100.} ; part-1\nG0 Z${3|2.,5.|}');
  });

  it('escapes the characters a snippet would read in a system value', () => {
    const t = def('({{sys.file}})', [], { snippet: true });
    expect(text(t, {}, envOf(FANUC, { sys: { file: 'a$b}c\\d.nc' } }))).toBe('(a\\$b\\}c\\\\d.nc)');
    const plain = def('({{sys.file}})');
    expect(text(plain, {}, envOf(FANUC, { sys: { file: 'a$b}c.nc' } }))).toBe('(a$b}c.nc)');
  });
});

describe('formulas', () => {
  const t = def('{{a}} {{f}} {{g}}', [
    { id: 'a', label: 'A', type: 'number', required: true },
    { id: 'f', label: 'F', type: 'formula', formula: 'a * 2', prefix: 'F', decimals: 2 },
    { id: 'g', label: 'G', type: 'formula', formula: 'a / 3', prefix: 'S', decimals: 'min1', hidden: true },
  ]);

  function evaluator(values: Record<string, string | null>, errors: Record<string, Msg> = {}): void {
    fakeFormulas.mockImplementation((): FormulaResult => ({ values, errors }));
  }

  it('a template without a formula never calls the evaluator', () => {
    expect(text(def('G0 X{{x}}', [{ id: 'x', label: 'X', type: 'number' }]), { x: '1' }, envOf(FANUC))).toBe('G0 X1');
    expect(fakeFormulas).not.toHaveBeenCalled();
  });

  it('computes the formulas first, with the typed values, and writes each result by its own options', () => {
    evaluator({ f: '5', g: '1.666666666666666666666667' });
    expect(text(t, { a: '2.5' }, envOf(FANUC))).toBe('2.5 F5.00 S1.6667');
    expect(fakeFormulas).toHaveBeenCalledTimes(1);
    expect(fakeFormulas.mock.calls[0][0]).toBe(t);
    expect(fakeFormulas.mock.calls[0][1]).toEqual({ a: '2.5' });
  });

  it('rounds a result half away from zero to a fixed count, and to four decimals for as-entered and min1', () => {
    const r = def('{{f}} {{g}} {{h}} {{k}}', [
      { id: 'f', label: 'F', type: 'formula', formula: '1', decimals: 2 },
      { id: 'g', label: 'G', type: 'formula', formula: '1', decimals: 'min1' },
      { id: 'h', label: 'H', type: 'formula', formula: '1' },
      { id: 'k', label: 'K', type: 'formula', formula: '1', decimals: 0 },
    ]);
    evaluator({ f: '2.675', g: '0.33333333', h: '0.50000', k: '2.5' });
    expect(text(r, {}, envOf(FANUC))).toBe('2.68 0.3333 0.5 3');
    evaluator({ f: '-2.675', g: '10.000000', h: '4.00001', k: '-2.5' });
    expect(text(r, {}, envOf(FANUC))).toBe('-2.68 10. 4 -3');
    evaluator({ f: '0.004', g: '-0.00001', h: '-0.00001', k: '0.4' });
    expect(text(r, {}, envOf(FANUC))).toBe('0.00 0. 0 0');
  });

  it('writes a computed integer with its digits and plus sign', () => {
    const r = def('{{f}}', [{ id: 'f', label: 'F', type: 'formula', formula: '1', prefix: 'T', digits: 3, plusSign: true }]);
    evaluator({ f: '7' });
    expect(text(r, {}, envOf(FANUC))).toBe('T+007');
  });

  it('a hidden formula is computed and inserted but has no field', () => {
    expect(templateFields(t).map((f) => f.id)).toEqual(['a', 'f']);
  });

  it('an empty formula result drops its word', () => {
    evaluator({ f: null, g: null });
    expect(text(t, { a: '' + '1' }, envOf(FANUC))).toBe('1');
  });

  it('an error of the evaluator refuses the template, by the formula’s id', () => {
    const failure: Msg = { key: 'cycleForm.formula.divisionByZero' };
    evaluator({ f: '5' }, { g: failure });
    expect(renderTemplate(t, { a: '2.5' }, envOf(FANUC))).toEqual({ ok: false, errors: { g: failure } });
    expect(validateTemplateValues(t, { a: '2.5' })).toEqual({ g: failure });
  });

  it('hands the evaluator no value that is itself refused', () => {
    evaluator({ f: null, g: null });
    const errors = validateTemplateValues(t, { a: 'abc' });
    expect(errors).toEqual({ a: { key: 'templates.value.notANumber' } });
    expect(fakeFormulas.mock.calls[0][1]).toEqual({});
  });
});

describe('formulas with the real evaluator', () => {
  const t = def('{{a}} {{f}} {{g}}', [
    { id: 'a', label: 'A', type: 'number', required: true },
    { id: 'f', label: 'F', type: 'formula', formula: 'a * 1000', prefix: 'F', decimals: 'min1' },
    { id: 'g', label: 'G', type: 'formula', formula: 'a / 3', prefix: 'S', decimals: 2 },
  ]);

  it('writes the exact result by the parameter’s own options', () => {
    expect(text(t, { a: '1' }, envOf(FANUC))).toBe('1 F1000. S0.33');
    expect(text(t, { a: '2.5' }, envOf(FANUC))).toBe('2.5 F2500. S0.83');
  });

  it('an empty referenced value drops the formula’s word, a division by zero refuses', () => {
    const optional = def('G1 {{f}}', [
      { id: 'a', label: 'A', type: 'number' },
      { id: 'f', label: 'F', type: 'formula', formula: 'a * 2', prefix: 'F' },
    ]);
    expect(text(optional, {}, envOf(FANUC))).toBe('G1');
    const zero = def('{{f}}', [
      { id: 'a', label: 'A', type: 'number', required: true },
      { id: 'f', label: 'F', type: 'formula', formula: '1 / a' },
    ]);
    expect(renderTemplate(zero, { a: '0' }, envOf(FANUC))).toEqual({ ok: false, errors: { f: { key: 'cycleForm.formula.divisionByZero', params: { name: 'F' } } } });
  });
});

describe('real templates per dialect', () => {
  it('Fanuc mill: a drilling cycle with an optional dwell, numbered', () => {
    const t = def('{{N}}G81 {{x}} {{y}} {{z}} {{r}} {{f}}\n{{N}}G80', [
      { id: 'x', label: 'X', type: 'number', prefix: 'X', decimals: 'min1' },
      { id: 'y', label: 'Y', type: 'number', prefix: 'Y', decimals: 'min1' },
      { id: 'z', label: 'Depth', type: 'number', prefix: 'Z', decimals: 'min1', required: true, max: 0 },
      { id: 'r', label: 'R', type: 'number', prefix: 'R', decimals: 'min1', default: 2 },
      { id: 'f', label: 'Feed', type: 'number', prefix: 'F', decimals: 0, min: 1 },
    ]);
    const env = envOf(FANUC, { numbered: true, prev: 120 });
    expect(text(t, { x: '10', y: '-5.5', z: '-12', r: '2', f: '150' }, env)).toBe('N130 G81 X10. Y-5.5 Z-12. R2. F150\nN140 G80');
    expect(text(t, { z: '-12', r: '2' }, env)).toBe('N130 G81 Z-12. R2.\nN140 G80');
    expect(text(t, { z: '-12', r: '2' }, envOf(FANUC))).toBe('G81 Z-12. R2.\nG80');
    expect(renderTemplate(t, { z: '3' }, env).ok).toBe(false);
  });

  it('Fanuc lathe: tool, speed clamp, comment and direction', () => {
    const t = def('{{N}}G50 S{{max}}\n{{N}}T{{tool}} {{note}}\n{{N}}G96 S{{vc}} {{dir}}', [
      { id: 'max', label: 'Max', type: 'integer', required: true, min: 1 },
      { id: 'tool', label: 'Tool', type: 'integer', digits: 4, required: true },
      { id: 'note', label: 'Note', type: 'text', comment: true, uppercase: true },
      { id: 'vc', label: 'Vc', type: 'integer', required: true },
      { id: 'dir', label: 'Dir', type: 'choice', choices: [{ label: 'CW', value: 'M3' }, { label: 'CCW', value: 'M4' }] },
    ]);
    expect(text(t, { max: '3000', tool: '101', note: 'FINISH', vc: '200', dir: 'M3' }, envOf(LATHE, { numbered: true, prev: 0 }))).toBe(
      'N10 G50 S3000\nN20 T0101 (FINISH)\nN30 G96 S200 M3',
    );
    expect(text(t, { max: '3000', tool: '101', vc: '200' }, envOf(LATHE))).toBe('G50 S3000\nT0101\nG96 S200');
  });

  it('Okuma: a tool change with a comment and an empty optional coolant', () => {
    const t = def('{{N}}T{{t}} M6 {{c}}\n{{N}}G15 H{{h}} {{m}}', [
      { id: 't', label: 'T', type: 'integer', digits: 2, required: true },
      { id: 'c', label: 'C', type: 'text', comment: true },
      { id: 'h', label: 'H', type: 'integer', required: true },
      { id: 'm', label: 'M', type: 'choice', choices: [{ label: 'On', value: 'M8' }] },
    ]);
    expect(text(t, { t: '3', c: 'END MILL', h: '3' }, envOf(OKUMA, { numbered: true, prev: 200 }))).toBe('N210 T03 M6 (END MILL)\nN220 G15 H3');
  });

  it('Sinumerik mill and lathe: the comment runs to the end of the line, N numbers by the profile', () => {
    const t = def('{{N}}T="{{name}}" {{note}}\n{{N}}M6', [
      { id: 'name', label: 'Name', type: 'text', uppercase: true, required: true },
      { id: 'note', label: 'Note', type: 'text', comment: true },
    ]);
    for (const cp of [SINU, SINU_MILL]) {
      expect(text(t, { name: 'DRILL8', note: 'PILOT' }, envOf(cp, { numbered: true, prev: 40 }))).toBe('N50 T="DRILL8" ;PILOT\nN60 M6');
      expect(text(t, { name: 'DRILL8' }, envOf(cp, { numbered: true, prev: 40 }))).toBe('N50 T="DRILL8"\nN60 M6');
    }
  });

  it('Klartext: a tool call with a speed, an optional feed, numbered from the block above', () => {
    const t = def('{{N}}TOOL CALL {{t}} Z {{s}}\n{{N}}L Z+100 R0 FMAX {{f}}', [
      { id: 't', label: 'T', type: 'integer', required: true },
      { id: 's', label: 'S', type: 'integer', prefix: 'S', min: 0 },
      { id: 'f', label: 'F', type: 'integer', prefix: 'F', min: 0 },
    ]);
    expect(renderTemplate(t, { t: '5', s: '4000' }, envOf(KLAR, { prev: 3 }))).toEqual({
      ok: true,
      text: '4 TOOL CALL 5 Z S4000\n5 L Z+100 R0 FMAX',
      blocks: 2,
    });
    expect(text(t, { t: '5' }, envOf(KLAR, { prev: 3 }))).toBe('4 TOOL CALL 5 Z\n5 L Z+100 R0 FMAX');
  });
});

describe('P3b fix code: the engine’s edges', () => {
  it('CODE-05: a required parameter named like any member of Object.prototype that fits the id pattern gives a required error', () => {
    const names = Object.getOwnPropertyNames(Object.prototype).filter((n) => /^[a-z_][a-z0-9_]{0,31}$/.test(n));
    expect(names).toContain('__proto__');
    expect(names).toContain('constructor');
    for (const id of names) {
      // Built in code, as a definition that did not go through the loader (which now refuses `__proto__`).
      const t: TemplateDef = { id: 't', label: 'T', group: 'G', body: `{{N}}G1 {{${id}}}`, params: [{ id, label: 'P', type: 'number', required: true }] };
      const errors = validateTemplateValues(t, {}, FANUC);
      expect(Object.keys(errors), id).toEqual([id]);
      expect(errors[id]?.key, id).toBe('templates.value.required');
      const r = renderTemplate(t, {}, envOf(FANUC));
      expect(r.ok, id).toBe(false);
    }
  });

  it('CODE-05: a value out of range for such a parameter is refused too, not written as text', () => {
    const t: TemplateDef = { id: 't', label: 'T', group: 'G', body: '{{N}}G1 {{__proto__}}', params: [{ id: '__proto__', label: 'P', type: 'number', max: 5 }] };
    const r = renderTemplate(t, JSON.parse('{"__proto__":"9"}') as Record<string, unknown>, envOf(FANUC));
    expect(r.ok).toBe(false);
  });

  it('CODE-12: a text value with a control character is refused (it was read as a block number mark)', () => {
    const t = def('{{N}}G1 (X) {{c}}', [{ id: 'c', label: 'C', type: 'text' }]);
    expect(validateTemplateValues(t, { c: 'AB\u0001CD' }, FANUC).c?.key).toBe('templates.value.control');
    expect(validateTemplateValues(t, { c: 'AB\u001fCD' }, FANUC).c?.key).toBe('templates.value.control');
    expect(validateTemplateValues(t, { c: 'AB\tCD' }, FANUC)).toEqual({});
    expect(renderTemplate(t, { c: 'AB\u0001CD' }, envOf(FANUC, { numbered: true })).ok).toBe(false);
    // A line break keeps its own message.
    expect(validateTemplateValues(t, { c: 'A\nB' }, FANUC).c?.key).toBe('templates.value.oneLine');
  });

  it('CODE-12: a file name with a control character does not become a block number', () => {
    const t = def('{{N}}G1 ({{sys.file}})');
    const r = renderTemplate(t, {}, envOf(FANUC, { numbered: true, prev: 10, sys: { file: 'a\u0001b.nc' } }));
    expect(r).toEqual({ ok: true, text: 'N20 G1 (ab.nc)', blocks: 1 });
  });
});
