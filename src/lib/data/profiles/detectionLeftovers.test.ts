// The detection leftovers of 2026-09-27 (plan §6 M9, WP9.6): two of the owner's local
// programs that detection got wrong or got right only by luck, each reproduced by a
// synthetic program written for gEdit.
//
//   1. **The Y-axis lathe.** A Fanuc lathe post with five-digit `T` words and a live-tool
//      milling section in `G17` writes page after page of `X… Y…` moves. Every one of them
//      is a point for the mill (its `Y` rule), none for the lathe, and they outvoted the
//      lathe's markers: the program opened as a mill. What the same post also writes, and
//      no mill post does, is a reference return by the lathe's incremental twins —
//      `G30 U0. V0.`, `G30 W0.`, `G28 U0 W0`, `G28 H0` (`V` is the twin of `Y`, so only a
//      Y-axis lathe writes `G30 V…`). The lathe's old `G28 U` rule now reads `G28` and
//      `G30` with any of `U V W H` (`fanuc-lathe.json`, weight 4 as before). M9 NC review
//      F6 narrowed it: a return by `W` alone counts only without `G91` in the block and
//      without a `P`, because a W-axis (boring) mill writes `G91 G28 W0.` and `G30 P2 W0.`.
//   2. **The Fanuc lathe / Sinumerik tie.** A program of nothing but numbered blocks and
//      `G96`/`G97` scores exactly the same on both: both profiles count a numbered block
//      and both count the spindle modes. With equal priorities the document that happened
//      to be open decided. The tie is broken deliberately, the way Okuma's is: the
//      Sinumerik turning profile gets `detect.priority: -1`, and its milling child `-2` in
//      the same change, so a Siemens program with no evidence of either machine still goes
//      to turning. `sinumerik.json` is WP9.5b's file in this wave, so the two values travel
//      as a hand-off note (`SP/handoff/m9-wp96.md`); the tests below expect them and fail
//      with that message until they are in.
//
// The margins of every fixture are printed by `fanucLathe.test.ts` (gate G10); this file
// holds the two cases and their reasons. The tie program lives under
// `tests/fixtures/expected/detect/programs/` and not under `nc/`: a tie has a margin of 0 by
// construction, and every `nc/` fixture must win by 3.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import { MAX_SNIFF_LINES, detectProfile } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { FIXTURES_DIR, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';

const MILL = 'fanuc-gcode';
const LATHE = 'fanuc-lathe';
const SINUMERIK = 'sinumerik';
const SINUMERIK_MILL = 'sinumerik-mill';

/** The hand-off this file waits for until WP9.5b's branch and this one are integrated. */
const HANDOFF = 'waiting for the WP9.6 hand-off: sinumerik.json detect.priority -1, sinumerik-mill.json detect.priority -2';

const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});
const IDS = BUILTINS.map((cp) => cp.profile.id);

