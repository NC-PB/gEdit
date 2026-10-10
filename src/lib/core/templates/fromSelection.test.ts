// P3.8: "New Template from Selection", the engine half (Phase 3 plan §6.11; the rules in the
// `fromSelection.ts` header). Every draft passes `loadTemplates`, the gate a user file passes.

import { describe, expect, it } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import type { CodeDb } from '$lib/core/codes/types';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { draftToTemplate, templateFromSelection } from './fromSelection';
import { loadTemplates } from './load';
import { renderTemplate, validateTemplateValues } from './engine';
import type { TemplateDef, TemplateDraft } from './types';

const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});
const db = (id: string): CodeDb => loadCodeDb(DBS[id]);

function draftOf(profile: string, codes: string, lines: string[]): TemplateDraft {
  return templateFromSelection(lines, cpOf(profile), db(codes));
}

/** `address=written→id` of every candidate, in order. */
function summary(d: TemplateDraft): string[] {
  return d.candidates.map((c) => `${c.address}=${c.written}→${c.param.id}`);
}

/** Loads one template through the file gate; the problems, or none. */
function problemsOf(t: TemplateDef): string[] {
  const problems: string[] = [];
  const loaded = loadTemplates([t], (p) => problems.push(`${p.path}: ${p.message}`));
  if (problems.length === 0) expect(loaded).toHaveLength(1);
  return problems;
}

/** The body with every placeholder written back from its parameter's default (what the engine renders for the defaults, `{{N}}` aside). */
function withDefaults(t: TemplateDef): string {
  const byId = new Map((t.params ?? []).map((p) => [p.id, p]));
  return t.body
    .replace(/(?<!\\)\{\{([a-z_][a-z0-9_]*)\}\}/g, (_m, id: string) => {
      const p = byId.get(id);
      if (!p) throw new Error(`no parameter ${id}`);
      return `${p.prefix ?? ''}${String(p.default)}`;
    });
}

function all(d: TemplateDraft): Set<string> {
  return new Set(d.candidates.map((c) => c.key));
}

const META = { id: 'my-drill', label: 'My drilling', group: 'Mine' };

describe('a numbered Fanuc selection', () => {
  const lines = ['N10 G0 X20. Y20.', 'N20 G98 G83 X20. Y60. Z-18. R3. Q4. F240. (DEEP {{1}})', 'X80. Y60.', 'N30 G0 Z-18. Z25. M9', 'T5 M6 S1200'];
  const d = draftOf('fanuc-gcode', 'fanuc', lines);

  it('turns block numbers into {{N}} (with their separator), keeps the rest byte for byte and escapes {{', () => {
    expect(d.body.split('\n')).toEqual([
      '{{N}}G0 X20. Y20.',
      '{{N}}G98 G83 X20. Y60. Z-18. R3. Q4. F240. (DEEP \\{{1}})',
      'X80. Y60.',
      '{{N}}G0 Z-18. Z25. M9',
      'T5 M6 S1200',
    ]);
  });

  it('offers the plain numbers, never a code or anything in a comment', () => {
    expect(summary(d)).toEqual([
      'X=20.→x',
      'Y=20.→y',
      'X=20.→x', // the same address and value: one parameter
      'Y=60.→y_2', // a second value of Y
      'Z=-18.→z',
      'R=3.→r',
      'Q=4.→q',
      'F=240.→f',
      'X=80.→x_2',
      'Y=60.→y_2',
      'Z=-18.→z',
      'Z=25.→z_2',
      'T=5→t',
      'S=1200→s',
    ]);
  });

  it('places each candidate on the draft body, and reads its style from how it is written', () => {
    const body = d.body.split('\n');
    for (const c of d.candidates) expect(body[c.line].slice(c.start, c.end)).toBe(`${c.param.prefix}${c.written}`);
    const z = d.candidates.find((c) => c.written === '-18.')!;
    expect(z.param).toEqual({ id: 'z', label: 'Hole bottom', type: 'number', required: true, prefix: 'Z', decimals: 'min1', default: '-18.' });
    const t = d.candidates.find((c) => c.address === 'T')!;
    expect(t.param).toMatchObject({ id: 't', type: 'integer', default: '5', prefix: 'T' });
    expect(t.param.decimals).toBeUndefined();
    expect(d.candidates.find((c) => c.address === 'X' && c.line === 0)!.param.label).toBe('X axis');
  });

  it('makes only the marked candidates parameters; the others stay literal', () => {
    const marked = new Set(d.candidates.filter((c) => ['Z', 'F'].includes(c.address)).map((c) => c.key));
    const t = draftToTemplate(d, marked, META);
    expect(t.body.split('\n')).toEqual([
      '{{N}}G0 X20. Y20.',
      '{{N}}G98 G83 X20. Y60. {{z}} R3. Q4. {{f}} (DEEP \\{{1}})',
      'X80. Y60.',
      '{{N}}G0 {{z}} {{z_2}} M9',
      'T5 M6 S1200',
    ]);
    expect(t.params?.map((p) => p.id)).toEqual(['z', 'f', 'z_2']);
    expect(problemsOf(t)).toEqual([]);
  });

  it('with every candidate marked, passes the loader and gives the selection back with the defaults', () => {
    const t = draftToTemplate(d, all(d), { ...META, machineType: 'mill' });
    expect(t).toMatchObject({ id: 'my-drill', label: 'My drilling', group: 'Mine', machineType: 'mill' });
    expect(t.review).toBeUndefined();
    expect(problemsOf(t)).toEqual([]);
    expect(withDefaults(t)).toBe(d.body);
    // Nothing marked: no parameters, still a template.
    const plain = draftToTemplate(d, new Set(), META);
    expect(plain.params).toBeUndefined();
    expect(plain.body).toBe(d.body);
    expect(problemsOf(plain)).toEqual([]);
  });
});

