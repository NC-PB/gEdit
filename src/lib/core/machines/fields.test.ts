// The machine dialog's fields and the status item's summary (plan §7.15, AD-31; WP6.10).
//
// The fields are generated from the profile's own declaration, so the tests run against
// the **built-in declarations** rather than a hand-written one: a preset or a variant that
// WP6.2 adds to the data has to arrive in the form without a line of code here.
//
// Three properties matter more than the shape of any single field:
//   - only `text`, `choice` and `bool` are used (F46: no new `FieldType`);
//   - a number rule the form cannot express survives an edit ("Custom", §7.15);
//   - a power-on code is only ever offered when the chosen database really has it, and
//     taking one away hands it back so the page can say so (AD-31).

import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PRESET,
  FIELD_DIAMETER,
  FIELD_NAME,
  FIELD_NOTES,
  FIELD_NUMBER_INPUT,
  FIELD_UNITS,
  PROFILE_DEFAULT,
  groupCodes,
  machineFields,
  machineFromValues,
  machineSummaryLines,
  machineTooltip,
  modalFieldId,
  modalGroupOf,
  presetIdOf,
  presetOf,
  pruneModalValues,
  variantFieldId,
  variantIdOf,
} from './fields';
import { effectiveMachine, noMachine } from './effective';
import { codes } from '$lib/stores/codes';
import { profiles } from '$lib/stores/profiles';
import { initialValues } from '$lib/core/forms/values';
import { validateFields } from '$lib/core/forms/validate';
import type { FieldSpec } from '$lib/core/forms/types';
import type { MachineConfig, NumberInput } from './types';
import type { MachineParamsDecl } from '$lib/core/profiles/types';

/** The profiles that declare machine parameters, which is what the page offers. */
const WITH_PARAMS = profiles.list().filter((info) => info.hasMachineParams);

const declOf = (id: string): MachineParamsDecl => {
  const decl = profiles.profile(id).machineParams;
  if (decl === undefined) throw new Error(`${id} declares no machine parameters`);
  return decl;
};

const dbOf = (id: string) => codes.byId(profiles.profile(id).codes);

const byId = (fields: FieldSpec[], id: string): FieldSpec | undefined =>
  fields.find((field) => field.id === id);

function machine(over: Partial<MachineConfig> = {}): MachineConfig {
  return {
    id: 'lathe-2',
    name: 'Lathe 2',
    profile: 'fanuc-lathe',
    params: {},
    ...over,
  };
}

describe('machineFields over every built-in declaration', () => {
  it('finds at least the mill and the lathe', () => {
    expect(WITH_PARAMS.map((info) => info.id)).toContain('fanuc-gcode');
    expect(WITH_PARAMS.map((info) => info.id)).toContain('fanuc-lathe');
  });

  for (const info of WITH_PARAMS) {
    describe(info.id, () => {
      const fields = machineFields(declOf(info.id), dbOf(info.id));

      it('uses only the field types §7.5 already has (F46)', () => {
        for (const field of fields) expect(['text', 'choice', 'bool']).toContain(field.type);
      });

      it('asks for a name first and for notes last', () => {
        expect(fields[0].id).toBe(FIELD_NAME);
        expect(fields[0].required).toBe(true);
        expect(fields[fields.length - 1].id).toBe(FIELD_NOTES);
      });

      it('gives every field a label and every choice field its options', () => {
        for (const field of fields) {
          expect(field.label).not.toBe('');
          if (field.type === 'choice') expect((field.choices ?? []).length).toBeGreaterThan(0);
        }
      });

      it('starts from values that only lack the name the user has to type', () => {
        const values = initialValues(fields);
        expect(validateFields(fields, values)).toEqual({ [FIELD_NAME]: { key: 'forms.errors.required' } });
        expect(validateFields(fields, { ...values, [FIELD_NAME]: 'Machine 1' })).toEqual({});
      });

      it('offers one choice per declared preset', () => {
        const declared = declOf(info.id).numberInput;
        if (declared === undefined) {
          expect(byId(fields, FIELD_NUMBER_INPUT)).toBeUndefined();
          return;
        }
        const field = byId(fields, FIELD_NUMBER_INPUT);
        expect(field?.choices?.map((choice) => choice.value)).toEqual(
          declared.presets.map((preset) => preset.id),
        );
        // The label says what the preset does to a number; it is data, not a key.
        expect(field?.choices?.every((choice) => choice.label.length > 10)).toBe(true);
        expect(field?.default).toBe(declared.default);
      });

      it('offers the units, and the diameter only where it is a parameter', () => {
        expect(byId(fields, FIELD_UNITS)?.choices?.map((c) => c.value)).toEqual(['mm', 'inch']);
        expect(byId(fields, FIELD_DIAMETER) !== undefined).toBe(
          declOf(info.id).diameter !== undefined,
        );
      });

      it('offers one choice per variant and per modal group the database has codes for', () => {
        const decl = declOf(info.id);
        for (const variant of decl.variants ?? []) {
          const field = byId(fields, variantFieldId(variant.id));
          expect(field?.type).toBe('choice');
          expect(field?.choices?.map((choice) => choice.value)).toEqual(
            variant.choices.map((choice) => choice.value),
          );
          expect(field?.default).toBe(variant.default);
        }
        for (const group of decl.modalGroups ?? []) {
          const field = byId(fields, modalFieldId(group));
          const entries = groupCodes(dbOf(info.id), group);
          if (entries.length === 0) {
            expect(field).toBeUndefined();
            continue;
          }
          // "Dialect default" first, then the group's codes, and nothing else.
          expect(field?.choices?.map((choice) => choice.value)).toEqual([
            PROFILE_DEFAULT,
            ...entries.map((entry) => entry.code),
          ]);
          expect(field?.default).toBe(PROFILE_DEFAULT);
        }
      });
    });
  }
});

