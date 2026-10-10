// The template file format (Phase 3 plan §6.11). Owner: P3.4.
//
// What is pinned: what a file may say, what makes a template unusable (dropped, with the JSON
// path and a plain reason), the limits, the "review pending" marker and the machine-type filter.
// The engine (`engine.ts`) is P3.4's and is tested there.

import { describe, expect, it } from 'vitest';
import {
  loadTemplates,
  placeholdersOf,
  templateCommandId,
  templateIdOfCommand,
  templateMemoKey,
  templatesForMachine,
  TEMPLATE_LIMITS,
  type TemplateProblem,
} from './index';
import { checkFormula, formulaRefs } from './formula';
import { loadCodeDb, type CodeDbProblem } from '$lib/core/codes/load';

function load(raw: unknown): { ids: string[]; problems: TemplateProblem[]; templates: ReturnType<typeof loadTemplates> } {
  const problems: TemplateProblem[] = [];
  const templates = loadTemplates(raw, (p) => problems.push(p));
  return { ids: templates.map((t) => t.id), problems, templates };
}

const DRILL = {
  id: 'drill-g81',
  label: 'Drilling (G81)',
  group: 'Drilling',
  description: 'One hole with a simple drilling cycle, then cancel.',
  toolbar: true,
  review: 'pending',
  machineType: 'mill',
  body: '{{N}}G81 {{x}} {{y}} {{z}} {{r}} {{f}}\n{{N}}G80',
  params: [
    { id: 'x', label: 'X', type: 'number', prefix: 'X', decimals: 'min1' },
    { id: 'y', label: 'Y', type: 'number', prefix: 'Y', decimals: 'min1' },
    { id: 'z', label: 'Depth', type: 'number', prefix: 'Z', decimals: 'min1', required: true, max: 0 },
    { id: 'r', label: 'Approach plane', type: 'number', prefix: 'R', decimals: 'min1', default: 2 },
    { id: 'f', label: 'Feed', type: 'number', prefix: 'F', decimals: 0, min: 1, remember: true },
  ],
};

describe('loadTemplates: a good file', () => {
  it('reads the example of code-assistant.md member by member', () => {
    const { templates, problems } = load([DRILL]);
    expect(problems).toEqual([]);
    expect(templates).toEqual([
      {
        id: 'drill-g81',
        label: 'Drilling (G81)',
        group: 'Drilling',
        description: 'One hole with a simple drilling cycle, then cancel.',
        toolbar: true,
        review: 'pending',
        machineType: 'mill',
        body: '{{N}}G81 {{x}} {{y}} {{z}} {{r}} {{f}}\n{{N}}G80',
        params: [
          { id: 'x', label: 'X', type: 'number', prefix: 'X', decimals: 'min1' },
          { id: 'y', label: 'Y', type: 'number', prefix: 'Y', decimals: 'min1' },
          { id: 'z', label: 'Depth', type: 'number', prefix: 'Z', decimals: 'min1', required: true, max: 0 },
          { id: 'r', label: 'Approach plane', type: 'number', prefix: 'R', decimals: 'min1', default: 2 },
          { id: 'f', label: 'Feed', type: 'number', prefix: 'F', decimals: 0, min: 1, remember: true },
        ],
      },
    ]);
  });

  it('has no templates and no problem when the member is absent', () => {
    expect(load(undefined)).toEqual({ ids: [], problems: [], templates: [] });
  });

  it('reads choices, text, comments, formulas, sys placeholders, escapes and a snippet', () => {
    const { ids, problems, templates } = load([
      {
        id: 'tool-start',
        label: 'Tool start',
        group: 'Tool change',
        body: '{{N}}T{{t}} {{name}}\n{{N}}G96 S{{vc}} {{dir}}\n\\{{ literal }}\n({{sys.date}} {{sys.stem}})',
        params: [
          { id: 't', label: 'Tool', type: 'integer', min: 1, max: 99, digits: 2, required: true },
          { id: 'name', label: 'Tool name', type: 'text', comment: true, uppercase: true, default: 'ROUGH' },
          { id: 'vc', label: 'Surface speed', type: 'integer', min: 1, default: 200 },
          {
            id: 'dir',
            label: 'Direction',
            type: 'choice',
            choices: [
              { label: 'Clockwise', value: 'M3' },
              { label: 'Counter-clockwise', value: 'M4' },
            ],
            default: 'M4',
          },
        ],
      },
      {
        id: 'feed-calc',
        label: 'Feed from chip load',
        group: 'Calculators',
        body: '{{f}}',
        params: [
          { id: 's', label: 'Speed', type: 'integer', min: 1, default: 1000 },
          { id: 'z', label: 'Teeth', type: 'integer', min: 1, default: 4 },
          { id: 'fz', label: 'Chip load', type: 'number', min: 0, default: '0.05' },
          { id: 'f', label: 'Feed', type: 'formula', formula: 's * z * fz', prefix: 'F', decimals: 0 },
        ],
      },
      { id: 'safe-retract', label: 'Safe retract', group: 'Moves', snippet: true, body: '{{N}}G0 ${1:Z100.}' },
    ]);
    expect(problems).toEqual([]);
    expect(ids).toEqual(['tool-start', 'feed-calc', 'safe-retract']);
    expect(templates[1].params?.[3]).toEqual({ id: 'f', label: 'Feed', type: 'formula', formula: 's * z * fz', prefix: 'F', decimals: 0 });
    expect(templates[0].params?.[2].default).toBe(200);
    expect(templates[1].params?.[2].default).toBe('0.05');
  });

  it('keeps a prefix or suffix as written, spaces included, and reads CRLF bodies as LF', () => {
    const { templates, problems } = load([
      { id: 'q', label: 'Q', group: 'G', body: 'A\r\nB{{q}}\rC', params: [{ id: 'q', label: 'Q', type: 'number', prefix: ' Q201=', suffix: ' ' }] },
    ]);
    expect(problems).toEqual([]);
    expect(templates[0].body).toBe('A\nB{{q}}\nC');
    expect(templates[0].params?.[0].prefix).toBe(' Q201=');
  });
});

