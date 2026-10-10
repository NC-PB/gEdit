// The Sinumerik grammar (plan §6 WP8.4): every rule compiles the way Monaco builds it,
// the rules are stable, and a block of Sinumerik code comes out with the roles
// `docs/planning/syntax/syntax-sinumerik.md` §3.8 asks for.
//
// Monaco is never imported here, for the reason `grammar.test.ts` gives: `core/` is
// Monaco-free (AD-1). `tokenize` below is the same copy of the inner loop of
// `monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js` — a rule is
// compiled as `'^(?:' + source + ')'`, a leading `^` makes it line-start-only, the first
// rule that matches wins, and a group action needs one capture group per action covering
// the whole match. It is stricter in the one place this grammar leans on: Monarch reads
// the length of every capture group of a group action, so a group that did not take part
// in the match throws in the editor, and it fails here.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateGrammar } from './index';
import { allRules, emittedRoles, monarchRun, monarchTokens, type Emitted, type MonarchLike } from './monarchSim';
import { sinumerikRules } from './sinumerik';
import { EDITOR_COLORS, ROLES, ROLE_COLORS, type Role } from './roles';
import { orderedKeywords, type GrammarRule } from './shared';
import { compileProfile } from '$lib/core/profiles/compile';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { validateProfile } from '$lib/core/profiles/validate';
import { emptyCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import { languageConfiguration, unionCodeDb, variantDialects } from '$lib/monaco/languages';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { FIXTURES_DIR, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';

const PROFILE_ID = 'sinumerik';

interface Grammar {
  defaultToken: string;
  ignoreCase: boolean;
  tokenizer: { root: GrammarRule[]; [state: string]: unknown[] };
}

/**
 * The built-in Sinumerik profile with the database and the grammar the app builds for it:
 * resolved, and the union of the variant databases, the way `monaco/languages.ts` does.
 */
const { profile, db, grammar } = (() => {
  const raw = BUILTIN_PROFILE_JSON.find((entry) => (entry as { id?: string }).id === PROFILE_ID);
  if (!raw) throw new Error(`no built-in profile ${PROFILE_ID}`);
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`${PROFILE_ID} does not validate: ${checked.errors.join('; ')}`);
  const resolved = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
  const codes = unionCodeDb(variantDialects(checked.profile).map((d) => resolved[d] ?? emptyCodeDb(d)));
  return {
    profile: checked.profile,
    db: codes,
    grammar: generateGrammar(checked.profile, codes) as unknown as Grammar,
  };
})();

/** One rule, compiled the way `Rule.setRegex` in Monarch compiles it. */
function compileRule([source, action]: GrammarRule, ignoreCase: boolean) {
  const anchored = source.startsWith('^');
  return {
    source,
    action,
    anchored,
    re: new RegExp(`^(?:${anchored ? source.slice(1) : source})`, ignoreCase ? 'i' : ''),
  };
}

/** Monarch's tokenizer loop for one line, from the base state (`monarchSim.ts`). */
function tokenize(line: string, built: Grammar = grammar): Emitted[] {
  return monarchTokens(built as unknown as MonarchLike, line);
}

/** `role:text` for everything the grammar gives a role to; neutral tokens are dropped. */
function at(line: string, built: Grammar = grammar): string[] {
  return tokenize(line, built)
    .filter((token) => token.role !== '')
    .map((token) => `${token.role}:${token.text}`);
}

/** The label the profile's `syntax.labels` finds on `line`, colon included, or null. */
function profileLabel(line: string): string | null {
  const source = compileProfile(profile).re.labels;
  if (!source) throw new Error('the profile declares no labels');
  const match = new RegExp(source.source, `${source.flags}d`).exec(line);
  const name = match?.indices?.groups?.name;
  return match && name ? line.slice(name[0], match.index + match[0].length) : null;
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of `#rrggbb`, as in `roles.test.ts`. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every role the generated rules can emit, in the order they are declared. */
const emitted: string[] = emittedRoles(grammar as unknown as MonarchLike);

describe('the sinumerik grammar', () => {
  it('every rule compiles as Monarch compiles it', () => {
    expect(grammar.tokenizer.root.length).toBeGreaterThan(20);
    for (const rule of allRules(grammar as unknown as MonarchLike) as GrammarRule[]) {
      expect(() => compileRule(rule, grammar.ignoreCase)).not.toThrow();
      // Monarch reads `^` as the line-start anchor only at position 0; anywhere else it
      // would match at every token boundary.
      expect(rule[0].slice(1), `stray ^ in ${rule[0]}`).not.toMatch(/(?<!\\)\^(?![^[\]]*\])/);
      // Before it compiles a rule, Monarch replaces `@name` with an attribute of the
      // language definition and `$S1` with a part of the state name. A generated rule may
      // contain neither, or the editor throws or matches something else.
      expect(rule[0], `@ in ${rule[0]}`).not.toMatch(/@\w/);
      expect(rule[0], `$S in ${rule[0]}`).not.toMatch(/\$[sS]\d/);
    }
  });

  it('is stable', () => {
    expect(sinumerikRules(profile, db)).toMatchSnapshot();
  });

  it('splits keywords the way the tokenizer does', () => {
    expect(orderedKeywords(profile)).toEqual(compileProfile(profile).keywords);
  });

  it('marks no error and invents no role', () => {
    expect(grammar.defaultToken).toBe('');
    expect(grammar.ignoreCase).toBe(true);
    for (const role of emitted) expect(ROLES as readonly string[]).toContain(role);
    // Marking an error is the linter's job, so the grammar never says `invalid`.
    expect(emitted).not.toContain('invalid');
    // A label borrows `section` and a call borrows `keyword`; neither has a role of its
    // own, because a new role means a new colour and a new pair to measure.
    expect(emitted).toContain('section');
    expect(emitted).toContain('keyword');
  });

  it('only emits roles that are legible in both themes', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const role of emitted) {
        const ratio = contrast(ROLE_COLORS[mode][role as Role], EDITOR_COLORS[mode].background);
        expect(ratio, `${role} in ${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('the sinumerik grammar reads a block', () => {
  it.each([
    // The frame of the file: the transfer header and the path line behind it (§2.2).
    ['%_N_SHAFT_OP10_MPF', ['programMarker:%_N_SHAFT_OP10_MPF']],
    ['%_N_SHAFT_SUB_SPF', ['programMarker:%_N_SHAFT_SUB_SPF']],
    [';$PATH=/_N_WKS_DIR/_N_SHAFT_WPD', ['comment:;$PATH=/_N_WKS_DIR/_N_SHAFT_WPD']],
    // Motion and the words CAM writes around it.
    ['N10 G18 G90 G95 DIAMON', ['blockNumber:N10', 'gcode:G18', 'gcode:G90', 'gcode:G95', 'keyword:DIAMON']],
    ['N20 G54 G642', ['blockNumber:N20', 'gcode:G54', 'gcode:G642']],
    ['G0 X-35 Z0', ['gcode:G0', 'axis:X-35', 'axis:Z0']],
    ['X.5 F.2 Z+3', ['axis:X.5', 'feed:F.2', 'axis:Z+3']],
    ['G2 X40 Z-10 I0 K-5', ['gcode:G2', 'axis:X40', 'axis:Z-10', 'arcCenter:I0', 'arcCenter:K-5']],
    ['T3 D1', ['tool:T3', 'number:D1']],
    ['T="ROUGH_80" D1', ['tool:T', 'operator:=', 'string:"ROUGH_80"', 'number:D1']],
    ['T0 D0', ['tool:T0', 'number:D0']],
    ['DIAM90 DIAMOF', ['keyword:DIAM90', 'keyword:DIAMOF']],
    ['M30', ['mcode:M30']],
    // Packed words, the form §3.7 accepts for single-letter addresses.
    ['N120G0X10Z20', ['blockNumber:N120', 'gcode:G0', 'axis:X10', 'axis:Z20']],
    ['N40 T1D1', ['blockNumber:N40', 'tool:T1', 'number:D1']],
    // The control does not care about case (§3.5).
    ['n10 g1 x10 z-5 f0.2', ['blockNumber:n10', 'gcode:g1', 'axis:x10', 'axis:z-5', 'feed:f0.2']],
    // A dwell writes its time in `F`, a thread its lead in `K`. The addresses keep their
    // roles; what must never be scaled as a feed is the scripts' business (WP8.7).
    ['G4 F2.5', ['gcode:G4', 'feed:F2.5']],
    ['G33 Z-30 K1.5 SF=0', ['gcode:G33', 'axis:Z-30', 'arcCenter:K1.5', 'number:SF', 'operator:=', 'number:0']],
    // Subprograms, jumps and parameters.
    ['L100 P3', ['keyword:L100', 'number:P3']],
    ['GOTOF N200', ['keyword:GOTOF', 'blockNumber:N200']],
    ['R1=R2*2', ['variable:R1', 'operator:=', 'variable:R2', 'operator:*', 'number:2']],
    ['X=$AA_IM[X]', ['axis:X', 'operator:=', 'variable:$AA_IM', 'operator:[', 'operator:]']],
    ['IF R1==5 GOTOB LOOP_A', ['keyword:IF', 'variable:R1', 'operator:==', 'number:5', 'keyword:GOTOB', 'section:LOOP_A']],
    ['R1=1.5EX-3', ['variable:R1', 'operator:=', 'number:1.5EX-3']],
    [
      "R2='H7F' R3='B1001'",
      ['variable:R2', 'operator:=', "number:'H7F'", 'variable:R3', 'operator:=', "number:'B1001'"],
    ],
  ])('reads %s', (line, expected) => {
    expect(at(line)).toEqual(expected);
  });

  it('reads a string before it reads a comment', () => {
    // The `;` of a message is part of the text, not the start of a comment (§3.4).
    expect(at('MSG("ROUGH ; PASS") ; NOTE')).toEqual([
      'keyword:MSG',
      'operator:(',
      'string:"ROUGH ; PASS"',
      'operator:)',
      'comment:; NOTE',
    ]);
    // An unclosed string ends at the line, so a half-typed message does not hand the rest
    // of the block to the comment rule either.
    expect(at('MSG("ROUGH ; PASS')).toEqual(['keyword:MSG', 'operator:(', 'string:"ROUGH ; PASS']);
    // Once a comment has started, a quote is part of it.
    expect(at('N10 G1 X10 ;TO "SIZE"')).toEqual(['blockNumber:N10', 'gcode:G1', 'axis:X10', 'comment:;TO "SIZE"']);
  });

  it('never reads `( … )` as a comment', () => {
    // The Fanuc rule would have swallowed the whole cycle. The name is the call and the
    // arguments keep the colours of what they are, an empty one included.
    expect(at('CYCLE81(10,0,2,-12)')).toEqual([
      'keyword:CYCLE81',
      'operator:(',
      'number:10',
      'operator:,',
      'number:0',
      'operator:,',
      'number:2',
      'operator:,',
      'operator:-',
      'number:12',
      'operator:)',
    ]);
    expect(at('MCALL CYCLE83(50,0,2,-25,,-5)').slice(0, 4)).toEqual([
      'keyword:MCALL',
      'keyword:CYCLE83',
      'operator:(',
      'number:50',
    ]);
    expect(at('CYCLE95("SHAFT",2,0.4)')).toEqual([
      'keyword:CYCLE95',
      'operator:(',
      'string:"SHAFT"',
      'operator:,',
      'number:2',
      'operator:,',
      'number:0.4',
      'operator:)',
    ]);
    // A call by name and a cycle are the same shape to a grammar built before anyone picks
    // a machine, so both are the keyword role — and so are the value functions.
    expect(at('SHAFT_PROBE(1,,3)').slice(0, 2)).toEqual(['keyword:SHAFT_PROBE', 'operator:(']);
    expect(at('X=AC(10) C=DC(90)')).toEqual([
      'axis:X',
      'operator:=',
      'keyword:AC',
      'operator:(',
      'number:10',
      'operator:)',
      'axis:C',
      'operator:=',
      'keyword:DC',
      'operator:(',
      'number:90',
      'operator:)',
    ]);
    // Brackets group a condition as well.
    expect(at('IF (R1>5) AND (R2<3) GOTOF END_A')).toEqual([
      'keyword:IF',
      'operator:(',
      'variable:R1',
      'operator:>',
      'number:5',
      'operator:)',
      'keyword:AND',
      'operator:(',
      'variable:R2',
      'operator:<',
      'number:3',
      'operator:)',
      'keyword:GOTOF',
      'section:END_A',
    ]);
  });

  // G8 M8 review: the control reads a name and its argument list with blanks between them
  // as the same call. The grammar painted such a call already; the tokenizers did not read
  // one, so the editor showed a cycle that no script saw. Now all of them read a call where
  // a name stands in front of its bracket, blanks or not, and a letter with a number only
  // with the bracket touching it — `M30 (END)` stays an M30.
  it('paints a name apart from its bracket as the call the tokenizer reads there', () => {
    expect(at('N60 CYCLE840 (5,0,2,-15,,0.5,3,3,1,,1.5)').slice(0, 4)).toEqual([
      'blockNumber:N60',
      'keyword:CYCLE840',
      'operator:(',
      'number:5',
    ]);
    expect(at('N20 MSG ("A;B")')).toEqual([
      'blockNumber:N20',
      'keyword:MSG',
      'operator:(',
      'string:"A;B"',
      'operator:)',
    ]);
    expect(at('N90 M30 (END)')).toEqual(['blockNumber:N90', 'mcode:M30', 'operator:(', 'operator:)']);
    const cp = compileProfile(profile);
    for (const line of [
      'N60 CYCLE840 (5,0,2,-15,,0.5,3,3,1,,1.5)',
      'N60 CYCLE840(5,0,2)',
      'N20 MSG ("A;B")',
      'N30 X=AC (10)',
      'N40 PROBE_DIA\t(1,,3)',
      'N90 M30 (END)',
      'N100 X (5)',
    ]) {
      const calls = tokenizeLine(line, cp)
        .tokens.filter((token) => token.kind === 'call')
        .map((token) => token.address);
      // The grammar paints the name of a call as a keyword; every other keyword of these
      // lines is one the profile declares.
      const keywords = new Set(orderedKeywords(profile));
      const painted = tokenize(line)
        .filter((token) => token.role === 'keyword' && !keywords.has(token.text.toUpperCase()))
        .map((token) => token.text.toUpperCase());
      expect(painted, line).toEqual(calls);
    }
  });

  it('reads a label at the head of the block, and nowhere else', () => {
    expect(at('LOOP_A: G1 X10')).toEqual(['section:LOOP_A:', 'gcode:G1', 'axis:X10']);
    expect(at('N40 LOOP_B: G1 X10')).toEqual(['blockNumber:N40', 'section:LOOP_B:', 'gcode:G1', 'axis:X10']);
    expect(at('/LAB_C: G0 X0')).toEqual(['skip:/', 'section:LAB_C:', 'gcode:G0', 'axis:X0']);
    expect(at('/1 N50 LAB_D: G0')).toEqual(['skip:/1', 'blockNumber:N50', 'section:LAB_D:', 'gcode:G0']);
    // A label may start with the block-number prefix (§3.1 rule 3).
    expect(at('NEXT_PART:')).toEqual(['section:NEXT_PART:']);
    // A jump names its target, and the tokenizer reads the name behind a jump keyword as a
    // label (`syntax.labelAfter`, M12.5), so it is painted like the label it names. A block
    // number, a parameter, a keyword, a call and an assignment behind it keep their own.
    expect(at('GOTOF LOOP_A')).toEqual(['keyword:GOTOF', 'section:LOOP_A']);
    // Away from the head of the block a colon chains frames; `:=` is no label at all.
    expect(at('$P_PFRAME=FRAME_A:CROT(Z,45)')).toEqual([
      'variable:$P_PFRAME',
      'operator:=',
      'operator::',
      'keyword:CROT',
      'operator:(',
      'operator:,',
      'number:45',
      'operator:)',
    ]);
    expect(at('LAB:=5')).toEqual(['operator::', 'operator:=', 'number:5']);
  });

  it('finds a label on exactly the lines the profile finds one', () => {
    // `syntax.labels` is what the tokenizer and the outline read a label with. The grammar
    // cannot use it as it stands — it is anchored and carries the skip and the block
    // number in front of the name — but it has to agree with it, line by line.
    const lines = [
      'LOOP_A: G1 X10',
      '  LOOP_A:',
      'N40 LOOP_B: G1 X10',
      'N40\tLOOP_B:',
      '/LAB_C: G0 X0',
      '/1 N50 LAB_D: G0',
      '/0N50 LAB_E:',
      'NEXT_PART:',
      'N60NEXT:',
      'N 60 LAB_F:',
      'LAB:=5',
      'GOTOF LOOP_A',
      'N10 G0 X10 ; LAB_G: IN A COMMENT',
      'MSG("LAB_H: IN A STRING")',
      '$P_PFRAME=FRAME_A:CROT(Z,45)',
      ':123 LAB_I:',
    ];
    for (const line of lines) {
      // A jump target (`GOTOF LOOP_A`) is painted as a label too, but it is no definition.
      const labels = tokenize(line)
        .filter((token) => token.role === 'section' && token.text.endsWith(':'))
        .map((token) => token.text);
      const expected = profileLabel(line);
      expect(labels, line).toEqual(expected === null ? [] : [expected]);
    }
  });

  // B1-G: the name behind a jump keyword is a label to the tokenizer (`syntax.labelAfter`,
  // M12.5), so it is painted like the label it names; what is no label stays what it was.
  it('paints the target of a jump like a label, and a jump keyword is never a label', () => {
    expect(at('GOTOF SKIPSIM')).toEqual(['keyword:GOTOF', 'section:SKIPSIM']);
    expect(at('N70 IF XNOW<=XBOT GOTOF LAST_CUT')).toContain('section:LAST_CUT');
    expect(at('GOTOB LOOP_A ; BACK')).toEqual(['keyword:GOTOB', 'section:LOOP_A', 'comment:; BACK']);
    expect(at('gotoc end_a')).toEqual(['keyword:gotoc', 'section:end_a']);
    expect(at('GOTO LOOP2')).toEqual(['keyword:GOTO', 'section:LOOP2']);
    // A block number, a parameter, a keyword, a string and an expression behind the jump keep their own colours.
    expect(at('GOTOF N100')).toEqual(['keyword:GOTOF', 'blockNumber:N100']);
    expect(at('GOTOB R10')).toEqual(['keyword:GOTOB', 'variable:R10']);
    expect(at('GOTOF "STEP_"<<N')).toEqual(['keyword:GOTOF', 'string:"STEP_"', 'operator:<<']);
    // A call, an assignment and an indexed name are no target either.
    expect(at('GOTO FOO(1)')).not.toContain('section:FOO');
    expect(at('GOTO FOO=1')).not.toContain('section:FOO');
    expect(at('GOTO FOO[2]')).not.toContain('section:FOO');
    // `GOTOF:20` is the jump to the main block `:20` (B1); read as a label, the colour said
    // a label named GOTOF stood there.
    expect(at('GOTOF:20')).toEqual(['keyword:GOTOF', 'operator::', 'number:20']);
    expect(at('GOTOF :20')).toEqual(['keyword:GOTOF', 'operator::', 'number:20']);
    // A real label that merely starts with a jump keyword is one.
    expect(at('GOTOF_A: G1')).toEqual(['section:GOTOF_A:', 'gcode:G1']);
  });

  // B1-G: the names a `DEF` block declares (`syntax.declareAfter`, M12.5) are variables. Which
  // identifier declares depends on what stood before it on the line, so the grammar has states
  // for it (`declareStates`); they end at the end of the line.
  it('paints the names a DEF block declares as variables', () => {
    expect(at('DEF INT COUNTER')).toEqual(['keyword:DEF', 'keyword:INT', 'variable:COUNTER']);
    expect(at('N10 DEF INT COUNTER')).toEqual(['blockNumber:N10', 'keyword:DEF', 'keyword:INT', 'variable:COUNTER']);
    expect(at('DEF REAL WIDTH, DEPTH=2.5, AREA[3]')).toEqual([
      'keyword:DEF', 'keyword:REAL', 'variable:WIDTH', 'operator:,', 'variable:DEPTH', 'operator:=', 'number:2.5', 'operator:,',
      'variable:AREA', 'operator:[', 'number:3', 'operator:]',
    ]);
    expect(at('DEF STRING[16] STEPNAME="AB"')).toEqual([
      'keyword:DEF', 'keyword:STRING', 'operator:[', 'number:16', 'operator:]', 'variable:STEPNAME', 'operator:=', 'string:"AB"',
    ]);
    expect(at('DEF INT A,B')).toEqual(['keyword:DEF', 'keyword:INT', 'variable:A', 'operator:,', 'variable:B']);
    // Behind a skip mark and a label, as the tokenizer's block head allows.
    expect(at('/1 DEF REAL B')).toEqual(['skip:/1', 'keyword:DEF', 'keyword:REAL', 'variable:B']);
    expect(at('/1 /3 DEF INT A')).toEqual(['skip:/1', 'skip:/3', 'keyword:DEF', 'keyword:INT', 'variable:A']);
    expect(at('  def int a, b')).toEqual(['keyword:def', 'keyword:int', 'variable:a', 'operator:,', 'variable:b']);
    expect(at('N10 LOOP_A: DEF INT A')).toEqual(['blockNumber:N10', 'section:LOOP_A:', 'keyword:DEF', 'keyword:INT', 'variable:A']);
    // A name the profile lists as a keyword is the keyword, and a name behind an `=` is no declaration.
    expect(at('DEF INT A = B')).toEqual(['keyword:DEF', 'keyword:INT', 'variable:A', 'operator:=']);
    // A `,` inside brackets or a call separates arguments, not names.
    expect(at('DEF REAL A=SIN(1,2), B')).toEqual([
      'keyword:DEF', 'keyword:REAL', 'variable:A', 'operator:=', 'keyword:SIN', 'operator:(', 'number:1', 'operator:,', 'number:2',
      'operator:)', 'operator:,', 'variable:B',
    ]);
    expect(at('DEF REAL M[2,3], K')).toEqual([
      'keyword:DEF', 'keyword:REAL', 'variable:M', 'operator:[', 'number:2', 'operator:,', 'number:3', 'operator:]', 'operator:,', 'variable:K',
    ]);
    // A comment ends the list.
    expect(at('DEF INT A ; B, C')).toEqual(['keyword:DEF', 'keyword:INT', 'variable:A', 'comment:; B, C']);
    // Away from the head of the block, and without a type in front, nothing is declared.
    expect(at('G1 DEF INT A')).not.toContain('variable:A');
    expect(at('DEF A')).not.toContain('variable:A');
    // The use of a declared name on a later line is a name (one line at a time).
    expect(at('N20 XNOW=XNOW+1')).not.toContain('variable:XNOW');
  });

  it('leaves a state at the end of the line, whatever the line was', () => {
    // Whatever stack a line ends in, the next line starts as a line of the base state does:
    // a half-typed `DEF` must not paint the lines below it.
    for (const line of ['DEF INT A', 'DEF INT', 'DEF REAL A[3,', 'DEF STRING[32', 'N10 DEF INT A, B=SIN(', 'DEF', 'DEF INT A ; comment']) {
      const { stack } = monarchRun(grammar as unknown as MonarchLike, line);
      for (const next of ['N20 G1 X10', 'GOTOF LOOP_A', 'X5 Y6', '', 'DEF INT A,B']) {
        expect(monarchRun(grammar as unknown as MonarchLike, next, stack).tokens, `${line} / ${next}`).toEqual(
          monarchRun(grammar as unknown as MonarchLike, next).tokens,
        );
      }
    }
    // It is the first rule of every state besides `root`, and it needs no particular character.
    for (const [state, rules] of Object.entries(grammar.tokenizer)) {
      if (state !== 'root') expect(rules[0], state).toEqual(['^', { token: '@rematch', next: '@popall' }]);
    }
    expect(Object.keys(grammar.tokenizer).sort()).toEqual(['declare', 'declareName', 'declareNest', 'root']);
  });

  it('paints a stack of block skips', () => {
    expect(at('/1 /3 N20 G1 X1')).toEqual(['skip:/1', 'skip:/3', 'blockNumber:N20', 'gcode:G1', 'axis:X1']);
    expect(at('/0 /9 N30 G0 Z5')).toEqual(['skip:/0', 'skip:/9', 'blockNumber:N30', 'gcode:G0', 'axis:Z5']);
  });

  it('keeps an address that is written with `=` in the role it has without one', () => {
    // A script that scales feeds and speeds has to tell these apart (WP8.7), and so does
    // the reader: `S3=` drives another spindle, `LIMS=` limits the one that is running.
    expect(at('G96 S220 LIMS=3000 M4')).toEqual([
      'gcode:G96',
      'spindle:S220',
      'number:LIMS',
      'operator:=',
      'number:3000',
      'mcode:M4',
    ]);
    expect(at('G26 S3=2500')).toEqual(['gcode:G26', 'keyword:S3', 'operator:=', 'number:2500']);
    expect(at('T1=4')).toEqual(['keyword:T1', 'operator:=', 'number:4']);
    expect(at('G1 X=R1+5 F=R10*2')).toEqual([
      'gcode:G1',
      'axis:X',
      'operator:=',
      'variable:R1',
      'operator:+',
      'number:5',
      'feed:F',
      'operator:=',
      'variable:R10',
      'operator:*',
      'number:2',
    ]);
    expect(at('X = 10')).toEqual(['axis:X', 'operator:=', 'number:10']);
    // The ISO value pattern would have read this as the C axis and an R parameter.
    expect(at('G2 X40 Z-10 CR=15')).toEqual([
      'gcode:G2',
      'axis:X40',
      'axis:Z-10',
      'number:CR',
      'operator:=',
      'number:15',
    ]);
    // A contour word the database does not know is still an address, not a name.
    expect(at('G1 X20 CHF=1 RND=2')).toEqual([
      'gcode:G1',
      'axis:X20',
      'keyword:CHF',
      'operator:=',
      'number:1',
      'keyword:RND',
      'operator:=',
      'number:2',
    ]);
    // An M function keeps its role with a spindle number in front of the `=` (§3.8 rule
    // 9): `M3=3` turns spindle 3 clockwise, `M2=5` stops spindle 2. What the function
    // means is the database's and the scripts' business; the grammar says it is one.
    expect(at('M3=3')).toEqual(['mcode:M3', 'operator:=', 'number:3']);
    expect(at('M2=5')).toEqual(['mcode:M2', 'operator:=', 'number:5']);
    // A name that is set is an assignment word; the same name compared with `==` is not.
    expect(at('COUNT=5')).toEqual(['keyword:COUNT', 'operator:=', 'number:5']);
    expect(at('IF COUNT==5')).toEqual(['keyword:IF', 'operator:==', 'number:5']);
  });

  it('takes the block skip at the head of the block, with its level', () => {
    expect(at('/N100 G0 X10')).toEqual(['skip:/', 'blockNumber:N100', 'gcode:G0', 'axis:X10']);
    // `/0` is the level of the bare `/`, `/1` to `/9` the others (§3.1 rule 1).
    expect(at('/0 N110 G0 X20')).toEqual(['skip:/0', 'blockNumber:N110', 'gcode:G0', 'axis:X20']);
    expect(at('/9 G0 Z5')).toEqual(['skip:/9', 'gcode:G0', 'axis:Z5']);
    // Anywhere else the slash is the division of an expression, not a skip.
    expect(at('R1=R2/2')).toEqual(['variable:R1', 'operator:=', 'variable:R2', 'operator:/', 'number:2']);
    expect(at('N10 R1=R2/2')).toEqual([
      'blockNumber:N10',
      'variable:R1',
      'operator:=',
      'variable:R2',
      'operator:/',
      'number:2',
    ]);
  });

  it('reads the main block and the R parameters', () => {
    expect(at(':123 G0 X0')).toEqual(['blockNumber::123', 'gcode:G0', 'axis:X0']);
    expect(at('/:124 G0')).toEqual(['skip:/', 'blockNumber::124', 'gcode:G0']);
    expect(at('R10=R[5]+1')).toEqual([
      'variable:R10',
      'operator:=',
      'variable:R',
      'operator:[',
      'number:5',
      'operator:]',
      'operator:+',
      'number:1',
    ]);
    // A name that begins like an R parameter is a name.
    expect(at('R1_SUB')).toEqual([]);
  });

  it('leaves a name it has no meaning for in one neutral token', () => {
    // §3.6: a tokenizer cannot tell a global user variable from a subprogram called by
    // name, so the grammar does not pretend it can.
    const tokens = tokenize('G1 PART_TWO');
    expect(tokens.map((token) => token.text)).toEqual(['G1', ' ', 'PART_TWO']);
    expect(tokens[2].role).toBe('');
  });

  it('colours a code only with the digits this control gives it', () => {
    // There is no `G54.1` here; a Fanuc habit is left uncoloured rather than confirmed.
    expect(at('G54.1')).toEqual(['number:.1']);
    expect(at('G54')).toEqual(['gcode:G54']);
    // A G code has at most three digits, and a longer run is not cut into one.
    expect(at('G1800')).toEqual([]);
    // An M function above the predefined ones belongs to the machine builder and may be
    // longer; it is still an M function.
    expect(at('M1767 M100')).toEqual(['mcode:M1767', 'mcode:M100']);
  });

  it('is configured for `;` comments, brackets and quoted names', () => {
    const config = languageConfiguration(profile);
    expect(config.comments).toEqual({ lineComment: ';' });
    // `(` is a bracket in this dialect, never a comment, so both pairs match and neither
    // of them is offered as a block comment.
    expect(config.brackets).toEqual([
      ['[', ']'],
      ['(', ')'],
    ]);
    expect(config.autoClosingPairs).toEqual([
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ]);
    expect(config.surroundingPairs).toEqual(config.autoClosingPairs);
    // The word under the cursor is the word the assistant looks up: a system variable, an
    // R parameter, a cycle, a label and an assignment word each stay in one piece.
    const words = (text: string) => text.match(new RegExp(config.wordPattern.source, 'g')) ?? [];
    expect(words('$AA_IM[X]')).toEqual(['$AA_IM', 'X']);
    expect(words('R10=R11')).toEqual(['R10=', 'R11']);
    expect(words('CYCLE81(10)')).toEqual(['CYCLE81', '10']);
    expect(words('LOOP_A:')).toEqual(['LOOP_A']);
    expect(words('S3=2500')).toEqual(['S3=', '2500']);
  });
});

/**
 * One synthetic program, written for gEdit from `syntax-sinumerik.md` §2.1, §3 and §7, with
 * every structural element the grammar has a rule for in it. The fixtures the milestone
 * ships belong to WP8.5; this one is here so the acceptance — **no line marked invalid,
 * every line covered, the roles a CAM program is read by all present** — is checked
 * against a whole program rather than against single lines.
 */
const PROGRAM = `%_N_FLANGE_OP20_MPF
;$PATH=/_N_WKS_DIR/_N_FLANGE_WPD
; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE
; FLANGE OP20 - FACE, TURN, THREAD
N10 G18 G90 G95 G500 DIAMON
N20 G54 G642
N30 MSG("FACE ; ROUGH")
N40 T="FACE_80" D1
N50 G96 S200 LIMS=2800 M4
N60 G0 X92 Z0.2 M8
N70 G1 X-1.6 F0.25
N80 G0 Z2
N90 CYCLE95("FLANGE_CONTOUR",2,0.4,0.2,,0.3,0.15,0.1,9)
N100 G0 X200 Z200 M9
N110 T3 D1
N120 G96 S240 LIMS=3200 M4
N130 G0 X62 Z2 M8
N140 G1 X66 Z0 F0.12
N150 G3 X70 Z-2 CR=2
N160 G1 Z-24 RND=0.5
N170 G0 X200 Z200 M9
N180 T="THREAD_60" D1
N190 G97 S800 M4
N200 R1=0 R2=4
N210 THREAD_LOOP: G0 X72 Z4
N220 G33 X=69.8-R1*0.1 Z-20 K1.5 SF=0
N230 R1=R1+1
N240 IF R1<R2 GOTOB THREAD_LOOP
/N250 G0 X200 Z200
/1 N260 M0
N270 L20 P2
N280 G4 F1.5
N290 S3=1200 M3=3
N300 R3=$AA_IM[X]
N310 M5
N320 M30`;

// M9 (WP9.3, R4): the main block prefix, the indexed assignment and the exponent letters are
// the profile's data, and the grammar reads them where the tokenizers do.
describe('the sinumerik grammar reads the M9 fields', () => {
  /** The grammar of the built-in profile with `syntax` changed by `edit`. */
  function variant(edit: (syntax: Record<string, unknown>) => void): Grammar {
    const copy = structuredClone(profile) as Profile;
    edit(copy.syntax as unknown as Record<string, unknown>);
    return generateGrammar(copy, db) as unknown as Grammar;
  }

  it('paints an indexed assignment word as the keyword it is, not as the speed or the tool of the block', () => {
    expect(at('N10 LIMS[2]=1800')).toEqual(['blockNumber:N10', 'keyword:LIMS[2]', 'operator:=', 'number:1800']);
    expect(at('S[2]=500 M[2]=3')).toEqual(['keyword:S[2]', 'operator:=', 'number:500', 'keyword:M[2]', 'operator:=', 'number:3']);
    expect(at('G1 FA[X]=200')).toEqual(['gcode:G1', 'keyword:FA[X]', 'operator:=', 'number:200']);
    expect(at('T[1]="DRILL_8"')).toEqual(['keyword:T[1]', 'operator:=', 'string:"DRILL_8"']);
    // A comparison and a bracket with no `=` behind it are not assignments.
    expect(at('X[1]==5')).not.toContain('keyword:X[1]');
  });

  it('paints it only where the profile reads one', () => {
    const plain = variant((syntax) => delete syntax.assignmentIndex);
    expect(at('LIMS[2]=1800', plain)).not.toContain('keyword:LIMS[2]');
  });

  it('reads the main block prefix from the profile', () => {
    expect(at(':123 G0 X0')).toEqual(['blockNumber::123', 'gcode:G0', 'axis:X0']);
    expect(at('/1 :124 G1')).toEqual(['skip:/1', 'blockNumber::124', 'gcode:G1']);
    const other = variant((syntax) => ((syntax.blockNumber as Record<string, unknown>).mainPrefix = '+'));
    expect(at('+123 G0', other)).toEqual(['blockNumber:+123', 'gcode:G0']);
  });

  it('keeps painting a colon that a profile without `mainPrefix` has always had', () => {
    const bare = variant((syntax) => delete (syntax.blockNumber as Record<string, unknown>).mainPrefix);
    expect(at(':123 G0', bare)).toEqual(['blockNumber::123', 'gcode:G0']);
  });

  it('reads the exponent letters from the profile', () => {
    expect(at('X1.5EX3 Y2EX-4')).toEqual(['axis:X1.5EX3', 'axis:Y2EX-4']);
    expect(at('R1=2.5EX2')).toEqual(['variable:R1', 'operator:=', 'number:2.5EX2']);
    const letters = variant((syntax) => (syntax.exponentMarker = 'E'));
    expect(at('R1=2.5E2', letters)).toEqual(['variable:R1', 'operator:=', 'number:2.5E2']);
    const none = variant((syntax) => delete syntax.exponentMarker);
    expect(at('R1=2.5EX2', none)).not.toContain('number:2.5EX2');
  });
});

describe('over a whole sinumerik program', () => {
  const lines = PROGRAM.split('\n');

  it('covers every line, marks nothing invalid, and gives the block its colours', () => {
    const seen = new Set<string>();
    for (const line of lines) {
      const tokens = tokenize(line);
      expect(tokens.map((token) => token.text).join(''), line).toBe(line);
      for (const token of tokens) {
        expect(token.role, line).not.toBe('invalid');
        if (token.role !== '') seen.add(token.role);
      }
    }
    for (const role of [
      'programMarker',
      'comment',
      'blockNumber',
      'section',
      'skip',
      'gcode',
      'mcode',
      'axis',
      'arcCenter',
      'feed',
      'spindle',
      'tool',
      'variable',
      'keyword',
      'number',
      'string',
      'operator',
    ]) {
      expect(seen, `the program never came out with a ${role}`).toContain(role);
    }
  });

  it('reads the lines a script and a reader must not misread', () => {
    expect(at(lines[0])).toEqual(['programMarker:%_N_FLANGE_OP20_MPF']);
    expect(at(lines[6])).toEqual([
      'blockNumber:N30',
      'keyword:MSG',
      'operator:(',
      'string:"FACE ; ROUGH"',
      'operator:)',
    ]);
    expect(at(lines[24])).toEqual(['blockNumber:N210', 'section:THREAD_LOOP:', 'gcode:G0', 'axis:X72', 'axis:Z4']);
    expect(at(lines[32])).toEqual([
      'blockNumber:N290',
      'keyword:S3',
      'operator:=',
      'number:1200',
      'mcode:M3',
      'operator:=',
      'number:3',
    ]);
  });
});

describe('over the Sinumerik fixtures', () => {
  // The fixtures belong to WP8.5 and arrive at integration; until then there is nothing
  // to read, and the test says so instead of passing on no lines.
  const dir = 'nc/sinumerik';
  const fixtures = existsSync(join(FIXTURES_DIR, dir)) ? listFixtures(dir) : [];

  it.skipIf(fixtures.length === 0)('reads every line, marks nothing invalid, and agrees on the labels', () => {
    const seen = new Set<string>();
    let lines = 0;
    for (const rel of fixtures) {
      const opened = openFixture(rel);
      if (opened.refused !== null) continue;
      for (const line of opened.text.split('\n')) {
        const tokens = tokenize(line);
        expect(tokens.map((token) => token.text).join(''), `${rel}: ${line}`).toBe(line);
        for (const token of tokens) {
          expect(token.role, `${rel}: ${line}`).not.toBe('invalid');
          if (token.role !== '') seen.add(token.role);
        }
        const label = profileLabel(line);
        const sections = tokens.filter((token) => token.role === 'section' && token.text.endsWith(':')).map((token) => token.text);
        expect(sections, `${rel}: ${line}`).toEqual(label === null ? [] : [label]);
        lines += 1;
      }
    }
    expect(lines).toBeGreaterThan(0);
    for (const role of ['blockNumber', 'gcode', 'mcode', 'axis', 'feed', 'spindle', 'tool', 'comment']) {
      expect(seen, `the fixtures never came out with a ${role}`).toContain(role);
    }
  });
});

describe('the sinumerik rule builder', () => {
  const empty: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };
  const derive = (syntax: Record<string, unknown>): Grammar =>
    generateGrammar({ ...profile, syntax: { ...profile.syntax, ...syntax } } as Profile, db) as unknown as Grammar;

  it('leaves out what a derived profile does not define', () => {
    const bare = {
      ...profile,
      syntax: {
        ...profile.syntax,
        strings: false,
        comments: [],
        blockSkip: undefined,
        keywords: [],
        variables: undefined,
        systemVariables: undefined,
        assignment: undefined,
        labels: undefined,
        calls: false,
        header: undefined,
      },
    } as unknown as Profile;
    expect(() => sinumerikRules(bare, empty)).not.toThrow();
    for (const rule of sinumerikRules(bare, empty)) expect(() => compileRule(rule, true)).not.toThrow();
    const stripped = generateGrammar(bare, empty) as unknown as Grammar;
    expect(at('N10 G1 X10 F0.2', stripped)).toEqual(['blockNumber:N10', 'gcode:G1', 'axis:X10', 'feed:F0.2']);
  });

  it('switches each P8 field off on its own', () => {
    // Without `labels` a name in front of a colon is a name; without `calls` a name in
    // front of a bracket is too; without `strings` a quote is a character like any other.
    expect(at('LOOP_A: G1', derive({ labels: undefined }))).toEqual(['operator::', 'gcode:G1']);
    expect(at('CYCLE81(1)', derive({ calls: false }))).toEqual(['operator:(', 'number:1', 'operator:)']);
    expect(at('MSG("A;B")', derive({ strings: false }))).toEqual(['keyword:MSG', 'operator:(', 'comment:;B")']);
    expect(at('%_N_PART_MPF', derive({ header: undefined }))).not.toContain('programMarker:%_N_PART_MPF');
  });

  it('reads a leading-integer block number at the head of the block only', () => {
    // A derived profile may number its blocks the Klartext way; a number anywhere else is
    // still a value, never a block number.
    const numbered = derive({ blockNumber: { mode: 'leading-integer', mandatory: false } });
    expect(at('10 G1 X10', numbered)).toEqual(['blockNumber:10', 'gcode:G1', 'axis:X10']);
    expect(at('/1 20 G0', numbered)).toEqual(['skip:/1', 'blockNumber:20', 'gcode:G0']);
    expect(at('R1=R2+5', numbered)).toEqual(['variable:R1', 'operator:=', 'variable:R2', 'operator:+', 'number:5']);
  });
});
