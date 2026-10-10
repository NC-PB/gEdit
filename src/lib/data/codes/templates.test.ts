// The built-in template content (Phase 3 plan §5 P3.6, P2 §8.6, AD-28, AD-37, AD-39). Owner: P3.6.
//
// What the content promises, file by file and template by template:
//
//   - every database's `templates` load without a problem (the same gate as a user file);
//   - every built-in database has `program-start` (the Home tab's button) and `program-end`, and
//     every built-in profile sees both through `templatesForMachine`;
//   - every built-in template is marked `review: 'pending'` — **owner decision of 2026-10-09**:
//     the content ships unreviewed and says so; the owner's review deletes the mark template by
//     template, and this expectation with the last one;
//   - a database that profiles of both machine types read marks its templates with `machineType`
//     (`fanuc` is read by the lathe through `extends`; `sinumerik` by the turning and the milling
//     profile). The one exception, written out below: Sinumerik's `program-start` and
//     `program-end` serve both machine types, because a file holds an id once and both profiles
//     need the Home button;
//   - `blocks: 2` stands exactly on the cycles the manuals write in two blocks with the same code
//     (the Fanuc lathe G71–G76), so the cycle form refuses them;
//   - one golden per template (`tests/fixtures/templates/<db>/<id>.json`): its text tokenizes with
//     its profile without an `unknown` token, its G and M codes and its cycle calls are in the
//     database, and with the database's program start and end around it it is detected as its
//     profile. The goldens were rendered by the P3.4 engine with the P3.8 formula evaluator; this
//     file renders them again and compares.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import { lookupCode } from '$lib/core/codes/lookup';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectResult, detectVariants } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { loadTemplates, PROGRAM_START_TEMPLATE_ID, templatesForMachine } from '$lib/core/templates/load';
import { renderTemplate, templateFields, validateTemplateValues } from '$lib/core/templates/engine';
import { initialValues } from '$lib/core/forms/values';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TemplateDef, TemplateProblem } from '$lib/core/templates/types';
import type { LineState } from '$lib/core/nc/types';

const GOLDEN_DIR = fileURLToPath(new URL('../../../../tests/fixtures/templates/', import.meta.url));

const PROFILES: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});
const profile = (id: string): CompiledProfile => {
  const found = PROFILES.find((cp) => cp.profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
};

const PROBLEMS: string[] = [];
const DBS: Record<string, CodeDb> = resolveCodeDbs(BUILTIN_CODE_DB_JSON, (dialect, p) => PROBLEMS.push(`${dialect} ${p.path}: ${p.message}`));
const FILES = BUILTIN_CODE_DB_JSON as Record<string, { templates?: unknown[]; codes: { code: string; blocks?: unknown }[] }>;

/** The templates a file writes itself (not the ones it inherits), as the loader reads them. */
function ownTemplates(db: string): TemplateDef[] {
  return loadTemplates(FILES[db].templates);
}

/** Which database a profile reads, by machine-type and G-code system. */
const PROFILE_DBS: { profile: string; db: string }[] = [
  { profile: 'fanuc-gcode', db: 'fanuc' },
  { profile: 'fanuc-lathe', db: 'fanuc-lathe' },
  { profile: 'fanuc-lathe', db: 'fanuc-lathe-b' },
  { profile: 'heidenhain-klartext', db: 'heidenhain' },
  { profile: 'okuma-osp', db: 'okuma' },
  { profile: 'sinumerik', db: 'sinumerik' },
  { profile: 'sinumerik-mill', db: 'sinumerik' },
];

/** Databases read by profiles of both machine types, and the templates there that serve both. */
const SHARED: Record<string, string[]> = {
  fanuc: [],
  'fanuc-lathe': [],
  'fanuc-lathe-b': [],
  sinumerik: ['program-start', 'program-end'],
};

interface Golden {
  $format: 1;
  codes: string;
  profile: string;
  template: string;
  values: Record<string, string>;
  env: { prevBlockNumber: number | null; numbered: boolean; sys: { date: string; time: string; file: string; stem: string } };
  expected: string;
}

function golden(db: string, id: string): Golden {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, db, `${id}.json`), 'utf8')) as Golden;
}