describe('the lathe, whose form is the one M6 ships for', () => {
  const decl = declOf('fanuc-lathe');
  const dbA = codes.byId('fanuc-lathe');
  const dbB = codes.byId('fanuc-lathe-b');

  it('offers the feed modes of the G-code system the database belongs to', () => {
    const inA = byId(machineFields(decl, dbA), modalFieldId('feedmode'))?.choices?.map((c) => c.value);
    const inB = byId(machineFields(decl, dbB), modalFieldId('feedmode'))?.choices?.map((c) => c.value);
    // System A reads G98/G99 as the feed modes; in system B they are cycle-return codes
    // and G95 is the feed per revolution. Offering B's list to an A machine would set a
    // power-on feed mode no code of A's own database can produce.
    expect(inA).toContain('G99');
    expect(inB).not.toContain('G99');
    expect(inB).toContain('G95');
    // Every list starts with "Dialect default", and every entry is a modal code.
    expect(inA?.[0]).toBe(PROFILE_DEFAULT);
    expect(inB?.[0]).toBe(PROFILE_DEFAULT);
  });

  it('shows the diameter parameter, the G-code system and the stored values of a machine', () => {
    const current = machine({
      params: {
        diameter: 'off',
        variants: { gcodeSystem: 'B' },
        modalInitial: { feedmode: 'G95' },
        units: 'inch',
      },
    });
    const fields = machineFields(decl, dbB, current);
    expect(byId(fields, FIELD_NAME)?.default).toBe('Lathe 2');
    expect(byId(fields, FIELD_DIAMETER)?.default).toBe(false);
    expect(byId(fields, FIELD_UNITS)?.default).toBe('inch');
    expect(byId(fields, variantFieldId('gcodeSystem'))?.default).toBe('B');
    expect(byId(fields, modalFieldId('feedmode'))?.default).toBe('G95');
  });

  it('ignores a stored variant or power-on code the declaration does not know', () => {
    const current = machine({
      params: { variants: { gcodeSystem: 'C' }, modalInitial: { feedmode: 'G99' } },
    });
    const fields = machineFields(decl, dbB, current);
    expect(byId(fields, variantFieldId('gcodeSystem'))?.default).toBe('A');
    // `G99` is no feed mode of system B's database, so the form does not claim it is set.
    expect(byId(fields, modalFieldId('feedmode'))?.default).toBe(PROFILE_DEFAULT);
  });
});

