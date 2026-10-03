// The Okuma OSP grammar (plan §5 WP8.2): every rule compiles the way Monaco builds it,
// the rules are stable, and a block of OSP code comes out with the roles
// `docs/planning/syntax/syntax-okuma.md` §3.8 asks for.
//
// Monaco is never imported here, for the reason `grammar.test.ts` gives: `core/` is
// Monaco-free (AD-1). `tokenize` below is the same faithful copy of the inner loop of
// `monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js` — a rule is
// compiled as `'^(?:' + source + ')'`, a leading `^` makes it line-start-only, the first
// rule that matches wins, and a group action needs one capture group per action covering
// the whole match. The two invariants Monarch throws on (a rule that makes no progress,
// groups that do not add up) fail here rather than in the running editor.

import { describe, expect, it } from 'vitest';
import { generateGrammar } from './index';
import { okumaRules } from './okuma';
import { EDITOR_COLORS, ROLES, ROLE_COLORS, type Role } from './roles';
import { orderedKeywords, type GrammarRule } from './shared';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { emptyCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import { languageConfiguration, unionCodeDb, variantDialects } from '$lib/monaco/languages';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';

const PROFILE_ID = 'okuma-osp';

/** The built-in Okuma profile with the database and the grammar the app would build. */
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
    grammar: generateGrammar(checked.profile, codes) as unknown as {
      defaultToken: string;
      ignoreCase: boolean;
      tokenizer: { root: GrammarRule[] };
    },
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

interface Emitted {
  text: string;
  role: string;
}

/** Monarch's tokenizer loop, for one line and one `root` state. */
function tokenize(line: string, built: typeof grammar = grammar): Emitted[] {
  const rules = built.tokenizer.root.map((rule) => compileRule(rule, built.ignoreCase));
  const out: Emitted[] = [];
  let pos = 0;

  while (pos < line.length) {
    const rest = line.slice(pos);
    const hit = rules.find((rule) => (rule.anchored ? pos === 0 : true) && rule.re.test(rest));
    if (!hit) {
      out.push({ text: line[pos], role: built.defaultToken });
      pos += 1;
      continue;
    }
    const matches = rest.match(hit.re) as RegExpMatchArray;
    expect(matches[0].length, `rule made no progress: ${hit.source}`).toBeGreaterThan(0);

    if (Array.isArray(hit.action)) {
      expect(matches.length, `group count of ${hit.source}`).toBe(hit.action.length + 1);
      const covered = hit.action.reduce((sum, _a, i) => sum + (matches[i + 1] ?? '').length, 0);
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

/** `role:text` for everything the grammar gives a role to; neutral tokens are dropped. */
function at(line: string, built: typeof grammar = grammar): string[] {
  return tokenize(line, built)
    .filter((token) => token.role !== '')
    .map((token) => `${token.role}:${token.text}`);
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
const emitted: string[] = [
  ...new Set(grammar.tokenizer.root.flatMap((rule) => (Array.isArray(rule[1]) ? rule[1] : [rule[1]]))),
].filter((role) => role !== '');

describe('the okuma grammar', () => {
  it('every rule compiles as Monarch compiles it', () => {
    expect(grammar.tokenizer.root.length).toBeGreaterThan(20);
    for (const rule of grammar.tokenizer.root) {
      expect(() => compileRule(rule, grammar.ignoreCase)).not.toThrow();
      // Monarch reads `^` as the line-start anchor only at position 0; anywhere else it
      // would match at every token boundary.
      expect(rule[0].slice(1), `stray ^ in ${rule[0]}`).not.toMatch(/(?<!\\)\^(?![^[\]]*\])/);
    }
  });

  it('is stable', () => {
    expect(okumaRules(profile, db)).toMatchSnapshot();
  });

  it('splits keywords the way the tokenizer does', () => {
    expect(orderedKeywords(profile)).toEqual(compileProfile(profile).keywords);
  });

  it('marks no error and invents no role', () => {
    expect(grammar.defaultToken).toBe('');
    for (const role of emitted) expect(ROLES as readonly string[]).toContain(role);
    // Marking an error is the linter's job, so the grammar never says `invalid` — which is
    // why a `T` word of the wrong length is left uncoloured instead (see `okuma.ts`).
    expect(emitted).not.toContain('invalid');
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

describe('the okuma grammar reads a block', () => {
  it.each([
    // The frame of the file: the header of line 1, the tape marker, the program name.
    ['$SHAFT.MIN%', ['programMarker:$SHAFT.MIN%']],
    ['%', ['programMarker:%']],
    ['O0101', ['programMarker:O0101']],
    ['OLAP', ['programMarker:OLAP']],
    // Sequence numbers and sequence names are two different things (§3.1).
    ['N1 (FACE AND OD ROUGH)', ['blockNumber:N1', 'comment:(FACE AND OD ROUGH)']],
    ['N0010 G00 X400 Z300', ['blockNumber:N0010', 'gcode:G00', 'axis:X400', 'axis:Z300']],
    ['NLAP1 G81 X60 Z0', ['section:NLAP1', 'gcode:G81', 'axis:X60', 'axis:Z0']],
    ['NT01 M110', ['section:NT01', 'mcode:M110']],
    // Motion, cycles and the words CAM writes around them.
    ['G50 S2200', ['gcode:G50', 'spindle:S2200']],
    ['G96 S180 M03', ['gcode:G96', 'spindle:S180', 'mcode:M03']],
    ['G95 G01 Z0 F0.3', ['gcode:G95', 'gcode:G01', 'axis:Z0', 'feed:F0.3']],
    ['G01 X-1.6', ['gcode:G01', 'axis:X-1.6']],
    ['G02 X62 Z-45 L6', ['gcode:G02', 'axis:X62', 'axis:Z-45', 'number:L6']],
    ['G03 X70 Z-50 I0 K-5', ['gcode:G03', 'axis:X70', 'axis:Z-50', 'arcCenter:I0', 'arcCenter:K-5']],
    [
      'G71 X54.5 Z-30 D0.3 U0.05 H1.28 F2',
      ['gcode:G71', 'axis:X54.5', 'axis:Z-30', 'number:D0.3', 'number:U0.05', 'number:H1.28', 'feed:F2'],
    ],
    [
      'G181 X0 Z-8 C0 K2 Q4 F0.1',
      ['gcode:G181', 'axis:X0', 'axis:Z-8', 'axis:C0', 'arcCenter:K2', 'number:Q4', 'feed:F0.1'],
    ],
    // A dwell writes its time in `F` (§4.1). The address is still the feed address; what
    // must never be scaled as a feed is a script's business (`CodeEntry.fNotFeed`, WP8.7).
    ['G04 F2.5', ['gcode:G04', 'feed:F2.5']],
    // Packed words, the form §3.7 leaves open.
    ['G0X40Z2', ['gcode:G0', 'axis:X40', 'axis:Z2']],
    ['X-0.5 Z+3', ['axis:X-0.5', 'axis:Z+3']],
    ['F.15', ['feed:F.15']],
  ])('reads %s', (line, expected) => {
    expect(at(line)).toEqual(expected);
  });

  it('gives the T word its two lengths and leaves any other length alone', () => {
    expect(at('T0202')).toEqual(['tool:T0202']);
    expect(at('T010101')).toEqual(['tool:T010101']);
    expect(at('T0100 M08')).toEqual(['tool:T0100', 'mcode:M08']);
    // Five digits is neither `ttoo` nor `rrttoo`. The word keeps its shape and loses the
    // tool colour; the grammar does not claim it is a tool and does not mark it either.
    expect(at('T01010')).toEqual([]);
    expect(tokenize('T01010').map((token) => token.text)).toEqual(['T01010']);
    expect(at('T00')).toEqual([]);
    // The rule agrees with the `toolCall.trigger` of the profile, which is what the
    // program map counts tool changes by.
    const trigger = new RegExp(profile.toolCall.trigger, 'i');
    for (const word of ['T0202', 'T010101', 'T0100']) expect(trigger.test(word)).toBe(true);
    for (const word of ['T01010', 'T00']) expect(trigger.test(word)).toBe(false);
  });

  it('keeps a comment on one line, closed or not', () => {
    expect(at('(A) X10 (B)')).toEqual(['comment:(A)', 'axis:X10', 'comment:(B)']);
    expect(at('N100 G00 X200 (ROUGH)')).toEqual(['blockNumber:N100', 'gcode:G00', 'axis:X200', 'comment:(ROUGH)']);
    expect(at('(UNCLOSED HEADER COMMENT')).toEqual(['comment:(UNCLOSED HEADER COMMENT']);
    // Parentheses never nest (§3.4): the comment ends at the first `)`.
    expect(at('G01 Z-1. (PLUNGE (NESTED?) )')).toEqual(['gcode:G01', 'axis:Z-1.', 'comment:(PLUNGE (NESTED?)']);
  });

  it('takes the block skip at the head of the block and behind the sequence name', () => {
    expect(at('/G00 X400 Z300')).toEqual(['skip:/', 'gcode:G00', 'axis:X400', 'axis:Z300']);
    expect(at('/N100 G00 X400')).toEqual(['skip:/', 'blockNumber:N100', 'gcode:G00', 'axis:X400']);
    expect(at('N100 /G00 X400')).toEqual(['blockNumber:N100', 'skip:/', 'gcode:G00', 'axis:X400']);
    expect(at('NLAP1 /G00')).toEqual(['section:NLAP1', 'skip:/', 'gcode:G00']);
    // The manual shows no skip levels for this control, so `/2` is the mark and a number.
    expect(at('/2 G00')).toEqual(['skip:/', 'number:2', 'gcode:G00']);
    // Away from those two places `/` is the division operator of §3.5.
    expect(at('V1=V2/2')).toEqual(['variable:V1', 'operator:=', 'variable:V2', 'operator:/', 'number:2']);
  });

  it('puts the control statements in front of every single-letter address', () => {
    expect(at('RTS')).toEqual(['keyword:RTS']);
    expect(at('MODOUT')).toEqual(['keyword:MODOUT']);
    expect(at('GOTO N200')).toEqual(['keyword:GOTO', 'blockNumber:N200']);
    // `NE` is the comparison, not a sequence named `E`; `EQ` is not a `Q` word.
    expect(at('IF [V1 EQ 5] GOTO N200')).toEqual([
      'keyword:IF',
      'operator:[',
      'variable:V1',
      'keyword:EQ',
      'number:5',
      'operator:]',
      'keyword:GOTO',
      'blockNumber:N200',
    ]);
    expect(at('IF [V1 NE 0] N300')).toEqual([
      'keyword:IF',
      'operator:[',
      'variable:V1',
      'keyword:NE',
      'number:0',
      'operator:]',
      'blockNumber:N300',
    ]);
    // A LAP call refers to the shape by its sequence name (§6.4).
    expect(at('G85 NLAP1 D0.3 F0.2 U0.1 W0.1')).toEqual([
      'gcode:G85',
      'section:NLAP1',
      'number:D0.3',
      'feed:F0.2',
      'number:U0.1',
      'number:W0.1',
    ]);
  });

  it('names the subprogram a CALL block calls', () => {
    expect(at('CALL O1234 Q2')).toEqual(['keyword:CALL', 'programMarker:O1234', 'number:Q2']);
    expect(at('MODIN O2000')).toEqual(['keyword:MODIN', 'programMarker:O2000']);
    // The variables a call passes on are variables, not addresses (§7.1).
    expect(at('CALL O1234 DIA1=50 ZL1=-20')).toEqual([
      'keyword:CALL',
      'programMarker:O1234',
      'variable:DIA1',
      'operator:=',
      'number:50',
      'variable:ZL1',
      'operator:=',
      'operator:-',
      'number:20',
    ]);
  });

  it('tells the three kinds of variable apart from an address', () => {
    // A system variable is not the common variable `V` with a value (§3.6).
    expect(at('VZOFZ=10.')).toEqual(['variable:VZOFZ', 'operator:=', 'number:10.']);
    expect(at('VTOFX[5]')).toEqual(['variable:VTOFX', 'operator:[', 'number:5', 'operator:]']);
    expect(at('V5 = V5 + 1')).toEqual([
      'variable:V5',
      'operator:=',
      'variable:V5',
      'operator:+',
      'number:1',
    ]);
    expect(at('V1=SQRT[V2*V2]')).toEqual([
      'variable:V1',
      'operator:=',
      'keyword:SQRT',
      'operator:[',
      'variable:V2',
      'operator:*',
      'variable:V2',
      'operator:]',
    ]);
    expect(at('X=V1+V2')).toEqual(['axis:X', 'operator:=', 'variable:V1', 'operator:+', 'variable:V2']);
    expect(at('X=100+XP2')).toEqual(['axis:X', 'operator:=', 'number:100', 'operator:+', 'variable:XP2']);
  });

  it('reads an extended address as structure and the letter of a word as its address', () => {
    // `SB=` is the driven-tool spindle, not the main spindle: it keeps the structural
    // colour of an extended address rather than the spindle colour of `S`.
    expect(at('SB=1200 M13')).toEqual(['keyword:SB', 'operator:=', 'number:1200', 'mcode:M13']);
    expect(at('SA=200')).toEqual(['keyword:SA', 'operator:=', 'number:200']);
    expect(at('DA=1.5')).toEqual(['keyword:DA', 'operator:=', 'number:1.5']);
    expect(at('QA=5')).toEqual(['keyword:QA', 'operator:=', 'number:5']);
    expect(at('S180')).toEqual(['spindle:S180']);
    expect(at('T=V1')).toEqual(['tool:T', 'operator:=', 'variable:V1']);
    expect(at('F=V2')).toEqual(['feed:F', 'operator:=', 'variable:V2']);
  });

  it('never reads a parenthesis as an expression bracket', () => {
    // The one difference from the Siemens shape (§3.5): `( … )` always starts a comment.
    const configured = profile.syntax.comments.map((marker) => [marker.start, marker.end]);
    expect(configured).toEqual([['(', ')']]);
    expect(at('SIN[30]')).toEqual(['keyword:SIN', 'operator:[', 'number:30', 'operator:]']);
    expect(at('MOD[17,5]')).toEqual([
      'keyword:MOD',
      'operator:[',
      'number:17',
      'operator:,',
      'number:5',
      'operator:]',
    ]);
    // A function written with round brackets is not a function here at all: the argument
    // list is a comment, and the name in front of it reads as a local variable.
    expect(at('X=SIN(30)')).toEqual(['axis:X', 'operator:=', 'variable:SIN', 'comment:(30)']);
  });

  it('does not cut a code out of a number the dialect has no room for', () => {
    // `G` runs to 999 and `M` to 511 (§3.3). A longer run of digits is not a code, and
    // painting `G180` out of `G1800` would name a cycle the block never calls.
    expect(at('G180')).toEqual(['gcode:G180']);
    expect(at('G1800')).toEqual(['number:1800']);
    expect(at('M110')).toEqual(['mcode:M110']);
  });

  it('configures the language the way the dialect writes a comment', () => {
    const config = languageConfiguration(profile);
    expect(config.comments).toEqual({ blockComment: ['(', ')'] });
    // `( … )` is spent on comments, so `[ … ]` is the only bracket pair left (§3.5) —
    // and a typed `(` still closes itself, because an unclosed comment is a nuisance.
    expect(config.brackets).toEqual([['[', ']']]);
    expect(config.autoClosingPairs).toContainEqual({ open: '[', close: ']' });
    expect(config.autoClosingPairs).toContainEqual({ open: '(', close: ')' });
    // The dialect has no strings, so a quote is an ordinary character.
    expect(config.autoClosingPairs).not.toContainEqual({ open: '"', close: '"' });
  });

  it('builds the assignment rules from the pattern the profile declares', () => {
    // The lookahead the address rules of §3.2 end with is taken from `syntax.assignment`,
    // so a change there cannot leave the grammar reading `=` a different way than the
    // tokenizer does.
    const assignment = profile.syntax.assignment ?? '';
    expect(assignment).toMatch(/\(\?=/);
    const tail = assignment.slice(assignment.indexOf('(?='));
    const sources = okumaRules(profile, db).map(([source]) => source);
    expect(sources).toContain(`[XZCY]${tail}`);
    expect(sources.some((source) => source.endsWith(tail) && source.includes('[ADFIKLRSTUWXZ][AB]'))).toBe(true);
  });
});

/**
 * One synthetic program, written for gEdit from `syntax-okuma.md` §2.1, §6 and §7, with
 * every structural element the grammar has a rule for in it. The fixtures the milestone
 * ships belong to WP8.3; this one is here so the acceptance — **no line marked invalid,
 * every line covered, the roles a CAM program is read by all present** — is checked
 * against a whole program rather than against single lines.
 */
const PROGRAM = `$FLANGE-OP1.MIN%
O1001
(FLANGE OP1 - SYNTHETIC)
N1 (FACE AND OD ROUGH)
G50 S2500
G00 X600 Z400
T010101
G96 S180 M03 M42
G00 X72 Z3 M08
G95 G01 Z0.2 F0.25
X-1.6
G00 Z3
G01 X64 Z-2 F0.2
G03 X68 Z-4 I0 K-2
/G00 X600 Z400 M09
N2 (CENTER DRILL)
G97 S1500 M03
T000202
G00 X0 Z5 M08
G74 X0 Z-12 D3 E0.2 F0.12
N3 (LIVE DRILL)
M110
SB=1200 M13
G181 X0 Z-8 C0 K2 Q4 F0.1
G180
M12
M109
NLAP1 G81 X60 Z0
G01 X64 Z-2
G80
G85 NLAP1 D0.3 F0.2 U0.1 W0.1
V1=V1+1
IF [V1 LT 3] GOTO N1
VZOFZ=10.
CALL O2000 DIA1=64
G00 X600 Z400 M09
M05
M02
%`;

// M9 (WP9.3, R4): the control's own multi-letter addresses are the profile's data
// (`syntax.extendedAddresses`), and an option M function has four digits.
describe('the okuma grammar reads the profile\'s extended addresses and four-digit M codes', () => {
  /** The grammar of the built-in profile with `syntax` changed by `edit`. */
  function variant(edit: (syntax: Record<string, unknown>) => void): typeof grammar {
    const copy = structuredClone(profile) as Profile;
    edit(copy.syntax as unknown as Record<string, unknown>);
    return generateGrammar(copy, db) as unknown as typeof grammar;
  }

  it('paints the option addresses of the data as addresses, whatever their length', () => {
    expect(at('TL=2 CL=1 CP=3')).toEqual([
      'keyword:TL', 'operator:=', 'number:2', 'keyword:CL', 'operator:=', 'number:1', 'keyword:CP', 'operator:=', 'number:3',
    ]);
    expect(at('AB=45 BC=10 SX=1 QA=5')).toEqual([
      'keyword:AB', 'operator:=', 'number:45', 'keyword:BC', 'operator:=', 'number:10',
      'keyword:SX', 'operator:=', 'number:1', 'keyword:QA', 'operator:=', 'number:5',
    ]);
  });

  it('leaves every other name in front of `=` a local variable', () => {
    expect(at('N30 DIA1=50 ZL1=-20 QR=5')).toEqual([
      'blockNumber:N30', 'variable:DIA1', 'operator:=', 'number:50', 'variable:ZL1', 'operator:=', 'operator:-',
      'number:20', 'variable:QR', 'operator:=', 'number:5',
    ]);
  });

  it('reads the list from the profile: without it nothing is an option address, with a longer one more is', () => {
    const none = variant((syntax) => delete syntax.extendedAddresses);
    expect(at('SB=1200 TL=2', none)).toEqual(['variable:SB', 'operator:=', 'number:1200', 'variable:TL', 'operator:=', 'number:2']);
    const own = variant((syntax) => (syntax.extendedAddresses = `${profile.syntax.extendedAddresses}|ZZ`));
    expect(at('ZZ=3', own)).toEqual(['keyword:ZZ', 'operator:=', 'number:3']);
    expect(at('ZZ=3', grammar)).toEqual(['variable:ZZ', 'operator:=', 'number:3']);
  });

  it('takes an option M function of four digits whole, and a G code of three', () => {
    expect(at('M1292')).toEqual(['mcode:M1292']);
    expect(at('G1 X10 M1292 S800')).toEqual(['gcode:G1', 'axis:X10', 'mcode:M1292', 'spindle:S800']);
    expect(at('M110 M13')).toEqual(['mcode:M110', 'mcode:M13']);
    // Five digits are no code, and a G stays at three.
    expect(at('M12345')).not.toContain('mcode:M1234');
    expect(at('G1800')).not.toContain('gcode:G180');
  });
});

describe('over a whole okuma program', () => {
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
      'operator',
    ]) {
      expect(seen, `the program never came out with a ${role}`).toContain(role);
    }
  });

  it('never runs a comment or a header past its line', () => {
    // The grammar is stateless, one line at a time, so an unclosed `(` must end at the
    // end of its own line and the header must not claim line 2.
    expect(at(lines[0])).toEqual(['programMarker:$FLANGE-OP1.MIN%']);
    expect(at(lines[1])).toEqual(['programMarker:O1001']);
    const unclosed = tokenize('(UNCLOSED');
    expect(unclosed).toHaveLength(1);
    expect(unclosed[0].role).toBe('comment');
  });
});

describe('the okuma rule builder', () => {
  it('leaves out what the profile does not define', () => {
    const bare = {
      id: 'bare-okuma',
      name: 'Bare',
      shortName: 'Bare',
      version: 1,
      grammar: 'okuma',
      codes: 'none',
      files: {
        extensions: [],
        defaultExtension: 'min',
        filterName: 'Bare',
        encoding: 'keep',
        lineEnding: 'keep',
        newFileLineEnding: 'crlf',
      },
      detect: { extensions: {}, content: [] },
      syntax: {
        comments: [],
        blockNumber: { mode: 'prefix', mandatory: false },
        decimalSeparator: '.',
        decimalPointSignificant: false,
        wordSeparatorRequired: false,
      },
      addresses: { axes: [] },
      toolCall: { trigger: 'x', tool: 'x', toolFrom: 'same-line' },
      program: { start: [], end: [] },
      outline: [],
      numbering: { start: 10, step: 10 },
    } as unknown as Profile;
    const empty: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

    expect(() => okumaRules(bare, empty)).not.toThrow();
    for (const rule of okumaRules(bare, empty)) expect(() => compileRule(rule, true)).not.toThrow();
  });
});