/** Every golden on disk, by database. */
const GOLDENS: { db: string; id: string }[] = readdirSync(GOLDEN_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(join(GOLDEN_DIR, d.name)).filter((f) => f.endsWith('.json')).map((f) => ({ db: d.name, id: f.slice(0, -5) })));

/** The template of a golden, from the resolved database (where it is rendered from). */
function templateOf(db: string, id: string): TemplateDef {
  const t = (DBS[db].templates ?? []).find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id} in ${db}`);
  return t;
}

/** The values a golden renders with: the template's defaults, then the golden's own. */
function valuesOf(t: TemplateDef, g: Golden): Record<string, string> {
  const values: Record<string, string> = {};
  for (const p of t.params ?? []) if (p.default !== undefined) values[p.id] = String(p.default);
  return { ...values, ...g.values };
}

function tokens(text: string, cp: CompiledProfile) {
  let state: LineState | undefined;
  return text.split('\n').map((line, n) => {
    const r = tokenizeLine(line, cp, state);
    state = r.state;
    return { line: n + 1, text: line, tokens: r.tokens };
  });
}

describe('the built-in templates load', () => {
  it('every database resolves and loads without a problem', () => {
    expect(PROBLEMS).toEqual([]);
  });

  it.each(Object.keys(FILES))('%s: every template of the file passes the loader as it is', (db) => {
    const problems: TemplateProblem[] = [];
    const loaded = loadTemplates(FILES[db].templates, (p) => problems.push(p));
    expect(problems).toEqual([]);
    expect(loaded.length).toBe((FILES[db].templates ?? []).length);
    expect(loaded.length).toBeGreaterThan(0);
  });

  it.each(PROFILE_DBS)('$profile reading $db sees program-start and program-end', ({ profile: id, db }) => {
    const seen = templatesForMachine(DBS[db].templates, profile(id).profile.machineType).map((t) => t.id);
    expect(seen).toContain(PROGRAM_START_TEMPLATE_ID);
    expect(seen).toContain('program-end');
    // Ids are unique in what a document sees.
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('every built-in template is marked "review pending" (owner decision of 2026-10-09: the owner reviews later)', () => {
    for (const db of Object.keys(FILES)) {
      for (const t of ownTemplates(db)) expect(`${db}/${t.id}: ${t.review}`).toBe(`${db}/${t.id}: pending`);
    }
  });

  it.each(Object.keys(SHARED))('%s: read by both machine types, so every template names its machine type', (db) => {
    const unmarked = ownTemplates(db).filter((t) => t.machineType === undefined).map((t) => t.id);
    expect(unmarked).toEqual(SHARED[db]);
  });

  it('fanuc holds only mill templates, the lathe files only lathe templates', () => {
    expect(new Set(ownTemplates('fanuc').map((t) => t.machineType))).toEqual(new Set(['mill']));
    expect(new Set(ownTemplates('fanuc-lathe').map((t) => t.machineType))).toEqual(new Set(['lathe']));
    expect(new Set(ownTemplates('fanuc-lathe-b').map((t) => t.machineType))).toEqual(new Set(['lathe']));
  });

  it('system B overrides only the templates where it differs (AD-17)', () => {
    expect(ownTemplates('fanuc-lathe-b').map((t) => t.id)).toEqual(['program-start', 'tool-start']);
    const a = templatesForMachine(DBS['fanuc-lathe'].templates, 'lathe').map((t) => t.id);
    const b = templatesForMachine(DBS['fanuc-lathe-b'].templates, 'lathe').map((t) => t.id);
    expect(b).toEqual(a);
  });

  it('the Sinumerik milling profile gets a milling set beside the turning set', () => {
    const mill = templatesForMachine(DBS.sinumerik.templates, 'mill').map((t) => t.id);
    const lathe = templatesForMachine(DBS.sinumerik.templates, 'lathe').map((t) => t.id);
    expect(mill).toEqual(['program-start', 'tool-change', 'drill', 'drill-dwell', 'peck-drill', 'tapping', 'program-end']);
    expect(lathe).toEqual(['program-start', 'tool-start', 'stock-removal', 'threading', 'tool-end', 'program-end']);
  });
});

describe('two-block cycles (AD-39)', () => {
  const TWO_BLOCKS: Record<string, string[]> = { 'fanuc-lathe': ['G71', 'G72', 'G73', 'G74', 'G75', 'G76'] };

  it.each(Object.keys(FILES))('%s: blocks: 2 stands exactly on the cycles written in two blocks', (db) => {
    const flagged = FILES[db].codes.filter((e) => e.blocks !== undefined).map((e) => `${e.code}=${String(e.blocks)}`);
    expect(flagged).toEqual((TWO_BLOCKS[db] ?? []).map((code) => `${code}=2`));
  });

  it('the system-B database inherits the flags', () => {
    for (const code of TWO_BLOCKS['fanuc-lathe']) expect(lookupCode(DBS['fanuc-lathe-b'], code)?.blocks).toBe(2);
    expect(lookupCode(DBS['fanuc-lathe-b'], 'G70')?.blocks).toBeUndefined();
    expect(lookupCode(DBS.fanuc, 'G76')?.blocks).toBeUndefined();
  });
});

describe('the goldens', () => {
  it('there is one golden for every template a file writes, and none for anything else', () => {
    const expected = Object.keys(FILES).flatMap((db) => ownTemplates(db).map((t) => `${db}/${t.id}`)).sort();
    expect(GOLDENS.map((g) => `${g.db}/${g.id}`).sort()).toEqual(expected);
  });

  it.each(GOLDENS)('$db/$id: the golden names its template, a profile that reads it and only real parameters', ({ db, id }) => {
    const g = golden(db, id);
    expect(g.$format).toBe(1);
    expect(g.codes).toBe(db);
    expect(g.template).toBe(id);
    const t = templateOf(db, id);
    const reads = PROFILE_DBS.filter((p) => p.db === db).map((p) => p.profile);
    expect(reads).toContain(g.profile);
    expect(t.machineType === undefined || t.machineType === profile(g.profile).profile.machineType).toBe(true);
    const ids = new Set((t.params ?? []).map((p) => p.id));
    for (const key of Object.keys(g.values)) expect(ids.has(key)).toBe(true);
    // Every required parameter has a value: a default or the golden's.
    const values = valuesOf(t, g);
    for (const p of t.params ?? []) if (p.required) expect(values[p.id], `${db}/${id}: ${p.id}`).toBeDefined();
  });

  it.each(GOLDENS)('$db/$id: renders to the golden', ({ db, id }) => {
    const g = golden(db, id);
    const t = templateOf(db, id);
    const env = { cp: profile(g.profile), ...g.env };
    const r = renderTemplate(t, valuesOf(t, g), env);
    expect(r).toEqual(expect.objectContaining({ ok: true, text: g.expected }));
  });

  it.each(GOLDENS)('$db/$id: tokenizes without an unknown token, and its codes are in the database', ({ db, id }) => {
    const g = golden(db, id);
    const cp = profile(g.profile);
    const codes = DBS[db];
    const unknown: string[] = [];
    const missing: string[] = [];
    for (const { line, tokens: list } of tokens(g.expected, cp)) {
      for (const t of list) {
        if (t.kind === 'unknown') unknown.push(`${line}: ${t.text}`);
        if (t.kind === 'word' && (t.address === 'G' || t.address === 'M') && !t.text.includes('=') && lookupCode(codes, t.text) === null) {
          missing.push(`${line}: ${t.text}`);
        }
        if (t.kind === 'call') {
          const name = t.text.slice(0, t.text.indexOf('(') < 0 ? undefined : t.text.indexOf('('));
          if (lookupCode(codes, name) === null) missing.push(`${line}: ${name}`);
        }
        if (t.kind === 'keyword' && cp.profile.id !== 'heidenhain-klartext' && lookupCode(codes, t.text) === null) missing.push(`${line}: ${t.text}`);
      }
    }
    expect(unknown).toEqual([]);
    expect(missing).toEqual([]);
  });

  /** The template a program of each database changes its first tool with, for the context below. */
  const FIRST_TOOL: Record<string, string> = {
    fanuc: 'tool-change',
    'fanuc-lathe': 'tool-start',
    'fanuc-lathe-b': 'tool-start',
    heidenhain: 'tool-call',
    okuma: 'tool-start',
    sinumerik: 'tool-start',
  };

  it.each(GOLDENS)('$db/$id: in a program made of its database\'s templates, it is detected as its profile', ({ db, id }) => {
    const g = golden(db, id);
    // System B takes its program end from A (it overrides only what differs); the Sinumerik
    // milling set shares the start with turning, so its context is the milling choice of it.
    const own = (template: string) => (FILES[db].templates ?? []).some((t) => (t as { id: string }).id === template);
    const from = (template: string) => golden(own(template) ? db : 'fanuc-lathe', template).expected;
    let start = from('program-start');
    let tool = g.profile === 'sinumerik-mill' ? golden(db, 'tool-change').expected : from(FIRST_TOOL[db]);
    if (g.profile === 'sinumerik-mill') start = start.replace('G18 G90 G95 DIAMON', 'G17 G90 G94 G40');
    if (id === FIRST_TOOL[db] || id === 'tool-change') tool = '';
    const body = id === 'program-start' || id === 'program-end' ? '' : g.expected;
    const text = [start, tool, body, from('program-end')].filter((part) => part !== '').join('\n');
    expect(detectResult(PROFILES, null, text, 'none').id).toBe(g.profile);
  });
});

describe('the tool start of the Fanuc lathe (X9t)', () => {
  it('system A clamps the speed with G50 S, system B with G92 S; the rest is the same', () => {
    const a = golden('fanuc-lathe', 'tool-start').expected.split('\n');
    const b = golden('fanuc-lathe-b', 'tool-start').expected.split('\n');
    expect(a[0]).toMatch(/^N\d+ G50 S\d+$/);
    expect(b[0]).toMatch(/^N\d+ G92 S\d+$/);
    expect(a.slice(1)).toEqual(b.slice(1));
    expect(a[1]).toMatch(/^N\d+ T\d{4} \(.+\)$/);
    expect(a[2]).toMatch(/^N\d+ G96 S\d+ M[34]$/);
    expect(a[3]).toMatch(/^N\d+ G0 X[\d.]+ Z-?[\d.]+ M8$/);
  });

  it('each system detects as its own G-code system', () => {
    const cp = profile('fanuc-lathe');
    const text = (db: string) => `${golden(db, 'program-start').expected}\n${golden(db, 'tool-start').expected}`;
    expect(detectVariants(cp, text('fanuc-lathe')).gcodeSystem?.value).toBe('A');
    expect(detectVariants(cp, text('fanuc-lathe-b')).gcodeSystem?.value).toBe('B');
  });
});

// ---------------------------------------------------------------------------------------------
// P3b fix NC (plan §7 #253 ff.): what the content writes, checked against the manuals' rules
// ---------------------------------------------------------------------------------------------

describe('P3b fix NC: the content', () => {
  const SYS = { date: '2026-10-09', time: '12:00', file: 'PART1.nc', stem: 'PART1' };
  const defaults = (t: TemplateDef): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const p of t.params ?? []) if (p.default !== undefined) values[p.id] = String(p.default);
    return values;
  };
  const rendered = (t: TemplateDef, profileId: string, values: Record<string, string> = defaults(t)): string => {
    const r = renderTemplate(t, values, { cp: profile(profileId), prevBlockNumber: 100, numbered: true, sys: SYS });
    if (!r.ok) throw new Error(`${t.id}: ${JSON.stringify(r.errors)}`);
    return r.text;
  };
  const allLabels = (db: string): { where: string; label: string }[] => {
    const out: { where: string; label: string }[] = [];
    for (const e of DBS[db].codes) for (const p of e.params ?? []) out.push({ where: `${db} ${e.code} ${p.address}`, label: `${p.label ?? ''}` });
    for (const t of DBS[db].templates ?? []) {
      out.push({ where: `${db}/${t.id}`, label: t.description ?? '' });
      for (const p of t.params ?? []) out.push({ where: `${db}/${t.id} ${p.id}`, label: `${p.label} ${p.help ?? ''}` });
    }
    return out;
  };

  it('NC-03: the Sinumerik Program start opens with no machining chosen, on the turning and the milling profile', () => {
    for (const id of ['sinumerik', 'sinumerik-mill']) {
      const t = templatesForMachine(DBS.sinumerik.templates, profile(id).profile.machineType).find((x) => x.id === 'program-start');
      if (!t) throw new Error('no program-start');
      const values = initialValues(templateFields(t));
      expect(values.setup, id).toBeUndefined();
      expect(validateTemplateValues(t, values, profile(id)).setup?.key, id).toBe('templates.value.required');
    }
    const t = templateOf('sinumerik', 'program-start');
    const mill = rendered(t, 'sinumerik-mill', { ...defaults(t), setup: 'G17 G90 G94 G40' });
    expect(mill).toMatch(/\bG17\b/);
    expect(mill).toMatch(/\bG94\b/);
    expect(mill).not.toMatch(/\bG18\b|\bG95\b|DIAMON/);
  });

  it('NC-04: every Sinumerik drilling template programs F before MCALL, and nothing between MCALL and its end calls the cycle at once', () => {
    const drilling = (DBS.sinumerik.templates ?? []).filter((t) => /CYCLE8[1235-9]\(/.test(t.body));
    expect(drilling.map((t) => t.id)).toEqual(['drill', 'drill-dwell', 'peck-drill']);
    for (const t of drilling) {
      const lines = rendered(t, 'sinumerik-mill').split('\n');
      const open = lines.findIndex((l) => /\bMCALL\s+CYCLE8/.test(l));
      const close = lines.findIndex((l, i) => i > open && /\bMCALL\s*$/.test(l));
      expect(open, t.id).toBeGreaterThanOrEqual(0);
      expect(close, t.id).toBeGreaterThan(open);
      expect(lines.slice(0, open).some((l) => /(^|\s)F\d/.test(l)), `${t.id}: F before MCALL`).toBe(true);
      for (const line of lines.slice(open + 1, close)) {
        const words = line.replace(/^N\d+\s*/, '').trim().split(/\s+/);
        expect(words.every((w) => /^[SF]/.test(w)), `${t.id}: ${line}`).toBe(false);
        expect(words.every((w) => /^G0*[01]$/.test(w)), `${t.id}: ${line}`).toBe(false);
      }
    }
  });

  it('NC-06: a Klartext depth (Q201) and the centring diameter (Q344) cannot be positive, in the templates and in the code database', () => {
    for (const id of ['drill', 'universal-drill', 'rigid-tap', 'centering']) {
      const t = templateOf('heidenhain', id);
      expect(validateTemplateValues(t, { ...defaults(t), q201: '15' }).q201?.key, id).toBe('templates.value.aboveMax');
      expect(validateTemplateValues(t, { ...defaults(t), q201: '-15' }).q201, id).toBeUndefined();
    }
    const c = templateOf('heidenhain', 'centering');
    expect(validateTemplateValues(c, { ...defaults(c), q344: '9' }).q344?.key).toBe('templates.value.aboveMax');
    for (const e of DBS.heidenhain.codes) {
      for (const p of e.params ?? []) {
        if (p.address === 'Q201' || (e.code === 'CYCL DEF 240' && p.address === 'Q344')) expect(`${e.code} ${p.address} max ${String(p.max)}`).toBe(`${e.code} ${p.address} max 0`);
      }
    }
  });

  it('NC-07: every Fanuc lathe multiple repetitive cycle starts from a G0 to its start point in X and Z', () => {
    for (const db of ['fanuc-lathe', 'fanuc-lathe-b']) {
      for (const t of templatesForMachine(DBS[db].templates, 'lathe')) {
        const lines = rendered(t, 'fanuc-lathe').split('\n');
        const first = lines.findIndex((l) => /\bG7[1-6]\b/.test(l));
        if (first < 0) continue;
        expect(lines[first - 1] ?? '', `${db}/${t.id}`).toMatch(/\bG0\b.*\bX-?[\d.]+.*\bZ-?[\d.]+/);
      }
    }
  });

  it('NC-09: every Okuma template says its sample values are for the 1 mm unit setting', () => {
    for (const t of ownTemplates('okuma')) expect(t.description ?? '', t.id).toContain('unit setting 1 mm');
  });

  it('NC-12: no dwell is labelled in milliseconds without saying that holds on IS-B', () => {
    for (const db of ['fanuc', 'fanuc-lathe']) {
      for (const { where, label } of allLabels(db)) {
        if (/millisecond|\(ms\)/i.test(label)) expect(label, where).toMatch(/IS-B/);
      }
    }
  });

  it('NC-14: the CYCLE95 depth of cut says that radius or diameter has to be checked', () => {
    const mid = templateOf('sinumerik', 'stock-removal').params?.find((p) => p.id === 'mid');
    expect(mid?.label).toMatch(/radius or diameter/i);
  });

  it('NC-15: the Okuma tape header golden is a valid file name, and the name parameters say the control\'s rules', () => {
    expect(golden('okuma', 'program-start').expected.split('\n')[0]).toBe('$PART1.MIN%');
    const ps = templateOf('okuma', 'program-start').params ?? [];
    expect(ps.find((p) => p.id === 'file')?.help).toMatch(/starting with a letter, at most 16/);
    expect(ps.find((p) => p.id === 'prog')?.help).toMatch(/at most four/i);
    expect(templateOf('okuma', 'lap-rough-finish').params?.find((p) => p.id === 'name')?.help).toMatch(/at most four/i);
    expect(templateOf('heidenhain', 'program-start').params?.find((p) => p.id === 'name')?.help).toMatch(/no spaces/i);
  });

  it('NC-17: the R point, the lathe pecks and the tapping feed say what the control does', () => {
    for (const { where, label } of allLabels('fanuc')) expect(label, where).not.toMatch(/^Retract plane$/);
    for (const { where, label } of allLabels('fanuc-lathe')) expect(label, where).not.toMatch(/source controls/);
    expect(lookupCode(DBS.fanuc, 'G83')?.params?.find((p) => p.address === 'R')?.label).toBe('R point: where the feed starts (G99 returns here)');
    const tap = templateOf('fanuc', 'tapping');
    expect(tap.params?.find((p) => p.id === 'pitch')?.label).toBe('Thread pitch (program units)');
    expect(tap.params?.find((p) => p.id === 'f')?.label).toBe('Feed (pitch × speed, per minute)');
    expect(tap.description).toContain('G94 must be in force');
    // G94 is modal: written here it would switch a G95 program to feed per minute for good.
    expect(golden('fanuc', 'tapping').expected).not.toMatch(/G94/);
    expect(tap.body).not.toMatch(/G94/);
  });
});