describe('Klartext', () => {
  const lines = [
    '18 CYCL DEF 200 DRILLING ~',
    '   Q200=2 ;CLEARANCE ~',
    '   Q206=FAUTO ;PLUNGE FEED ~',
    '   Q201=-15 ;DEPTH',
    '19 L X-30 Y+20 R0 FMAX M8',
    '20 L IX+5 Q12',
    '21 TOOL CALL 1 Z S3000 F800 DR-0.02',
    '22 Q1 = Q2 + 1',
  ];
  const d = draftOf('heidenhain-klartext', 'heidenhain', lines);

  it('numbers every block with {{N}} and leaves the ~ lines alone', () => {
    expect(d.body.split('\n')).toEqual([
      '{{N}}CYCL DEF 200 DRILLING ~',
      '   Q200=2 ;CLEARANCE ~',
      '   Q206=FAUTO ;PLUNGE FEED ~',
      '   Q201=-15 ;DEPTH',
      '{{N}}L X-30 Y+20 R0 FMAX M8',
      '{{N}}L IX+5 Q12',
      '{{N}}TOOL CALL 1 Z S3000 F800 DR-0.02',
      '{{N}}Q1 = Q2 + 1',
    ]);
  });

  it('offers a Q parameter set to a number with its = in the prefix, and never a code, a word value or a computed value', () => {
    expect(summary(d)).toEqual(['Q200=2→q200', 'Q201=-15→q201', 'X=-30→x', 'Y=+20→y', 'X=+5→x_2', 'S=3000→s', 'F=800→f', 'DR=-0.02→dr']);
    const q200 = d.candidates[0].param;
    expect(q200).toEqual({ id: 'q200', label: 'Safety clearance above the surface', type: 'number', required: true, prefix: 'Q200=', decimals: 'as-entered', default: '2' });
    // The point is not significant: `X-30` is a number as entered, `Y+20` keeps its plus sign, `IX` its I.
    expect(d.candidates[2].param).toMatchObject({ type: 'number', decimals: 'as-entered', default: '-30' });
    expect(d.candidates[3].param).toMatchObject({ plusSign: true, default: '+20' });
    expect(d.candidates[4].param).toMatchObject({ prefix: 'IX', plusSign: true, default: '+5' });
  });

  it('passes the loader and gives the selection back with the defaults', () => {
    const t = draftToTemplate(d, all(d), META);
    expect(problemsOf(t)).toEqual([]);
    expect(withDefaults(t)).toBe(d.body);
    expect(t.body.split('\n')[1]).toBe('   {{q200}} ;CLEARANCE ~');
  });
});

