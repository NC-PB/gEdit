// P3.8: formula parameters (Phase 3 plan §6.11, AD-38). The grammar, exact decimals, the
// functions in degrees, the errors, the limits, and that no text can reach code execution.

import { describe, expect, it } from 'vitest';
import { hasKey } from '$lib/i18n';
import { checkFormula, evaluateFormulas, FORMULA_LIMITS, parseFormula } from './formula';
import { loadTemplates } from './load';
import type { TemplateDef, TemplateParam } from './types';

/** A template with numeric inputs `a`, `b`, `c` (and any extras) and one formula `f`. */
function tpl(formula: string, f: Partial<TemplateParam> = {}, extra: TemplateParam[] = []): TemplateDef {
  return {
    id: 't',
    label: 'T',
    group: 'G',
    body: '{{f}}',
    params: [
      { id: 'a', label: 'A', type: 'number' },
      { id: 'b', label: 'B', type: 'number' },
      { id: 'c', label: 'C', type: 'number' },
      ...extra,
      { id: 'f', label: 'Result', type: 'formula', formula, ...f },
    ],
  };
}

/** `tpl` with a number parameter for every other name the formula reads. */
function tplFor(formula: string, f: Partial<TemplateParam> = {}): TemplateDef {
  const parsed = parseFormula(formula);
  const refs = 'error' in parsed ? [] : parsed.refs.filter((r) => !['a', 'b', 'c'].includes(r));
  return tpl(formula, f, refs.map((id) => ({ id, label: id.toUpperCase(), type: 'number' })));
}

/** The value of `formula` with `values`; decimals 6 unless given, so the rounding shows. */
function calc(formula: string, values: Record<string, unknown> = {}, decimals: TemplateParam['decimals'] = 6): string | null {
  const r = evaluateFormulas(tplFor(formula, { decimals }), values);
  if (r.errors.f) throw new Error(`${formula}: ${r.errors.f.key} ${JSON.stringify(r.errors.f.params)}`);
  return r.values.f;
}

function errorOf(formula: string, values: Record<string, unknown> = {}): string | undefined {
  return evaluateFormulas(tpl(formula, { decimals: 6 }), values).errors.f?.key.replace('cycleForm.formula.', '');
}

