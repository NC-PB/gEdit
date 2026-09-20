// Hover help (plan §5 WP3.6): what one word of a block says when the pointer rests on it.
//
// The tests run over the shipped profiles and databases, because the answer for `G83` is
// the deliverable and not an implementation detail. `t` is the real catalog, so a key
// that does not exist shows up here as the key itself.

import { describe, expect, it } from 'vitest';
import fanucProfileJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainProfileJson from '$lib/data/profiles/heidenhain-klartext.json';
import fanucCodesJson from '$lib/data/codes/fanuc.json';
import heidenhainCodesJson from '$lib/data/codes/heidenhain.json';
import { compileProfile } from '$lib/core/profiles/compile';
import { t } from '$lib/i18n';
import { loadCodeDb } from './load';
import { codeAddressesOf, escapeMarkdown, hoverAt, hoverTarget, hoverText } from './hoverText';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { NcToken } from '$lib/core/nc/types';
import type { CodeDb, CodeLookup } from './types';

const fanucProfile = compileProfile(fanucProfileJson as unknown as Profile);
const klartextProfile = compileProfile(heidenhainProfileJson as unknown as Profile);
const fanuc = loadCodeDb(fanucCodesJson);
const heidenhain = loadCodeDb(heidenhainCodesJson);

/** The hover markdown at the first occurrence of `at` in `line`, or null. */
function hover(cp: CompiledProfile, db: CodeDb, line: string, at: string): string | null {
  const offset = line.indexOf(at);
  expect(offset, `"${at}" is not in "${line}"`).toBeGreaterThanOrEqual(0);
  return hoverAt(line, offset, cp, db, t)?.markdown ?? null;
}

const fanucHover = (line: string, at: string): string | null => hover(fanucProfile, fanuc, line, at);
const klartextHover = (line: string, at: string): string | null => hover(klartextProfile, heidenhain, line, at);

describe('hoverText: codes', () => {
  it('explains G83 with its label, description, group and required words', () => {
    const text = fanucHover('N10 G83 X10. Y20. Z-5. R2. Q1. F100', 'G83');
    expect(text).not.toBeNull();
    const markdown = text as string;
    expect(markdown.startsWith('**G83** — Peck drilling cycle')).toBe(true);
    expect(markdown).toContain('Drills in steps of Q');
    expect(markdown).toContain('_Cycle · modal_');
    expect(markdown).toContain('Required: Z, R, Q, F');
  });

  it('explains M8', () => {
    expect(fanucHover('N20 M8', 'M8')).toBe(
      ['**M8** — Coolant on', 'Turns the flood coolant on\\.', '_Coolant · modal_'].join('\n\n'),
    );
  });

  it('finds a packed code and one with a decimal part', () => {
    expect(fanucHover('G0X10.', 'G0')).toContain('**G0** — Rapid positioning');
    expect(fanucHover('N10 G54.1P2', 'G54.1')).toContain('**G54\\.1** — Extended work offset');
  });

  it('says that the feed of a tapping cycle carries the pitch', () => {
    expect(fanucHover('N10 G84 Z-10. R2. F1.5', 'G84')).toContain('the thread pitch');
  });

  it('describes a Klartext keyword and a code that is also an address letter', () => {
    expect(klartextHover('13 L X+10 R0 FMAX M3', 'L ')).toContain('**L** — Straight line');
    expect(klartextHover('13 L X+10 R0 FMAX M3', 'R0')).toContain('**R0** — No radius compensation');
    expect(klartextHover('13 L X+10 R0 FMAX M3', 'FMAX')).toContain('**FMAX** — Rapid');
  });

  it('joins a Klartext cycle with its number, from either half', () => {
    const line = '14 CYCL DEF 200 DRILLING';
    expect(klartextHover(line, 'CYCL')).toContain('**CYCL DEF 200** — Drilling cycle');
    expect(klartextHover(line, '200')).toContain('**CYCL DEF 200** — Drilling cycle');
    expect(hoverTarget(line, line.indexOf('200'), klartextProfile, heidenhain, undefined)).toMatchObject({
      address: 'CYCL DEF 200',
      start: 3,
      end: 15,
    });
  });

  it('leaves a number that only follows a keyword alone', () => {
    // `LBL 1` is the label `LBL` and the number 1, not a code called "LBL 1", so the
    // number stays a number: it is its own token and it has nothing to say.
    expect(klartextHover('20 LBL 1', 'LBL')).toContain('**LBL** —');
    expect(hoverTarget('20 LBL 1', 7, klartextProfile, heidenhain)?.text).toBe('1');
    expect(hoverAt('20 LBL 1', 7, klartextProfile, heidenhain, t)).toBeNull();
  });
});