describe('Sinumerik and Okuma', () => {
  it('leaves calls, strings, expressions and main block numbers alone; a variable set to a number is offered', () => {
    const d = draftOf('sinumerik', 'sinumerik', ['N80 CYCLE83(5,0,2,-30,,-8,,2,0,0.5,1,0)', 'N170 S3=2400 M3=3', 'N40 T="DRILL_D10" D1', 'N10 X=IC(2) R5=3', ':100 G0 X10']);
    expect(d.body.split('\n')).toEqual(['{{N}}CYCLE83(5,0,2,-30,,-8,,2,0,0.5,1,0)', '{{N}}S3=2400 M3=3', '{{N}}T="DRILL_D10" D1', '{{N}}X=IC(2) R5=3', ':100 G0 X10']);
    expect(summary(d)).toEqual(['S3=2400→s3', 'D=1→d', 'R5=3→r5', 'X=10→x']);
    expect(d.candidates[0].param).toMatchObject({ prefix: 'S3=', type: 'number' });
    expect(d.candidates[1].param).toMatchObject({ type: 'integer' }); // a cutting edge number
    const t = draftToTemplate(d, all(d), META);
    expect(problemsOf(t)).toEqual([]);
    expect(withDefaults(t)).toBe(d.body);
  });

  it('reads a parameter by the code of its block (Okuma `G85 … D4` is a depth of cut, not a register)', () => {
    const d = draftOf('okuma-osp', 'okuma', ['N0100 G85 NAT01 D4 F0.3 U0.4 W0.2', '$ G84 XA=60 DA=2 FA=0.25', 'G181 X50 Z-12 C0 K3 F120 E0.5']);
    expect(d.body.split('\n')[0]).toBe('{{N}}G85 NAT01 D4 F0.3 U0.4 W0.2');
    const d4 = d.candidates.find((c) => c.address === 'D')!;
    expect(d4.param).toMatchObject({ type: 'number', decimals: 'as-entered', label: 'Depth of cut' });
    expect(summary(d)).toContain('XA=60→xa');
    const t = draftToTemplate(d, all(d), META);
    expect(problemsOf(t)).toEqual([]);
    expect(withDefaults(t)).toBe(d.body);
  });
});

describe('edges', () => {
  it('keeps a number written with a decimal comma literal (the engine writes a point)', () => {
    const d = draftOf('heidenhain-klartext', 'heidenhain', ['5 L X+10,5 Y+2']);
    expect(summary(d)).toEqual(['Y=+2→y']);
  });

  it('makes a third different value z_3, and keeps every id a valid, unreserved parameter id', () => {
    const d = draftOf('fanuc-gcode', 'fanuc', ['G0 Z1. Z2. Z3. Z2.', '#101=5 #102=6']);
    expect(summary(d)).toEqual(['Z=1.→z', 'Z=2.→z_2', 'Z=3.→z_3', 'Z=2.→z_2', '#101=5→_101', '#102=6→_102']);
    const t = draftToTemplate(d, all(d), META);
    expect(problemsOf(t)).toEqual([]);
  });

  it('leaves a label longer than the limit to the address, never shortened', () => {
    // The lathe G76 P label is long: the address stands in for it.
    const d = draftOf('fanuc-lathe', 'fanuc-lathe', ['G76 X18.16 Z-18. P920 Q250 F1.5']);
    const p = d.candidates.find((c) => c.address === 'P')!;
    expect(p.param.label).toBe('P');
    expect(problemsOf(draftToTemplate(d, all(d), META))).toEqual([]);
  });

  it('a draft the loader would refuse is refused there (an id typed wrong, a body over its limit)', () => {
    const d = draftOf('fanuc-gcode', 'fanuc', ['N10 G0 X1.']);
    expect(problemsOf(draftToTemplate(d, all(d), { ...META, id: 'My Drill' }))).toEqual(['[0].id: the id has to be lower-case letters, digits and -, at most 64 characters']);
    const big = draftOf('fanuc-gcode', 'fanuc', Array.from({ length: 201 }, (_, i) => `G0 X${i}.`));
    expect(problemsOf(draftToTemplate(big, new Set(), META))).toEqual(['[0].body: the body has more than 200 lines']);
  });

  it('an empty selection line and a line with only a block number stay', () => {
    const d = draftOf('fanuc-gcode', 'fanuc', ['', 'N10', '   N20 G0 X1.']);
    expect(d.body.split('\n')).toEqual(['', '{{N}}', '{{N}}G0 X1.']);
  });
});

