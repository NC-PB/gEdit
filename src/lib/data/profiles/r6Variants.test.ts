// The two R6 machine choices (plan M9 WP9.4, §8.8 "The M9 variants", AD-31):
//
//   - `fanuc-lathe` `incrementalAddresses`: which of `U`, `W`, `V`, `H` move incrementally
//     (`uw` default, `uwvh`, `none`);
//   - `fanuc-lathe` and `okuma-osp` `toolWord`: how many of a tool word's digits are the
//     offset (on the lathe `byLength` default since M12.5, `offset2`, `offset1` and
//     `offset3`; on Okuma `offset2` default and `offset3`).
//
// Both are overlays only: no `detect`, no `codes`. What this file proves:
//
//   1. the declaration is what §8.8 pins (ids, choices, defaults, nothing else);
//   2. **the default of each choice reproduces the reading the profile had before the
//      variants existed**, except the lathe's tool word, which M12.5 decision 1 changed on
//      purpose (the owner, 2026-10-08): five digits read 2 + 3 with no machine, a zero
//      offset with `M6` loads the tool, a three-digit `G` block has no tool. The strings
//      below are frozen copies, so a later edit of the base cannot move them silently;
//   3. each choice reads a tool word as `tests/fixtures/machines/files/r6-tool-words.json`
//      says (the table Python reads too), and the program map of a short program under
//      each choice is the golden under `tests/fixtures/expected/outline/**/variants/`;
//   4. the sample `machines.json` that sets every choice validates, and a machine with a
//      choice leaves the effective profile valid.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import { OutlineIndex } from '$lib/core/profiles/outline';
import { validateProfile } from '$lib/core/profiles/validate';
import { parseMachinesFile } from '$lib/core/machines/file';
import { validateMachine } from '$lib/core/machines/validate';
import { applyMachine, effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { MachineConfig } from '$lib/core/machines/types';

const FILES = fileURLToPath(new URL('../../../../tests/fixtures/machines/files/', import.meta.url));
const GOLDENS = '../../../../tests/fixtures/expected/outline/';

const PROFILES = new Map<string, Profile>(
  BUILTIN_PROFILE_JSON.map((raw) => {
    const checked = validateProfile(raw);
    if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
    return [checked.profile.id, checked.profile];
  }),
);

function profile(id: string): Profile {
  const found = PROFILES.get(id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

/** A machine that sets exactly these variants, through the same path a document takes. */
function machineWith(p: Profile, variants: Record<string, string>) {
  const config: MachineConfig = { id: 'r6', name: 'r6', profile: p.id, params: { variants } };
  return effectiveMachine(p, config, 'document', {});
}

/** The effective profile (resolved profile + machine, validated, compiled) of one choice. */
function effective(id: string, variants: Record<string, string> = {}): CompiledProfile {
  const p = profile(id);
  const applied = applyMachine(p, machineWith(p, variants));
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(`${id} ${JSON.stringify(variants)}: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
}

const LATHE = 'fanuc-lathe';
const OKUMA = 'okuma-osp';

// ---------------------------------------------------------------------------
// 1. The declaration
// ---------------------------------------------------------------------------

describe('the declaration (§8.8 "The M9 variants")', () => {
  const variantsOf = (id: string) => profile(id).machineParams?.variants ?? [];

  it('gives the Fanuc lathe the G-code system and the two R6 variants, in that order', () => {
    expect(variantsOf(LATHE).map((v) => [v.id, v.default, v.choices.map((c) => c.value)])).toEqual([
      ['gcodeSystem', 'A', ['A', 'B']],
      ['incrementalAddresses', 'uw', ['uw', 'uwvh', 'none']],
      ['toolWord', 'byLength', ['byLength', 'offset2', 'offset1', 'offset3']],
    ]);
  });

  it('gives Okuma one variant: the tool word', () => {
    expect(variantsOf(OKUMA).map((v) => [v.id, v.default, v.choices.map((c) => c.value)])).toEqual([
      ['toolWord', 'offset2', ['offset2', 'offset3']],
    ]);
  });

  it('keeps the R6 choices to an overlay: no detection rule, no database, no other member', () => {
    for (const id of [LATHE, OKUMA]) {
      for (const variant of variantsOf(id).filter((v) => v.id !== 'gcodeSystem')) {
        for (const choice of variant.choices) {
          expect(choice.detect, `${id} ${variant.id}=${choice.value}`).toBeUndefined();
          expect(choice.codes, `${id} ${variant.id}=${choice.value}`).toBeUndefined();
          expect(Object.keys(choice.overlay ?? {}), `${id} ${variant.id}=${choice.value}`).toEqual([
            variant.id === 'toolWord' ? 'toolCall' : 'addresses',
          ]);
        }
      }
    }
  });

  it('marks the defaults as verify in their labels, and nothing else', () => {
    for (const id of [LATHE, OKUMA]) {
      for (const variant of variantsOf(id).filter((v) => v.id !== 'gcodeSystem')) {
        for (const choice of variant.choices) {
          expect(/verify/.test(choice.label), `${id} ${variant.id}=${choice.value}`).toBe(choice.value === variant.default);
        }
      }
    }
  });

  it('moves addresses.incremental out of the base profile, into the choices', () => {
    expect(profile(LATHE).addresses.incremental).toBeUndefined();
    const choices = variantsOf(LATHE).find((v) => v.id === 'incrementalAddresses')?.choices ?? [];
    expect(choices.find((c) => c.value === 'uw')?.overlay?.addresses?.incremental).toEqual({ U: 'X', W: 'Z' });
    expect(choices.find((c) => c.value === 'uwvh')?.overlay?.addresses?.incremental).toEqual({
      U: 'X',
      W: 'Z',
      V: 'Y',
      H: 'C',
    });
    // `none` states no incremental twin at all, and takes `U` out of the diameters.
    expect(choices.find((c) => c.value === 'none')?.overlay?.addresses).toEqual({ diameter: ['X'] });
  });
});

// ---------------------------------------------------------------------------
// 2. The default reproduces the reading before M9
// ---------------------------------------------------------------------------

/** The `toolCall` of the base profiles at the P9 commit (8586a6b), frozen. */
const BEFORE: Record<string, Record<string, string>> = {
  // The lathe's entry is now the `offset2` choice's reading of a word alone (below); the
  // default is `byLength` (BY_LENGTH).
  [LATHE]: {
    trigger: '(?<![A-Z])T\\d{1,5}(?!\\d)',
    ignore: '(?<![A-Z])T(?:\\d{0,3}00|0+)(?!\\d)',
    tool: '(?<![A-Z])T(?<tool>\\d{1,3}?)(?:\\d{2})?(?!\\d)',
    toolFrom: 'same-line',
  },
  [OKUMA]: {
    trigger: '(?<![A-Z])T\\d{4}(?:\\d{2})?(?!\\d)',
    ignore: '(?<![A-Z])(?:G0*(?:7[1-8]|18\\d)(?![\\d.])|T(?:\\d{2})?00\\d{2}(?!\\d))',
    tool: '(?<![A-Z])T(?:\\d{2}(?=\\d{4}(?!\\d)))?(?<tool>\\d{2})(?=\\d{2}(?!\\d))',
    toolFrom: 'same-line',
  },
};

/**
 * The lathe's tool rule since M12.5 (decision 1, §7.16 #181), frozen: `byLength` is the base
 * and the default; every choice shares the `M6` exception and the three-digit-`G` rule (the
 * control's own `G107`, `G112`, `G113`, `G250`, `G251` excepted), and a tool part of zeros
 * is no tool on every choice (each with its own length of the offset).
 */
const NO_M6 = '^(?!.*(?<![A-Z])M0*6(?!\\d)).*';
const T0 = '|(?<![A-Z])T0+(?!\\d)';
const G3 = '|(?<![A-Z])G(?!(?:107|112|113|250|251)(?!\\d))[1-9]\\d{2}(?!\\d)';
const BY_LENGTH = {
  trigger: '(?<![A-Z])T\\d{1,5}(?!\\d)',
  ignore: `${NO_M6}(?<![A-Z])T(?:\\d{1,2}00|\\d{2}000)(?!\\d)${T0}|(?<![A-Z])T(?:0{1,2}(?=\\d{2}(?!\\d))|00(?=\\d{3}(?!\\d)))${G3}`,
  tool: '(?<![A-Z])T(?<tool>\\d{2}(?=\\d{3}(?!\\d))|\\d{1,2}?(?=\\d{2}(?!\\d))|\\d{1,2}(?!\\d))\\d{0,3}(?!\\d)',
  toolFrom: 'same-line',
};

describe('the default choice reads exactly as the profile did before M9', () => {
  it('Okuma: the tool rule, with no machine and with the default stated', () => {
    expect(profile(OKUMA).toolCall).toEqual(BEFORE[OKUMA]);
    expect(applyMachine(profile(OKUMA), noMachine(profile(OKUMA))).profile.toolCall).toEqual(BEFORE[OKUMA]);
    expect(effective(OKUMA, { toolWord: 'offset2' }).profile.toolCall).toEqual(BEFORE[OKUMA]);
  });

  it('the Fanuc lathe: byLength is the base and the default (M12.5 decision 1)', () => {
    expect(profile(LATHE).toolCall).toEqual(BY_LENGTH);
    expect(applyMachine(profile(LATHE), noMachine(profile(LATHE))).profile.toolCall).toEqual(BY_LENGTH);
    expect(effective(LATHE, { toolWord: 'byLength' }).profile.toolCall).toEqual(BY_LENGTH);
  });

  it('the Fanuc lathe offset2 keeps the pre-M9 trigger and tool, and its ignore gains only the M12.5 rules', () => {
    const rule = effective(LATHE, { toolWord: 'offset2' }).profile.toolCall;
    expect(rule.trigger).toBe(BEFORE[LATHE].trigger);
    expect(rule.tool).toBe(BEFORE[LATHE].tool);
    expect(rule.toolFrom).toBe(BEFORE[LATHE].toolFrom);
    expect(rule.ignore).toBe(`${NO_M6}(?<![A-Z])T(?:\\d{1,3}00)(?!\\d)${T0}|(?<![A-Z])T0+(?=\\d{2}(?!\\d))${G3}`);
  });

  it('the Fanuc lathe: U and W incremental, X and U diameters, as before', () => {
    const applied = applyMachine(profile(LATHE), noMachine(profile(LATHE))).profile;
    expect(applied.addresses.incremental).toEqual({ U: 'X', W: 'Z' });
    expect(applied.addresses.diameter).toEqual(['X', 'U']);
    expect(applied.addresses.axes).toEqual(['X', 'Z', 'C', 'Y', 'U', 'W']);
  });

  it('Okuma still has no incremental twin', () => {
    expect(applyMachine(profile(OKUMA), noMachine(profile(OKUMA))).profile.addresses.incremental).toBeUndefined();
  });

  it('a machine that sets nothing about the R6 variants gets the defaults', () => {
    const eff = machineWith(profile(LATHE), { gcodeSystem: 'B' });
    expect(eff.params.variants).toEqual({ gcodeSystem: 'B', incrementalAddresses: 'uw', toolWord: 'byLength' });
    expect(eff.source.variants.toolWord).toBe('profile');
    expect(eff.source.variants.incrementalAddresses).toBe('profile');
  });
});

// ---------------------------------------------------------------------------
// 3. Each choice
// ---------------------------------------------------------------------------

describe('incrementalAddresses', () => {
  it.each([
    ['uw', { U: 'X', W: 'Z' }, ['X', 'U']],
    ['uwvh', { U: 'X', W: 'Z', V: 'Y', H: 'C' }, ['X', 'U']],
    ['none', undefined, ['X']],
  ] as const)('%s', (choice, incremental, diameter) => {
    const addresses = effective(LATHE, { incrementalAddresses: choice }).profile.addresses;
    expect(addresses.incremental).toEqual(incremental);
    expect(addresses.diameter).toEqual(diameter);
    // The axes stay: `U` and `W` are still words of the program, only no longer twins.
    expect(addresses.axes).toEqual(['X', 'Z', 'C', 'Y', 'U', 'W']);
  });

  it('is independent of the G-code system', () => {
    for (const system of ['A', 'B']) {
      expect(effective(LATHE, { gcodeSystem: system, incrementalAddresses: 'none' }).profile.addresses.incremental).toBeUndefined();
      expect(effective(LATHE, { gcodeSystem: system }).profile.addresses.incremental).toEqual({ U: 'X', W: 'Z' });
    }
  });
});

interface WordTable {
  [profile: string]: Record<string, Record<string, string | null>>;
}
const WORDS = JSON.parse(readFileSync(`${FILES}r6-tool-words.json`, 'utf8')) as WordTable;

/** What the effective tool rule makes of a line: the tool, or null for no tool change. */
function toolOf(cp: CompiledProfile, word: string): string | null {
  const line = word;
  if (!cp.re.toolTrigger.test(line)) return null;
  if (cp.re.toolIgnore?.test(line)) return null;
  return cp.re.tool.exec(line)?.groups?.tool ?? null;
}

describe('toolWord: a word under each choice (r6-tool-words.json, read by Python as well)', () => {
  for (const [id, choices] of Object.entries(WORDS).filter(([key]) => key !== 'about')) {
    for (const [choice, words] of Object.entries(choices)) {
      it.each(Object.entries(words))(`${id} ${choice}: %s`, (word, tool) => {
        expect(toolOf(effective(id, { toolWord: choice }), word)).toBe(tool);
      });
    }
  }

  it('reads one word three ways on the Fanuc lathe', () => {
    // T1001: tool 10 offset 01, tool 100 offset 1, tool 1 offset 001.
    expect(toolOf(effective(LATHE, { toolWord: 'byLength' }), 'T1001')).toBe('10');
    expect(toolOf(effective(LATHE, { toolWord: 'offset2' }), 'T1001')).toBe('10');
    expect(toolOf(effective(LATHE, { toolWord: 'offset1' }), 'T1001')).toBe('100');
    expect(toolOf(effective(LATHE, { toolWord: 'offset3' }), 'T1001')).toBe('1');
  });

  it('reads a five-digit word 2 + 3 by length, 3 + 2 under offset2 and 2 + 3 under offset3', () => {
    // M12.5 decision 1: the length decides with no machine; a machine states its split.
    expect(toolOf(effective(LATHE), 'T12012')).toBe('12');
    expect(toolOf(effective(LATHE, { toolWord: 'offset2' }), 'T12345')).toBe('123');
    expect(toolOf(effective(LATHE, { toolWord: 'offset3' }), 'T01001')).toBe('01');
    // …and only offset3 reads a four-digit word as tool 0, which is why it is no default; a
    // tool 0 is no tool, so the word changes nothing there (M12.5 review).
    expect(toolOf(effective(LATHE), 'T0101')).toBe('01');
    expect(toolOf(effective(LATHE, { toolWord: 'offset3' }), 'T0101')).toBeNull();
  });

  it('loads a zero-offset word with M6 and reads no tool in a three-digit G block, on every choice', () => {
    const cases: Record<string, [string, string][]> = {
      byLength: [['M06 T21000', '21'], ['T0100 M6', '01']],
      offset2: [['M06 T21000', '210'], ['T0100 M6', '01']],
      offset1: [['M06 T2100', '210'], ['T10 M6', '1']],
      offset3: [['M06 T21000', '21'], ['T1000 M6', '1']],
    };
    for (const [choice, words] of Object.entries(cases)) {
      const cp = effective(LATHE, { toolWord: choice });
      for (const [line, tool] of words) {
        expect(toolOf(cp, line), `${choice}: ${line}`).toBe(tool);
        expect(toolOf(cp, line.replace(/\s*M0?6\s*/, ' ').trim()), `${choice}: ${line} without M6`).toBeNull();
      }
      expect(toolOf(cp, 'T0 M6'), choice).toBeNull();
      expect(toolOf(cp, 'G183 Z-5. T5 F20'), choice).toBeNull();
      expect(toolOf(cp, 'G150 X10. T11'), choice).toBeNull();
    }
  });

  it('reads T2000 on Okuma as station 2 only with three-digit offsets', () => {
    expect(toolOf(effective(OKUMA, { toolWord: 'offset2' }), 'T2000')).toBe('20');
    expect(toolOf(effective(OKUMA, { toolWord: 'offset3' }), 'T2000')).toBe('2');
  });

  it('keeps an Okuma cycle block out of the tool list under both choices', () => {
    for (const choice of ['offset2', 'offset3']) {
      const cp = effective(OKUMA, { toolWord: choice });
      expect(toolOf(cp, choice === 'offset2' ? 'G71 U1. R0.5 T0405' : 'G71 U1. R0.5 T1405')).toBeNull();
      expect(toolOf(cp, 'G181 T0405')).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 3b. The program map under each choice
// ---------------------------------------------------------------------------

const PROGRAMS: Record<string, Record<string, string[]>> = {
  [LATHE]: {
    byLength: [
      'O2100',
      'N10 G50 S3000',
      'N20 T12000 M6 (MILL SPINDLE)',
      'N30 T12012 (OD ROUGH)',
      'N40 G28 U0 T0100',
      'N50 T0101 (OD FINISH)',
      'N60 G183 Z-5. T5 F20',
      'N70 T0505',
      'N80 M30',
    ],
    offset1: ['O2101', 'T11 (OD ROUGH)', 'G0 X50. Z2.', 'G1 Z-20. F0.2', 'T10', 'T22 (OD FINISH)', 'G0 X40. Z1.', 'T123', 'M30'],
    offset2: ['O2102', 'T0101 (OD ROUGH)', 'G0 X50. Z2.', 'G1 Z-20. F0.2', 'T0100', 'T0303 (OD FINISH)', 'G0 X40. Z1.', 'T12345', 'M30'],
    offset3: ['O2103', 'T1001 (OD ROUGH)', 'G0 X50. Z2.', 'G1 Z-20. F0.2', 'T1000', 'T3003 (OD FINISH)', 'G0 X40. Z1.', 'T123456', 'M30'],
  },
  [OKUMA]: {
    offset2: ['O0102', 'G00 T0101', 'G00 X50. Z2.', 'G71 U1. R0.5 T0405', 'T010203', 'G00 T0001', 'T2000', 'M02'],
    offset3: ['O0103', 'G00 T1001', 'G00 X50. Z2.', 'G71 U1. R0.5 T1405', 'T0102003', 'G00 T0001', 'T2000', 'M02'],
  },
};

describe('the program map under each choice', () => {
  for (const [id, byChoice] of Object.entries(PROGRAMS)) {
    for (const [choice, program] of Object.entries(byChoice)) {
      it(`${id} ${choice}`, async () => {
        const cp = effective(id, { toolWord: choice });
        const index = new OutlineIndex(cp);
        index.reset(program);
        const rows = index
          .items()
          .flatMap((item) => [item, ...(item.children ?? [])])
          .map(({ children: _children, ...own }) => `    ${JSON.stringify(own)}`);
        const text =
          `{\n  "profile": ${JSON.stringify(id)},\n  "variants": ${JSON.stringify({ toolWord: choice })},\n` +
          `  "program": ${JSON.stringify(program)},\n  "items": [\n${rows.join(',\n')}\n  ]\n}\n`;
        const folder = id === OKUMA ? 'okuma' : id;
        await expect(text).toMatchFileSnapshot(`${GOLDENS}${folder}/variants/toolWord-${choice}.json`);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 4. The sample machines
// ---------------------------------------------------------------------------

describe('r6-variants.json: the Machines page can store every choice', () => {
  const file = parseMachinesFile(JSON.parse(readFileSync(`${FILES}r6-variants.json`, 'utf8')));

  it('reads five machines and no problem', () => {
    expect(file.error).toBeNull();
    expect(file.invalid).toEqual([]);
    expect(file.machines.map((m) => m.id)).toEqual([
      'lathe-u-w-only',
      'lathe-u-w-v-h',
      'lathe-g91-only',
      'okuma-200-offsets',
      'okuma-64-offsets',
    ]);
  });

  it.each(['lathe-u-w-only', 'lathe-u-w-v-h', 'lathe-g91-only', 'okuma-200-offsets', 'okuma-64-offsets'])(
    '%s is usable and gives a valid effective profile',
    (machineId) => {
      const machine = file.machines.find((m) => m.id === machineId) as MachineConfig;
      const p = profile(machine.profile);
      expect(validateMachine(machine, { path: `machines[${machineId}]`, profile: p })).toEqual([]);
      const eff = effectiveMachine(p, machine, 'document', {});
      for (const [variant, value] of Object.entries(machine.params.variants ?? {})) {
        expect(eff.params.variants[variant]).toBe(value);
        expect(eff.source.variants[variant]).toBe('machine');
      }
      const checked = validateProfile(applyMachine(p, eff).profile, { applied: true });
      expect(checked.ok).toBe(true);
    },
  );

  it('refuses a value the declaration does not offer', () => {
    const p = profile(LATHE);
    const bad: MachineConfig = {
      id: 'bad',
      name: 'bad',
      profile: LATHE,
      params: { variants: { toolWord: 'offset4', incrementalAddresses: 'vh' } },
    };
    const problems = validateMachine(bad, { path: 'machines[0]', profile: p });
    expect(problems.map((x) => x.path)).toEqual([
      'machines[0].params.variants.toolWord',
      'machines[0].params.variants.incrementalAddresses',
    ]);
    // …and Okuma has no `offset1`.
    const okuma: MachineConfig = { id: 'o', name: 'o', profile: OKUMA, params: { variants: { toolWord: 'offset1' } } };
    expect(validateMachine(okuma, { path: 'machines[0]', profile: profile(OKUMA) })).toHaveLength(1);
  });
});
