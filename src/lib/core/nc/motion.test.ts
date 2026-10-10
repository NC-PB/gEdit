// The motion-colour contract and rules (Phase 3 plan §6.6). The colours and budgets are the
// prelude's (P3a); P3.7 added `motionOfLine` and its goldens under `tests/fixtures/motion/**`:
// `<profileId>/<case>.json` is `{ about, machine?, input: string[], lines: { "<n>": kind|null } }`,
// every listed line compared, synthetic programs only.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { EDITOR_COLORS } from '$lib/core/grammar/roles';
import { applyMachine, effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { compileProfile } from '$lib/core/profiles/compile';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { maskComments } from './mask';
import { ModalInterpreter } from './modal';
import { MOTION_BUDGETS, MOTION_CLASS_PREFIX, MOTION_COLORS, MOTION_KINDS, motionOfLine } from './motion';
import type { MotionKind } from './motion';
import { tokenizeLine } from './tokenizer';
import type { LineState, ModalState } from './types';
import type { CodeEntry } from '$lib/core/codes/types';
import type { MachineConfig } from '$lib/core/machines/types';
import type { Profile } from '$lib/core/profiles/types';

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the motion colours', () => {
  it('has one colour per kind in each theme, all different', () => {
    for (const mode of ['light', 'dark'] as const) {
      const colours = MOTION_KINDS.map((kind) => MOTION_COLORS[mode][kind]);
      expect(colours.every((c) => /^#[0-9a-f]{6}$/i.test(c)), mode).toBe(true);
      expect(new Set(colours.map((c) => c.toLowerCase())).size, mode).toBe(MOTION_KINDS.length);
      expect(Object.keys(MOTION_COLORS[mode]).sort()).toEqual([...MOTION_KINDS].sort());
    }
  });

  it('clears 3:1 against the editor background, the contrast of a mark that is no text', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const kind of MOTION_KINDS) {
        const ratio = contrast(MOTION_COLORS[mode][kind], EDITOR_COLORS[mode].background);
        expect(ratio, `${mode} ${kind}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('names the classes and the budgets the harness and P3.7 read', () => {
    expect(MOTION_KINDS.map((kind) => MOTION_CLASS_PREFIX + kind)).toEqual([
      'gedit-motion-rapid',
      'gedit-motion-linear',
      'gedit-motion-arc',
      'gedit-motion-thread',
      'gedit-motion-cycle',
    ]);
    expect(MOTION_BUDGETS.lines).toBe(300_000);
    expect(MOTION_BUDGETS.maxMarks).toBeGreaterThan(2 * MOTION_BUDGETS.marginLines);
  });
});

// ---------------------------------------------------------------------------
// The rules: goldens for every built-in profile, and the cases a golden cannot say
// ---------------------------------------------------------------------------

const PROFILES = new Map<string, Profile>(
  resolveProfiles(BUILTIN_PROFILE_SOURCES).resolved.map((entry) => {
    const checked = validateProfile(entry.profile);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return [checked.profile.id, checked.profile];
  }),
);
const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

/** The kind of every line of a program, the way the app reads it: tokenizer, modal interpreter, rules. */
function kindsOf(profileId: string, lines: readonly string[], machine?: MachineConfig['params']): (MotionKind | null)[] {
  const profile = PROFILES.get(profileId);
  if (profile === undefined) throw new Error(`no built-in profile "${profileId}"`);
  const eff =
    machine !== undefined
      ? effectiveMachine(profile, { id: 'golden', name: 'golden', profile: profileId, params: machine }, 'document', {})
      : noMachine(profile);
  const { profile: effective, codes } = applyMachine(profile, eff);
  const cp = compileProfile(effective);
  const db = loadCodeDb(CODE_DBS[codes]);
  const interp = new ModalInterpreter(cp, db);
  interp.reset();
  let lineState: LineState | undefined;
  let before = interp.state();
  return lines.map((text, i) => {
    const result = tokenizeLine(text, cp, lineState);
    lineState = result.state;
    interp.update(result.tokens, i + 1, maskComments(text, cp));
    const after = interp.state();
    const kind = motionOfLine(result.tokens, before, after, cp, db);
    before = after;
    return kind;
  });
}

interface Golden {
  about: string;
  machine?: MachineConfig['params'];
  input: string[];
  lines: Record<string, MotionKind | null>;
}

const MOTION_DIR = fileURLToPath(new URL('../../../../tests/fixtures/motion', import.meta.url));
const GOLDENS: { name: string; profileId: string; golden: Golden }[] = readdirSync(MOTION_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) =>
    readdirSync(join(MOTION_DIR, dir.name))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => ({
        name: `${dir.name}/${file}`,
        profileId: dir.name,
        golden: JSON.parse(readFileSync(join(MOTION_DIR, dir.name, file), 'utf8')) as Golden,
      })),
  );

describe('the motion goldens', () => {
  it('cover every built-in profile, the lathe in both G-code systems', () => {
    const covered = new Set(GOLDENS.map((g) => g.profileId));
    expect([...PROFILES.keys()].filter((id) => !covered.has(id))).toEqual([]);
    const lathe = GOLDENS.filter((g) => g.profileId === 'fanuc-lathe');
    expect(lathe.some((g) => g.golden.machine === undefined)).toBe(true);
    expect(lathe.some((g) => g.golden.machine?.variants?.gcodeSystem === 'B')).toBe(true);
  });

  it.each(GOLDENS.map((g) => [g.name, g] as const))('%s', (_name, { profileId, golden }) => {
    const kinds = kindsOf(profileId, golden.input, golden.machine);
    const listed = Object.keys(golden.lines);
    expect(listed.length, 'a golden lists every line of its program').toBe(golden.input.length);
    for (const key of listed) {
      expect(kinds[Number(key) - 1], `line ${key}: ${golden.input[Number(key) - 1]}`).toBe(golden.lines[key]);
    }
    for (const value of Object.values(golden.lines)) expect(value === null || MOTION_KINDS.includes(value)).toBe(true);
  });

  it('use all five kinds somewhere', () => {
    const seen = new Set(GOLDENS.flatMap((g) => Object.values(g.golden.lines)));
    for (const kind of MOTION_KINDS) expect(seen.has(kind), kind).toBe(true);
  });
});

describe('the rules a golden cannot show', () => {
  const state = (profileId: string, lines: readonly string[]): { after: ModalState; before: ModalState; cp: ReturnType<typeof compileProfile>; db: ReturnType<typeof loadCodeDb> } => {
    const { profile, codes } = applyMachine(PROFILES.get(profileId)!, noMachine(PROFILES.get(profileId)!));
    const cp = compileProfile(profile);
    const db = loadCodeDb(CODE_DBS[codes]);
    const interp = new ModalInterpreter(cp, db);
    interp.reset();
    let before = interp.state();
    for (let i = 0; i < lines.length; i++) {
      before = interp.state();
      interp.update(tokenizeLine(lines[i], cp).tokens, i + 1, maskComments(lines[i], cp));
    }
    return { before, after: interp.state(), cp, db };
  };

  it('paints a motion mode that is only assumed in no colour, and the same mode once the program writes it', () => {
    const { before, after, cp, db } = state('fanuc-gcode', ['G90', 'X10. Y10.']);
    const tokens = tokenizeLine('X10. Y10.', cp).tokens;
    expect(motionOfLine(tokens, before, after, cp, db)).toBeNull(); // nothing in force yet
    const assumed = { ...after, groups: { ...after.groups, motion: { code: 'G1', line: 0, assumed: true } } } as ModalState;
    expect(motionOfLine(tokens, before, assumed, cp, db)).toBeNull();
    const written = { ...after, groups: { ...after.groups, motion: { code: 'G1', line: 3, assumed: false } } } as ModalState;
    expect(motionOfLine(tokens, before, written, cp, db)).toBe('linear');
    const arc = { ...after, groups: { ...after.groups, motion: { code: 'G3', line: 3, assumed: false } } } as ModalState;
    expect(motionOfLine(tokens, before, arc, cp, db)).toBe('arc');
  });

  it('reads the state after the block: a code on the line wins over the mode in force', () => {
    expect(kindsOf('fanuc-gcode', ['G1 X1. F100.', 'G0 X2.', 'X3.', 'G2 X4. R1.', 'G1 X5.'])).toEqual(['linear', 'rapid', 'rapid', 'arc', 'linear']);
  });

  it('gives a dwell, a data block and a machine-coordinate move their own answers', () => {
    expect(kindsOf('fanuc-gcode', ['G1 X1. F100.', 'G4 X1.', 'G4 P500', 'G10 L2 P1 X5.', 'G92 X0', 'G53 G0 Z0'])).toEqual(['linear', null, null, null, null, 'rapid']);
  });

  it('marks the first line of a block continued over several lines and not its tail', () => {
    expect(kindsOf('heidenhain-klartext', ['1 L X+10 F100 ~', '   M3', '2 L X+20 FMAX ~', '   Y+5 F200'])).toEqual(['linear', null, 'rapid', null]);
  });

  it('lets a lead win over a cycle: a threading pass is the block\'s cycle too', () => {
    // The interpreter makes G32 the block's cycle (rule 3 of the modal rules); the colour is a thread.
    const { after } = state('fanuc-gcode', ['G32 Z-10. F1.5']);
    expect(after.block.cycle).toBe('G32');
    expect(kindsOf('fanuc-gcode', ['G32 Z-10. F1.5', 'G81 X1. Y1. Z-5. R2. F100.'])).toEqual(['thread', 'cycle']);
  });

  it('ignores a word of the program that is no axis, a variable assignment or a bare axis letter', () => {
    expect(kindsOf('fanuc-gcode', ['G1 X1. F100.', 'S1000 M3', 'F200.', 'G1', 'T2 M6'])).toEqual(['linear', null, null, null, null]);
    expect(kindsOf('heidenhain-klartext', ['1 TOOL CALL 1 Z S3000', '2 L X+1 FMAX', '3 L Z'])).toEqual([null, 'rapid', null]);
  });

  it('reads no dialect name: the rules are in the data', () => {
    const source = readFileSync(fileURLToPath(new URL('./motion.ts', import.meta.url)), 'utf8');
    const code = source.replace(/\/\/[^\n]*/g, '');
    for (const word of ['fanuc', 'okuma', 'sinumerik', 'heidenhain', 'klartext', 'siemens']) expect(code.toLowerCase().includes(word), word).toBe(false);
  });
});

describe('the arc flag in the code databases', () => {
  const codesOf = (dialect: string): CodeEntry[] => CODE_DBS[dialect].codes as CodeEntry[];

  /** Every code that carries `sets.path: 'arc'`, per database. A flag lost in an edit fails here. */
  const ARCS: Record<string, string[]> = {
    fanuc: ['G2', 'G3'],
    'fanuc-lathe': ['G2', 'G3'],
    'fanuc-lathe-b': ['G2', 'G3'],
    okuma: ['G102', 'G103', 'G132', 'G133', 'G2', 'G3'],
    sinumerik: ['CIP', 'CT', 'G2', 'G3'],
    heidenhain: ['APPR CT', 'APPR LCT', 'C', 'CP', 'CR', 'CT', 'CTP', 'DEP CT', 'DEP LCT'],
  };

  it.each(Object.entries(ARCS))('%s lists exactly its arcs', (dialect, codes) => {
    const entries = codesOf(dialect).filter((e) => e.sets?.path === 'arc').map((e) => e.code);
    expect(entries.sort()).toEqual([...codes].sort());
  });

  it('puts the flag only on feed moves of the motion group', () => {
    for (const dialect of Object.keys(CODE_DBS)) {
      for (const entry of codesOf(dialect)) {
        if (entry.sets?.path !== 'arc') continue;
        expect(entry.group, `${dialect} ${entry.code}`).toBe('motion');
        expect(entry.sets?.motion, `${dialect} ${entry.code}`).toBe('feed');
      }
    }
  });

  it('knows every database the app ships', () => {
    expect(Object.keys(CODE_DBS).sort()).toEqual(Object.keys(ARCS).sort());
  });
});

describe('the budget of the rules', () => {
  it('names the margins the decorations use', () => {
    expect(MOTION_BUDGETS.marginLines).toBe(100);
    expect(MOTION_BUDGETS.updateMs).toBe(4);
  });
});
