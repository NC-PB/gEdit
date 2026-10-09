// The tokenizer state travels with the index (P3a review CODE-9). Pure; no editor.
//
// A tokenizer state (`continuation`: the line above ended in `~`) changes how the next line's
// head is read. The index keeps it in every snapshot and starts a walk from a snapshot with it.
// With the built-in profiles it can never change a modal state, so no comparison of states
// notices when it is dropped; this test looks at what the tokenizer is called with instead.
// Checked against two mutants of `modal.ts`: the state dropped when a snapshot is taken, and
// dropped when a walk starts from a snapshot.

import { describe, expect, it, vi } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, noMachine } from '$lib/core/machines/effective';
import { compileProfile } from '$lib/core/profiles/compile';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';

const calls = vi.hoisted(() => ({ list: [] as { text: string; prev: { continuation: boolean } | undefined }[] }));
vi.mock('./tokenizer', async (original) => {
  const actual = await original<typeof import('./tokenizer')>();
  return {
    ...actual,
    tokenizeLine: (text: string, cp: never, prev?: never) => {
      calls.list.push({ text, prev });
      return actual.tokenizeLine(text, cp, prev);
    },
  };
});
const { ModalIndex } = await import('./modal');

const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

function klartext() {
  const entry = resolveProfiles(BUILTIN_PROFILE_SOURCES).resolved.find((e) => (e.profile as { id?: string }).id === 'heidenhain-klartext');
  const checked = validateProfile(entry?.profile);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const applied = applyMachine(checked.profile, noMachine(checked.profile));
  return { cp: compileProfile(applied.profile), db: loadCodeDb(CODE_DBS[applied.codes]) };
}

const EVERY = 5;
/** Unique text per line; every snapshot line (5, 10, …) ends in the continuation marker. */
const LINES = Array.from({ length: 60 }, (_, i) => ((i + 1) % EVERY === 0 ? `L X+${i + 1} ~` : `L X+${i + 1}`));

/** The calls for a line of `LINES` that were not told what the line above leaves behind. */
function wrong(): string[] {
  return calls.list
    .filter(({ text, prev }) => {
      const i = LINES.indexOf(text);
      return i >= 0 && (prev?.continuation === true) !== (i > 0 && /~\s*$/.test(LINES[i - 1]));
    })
    .map(({ text }) => text);
}

describe('the tokenizer state in the index', () => {
  it('every step of a read is told the state the line above returned, also right after a snapshot', () => {
    const c = klartext();
    const index = new ModalIndex(c.cp, c.db, { every: EVERY });
    index.reset(LINES.length, (n) => LINES[n - 1]);
    while (!index.buildSome(1000));
    calls.list.length = 0; // only the replays from here on
    for (let n = 0; n <= LINES.length; n++) index.stateAfter(n);
    index.statesAfter(3, 40);
    expect(calls.list.length).toBeGreaterThan(LINES.length); // the replays did tokenize
    expect(wrong()).toEqual([]);
  });

  it('a build that starts again from a snapshot after an edit is told it as well', () => {
    const c = klartext();
    const index = new ModalIndex(c.cp, c.db, { every: EVERY });
    index.reset(LINES.length, (n) => LINES[n - 1]);
    while (!index.buildSome(1000));
    calls.list.length = 0;
    // An edit at line 33 keeps the snapshots up to line 30; the build resumes from the one at line 30.
    index.applyChange(33, LINES.length, (n) => LINES[n - 1]);
    while (!index.buildSome(0));
    expect(calls.list.some(({ text }) => text === LINES[30])).toBe(true); // line 31 was read again
    expect(wrong()).toEqual([]);
  });
});