describe('a number rule the form cannot express', () => {
  const decl = declOf('fanuc-lathe');
  const handEdited: NumberInput = {
    mode: 'increment',
    incrementMm: '0.001',
    classes: { feedPerRev: { mode: 'calculator' }, length: { increment: '0.002' } },
  };

  it('is recognised as custom rather than as a preset', () => {
    expect(presetOf(decl, handEdited)).toBeNull();
    expect(presetIdOf(decl, machine({ params: { numberInput: handEdited } }))).toBe(CUSTOM_PRESET);
  });

  it('is offered as "Custom (edited in the file)" and selected', () => {
    const fields = machineFields(decl, dbOf('fanuc-lathe'), machine({ params: { numberInput: handEdited } }));
    const field = byId(fields, FIELD_NUMBER_INPUT);
    expect(field?.choices?.map((choice) => choice.value)).toContain(CUSTOM_PRESET);
    expect(field?.default).toBe(CUSTOM_PRESET);
  });

  it('is kept when the form comes back with "custom" still selected', () => {
    const current = machine({ params: { numberInput: handEdited } });
    const fields = machineFields(decl, dbOf('fanuc-lathe'), current);
    const values = initialValues(fields);
    expect(machineFromValues(decl, values, current).params.numberInput).toEqual(handEdited);
  });

  it('is replaced, whole, as soon as a preset is picked', () => {
    const current = machine({ params: { numberInput: handEdited } });
    const fields = machineFields(decl, dbOf('fanuc-lathe'), current);
    const values = { ...initialValues(fields), [FIELD_NUMBER_INPUT]: 'is-b' };
    const preset = (decl.numberInput?.presets ?? []).find((entry) => entry.id === 'is-b');
    // The machine stores the preset's whole rule set, not a reference to it (§7.15).
    expect(machineFromValues(decl, values, current).params.numberInput).toEqual(preset?.value);
  });

  it('is not offered as a choice for a machine that has no such rules', () => {
    const fields = machineFields(decl, dbOf('fanuc-lathe'));
    expect(byId(fields, FIELD_NUMBER_INPUT)?.choices?.map((c) => c.value)).not.toContain(CUSTOM_PRESET);
  });
});

describe('machineFromValues', () => {
  const decl = declOf('fanuc-lathe');
  const fields = machineFields(decl, dbOf('fanuc-lathe'));
  const base = initialValues(fields);

  it('trims the name and the notes and keeps them apart from the parameters', () => {
    const built = machineFromValues(decl, { ...base, name: '  Lathe 2 ', notes: ' spindle 2 ' });
    expect(built.name).toBe('Lathe 2');
    expect(built.notes).toBe('spindle 2');
    expect(Object.keys(built.params)).not.toContain('name');
  });

  it('writes the units, the diameter and the chosen variant', () => {
    const built = machineFromValues(decl, {
      ...base,
      [FIELD_UNITS]: 'inch',
      [FIELD_DIAMETER]: false,
      [variantFieldId('gcodeSystem')]: 'B',
    });
    expect(built.params.units).toBe('inch');
    expect(built.params.diameter).toBe('off');
    expect(built.params.variants).toEqual({ gcodeSystem: 'B' });
  });

  it('leaves out a power-on group left at the dialect default, and drops one taken back', () => {
    const set = machineFromValues(decl, { ...base, [modalFieldId('feedmode')]: 'G99' });
    expect(set.params.modalInitial).toEqual({ feedmode: 'G99' });

    const current = machine({ params: { modalInitial: { feedmode: 'G99' } } });
    const cleared = machineFromValues(decl, { ...base, [modalFieldId('feedmode')]: PROFILE_DEFAULT }, current);
    expect(cleared.params.modalInitial).toBeUndefined();
  });

  it('keeps a member the form never showed', () => {
    // `channels` arrives in M10 (AD-32) and no field of M6 knows it; editing a name may
    // not delete it.
    const current = machine({
      params: { ...({ channels: { layout: 'none' } } as Record<string, unknown>) },
    });
    const built = machineFromValues(decl, { ...base, name: 'Renamed' }, current);
    expect((built.params as Record<string, unknown>).channels).toEqual({ layout: 'none' });
  });

  it('does not alias the record it was given', () => {
    const current = machine({ params: { variants: { gcodeSystem: 'A' } } });
    const built = machineFromValues(decl, { ...base, [variantFieldId('gcodeSystem')]: 'B' }, current);
    expect(built.params.variants).toEqual({ gcodeSystem: 'B' });
    expect(current.params.variants).toEqual({ gcodeSystem: 'A' });
  });
});

