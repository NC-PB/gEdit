// How the control reads numbers (plan §7.15, AD-31). Owner: WP6.9.
//
// The table lives in `tests/fixtures/machines/numbers.json` because `_nc_machine.py` has
// to answer every case the same way (`tests/python/test_machine.py` reads the same file).
// A disagreement between the two implementations is a failure, not a rounding detail, so
// a case is added here and there or nowhere.
//
// The cases below the table are the ones that are about these functions' own edges rather
// than about a rule a machine declares.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CodeEntry } from '$lib/core/codes/types';
import type { NumericLiteral } from '$lib/core/nc/types';
import type { FeedUnit, MachineParamsDecl, NumberFormatOptions, Profile } from '$lib/core/profiles/types';
import { parseNumber } from '$lib/core/nc/numbers';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { numberClassOf, readingsOf, resolveValue, valueOf, writeBack, WRITE_BACK_ERRORS } from './numbers';
import type { EffectiveMachine, MachineParams, NumberInput, ResolvedClass } from './types';

interface Golden {
  fmt: NumberFormatOptions;
  inputs: Record<string, NumberInput>;
  decls: Record<string, { profile?: string; numberInput?: { default: string; presets: { id: string; label: string; input: string }[] } }>;
  profiles: Record<string, { profile?: string; inline?: unknown }>;
  class: {
    note: string;
    profile: string;
    address: string;
    feedUnit: FeedUnit;
    pitchFeed?: boolean;
    codes: unknown[];
    expected: ResolvedClass;
  }[];
  value: {
    note: string;
    literal: string;
    class: string;
    input: string | null;
    units: 'mm' | 'inch';
    expected: string | null;
  }[];
  writeBack: {
    note: string;
    value: string;
    original: string;
    class: string;
    input: string | null;
    units: 'mm' | 'inch';
    refuseRounding?: boolean;
    expected: { text: string; rounded: boolean } | { error: keyof typeof WRITE_BACK_ERRORS };
  }[];
  readings: {
    note: string;
    literal: string;
    class: string;
    decl: string;
    units: 'mm' | 'inch';
    expected: { preset: string; value: string | null }[];
  }[];
  resolve: {
    note: string;
    literal: string;
    class: ResolvedClass;
    source: 'machine' | 'profile';
    input: string | null;
    decl: string;
    units: 'mm' | 'inch';
    expected: { value: string | null; readings: string[] };
  }[];
}

const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../tests/fixtures/machines/numbers.json', import.meta.url)), 'utf8'),
) as Golden;

/** A built-in profile as the app uses it (parents merged in). */
function builtin(id: string): Profile {
  const found = (BUILTIN_PROFILE_JSON as { id?: string }[]).find((profile) => profile?.id === id);
  expect(found, `no built-in profile ${id}`).toBeDefined();
  return found as unknown as Profile;
}

function profileOf(name: string): Profile {
  const entry = GOLDEN.profiles[name];
  expect(entry, `no profile ${name} in the golden set`).toBeDefined();
  return entry.profile !== undefined ? builtin(entry.profile) : (entry.inline as Profile);
}

/** A `machineParams` declaration: a built-in profile's, or one the golden set writes itself. */
function declOf(name: string): MachineParamsDecl | undefined {
  const entry = GOLDEN.decls[name];
  expect(entry, `no declaration ${name} in the golden set`).toBeDefined();
  if (entry.profile !== undefined) return builtin(entry.profile).machineParams;
  const written = entry.numberInput;
  if (!written) return undefined;
  return {
    numberInput: {
      default: written.default,
      presets: written.presets.map((preset) => ({
        id: preset.id,
        label: preset.label,
        value: inputOf(preset.input) as NumberInput,
      })),
    },
  };
}

function inputOf(name: string | null): NumberInput | null {
  if (name === null) return null;
  const input = GOLDEN.inputs[name];
  expect(input, `no number input ${name} in the golden set`).toBeDefined();
  return input;
}

/** The machine parameters a case describes; only `numberInput` matters to these functions. */
function paramsOf(name: string | null): MachineParams {
  return { numberInput: inputOf(name), units: 'mm', diameter: null, variants: {}, modalInitial: {} };
}

function literalOf(raw: string): NumericLiteral {
  const parsed = parseNumber(raw);
  expect(parsed, `${raw} does not parse`).not.toBeNull();
  return parsed as NumericLiteral;
}