describe('hoverText: addresses', () => {
  it('explains an address letter, not the value behind it', () => {
    const text = fanucHover('N10 G1 X10. F100', 'X10.');
    expect(text).toContain('**X** — X axis');
    expect(text).toContain('Target position on the X axis');
  });

  it('explains the block number and the program number', () => {
    expect(fanucHover('N10 G0', 'N10')).toContain('**N** — Block number');
    expect(fanucHover('O1234 (PART)', 'O1234')).toContain('**O** — Program number');
  });

  it('says nothing about a tape marker or a Klartext block number', () => {
    expect(fanucHover('%', '%')).toBeNull();
    expect(klartextHover('13 L X+10', '13')).toBeNull();
  });

  it('marks a Klartext I word as incremental', () => {
    expect(klartextHover('17 L IX+10 RL F200', 'IX+10')).toContain('Incremental');
    expect(klartextHover('13 L X+10 RL F200', 'X+10')).not.toContain('Incremental');
  });
});

describe('hoverText: variables', () => {
  it('shows the kind of a macro variable and no value', () => {
    const text = fanucHover('#100=#101+1', '#100');
    expect(text).toBe(
      ['**\\#100** — Variable', 'Only the control knows the value; the editor does not calculate it\\.'].join('\n\n'),
    );
  });

  it('shows the class of a Q parameter and no value', () => {
    const text = klartextHover('15 Q200=2 ;TEXT', 'Q200');
    expect(text).toContain('**Q200** — Q parameter, global');
    expect(text).toContain('Only the control knows the value');
    expect(text).not.toContain('=2');
  });
});

describe('hoverText: what the database does not describe', () => {
  it('shows an unknown code as unknown, with its address as context', () => {
    const text = fanucHover('N10 G12 X0', 'G12');
    expect(text).toContain('**G12**');
    expect(text).toContain('The code database does not describe this word yet.'.replace('.', '\\.'));
    expect(text).toContain('_G — Preparatory function_');
  });

  it('keeps an entry that is not verified yet out of hover', () => {
    // G87 carries `verify: true`; its label and description must not reach the user.
    const text = fanucHover('N10 G87 Z-10.', 'G87');
    expect(text).toContain('**G87**');
    expect(text).not.toContain('Back boring');
    expect(text).toContain('does not describe this word yet');
    expect(klartextHover('30 PLANE SPATIAL SPA+0 SPB+30 SPC+90', 'PLANE')).toContain('does not describe this word yet');
  });

  // The ones the plan names as M3 deliverables do reach the user: a cycle a post writes
  // on nearly every program is the whole point of the code database.
  it('describes the cycles the plan lists, rather than calling them unknown', () => {
    for (const code of ['G73', 'G74', 'G76', 'G83', 'G84']) {
      expect(fanucHover(`N10 ${code} Z-10.`, code), code).not.toContain('does not describe');
    }
    for (const line of ['16 CYCL DEF 203 DRILLING', '16 CYCL DEF 207 TAPPING', '16 CYCL DEF 240 CENTRING']) {
      expect(klartextHover(line, 'CYCL'), line).not.toContain('does not describe');
    }
  });

  it('says so for a keyword the database has nothing on', () => {
    // Every keyword the built-in profiles tokenize has an entry now (`load.test.ts`
    // keeps it that way), so the branch is exercised on the token directly — a user
    // profile (P2) may well bring a word its database does not describe.
    const token: NcToken = { kind: 'keyword', start: 0, end: 11, text: 'PATTERN DEF', address: 'PATTERN DEF' };
    expect(hoverText(token, null, t)).toContain('**PATTERN DEF**');
    expect(hoverText(token, null, t)).toContain('does not describe this word yet');
  });

  // The words that used to be answered with "not described yet" although they stand on
  // the first line of every program, in every 5-axis block, or in the project's own
  // fixtures. An assistant that shrugs at `MM` reads as broken.
  it('describes the words every program carries', () => {
    const answers: [string, string, string][] = [
      ['klartext', '0 BEGIN PGM TEST MM', 'MM'],
      ['klartext', '41 END PGM TEST INCH', 'INCH'],
      ['klartext', '90 LN X+10.1 Y+5.6 Z-2.3 NX+0.12 NY-0.04 NZ+0.99 F1500', 'LN'],
      ['klartext', '12 STOP', 'STOP'],
      ['klartext', '4 CYCL DEF 32.0 TOLERANZ', 'CYCL'],
      ['klartext', '20 CYCL CALL PAT', 'CYCL CALL PAT'],
      ['klartext', '30 TRANS DATUM AXIS X+10 Y+0 Z+0', 'TRANS'],
      ['klartext', '22 CALL LBL 1 REP 4', 'REP'],
      ['fanuc', 'N10 G50 S2500', 'G50'],
      ['fanuc', 'N20 G93 X0. Y0. A90. F12.5', 'G93'],
      ['fanuc', 'N30 M29 S500', 'M29'],
      ['fanuc', 'N70 IF [#1 EQ 1] GOTO100', 'IF'],
      ['fanuc', 'N70 IF [#1 EQ 1] GOTO100', 'GOTO'],
    ];
    for (const [dialect, line, at] of answers) {
      const text = dialect === 'fanuc' ? fanucHover(line, at) : klartextHover(line, at);
      expect(text, `${line} @ ${at}`).not.toBeNull();
      expect(text as string, `${line} @ ${at}`).not.toContain('does not describe');
    }
  });

  it('stays silent where "unknown" would be noise', () => {
    const line = '0 BEGIN PGM TEST MM';
    expect(klartextHover(line, 'TEST')).toBeNull(); // a program name, not a code
    expect(klartextHover('12 TOOL CALL 5 Z S5000', '5 Z')).toBeNull(); // a bare value
    expect(fanucHover('N10 G0 X10. (SPOT DRILL)', 'SPOT')).toBeNull(); // a comment
    expect(fanucHover('#100=#101+1', '=')).toBeNull(); // an operator
    expect(fanucHover('N10 G0 X10.', ' G0')).toBeNull(); // whitespace
  });

  it('answers null past the end of the line', () => {
    expect(hoverAt('N10 G0', 6, fanucProfile, fanuc, t)).toBeNull();
    expect(hoverAt('', 0, fanucProfile, fanuc, t)).toBeNull();
  });
});

