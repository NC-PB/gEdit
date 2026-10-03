// The generated grammars (plan §5 WP3.4): every rule compiles the way Monaco builds it,
// the rules are stable, and a line of NC code comes out with the roles it should have.
//
// Monaco is never imported here — the editor pulls in a DOM and half a megabyte of
// contributions, and `core/` is Monaco-free by design (AD-1). `tokenize` below is instead
// a faithful, 30-line copy of the inner loop of
// `monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js`: a rule is
// compiled as `'^(?:' + source + ')'`, a leading `^` makes it line-start-only and is
// stripped, the rest of the line is re-matched from the current position, the first rule
// that matches wins, and a group action needs one capture group per action covering the
// whole match. It also enforces the two invariants Monarch throws on — a rule that makes
// no progress, and groups that do not add up — so a mistake here fails the unit test
// rather than the running editor.

import { describe, expect, it } from 'vitest';
import { generateGrammar } from './index';
import { isoRules } from './iso';
import { klartextRules } from './klartext';
import { orderedKeywords, type GrammarAction, type GrammarRule } from './shared';
import { ROLES } from './roles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { emptyCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import { unionCodeDb, variantDialects } from '$lib/monaco/languages';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import type { CodeDb } from '$lib/core/codes/types';
import type { LineState } from '$lib/core/nc/types';
import type { Profile } from '$lib/core/profiles/types';

interface Built {
  profile: Profile;
  db: CodeDb;
  grammar: { defaultToken: string; ignoreCase: boolean; tokenizer: { root: GrammarRule[] } };
}

/**
 * The built-in profiles, each with its code database and its generated grammar.
 *
 * M6: the database is built the way `monaco/languages.ts` builds it — resolved (AD-17, a
 * child file holds only what differs from its parent) and, where a profile offers a
 * machine parameter that swaps the database, the **union** of the choices (AD-31). A
 * document is painted before anybody picks a machine, so one alphabet has to serve both
 * G-code systems of the lathe; generating from the unresolved child file here would have
 * described a grammar the app never builds.
 */
const RESOLVED = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
const BUILT: Built[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  const profile = checked.profile;
  const db = unionCodeDb(variantDialects(profile).map((dialect) => RESOLVED[dialect] ?? emptyCodeDb(dialect)));
  const grammar = generateGrammar(profile, db) as unknown as Built['grammar'];
  return { profile, db, grammar };
});

const byId = (id: string): Built => {
  const found = BUILT.find((entry) => entry.profile.id === id);
  if (!found) throw new Error(`no built-in profile ${id}`);
  return found;
};

/** One rule, compiled the way `Rule.setRegex` in Monarch compiles it. */
function compileRule([source, action]: GrammarRule, ignoreCase: boolean) {
  const lineStart = source.startsWith('^');
  return {
    source,
    action,
    lineStart,
    re: new RegExp(`^(?:${lineStart ? source.slice(1) : source})`, ignoreCase ? 'i' : ''),
  };
}

interface Emitted {
  text: string;
  role: GrammarAction extends unknown ? string : never;
}

/** Monarch's tokenizer loop, for one line and one `root` state. */
function tokenize(grammar: Built['grammar'], line: string): Emitted[] {
  const rules = grammar.tokenizer.root.map((rule) => compileRule(rule, grammar.ignoreCase));
  const out: Emitted[] = [];
  let pos = 0;

  while (pos < line.length) {
    const rest = line.slice(pos);
    const hit = rules.find((rule) => (rule.lineStart ? pos === 0 : true) && rule.re.test(rest));
    if (!hit) {
      // Monarch advances one character with `defaultToken` when nothing matches.
      out.push({ text: line[pos], role: grammar.defaultToken });
      pos += 1;
      continue;
    }
    const matches = rest.match(hit.re) as RegExpMatchArray;
    expect(matches[0].length, `rule made no progress: ${hit.source}`).toBeGreaterThan(0);

    if (Array.isArray(hit.action)) {
      expect(matches.length, `group count of ${hit.source}`).toBe(hit.action.length + 1);
      const covered = hit.action.reduce((sum, _action, i) => sum + (matches[i + 1] ?? '').length, 0);
      expect(covered, `groups must cover the whole match of ${hit.source}`).toBe(matches[0].length);
      hit.action.forEach((role, i) => {
        const text = matches[i + 1] ?? '';
        if (text !== '') out.push({ text, role });
      });
    } else {
      out.push({ text: matches[0], role: hit.action });
    }
    pos += matches[0].length;
  }
  return out;
}