const CASE_COUNT =
  GOLDEN.class.length + GOLDEN.value.length + GOLDEN.writeBack.length + GOLDEN.readings.length + GOLDEN.resolve.length;

describe('machines/numbers.json', () => {
  it('holds the cases the plan asks for', () => {
    expect(CASE_COUNT).toBeGreaterThanOrEqual(80);
  });

  it.each(GOLDEN.class.map((c, i) => [`${i + 1}. ${c.note}`, c] as const))('class %s', (_name, c) => {
    expect(
      numberClassOf(c.address, {
        profile: profileOf(c.profile),
        feedUnit: c.feedUnit,
        blockCodes: c.codes as CodeEntry[],
        pitchFeed: c.pitchFeed === true,
      }),
    ).toBe(c.expected);
  });

  it.each(GOLDEN.value.map((c, i) => [`${i + 1}. ${c.note}`, c] as const))('value %s', (_name, c) => {
    expect(valueOf(literalOf(c.literal), c.class as 'length', paramsOf(c.input), c.units)).toBe(c.expected);
  });

  it.each(GOLDEN.writeBack.map((c, i) => [`${i + 1}. ${c.note}`, c] as const))('writeBack %s', (_name, c) => {
    const result = writeBack(
      c.value,
      literalOf(c.original),
      c.class as 'length',
      paramsOf(c.input),
      c.units,
      GOLDEN.fmt,
      { refuseRounding: c.refuseRounding === true },
    );
    if ('error' in c.expected) {
      expect(result).toEqual({ error: expect.objectContaining({ key: WRITE_BACK_ERRORS[c.expected.error].key }) });
    } else {
      expect(result).toEqual(c.expected);
    }
  });

  it.each(GOLDEN.readings.map((c, i) => [`${i + 1}. ${c.note}`, c] as const))('readings %s', (_name, c) => {
    const readings = readingsOf(literalOf(c.literal), c.class as 'length', declOf(c.decl), c.units);
    expect(readings.map((reading) => ({ preset: reading.preset, value: reading.value }))).toEqual(c.expected);
    // Every reading carries the preset's own label, which is what the user is shown.
    for (const reading of readings) expect(reading.label.length, reading.preset).toBeGreaterThan(0);
  });

  it.each(GOLDEN.resolve.map((c, i) => [`${i + 1}. ${c.note}`, c] as const))('resolve %s', (_name, c) => {
    const eff = {
      id: null,
      name: null,
      choice: c.source === 'machine' ? 'document' : 'none',
      params: paramsOf(c.input),
      source: {
        numberInput: c.source,
        units: 'profile',
        diameter: 'profile',
        variants: {},
        modalInitial: {},
      },
      key: 'test',
      mismatch: null,
    } as EffectiveMachine;
    const result = resolveValue(literalOf(c.literal), c.class, eff, declOf(c.decl), c.units);
    expect(result.value).toBe(c.expected.value);
    expect(result.readings.map((reading) => reading.preset)).toEqual(c.expected.readings);
  });
});

const IS_B: MachineParams = {
  numberInput: {
    mode: 'increment',
    incrementMm: '0.001',
    incrementInch: '0.0001',
    incrementDeg: '0.001',
    incrementSec: '0.001',
    classes: { feedPerMin: { mode: 'calculator' }, feedPerRev: { mode: 'calculator' } },
  },
  units: 'mm',
  diameter: null,
  variants: {},
  modalInitial: {},
};

const KEEP: NumberFormatOptions = { decimals: 'keep', trailingZeros: 'keep', keepPoint: true, plusSign: 'keep' };

describe('numberClassOf', () => {
  const mill = builtin('fanuc-gcode');

  it('takes the first parameter that declares a unit when two codes name the same address', () => {
    const codes = [
      { code: 'G4', label: 'Dwell', params: [{ address: 'X', label: 'Time', unit: 'dwell' as const }] },
      { code: 'G83', label: 'Peck', params: [{ address: 'X', label: 'Position', unit: 'increment' as const }] },
    ] as CodeEntry[];
    expect(numberClassOf('X', { profile: mill, feedUnit: 'per-minute', blockCodes: codes, pitchFeed: false })).toBe('dwell');
  });

  it('ignores a parameter of another address and a parameter without a unit', () => {
    const codes = [
      { code: 'G81', label: 'Drill', params: [{ address: 'Z', label: 'Depth' }, { address: 'K', label: 'Repeats', unit: 'count' as const }] },
    ] as CodeEntry[];
    expect(numberClassOf('Z', { profile: mill, feedUnit: 'per-minute', blockCodes: codes, pitchFeed: false })).toBe('length');
  });

  it('answers nothing for an empty address', () => {
    expect(numberClassOf('', { profile: mill, feedUnit: 'per-minute', blockCodes: [], pitchFeed: false })).toBeNull();
  });
});

