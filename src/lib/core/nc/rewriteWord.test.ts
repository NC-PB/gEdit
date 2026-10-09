// P3.2a: rewriting one word (Phase 3 plan §6.4). The form of the word is kept, a typed value
// is never rounded, and a value that does not fit is refused with the reason.

import { describe, expect, it } from 'vitest';
import { WRITE_BACK_ERRORS } from '$lib/core/machines/numbers';
import type { MachineParams, NumberInput, ResolvedClass } from '$lib/core/machines/types';
import type { NumberFormatOptions } from '$lib/core/profiles/types';
import { profileOf, cpOf } from '../../../../tests/unit/helpers/profiles';
import { rewriteWord, type RewriteHow } from './rewriteWord';
import { tokenizeLine } from './tokenizer';
import type { NcToken } from './types';

const FMT: NumberFormatOptions = { decimals: 'keep', trailingZeros: 'keep', keepPoint: true, plusSign: 'keep' };

function preset(profileId: string, id: string): NumberInput {
  const found = profileOf(profileId).machineParams?.numberInput?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profileId}: no preset ${id}`);
  return found.value;
}

function params(numberInput: NumberInput | null): MachineParams {
  return { numberInput, units: 'mm', diameter: null, variants: {}, modalInitial: {} };
}

const IS_B = params(preset('fanuc-gcode', 'is-b'));
const CALC = params(preset('fanuc-lathe', 'calculator'));
const OKUMA_10UM = params(preset('okuma-osp', 'okuma-10um'));
const AS_JSON = params(null);

function how(cls: ResolvedClass, p: MachineParams, extra: Partial<RewriteHow> = {}): RewriteHow {
  return { cls, params: p, units: 'mm', fmt: FMT, ...extra };
}

function tokenIn(profileId: string, line: string, text: string): NcToken {
  const found = tokenizeLine(line, cpOf(profileId)).tokens.find((t) => t.text === text);
  if (!found) throw new Error(`no token ${text}`);
  return found;
}

/** The new line, or the refusal's key. */
function rewrite(profileId: string, line: string, text: string, typed: string, h: RewriteHow): string {
  const result = rewriteWord(line, tokenIn(profileId, line, text), typed, h);
  return result.ok ? result.line : `refused: ${result.reason.key}`;
}

describe('rewriteWord: a point-less word under increments (IS-B)', () => {
  it('takes a whole number of increments and refuses what would have to be rounded', () => {
    expect(rewrite('fanuc-gcode', 'G0 X50 Y0', 'X50', '0.051', how('length', IS_B))).toBe('G0 X51 Y0');
    expect(rewrite('fanuc-gcode', 'G0 X50 Y0', 'X50', '0.0505', how('length', IS_B))).toBe(`refused: ${WRITE_BACK_ERRORS.rounded.key}`);
    // A feed per revolution counts in 0.01 mm/rev.
    expect(rewrite('fanuc-gcode', 'G1 Z-5. F25', 'F25', '0.3', how('feedPerRev', IS_B))).toBe('G1 Z-5. F30');
    expect(rewrite('fanuc-gcode', 'G1 Z-5. F25', 'F25', '0.305', how('feedPerRev', IS_B))).toBe(`refused: ${WRITE_BACK_ERRORS.rounded.key}`);
  });

  it('says why it refused, with the increment', () => {
    const result = rewriteWord('X50', tokenIn('fanuc-gcode', 'X50', 'X50'), '0.0505', how('length', IS_B));
    expect(result).toEqual({ ok: false, reason: { key: WRITE_BACK_ERRORS.rounded.key, params: { increment: '0.001' } } });
  });

  it('keeps a packed block packed and changes only the word', () => {
    const line = 'N10G0G90X50Y-20.5Z+3.F200';
    expect(rewrite('fanuc-gcode', line, 'X50', '0.12', how('length', IS_B))).toBe('N10G0G90X120Y-20.5Z+3.F200');
    expect(rewrite('fanuc-gcode', line, 'Y-20.5', '-21.25', how('length', IS_B))).toBe('N10G0G90X50Y-21.25Z+3.F200');
  });
});

describe('rewriteWord: the form of the number', () => {
  it('keeps the point, the written decimals and typed extra decimals; never rounds', () => {
    const line = 'G1 X10.500 Z-2. F0.2 (FINISH)';
    expect(rewrite('fanuc-gcode', line, 'X10.500', '12.3', how('length', IS_B))).toBe('G1 X12.300 Z-2. F0.2 (FINISH)');
    expect(rewrite('fanuc-gcode', line, 'X10.500', '12', how('length', IS_B))).toBe('G1 X12.000 Z-2. F0.2 (FINISH)');
    expect(rewrite('fanuc-gcode', line, 'X10.500', '12.3450', how('length', IS_B))).toBe('G1 X12.3450 Z-2. F0.2 (FINISH)');
    expect(rewrite('fanuc-gcode', line, 'X10.500', '12.34567', how('length', IS_B))).toBe('G1 X12.34567 Z-2. F0.2 (FINISH)');
    expect(rewrite('fanuc-gcode', line, 'Z-2.', '-3', how('length', IS_B))).toBe('G1 X10.500 Z-3. F0.2 (FINISH)');
  });

  it('keeps the sign style, the address case, a leading-zero-less fraction and the spacing', () => {
    expect(rewrite('fanuc-gcode', 'G0  Z+3.', 'Z+3.', '5', how('length', IS_B))).toBe('G0  Z+5.');
    expect(rewrite('fanuc-gcode', 'G0  Z+3.', 'Z+3.', '-5', how('length', IS_B))).toBe('G0  Z-5.');
    expect(rewrite('fanuc-gcode', 'x10.5 y.5', 'x10.5', '11', how('length', IS_B))).toBe('x11.0 y.5');
    expect(rewrite('fanuc-gcode', 'x10.5 y.5', 'y.5', '0.75', how('length', IS_B))).toBe('x10.5 y.75');
  });

  it('answers the new word and where it stands', () => {
    const line = 'G0 X50. Z2.';
    const result = rewriteWord(line, tokenIn('fanuc-gcode', line, 'X50.'), '125.5', how('length', IS_B));
    expect(result).toEqual({ ok: true, line: 'G0 X125.5 Z2.', text: 'X125.5', start: 3, end: 9 });
  });

  it('gives a point-less word a point under calculator input only where the value needs one', () => {
    expect(rewrite('fanuc-lathe', 'G0 X50 Z2.', 'X50', '50.5', how('length', CALC))).toBe('G0 X50.5 Z2.');
    expect(rewrite('fanuc-lathe', 'G0 X50 Z2.', 'X50', '60', how('length', CALC))).toBe('G0 X60 Z2.');
  });

  it('writes a micrometre parameter as a count of increments', () => {
    expect(rewrite('fanuc-lathe', 'G83 Z-20. Q6000 F0.1', 'Q6000', '6.5', how('increment', CALC))).toBe('G83 Z-20. Q6500 F0.1');
  });

  it('keeps the decimal comma of a Klartext word', () => {
    const line = '7 L X+10 Y+5,5 R0 FMAX';
    expect(rewrite('heidenhain-klartext', line, 'Y+5,5', '6.25', how('length', AS_JSON))).toBe('7 L X+10 Y+6,25 R0 FMAX');
    expect(rewrite('heidenhain-klartext', line, 'Y+5,5', '6,5', how('length', AS_JSON))).toBe('7 L X+10 Y+6,5 R0 FMAX');
  });
});

describe('rewriteWord: a unit system that scales every number (Okuma 10 µm)', () => {
  it('refuses a value that is not a whole number of units in a point-less word', () => {
    expect(rewrite('okuma-osp', 'G0 X50 Z2', 'X50', '0.015', how('length', OKUMA_10UM))).toBe(`refused: ${WRITE_BACK_ERRORS.rounded.key}`);
    expect(rewrite('okuma-osp', 'G0 X50 Z2', 'X50', '0.02', how('length', OKUMA_10UM))).toBe('G0 X2 Z2');
  });

  it('writes a word with a point in units too', () => {
    expect(rewrite('okuma-osp', 'G0 X50. Z2', 'X50.', '0.015', how('length', OKUMA_10UM))).toBe('G0 X1.5 Z2');
  });
});

describe('rewriteWord: words without a class', () => {
  it('takes the typed value as the literal, with the zero padding as written', () => {
    expect(rewrite('fanuc-lathe', 'T0101 (OD ROUGH)', 'T0101', '202', how(null, CALC))).toBe('T0202 (OD ROUGH)');
    expect(rewrite('fanuc-lathe', 'G76 P020060 Q100 R0.05', 'P020060', '10060', how('count', CALC))).toBe('G76 P010060 Q100 R0.05');
    expect(rewrite('fanuc-lathe', 'G96 S220 M03', 'S220', '250', how(null, CALC))).toBe('G96 S250 M03');
    expect(rewrite('okuma-osp', 'G96 SB=800 S200 M13', 'SB=800', '1200', how(null, OKUMA_10UM))).toBe('G96 SB=1200 S200 M13');
  });

  it('writes the number of a Klartext assignment, read as one word', () => {
    const line = '  Q200=2 ;SET-UP CLEARANCE ~';
    const token: NcToken = { kind: 'word', start: 2, end: 8, text: 'Q200=2', address: 'Q200', valueText: '2', value: { raw: '2', sign: '', intPart: '2', fracPart: null, hasPoint: false } };
    const result = rewriteWord(line, token, '3', how(null, AS_JSON));
    expect(result).toEqual({ ok: true, line: '  Q200=3 ;SET-UP CLEARANCE ~', text: 'Q200=3', start: 2, end: 8 });
  });
});

describe('rewriteWord: refusals', () => {
  it('refuses what is not a number, and a word that needs a machine nobody chose', () => {
    expect(rewrite('fanuc-gcode', 'G0 X50.', 'X50.', 'abc', how('length', IS_B))).toBe(`refused: ${WRITE_BACK_ERRORS.notANumber.key}`);
    expect(rewrite('fanuc-gcode', 'G0 X50.', 'X50.', '1.2.3', how('length', IS_B))).toBe(`refused: ${WRITE_BACK_ERRORS.notANumber.key}`);
    const readings = [{ preset: 'is-b', label: 'IS-B', value: '0.05' }];
    expect(rewrite('fanuc-gcode', 'G0 X50', 'X50', '0.06', how('length', IS_B, { readings }))).toBe(`refused: ${WRITE_BACK_ERRORS.noReading.key}`);
  });

  it('refuses a word whose value is a variable or an expression', () => {
    expect(rewrite('fanuc-gcode', 'G0 X#101', 'X#101', '5', how('length', IS_B))).toBe(`refused: ${WRITE_BACK_ERRORS.noReading.key}`);
  });

  it('refuses a class no machine declares a reading for', () => {
    expect(rewrite('fanuc-gcode', 'G1 X1. F0.1', 'F0.1', '0.2', how('feedPerTooth', IS_B))).toBe(`refused: ${WRITE_BACK_ERRORS.noReading.key}`);
  });
});