/** `role:text` for everything the grammar gives a role to; the neutral tokens are dropped. */
function roles(grammar: Built['grammar'], line: string): string[] {
  return tokenize(grammar, line)
    .filter((token) => token.role !== '')
    .map((token) => `${token.role}:${token.text}`);
}

describe('generateGrammar', () => {
  it.each(BUILT.map((entry) => entry.profile.id))('%s: every rule compiles as Monarch compiles it', (id) => {
    const { grammar } = byId(id);
    expect(grammar.tokenizer.root.length).toBeGreaterThan(5);
    for (const rule of grammar.tokenizer.root) {
      expect(() => compileRule(rule, grammar.ignoreCase)).not.toThrow();
      // Monarch reads `^` as the line-start anchor only at position 0; anywhere else it
      // would match at every token boundary, which is never what a generated rule wants.
      expect(rule[0].slice(1), `stray ^ in ${rule[0]}`).not.toMatch(/(?<!\\)\^(?![^[\]]*\])/);
    }
  });

  it.each(BUILT.map((entry) => entry.profile.id))('%s: is stable', (id) => {
    expect(byId(id).grammar).toMatchSnapshot();
  });

  it.each(BUILT.map((entry) => entry.profile.id))('%s: leaves what it does not know uncoloured', (id) => {
    const { grammar } = byId(id);
    expect(grammar.defaultToken).toBe('');
    const emitted = new Set(grammar.tokenizer.root.flatMap((rule) => (Array.isArray(rule[1]) ? rule[1] : [rule[1]])));
    for (const role of emitted) {
      expect(role === '' || (ROLES as readonly string[]).includes(role)).toBe(true);
    }
    // Marking an error is the linter's job (M4), so the grammar never says `invalid`.
    expect(emitted.has('invalid')).toBe(false);
  });

  it.each(BUILT.map((entry) => entry.profile.id))('%s: splits keywords the way the tokenizer does', (id) => {
    const { profile } = byId(id);
    // Same order as `compileProfile`, so the grammar and `core/nc/tokenizer.ts` cannot
    // disagree about where `TOOL CALL` ends and `TOOL` begins.
    expect(orderedKeywords(profile)).toEqual(compileProfile(profile).keywords);
  });

  it('falls back to the word-address shape for an unknown grammar kind', () => {
    const { profile, db } = byId('fanuc-gcode');
    const odd = { ...profile, grammar: 'something-else' } as unknown as Profile;
    expect(generateGrammar(odd, db)).toEqual(generateGrammar(profile, db));
  });

  it('is driven by the profile, not by the dialect', () => {
    const { profile, db } = byId('fanuc-gcode');
    const semicolons = {
      ...profile,
      syntax: { ...profile.syntax, comments: [{ start: ';', end: null }] },
    } as unknown as Profile;
    const grammar = generateGrammar(semicolons, db) as unknown as Built['grammar'];
    expect(roles(grammar, 'G0 X10. ; NOTE')).toEqual(['gcode:G0', 'axis:X10.', 'comment:; NOTE']);
    // `(` is no longer a comment delimiter, so it becomes an ordinary operator.
    expect(roles(grammar, '(A)')).toEqual(['operator:(', 'operator:)']);
  });
});

