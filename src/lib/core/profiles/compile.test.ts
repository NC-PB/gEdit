// Guards §7.4: the compiler and the two built-in profile files. Written by the M3
// prelude; owner from Wave A on: WP3.1, which added the validator and the detection
// tests next to it.
//
// The JSON goes through `validateProfile` here, exactly as the registry loads it, so
// these assertions describe a profile the app would really accept.

import { describe, expect, it } from 'vitest';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import { BUILTIN_PROFILE_JSON, FALLBACK_PROFILE_ID } from '$lib/data/profiles';
import { ProfileError, compileProfile } from './compile';
import { validateProfile } from './validate';
import type { Profile } from './types';

/** The built-in as the registry sees it: validated, never cast. */
function validated(raw: unknown): Profile {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`the built-in profile does not validate: ${checked.errors.join('; ')}`);
  return checked.profile;
}

const fanuc = validated(fanucJson);
const heidenhain = validated(heidenhainJson);

describe('built-in profiles', () => {
  it('ships the P1 dialects and the M6 lathe, resolved, the default first', () => {
    // M6: the list holds the **resolved** built-ins (AD-16), so a child profile is in it
    // exactly as the app uses it — `fanuc-lathe` with `fanuc-gcode` merged in.
    expect(BUILTIN_PROFILE_JSON).toHaveLength(3);
    expect((BUILTIN_PROFILE_JSON as Profile[]).map((p) => p.id)).toEqual([
      'fanuc-gcode',
      'fanuc-lathe',
      'heidenhain-klartext',
    ]);
    expect(FALLBACK_PROFILE_ID).toBe('fanuc-gcode');
  });

  it('keeps the M1 ids, short names and filter names', () => {
    expect(fanuc.id).toBe('fanuc-gcode');
    expect(fanuc.shortName).toBe('Fanuc');
    expect(fanuc.files.filterName).toBe('Fanuc G-Code');
    expect(fanuc.files.defaultExtension).toBe('nc');

    expect(heidenhain.id).toBe('heidenhain-klartext');
    expect(heidenhain.shortName).toBe('Heidenhain');
    expect(heidenhain.files.filterName).toBe('Heidenhain Klartext');
    expect(heidenhain.files.defaultExtension).toBe('h');
  });

  it('writes new files with CRLF and keeps the encoding and line endings of an opened one', () => {
    for (const p of [fanuc, heidenhain]) {
      expect(p.files.newFileLineEnding).toBe('crlf');
      expect(p.files.encoding).toBe('keep');
      expect(p.files.lineEnding).toBe('keep');
    }
  });

  it('keeps .min with Fanuc until an Okuma profile exists', () => {
    expect(fanuc.files.extensions).toContain('min');
    expect(fanuc.detect.extensions.min).toBe(2);
    expect(heidenhain.detect.extensions).toEqual({ h: 10 });
  });
});