describe('loadTemplates: what drops a template, with its path', () => {
  const cases: [string, unknown, string][] = [
    ['an id with capitals', { ...DRILL, id: 'Drill' }, '[0].id'],
    ['an id with a trailing hyphen', { ...DRILL, id: 'drill-' }, '[0].id'],
    ['no label', { ...DRILL, label: '' }, '[0].label'],
    ['no group', { ...DRILL, group: undefined }, '[0].group'],
    ['a two-line label', { ...DRILL, label: 'a\nb' }, '[0].label'],
    ['a label too long', { ...DRILL, label: 'x'.repeat(TEMPLATE_LIMITS.label + 1) }, '[0].label'],
    ['no body', { ...DRILL, body: ' ' }, '[0].body'],
    ['a body too long', { ...DRILL, body: 'G0\n'.repeat(TEMPLATE_LIMITS.body) }, '[0].body'],
    ['a body with too many lines', { ...DRILL, body: '\n'.repeat(TEMPLATE_LIMITS.bodyLines) + '{{x}}' }, '[0].body'],
    ['a placeholder that names no parameter', { ...DRILL, body: '{{x}} {{q}}' }, '[0].body'],
    ['{{N}} inside a line', { ...DRILL, body: 'G0 {{N}}' }, '[0].body'],
    ['a placeholder with spaces', { ...DRILL, body: '{{ x }}' }, '[0].body'],
    ['an unclosed placeholder', { ...DRILL, body: 'G0 {{x' }, '[0].body'],
    ['a machine type that is neither', { ...DRILL, machineType: 'router' }, '[0].machineType'],
    ['params that are no list', { ...DRILL, params: {} }, '[0].params'],
    ['too many params', { ...DRILL, body: 'G0', params: Array.from({ length: TEMPLATE_LIMITS.params + 1 }, (_, i) => ({ id: `p${i}`, label: 'P', type: 'number' })) }, '[0].params'],
    ['a parameter id used twice', { ...DRILL, params: [DRILL.params[0], DRILL.params[0]] }, '[0].params[1].id'],
    ['a parameter id with capitals', { ...DRILL, params: [{ ...DRILL.params[0], id: 'X' }] }, '[0].params[0].id'],
    ['a reserved parameter id', { ...DRILL, body: '{{sin}}', params: [{ id: 'sin', label: 'S', type: 'number' }] }, '[0].params[0].id'],
    ['a parameter type it does not know', { ...DRILL, params: [{ ...DRILL.params[0], type: 'float' }] }, '[0].params[0].type'],
    ['min above max', { ...DRILL, params: [{ ...DRILL.params[0], min: 5, max: 1 }] }, '[0].params[0].min'],
    ['a fractional bound on an integer', { ...DRILL, body: '{{x}}', params: [{ id: 'x', label: 'X', type: 'integer', max: 2.5 }] }, '[0].params[0].max'],
    ['a default below min', { ...DRILL, params: [{ ...DRILL.params[0], min: 0, default: -1 }] }, '[0].params[0].default'],
    ['a default with more decimals than fixed', { ...DRILL, params: [{ ...DRILL.params[0], decimals: 2, default: '1.005' }] }, '[0].params[0].default'],
    ['a default that is no number', { ...DRILL, params: [{ ...DRILL.params[0], default: '1,5' }] }, '[0].params[0].default'],
    ['a fractional default on an integer', { ...DRILL, body: '{{x}}', params: [{ id: 'x', label: 'X', type: 'integer', default: '2.0' }] }, '[0].params[0].default'],
    ['a choice without choices', { ...DRILL, body: '{{d}}', params: [{ id: 'd', label: 'D', type: 'choice' }] }, '[0].params[0].choices'],
    ['a choice value twice', { ...DRILL, body: '{{d}}', params: [{ id: 'd', label: 'D', type: 'choice', choices: [{ label: 'a', value: 'M3' }, { label: 'b', value: 'M3' }] }] }, '[0].params[0].choices[1].value'],
    ['a choice default that is no choice', { ...DRILL, body: '{{d}}', params: [{ id: 'd', label: 'D', type: 'choice', choices: [{ label: 'a', value: 'M3' }], default: 'M5' }] }, '[0].params[0].default'],
    ['decimals on a text', { ...DRILL, body: '{{c}}', params: [{ id: 'c', label: 'C', type: 'text', decimals: 2 }] }, '[0].params[0].decimals'],
    ['decimals out of range', { ...DRILL, params: [{ ...DRILL.params[0], decimals: 7 }] }, '[0].params[0].decimals'],
    ['digits on a number', { ...DRILL, params: [{ ...DRILL.params[0], digits: 4 }] }, '[0].params[0].digits'],
    ['a prefix with a brace', { ...DRILL, params: [{ ...DRILL.params[0], prefix: 'X{' }] }, '[0].params[0].prefix'],
    ['a prefix too long', { ...DRILL, params: [{ ...DRILL.params[0], prefix: 'X'.repeat(TEMPLATE_LIMITS.affix + 1) }] }, '[0].params[0].prefix'],
    ['a text default that is not upper case', { ...DRILL, body: '{{c}}', params: [{ id: 'c', label: 'C', type: 'text', uppercase: true, default: 'rough' }] }, '[0].params[0].default'],
    ['a formula without its formula', { ...DRILL, body: '{{f}}', params: [{ id: 'f', label: 'F', type: 'formula' }] }, '[0].params[0].formula'],
    ['a formula that reads a text', { ...DRILL, body: '{{f}}', params: [{ id: 'c', label: 'C', type: 'text' }, { id: 'f', label: 'F', type: 'formula', formula: 'c * 2' }] }, '[0].params[1].formula'],
    ['a formula that reads no parameter', { ...DRILL, body: '{{f}}', params: [{ id: 'f', label: 'F', type: 'formula', formula: 'q * 2' }] }, '[0].params[0].formula'],
    ['a formula with a character it cannot use', { ...DRILL, body: '{{f}}', params: [{ id: 'f', label: 'F', type: 'formula', formula: '2 ^ 3' }] }, '[0].params[0].formula'],
    ['a required formula', { ...DRILL, body: '{{f}}', params: [{ id: 'f', label: 'F', type: 'formula', formula: '2', required: true }] }, '[0].params[0].required'],
    ['formulas in a circle', { ...DRILL, body: '{{a}}', params: [{ id: 'a', label: 'A', type: 'formula', formula: 'b + 1' }, { id: 'b', label: 'B', type: 'formula', formula: 'a * 2' }] }, '[0].params'],
    ['a snippet with params', { ...DRILL, snippet: true }, '[0].params'],
  ];

  it.each(cases)('%s', (_name, template, path) => {
    const { ids, problems } = load([template, { ...DRILL, id: 'kept' }]);
    expect(ids).toEqual(['kept']);
    expect(problems.map((p) => p.path)).toEqual([path]);
    expect(problems[0].message).not.toBe('');
  });

  it('drops the second template of an id, and keeps reading the rest', () => {
    const { ids, problems } = load([DRILL, { ...DRILL, label: 'Other' }, { ...DRILL, id: 'next' }]);
    expect(ids).toEqual(['drill-g81', 'next']);
    expect(problems).toEqual([{ path: '[1].id', message: 'the id "drill-g81" is used twice in this file' }]);
  });

  it('keeps a template whose optional flag is mistyped, read as absent, and says so', () => {
    const { templates, problems } = load([{ ...DRILL, toolbar: 'yes', review: 'done' }]);
    expect(templates[0].toolbar).toBeUndefined();
    expect(templates[0].review).toBeUndefined();
    expect(problems.map((p) => p.path)).toEqual(['[0].toolbar', '[0].review']);
  });

  it('reads no more than the limit, and says so once', () => {
    const many = Array.from({ length: TEMPLATE_LIMITS.templates + 5 }, (_, i) => ({ ...DRILL, id: `t${i}` }));
    const { ids, problems } = load(many);
    expect(ids).toHaveLength(TEMPLATE_LIMITS.templates);
    expect(problems).toHaveLength(1);
    expect(problems[0].path).toBe(`[${TEMPLATE_LIMITS.templates}]`);
  });

  it('answers one problem for a member that is no list', () => {
    expect(load({ drill: DRILL })).toEqual({ ids: [], problems: [{ path: '', message: 'templates has to be a list' }], templates: [] });
  });
});

