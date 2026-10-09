// The index against a fresh walk, over 1,000 random edits (Phase 3 plan P3.1).
//
// A document is edited at random (lines replaced, inserted and deleted, one or several at a
// time), the index is told the first changed line only, and the idle build runs in random
// slices between the edits — sometimes not at all, so a reader meets an index that is half
// built. After every edit, `stateAfter(n)` for random lines must be either `null` (the build
// has not reached a snapshot within `every` lines before `n`) or exactly the state a fresh
// sequential walk of the whole document gives, and `statesAfter` must equal `stateAfter`
// line by line. A small `every` puts many snapshot boundaries inside every edit; the pools
// carry Klartext `~` lists and Okuma `$` lines, whose block runs over those boundaries.
//
// P3a review CODE-9 made it stricter, three ways:
//  - every generated line carries a unique suffix, and the tokenizer is wrapped to record what
//    it is called with, so the test also checks that every step is told the tokenizer state of
//    the line above (a snapshot has to carry it; the built-in profiles never let it change a
//    modal state, so no state comparison can see it go missing);
//  - `null` is allowed only where the test itself knows the index has no snapshot: it keeps a
//    lower bound of the valid snapshots (all of them after a full build, cut back to the edit
//    by `applyChange`, unchanged by a partial slice) and a line below it has to answer;
//  - two seeds per profile, and edits aimed exactly on, one before and one after a snapshot line.

import { describe, expect, it, vi } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, noMachine } from '$lib/core/machines/effective';
import { compileProfile } from '$lib/core/profiles/compile';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { maskComments } from './mask';
import { tokenizeLine } from './tokenizer';
import { ModalIndex, ModalInterpreter } from './modal';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { LineState, ModalState } from './types';

// What the tokenizer is called with, in order; the test empties it between the steps it checks.
const recorded = vi.hoisted(() => ({ list: [] as { text: string; prev: { continuation: boolean } | undefined }[] }));
vi.mock('./tokenizer', async (original) => {
  const actual = await original<typeof import('./tokenizer')>();
  return {
    ...actual,
    tokenizeLine: (text: string, cp: never, prev?: never) => {
      recorded.list.push({ text, prev });
      return actual.tokenizeLine(text, cp, prev);
    },
  };
});

const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

function ctx(profileId: string): { cp: CompiledProfile; db: CodeDb } {
  const entry = resolveProfiles(BUILTIN_PROFILE_SOURCES).resolved.find((e) => (e.profile as { id?: string }).id === profileId);
  const checked = validateProfile(entry?.profile);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const applied = applyMachine(checked.profile, noMachine(checked.profile));
  return { cp: compileProfile(applied.profile), db: loadCodeDb(CODE_DBS[applied.codes]) };
}

/** A small deterministic generator (mulberry32), so a failure replays. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOLS: Record<string, string[]> = {
  'fanuc-gcode': [
    'G0 G90 G54 X0. Y0.',
    'T3 M6',
    'T7',
    'M6',
    'G43 Z25. H3 M8 (TOOL)',
    'S1800 M3',
    'G95 G1 Z-1. F.2',
    'G94 X50.123 Y-40.5 F1200.',
    'G98 G81 X10. Y10. Z-5. R2. F200.',
    'X20.',
    'G80',
    'G84 X5. Z-10. R2. F1.25',
    'G2 X30. Y0. R15.',
    'G91 G1 X1.',
    'G68 X0 Y0 R30.',
    'G69',
    'G43.4 H1',
    'G49',
    'G20',
    '(COMMENT T9 M6)',
    '',
  ],
  'heidenhain-klartext': [
    'TOOL CALL 1 Z S2000 F300',
    'TOOL CALL 2 Y S900',
    'L X+10 Y+10 R0 FMAX',
    'L Z-5 FU0.2',
    'L X+30 FZ0.05',
    'L X+40 F500 M89',
    'CYCL DEF 200 DRILLING ~',
    '  Q200=2 ;CLEARANCE ~',
    '  Q201=-15 ;DEPTH',
    'CYCL CALL',
    'L X+50 R0 FMAX M99',
    'CYCL DEF 19.0 WORKING PLANE',
    'CYCL DEF 19.1 B+30',
    'CYCL DEF 19.1 B+0',
    'CYCL DEF 19.1',
    'M128',
    'M129',
    '; COMMENT ~',
    '',
  ],
  'okuma-osp': [
    'N1 G00 X400 Z300',
    'N2 G96 S180 M03',
    'N3 T0202',
    'N4 G01 X56.123 Z-40.5 F0.28',
    'N5 G71 X27.55 Z-30 B60 D0.7 U0.1',
    '$ H2.45 L2 F2 M23',
    'N6 SB=1200 M13',
    'N7 G04 F2',
    'N8 G97 S800',
    'N9 G50 S2500',
    'N10 G94 F300',
    '',
  ],
};

/** The state after every line, power-on first, and the tokenizer state after every line: the oracle. */
function fresh(
  c: { cp: CompiledProfile; db: CodeDb },
  lines: readonly string[],
): { states: ModalState[]; lineStates: (LineState | undefined)[] } {
  const interp = new ModalInterpreter(c.cp, c.db);
  const states = [interp.state()];
  const lineStates: (LineState | undefined)[] = [undefined];
  let state: LineState | undefined;
  lines.forEach((line, i) => {
    const r = tokenizeLine(line, c.cp, state);
    state = r.state;
    interp.update(r.tokens, i + 1, maskComments(line, c.cp));
    states.push(interp.state());
    lineStates.push(state);
  });
  return { states, lineStates };
}