describe('hoverText: the range it covers', () => {
  it('spans the word, and a joined cycle spans both halves', () => {
    expect(hoverAt('N10 G83 X10.', 5, fanucProfile, fanuc, t)).toMatchObject({ start: 4, end: 7 });
    expect(hoverAt('14 CYCL DEF 200 X', 4, klartextProfile, heidenhain, t)).toMatchObject({ start: 3, end: 15 });
  });
});

describe('codeAddressesOf', () => {
  it('answers the letters a dialect writes numbered codes with', () => {
    expect([...codeAddressesOf(fanuc)].sort()).toEqual(['G', 'M']);
    // `R0` is the only R code in Klartext, so `R+5` stays a radius and not an unknown code.
    expect([...codeAddressesOf(heidenhain)].sort()).toEqual(['M']);
    expect(klartextHover('19 CR X+10 R+5 DR-', 'R+5')).toContain('**R** — Radius');
  });

  it('is cached against the database object', () => {
    expect(codeAddressesOf(fanuc)).toBe(codeAddressesOf(fanuc));
  });
});

describe('escapeMarkdown', () => {
  it('escapes everything markdown would read as formatting', () => {
    expect(escapeMarkdown('G54.1 (a) [b] *c* _d_ `e` #f <g> |h| ~i~ +j- {k}')).toBe(
      'G54\\.1 \\(a\\) \\[b\\] \\*c\\* \\_d\\_ \\`e\\` \\#f \\<g\\> \\|h\\| \\~i\\~ \\+j\\- \\{k\\}',
    );
    expect(escapeMarkdown('back\\slash')).toBe('back\\\\slash');
  });

  it('keeps a database label from smuggling a link or an image into the hover', () => {
    const db: CodeDb = {
      dialect: 'evil',
      version: 1,
      addresses: {},
      codes: [{ code: 'G1', label: '![x](http://example.invalid/pixel.png)', description: '[click](command:run)' }],
    };
    const token: NcToken = { kind: 'word', start: 0, end: 2, text: 'G1', address: 'G', valueText: '1' };
    const lookup: CodeLookup = { entry: db.codes[0] };
    const text = hoverText(token, lookup, t) as string;
    expect(text).not.toContain('](');
    expect(text).toContain('\\!\\[x\\]');
  });
});