describe('pruneModalValues', () => {
  const decl = declOf('fanuc-lathe');

  it('takes back a power-on code the newly chosen database does not have, and says which', () => {
    const values: Record<string, unknown> = { [modalFieldId('feedmode')]: 'G99' };
    const dropped = pruneModalValues(values, machineFields(decl, codes.byId('fanuc-lathe-b')));
    expect(dropped).toEqual(['G99']);
    expect(values[modalFieldId('feedmode')]).toBe(PROFILE_DEFAULT);
  });

  it('leaves a code the new database still has', () => {
    const values: Record<string, unknown> = { [modalFieldId('feedmode')]: 'G94' };
    expect(pruneModalValues(values, machineFields(decl, codes.byId('fanuc-lathe-b')))).toEqual([]);
    expect(values[modalFieldId('feedmode')]).toBe('G94');
  });

  it('never touches a field that is not a power-on group', () => {
    const values: Record<string, unknown> = { [FIELD_NAME]: 'Lathe 2', [FIELD_UNITS]: 'inch' };
    expect(pruneModalValues(values, machineFields(decl, codes.byId('fanuc-lathe')))).toEqual([]);
    expect(values[FIELD_UNITS]).toBe('inch');
  });
});

describe('field ids', () => {
  it('say which variant and which group they belong to', () => {
    expect(variantIdOf(variantFieldId('gcodeSystem'))).toBe('gcodeSystem');
    expect(modalGroupOf(modalFieldId('feedmode'))).toBe('feedmode');
    expect(variantIdOf(FIELD_NAME)).toBeNull();
    expect(modalGroupOf(variantFieldId('gcodeSystem'))).toBeNull();
  });
});

describe('the summary the status item shows', () => {
  const profile = profiles.profile('fanuc-lathe');
  const decl = declOf('fanuc-lathe');

  it('names every parameter as assumed while no machine is chosen', () => {
    const lines = machineSummaryLines(noMachine(profile), decl);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(line).toContain('dialect default, assumed');
    expect(lines.join('\n')).toContain('G-code system A');
  });

  it('names the power-on state the dialect assumes, which is the F reading of the program', () => {
    // G8 M6. With no machine, `params.modalInitial` is empty and the summary said nothing
    // about the assumed `G99` — although a turning program that never writes a feed mode
    // has every one of its feeds read per revolution because of it. The dialect's own
    // `modal.initial` is handed in now, and each group carries its source.
    const none = machineSummaryLines(noMachine(profile), decl, profile.modal?.initial);
    expect(none).toContain('Feed mode at power-on: G99 — dialect default, assumed');
    expect(none).toContain('Spindle-speed mode at power-on: G97 — dialect default, assumed');
    expect(none).toContain('Plane at power-on: G18 — dialect default, assumed');

    // A machine that sets one of them shadows the dialect there and nowhere else.
    const eff = effectiveMachine(profile, machine({ params: { modalInitial: { feedmode: 'G98' } } }), 'document', {});
    const text = machineSummaryLines(eff, decl, profile.modal?.initial);
    expect(text).toContain('Feed mode at power-on: G98 — set by the machine');
    expect(text).toContain('Spindle-speed mode at power-on: G97 — dialect default, assumed');
    expect(text.filter((line) => line.startsWith('Feed mode at power-on'))).toHaveLength(1);
  });

  it('names the machine as the source of what the machine sets', () => {
    const eff = effectiveMachine(
      profile,
      machine({
        params: {
          units: 'inch',
          diameter: 'off',
          variants: { gcodeSystem: 'B' },
          modalInitial: { feedmode: 'G95' },
        },
      }),
      'document',
      {},
    );
    const text = machineSummaryLines(eff, decl).join('\n');
    expect(text).toContain('G-code system B — set by the machine');
    expect(text).toContain('Inches — set by the machine');
    expect(text).toContain('off — set by the machine');
    expect(text).toContain('G95 — set by the machine');
  });

  it('says when a variant was detected rather than chosen', () => {
    const eff = effectiveMachine(profile, null, 'none', { gcodeSystem: { value: 'B', margin: 4 } });
    expect(machineSummaryLines(eff, decl).join('\n')).toContain(
      'G-code system B — detected in this program',
    );
  });

  it('puts the machine, its parameters and what a click does into the tooltip', () => {
    const eff = effectiveMachine(profile, machine(), 'document', {});
    const tooltip = machineTooltip(eff, decl);
    expect(tooltip.split('\n')[0]).toBe('Machine: Lathe 2');
    expect(tooltip).toContain('Click to choose a machine.');
    expect(machineTooltip(noMachine(profile), decl)).toContain('No machine.');
  });

  it('answers for a dialect that declares nothing at all', () => {
    const klartext = profiles.profile('heidenhain-klartext');
    const lines = machineSummaryLines(noMachine(klartext), klartext.machineParams);
    // No number rules to show, but the units are still a value with a source.
    expect(lines.some((line) => line.includes('Millimetres'))).toBe(true);
  });
});