describe('compileProfile', () => {
  it('compiles the built-ins case-insensitively', () => {
    for (const p of [fanuc, heidenhain]) {
      const cp = compileProfile(p);
      expect(cp.flags).toBe('i');
      expect(cp.profile).toBe(p);
      expect(cp.re.detectContent).toHaveLength(p.detect.content.length);
      expect(cp.re.outline).toHaveLength(p.outline.length);
      expect(cp.re.outline.map((r) => r.kind)).toEqual(p.outline.map((r) => r.kind));
      expect(cp.re.programStart.length + cp.re.programEnd.length).toBeGreaterThan(0);
      for (const re of [cp.re.toolTrigger, cp.re.tool, ...cp.re.programStart, ...cp.re.programEnd]) {
        expect(re.flags).toBe('i');
        expect(re.global).toBe(false);
      }
    }
  });

  it('compiles the optional patterns only when the profile has them', () => {
    const f = compileProfile(fanuc).re;
    expect(f.variables?.test('#101')).toBe(true);
    expect(f.sectionHeading).toBeUndefined();
    expect(f.continuation).toBeUndefined();
    expect(f.commentFilter?.test('-----')).toBe(true);
    // M6/WP6.2: the mill lost the lathe `G70`–`G73 P/Q` **rewrite** rule (F22), because
    // `G73` on a mill is the chip-break peck cycle and its `Q` a depth. The second `Q`
    // rule is I6's: a `M98` block that also carries a `P` names a block of the *called*
    // program, so that `Q` is reported and never rewritten (plan §0 item 5).
    //
    // The fourth rule is the G8 M6 guard: a `G70`–`G73` block that carries **both** a `P`
    // and a `Q` is a turning cycle whichever profile the document is read with, and a
    // turning program that carries no lathe-only marker is read with this one. The mill
    // still never rewrites those values — but it now says they are there, so a renumber
    // or a remove-block-numbers cannot quietly cut the blocks they name.
    expect(f.references.map((r) => r.addresses)).toEqual([['P'], ['Q'], ['Q'], ['P', 'Q'], ['GOTO']]);
    expect(fanuc.numbering?.references?.map((r) => r.rewrite !== false)).toEqual([false, true, false, false, true]);

    const h = compileProfile(heidenhain).re;
    expect(h.sectionHeading?.test('12 * - ROUGHING')).toBe(true);
    expect(h.continuation?.test('Q200=2 ;TEXT ~')).toBe(true);
    expect(h.variables?.test('QL5')).toBe(true);
    expect(h.commentFilter).toBeUndefined();
    expect(h.references).toEqual([]);
  });

  it('matches the packed CAM output the profiles were written for', () => {
    const f = compileProfile(fanuc).re;
    expect(f.toolTrigger.test('N10T1M6')).toBe(true);
    expect(f.toolTrigger.test('N10 G0 X10.')).toBe(false);
    expect('N10T1M6'.match(f.tool)?.groups?.tool).toBe('1');

    const h = compileProfile(heidenhain).re;
    expect(h.toolTrigger.test('12 TOOL CALL 5 Z S5000')).toBe(true);
    // A TOOL CALL without a tool only changes the speed, so it is not a tool change.
    expect(h.toolTrigger.test('12 TOOL CALL Z S5000')).toBe(false);
    expect('12 TOOL CALL "D10" Z S5000'.match(h.tool)?.groups?.tool).toBe('"D10"');
  });

  it('upper-cases the keywords and puts the longest first', () => {
    const cp = compileProfile(heidenhain);
    expect(cp.keywords[0]).toBe('FUNCTION RESET TCPM');
    expect(cp.keywords).toContain('TOOL CALL');
    // `LBL` has to be tried before `L`, or `LBL 1` tokenizes as a straight-line block.
    expect(cp.keywords.indexOf('LBL')).toBeLessThan(cp.keywords.indexOf('L'));
    for (const [i, keyword] of cp.keywords.entries()) {
      expect(keyword).toBe(keyword.toUpperCase());
      if (i > 0) expect(cp.keywords[i - 1].length).toBeGreaterThanOrEqual(keyword.length);
    }
    // Equal lengths stay in alphabetical order, so a generated grammar is reproducible.
    expect(compileProfile(fanuc).keywords).toEqual([
      'WHILE', 'GOTO', 'THEN', 'AND', 'END', 'MOD', 'XOR', 'DO', 'EQ', 'GE', 'GT', 'IF', 'LE', 'LT', 'NE', 'OR',
    ]);
  });

  it('names the field when a pattern does not compile', () => {
    const broken = { ...heidenhain, outline: [...heidenhain.outline, { kind: 'label' as const, pattern: '(' }] };
    expect(() => compileProfile(broken)).toThrow(ProfileError);
    try {
      compileProfile(broken);
    } catch (error) {
      expect((error as ProfileError).path).toBe('outline[7].pattern');
      expect((error as ProfileError).message).toContain('outline[7].pattern');
    }
  });

  it('names the field when a required pattern is missing', () => {
    const broken = { ...fanuc, toolCall: { ...fanuc.toolCall, trigger: undefined as unknown as string } };
    expect(() => compileProfile(broken)).toThrow(/toolCall\.trigger/);
  });
});

