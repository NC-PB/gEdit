// Block-number references (plan §5 WP6.3). Owner: WP6.3.
//
// The two transforms that touch block numbers both ask this module three things: which
// words on a line are block numbers, which block each one names, and whether it may be
// rewritten at all. Everything a wrong answer costs is in `renumber.ts` — a jump that
// lands in the wrong place — so the rules are proved here one at a time, against the
// shipped Fanuc profile where it already has the rule and against an inline one where
// the shipped data does not carry it yet.

import { describe, expect, it } from 'vitest';
import { noMachine } from '$lib/core/machines/effective';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { validateProfile } from '$lib/core/profiles/validate';
import {
  MAX_TARGET_DIGITS,
  maskedOf,
  referenceAddresses,
  referencePreflight,
  referencesOn,
  scanProgram,
} from './references';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { TransformContext } from './types';

const FANUC = 'fanuc-gcode';

const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

function compiled(id: string): CompiledProfile {
  const found = BUILTINS.find((cp) => cp.profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

const NO_CODES: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

function context(cp: CompiledProfile, firstLine = 1, document?: readonly string[]): TransformContext {
  return { cp, codes: NO_CODES, options: {}, firstLine, document, machine: noMachine(cp.profile) };
}

/** The shipped Fanuc profile with the reference rules replaced. */
function withReferences(references: NonNullable<Profile['numbering']['references']>): CompiledProfile {
  const cp = compiled(FANUC);
  return compileProfile({ ...cp.profile, numbering: { ...cp.profile.numbering, references } });
}

/** Every reference on one line, read through `cp`. */
function on(cp: CompiledProfile, line: string) {
  const { tokens } = tokenizeLine(line, cp);
  return referencesOn(tokens, line, cp, referenceAddresses(cp));
}

describe('referencesOn', () => {
  const cp = compiled(FANUC);

  it('needs the trigger and the address, not one of them', () => {
    // `M99` returns to the caller and names nothing; `P` on its own is a program number.
    expect(on(cp, 'N10 M99')).toEqual([]);
    expect(on(cp, 'N10 M98 P1010')).toEqual([]);
    expect(on(cp, 'N10 G04 P500')).toEqual([]);
    expect(on(cp, 'N10 M99 P20').map((w) => [w.address, w.text, w.target])).toEqual([['P', '20', 20]]);
  });

  it('reads a keyword that takes its target packed or spaced', () => {
    expect(on(cp, 'N10 GOTO100').map((w) => [w.start, w.end, w.text])).toEqual([[8, 11, '100']]);
    expect(on(cp, 'N10 IF [#1 EQ 1] GOTO 100').map((w) => [w.start, w.end, w.text])).toEqual([[22, 25, '100']]);
  });

  it('keeps the value exactly as it is written, zero padding included', () => {
    expect(on(cp, 'N10 M98 Q0100').map((w) => [w.text, w.target])).toEqual([['0100', 100]]);
  });

  it('finds both values of a cycle that names a range', () => {
    // On the **lathe**: a `G71 P… Q…` names the first and last block of the finishing
    // contour, and WP6.2 moved that rule to the profile whose cycles it describes (F22).
    const lathe = compiled('fanuc-lathe');
    expect(on(lathe, 'N10 G71 P100 Q200 U0.4 W0.1').map((w) => [w.address, w.target, w.rewrite])).toEqual([
      ['P', 100, true],
      ['Q', 200, true],
    ]);
    // …and `U`/`W` are the stock allowances of the same block, not references.
    expect(on(lathe, 'N10 G71 P100 Q200 U0.4 W0.1').map((w) => w.address)).toEqual(['P', 'Q']);

    // On the **mill** the same block is found as well, and is never rewritten (G8 M6).
    // A turning program that carries no lathe-only marker is opened with the mill
    // profile, and the mill has no idea what those two numbers are — but "I do not know"
    // has to reach the results panel, not be silence while the blocks they name are
    // renumbered or cut away underneath them.
    expect(on(cp, 'N10 G71 P100 Q200 U0.4 W0.1').map((w) => [w.address, w.target, w.rewrite])).toEqual([
      ['P', 100, false],
      ['Q', 200, false],
    ]);
    // A mill peck-drilling block carries a `Q` and no `P`, so it is untouched by that
    // guard — which is the whole reason the guard asks for both (F22).
    expect(on(cp, 'N30 G73 Z-30. R2. Q3. F150.')).toEqual([]);
  });

  it('reads a value that stands away from its address, and a block written back to front', () => {
    // syntax-fanuc §3.1: whitespace between an address and its value is allowed, and the
    // words of a block may stand in any order. The tokenizer always read `P 100`; the
    // triggers did not, so `G71 P 100 Q 200` was no reference at all and a renumber moved
    // the blocks it names and left the pointers behind, silently (G8 M6).
    const lathe = compiled('fanuc-lathe');
    expect(on(lathe, 'N30 G71 P 100 Q 200 U0.4 W0.1 F0.25').map((w) => [w.address, w.target])).toEqual([
      ['P', 100],
      ['Q', 200],
    ]);
    expect(on(lathe, 'N70 G70 P100 Q 200').map((w) => [w.address, w.target])).toEqual([
      ['P', 100],
      ['Q', 200],
    ]);
    expect(on(lathe, 'N10 M98 Q 50').map((w) => [w.address, w.target, w.rewrite])).toEqual([['Q', 50, true]]);
    expect(on(lathe, 'N10 M 98 Q50').map((w) => [w.address, w.target, w.rewrite])).toEqual([['Q', 50, true]]);
    // A `P` in front of the M-word is the same subprogram call, so the same guard has to
    // hold: `N50 P2000 M98 Q50` starts program 2000 at *its* N50.
    expect(on(lathe, 'N50 P2000 M98 Q50').map((w) => [w.address, w.target, w.rewrite])).toEqual([['Q', 50, false]]);
    expect(on(cp, 'N50 P2000 M98 Q50').map((w) => [w.address, w.target, w.rewrite])).toEqual([['Q', 50, false]]);
  });

  it('refuses a block that carries the same address twice', () => {
    // A rule fires on the line, not on a span of it, so a block with two `Q` words used
    // to hand both of them to the `M98 Q` rule — and a 3 mm peck depth came back as a
    // block number (G8 M6). No control takes such a block and no post writes one; the
    // answer is still to report both and rewrite neither.
    const lathe = compiled('fanuc-lathe');
    expect(on(lathe, 'N20 G83 Z-30. R2. Q3000 F0.1 M98 Q3000').map((w) => [w.address, w.ambiguous])).toEqual([
      ['Q', true],
      ['Q', true],
    ]);
    expect(on(lathe, 'N20 G70 P100 Q200 M98 P1000').map((w) => [w.address, w.text, w.ambiguous])).toEqual([
      ['P', '100', true],
      ['Q', '200', false],
      ['P', '1000', true],
    ]);
    expect(on(lathe, 'N20 G70 P100 Q200').every((w) => !w.ambiguous)).toBe(true);
  });

  it('does not look inside a comment', () => {
    expect(on(cp, 'N10 G0 X0 (GOTO 100 LATER)')).toEqual([]);
    // …and a comment cannot fire a rule for a word outside it either.
    expect(on(cp, 'N10 M98 (M99) Q30').map((w) => [w.address, w.target])).toEqual([['Q', 30]]);
  });

  it('names a computed target instead of overlooking it', () => {
    // A renumber can neither follow `GOTO #100` nor leave it working, so the caller has
    // to hear about it. `target` is null: there is no block number to name.
    expect(on(cp, 'N10 GOTO #100').map((w) => [w.text, w.target])).toEqual([['#100', null]]);
    expect(on(cp, 'N10 GOTO [#1+1]').map((w) => [w.text, w.target])).toEqual([['[#1+1]', null]]);
    expect(on(cp, 'N10 M99 P#100').map((w) => [w.text, w.target])).toEqual([['#100', null]]);
  });

  it('refuses a value that is not a plain block number', () => {
    expect(on(cp, 'N10 M99 P100.')[0].target).toBeNull();
    expect(on(cp, 'N10 M99 P-20')[0].target).toBeNull();
    expect(on(cp, `N10 M99 P${'1'.repeat(MAX_TARGET_DIGITS)}`)[0].target).toBe(Number('1'.repeat(MAX_TARGET_DIGITS)));
    expect(on(cp, `N10 M99 P${'1'.repeat(MAX_TARGET_DIGITS + 1)}`)[0].target).toBeNull();
  });

  it('reads `rewrite` from the rule, and the safer answer when two rules fire', () => {
    const open = withReferences([{ trigger: '(?<![A-Z])M99(?!\\d)', addresses: ['P'] }]);
    const closed = withReferences([{ trigger: '(?<![A-Z])M99(?!\\d)', addresses: ['P'], rewrite: false }]);
    const both = withReferences([
      { trigger: '(?<![A-Z])M99(?!\\d)', addresses: ['P'] },
      { trigger: '(?<![A-Z])M99(?!\\d)', addresses: ['P'], rewrite: false },
    ]);
    expect(on(open, 'N10 M99 P20')[0].rewrite).toBe(true);
    expect(on(closed, 'N10 M99 P20')[0].rewrite).toBe(false);
    expect(on(both, 'N10 M99 P20')[0].rewrite).toBe(false);
  });

  it('never rewrites the Q of a M98 that also names a program, even where the caller has that block (I6)', () => {
    // `M98 P2000 Q50` runs program 2000 from **its** N50. The Q therefore names a block of
    // the called program, and the caller's own N50 — if it has one — is a different block
    // that merely shares the number. Renumbering the caller must not move that Q: the call
    // would enter the subprogram somewhere else and nothing on screen would say so.
    //
    // This is the case the shipped `m98-subprogram-start` golden cannot show, because its
    // main program happens to carry no N50. Here it does.
    const mill = compiled(FANUC);
    const found = on(mill, 'N20 M98 P2000 Q50');
    expect(found.map((r) => [r.address, r.text, r.rewrite])).toEqual([['Q', '50', false]]);

    // A local call — a `M98` with no program number — is still rewritten: that Q really
    // does name a block of this program.
    expect(on(mill, 'N20 M98 Q50').map((r) => [r.address, r.rewrite])).toEqual([['Q', true]]);
  });
});

describe('maskedOf and referenceAddresses', () => {
  const cp = compiled(FANUC);

  it('blanks a comment and keeps every offset', () => {
    const line = 'N10 G0 X0 (SEE N50) Y0';
    const { tokens } = tokenizeLine(line, cp);
    const masked = maskedOf(line, tokens);
    expect(masked).toHaveLength(line.length);
    expect(masked).toBe('N10 G0 X0           Y0');
  });

  it('collects every address a rule could have to rewrite', () => {
    expect([...referenceAddresses(cp)].sort()).toEqual(['GOTO', 'P', 'Q']);
    expect(referenceAddresses(compiled('heidenhain-klartext')).size).toBe(0);
  });
});

describe('scanProgram', () => {
  const cp = compiled(FANUC);

  it('answers nothing at all for a dialect that describes no references', () => {
    const klartext = compiled('heidenhain-klartext');
    const scan = scanProgram(['0 BEGIN PGM T MM', '1 L X+0 R0 FMAX'], context(klartext));
    expect(scan).toMatchObject({ count: 0, first: 0, unchecked: false, found: [] });
  });

  it('counts the lines that point at a block number and names the first', () => {
    const scan = scanProgram(['N10 G0 X0', 'GOTO 100', 'N30 M99 P20'], context(cp));
    expect([scan.count, scan.first]).toEqual([2, 2]);
    expect(scan.found.map((f) => [f.row, f.word.target])).toEqual([
      [1, 100],
      [2, 20],
    ]);
  });

  it('indexes the block numbers of each program on its own', () => {
    const lines = ['O1000', 'N10 G0 X0', 'N100 G1 X1.', 'O1001', 'N10 G0 Z5.', 'N100 G1 Z1.'];
    const scan = scanProgram(lines, context(cp));
    expect([...scan.segmentOf]).toEqual([0, 0, 0, 1, 1, 1]);
    expect(scan.segments).toHaveLength(2);
    expect(scan.segments[0].get(100)).toEqual({ count: 1, row: 2, lastRow: 2 });
    expect(scan.segments[1].get(100)).toEqual({ count: 1, row: 5, lastRow: 5 });
  });

  it('counts a number that a program uses twice', () => {
    const scan = scanProgram(['O1000', 'N100 G0 X0', 'N20 G1 X1.', 'N100 G1 X2.'], context(cp));
    expect(scan.segments[0].get(100)).toEqual({ count: 2, row: 1, lastRow: 3 });
  });

  it('reads the document, not the selection, and says so when it has none', () => {
    const document = ['O1000', 'N10 GOTO 100', 'N20 G0 X0', 'N100 G1 X1.'];
    const inside = scanProgram(document.slice(2), context(cp, 3, document));
    expect([inside.scanned.length, inside.firstLine, inside.unchecked, inside.count]).toEqual([4, 1, false, 1]);
    // The same two lines with no document behind them: one line, and an honest "unknown".
    const bare = scanProgram(document.slice(2), context(cp, 3));
    expect([bare.scanned.length, bare.firstLine, bare.unchecked, bare.count]).toEqual([2, 3, true, 0]);
  });

  it('starts at line 1 of a fragment that begins at the start of the document', () => {
    const bare = scanProgram(['N10 GOTO 100', 'N100 G0 X0'], context(cp, 1));
    expect([bare.firstLine, bare.unchecked, bare.first]).toEqual([1, false, 1]);
  });
});

describe('referencePreflight', () => {
  const keys = { references: 'a.references', unchecked: 'a.unchecked' };

  it('asks about what it found before what it could not look at', () => {
    expect(referencePreflight({ count: 2, first: 7, unchecked: true }, keys)).toEqual({
      key: 'a.references',
      params: { count: 2, first: 7 },
    });
    expect(referencePreflight({ count: 0, first: 0, unchecked: true }, keys)).toEqual({ key: 'a.unchecked' });
    expect(referencePreflight({ count: 0, first: 0, unchecked: false }, keys)).toBeNull();
  });
});