describe('the grammar', () => {
  it('reads numbers, names, pi, the operators, parentheses and the functions', () => {
    for (const text of ['1', '.5', '12.', '0.05', 'a', 'pi', '-a', '+a', '--a', 'a + b * c', '(a + b) * c', 'a % b', 'sin(30)', 'round(a, 2)', 'round(a)', ' a\t*\nb ']) {
      const p = parseFormula(text);
      expect('error' in p, text).toBe(false);
    }
    expect(parseFormula('s * z * fz + sin(pi) + s')).toMatchObject({ refs: ['s', 'z', 'fz'] });
  });

  it('applies the usual precedence, left to right, and unary minus', () => {
    expect(calc('2 + 3 * 4')).toBe('14');
    expect(calc('(2 + 3) * 4')).toBe('20');
    expect(calc('10 - 4 - 3')).toBe('3');
    expect(calc('100 / 10 / 5')).toBe('2');
    expect(calc('2 * 3 % 4')).toBe('2');
    expect(calc('-2 * -3')).toBe('6');
    expect(calc('- (2 + 3)')).toBe('-5');
    expect(calc('--4')).toBe('4');
    expect(calc('-a + b', { a: '1', b: '3' })).toBe('2');
  });

  it('takes % as the remainder with the sign of the left side', () => {
    expect(calc('7 % 3')).toBe('1');
    expect(calc('-7 % 3')).toBe('-1');
    expect(calc('7 % -3')).toBe('1');
    expect(calc('7.5 % 2')).toBe('1.5');
  });

  it('refuses what is no formula, with the place in plain words', () => {
    const bad: [string, RegExp][] = [
      ['', /empty/],
      ['s * * z', /does not belong/],
      ['(1 + 2', /"\)" expected/],
      ['1 + 2)', /does not belong/],
      ['2 3', /does not belong/],
      ['2(3)', /does not belong/],
      ['sin 30', /parentheses/],
      ['sin()', /does not belong/],
      ['sin(1, 2)', /one value/],
      ['round(1, 2, 3)', /at most/],
      ['foo(1)', /no function/],
      ['pi(1)', /no function/],
      ['2e5', /no number/],
      ['1.2.3', /no number/],
      ['.', /point without digits/],
      ['2 ^ 3', /not part of a formula/],
      ['a = 1', /not part of a formula/],
      ['a.b', /point without digits/],
    ];
    for (const [text, why] of bad) {
      const p = parseFormula(text);
      expect('error' in p ? p.error : 'parsed', text).toMatch(why);
    }
  });

  it('keeps to the limits: characters, parts and nesting', () => {
    expect(parseFormula('1+'.repeat(200) + '1')).toMatchObject({ error: expect.stringMatching(/longer than 400/) });
    expect('error' in parseFormula('1+'.repeat(99) + '1')).toBe(false); // 199 parts
    expect(parseFormula('1+'.repeat(100) + '1')).toMatchObject({ error: expect.stringMatching(/more than 200 parts/) });
    const nested = (n: number): string => '('.repeat(n) + '1' + ')'.repeat(n);
    expect('error' in parseFormula(nested(FORMULA_LIMITS.depth - 1))).toBe(false);
    expect(parseFormula(nested(FORMULA_LIMITS.depth))).toMatchObject({ error: expect.stringMatching(/deeper than 32/) });
    expect(parseFormula('-'.repeat(40) + '1')).toMatchObject({ error: expect.stringMatching(/deeper than 32/) });
    expect(parseFormula('sin('.repeat(40) + '1' + ')'.repeat(40))).toMatchObject({ error: expect.stringMatching(/deeper than 32/) });
  });

  it('never throws, whatever the input', () => {
    for (const text of [null, undefined, 42, {}, [], 'x'.repeat(10_000), '\u0000', '((((', '))))', ',,,']) {
      expect(() => parseFormula(text as string)).not.toThrow();
      expect(() => evaluateFormulas(tpl(text as string), {})).not.toThrow();
    }
  });
});