describe('the iso grammar', () => {
  const { grammar } = byId('fanuc-gcode');
  const at = (line: string) => roles(grammar, line);

  it.each([
    ['%', ['programMarker:%']],
    ['O1001 (BRACKET)', ['programMarker:O1001', 'comment:(BRACKET)']],
    [':1234', ['programMarker::1234']],
    ['N10G0X10.', ['blockNumber:N10', 'gcode:G0', 'axis:X10.']],
    ['N10 T1 M06', ['blockNumber:N10', 'tool:T1', 'mcode:M06']],
    ['G54.1 P1', ['gcode:G54.1', 'number:P1']],
    ['G1 X110. F1500.', ['gcode:G1', 'axis:X110.', 'feed:F1500.']],
    ['F.15', ['feed:F.15']],
    ['S4800 M3', ['spindle:S4800', 'mcode:M3']],
    ['G2 X10. Y10. I5. J0.', ['gcode:G2', 'axis:X10.', 'axis:Y10.', 'arcCenter:I5.', 'arcCenter:J0.']],
    ['G43 Z25. H1 M8', ['gcode:G43', 'axis:Z25.', 'number:H1', 'mcode:M8']],
    ['G0 X-15. Y-10.', ['gcode:G0', 'axis:X-15.', 'axis:Y-10.']],
    ['G1 X10. ,R1.', ['gcode:G1', 'axis:X10.', 'number:,R1.']],
    ['M98 P1000 L2', ['mcode:M98', 'number:P1000', 'number:L2']],
  ])('reads %s', (line, expected) => {
    expect(at(line)).toEqual(expected);
  });

  it('keeps a comment on one line, closed or not', () => {
    expect(at('(A) X10. (B)')).toEqual(['comment:(A)', 'axis:X10.', 'comment:(B)']);
    expect(at('(UNCLOSED HEADER COMMENT')).toEqual(['comment:(UNCLOSED HEADER COMMENT']);
    // A comment ends at the first `)`, and the stray one behind it is no operator: `)`
    // belongs to the comment syntax here, so it is left uncoloured rather than mis-read.
    expect(at('G1 Z-1. (PLUNGE (NESTED?) )')).toEqual(['gcode:G1', 'axis:Z-1.', 'comment:(PLUNGE (NESTED?)']);
  });

  it('takes the block skip before or after the block number', () => {
    expect(at('/M99 P100')).toEqual(['skip:/', 'mcode:M99', 'number:P100']);
    expect(at('/1 G0 X0.')).toEqual(['skip:/1', 'gcode:G0', 'axis:X0.']);
    expect(at('N120/G00 X0.')).toEqual(['blockNumber:N120', 'skip:/', 'gcode:G00', 'axis:X0.']);
    // Away from the head of a block, `/` is the division operator.
    expect(at('#1=#2/2')).toEqual(['variable:#1', 'operator:=', 'variable:#2', 'operator:/', 'number:2']);
  });

  it('puts the macro keywords in front of the single-letter addresses', () => {
    expect(at('GOTO10')).toEqual(['keyword:GOTO', 'number:10']);
    // `EQ` has to win against the `Q` parameter address, or a comparison is painted as a
    // peck depth: a packed dialect allows the space between an address and its value, so
    // the `Q 2` of `EQ 2` reads as a perfectly good parameter word.
    expect(at('IF [#1 EQ 2] GOTO 100')).toEqual([
      'keyword:IF',
      'operator:[',
      'variable:#1',
      'keyword:EQ',
      'number:2',
      'operator:]',
      'keyword:GOTO',
      'number:100',
    ]);
    // The same for the comparison that used to split into a `G` and a tool word.
    expect(at('IF[#101GT10.]GOTO100')).toEqual([
      'keyword:IF',
      'operator:[',
      'variable:#101',
      'keyword:GT',
      'number:10.',
      'operator:]',
      'keyword:GOTO',
      'number:100',
    ]);
    expect(at('#101=SQRT[#102]')).toEqual([
      'variable:#101',
      'operator:=',
      'keyword:SQRT',
      'operator:[',
      'variable:#102',
      'operator:]',
    ]);
  });

  it('keeps the role of an address whose value is a variable or an expression', () => {
    expect(at('X#101')).toEqual(['axis:X', 'variable:#101']);
    expect(at('Z-#102')).toEqual(['axis:Z-', 'variable:#102']);
    expect(at('F[#3*0.5]')).toEqual([
      'feed:F',
      'operator:[',
      'variable:#3',
      'operator:*',
      'number:0.5',
      'operator:]',
    ]);
    expect(at('#[#1+1]=2')).toEqual([
      'variable:#',
      'operator:[',
      'variable:#1',
      'operator:+',
      'number:1',
      'operator:]',
      'operator:=',
      'number:2',
    ]);
  });

  it('allows the whitespace a packed dialect allows inside a word', () => {
    expect(at('G0X 50 Z3.')).toEqual(['gcode:G0', 'axis:X 50', 'axis:Z3.']);
    expect(at('N 120 G0')).toEqual(['blockNumber:N 120', 'gcode:G0']);
  });

  // M9 (WP9.3, R4): the function and print names of the macro (`syntax-fanuc.md` §3.5) are
  // `syntax.keywords`, so `FIX[` is no F, I and X, and `POPEN` is not five addresses.
  it('paints the macro function and print names as keywords', () => {
    expect(at('#1=FIX[#2]')).toEqual(['variable:#1', 'operator:=', 'keyword:FIX', 'operator:[', 'variable:#2', 'operator:]']);
    expect(at('POPEN')).toEqual(['keyword:POPEN']);
    expect(at('DPRNT[X#1[53]]')).toEqual([
      'keyword:DPRNT', 'operator:[', 'axis:X', 'variable:#1', 'operator:[', 'number:53', 'operator:]', 'operator:]',
    ]);
    expect(at('#7=LN[#1]*EXP[#2]')).toContain('keyword:LN');
    // A word that only starts like one stays an address word.
    expect(at('G1 X10. F100.')).toEqual(['gcode:G1', 'axis:X10.', 'feed:F100.']);
  });

  // `syntax.programNames` (§7.16): painted letter by letter, the `T12` of a name looked
  // like a tool call and its `F12` like a feed.
  it('paints a program name as one program marker, at the head and behind a call word', () => {
    expect(at('<SHAFT_T12> (OD PIN)')).toEqual(['programMarker:<SHAFT_T12>', 'comment:(OD PIN)']);
    expect(at('M98 <POCKET_F12> L2')).toEqual(['mcode:M98', 'programMarker:<POCKET_F12>', 'number:L2']);
    expect(at('G65<PROBE-X+1.5>A1.')).toEqual(['gcode:G65', 'programMarker:<PROBE-X+1.5>', 'axis:A1.']);
    expect(roles(byId('fanuc-lathe').grammar, '<PART_T0101>')).toEqual(['programMarker:<PART_T0101>']);
    // A blank is no character of a name, and inside a comment nothing is a name.
    expect(at('(<SUB_T1>)')).toEqual(['comment:(<SUB_T1>)']);
    expect(at('<A B>')).not.toContain('programMarker:<A B>');
  });
});

