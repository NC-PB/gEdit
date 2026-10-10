// Hover help (plan §5 WP3.6): what one word of a block says when the pointer rests on it.
//
// The tests run over the shipped profiles and databases, because the answer for `G83` is
// the deliverable and not an implementation detail. `t` is the real catalog, so a key
// that does not exist shows up here as the key itself.

import { describe, expect, it } from 'vitest';
import fanucProfileJson from '$lib/data/profiles/fanuc-gcode.json';
import fanucLatheProfileJson from '$lib/data/profiles/fanuc-lathe.json';
import heidenhainProfileJson from '$lib/data/profiles/heidenhain-klartext.json';
import okumaProfileJson from '$lib/data/profiles/okuma-osp.json';
import sinumerikProfileJson from '$lib/data/profiles/sinumerik.json';
import fanucCodesJson from '$lib/data/codes/fanuc.json';
import heidenhainCodesJson from '$lib/data/codes/heidenhain.json';
import okumaCodesJson from '$lib/data/codes/okuma.json';
import sinumerikCodesJson from '$lib/data/codes/sinumerik.json';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import { ModalIndex } from '$lib/core/nc/modal';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { t } from '$lib/i18n';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { profileOf } from '../../../../tests/unit/helpers/profiles';
import { loadCodeDb } from './load';
import { lookupCode } from './lookup';
import { resolveCodeDbFiles } from './resolve';
import { blockRange } from './inspect';
import { codeAddressesOf, escapeMarkdown, hoverAt, hoverTarget, hoverText, type HoverContext, type WaitCodeLookup } from './hoverText';
import type { EffectiveMachine, MachineConfig, MachineParams, NumberInput } from '$lib/core/machines/types';
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