/** Takes (and empties) what the tokenizer was called with. */
function takeCalls(): typeof recorded.list {
  return recorded.list.splice(0);
}

/**
 * The calls that were made for a line of the document (its text is unique) with a tokenizer
 * state other than the one the line above leaves behind.
 */
function wrongLineStates(
  calls: typeof recorded.list,
  lines: readonly string[],
  lineStates: readonly (LineState | undefined)[],
): string[] {
  const bad: string[] = [];
  for (const { text, prev } of calls) {
    const i = lines.indexOf(text);
    if (i < 0) continue; // a line of an older text
    if ((prev?.continuation === true) !== (lineStates[i]?.continuation === true)) bad.push(text);
  }
  return bad;
}

/** A suffix that makes a line unique and, put before a closing `~`, leaves its meaning as it is. */
function uniquely(text: string, n: number): string {
  return text.endsWith('~') ? `${text.slice(0, -1).trimEnd()} ;u${n} ~` : text === '' ? `(u${n})` : `${text} (u${n})`;
}

describe('ModalIndex against a fresh walk, over 2,000 random edits', () => {
  it.each([
    ['fanuc-gcode', 400, 11, 0],
    ['heidenhain-klartext', 300, 7, 0],
    ['okuma-osp', 300, 5, 0],
    ['fanuc-gcode', 400, 11, 1],
    ['heidenhain-klartext', 300, 7, 1],
    ['okuma-osp', 300, 5, 1],
  ] as const)('%s: %i edits, a snapshot every %i lines, seed %i', (profileId, edits, every, seed) => {
    const c = ctx(profileId);
    const pool = POOLS[profileId];
    const rnd = random(0x5eed + every + seed * 0x9e3779b1);
    let unique = 0;
    const pick = (): string => uniquely(pool[Math.floor(rnd() * pool.length)], ++unique);
    const lines: string[] = Array.from({ length: 120 }, pick);
    const index = new ModalIndex(c.cp, c.db, { every });
    index.reset(lines.length, (n) => lines[n - 1]);
    let checked = 0;
    let answered = 0;
    // A lower bound of the valid snapshots, kept from the outside (the index does not say):
    // a full build makes them all, `applyChange(first)` keeps those before the edit, a partial
    // slice is not counted. A line whose snapshot is below it has to answer.
    let known = 1;
    const allSnapshots = (): number => Math.floor(lines.length / every) + 1;

    for (let edit = 0; edit < edits; edit++) {
      // One edit: replace, insert or delete one to four lines somewhere.
      let at = Math.floor(rnd() * (lines.length + 1));
      if (rnd() < 0.3) {
        // Aimed at a snapshot line: the first changed line is on it, one before it or one after it.
        const snapshotLine = (1 + Math.floor(rnd() * Math.max(1, Math.floor(lines.length / every)))) * every;
        at = Math.min(Math.max(0, snapshotLine + Math.floor(rnd() * 3) - 2), lines.length);
      }
      const count = 1 + Math.floor(rnd() * 4);
      const kind = rnd();
      if (kind < 0.4 && at < lines.length) {
        for (let k = 0; k < count && at + k < lines.length; k++) lines[at + k] = pick();
      } else if (kind < 0.7 || lines.length < 20) {
        lines.splice(at, 0, ...Array.from({ length: count }, pick));
      } else {
        lines.splice(Math.min(at, lines.length - 1), count);
      }
      const firstChanged = Math.min(at, lines.length) + 1;
      takeCalls();
      index.applyChange(firstChanged, lines.length, (n) => lines[n - 1]);
      known = Math.min(known, Math.floor((firstChanged - 1) / every) + 1);

      // The idle build gets a random share: none, a slice, or everything.
      const build = rnd();
      if (build < 0.5) index.buildSome(0);
      else if (build < 0.8) {
        while (!index.buildSome(1000));
        known = allSnapshots();
      }
      const built = takeCalls();

      const { states: oracle, lineStates } = fresh(c, lines);
      takeCalls(); // the oracle's own
      for (let probe = 0; probe < 6; probe++) {
        const n = Math.floor(rnd() * (lines.length + 1));
        const got = index.stateAfter(n);
        checked++;
        if (got === null) {
          // Null is allowed only where the index has no snapshot for the line: the test knows
          // it has all of those below `known`, and a ready index has them all.
          expect(Math.floor(n / every) >= known, `edit ${edit}: null at line ${n}, a snapshot of it is known to be valid`).toBe(true);
          expect(index.ready(), `edit ${edit}: a ready index answered null at line ${n}`).toBe(false);
          continue;
        }
        answered++;
        expect(got, `edit ${edit}, line ${n}`).toEqual(oracle[n]);
      }
      const first = Math.floor(rnd() * (lines.length + 1));
      const range = index.statesAfter(first, first + Math.floor(rnd() * 30));
      if (range !== null) {
        range.forEach((state, i) => expect(state, `edit ${edit}, range line ${first + i}`).toEqual(oracle[first + i]));
      } else {
        expect(Math.floor(first / every) >= known, `edit ${edit}: null range from line ${first}, a snapshot of it is known to be valid`).toBe(true);
      }
      // The build's slices and the readers' walks were told the tokenizer state of the line above.
      expect(wrongLineStates([...built, ...takeCalls()], lines, lineStates), `edit ${edit}: a step got the wrong tokenizer state`).toEqual([]);
    }
    while (!index.buildSome(1000));
    const { states: oracle } = fresh(c, lines);
    for (let n = 0; n <= lines.length; n++) expect(index.stateAfter(n), `final, line ${n}`).toEqual(oracle[n]);
    expect(answered).toBeGreaterThan(checked / 3);
  });
});