describe('the klartext grammar', () => {
  const { grammar } = byId('heidenhain-klartext');
  const at = (line: string) => roles(grammar, line);

  it.each([
    ['0 BEGIN PGM PART1 MM', ['blockNumber:0', 'keyword:BEGIN PGM', 'keyword:MM']],
    ['99 END PGM PART1 MM', ['blockNumber:99', 'keyword:END PGM', 'keyword:MM']],
    ['2 BLK FORM 0.1 Z X-50 Y-40', ['blockNumber:2', 'keyword:BLK FORM', 'number:0.1', 'axis:Z', 'axis:X-50', 'axis:Y-40']],
    ['4 * - ROUGH', ['section:4 * - ROUGH']],
    ['5 TOOL CALL 1 Z S3000 F800', ['blockNumber:5', 'keyword:TOOL CALL', 'number:1', 'axis:Z', 'spindle:S3000', 'feed:F800']],
    ['30 TOOL CALL "D10" Z S5000', ['blockNumber:30', 'keyword:TOOL CALL', 'string:"D10"', 'axis:Z', 'spindle:S5000']],
    ['6 L Z+100 R0 FMAX M3', ['blockNumber:6', 'keyword:L', 'axis:Z+100', 'keyword:R0', 'keyword:FMAX', 'mcode:M3']],
    ['9 L X+60 RL F800', ['blockNumber:9', 'keyword:L', 'axis:X+60', 'keyword:RL', 'feed:F800']],
    ['21 CC X+30 Y+30', ['blockNumber:21', 'keyword:CC', 'axis:X+30', 'axis:Y+30']],
    ['22 C X+50 Y+30 DR-', ['blockNumber:22', 'keyword:C', 'axis:X+50', 'axis:Y+30', 'keyword:DR-']],
    ['23 CR R+12 DR+ RL', ['blockNumber:23', 'keyword:CR', 'number:R+12', 'keyword:DR+', 'keyword:RL']],
    ['31 LBL "A"', ['blockNumber:31', 'keyword:LBL', 'string:"A"']],
    ['32 CALL LBL 1 REP 3', ['blockNumber:32', 'keyword:CALL LBL', 'number:1', 'keyword:REP', 'number:3']],
    ['40 L IX+10 IY-5 FMAX', ['blockNumber:40', 'keyword:L', 'axis:IX+10', 'axis:IY-5', 'keyword:FMAX']],
    ['41 L X+Q5 Y+Q6 FQ50', ['blockNumber:41', 'keyword:L', 'axis:X+Q5', 'axis:Y+Q6', 'feed:FQ50']],
    // `MB` is a keyword of the profile since M9 (the retract distance of `M140`); it used to
    // be left uncoloured.
    ['70 M140 MB 50 F500', ['blockNumber:70', 'mcode:M140', 'keyword:MB', 'number:50', 'feed:F500']],
    ['12 /L X+0', ['blockNumber:12', 'skip:/', 'keyword:L', 'axis:X+0']],
    // One of the owner's posts writes the block skip in front of the number (§7.16 / R4,
    // R1): both orders have to read as a `skip` next to a `blockNumber`.
    ['/62 L X+20', ['skip:/', 'blockNumber:62', 'keyword:L', 'axis:X+20']],
    // 2026-09 (review finding NC4): a skipped structure block is still a heading, not words.
    ['/1 * - SCHRUPPEN F500 S3000', ['section:/1 * - SCHRUPPEN F500 S3000']],
    ['70 / * - SCHLICHTEN F800', ['section:70 / * - SCHLICHTEN F800']],
    // The decimal comma the owner's CAM post writes, everywhere a number is read: an axis
    // value, a feed word and a `TOOL CALL` delta (`DR-0,02`).
    ['63 L X+25,781', ['blockNumber:63', 'keyword:L', 'axis:X+25,781']],
    ['64 L F1000,5', ['blockNumber:64', 'keyword:L', 'feed:F1000,5']],
    [
      '65 TOOL CALL 3 Z S3200 DR-0,02',
      ['blockNumber:65', 'keyword:TOOL CALL', 'number:3', 'axis:Z', 'spindle:S3200', 'number:DR-0,02'],
    ],
  ])('reads %s', (line, expected) => {
    expect(at(line)).toEqual(expected);
  });

  it('reads the decimal comma of a Q-parameter assignment and a cycle continuation', () => {
    expect(at('   Q206=636,62 ;PLUNGE FEED')).toEqual(['variable:Q206', 'operator:=', 'number:636,62', 'comment:;PLUNGE FEED']);
    // `X+25,` (5-Axis-1.H): a comma with nothing after it is still the number's separator.
    expect(at('66 L X+25,')).toEqual(['blockNumber:66', 'keyword:L', 'axis:X+25,']);
    // A comma inside a string or a comment is text, never a decimal separator.
    expect(at('67 DECLARE STRING QS2 = "A,B"')).toContain('string:"A,B"');
    expect(at('68 ; NOTE 1,2,3')).toEqual(['blockNumber:68', 'comment:; NOTE 1,2,3']);
  });

  it('leaves the trailing continuation mark out of the comment', () => {
    expect(at('18 CYCL DEF 200 DRILLING ~')).toEqual([
      'blockNumber:18',
      'keyword:CYCL DEF',
      'number:200',
      'operator:~',
    ]);
    expect(at('   Q200=2 ;CLEARANCE ~')).toEqual([
      'variable:Q200',
      'operator:=',
      'number:2',
      'comment:;CLEARANCE',
      'operator:~',
    ]);
    expect(at('   Q201=-15 ;DEPTH')).toEqual(['variable:Q201', 'operator:=', 'number:-15', 'comment:;DEPTH']);
  });

  it('only reads a one-character function name with a separator behind it', () => {
    // `C+45` is the C axis and `L+20` a tool length in `TOOL DEF`, not path functions.
    expect(at('33 L C+45 FMAX')).toEqual(['blockNumber:33', 'keyword:L', 'axis:C+45', 'keyword:FMAX']);
    expect(at('34 TOOL DEF 5 L+20 R+5')).toEqual(['blockNumber:34', 'keyword:TOOL DEF', 'number:5', 'number:R+5']);
  });

  it('keeps a word it has no meaning for in one piece', () => {
    // The tokenizer makes the same promise for a word-separated dialect: a program name or
    // a path is one token, not a coloured letter at a time.
    const tokens = tokenize(grammar, '35 CALL PGM TNC:\\PARTS\\SUB1.H');
    expect(tokens.map((token) => token.text)).toEqual(['35', ' ', 'CALL PGM', ' ', 'TNC:\\PARTS\\SUB1.H']);
    expect(tokens[4].role).toBe('');
  });

  // M9 (WP9.3, R4): the tilted-plane and TCPM words of `syntax-heidenhain.md` §3.2 are
  // keywords of the profile, one token each, `REFPNT TIP-TIP` and `F TCP` included.
  it('paints the PLANE, TCPM and tilting words as keywords', () => {
    expect(at('42 PLANE SPATIAL SPA+0 SPB+30 SPC+0 TURN MB MAX FMAX')).toEqual([
      'blockNumber:42', 'keyword:PLANE SPATIAL', 'keyword:TURN', 'keyword:MB', 'keyword:MAX', 'keyword:FMAX',
    ]);
    expect(at('44 FUNCTION TCPM F TCP AXIS POS PATHCTRL AXIS REFPNT TIP-TIP')).toEqual([
      'blockNumber:44', 'keyword:FUNCTION TCPM', 'keyword:F TCP', 'keyword:AXIS POS', 'keyword:PATHCTRL AXIS',
      'keyword:REFPNT TIP-TIP',
    ]);
    expect(at('85 PLANE EULER EULPR+0 TABLE ROT SEQ+ F2000')).toContain('keyword:SEQ+');
    expect(at('86 PLANE RELATIV SPA+10 STAY')).toEqual(['blockNumber:86', 'keyword:PLANE RELATIV', 'keyword:STAY']);
    // The feed word stays a feed word: only `F` and a name after it is a keyword.
    expect(at('9 L X+60 RL F800')).toEqual(['blockNumber:9', 'keyword:L', 'axis:X+60', 'keyword:RL', 'feed:F800']);
  });

  it('reads the Q parameters of a cycle, and FN as a keyword', () => {
    expect(at('50 FN 0: Q1 = +5')).toEqual([
      'blockNumber:50',
      'keyword:FN',
      'number:0',
      'operator::',
      'variable:Q1',
      'operator:=',
      'number:+5',
    ]);
    expect(at('51 FN 9: IF +Q1 EQU +Q2 GOTO LBL 1')).toContain('variable:+Q1');
  });
});