// ---------------------------------------------------------------------------------------------
// P3b fix NC (plan §7 #253 ff.)
// ---------------------------------------------------------------------------------------------

describe('P3b fix NC: block numbers that the selection points at (NC-02)', () => {
  const SYS = { date: '', time: '', file: '', stem: '' };
  const defaultsOf = (t: TemplateDef): Record<string, string> => Object.fromEntries((t.params ?? []).map((p) => [p.id, String(p.default)]));
  const LATHE = ['N100 G71 U1.5 R0.5', 'N110 G71 P120 Q140 U0.4 W0.1 F0.25', 'N120 G0 X16.', 'N130 G1 Z-20.', 'N140 X34.', 'N150 G70 P120 Q140'];

  it('a P/Q pair and its contour blocks become one parameter each, outside the tick list', () => {
    const d = draftOf('fanuc-lathe', 'fanuc-lathe', LATHE);
    expect(d.body.split('\n')).toEqual([
      '{{N}}G71 U1.5 R0.5',
      '{{N}}G71 P{{p}} Q{{q}} U0.4 W0.1 F0.25',
      'N{{p}} G0 X16.',
      '{{N}}G1 Z-20.',
      'N{{q}} X34.',
      '{{N}}G70 P{{p}} Q{{q}}',
    ]);
    // Not a candidate: the user cannot untick half of a P/Q pair.
    expect(d.candidates.some((c) => c.address === 'P' || (c.address === 'Q' && c.line === 1))).toBe(false);
    const t = draftToTemplate(d, new Set(), META);
    expect(t.params?.map((p) => `${p.id}:${p.type}:${String(p.default)}`)).toEqual(['p:integer:120', 'q:integer:140']);
    expect(problemsOf(t)).toEqual([]);
    // Rendered after N500: P and Q name the contour blocks of the inserted text, nothing else.
    const r = renderTemplate(t, defaultsOf(t), { cp: cpOf('fanuc-lathe'), prevBlockNumber: 500, numbered: true, sys: SYS });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const out = r.text.split('\n');
    expect(out[1]).toBe('N520 G71 P120 Q140 U0.4 W0.1 F0.25');
    expect(out[2]).toBe('N120 G0 X16.');
    expect(out[4]).toBe('N140 X34.');
    expect(out[5]).toBe('N540 G70 P120 Q140');
  });

  it('a GOTO and its target agree (Fanuc, Sinumerik)', () => {
    const f = draftOf('fanuc-gcode', 'fanuc', ['N50 GOTO 70', 'N60 G0 X1.', 'N70 M30']);
    expect(f.body.split('\n')).toEqual(['{{N}}GOTO {{goto}}', '{{N}}G0 X1.', 'N{{goto}} M30']);
    const s2 = draftOf('sinumerik', 'sinumerik', ['N40 GOTOF N60', 'N50 X1', 'N60 M30']);
    expect(s2.body.split('\n')).toEqual(['{{N}}GOTOF N{{n}}', '{{N}}X1', 'N{{n}} M30']);
    expect(problemsOf(draftToTemplate(s2, new Set(), META))).toEqual([]);
  });

  it('an Okuma LAP contour name becomes one parameter in all three places', () => {
    const d = draftOf('okuma-osp', 'okuma', ['NLAP1 G81', 'G0 X16', 'G1 X34', 'G80', 'N20 G0 X80 Z5', 'N30 G85 NLAP1 D3 F0.3 U0.4 W0.2', 'N40 G87 NLAP1']);
    expect(d.body.split('\n')).toEqual(['{{name}} G81', 'G0 X16', 'G1 X34', 'G80', '{{N}}G0 X80 Z5', '{{N}}G85 {{name}} D3 F0.3 U0.4 W0.2', '{{N}}G87 {{name}}']);
    const t = draftToTemplate(d, new Set(), META);
    expect(t.params).toEqual([expect.objectContaining({ id: 'name', type: 'text', default: 'NLAP1', uppercase: true, required: true })]);
    expect(problemsOf(t)).toEqual([]);
  });

  it('a block number behind a block-delete slash stays as written and is said (the loader takes {{N}} only at a line start); a referenced one is a parameter', () => {
    const d = draftOf('fanuc-gcode', 'fanuc', ['/N40 G98 G83 X1. Y1. Z-5. R2. Q3. F100.', 'N50 G80']);
    expect(d.body.split('\n')).toEqual(['/N40 G98 G83 X1. Y1. Z-5. R2. Q3. F100.', '{{N}}G80']);
    expect(d.notes).toEqual([{ key: 'templates.fromSelection.skipNumberKept', params: { words: '/N40' } }]);
    expect(problemsOf(draftToTemplate(d, all(d), META))).toEqual([]);
    const ref = draftOf('fanuc-gcode', 'fanuc', ['N10 GOTO 40', '/N40 G0 X1.']);
    expect(ref.body.split('\n')).toEqual(['{{N}}GOTO {{goto}}', '/N{{goto}} G0 X1.']);
    expect(problemsOf(draftToTemplate(ref, new Set(), META))).toEqual([]);
  });

  it('a reference to a block outside the selection stays as written, is no candidate, and the draft says so', () => {
    const d = draftOf('fanuc-lathe', 'fanuc-lathe', ['N10 G70 P100 Q200']);
    expect(d.body).toBe('{{N}}G70 P100 Q200');
    expect(d.candidates).toEqual([]);
    expect(d.notes).toEqual([{ key: 'templates.fromSelection.referencedKept', params: { words: 'P100 Q200' } }]);
  });
});