function compiled(id: string): CompiledProfile {
  const found = BUILTINS.find((cp) => cp.profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

/** The built-ins with one profile replaced, for "what would happen without the rule". */
function withProfile(id: string, patch: (p: Profile) => void): CompiledProfile[] {
  return BUILTINS.map((cp) => {
    if (cp.profile.id !== id) return cp;
    const profile = structuredClone(cp.profile);
    patch(profile);
    return compileProfile(profile);
  });
}

/** Extension weight plus the strongest content rule per line, as `detect.ts` scores. */
function scores(profiles: CompiledProfile[], path: string | null, text: string): Map<string, number> {
  const ext = path === null ? '' : ((path.split('/').pop() ?? '').split('.').slice(1).pop() ?? '').toLowerCase();
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, MAX_SNIFF_LINES);
  const out = new Map<string, number>();
  for (const cp of profiles) {
    let score = ext === '' ? 0 : (cp.profile.detect.extensions?.[ext] ?? 0);
    const rules = [...cp.re.detectContent].sort((a, b) => b.weight - a.weight);
    for (const line of lines) {
      const hit = rules.find((rule) => rule.re.test(line));
      if (hit) score += hit.weight;
    }
    // A veto (`detect.vetoes`, rule 5 of detect.ts) takes the profile out of the file.
    if (cp.re.detectVetoes.some((veto) => lines.some((line) => veto.test(line)))) score = 0;
    out.set(cp.profile.id, score);
  }
  return out;
}

function textOf(rel: string): string {
  const opened = openFixture(rel);
  if (opened.refused !== null) throw new Error(`${rel} does not open`);
  return opened.text;
}

// ---------------------------------------------------------------------------
// 1. The Y-axis lathe
// ---------------------------------------------------------------------------

const Y_AXIS = 'nc/fanuc-lathe/l09-y-axis-lathe.nc';
/** The lathe's reference-return rule as it stood before WP9.6. */
const OLD_RETURN_RULE = '(?<![A-Z])G0*28\\s*U';

/** Whether a content pattern is the lathe's reference-return rule (it names `G28`). */
const isReturnRule = (pattern: string): boolean => pattern.includes('G0*') && pattern.includes('28');

/** The lathe's reference-return rule, found by what it is rather than by its index. */
function returnRule(cp: CompiledProfile): RegExp {
  const rule = cp.re.detectContent.find((r) => isReturnRule(r.re.source));
  if (!rule) throw new Error('the lathe has no reference-return rule');
  return rule.re;
}

describe('a Y-axis lathe with five-digit T words', () => {
  const text = textOf(Y_AXIS);

  it('opens as the Fanuc lathe, whatever document was open before', () => {
    for (const fallback of IDS) {
      expect(detectProfile(BUILTINS, `/work/${Y_AXIS}`, text, fallback), fallback).toBe(LATHE);
      expect(detectProfile(BUILTINS, null, text, fallback), `${fallback}, untitled`).toBe(LATHE);
    }
  });

  it('beats the mill by at least 3, on the lathe evidence and not on a tie-break', () => {
    const s = scores(BUILTINS, `/work/${Y_AXIS}`, text);
    expect(s.get(LATHE)! - s.get(MILL)!).toBeGreaterThanOrEqual(3);
  });

  it('opened as a mill with the old rule: its Y moves outvoted the lathe markers', () => {
    // The regression this package fixes, stated on the program that shows it.
    const before = withProfile(LATHE, (p) => {
      const rule = p.detect.content?.find((r) => isReturnRule(r.pattern));
      if (!rule) throw new Error('no reference-return rule to put back');
      rule.pattern = OLD_RETURN_RULE;
    });
    expect(detectProfile(before, `/work/${Y_AXIS}`, text, LATHE)).toBe(MILL);
    const s = scores(before, `/work/${Y_AXIS}`, text);
    expect(s.get(MILL)! - s.get(LATHE)!).toBeGreaterThan(0);
    // The program really is of that shape: more lines that move Y and nothing else than
    // the lathe's turret words, clamp and spindle modes are worth.
    const yOnly = text.split('\n').filter((line) => /^X[-\d.]+\s+Y[-\d.]+$/.test(line.trim()));
    expect(yOnly.length).toBeGreaterThanOrEqual(20);
    expect(text).toMatch(/^T\d{5}\b/m);
  });

  it('reads a reference return by U, V, W or H as lathe evidence, and nothing a mill writes', () => {
    const re = returnRule(compiled(LATHE));
    for (const line of ['G28 U0 W0', 'G28U0.', 'G28 U-1.', 'G30 U0. V0.', 'G30 W0.', 'G30 V0.', 'G30 P2 U0 W0', 'G28 H0.', 'G0 G30 U0']) {
      expect(re.test(line), line).toBe(true);
    }
    for (const line of [
      'G91 G28 Z0.',
      'G28 G91 Z0',
      'G30 P2 Z0.',
      'G28 X0 Y0',
      'G300 U1.',
      'G30.1 U0',
      'G43 H1 Z5.',
      'G28 Y0',
      // M9 NC review F6: a W-axis (boring) mill returns its quill incrementally, or to a
      // second reference point by P; a lathe returns W without either.
      'G91 G28 W0.',
      'N10 G91 G28 W0.',
      'G28 G91 W0',
      'G30 P2 W0.',
      '(G28 U0) G91 G28 W0.',
    ]) {
      expect(re.test(line), line).toBe(false);
    }
  });

  it('matches no line of a mill, Okuma or Siemens fixture', () => {
    const re = returnRule(compiled(LATHE));
    const foreign = listFixtures('nc').filter(
      (rel) => !rel.startsWith('nc/fanuc-lathe/') && !rel.startsWith('nc/owner-public/fanuc-lathe/') && !rel.startsWith('nc/heidenhain'),
    );
    const hits: string[] = [];
    for (const rel of foreign) {
      const opened = openFixture(rel);
      if (opened.refused !== null) continue;
      opened.text.split('\n').forEach((line, i) => {
        if (re.test(line.trim())) hits.push(`${rel}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('keeps a W-axis boring mill a mill (M9 NC review F6)', () => {
    const tool = (n: number, ret: string): string[] => [
      `N${n}0 ${ret}`,
      `N${n}1 G91 G28 Z0.`,
      `N${n}2 T${n} M6`,
      `N${n}3 G90 G54 G0 X0. Y0. B90.`,
      `N${n}4 G43 H${n} Z50. S1200 M3`,
      `N${n}5 G81 X10. Y10. Z-20. R2. F100.`,
      `N${n}6 X20.`,
      `N${n}7 G80`,
    ];
    const program = (ret: string, tools: number): string =>
      ['%', 'O1000 (HBM)', 'N1 G21 G17 G40 G49 G80', ...Array.from({ length: tools }, (_, i) => tool(i + 1, ret)).flat(), 'N900 M30', '%'].join('\n');
    const tiny = ['%', 'O1000', 'G21 G17 G40 G49 G80', 'G91 G28 W0.', 'T1 M6', 'G90 G0 X0 Y0', 'G43 H1 Z50 S1000 M3', 'G1 X10 F100', 'G91 G28 W0.', 'M30', '%'].join('\n');
    const old = withProfile(LATHE, (p) => {
      const rule = p.detect.content?.find((r) => isReturnRule(r.pattern));
      if (!rule) throw new Error('no reference-return rule to put back');
      rule.pattern = '(?<![A-Z])G0*(?:28|30)(?![\\d.])[ \\t]*(?:P\\d[ \\t]*)?[UVWH][-+]?[.\\d]';
    });
    for (const [name, text] of [
      ['G91 G28 W0. at every tool', program('G91 G28 W0.', 5)],
      ['G30 P2 W0. at every tool', program('G30 P2 W0.', 5)],
      ['two G91 G28 W0. in a short program', tiny],
    ] as const) {
      for (const fallback of IDS) expect(detectProfile(BUILTINS, '/work/hbm.nc', text, fallback), `${name}, ${fallback}`).toBe(MILL);
      const s = scores(BUILTINS, '/work/hbm.nc', text);
      expect(s.get(MILL)! - s.get(LATHE)!, name).toBeGreaterThanOrEqual(5);
      // The WP9.6 rule counted every W return for the lathe: 4 points a tool.
      const before = scores(old, '/work/hbm.nc', text);
      expect(before.get(MILL)! - before.get(LATHE)!, `${name} with the WP9.6 rule`).toBeLessThan(s.get(MILL)! - s.get(LATHE)!);
    }
    // The short one opened as a lathe with the WP9.6 rule.
    expect(detectProfile(old, '/work/hbm.nc', tiny, MILL)).toBe(LATHE);
  });

  it('keeps the four-digit-T mill a mill', () => {
    const rel = 'nc/ambiguous/mill-4digit-t.nc';
    expect(detectProfile(BUILTINS, `/work/${rel}`, textOf(rel), LATHE)).toBe(MILL);
  });
});

// ---------------------------------------------------------------------------
// 2. The Fanuc lathe / Sinumerik tie
// ---------------------------------------------------------------------------

const TIE = readFileSync(join(FIXTURES_DIR, 'expected/detect/programs/tie-numbered-blocks'), 'utf8');

describe('a program of numbered blocks and G96/G97 only', () => {
  it('scores the same on the Fanuc lathe and the Sinumerik turning profile', () => {
    // The tie is by construction, and that is the point: no rule wording can pull the two
    // apart on such a program, so a reader of the JSON has to be able to see who wins.
    const s = scores(BUILTINS, '/work/tie', TIE);
    expect(s.get(LATHE)).toBe(s.get(SINUMERIK));
    expect(s.get(LATHE)).toBeGreaterThan(0);
    // M12.5: Okuma scores a numbered block as the other ISO profiles do, so it ties
    // the two as well; its priority (-1, as Sinumerik's) leaves the program to the lathe.
    for (const id of IDS.filter((other) => other !== LATHE && other !== SINUMERIK)) {
      if (id === 'okuma-osp') expect(s.get(id)!, id).toBe(s.get(LATHE)!);
      else expect(s.get(id)!, id).toBeLessThan(s.get(LATHE)!);
    }
  });

  it('opens as the Fanuc lathe whatever document was open before', () => {
    for (const fallback of IDS) {
      expect(detectProfile(BUILTINS, '/work/tie', TIE, fallback), `fallback ${fallback}; ${HANDOFF}`).toBe(LATHE);
      expect(detectProfile(BUILTINS, null, TIE, fallback), `fallback ${fallback}, untitled; ${HANDOFF}`).toBe(LATHE);
    }
  });

  it('gives Sinumerik the priority Okuma has, and its milling child one below it', () => {
    const priority = (id: string): number => compiled(id).profile.detect.priority ?? 0;
    expect(priority(SINUMERIK), HANDOFF).toBe(-1);
    expect(priority(SINUMERIK_MILL), HANDOFF).toBe(-2);
    expect(priority('okuma-osp')).toBe(-1);
    expect(priority(LATHE)).toBe(0);
    // The milling child stays below the turning profile, so a Siemens program with no
    // evidence of either machine still opens as turning (WP9.1, `s03-sub.SPF`).
    expect(priority(SINUMERIK_MILL)).toBeLessThan(priority(SINUMERIK));
    const sub = 'nc/sinumerik/s03-sub.SPF';
    for (const fallback of IDS) {
      expect(detectProfile(BUILTINS, `/work/${sub}`, textOf(sub), fallback), fallback).toBe(SINUMERIK);
    }
  });

  it('still opens a Siemens turning program with a Siemens marker as Sinumerik', () => {
    // One `;` comment or one `LIMS=` line is enough: the priority only decides
    // a tie, and a Siemens program almost never ties.
    expect(detectProfile(BUILTINS, '/work/tie', `; WRITTEN FOR GEDIT\n${TIE}`, LATHE)).toBe(SINUMERIK);
    expect(detectProfile(BUILTINS, '/work/tie', `${TIE}N11 LIMS=3000\n`, LATHE)).toBe(SINUMERIK);
  });
});
