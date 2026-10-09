// TS/Python modal parity (Phase 3 plan §6.9, exit criterion X15). Written by the Phase 3
// prelude (P3a); the TypeScript half runs from P3.1 on.
//
// For the program of every modal golden (`tests/fixtures/modal/**`) the Python interpreter
// (`_nc_modal.py`, through `tests/python/modal_dump.py`) and the TypeScript one
// (`core/nc/modal.ts`) give the state after **every** line, in the goldens' notation, with
// the same effective profile. The two must be equal line by line, not only on the lines a
// golden claims something about: a golden says what its case is about, parity says that the
// two languages read the rest of the program alike as well.
//
// Three checks per golden:
//   1. Python reaches every claim of the golden (the same claims `test_modal.py` checks; here
//      it proves that this harness reads the notation the way the Python test does);
//   2. TypeScript reaches every claim (the goldens unchanged, P3.1's first deliverable);
//   3. TypeScript equals Python on every line.
//
// And per owner-public program (`tests/fixtures/nc/owner-public/**`, exit criterion X15): the
// profile detection picks, no machine (the variants detected, as a document without a machine
// gets them), the effective profile and database written by TypeScript and read by Python
// through the dump's `--context` mode; the two must agree on every line, compared as one
// digest of the rendered state per line (300k lines in all).
//
// The prelude's `TS_PENDING` mark is gone with P3.1: the interpreter runs, so every check here
// runs as well.
//
// Without Python 3.9 or newer (`GEDIT_PYTHON`, else `python3` / `python`) the whole file is
// skipped and says why; CI runs it with the runner's Python.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listFixtures, readFixture } from './helpers/fixtures';
import { detect, effectiveFor, findPython, openBytes } from './helpers/realPrograms';
import {
  FIXTURES,
  type ContextRun,
  type Dump,
  type GoldenView,
  canonicalJson,
  claimDiffers,
  differingLines,
  digestOf,
  effectiveOf,
  goldenLines,
  goldenNames,
  goldenView,
  pythonContext,
  pythonDump,
  splitLines,
  walkRun,
  walkTs,
} from './helpers/modalParity';
import type { ModalState } from '$lib/core/nc/types';

const python = findPython();
const names = goldenNames();

interface Golden {
  input: string;
  states: { line: number; after: Record<string, unknown> }[];
}

function golden(name: string): Golden {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Golden;
}

/** The TypeScript states of one golden, with the effective profile the dump ran with. */
function tsStates(dump: Dump, name: string): GoldenView[] {
  const { profile, codesRaw } = effectiveOf(dump.goldens[name]);
  return walkTs(profile, codesRaw, goldenLines(name));
}

describe('the parity harness itself', () => {
  it('finds the goldens', () => {
    expect(names.length).toBeGreaterThanOrEqual(26);
    expect(names.every((name) => /^modal\/[a-z-]+\/[a-z0-9-]+\.json$/.test(name))).toBe(true);
  });

  it('renders a state the way the Python test does (G95, =G95, =G95@machine)', () => {
    const state = {
      groups: {
        feedmode: { code: 'G95', line: 0, assumed: true, from: 'machine' },
        plane: { code: 'G18', line: 0, assumed: true, from: 'profile' },
        motion: { code: 'G1', line: 7, assumed: false },
      },
      feedUnit: 'per-rev',
      speedUnit: 'surface',
      distance: 'absolute',
      units: { value: 'mm', line: 0, assumed: true, from: 'detected' },
      plane: 'ZX',
      diameter: { mode: 'on', line: 0, assumed: true, from: 'profile' },
      tool: { station: '01', written: 'T0101', line: 3 },
      feed: { valueText: '.2', line: 7, variable: false },
      speed: null,
      speedLimit: { valueText: '2500', line: 4, variable: false },
      activeCycle: null,
      definedCycle: null,
      modalCall: null,
      frame: null,
      tcp: { code: 'G43.4', line: 9 },
      pitchFeedAmbiguous: null,
      block: { cycle: null, pitchFeed: false, speedLimit: false, fNotFeed: false, toolChange: false },
    } satisfies ModalState;
    const view = goldenView(state);
    expect(view.groups).toEqual({ feedmode: '=G95@machine', plane: '=G18', motion: 'G1' });
    expect([view.units, view.diameter, view.tool, view.tcp]).toEqual(['=mm@detected', '=on', '01', 'G43.4']);
    expect(claimDiffers(view, { groups: { feedmode: '=G95@machine' }, feed: '.2', speedLimit: { line: 4 } })).toEqual([]);
    expect(claimDiffers(view, { groups: { feedmode: 'G95' }, speed: '200' })).toEqual([
      'groups.feedmode: "=G95@machine" ≠ "G95"',
      'speed: null ≠ "200"',
    ]);
  });
});