describe('P3b fix NC: words in least increments (NC-10) and long numbers (CODE-01)', () => {
  it('a peck or a cut depth in least increments is a whole number, never a point', () => {
    const d = draftOf('fanuc-lathe', 'fanuc-lathe', ['N30 G76 P011060 Q100 R0.2', 'N40 G76 X60.64 Z25. P3680 Q1800 F6.']);
    for (const written of ['100', '1800', '3680']) expect(d.candidates.find((x) => x.written === written)?.param.type, written).toBe('integer');
    // The two Q words are read in least increments; the database says so, and the label too.
    for (const written of ['100', '1800']) expect(d.candidates.find((x) => x.written === written)?.param.label, written).toMatch(/least increments, no point/);
    const t = draftToTemplate(d, all(d), META);
    const q = d.candidates.find((x) => x.written === '100')!.param.id;
    const values = { ...Object.fromEntries((t.params ?? []).map((p) => [p.id, String(p.default)])), [q]: '0.1' };
    expect(validateTemplateValues(t, values)[q]?.key).toBe('templates.value.notAnInteger');
  });

  it('a 100,000-digit number with a decimal comma is read in linear time', () => {
    const line = `1 L X${'1'.repeat(100_000)},5`;
    const start = performance.now();
    const d = draftOf('heidenhain-klartext', 'heidenhain', [line]);
    expect(performance.now() - start).toBeLessThan(500);
    expect(d.candidates).toEqual([]);
  });
});