describe('no code execution is possible', () => {
  const hostile = [
    'constructor',
    '__proto__',
    'prototype',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'globalThis',
    'process',
    'window',
    'eval',
    'Function',
    'this',
    'require',
    'a.constructor',
    'constructor.constructor',
    'constructor(1)',
    '__proto__ + 1',
    "constructor('return process')()",
    'eval("1")',
    'a[0]',
    'a;b',
    '`a`',
    '${a}',
    'a => 1',
    'new Date()',
    'import("x")',
  ];

  it('reads a name only as a parameter of the template: refused when the file is read', () => {
    const types = new Map([
      ['a', 'number'],
      ['b', 'number'],
    ] as const);
    for (const text of hostile) expect(checkFormula(text, types), text).not.toBeNull();
    expect(checkFormula('constructor', types)).toMatch(/"constructor", which is no parameter/);
    expect(checkFormula('__proto__ + 1', types)).toMatch(/"__proto__", which is no parameter/);
  });

  it('evaluates a hostile name to an error and a value object never reaches it', () => {
    // A values object whose prototype carries the names: only own properties are read.
    const values = Object.create({ constructor: '5', toString: '7', __proto__x: '1' }) as Record<string, unknown>;
    values.a = '2';
    for (const text of hostile) {
      const r = evaluateFormulas(tpl(text), values);
      expect(r.values.f, text).toBeNull();
    }
    // The global object is untouched: nothing was looked up on it or assigned.
    expect((globalThis as Record<string, unknown>).f).toBeUndefined();
  });

  it('a template that names `constructor` as a parameter does not pass the loader', () => {
    const problems: string[] = [];
    loadTemplates(
      [{ id: 'x', label: 'X', group: 'G', body: '{{f}}', params: [{ id: 'f', label: 'F', type: 'formula', formula: 'constructor * 2' }] }],
      (p) => problems.push(`${p.path}: ${p.message}`),
    );
    expect(problems).toEqual(['[0].params[0].formula: the formula reads "constructor", which is no parameter of this template']);
  });

  it('does not use eval or Function anywhere in the module', async () => {
    const source = (await import('./formula.ts?raw')).default as string;
    const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\beval\s*\(/);
    expect(code).not.toMatch(/\bnew\s+Function\b|\bFunction\s*\(/);
  });
});

describe('exact decimal arithmetic', () => {
  it('adds, subtracts and multiplies decimal text exactly', () => {
    expect(calc('0.1 + 0.2')).toBe('0.3');
    expect(calc('a + b', { a: '0.1', b: '0.2' })).toBe('0.3');
    expect(calc('1.1 * 1.1')).toBe('1.21');
    expect(calc('0.3 - 0.1')).toBe('0.2');
    expect(calc('a * b * c', { a: 1200, b: 4, c: '0.05' })).toBe('240');
    expect(calc('a - b', { a: '-0.', b: '0' })).toBe('0');
  });

  it('carries a division to 24 decimals before the parameter rounds it', () => {
    const r = evaluateFormulas(tpl('1 / 3 * 3', { decimals: 6 }), {});
    expect(r.values.f).toBe('1'); // 0.999…9 (24 nines) rounds to 1.000000
    expect(calc('1 / 3', {}, 6)).toBe('0.333333');
    expect(calc('2 / 3', {}, 6)).toBe('0.666667');
    expect(calc('2 / 3', {}, 0)).toBe('1');
    expect(calc('10 / 4', {}, 6)).toBe('2.5');
  });

  it('rounds the result half away from zero to the parameter decimals, at most 4 for as-entered and min1', () => {
    expect(calc('2.5', {}, 0)).toBe('3');
    expect(calc('-2.5', {}, 0)).toBe('-3');
    expect(calc('1.23456', {}, 'as-entered')).toBe('1.2346');
    expect(calc('1.23456', {}, 'min1')).toBe('1.2346');
    expect(evaluateFormulas(tpl('1.23456'), {}).values.f).toBe('1.2346'); // no decimals: as entered
    expect(calc('-0.00004', {}, 'as-entered')).toBe('0'); // never "-0"
    expect(calc('0.125', {}, 2)).toBe('0.13');
    expect(calc('-0.125', {}, 2)).toBe('-0.13');
    expect(calc('12', {}, 3)).toBe('12'); // plain text: the engine pads and writes the point
  });

  it('round, floor, ceil, abs and sign are exact', () => {
    expect(calc('round(2.5)')).toBe('3');
    expect(calc('round(-2.5)')).toBe('-3');
    expect(calc('round(2.4999)')).toBe('2');
    expect(calc('round(1.005, 2)')).toBe('1.01'); // exact: no binary 1.00499…
    expect(calc('round(a, 1)', { a: '-0.05' })).toBe('-0.1');
    expect(calc('floor(-2.5)')).toBe('-3');
    expect(calc('ceil(-2.5)')).toBe('-2');
    expect(calc('floor(2)')).toBe('2');
    expect(calc('ceil(2.0001)')).toBe('3');
    expect(calc('abs(-0.5)')).toBe('0.5');
    expect(calc('sign(-3) + sign(0) + sign(0.001)')).toBe('0');
  });
});

describe('the functions, in degrees, to 15 significant digits', () => {
  it('answers the exact angles exactly', () => {
    expect(calc('sin(30)')).toBe('0.5');
    expect(calc('sin(90)')).toBe('1');
    expect(calc('sin(180)')).toBe('0');
    expect(calc('sin(-30)')).toBe('-0.5');
    expect(calc('sin(150)')).toBe('0.5');
    expect(calc('sin(390)')).toBe('0.5');
    expect(calc('cos(60)')).toBe('0.5');
    expect(calc('cos(90)')).toBe('0');
    expect(calc('cos(180)')).toBe('-1');
    expect(calc('tan(45)')).toBe('1');
    expect(calc('tan(135)')).toBe('-1');
    expect(calc('tan(0)')).toBe('0');
    expect(calc('asin(0.5)')).toBe('30');
    expect(calc('acos(0)')).toBe('90');
    expect(calc('atan(1)')).toBe('45');
    expect(calc('sqrt(16)')).toBe('4');
    expect(calc('log(1000)')).toBe('3');
    expect(calc('ln(1)')).toBe('0');
  });

  it('keeps 15 significant digits of the others', () => {
    expect(calc('sqrt(2)', {}, 6)).toBe('1.414214');
    expect(evaluateFormulas(tpl('pi', { decimals: 6 }), {}).values.f).toBe('3.141593');
    expect(calc('ln(10)', {}, 6)).toBe('2.302585');
    expect(calc('sqrt(2) * sqrt(2)', {}, 6)).toBe('2');
  });

  it('refuses a value out of a function range, with the function and the value', () => {
    const cases: [string, string][] = [
      ['sqrt(-1)', 'outOfRange'],
      ['ln(0)', 'outOfRange'],
      ['log(-5)', 'outOfRange'],
      ['asin(2)', 'outOfRange'],
      ['acos(-1.5)', 'outOfRange'],
      ['tan(90)', 'outOfRange'],
      ['tan(-270)', 'outOfRange'],
      ['round(1, 7)', 'outOfRange'],
      ['round(1, 1.5)', 'outOfRange'],
      ['round(1, -1)', 'outOfRange'],
      ['1 / 0', 'divisionByZero'],
      ['1 % (a - a)', 'divisionByZero'],
      ['a / b', 'divisionByZero'],
      ['1000000000.1', 'tooLarge'],
      ['-a * 1000000', 'tooLarge'],
      ['tan(89.9999999999)', 'tooLarge'],
    ];
    for (const [text, why] of cases) expect(errorOf(text, { a: '5000', b: '0' }), text).toBe(why);
    const r = evaluateFormulas(tpl('sqrt(a)', { label: 'Depth' }), { a: '-4' });
    expect(r.errors.f).toEqual({ key: 'cycleForm.formula.outOfRange', params: { name: 'Depth', fn: 'sqrt', value: '-4' } });
    expect(errorOf('1000000000')).toBeUndefined(); // the bound itself is allowed
  });
});

describe('values, empties and order', () => {
  it('reads typed text, numbers and numeric choices, and refuses the rest', () => {
    const choice: TemplateParam = { id: 'k', label: 'Kind', type: 'choice', choices: [{ label: 'One', value: '1.5' }, { label: 'Word', value: 'ABC' }] };
    const t = tpl('a + k', { decimals: 6 }, [choice]);
    expect(evaluateFormulas(t, { a: ' 2 ', k: '1.5' }).values.f).toBe('3.5');
    expect(evaluateFormulas(t, { a: 2, k: '1.5' }).values.f).toBe('3.5');
    expect(evaluateFormulas(t, { a: '2', k: 'ABC' }).errors.f).toEqual({
      key: 'cycleForm.formula.notANumber',
      params: { name: 'Result', param: 'Kind' },
    });
    expect(evaluateFormulas(t, { a: '2,5', k: '1.5' }).errors.f?.key).toBe('cycleForm.formula.notANumber');
    expect(evaluateFormulas(t, { a: Number.NaN, k: '1.5' }).errors.f?.key).toBe('cycleForm.formula.notANumber');
  });

  it('is empty, without an error, when a referenced parameter is empty', () => {
    for (const a of [undefined, null, '', '   ']) {
      const r = evaluateFormulas(tpl('a * 2'), { a });
      expect(r).toEqual({ values: { f: null }, errors: {} });
    }
    // An unreferenced empty parameter does not matter.
    expect(evaluateFormulas(tpl('b * 2'), { a: '', b: '3' }).values.f).toBe('6');
  });

  it('computes formulas in dependency order and reads another formula as the form shows it', () => {
    const t: TemplateDef = {
      id: 't',
      label: 'T',
      group: 'G',
      body: '{{c}} {{b}}',
      params: [
        { id: 'c', label: 'C', type: 'formula', formula: 'b * 3', decimals: 4 },
        { id: 'b', label: 'B', type: 'formula', formula: 'a / 3', decimals: 2 },
        { id: 'a', label: 'A', type: 'number' },
      ],
    };
    expect(evaluateFormulas(t, { a: '1' })).toEqual({ values: { c: '0.99', b: '0.33' }, errors: {} });
    expect(evaluateFormulas(t, { a: '' })).toEqual({ values: { c: null, b: null }, errors: {} });
  });

  it('answers nothing for a template without a formula', () => {
    expect(evaluateFormulas({ id: 't', label: 'T', group: 'G', body: 'X' }, {})).toEqual({ values: {}, errors: {} });
  });

  it('refuses formulas in a circle and a formula that does not parse, by parameter', () => {
    const t: TemplateDef = {
      id: 't',
      label: 'T',
      group: 'G',
      body: '{{x}} {{y}} {{z}}',
      params: [
        { id: 'x', label: 'X', type: 'formula', formula: 'y + 1' },
        { id: 'y', label: 'Y', type: 'formula', formula: 'x * 2' },
        { id: 'z', label: 'Z', type: 'formula', formula: '1 +' },
      ],
    };
    const r = evaluateFormulas(t, {});
    expect(r.values).toEqual({ x: null, y: null, z: null });
    expect(r.errors.y).toEqual({ key: 'cycleForm.formula.circular', params: { name: 'Y' } });
    expect(r.errors.z?.key).toBe('cycleForm.formula.syntax');
  });

  it('every message it answers has an English text', () => {
    for (const key of ['divisionByZero', 'outOfRange', 'tooLarge', 'syntax', 'notANumber', 'circular']) {
      expect(hasKey(`cycleForm.formula.${key}`), key).toBe(true);
    }
  });
});

describe('formulas an NC programmer writes (no hidden units: the values are typed in the document units)', () => {
  it('the feed from speed, teeth and chip load', () => {
    expect(calc('s * z * fz', { s: '2400', z: '4', fz: '0.05' }, 0)).toBe('480');
  });

  it('the cutting speed in m/min from a diameter in mm and a speed in 1/min', () => {
    expect(calc('pi * d * n / 1000', { d: '10', n: '3000' }, 1)).toBe('94.2');
  });

  it('the length of a drill point from the diameter and the point angle (degrees)', () => {
    // 118 degrees, 10 mm: 5 / tan(59) = 3.0043…
    expect(calc('d / 2 / tan(w / 2)', { d: '10', w: '118' }, 3)).toBe('3.004');
    expect(calc('d / 2 / tan(w / 2)', { d: '8.5', w: '140' }, 3)).toBe('1.547');
  });

  it('the core hole of a metric ISO thread: nominal diameter minus 1.0825 times the pitch', () => {
    expect(calc('d - 1.0825 * p', { d: '10', p: '1.5' }, 3)).toBe('8.376');
    expect(calc('d - 1.0825 * p', { d: '0.375', p: '0.0625' }, 4)).toBe('0.3073'); // an inch value: the same formula, no conversion
  });

  it('the X of a point on a bolt circle', () => {
    expect(calc('r * cos(a)', { r: '50', a: '60' }, 3)).toBe('25');
    expect(calc('r * sin(a)', { r: '50', a: '60' }, 3)).toBe('43.301');
  });
});

describe('P3b fix code: long typed numbers', () => {
  it('CODE-08: 100,000 digits typed into a formula’s input answer at once (it took seconds)', () => {
    const t = tpl('a * 2');
    const typed = `1.${'0'.repeat(100_000)}`;
    const started = performance.now();
    const r = evaluateFormulas(t, { a: typed });
    const took = performance.now() - started;
    expect(r.errors.f?.key).toBe('cycleForm.formula.notANumber');
    expect(took).toBeLessThan(50);
  });

  it('CODE-08: a 40 character number still computes, and trailing zeros are dropped as before', () => {
    expect(evaluateFormulas(tpl('a * 2'), { a: `1.${'0'.repeat(38)}` }).values.f).toBe('2');
    expect(evaluateFormulas(tpl('a * 2'), { a: `1.${'0'.repeat(39)}` }).errors.f?.key).toBe('cycleForm.formula.notANumber');
    expect(evaluateFormulas(tpl('a + b'), { a: '1.50', b: '2.50' }).values.f).toBe('4');
    expect(evaluateFormulas(tpl('a * b'), { a: '0.5', b: '0.5' }).values.f).toBe('0.25');
    expect(evaluateFormulas(tpl('a - a'), { a: '12.340' }).values.f).toBe('0');
    expect(evaluateFormulas(tpl('a / 4'), { a: '100' }).values.f).toBe('25');
  });
});