describe('placeholders', () => {
  it('lists the parameters a body uses, skips escapes and sys placeholders', () => {
    const found = placeholdersOf('{{N}}G0 {{x}}\n\\{{y}} {{sys.time}} {{x}}', new Set(['x', 'y']));
    expect('used' in found && [...found.used]).toEqual(['x']);
  });
});

describe('the formula check of the prelude (P3.8 adds the full parse)', () => {
  const types = new Map([
    ['s', 'integer'],
    ['z', 'integer'],
    ['fz', 'number'],
    ['c', 'text'],
  ] as const);
  it('reads the references, never a function, pi or a digit-glued name', () => {
    expect(formulaRefs('s * z * fz + sin(pi) + 2e5')).toEqual(['s', 'z', 'fz']);
  });
  it('accepts a formula over numbers, and refuses the rest in plain words', () => {
    expect(checkFormula('round(s * z * fz, 0)', types)).toBeNull();
    expect(checkFormula('', types)).toMatch(/empty/);
    expect(checkFormula('c * 2', types)).toMatch(/text parameter/);
    expect(checkFormula('q', types)).toMatch(/no parameter/);
    expect(checkFormula('s; z', types)).toMatch(/may use/);
    expect(checkFormula('1+'.repeat(300), types)).toMatch(/longer than/);
  });
});

