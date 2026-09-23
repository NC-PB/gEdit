// The machine dialog's fields, and the one-line summary of an effective machine
// (plan §7.15 "Dialog fields", AD-31 "Management" and "Selection UI"). Owner: WP6.10.
//
// Everything here is **generated from the profile's declaration** (`machineParams`, §8.8).
// No dialect is named, no preset is spelled out and no variant is known to this file: a
// profile that declares another unit table or another G-code system gets its form for
// free, and G10 reviews the data rather than this code.
//
// Three rules the form lives by:
//
//  1. **Only existing `FieldType`s** (F46): `text`, `choice` and `bool`. The page renders
//     them with the same `FormRenderer` every other generated form uses, so there is one
//     form engine in the app and no machine-shaped control anywhere.
//  2. **A value the form cannot express is kept, not dropped.** A `numberInput` written by
//     hand that matches no preset shows as "Custom (edited in the file)" and survives an
//     edit of the name; so do a `channels` block (M10) and any member a later version adds.
//     `machineFromValues` starts from the stored parameters and overwrites only what the
//     form actually offered.
//  3. **Nothing is corrected silently.** `pruneModalValues` is the one place a value is
//     taken away — when the user switches to a G-code system whose database does not have
//     that code at all — and it hands back what it dropped so the page can say so.
//
// Labels: the field titles are UI strings and go through `t()`; preset labels, variant
// labels, code labels and machine names are **data** and stay as the JSON has them (AD-14).

import { hasKey, t } from '$lib/i18n';
import type { CodeDb, CodeEntry } from '$lib/core/codes/types';
import type { FieldChoice, FieldSpec } from '$lib/core/forms/types';
import type { MachineParamsDecl, NumberInputPreset, VariantDecl } from '$lib/core/profiles/types';
import type { EffectiveMachine, MachineConfig, MachineParams, NumberInput, ParamSource } from './types';

/** Field ids. They are stable: the runtime scenarios read `data-field` (§7.9). */
export const FIELD_NAME = 'name';
export const FIELD_NUMBER_INPUT = 'numberInput';
export const FIELD_UNITS = 'units';
export const FIELD_DIAMETER = 'diameter';
export const FIELD_NOTES = 'notes';
/** `variant.<id>` and `modal.<group>`, so one flat values record holds the whole machine. */
export const VARIANT_PREFIX = 'variant.';
export const MODAL_PREFIX = 'modal.';

/** The `numberInput` choice for a stored value that matches no preset (§7.15). */
export const CUSTOM_PRESET = 'custom';
/** The `choice` value that means "leave it to the profile" for a modal group. */
export const PROFILE_DEFAULT = '';

export function variantFieldId(id: string): string {
  return `${VARIANT_PREFIX}${id}`;
}

export function modalFieldId(group: string): string {
  return `${MODAL_PREFIX}${group}`;
}

/** The variant id of `variant.<id>`, or null for any other field. */
export function variantIdOf(fieldId: string): string | null {
  return fieldId.startsWith(VARIANT_PREFIX) ? fieldId.slice(VARIANT_PREFIX.length) : null;
}