// ---------------------------------------------------------------------------
// What the shipped profiles say about their dialect
// ---------------------------------------------------------------------------
//
// These are data assertions, but every one of them decides how the editor behaves: the
// axis list colours the moves, the keyword list decides what a comparison is painted as,
// the reference list is what a renumber has to rewrite, and the outline rules are the
// program map.

describe('the dialect the built-in profiles describe', () => {
  // The lathe is a child profile (AD-16), so it is taken from the **resolved** list: its
  // own file says only what differs from the mill.
  const lathe = validated(BUILTIN_PROFILE_JSON.find((raw) => (raw as Profile).id === 'fanuc-lathe'));
  const compiled = {
    fanuc: compileProfile(fanuc),
    heidenhain: compileProfile(heidenhain),
    lathe: compileProfile(lathe),
  };

  it('counts U, V and W as axes, because on a lathe U and W are the axes', () => {
    // `G28 U0. W0.` is a move. With U/V/W left out they colour like a register letter,
    // and `addresses.axes` is what the P2/P4 axis transforms read as well.
    for (const profile of [fanuc, heidenhain]) {
      expect(profile.addresses.axes, profile.id).toEqual(['X', 'Y', 'Z', 'A', 'B', 'C', 'U', 'V', 'W']);
    }
  });

  it('tokenizes the Macro B comparisons before the single-letter addresses', () => {
    // `syntax-fanuc` §3.8 rule 7. Without them `IF[#101GT10.]` paints a tool change and
    // `IF[#1EQ2]` a peck depth, inside a condition.
    for (const word of ['IF', 'GOTO', 'THEN', 'WHILE', 'DO', 'END', 'EQ', 'NE', 'GT', 'LT', 'GE', 'LE', 'AND', 'OR', 'XOR', 'MOD']) {
      expect(fanuc.syntax.keywords, word).toContain(word);
    }
  });

  it('knows every kind of N-number reference a renumber has to rewrite', () => {
    // `syntax-fanuc` §7.2: `M99 P<n>`, `M98 Q<n>`, `GOTO <n>` and the `P`/`Q` of the
    // multi-pass cycles. `M98 P<n>` is deliberately not one: it names a program.
    //
    // M6/WP6.2 (F22): the `G7[0-3]` rule left this **mill** profile, because `G73` on a
    // mill is the chip-break peck cycle and its `Q` a depth — the code database says so —
    // so an everyday drilling block used to raise the one confirmation that protects the
    // user (G8 M4). The rule now sits on the lathe profile, where those cycles live, and
    // the lathe assertions below are the ones that keep it honest.
    const fired = (line: string): string[] =>
      compiled.fanuc.re.references.filter((rule) => rule.trigger.test(line)).flatMap((rule) => rule.addresses);
    expect(fired('N10 M99 P100').sort()).toEqual(['P']);
    expect(fired('N10 M98 Q1200').sort()).toEqual(['Q']);
    expect(fired('N70 IF[#1EQ2]GOTO100')).toEqual(['GOTO']);
    // A program call is not a block reference, so renumbering must leave it alone.
    expect(fired('N10 M98 P2000')).toEqual([]);
    // Nor is a peck depth, on either profile: the mill's `G7[0-3]` guard wants a `P` as
    // well, and a drilling block has none.
    expect(fired('N30 G73 Z-30. R2. Q3. F150.')).toEqual([]);
    expect(fired('N30 G83 Z-30. R2. Q3. F150.')).toEqual([]);
    // G8 M6: a two-block turning cycle read with the mill profile. Both values are found
    // — and the rule that finds them forbids the rewrite, which the run then reports.
    expect(fired('N10 G71 P100 Q200 U0.4 W0.1 F0.25').sort()).toEqual(['P', 'Q']);
    expect(fired('N10 G70 P100 Q200').sort()).toEqual(['P', 'Q']);

    const onLathe = (line: string): string[] =>
      compiled.lathe.re.references.filter((rule) => rule.trigger.test(line)).flatMap((rule) => rule.addresses);
    expect(onLathe('N10 G71 P100 Q200 U0.4 W0.1 F0.25').sort()).toEqual(['P', 'Q']);
    expect(onLathe('N10 G70 P100 Q200').sort()).toEqual(['P', 'Q']);
    // The first block of the two-line lathe form has neither, and names nothing.
    expect(onLathe('N20 G71 U1.5 R0.5')).toEqual([]);
    expect(onLathe('N30 G83 Z-30. R2. Q3000 F0.1')).toEqual([]);
    // `M98 Q` is a local call and is rewritten; `M98 P… Q…` names a block of the *called*
    // program, which this file cannot renumber (F42). G8 M6: the lathe now carries the
    // same pair the mill does, so that second case is **reported** — two rules fire, one
    // of them `rewrite: false`, and `referencesOn` keeps the safer of the two answers.
    expect(onLathe('N10 M98 Q500')).toEqual(['Q']);
    expect(onLathe('N10 M98 P2005 Q500')).toEqual(['Q', 'Q']);

    // G8 M6: Fanuc lets the words of a block stand in any order and allows a space behind
    // an address, so none of these may slip past a trigger (syntax-fanuc §3.1).
    for (const line of ['N10 G71 P 100 Q 200 U0.4', 'N10 G70 P100 Q 200', 'N10 Q200 P100 G71 U0.4']) {
      expect(onLathe(line).sort(), line).toEqual(['P', 'Q']);
    }
    expect(onLathe('N10 M98 Q 50')).toEqual(['Q']);
    expect(onLathe('N10 M 98 Q50')).toEqual(['Q']);
    expect(onLathe('N50 P2000 M98 Q50')).toEqual(['Q', 'Q']);
    expect(fired('N50 P2000 M98 Q50')).toEqual(['Q', 'Q']);
    expect(onLathe('N10 M99 P 30')).toEqual(['P']);
    expect(fired('N10 M099 P30')).toEqual(['P']);
    // …and a number that only begins with 98 or 99 is a different M-code.
    expect(fired('N10 M981 Q50')).toEqual([]);
    expect(onLathe('N10 M981 Q50')).toEqual([]);
  });

  it('offers the extensions the syntax notes list', () => {
    for (const extension of ['nc', 'tap', 'cnc', 'eia', 'iso', 'min', 'ncc', 'ptp']) {
      expect(fanuc.files.extensions, extension).toContain(extension);
    }
  });

  it('reads a punched-tape program number the same way everywhere', () => {
    // Detection and the grammar both accept `:1004`; `program.start` and the `program`
    // outline rule used to accept only `O1004`, so such a file had no program row and
    // `restartAtProgramStart` never fired.
    const starts = (line: string): boolean => compiled.fanuc.re.programStart.some((re) => re.test(line));
    const outlined = (line: string): boolean =>
      compiled.fanuc.re.outline.some((rule) => rule.kind === 'program' && rule.re.test(line));
    for (const line of ['O1004 (NAME)', ':1004']) {
      expect(starts(line), line).toBe(true);
      expect(outlined(line), line).toBe(true);
    }
  });

  it('declares its string rule, and the marker it has to write for a continuation', () => {
    // Fanuc has no strings (`syntax-fanuc` §3.7); a stray `"` there is a character.
    expect(fanuc.syntax.strings ?? false).toBe(false);
    expect(heidenhain.syntax.strings).toBe(true);
    // The pattern recognises a continuation, the mark writes one (the cycle snippet).
    const mark = heidenhain.syntax.continuationMark as string;
    expect(mark).toBe('~');
    expect(compiled.heidenhain.re.continuation?.test(`Q200=2 ${mark}`)).toBe(true);
  });

  it('gives the program map a rule for a program end and for a subprogram call', () => {
    // `syntax-fanuc` §8 and `syntax-heidenhain` §8 both list them, `OutlineKind` has the
    // kinds and the panel has the icons, so a profile without the rules is the gap.
    for (const [id, profile] of Object.entries(compiled)) {
      const kinds = new Set(profile.re.outline.map((rule) => rule.kind));
      expect(kinds, id).toContain('end');
      expect(kinds, id).toContain('subprogram-call');
      expect(kinds, id).toContain('program');
    }
  });
});