describe.skipIf(!python.ok)('TS/Python modal parity over every modal golden (X15)', () => {
  let dump: Dump;

  beforeAll(() => {
    if (!python.ok) return;
    dump = pythonDump(python);
  });

  it('has a Python dump of every golden, one state per line', () => {
    expect(Object.keys(dump.goldens).sort()).toEqual([...names].sort());
    for (const name of names) {
      const dumped = dump.goldens[name];
      expect(dumped.states, name).toHaveLength(goldenLines(name).length);
      expect(dumped.lines, name).toBe(dumped.states.length);
    }
  });

  describe.each(names)('%s', (name) => {
    it('Python reaches every claim of the golden', () => {
      const dumped = dump.goldens[name];
      for (const claim of golden(name).states) {
        expect(claimDiffers(dumped.states[claim.line - 1], claim.after), `line ${claim.line}`).toEqual([]);
      }
    });

    it('TypeScript reaches every claim of the golden', () => {
      const states = tsStates(dump, name);
      for (const claim of golden(name).states) {
        expect(claimDiffers(states[claim.line - 1], claim.after), `line ${claim.line}`).toEqual([]);
      }
    });

    it('TypeScript equals Python on every line', () => {
      const states = tsStates(dump, name);
      const python = dump.goldens[name].states;
      expect(states).toHaveLength(python.length);
      states.forEach((state, i) => expect(state, `${name} line ${i + 1}`).toEqual(python[i]));
    });
  });
});

describe('the digest of a state (the twin of the dump\'s `canonical`)', () => {
  it('sorts the keys, writes no blanks and escapes everything outside printable ASCII', () => {
    expect(canonicalJson({ b: 1, a: [true, null], c: { z: 'x', y: 'Ä\u007f\n"' } })).toBe(
      '{"a":[true,null],"b":1,"c":{"y":"\\u00c4\\u007f\\n\\"","z":"x"}}',
    );
    expect(digestOf({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});

/** The owner-public programs, opened, detected and made effective as the app does (no machine). */
function ownerPublicRuns(): ContextRun[] {
  return listFixtures('nc/owner-public').map((rel) => {
    const opened = openBytes(readFixture(rel));
    if (!opened.ok) throw new Error(`${rel} does not open: ${opened.reason}`);
    const eff = effectiveFor(detect(`/work/${rel}`, opened.text), opened.text, null);
    return { name: rel, profile: eff.profile, codes: eff.codes, lines: splitLines(opened.text) };
  });
}

describe.skipIf(!python.ok)('TS/Python modal parity over every owner-public program (X15)', () => {
  const runs = ownerPublicRuns();
  let python3: Awaited<ReturnType<typeof pythonContext>>;

  // Python tokenizes about 25k lines a second; the set is 300k lines, shared out over four
  // processes (about 8 s here, more on a loaded CI runner).
  beforeAll(async () => {
    if (!python.ok) return;
    python3 = await pythonContext(python, runs, { digest: true });
  }, 240_000);

  it('runs the twenty programs', () => {
    expect(runs).toHaveLength(20);
    expect(Object.keys(python3).sort()).toEqual(runs.map((run) => run.name).sort());
  });

  it.each(runs.map((run) => [run.name, run] as const))('%s: TypeScript equals Python on every line', (_name, run) => {
    const ts = walkRun(run).map(digestOf);
    const py = python3[run.name].digests ?? [];
    expect(py).toHaveLength(run.lines.length);
    const differ = differingLines(ts, py);
    expect(differ, `${differ.length} of ${run.lines.length} lines differ, the first at ${differ[0]}`).toEqual([]);
  });
});

describe.runIf(!python.ok)('without Python', () => {
  it('says why the parity check did not run', () => {
    expect(python.ok ? '' : python.reason).not.toBe('');
  });
});