describe('over the NC fixtures', () => {
  const dialects: [string, string][] = [
    ['fanuc-gcode', 'nc/fanuc'],
    ['heidenhain-klartext', 'nc/heidenhain'],
    // M8: the turning dialects, over the fixtures WP8.3 and WP8.5 wrote for them.
    ['okuma-osp', 'nc/okuma'],
    ['sinumerik', 'nc/sinumerik'],
  ];

  it.each(dialects)('%s: every line tokenizes, with nothing marked invalid', (id, dir) => {
    const { grammar } = byId(id);
    const seen = new Set<string>();
    let lines = 0;

    for (const rel of listFixtures(dir)) {
      const opened = openFixture(rel);
      if (opened.refused !== null) continue;
      for (const line of opened.text.split('\n')) {
        const tokens = tokenize(grammar, line);
        // The tokens cover the line with no gap and no overlap.
        expect(tokens.map((token) => token.text).join(''), `${rel}: ${line}`).toBe(line);
        for (const token of tokens) {
          expect(token.role, `${rel}: ${line}`).not.toBe('invalid');
          if (token.role !== '') seen.add(token.role);
        }
        lines += 1;
      }
    }

    expect(lines).toBeGreaterThan(100);
    // The roles a CAM program is read by have to be there, or the colours say nothing.
    // Klartext has no G codes; its motion is a keyword.
    const wanted = ['blockNumber', 'mcode', 'axis', 'feed', 'spindle', 'comment'];
    for (const role of [...wanted, id === 'heidenhain-klartext' ? 'keyword' : 'gcode']) {
      expect(seen, `${id} never emitted ${role}`).toContain(role);
    }
  });

  it('reads every number of the owner-public Klartext programs, decimal comma included', () => {
    // §7.16 / R4: five of the six published Klartext programs write a decimal comma
    // (`X241,781`, `Q206=636,62`), never a comma for anything else (checked: none of
    // FN, PLANE, a string or a comment in these files use one either). Before the fix,
    // the comma split a number in two — a lone `,` operator token between two number
    // tokens; this proves every comma now reads as part of one number instead, over the
    // owner's own programs rather than a synthetic line. Uses `tokenizeLine` (the real,
    // linear-time tokenizer), not this file's `tokenize()` test harness: the latter
    // recompiles and re-scans every rule per call, which is fine for a handful of
    // synthetic lines but far too slow over six real programs.
    const cp = compileProfile(BUILTIN_PROFILE_JSON.find((raw) => (raw as Profile).id === 'heidenhain-klartext') as Profile);
    let numbersWithComma = 0;
    const loneCommas: string[] = [];
    for (const rel of listFixtures('nc/owner-public/heidenhain-klartext')) {
      const opened = openFixture(rel);
      if (opened.refused !== null) continue;
      let state: LineState | undefined;
      for (const line of opened.text.split('\n')) {
        const { tokens, state: next } = tokenizeLine(line, cp, state);
        state = next;
        for (const token of tokens) {
          if (token.text === ',') loneCommas.push(`${rel}: ${line}`);
          else if (token.text.includes(',')) numbersWithComma += 1;
        }
      }
    }
    expect(loneCommas.slice(0, 5)).toEqual([]);
    expect(numbersWithComma).toBeGreaterThan(100);
  });

  it('gives the Fanuc fixtures a tool role, and the Klartext ones a section', () => {
    const fanuc = byId('fanuc-gcode');
    const klartext = byId('heidenhain-klartext');
    const rolesOf = (built: Built, rel: string): Set<string> => {
      const opened = openFixture(rel);
      if (opened.refused !== null) throw new Error(`${rel} was refused`);
      return new Set(opened.text.split('\n').flatMap((line) => tokenize(built.grammar, line).map((t) => t.role)));
    };
    expect(rolesOf(fanuc, 'nc/fanuc/f01-mill-3tools.nc')).toContain('tool');
    expect(rolesOf(fanuc, 'nc/fanuc/f01-mill-3tools.nc')).toContain('programMarker');
    expect(rolesOf(klartext, 'nc/heidenhain/h01-3tools.h')).toContain('section');
    expect(rolesOf(klartext, 'nc/heidenhain/h01-3tools.h')).toContain('keyword');
  });
});

