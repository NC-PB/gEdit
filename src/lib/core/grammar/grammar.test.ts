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
import { loadCodeDb } from '$lib/core/codes/load';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';

interface Built {
  profile: Profile;
  db: CodeDb;
  grammar: { defaultToken: string; ignoreCase: boolean; tokenizer: { root: GrammarRule[] } };
}

/** The built-in profiles, each with its code database and its generated grammar. */
const BUILT: Built[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  const profile = checked.profile;
  const db = loadCodeDb(BUILTIN_CODE_DB_JSON[profile.codes]);
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
    ['70 M140 MB 50 F500', ['blockNumber:70', 'mcode:M140', 'number:50', 'feed:F500']],
    ['12 /L X+0', ['blockNumber:12', 'skip:/', 'keyword:L', 'axis:X+0']],
  ])('reads %s', (line, expected) => {
    expect(at(line)).toEqual(expected);
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
    for (const role of [...wanted, id === 'fanuc-gcode' ? 'gcode' : 'keyword']) {
      expect(seen, `${id} never emitted ${role}`).toContain(role);
    }
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