describe('ids, commands, memory keys and the machine-type filter', () => {
  it('builds the command and the memory key from the ids', () => {
    expect(templateCommandId('program-start')).toBe('insert.template:program-start');
    expect(templateIdOfCommand('insert.template:program-start')).toBe('program-start');
    expect(templateIdOfCommand('insert.template:')).toBeNull();
    expect(templateMemoKey('fanuc-lathe', 'tool-start')).toBe('template:fanuc-lathe:tool-start');
  });

  it('shows a document the unmarked templates and those of its machine type', () => {
    const { templates } = load([
      { ...DRILL, id: 'mill', machineType: 'mill' },
      { ...DRILL, id: 'lathe', machineType: 'lathe' },
      { ...DRILL, id: 'both', machineType: undefined },
    ]);
    expect(templatesForMachine(templates, 'lathe').map((t) => t.id)).toEqual(['lathe', 'both']);
    expect(templatesForMachine(templates, 'mill').map((t) => t.id)).toEqual(['mill', 'both']);
    expect(templatesForMachine(templates, undefined).map((t) => t.id)).toEqual(['both']);
    expect(templatesForMachine(undefined, 'mill')).toEqual([]);
  });
});

describe('the code database loader reads the member (core/codes/load.ts)', () => {
  it('leaves a database without templates as it was, and reads them with paths below the member', () => {
    const problems: CodeDbProblem[] = [];
    const plain = loadCodeDb({ dialect: 'x', version: 1, codes: [] });
    expect('templates' in plain).toBe(false);
    const db = loadCodeDb({ dialect: 'x', version: 1, codes: [], templates: [DRILL, { ...DRILL, id: 'Bad' }] }, (p) => problems.push(p));
    expect(db.templates?.map((t) => t.id)).toEqual(['drill-g81']);
    expect(problems.map((p) => p.path)).toEqual(['templates[1].id']);
  });

  it('reads blocks: 2 on a cycle and refuses any other value', () => {
    const problems: CodeDbProblem[] = [];
    const db = loadCodeDb(
      {
        dialect: 'x',
        version: 1,
        codes: [
          { code: 'G71', label: 'Rough turning', blocks: 2 },
          { code: 'G76', label: 'Threading', blocks: 3 },
        ],
      },
      (p) => problems.push(p),
    );
    expect(db.codes.map((e) => [e.code, e.blocks ?? null])).toEqual([
      ['G71', 2],
      ['G76', null],
    ]);
    expect(problems.map((p) => p.path)).toEqual(['codes[1].blocks']);
  });
});