describe('valueOf', () => {
  it('never returns a minus zero, whichever reading produced it', () => {
    for (const raw of ['-0', '-0.', '-0.000']) {
      expect(valueOf(literalOf(raw), 'length', IS_B, 'mm'), raw).toBe('0');
    }
  });

  it('strips the trailing zeros the multiplication produced, so two readings can be compared as text', () => {
    expect(valueOf(literalOf('50'), 'length', IS_B, 'mm')).toBe('0.05');
    expect(valueOf(literalOf('50.000'), 'length', IS_B, 'mm')).toBe('50');
  });

  it('gives a literal that is not a number no value at all', () => {
    expect(valueOf({ raw: '1.2.3', sign: '', intPart: '1', fracPart: '2', hasPoint: true }, 'length', IS_B, 'mm')).toBeNull();
  });
});

describe('writeBack', () => {
  it('reports the rounding rather than hiding it, and refuses it when asked to', () => {
    const rounded = writeBack('0.0505', literalOf('50'), 'length', IS_B, 'mm', KEEP);
    expect(rounded).toEqual({ text: '51', rounded: true });
    const refused = writeBack('0.0505', literalOf('50'), 'length', IS_B, 'mm', KEEP, { refuseRounding: true });
    expect('error' in refused && refused.error.key).toBe(WRITE_BACK_ERRORS.rounded.key);
    // The message can say what the machine reads this word in.
    expect('error' in refused && refused.error.params?.increment).toBe('0.001');
  });

  it('does not refuse a value that fits, even with refuseRounding', () => {
    expect(writeBack('0.05', literalOf('50'), 'length', IS_B, 'mm', KEEP, { refuseRounding: true })).toEqual({
      text: '50',
      rounded: false,
    });
  });

  it('keeps a point-less word point-less in all three readings', () => {
    const calculator: MachineParams = { ...IS_B, numberInput: { mode: 'calculator', incrementMm: '1' } };
    const scale: MachineParams = { ...IS_B, numberInput: { mode: 'scale', incrementMm: '0.01' } };
    for (const [machine, value, text] of [
      [IS_B, '0.06', '60'],
      [calculator, '60', '60'],
      [scale, '0.6', '60'],
    ] as const) {
      expect(writeBack(value, literalOf('50'), 'length', machine, 'mm', KEEP), value).toEqual({ text, rounded: false });
    }
  });

  it('keeps the point of a word that has one in all three readings', () => {
    const calculator: MachineParams = { ...IS_B, numberInput: { mode: 'calculator', incrementMm: '1' } };
    const scale: MachineParams = { ...IS_B, numberInput: { mode: 'scale', incrementMm: '0.01' } };
    for (const [machine, value, text] of [
      [IS_B, '60', '60.'],
      [calculator, '60', '60.'],
      [scale, '0.6', '60.'],
    ] as const) {
      expect(writeBack(value, literalOf('50.'), 'length', machine, 'mm', KEEP), value).toEqual({ text, rounded: false });
    }
  });

  it('refuses a value that is not a decimal number instead of throwing', () => {
    const result = writeBack('1e3', literalOf('50'), 'length', IS_B, 'mm', KEEP);
    expect('error' in result && result.error.key).toBe(WRITE_BACK_ERRORS.notANumber.key);
  });
});

describe('readingsOf', () => {
  it('puts the declared default first, whatever order the presets are written in', () => {
    const decl: MachineParamsDecl = {
      numberInput: {
        default: 'calculator',
        presets: [
          { id: 'is-b', label: 'IS-B', value: { mode: 'increment', incrementMm: '0.001' } },
          { id: 'calculator', label: 'As written', value: { mode: 'calculator', incrementMm: '1' } },
        ],
      },
    };
    expect(readingsOf(literalOf('50'), 'length', decl, 'mm').map((r) => r.preset)).toEqual(['calculator', 'is-b']);
  });

  it('answers nothing for a profile that declares no machine parameters at all', () => {
    expect(readingsOf(literalOf('50'), 'length', undefined, 'mm')).toEqual([]);
  });
});