// G8 M8 review: Monarch tries every rule at every position no earlier rule took, and the
// editor paints every line it shows. A rule that reads to the end of a run before it gives
// up therefore costs the whole run at each of its positions, and two blank runs with only
// an optional mark between them can share one line of blanks in every possible way: a
// padded or packed line of 16k characters took up to two seconds to paint. Each line below
// grows eight times, from 4k to 32k characters. A linear grammar then takes about eight
// times as long and stays far below the budget; a quadratic one takes sixty-four times as
// long, and the smallest of them took over a second.
describe('long lines', () => {
  const SHAPES: [string, (n: number) => string][] = [
    ['leading blanks', (n) => `${' '.repeat(n)}x`],
    ['leading blanks and a skip', (n) => `${' '.repeat(n)}/x`],
    ['leading tabs and a block number', (n) => `${'\t'.repeat(n)}N1x`],
    ['a block number and blanks', (n) => `N1${' '.repeat(n)}x`],
    ['letters', (n) => 'A'.repeat(n)],
    ['letters and blanks', (n) => `${'A'.repeat(n / 2)}${' '.repeat(n / 2)}x`],
    ['an address and blanks', (n) => `X${' '.repeat(n)}x`],
    ['an address, blanks, a sign and blanks', (n) => `X${' '.repeat(n / 2)}+${' '.repeat(n / 2)}x`],
    ['packed words', (n) => 'G1X1'.repeat(n / 4)],
    ['letters and digits', (n) => 'A1'.repeat(n / 2)],
  ];

  /**
   * Monarch's loop without the checks of `tokenize` above, so that the time is the
   * grammar's own: the best of three runs, in milliseconds.
   */
  function cost(grammar: Built['grammar'], line: string): number {
    const rules = grammar.tokenizer.root.map((rule) => compileRule(rule, grammar.ignoreCase));
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      let pos = 0;
      while (pos < line.length) {
        const rest = line.slice(pos);
        let taken = 1;
        for (const rule of rules) {
          if (rule.lineStart && pos !== 0) continue;
          const match = rule.re.exec(rest);
          if (match) {
            taken = Math.max(1, match[0].length);
            break;
          }
        }
        pos += taken;
      }
      best = Math.min(best, performance.now() - started);
    }
    return best;
  }

  it.each(BUILT.map((entry) => entry.profile.id))('%s: paints a long line in time proportional to its length', (id) => {
    const { grammar } = byId(id);
    for (const [name, make] of SHAPES) {
      const short = cost(grammar, make(4000));
      const long = cost(grammar, make(32000));
      // Under 250 ms, or at most three times the growth a linear grammar shows.
      expect(long, `${name}: ${short.toFixed(1)} ms for 4k, ${long.toFixed(1)} ms for 32k`).toBeLessThan(
        Math.max(250, 24 * short),
      );
    }
  });
});

describe('the rule builders', () => {
  it('leave out what the profile does not define', () => {
    const bare = {
      id: 'bare',
      name: 'Bare',
      shortName: 'Bare',
      version: 1,
      grammar: 'iso',
      codes: 'none',
      files: { extensions: [], defaultExtension: 'nc', filterName: 'Bare', encoding: 'keep', lineEnding: 'keep', newFileLineEnding: 'lf' },
      detect: { extensions: {}, content: [] },
      syntax: {
        comments: [],
        blockNumber: { mode: 'prefix', mandatory: false },
        decimalSeparator: '.',
        decimalPointSignificant: true,
        wordSeparatorRequired: false,
      },
      addresses: { axes: [] },
      toolCall: { trigger: 'x', tool: 'x', toolFrom: 'same-line' },
      program: { start: [], end: [] },
      outline: [],
      numbering: { start: 10, step: 10 },
    } as unknown as Profile;
    const empty: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

    expect(() => isoRules(bare, empty)).not.toThrow();
    expect(() => klartextRules(bare, empty)).not.toThrow();
    for (const rules of [isoRules(bare, empty), klartextRules(bare, empty)]) {
      for (const rule of rules) expect(() => compileRule(rule, true)).not.toThrow();
    }
  });
});