const okumaProfile = compileProfile(okumaProfileJson as unknown as Profile);
const sinumerikProfile = compileProfile(sinumerikProfileJson as unknown as Profile);
const okuma = loadCodeDb(okumaCodesJson);
const sinumerik = loadCodeDb(sinumerikCodesJson);
const okumaHover = (line: string, at: string): string | null => hover(okumaProfile, okuma, line, at);
const siemensHover = (line: string, at: string): string | null => hover(sinumerikProfile, sinumerik, line, at);

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

  it('describes the sub-block of an older cycle by its cycle, and leaves one without an entry alone', () => {
    // Real programs write `CYCL DEF 19.0` / `19.1` and `7.0` / `7.1`; the database has the whole number.
    const line = '12 CYCL DEF 19.1 A+0 B+45';
    expect(klartextHover(line, 'CYCL')).toContain('**CYCL DEF 19**');
    expect(klartextHover(line, '19.1')).toContain('**CYCL DEF 19**');
    expect(hoverTarget(line, line.indexOf('19.1'), klartextProfile, heidenhain, undefined)).toMatchObject({
      address: 'CYCL DEF 19',
      start: 3,
      end: 16,
    });
    expect(klartextHover('11 CYCL DEF 7.0 DATUM SHIFT', '7.0')).toContain('**CYCL DEF 7**');
    expect(klartextHover('4 CYCL DEF 32.1 T0.05', '32.1')).toContain('**CYCL DEF 32**');
    // No entry for the cycle: not joined, the number stays a number with nothing to say.
    expect(klartextHover('4 CYCL DEF 999.1 Q1', '999.1')).toBeNull();
    // `BLK FORM 0.1` keeps its own keyword; `LBL 1.5` is no code.
    expect(klartextHover('1 BLK FORM 0.1 Z X+0 Y+0 Z-40', 'BLK')).toContain('**BLK FORM**');
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
    // Okuma G36 carries `verify: true`; its label and description must not reach the user.
    // (Fanuc G87 and Klartext PLANE SPATIAL were the examples until the source review of
    // 2026-09 confirmed them.)
    const text = okumaHover('G36 Z-10 F1.5', 'G36');
    expect(text).toContain('**G36**');
    expect(text).not.toContain('driven tool');
    expect(text).toContain('does not describe this word yet');
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
      // `G50` is not in this list any more: M6/WP6.2 marked the **mill** entry
      // `verify: true`, because the syntax notes do not say what a mill does with that
      // number (§8.3), and a `verify` entry deliberately stays out of hover. On the lathe
      // profile, where the notes are clear, it is described.
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

// M8 integration: the tokens the turning dialects add (§7.5). A hover that explained
// `M3=3` as a code `M33`, or the letters of `XBOT` as an X axis and a tool, would be a
// wrong meaning, which is worse than none.
describe('hoverText: the turning dialects', () => {
  it('reads a spindle-addressed M word as the M code, for the spindle its address names', () => {
    const text = siemensHover('N170 S3=2400 M3=3', 'M3=3') as string;
    expect(text.startsWith('**M3=3** — Spindle on, clockwise')).toBe(true);
    expect(text).toContain('M3=3 does the same for spindle 3');
    expect(siemensHover('N300 M2=5', 'M2=5')).toContain('**M2=5** — Spindle stop');
    // `M1=3` is spindle 1 clockwise, not the optional stop M1.
    expect(siemensHover('N200 M1=3', 'M1=3')).toContain('Spindle on, clockwise');
  });

  it('reads an indexed assignment as the word of the spindle or axis its index names (M9 review F1)', () => {
    // `M[2]=3` read as `M3` of the master spindle, and `FA[X]=100` as a word `FA100`.
    const m = siemensHover('N70 M[2]=3', 'M[2]=3') as string;
    expect(m.startsWith('**M\\[2\\]=3** — Spindle on, clockwise')).toBe(true);
    const fa = siemensHover('N80 FA[X]=100', 'FA[X]=100') as string;
    expect(fa).not.toContain('FA100');
    expect(fa).toContain('FA\\[X\\]=100');
    expect(siemensHover('N60 S[2]=500', 'S[2]=500')).toContain('**S** — Spindle speed');
  });

  it('reads a spindle-addressed S or T word as its address, never as a code spelled together', () => {
    expect(siemensHover('N170 S3=2400 M3=3', 'S3=2400')).toContain('**S** — Spindle speed');
    expect(siemensHover('N190 T1=5 D1', 'T1=5')).toContain('**T** — Tool');
    expect(siemensHover('N40 T="ROUGH" D1', 'T=')).toContain('**T** — Tool');
    expect(siemensHover('N50 G96 S200 LIMS=3000 M4', 'LIMS')).toContain('**LIMS** — Spindle speed limit');
    expect(okumaHover('N40 SB=1200 M13', 'SB=')).toContain('**SB** — Driven\\-tool speed');
  });

  it('explains a call the database describes by its name', () => {
    expect(siemensHover('N30 MSG("OD ROUGH")', 'MSG')).toContain('**MSG** — Operator message');
    expect(siemensHover('N290 SETMS(3)', 'SETMS')).toContain('**SETMS** — Choose the master spindle');
    // The manual confirms CYCLE83, so its hover says what it does. B1 (a7s): CYCLE97, which the
    // 4.92 cycle list leaves out, is described from the 2008 cycles manual and hovers too.
    const cycle = siemensHover('N80 CYCLE83(5,0,2,-30,,-8,,2,0,0.5,1,0)', 'CYCLE83') as string;
    expect(cycle).toContain('**CYCLE83** — Deep\\-hole drilling cycle');
    const old = siemensHover('N90 CYCLE97(1.5,,0,-20,40,40,3,2,0.92,0.1,0,0,5,1,3,1)', 'CYCLE97') as string;
    expect(old).toContain('**CYCLE97** — Thread cutting cycle');
    expect(old).not.toContain('does not describe this word yet');
    expect(hoverAt('N80 CYCLE83(5,0,2,-30)', 10, sinumerikProfile, sinumerik, t)).toMatchObject({ start: 4, end: 22 });
  });

  it('stays silent on a subprogram, a name and a label the program gives itself', () => {
    expect(siemensHover('N200 PROBE_DIA(1,,3)', 'PROBE_DIA')).toBeNull();
    const line = 'N70 IF XNOW<=XBOT GOTOF LAST_CUT';
    expect(siemensHover(line, 'XNOW')).toBeNull();
    expect(siemensHover(line, 'XBOT')).toBeNull();
    expect(siemensHover(line, 'LAST_CUT')).toBeNull();
    expect(siemensHover('GOTOF PASS2', 'PASS2')).toBeNull();
    expect(okumaHover('V1=DIA1*2', 'DIA1')).toBeNull();
    expect(okumaHover('NLAP1 G81 X50', 'NLAP1')).toBeNull();
  });
});

describe('hoverText: a local variable among the assignment words (`syntax.extendedAddresses`)', () => {
  it('calls a name the control does not list a variable, and says only the control knows its value', () => {
    for (const [line, name] of [
      ['N30 DIA1=50 ZL1=-20', 'DIA1'],
      ['N30 DIA1=50 ZL1=-20', 'ZL1'],
      ['N40 QR=5', 'QR'],
    ] as const) {
      const text = okumaHover(line, name) as string;
      expect(text, `${name} in ${line}`).toContain(`**${name}** — Variable`);
      expect(text).toContain('Only the control knows the value');
      expect(text).not.toContain('does not describe');
    }
  });

  it('keeps an address of the control an address, and an option address the database lacks undescribed', () => {
    expect(okumaHover('N40 SB=1200 M13', 'SB=')).toContain('**SB** — Driven\\-tool speed');
    // `TL` is one of the control's own addresses (the profile lists it) that the database has
    // no entry for yet: that is "not described", never a variable.
    const text = okumaHover('N50 TL=2', 'TL') as string;
    expect(text).toContain('does not describe this word yet');
    expect(text).not.toContain('Variable');
  });

  it('describes the same words as before on a profile that lists no addresses', () => {
    const copy = structuredClone(okumaProfileJson) as unknown as Profile & { syntax: Record<string, unknown> };
    delete copy.syntax.extendedAddresses;
    const bare = compileProfile(copy);
    expect(hover(bare, okuma, 'N40 QR=5', 'QR')).toContain('does not describe this word yet');
    expect(hover(bare, okuma, 'N30 DIA1=50', 'DIA1')).toBeNull();
  });

  it('is silent on a name in an expression, which is not an assignment word', () => {
    expect(okumaHover('V1=DIA1*2', 'DIA1')).toBeNull();
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

describe('hoverText: a machine’s wait codes win over the database (M12.5 decision 4, §7.16 #178)', () => {
  const fanucLatheProfile = compileProfile(fanucLatheProfileJson as unknown as Profile);
  // What `ChannelService.waitCodeRule` answers for a machine whose waits are `M190-M199`.
  const asked: [string, number][] = [];
  const waitCode = (letter: string, value: number) => {
    asked.push([letter, value]);
    return letter === 'M' && value >= 190 && value <= 199 ? { ruleId: 'wait', label: 'Waiting M-code <of this builder>', machineName: 'Twin_Turret' } : null;
  };
  const latheHover = (line: string, at: string, o: { waitCode?: typeof waitCode } = { waitCode }): string | null =>
    hoverAt(line, line.indexOf(at), fanucLatheProfile, fanuc, t, undefined, o)?.markdown ?? null;

  it('presents M198 as a wait on this machine, without the database’s meaning or its required P', () => {
    const text = latheHover('M198', 'M198') as string;
    expect(text).toBe(
      [
        '**M198**',
        escapeMarkdown('Wait code on this machine (Twin_Turret): Waiting M-code <of this builder>'),
        `_${escapeMarkdown(t('assistant.hover.waitCodeNote'))}_`,
      ].join('\n\n'),
    );
    expect(text).not.toContain('Required');
    expect(text).not.toContain('External subprogram call');
  });

  it('reads the word as the control does: M0198 is M198; a point or an assignment is another word', () => {
    expect(latheHover('N10 M0198', 'M0198')).toContain('Wait code on this machine');
    asked.length = 0;
    latheHover('M198.', 'M198');
    // Sinumerik `M2=198`: the M198 of spindle 2 is no code word of the list (as `waitCodeWordRe` reads it).
    hoverAt('M2=198', 0, sinumerikProfile, sinumerik, t, undefined, { waitCode });
    expect(asked).toEqual([]);
  });

  it('says only that it is a wait when the database has no entry, and uses the plain line without a rule label', () => {
    expect(latheHover('M195', 'M195')).toBe(['**M195**', escapeMarkdown('Wait code on this machine (Twin_Turret): Waiting M-code <of this builder>')].join('\n\n'));
    const unlabelled = hoverAt('M198', 0, fanucLatheProfile, fanuc, t, undefined, { waitCode: () => ({ ruleId: 'wait', label: null, machineName: 'Twin' }) })?.markdown;
    expect(unlabelled).toContain(escapeMarkdown('Wait code on this machine (Twin)'));
    expect(unlabelled).not.toContain(':');
  });

  it('calls an ordered rule a sync code, not a wait code (an order number such as P1-P9999)', () => {
    const ordered = { ruleId: 'p-code', label: 'P sync code: an order', machineName: 'Twin_Turret', semantics: 'ordered' };
    const text = hoverAt('G04 P500', 'G04 P500'.indexOf('P500'), fanucLatheProfile, fanuc, t, undefined, { waitCode: () => ordered })?.markdown ?? '';
    expect(text).toContain(escapeMarkdown('Sync code on this machine (Twin_Turret): P sync code: an order'));
    expect(text).not.toContain('Wait code');
    const bare = hoverAt('M100', 0, fanucLatheProfile, fanuc, t, undefined, { waitCode: () => ({ ...ordered, label: null }) })?.markdown ?? '';
    expect(bare).toContain(escapeMarkdown('Sync code on this machine (Twin_Turret)'));
    // A count or rendezvous rule keeps the wait wording.
    expect(latheHover('M198', 'M198')).toContain('Wait code on this machine');
  });

  it('leaves every other word to the database, and the database speaks without a machine', () => {
    expect(latheHover('M30', 'M30')).toContain('Program end and rewind');
    expect(latheHover('G0 X100.', 'X100.')).not.toContain('Wait code');
    const withoutMachine = latheHover('M198 P1234', 'M198', {}) as string;
    expect(withoutMachine).toContain('External subprogram call');
    expect(withoutMachine).toContain('Required: P');
  });
});

describe('hoverText: text the control does not execute (M12.5, §7.16 #179)', () => {
  it('says nothing about a `text` token, even where the database describes a word of that spelling', () => {
    const token: NcToken = { kind: 'text', start: 0, end: 4, text: 'M198' };
    expect(hoverText(token, { entry: lookupCode(fanuc, 'M198') } as unknown as CodeLookup, t, { waitCode: () => ({ ruleId: 'w', label: 'W', machineName: 'M' }) })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P3.3: the hover in context (Phase 3 plan §6.5, X14)
//
// Every document here is read by the real modal index (P3.1) with the effective profile, code
// database and machine made the way the app makes them (`effectiveMachine`, `applyMachine`),
// and the context is built the way `monaco/providers/hover.ts` builds it. The programs are
// the synthetic fixtures of `tests/fixtures/nc/` and short programs written here.
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = (path: string): string => readFileSync(join(ROOT, 'tests/fixtures/nc', path), 'utf8').replace(/\r\n?/g, '\n');

const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

interface Doc {
  profile: Profile;
  cp: CompiledProfile;
  db: CodeDb;
  machine: EffectiveMachine;
  lines: string[];
  index: ModalIndex;
}

interface MachineSpec {
  name?: string;
  params?: Partial<MachineParams>;
  /** Detected variants, as variant detection answers them, for a document with no machine. */
  detected?: Record<string, { value: string; margin: number }>;
  /** A code database to read instead of the built-in one (a user's file merged over it). */
  db?: CodeDb;
}

/** A preset's number input, as a machine stores it. */
function preset(profileId: string, id: string): NumberInput {
  const found = profileOf(profileId).machineParams?.numberInput?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profileId}: no preset ${id}`);
  return found.value;
}

/** `text` on profile `profileId`, read with `machine` (`null` or no `params`: none chosen), the index built. */
function openDoc(profileId: string, text: string, machine: MachineSpec | null = null): Doc {
  const base = profileOf(profileId);
  const config: MachineConfig | null =
    machine?.params !== undefined ? { id: 'm', name: machine.name ?? 'Machine', profile: profileId, params: machine.params } : null;
  const eff = effectiveMachine(base, config, config ? 'document' : 'none', machine?.detected ?? {});
  const applied = applyMachine(base, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const cp = compileProfile(checked.profile);
  const db = machine?.db ?? loadCodeDb(DBS[applied.codes]);
  const lines = text.split('\n');
  const index = new ModalIndex(cp, db);
  index.reset(lines.length, (n) => lines[n - 1] ?? '');
  while (!index.buildSome(1_000)) {
    // until the whole document is read
  }
  return { profile: checked.profile, cp, db, machine: eff, lines, index };
}

/** The context of line `n`, as the provider builds it; `ready: false`: the index has not reached it. */
function contextAt(doc: Doc, n: number, ready = true): HoverContext {
  const lineCount = doc.lines.length;
  const getLine = (k: number): string => doc.lines[k - 1] ?? '';
  const { first, last } = blockRange({ line: n, lineCount, getLine }, doc.cp);
  const before = ready ? doc.index.stateAfter(first - 1) : null;
  return {
    before,
    after: before === null ? null : doc.index.stateAfter(last),
    profile: doc.profile,
    machine: doc.machine,
    blockLines: { first, last, line: n, lineCount, getLine },
  };
}

interface HoverIn {
  /** false: no context at all (a diff side, a scratch model). */
  context?: boolean;
  ready?: boolean;
  /** Which occurrence of `at` on the line (0 = the first). */
  nth?: number;
  waitCode?: WaitCodeLookup;
}

/** The hover markdown on line `n` at `at`. Every message the context asks for must exist. */
function hoverIn(doc: Doc, n: number, at: string, o: HoverIn = {}): string {
  const line = doc.lines[n - 1];
  let offset = -1;
  for (let i = 0; i <= (o.nth ?? 0); i++) offset = line.indexOf(at, offset + 1);
  if (offset < 0) throw new Error(`"${at}" is not on line ${n}: ${line}`);
  const prev = n > 1 ? tokenizeLine(doc.lines[n - 2], doc.cp).state : undefined;
  const context = o.context === false ? undefined : contextAt(doc, n, o.ready !== false);
  const markdown = hoverAt(line, offset, doc.cp, doc.db, t, prev, { context, waitCode: o.waitCode })?.markdown ?? '';
  expect(markdown, 'a message key without a text').not.toContain('assistant.');
  return markdown;
}

/** The markdown with its escapes removed: what the user reads. */
const plain = (markdown: string): string => markdown.replace(/\\(.)/g, '$1');
/** The readable hover. */
const read = (doc: Doc, n: number, at: string, o: HoverIn = {}): string => plain(hoverIn(doc, n, at, o));
/** The table rows of a hover: `[word, meaning, written]`, `null` for "not written". */
function tableOf(text: string): [string, string, string | null][] {
  return text
    .split('\n')
    .filter((row) => row.startsWith('| ') && !row.startsWith('| Word') && !row.startsWith('| ---'))
    .map((row) => {
      const [word, meaning, written] = row.slice(2, -2).split(' | ');
      return [word, meaning, written === '_not written_' ? null : written];
    });
}
const writtenOf = (text: string): Record<string, string | null> => Object.fromEntries(tableOf(text).map(([w, , v]) => [w, v]));

const IS_B = { name: 'Lathe IS-B', params: { numberInput: preset('fanuc-lathe', 'is-b') } };
const CALCULATOR = { name: 'Lathe calc', params: { numberInput: preset('fanuc-lathe', 'calculator') } };

describe('hoverText in context: absent or not ready, the Phase 2 hover unchanged', () => {
  const doc = openDoc('fanuc-lathe', fixture('fanuc-lathe/l01-turning-a.nc'));

  it('says exactly what it said without a context while the index has not reached the block', () => {
    for (const [n, at] of [[14, 'X32.'], [16, 'G71'], [33, 'G76'], [33, 'F1.5'], [12, 'S220'], [11, 'G50'], [50, 'Q3000']] as const) {
      const phase2 = hoverIn(doc, n, at, { context: false });
      expect(hoverIn(doc, n, at, { ready: false }), `${n} ${at}`).toBe(phase2);
      // And in context the Phase 2 text is still the start of the hover.
      expect(hoverIn(doc, n, at).startsWith(phase2), `${n} ${at}`).toBe(true);
    }
  });

  it('adds nothing to a word with nothing to say in context', () => {
    for (const [n, at] of [[8, 'G21'], [13, 'M08'], [10, 'T0101'], [17, 'N100']] as const) {
      expect(hoverIn(doc, n, at), `${n} ${at}`).toBe(hoverIn(doc, n, at, { context: false }));
    }
  });

  it('keeps the wait code of the machine first, with no context added (M12.5)', () => {
    const wait = openDoc('fanuc-lathe', 'G00 X30. Z2.\nM198 P1234');
    const waitCode: WaitCodeLookup = (letter, value) =>
      letter === 'M' && value === 198 ? { ruleId: 'w', label: 'Wait for the other path', machineName: 'Twin' } : null;
    const text = read(wait, 2, 'M198', { waitCode });
    expect(text).toContain('Wait code on this machine (Twin): Wait for the other path');
    expect(text).toBe(read(wait, 2, 'M198', { waitCode, context: false }));
  });
});

describe('hoverText in context: Fanuc lathe, G-code system A (l01-turning-a.nc)', () => {
  const doc = openDoc('fanuc-lathe', fixture('fanuc-lathe/l01-turning-a.nc'));

  it('gives an X word one context line: target, diameter, absolute', () => {
    expect(read(doc, 14, 'X32.')).toContain('X — target, diameter (assumed: profile default), absolute');
    // A position with a point is 32 mm on every Fanuc control: no value line.
    expect(read(doc, 14, 'X32.')).not.toContain('depends on the machine');
  });

  it('reads U as incremental X outside a cycle, and as the cycle parameter inside one', () => {
    const u = openDoc('fanuc-lathe', 'G21 G99\nG00 X30. Z2.\nG01 U-2. F0.1');
    expect(read(u, 3, 'U-2.')).toContain('U — incremental X, diameter (assumed: profile default)');
    expect(read(doc, 15, 'U2.')).toMatch(/U — Depth of cut per pass, a radius value .*\(G71\)/);
    // B1: the same address in the second block is the allowance, by that block's own label.
    expect(read(doc, 16, 'U0.4')).toMatch(/U — Finishing allowance on X, read like X .*\(G71\)/);
    expect(read(doc, 16, 'U0.4')).not.toContain('Depth of cut');
  });

  it('names the feed mode and the code that set it', () => {
    expect(read(doc, 16, 'F0.25')).toContain('F — feed per revolution (G99)');
    expect(read(doc, 18, 'F0.12')).toContain('F — feed per revolution (G99)');
  });

  it('marks a mode the program never set as assumed, with the source', () => {
    const bare = openDoc('fanuc-lathe', 'G00 X30. Z2.\nG01 Z-10. F0.2');
    expect(read(bare, 2, 'F0.2')).toContain('F — feed per revolution (G99, assumed: profile default)');
    const g98 = openDoc('fanuc-lathe', 'G00 X30. Z2.\nG01 Z-10. F150.', { name: 'Lathe', params: { modalInitial: { feedmode: 'G98' } } });
    expect(read(g98, 2, 'F150.')).toContain('F — feed per minute (G98, assumed: machine)');
  });

  it('reads F as the thread lead under a threading cycle, and S as a surface speed with its clamp', () => {
    expect(read(doc, 33, 'F1.5')).toContain('F — thread lead (G76)');
    expect(read(doc, 35, 'F1.5')).toContain('F — thread lead (G92)');
    expect(read(doc, 41, 'F1.5')).toContain('F — thread lead (G32)');
    expect(read(doc, 12, 'S220')).toContain('S — surface speed (G96), clamp 2500 rpm (line 11)');
    expect(read(doc, 11, 'S2500')).toContain('S — speed limit, not a speed (G50)');
    expect(read(doc, 29, 'S1200')).toContain('S — spindle speed in rpm (G97)');
  });

  it('shows the two blocks of G76 with their own words, and says which block it is', () => {
    const first = read(doc, 32, 'G76');
    expect(first).toContain('**Parameters of G76, block 1 of 2**');
    expect(first).toContain('| Word | Meaning | Written |');
    // B1 (`CodeParam.block`): each block lists its own parameters only.
    expect(writtenOf(first)).toEqual({ P: '020060', Q: '80', R: '0.03' });
    const second = read(doc, 33, 'G76');
    expect(second).toContain('**Parameters of G76, block 2 of 2**');
    expect(writtenOf(second)).toEqual({ X: '18.16', U: null, Z: '-18.', W: null, R: null, P: '920', Q: '250', F: '1.5' });
    expect(read(doc, 33, 'P920')).toMatch(/P — Thread height, .*\(G76\)/);
    expect(read(doc, 32, 'P020060')).toMatch(/P — Six digits packed: .*\(G76\)/);
  });

  it('shows the two blocks of G71, and a modal G83 with every parameter, written or not', () => {
    expect(read(doc, 15, 'G71')).toContain('**Parameters of G71, block 1 of 2**');
    expect(writtenOf(read(doc, 16, 'G71'))).toEqual({ P: '100', Q: '200', U: '0.4', W: '0.1', F: '0.25' });
    const g83 = read(doc, 50, 'G83');
    expect(g83).toContain('**Parameters of G83**');
    expect(g83).not.toContain('block 1');
    expect(writtenOf(g83)).toEqual({ Z: '-15.', R: '2.', Q: '3000', P: null, F: '0.08', K: null });
  });

  it('names a cycle parameter by its meaning, and lists the readings of a micron word with no machine', () => {
    expect(read(doc, 50, 'R2.')).toMatch(/R — Distance from the start level to the R point.*\(G83\)/);
    const q = read(doc, 50, 'Q3000');
    expect(q).toMatch(/Q — Peck depth.*\(G83\)/);
    // A micron word reads 3 mm under calculator input too, so the preset is named by its whole
    // label (as the panel does), never by a bare "As written" next to a converted value.
    expect(q).toContain('Q3000 — depends on the machine; choose a machine:\n- 3 mm: As written: X50 and X50. are both 50 mm; G74/G75 P and Q, G76 Q and G83/G87 Q are in microns (Q6000 is 6 mm) (profile default)');
    expect(q).toContain('- 0.3 mm: Increments of 0.0001 mm (IS-C): X50 is 0.0050 mm');
    expect(q).not.toContain('As written (profile default)');
  });
});

describe('hoverText in context: a number whose value depends on the machine (X11 c, the hover half)', () => {
  const text = 'G21 G99\nG00 X50 Z2.\nG01 X50. F25';

  it('lists every reading with no machine, the profile default first', () => {
    const x = read(openDoc('fanuc-lathe', text), 2, 'X50');
    expect(x).toContain('X — target, diameter (assumed: profile default), absolute');
    expect(x).toContain(
      ['X50 — depends on the machine; choose a machine:', '- 50 mm: As written (profile default)', '- 0.05 mm: Increments of 0.001 mm (IS-B)', '- 0.005 mm: Increments of 0.0001 mm (IS-C)'].join('\n'),
    );
  });

  it('gives the effective value and why under the machine', () => {
    const isB = openDoc('fanuc-lathe', text, IS_B);
    expect(read(isB, 2, 'X50')).toContain("X50 — 0.05 mm: no decimal point, increments of 0.001 mm (machine 'Lathe IS-B')");
    expect(read(isB, 3, 'F25')).toContain("F25 — 0.25 mm/rev: no decimal point, increments of 0.01 mm/rev (machine 'Lathe IS-B')");
    expect(read(openDoc('fanuc-lathe', text, CALCULATOR), 2, 'X50')).toContain("X50 — 50 mm: as written (machine 'Lathe calc')");
  });

  it('says nothing about a word every machine reads alike', () => {
    for (const machine of [null, IS_B, CALCULATOR]) {
      const x = read(openDoc('fanuc-lathe', text, machine), 3, 'X50.');
      expect(x).not.toMatch(/X50\. —/);
      expect(x).toContain('X — target, diameter');
    }
  });

  it('on Okuma lists the readings of a word with a point too, and scales it under the machine', () => {
    const okumaDoc = openDoc('okuma-osp', fixture('okuma/o02-thread.MIN'));
    expect(read(okumaDoc, 11, 'X27.55')).toContain(
      ['X27.55 — depends on the machine; choose a machine:', '- 27.55 mm: Unit 1 mm (profile default)', '- 0.02755 mm: Unit 1 µm', '- 0.2755 mm: Unit 10 µm, metric only'].join('\n'),
    );
    const tenMicrons = openDoc('okuma-osp', fixture('okuma/o02-thread.MIN'), {
      name: 'Okuma 10um',
      params: { numberInput: preset('okuma-osp', 'okuma-10um') },
    });
    expect(read(tenMicrons, 11, 'X27.55')).toContain("X27.55 — 0.2755 mm: every number counts in units of 0.01 mm (machine 'Okuma 10um')");
    expect(read(tenMicrons, 11, 'F2')).toContain("F2 — 0.02 mm/rev: every number counts in units of 0.01 mm/rev (machine 'Okuma 10um')");
  });

  it('says which machine leaves the reading open when the machine does not set it', () => {
    const unset = openDoc('fanuc-lathe', text, { name: 'Lathe 2', params: { units: 'mm' } });
    expect(read(unset, 2, 'X50')).toContain("X50 — depends on how numbers are read, which machine 'Lathe 2' does not set:");
  });
});

describe('hoverText in context: Fanuc lathe, G-code system B', () => {
  const text = 'G21 G40 G90 G94\nG92 S2200\nG96 S200 M03\nG00 X42. Z2.\nG01 X30. F150.\nG91 G01 X-2.';

  it('reads the document with its own database: G94 a feed mode in B, a facing pass in A', () => {
    const b = openDoc('fanuc-lathe', text, { detected: { gcodeSystem: { value: 'B', margin: 5 } } });
    expect(read(b, 1, 'G94')).toContain('**G94** — Feed per minute');
    expect(read(b, 5, 'F150.')).toContain('F — feed per minute (G94)');
    expect(read(b, 2, 'S2200')).toContain('S — speed limit, not a speed (G92)');
    expect(read(b, 3, 'S200')).toContain('S — surface speed (G96), clamp 2200 rpm (line 2)');
    expect(read(b, 4, 'X42.')).toContain('X — target, diameter (assumed: profile default), absolute (G90)');
    expect(read(b, 6, 'X-2.')).toContain('X — target, diameter (assumed: profile default), incremental (G91)');
    const a = openDoc('fanuc-lathe', text);
    expect(read(a, 1, 'G94')).toContain('**G94** — Facing pass');
  });

  it('reads the S of a system-A G92 block as a clamp, never as a speed (the data question of P3.2a, decided: kept)', () => {
    // The manual's format of the system-A threading cycle has no S word (Series 30i lathe user
    // manual, §4.1.2 "G92 X(U)_ Z(W)_ F_ Q_;"), so the flag costs a real system-A program
    // nothing; it is what keeps a system-B program read as system A from having its
    // `G92 S` top speed treated as a speed.
    const a = openDoc('fanuc-lathe', 'G21 G99\nG97 S800 M03\nG00 X24. Z6.\nG92 X19.4 Z-18. F1.5 S2000');
    expect(read(a, 4, 'F1.5')).toContain('F — thread lead (G92)');
    expect(read(a, 4, 'S2000')).toContain('S — speed limit, not a speed (G92)');
    expect(read(a, 4, 'X19.4')).toMatch(/X — Thread diameter of this pass \(G92\), diameter/);
  });
});

describe('hoverText in context: Fanuc mill (f01-mill-3tools.nc)', () => {
  const doc = openDoc('fanuc-gcode', fixture('fanuc/f01-mill-3tools.nc'));

  it('gives a position its distance mode and work offset', () => {
    expect(read(doc, 15, 'X-15.')).toContain('X — target, absolute (G90), work offset G54');
    // `G91 G28 Z0.`: the intermediate point, incremental, in the program's coordinates.
    expect(read(doc, 26, 'Z0.')).toContain("Z — Intermediate point on the way to the reference point, in the program's coordinates (G28), incremental (G91)");
    expect(read(doc, 26, 'Z0.')).not.toContain('machine coordinates');
  });

  it('names the feed mode, and a tap feed stays a feed per minute', () => {
    expect(read(doc, 18, 'F400.')).toContain('F — feed per minute (G94)');
    expect(read(doc, 55, 'F450.')).toContain('F — feed per minute (G94)');
    expect(read(doc, 55, 'F450.')).not.toContain('thread lead (G84)');
  });

  it('shows the cycle table, and reads a position under the modal cycle as its hole position', () => {
    const g83 = read(doc, 39, 'G83');
    expect(g83).toContain('**Parameters of G83**');
    expect(writtenOf(g83)).toEqual({ X: '20.', Y: '60.', Z: '-18.', R: '3.', Q: '4.', F: '240.', K: null });
    expect(read(doc, 40, 'X80.')).toContain('X — target, absolute (G90), work offset G54, cycle G83 in force (line 39)');
    // In the cycle's own block the word is its parameter.
    expect(read(doc, 39, 'X20.')).toContain('X — Hole position X (G83), absolute (G90), work offset G54');
  });

  it('reads a point-less word by the machine, and lists the readings without one', () => {
    const text = 'G21 G90 G94 G54\nG0 X50 Y10.';
    expect(read(openDoc('fanuc-gcode', text), 2, 'X50')).toContain(
      ['X50 — depends on the machine; choose a machine:', '- 0.05 mm: Increments of 0.001 mm (IS-B) (profile default)'].join('\n'),
    );
    const isB = openDoc('fanuc-gcode', text, { name: 'Mill', params: { numberInput: preset('fanuc-gcode', 'is-b') } });
    expect(read(isB, 2, 'X50')).toContain("X50 — 0.05 mm: no decimal point, increments of 0.001 mm (machine 'Mill')");
  });
});

describe('hoverText in context: Heidenhain Klartext (h04-cycle-feeds.h)', () => {
  const doc = openDoc('heidenhain-klartext', fixture('heidenhain/h04-cycle-feeds.h'));

  it('shows the parameters of a cycle defined over several lines', () => {
    const def = read(doc, 7, 'CYCL');
    expect(def).toContain('**Parameters of CYCL DEF 200**');
    expect(writtenOf(def)).toEqual({ Q200: '2', Q201: '-20', Q206: '180', Q202: '4', Q210: '0', Q203: '+0', Q204: '50', Q211: '0.2', Q395: '0' });
    // The second definition: its own values, from its own lines.
    expect(writtenOf(read(doc, 20, 'CYCL'))).toMatchObject({ Q201: '-10', Q202: '10', Q211: '0' });
  });

  it('names a Q parameter of the definition by its meaning', () => {
    expect(read(doc, 9, 'Q201')).toContain('Q201 — Depth, negative into the material (CYCL DEF 200)');
  });

  it('shows the defined cycle on its call, with the line of the definition', () => {
    const call = read(doc, 17, 'M99');
    expect(call).toContain('**Parameters of CYCL DEF 200, defined on line 7**');
    expect(writtenOf(call).Q201).toBe('-20');
  });

  it('gives a position its context, and no reading: Klartext numbers do not depend on a machine', () => {
    expect(read(doc, 17, 'X+10')).toContain('X — target, absolute');
    const inch = openDoc('heidenhain-klartext', fixture('heidenhain/h04-cycle-feeds.h'), { name: 'Mill', params: { units: 'mm' } });
    expect(read(inch, 17, 'X+10')).not.toContain('depends on');
    expect(read(inch, 17, 'X+10')).not.toContain("machine 'Mill'");
  });

  it('reads an I word as incremental by its prefix', () => {
    const incremental = openDoc('heidenhain-klartext', '0 BEGIN PGM T MM\n1 L X+10 Y+10 R0 FMAX\n2 L IX+5 R0 F200\n3 END PGM T MM');
    expect(read(incremental, 3, 'IX+5')).toContain('IX — target, incremental');
  });
});

describe('hoverText in context: Sinumerik turning (s05-diameter.MPF, s02-drill.MPF)', () => {
  const doc = openDoc('sinumerik', fixture('sinumerik/s05-diameter.MPF'));

  it('reads X as a diameter or a radius by the diameter mode and the distance mode (AD-19 rule 11)', () => {
    expect(read(doc, 10, 'X84')).toContain('X — target, diameter (assumed: profile default), absolute (G90), work offset G54');
    expect(read(doc, 14, 'X40')).toContain('X — target, radius, absolute (G90), work offset G54');
    expect(read(doc, 18, 'X76')).toContain('X — target, diameter, absolute (G90), work offset G54');
    expect(read(doc, 19, 'X-1')).toContain('X — target, radius, incremental (G91), work offset G54');
  });

  it('marks a diameter mode the machine sets as assumed from the machine', () => {
    const radius = openDoc('sinumerik', fixture('sinumerik/s05-diameter.MPF'), { name: 'Lathe', params: { diameter: 'off' } });
    expect(read(radius, 10, 'X84')).toContain('X — target, radius (assumed: machine), absolute (G90)');
  });

  it('reads the clamp of a LIMS word, the speed limit itself, and a dwell F', () => {
    expect(read(doc, 9, 'S200')).toContain('S — surface speed (G96), clamp 2800 rpm (line 9)');
    expect(read(doc, 9, 'LIMS')).toContain('LIMS — speed limit, not a speed');
    expect(read(doc, 22, 'F1.5')).toContain('F — a time in seconds, not a feed (G4)');
    expect(read(doc, 11, 'F0.3')).toContain('F — feed per revolution (G96)');
  });

  it('shows a call’s arguments by position, an empty one as not written', () => {
    const drill = openDoc('sinumerik', fixture('sinumerik/s02-drill.MPF'));
    const once = read(drill, 12, 'CYCLE83');
    expect(once).toContain('**Parameters of CYCLE83**');
    const written = writtenOf(once);
    expect([written.RTP, written.RFP, written.SDIS, written.DP, written.DPR, written.FDEP, written.VARI]).toEqual(['5', '0', '2', '-30', null, '-8', '0']);
    expect(writtenOf(read(drill, 24, 'CYCLE83')).DP).toBe('-18');
    // A position under the modal call, inside the TRANSMIT frame.
    expect(read(drill, 25, 'X30')).toContain('X — target, radius, absolute (G90), work offset G54, inside TRANSMIT (line 19)');
  });
});

describe('hoverText in context: Sinumerik milling (m01-plate.MPF)', () => {
  const doc = openDoc('sinumerik-mill', fixture('sinumerik-mill/m01-plate.MPF'));

  it('gives a mill position no diameter, and the call its parameters', () => {
    expect(read(doc, 32, 'X20')).toContain('X — target, absolute (G90), work offset G54');
    expect(read(doc, 32, 'X20').split('X — ')[1]).not.toMatch(/diameter|radius/);
    expect(read(doc, 30, 'F240')).toContain('F — feed per minute (G94)');
    expect(writtenOf(read(doc, 31, 'CYCLE83')).DP).toBe('-18');
  });
});

describe('hoverText in context: Okuma (o02-thread.MIN)', () => {
  const doc = openDoc('okuma-osp', fixture('okuma/o02-thread.MIN'));

  it('shows the one-block thread cycle with its words, and F as its lead', () => {
    const g71 = read(doc, 11, 'G71');
    expect(g71).toContain('**Parameters of G71**');
    expect(g71).not.toContain('block 1 of 2');
    expect(writtenOf(g71)).toMatchObject({ X: '27.55', Z: '-30', B: '60', D: '0.7', U: '0.1', H: '2.45', L: '2', F: '2', I: null });
    expect(read(doc, 11, 'F2')).toContain('F — thread lead (G71)');
    expect(read(doc, 11, 'X27.55')).toContain('X — Final thread diameter (G71), diameter (assumed: profile default), absolute (G90, assumed: profile default)');
  });

  it('reads the speed limit of G50 and the dwell of G4', () => {
    expect(read(doc, 6, 'S2000')).toContain('S — speed limit, not a speed (G50)');
    expect(read(doc, 25, 'F1')).toContain('F — a time in seconds, not a feed (G4)');
  });
});

describe('hoverText in context: escaping', () => {
  it('escapes a label from a user database and a value from the document in the table and the context line', () => {
    const raw = JSON.parse(JSON.stringify(fanucCodesJson)) as { codes: { code: string; params?: { address: string; label: string }[] }[] };
    const g83 = raw.codes.find((entry) => entry.code === 'G83');
    if (!g83?.params) throw new Error('no G83 in the mill database');
    for (const param of g83.params) if (param.address === 'R') param.label = '**R** | [plane](https://example.com) <b>x</b>';
    const db = loadCodeDb(raw);
    const doc = openDoc('fanuc-gcode', 'G21 G90 G94 G54\nG98 G83 X20. Y20. Z-18. R[#1*2] Q4. F240.\nG98 G83 X30. Y20. Z-18. R3. Q4. F240.', { db });
    const table = hoverIn(doc, 2, 'G83');
    // The label from the user's database, and the expression from the document.
    expect(table).toContain('| R | \\*\\*R\\*\\* \\| \\[plane\\]\\(https://example\\.com\\) \\<b\\>x\\</b\\> | \\[\\#1\\*2\\] |');
    expect(table).not.toContain('[plane](');
    expect(table).not.toContain('<b>');
    const line = hoverIn(doc, 3, 'R3.');
    expect(line).toContain('R — \\*\\*R\\*\\* \\| \\[plane\\]\\(https://example\\.com\\) \\<b\\>x\\</b\\> \\(G83\\)');
  });
});

describe('hoverText in context: the budget', () => {
  it('answers a hover at line 300,000 within 50 ms, the two states included', () => {
    const block = ['G00 X40. Z2.', 'G01 Z-20. F0.2', 'X42.', 'G00 Z2.'];
    const lines: string[] = ['G21 G99', 'G50 S2500', 'G96 S200 M03'];
    while (lines.length < 299_998) lines.push(block[lines.length % block.length]);
    lines.push('G76 P020060 Q80 R0.03', 'G76 X18.16 Z-18. P920 Q250 F1.5');
    const doc = openDoc('fanuc-lathe', lines.join('\n'), IS_B);
    expect(doc.lines.length).toBe(300_000);
    let text = '';
    const ms = fastest(5, () => {
      text = hoverIn(doc, 300_000, 'F1.5');
    });
    expect(plain(text)).toContain('F — thread lead (G76)');
    expectWithin(ms, 50, 'hover with its modal context at line 300,000');
    const table = fastest(5, () => {
      text = hoverIn(doc, 300_000, 'G76');
    });
    expect(plain(text)).toContain('block 2 of 2');
    expectWithin(table, 50, 'hover with the cycle table at line 300,000');
  });
});

describe('hoverText in context: what the words of special blocks are', () => {
  it('reads G28 words as an intermediate point in the program frame, absolute or incremental', () => {
    const mill = openDoc('fanuc-gcode', 'G90 G54 G00 X0. Y0.\nG28 G91 Z0.\nG90 G28 X0. Y0.\nG53 Z0.');
    const z = read(mill, 2, 'Z0.');
    expect(z).toContain("Z — Intermediate point on the way to the reference point, in the program's coordinates (G28), incremental (G91)");
    expect(z).not.toContain('machine coordinates');
    expect(read(mill, 3, 'X0.')).toContain('(G28), absolute (G90)');
    expect(read(mill, 4, 'Z0.')).toContain('Z — machine coordinates (G53)');
  });

  it('calls no value of a cycle block a diameter', () => {
    const lathe = openDoc('fanuc-lathe', 'G71 U2. R1.\nG71 P10 Q20 U0.5 W0.1 F0.25\nG04 X1.5');
    // Only what the context adds (the address's own text says what U is in general).
    const context = (n: number, at: string): string => read(lathe, n, at).slice(read(lathe, n, at, { context: false }).length);
    // The label says how each block reads U; the reading adds no "diameter" of its own.
    expect(context(1, 'U2.')).toContain('U — Depth of cut per pass, a radius value without sign (G71)');
    expect(context(1, 'U2.')).toMatch(/\(G71\)$/);
    expect(context(1, 'U2.')).not.toMatch(/, diameter\b|incremental/);
    // B1: the second block's U is the allowance, read like X, by its own label.
    expect(context(2, 'U0.5')).toContain('U — Finishing allowance on X, read like X');
    expect(context(2, 'U0.5')).not.toContain('Depth of cut');
    expect(context(3, 'X1.5')).not.toMatch(/, diameter\b/);
  });

  it('names the cycle MCALL made modal at the positions under it', () => {
    const doc = openDoc('sinumerik-mill', 'G0 X0 Y0 Z5\nMCALL CYCLE81(10,0,2,-5)\nX10 Y10\nMCALL\nX30');
    expect(read(doc, 3, 'X10')).toContain('cycle CYCLE81 in force (line 2)');
    expect(read(doc, 5, 'X30')).not.toContain('in force');
  });

  it('calls a threading move in force a thread pass, not a cycle', () => {
    const doc = openDoc('sinumerik', 'G90 G18\nG33 Z-30 K1.5\nX20');
    expect(read(doc, 3, 'X20')).toContain('thread pass G33 in force (line 2)');
    expect(read(doc, 3, 'X20')).not.toContain('cycle G33');
  });

  it('lists a cycle feed written as a word as written', () => {
    const doc = openDoc('heidenhain-klartext', ['5 CYCL DEF 200 DRILLING ~', '  Q200=2 ;SET-UP CLEARANCE ~', '  Q206=FAUTO ;PLUNGING FEED'].join('\n'));
    expect(writtenOf(read(doc, 1, 'CYCL'))).toMatchObject({ Q200: '2', Q206: 'FAUTO' });
  });

  it('names the code that gave a feed its unit, never one that says the opposite', () => {
    expect(read(openDoc('okuma-osp', 'G95\nG101 X40 C90 F100'), 2, 'F100')).toContain('F — feed per minute (G101)');
    expect(read(openDoc('okuma-osp', 'G94\nG101 X40 C90 F100'), 2, 'F100')).toContain('F — feed per minute (G94)');
  });
});