/** The modal group of `modal.<group>`, or null for any other field. */
export function modalGroupOf(fieldId: string): string | null {
  return fieldId.startsWith(MODAL_PREFIX) ? fieldId.slice(MODAL_PREFIX.length) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON with object keys sorted, so two equal number rules give one string. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    const parts = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const presetsOf = (decl: MachineParamsDecl | undefined): NumberInputPreset[] =>
  Array.isArray(decl?.numberInput?.presets) ? decl.numberInput.presets : [];

const variantsOf = (decl: MachineParamsDecl | undefined): VariantDecl[] =>
  Array.isArray(decl?.variants) ? decl.variants : [];

const groupsOf = (decl: MachineParamsDecl | undefined): string[] =>
  Array.isArray(decl?.modalGroups) ? decl.modalGroups : [];

/** The preset whose rules are exactly `value`, or null — which is what "Custom" means. */
export function presetOf(
  decl: MachineParamsDecl | undefined,
  value: NumberInput | null | undefined,
): NumberInputPreset | null {
  if (!isRecord(value)) return null;
  const wanted = canonical(value);
  return presetsOf(decl).find((preset) => canonical(preset?.value) === wanted) ?? null;
}

/** The preset id a machine's stored rules amount to: a preset, `custom`, or the default. */
export function presetIdOf(decl: MachineParamsDecl | undefined, current?: MachineConfig): string {
  const stored = current?.params?.numberInput;
  if (isRecord(stored)) return presetOf(decl, stored)?.id ?? CUSTOM_PRESET;
  const declared = decl?.numberInput;
  if (declared === undefined) return '';
  const presets = presetsOf(decl);
  return presets.some((preset) => preset?.id === declared.default) ? declared.default : (presets[0]?.id ?? '');
}

/** The label of a modal group: a word we have for it, else the group's own name. */
export function groupLabel(group: string): string {
  const key = `machines.groups.${group}`;
  return hasKey(key) ? t(key) : t('machines.param.modal', { group });
}

/** The power-on codes a machine may pick for `group`: the database's modal entries. */
export function groupCodes(codes: CodeDb | undefined, group: string): CodeEntry[] {
  const list = Array.isArray(codes?.codes) ? codes.codes : [];
  return list.filter((entry) => entry?.modal === true && entry.group === group);
}

/** `G95 — Feed per revolution`; both halves are data (AD-14). */
function codeChoice(entry: CodeEntry): FieldChoice {
  return { label: `${entry.code} — ${entry.label}`, value: entry.code };
}

/**
 * The form for one machine of a profile that declares `decl`, over the code database
 * `codes` the machine's **currently chosen** variant names — that is what decides which
 * power-on codes exist (Fanuc system A has `G98`/`G99` as feed modes, system B has
 * `G94`/`G95` and reads `G98`/`G99` as cycle-return codes).
 *
 * `current` is the machine being edited; without it the fields are a new machine's.
 */
export function machineFields(
  decl: MachineParamsDecl,
  codes: CodeDb,
  current?: MachineConfig,
): FieldSpec[] {
  const fields: FieldSpec[] = [
    {
      id: FIELD_NAME,
      type: 'text',
      label: t('machines.param.name'),
      help: t('machines.param.nameHelp'),
      required: true,
      default: current?.name ?? '',
    },
  ];

  const presets = presetsOf(decl);
  if (decl.numberInput !== undefined && presets.length > 0) {
    const choices: FieldChoice[] = presets.map((preset) => ({ label: preset.label, value: preset.id }));
    const chosen = presetIdOf(decl, current);
    if (chosen === CUSTOM_PRESET) {
      choices.push({ label: t('machines.value.custom'), value: CUSTOM_PRESET });
    }
    fields.push({
      id: FIELD_NUMBER_INPUT,
      type: 'choice',
      label: t('machines.param.numberInput'),
      help:
        chosen === CUSTOM_PRESET
          ? t('machines.value.customDetail')
          : t('machines.param.numberInputHelp'),
      choices,
      default: chosen,
    });
  }

  fields.push({
    id: FIELD_UNITS,
    type: 'choice',
    label: t('machines.param.units'),
    help: t('machines.param.unitsHelp'),
    choices: [
      { label: t('machines.value.mm'), value: 'mm' },
      { label: t('machines.value.inch'), value: 'inch' },
    ],
    default: current?.params?.units ?? decl.units ?? 'mm',
  });

  if (decl.diameter !== undefined) {
    fields.push({
      id: FIELD_DIAMETER,
      type: 'bool',
      label: t('machines.param.diameter'),
      help: t('machines.param.diameterHelp'),
      default: (current?.params?.diameter ?? decl.diameter) === 'on',
    });
  }

  for (const variant of variantsOf(decl)) {
    if (typeof variant?.id !== 'string' || variant.id === '') continue;
    const choices = (Array.isArray(variant.choices) ? variant.choices : [])
      .filter((choice) => typeof choice?.value === 'string')
      .map((choice) => ({ label: choice.label ?? choice.value, value: choice.value }));
    if (choices.length === 0) continue;
    const stored = current?.params?.variants?.[variant.id];
    const chosen = choices.some((choice) => choice.value === stored) ? (stored as string) : variant.default;
    fields.push({
      id: variantFieldId(variant.id),
      type: 'choice',
      // The variant's label is data ('G-code system'), like its choices.
      label: variant.label,
      choices,
      default: choices.some((choice) => choice.value === chosen) ? chosen : choices[0].value,
    });
  }

  for (const group of groupsOf(decl)) {
    if (typeof group !== 'string' || group === '') continue;
    const entries = groupCodes(codes, group);
    if (entries.length === 0) continue;
    const stored = current?.params?.modalInitial?.[group];
    fields.push({
      id: modalFieldId(group),
      type: 'choice',
      label: groupLabel(group),
      help: t('machines.param.modalHelp'),
      choices: [
        { label: t('machines.value.profileDefault'), value: PROFILE_DEFAULT },
        ...entries.map(codeChoice),
      ],
      default: entries.some((entry) => entry.code === stored) ? (stored as string) : PROFILE_DEFAULT,
    });
  }

  fields.push({
    id: FIELD_NOTES,
    type: 'text',
    label: t('machines.param.notes'),
    help: t('machines.param.notesHelp'),
    default: current?.notes ?? '',
  });

  return fields;
}

/**
 * The machine the form describes. It starts from the stored parameters, so a `channels`
 * block (M10), a per-class number rule written by hand and any member a later version adds
 * survive an edit of the name; only what the form offered is overwritten.
 */
export function machineFromValues(
  decl: MachineParamsDecl,
  values: Record<string, unknown>,
  current?: MachineConfig,
): { name: string; notes: string; params: Partial<MachineParams> } {
  const params: Partial<MachineParams> = current?.params ? clone(current.params) : {};

  const presetId = values[FIELD_NUMBER_INPUT];
  if (typeof presetId === 'string' && presetId !== '' && presetId !== CUSTOM_PRESET) {
    const preset = presetsOf(decl).find((entry) => entry?.id === presetId);
    // The machine stores the **whole** rule set of the preset it was given, so a later
    // change to the profile's preset data never changes a machine under the user's hands.
    if (preset?.value) params.numberInput = clone(preset.value);
  }

  const units = values[FIELD_UNITS];
  if (units === 'mm' || units === 'inch') params.units = units;

  if (decl.diameter !== undefined) {
    const diameter = values[FIELD_DIAMETER];
    if (typeof diameter === 'boolean') params.diameter = diameter ? 'on' : 'off';
  }

  const variants: Record<string, string> = { ...(params.variants ?? {}) };
  for (const variant of variantsOf(decl)) {
    if (typeof variant?.id !== 'string' || variant.id === '') continue;
    const value = values[variantFieldId(variant.id)];
    if (typeof value === 'string' && value !== '') variants[variant.id] = value;
  }
  if (Object.keys(variants).length > 0) params.variants = variants;

  const modalInitial: Record<string, string> = { ...(params.modalInitial ?? {}) };
  for (const group of groupsOf(decl)) {
    if (typeof group !== 'string' || group === '') continue;
    const value = values[modalFieldId(group)];
    if (typeof value === 'string' && value !== PROFILE_DEFAULT) modalInitial[group] = value;
    else delete modalInitial[group];
  }
  if (Object.keys(modalInitial).length > 0) params.modalInitial = modalInitial;
  else delete params.modalInitial;

  const name = typeof values[FIELD_NAME] === 'string' ? (values[FIELD_NAME] as string).trim() : '';
  const notes = typeof values[FIELD_NOTES] === 'string' ? (values[FIELD_NOTES] as string).trim() : '';
  return { name, notes, params };
}

/**
 * Power-on codes the rebuilt form no longer offers, reset to "dialect default" **in
 * place**, and handed back so the caller can say what it took away.
 *
 * It happens when the user switches the G-code system while a power-on code of the old
 * system is set: `G99` is a feed mode in system A and a cycle-return code in system B, and
 * keeping it would set a feed mode no code of the machine's own database can produce.
 */
export function pruneModalValues(
  values: Record<string, unknown>,
  fields: readonly FieldSpec[],
): string[] {
  const dropped: string[] = [];
  for (const field of fields) {
    if (modalGroupOf(field.id) === null) continue;
    const value = values[field.id];
    if (typeof value !== 'string' || value === PROFILE_DEFAULT) continue;
    if ((field.choices ?? []).some((choice) => choice.value === value)) continue;
    values[field.id] = PROFILE_DEFAULT;
    dropped.push(value);
  }
  return dropped;
}

/** 'set by the machine' / 'detected in this program' / 'dialect default, assumed'. */
export function sourceLabel(source: ParamSource): string {
  switch (source) {
    case 'machine':
      return t('machines.source.machine');
    case 'detected':
      return t('machines.source.detected');
    default:
      return t('machines.source.profile');
  }
}

/** `How the control reads numbers: … — set by the machine`. */
function line(label: string, value: string, source: ParamSource): string {
  return `${label}: ${value} — ${sourceLabel(source)}`;
}

/**
 * Every effective parameter with its source, one line each — the status item's tooltip
 * (AD-31 "Selection UI").
 *
 * The point of the list is that a value can be **checked**: "feed per revolution" alone
 * tells nobody whether the control really powers up that way or gEdit guessed it from the
 * dialect's documentation.
 *
 * `initial` is the **dialect's** own power-on state (`profile.modal.initial`), and it is
 * what makes that promise true of the assumption that matters most. `params.modalInitial`
 * holds only what a machine sets, so a document with no machine — where every group is
 * assumed — listed number input, units, diameter and the G-code system and said nothing
 * at all about the assumed `G99` that decides whether every `F` of the program is read per
 * revolution or per minute (G8 M6). A group the machine sets shadows the dialect's, and
 * the source column tells the two apart.
 */
export function machineSummaryLines(
  eff: EffectiveMachine,
  decl: MachineParamsDecl | undefined,
  initial?: Readonly<Record<string, string>>,
): string[] {
  const lines: string[] = [];
  const params = eff.params;

  if (decl?.numberInput !== undefined) {
    const preset = presetOf(decl, params.numberInput);
    lines.push(
      line(
        t('machines.param.numberInput'),
        preset?.label ?? t('machines.value.custom'),
        eff.source.numberInput,
      ),
    );
  }
  lines.push(
    line(
      t('machines.param.units'),
      params.units === 'inch' ? t('machines.value.inch') : t('machines.value.mm'),
      eff.source.units,
    ),
  );
  if (params.diameter !== null) {
    lines.push(
      line(
        t('machines.param.diameter'),
        params.diameter === 'on' ? t('machines.value.on') : t('machines.value.off'),
        eff.source.diameter,
      ),
    );
  }
  for (const variant of variantsOf(decl)) {
    if (typeof variant?.id !== 'string') continue;
    const value = params.variants[variant.id];
    if (value === undefined) continue;
    const choice = (Array.isArray(variant.choices) ? variant.choices : []).find(
      (entry) => entry?.value === value,
    );
    lines.push(line(variant.label, choice?.label ?? value, eff.source.variants[variant.id] ?? 'profile'));
  }
  // The groups the dialect offers, in its own order, with what the machine says over it.
  const modal: Record<string, string> = { ...(initial ?? {}), ...params.modalInitial };
  for (const [group, code] of Object.entries(modal)) {
    lines.push(line(groupLabel(group), code, eff.source.modalInitial[group] ?? 'profile'));
  }
  return lines;
}

/** The tooltip of the status item: the machine, its parameters and what a click does. */
export function machineTooltip(
  eff: EffectiveMachine,
  decl: MachineParamsDecl | undefined,
  initial?: Readonly<Record<string, string>>,
): string {
  const head =
    eff.name === null ? t('machines.tooltip.none') : t('machines.tooltip.machine', { name: eff.name });
  return [head, ...machineSummaryLines(eff, decl, initial), t('machines.tooltip.hint')].join('\n');
}