describe('P3b fix code: the loader’s edges', () => {
  const numberTemplate = (def: unknown, id = 'n') => [{ id: 't', label: 'T', group: 'G', body: '{{N}}G1 {{x}}', params: [{ id, label: 'X', type: 'number', default: def }] }];

  it('CODE-01: a number default of 100,000 digits and a letter is refused at once (it took seconds)', () => {
    const started = performance.now();
    const r = load(numberTemplate(`${'1'.repeat(100_000)}x`, 'x'));
    const took = performance.now() - started;
    expect(r.ids).toEqual([]);
    expect(r.problems[0].message).toContain('at most 40 characters');
    expect(took).toBeLessThan(50);
  });

  it('CODE-01: a default of 41 characters is refused with the length message, 40 is read, and the usual numbers still pass', () => {
    expect(load(numberTemplate('1'.repeat(41), 'x')).problems[0].message).toContain('at most 40 characters');
    expect(load(numberTemplate('1'.repeat(40), 'x')).ids).toEqual(['t']);
    for (const ok of ['5', '-5.', '+.5', '10.25', 12, -0.5]) expect(load(numberTemplate(ok, 'x')).ids).toEqual(['t']);
    for (const bad of ['', '.', '1.2.3', '1e3', '--1', '1 2']) expect(load(numberTemplate(bad, 'x')).ids).toEqual([]);
  });

  it('CODE-05: __proto__ is a reserved parameter id; ids that start with _ stay valid (from selection names #101 _101)', () => {
    const withId = (id: string) => load([{ id: 't', label: 'T', group: 'G', body: '{{N}}G1 X{{' + id + '}}', params: [{ id, label: 'X', type: 'number' }] }]);
    const refused = withId('__proto__');
    expect(refused.ids).toEqual([]);
    expect(refused.problems[0].message).toContain('reserved');
    expect(withId('_101').ids).toEqual(['t']);
    expect(withId('__x').ids).toEqual(['t']);
  });

  it('CODE-12: an invisible control character in a body, an affix, a text default or a choice value is refused', () => {
    const one = (patch: Record<string, unknown>, param: Record<string, unknown> = {}) =>
      load([{ id: 't', label: 'T', group: 'G', body: '{{N}}G1 {{p}}', params: [{ id: 'p', label: 'P', type: 'text', ...param }], ...patch }]);
    expect(one({}).ids).toEqual(['t']);
    expect(one({ body: '{{N}}G1 A\u0001B {{p}}' }).problems[0].message).toContain('control character');
    expect(one({}, { prefix: 'A\u0001' }).problems[0].message).toContain('control character');
    expect(one({}, { default: 'A\u0002B' }).problems[0].message).toContain('control character');
    const choice = load([{ id: 't', label: 'T', group: 'G', body: '{{p}}', params: [{ id: 'p', label: 'P', type: 'choice', choices: [{ label: 'A', value: 'a\u0001' }] }] }]);
    expect(choice.problems[0].message).toContain('control character');
    // A tab is fine in a body.
    expect(one({ body: '{{N}}G1\t{{p}}' }).ids).toEqual(['t']);
  });
});
