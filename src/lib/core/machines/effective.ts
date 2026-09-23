// The effective machine of a document, as pure functions (plan §7.15, AD-31). Implemented
// by the M6 prelude (P6) because every Wave A work package builds on it; **WP6.8 owns it
// from Wave A on**.
//
// Four steps, and they are always in this order:
//
//   `defaultParams`     what the profile documents as its power-on behaviour
//   `effectiveMachine`  machine → detected variant → profile, per parameter, each with
//                       its source recorded next to it
//   `applyMachine`      the resolved profile with those parameters written into it, plus
//                       the code database the chosen variant names
//   `effectiveKey`      the cache key, so two machines with the same parameters share one
//                       compiled profile
//
// The rule the whole file exists for: **nothing is applied without saying where it came
// from.** `modal.sources` carries `machine`, `detected` or `profile` per modal group and
// for the units and the diameter mode, and the modal interpreter turns that into the
// `from` of every assumed value (AD-19 rule 8). A user who sees "feed per revolution
// (assumed, machine 'Lathe 2')" can check it; one who sees "feed per revolution" cannot.
//
// What this file may **not** do: decide anything itself. Which variants exist, which
// presets a machine may pick, which modal groups it may set — all of that is data in
// `profile.machineParams` (§8.8). No dialect is named here.

import { mergeProfile } from '$lib/core/profiles/resolve';
import type { MachineParamsDecl, Profile, ProfileOverlay, VariantDecl } from '$lib/core/profiles/types';
import type {
  EffectiveMachine,
  MachineConfig,
  MachineParams,
  NumberInput,
  ParamSource,
} from './types';

/** The members a variant overlay may touch (AD-31); anything else is dropped here and reported by WP6.1. */
const OVERLAY_FIELDS = ['modal', 'toolCall', 'numbering', 'addresses'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clone(entry)) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = clone(entry);
    return out as T;
  }
  return value;
}

/** The declared variants, or an empty list for a profile that has none. */
function variantsOf(decl: MachineParamsDecl | undefined): VariantDecl[] {
  const list = decl?.variants;
  return Array.isArray(list) ? list : [];
}

/** The `NumberInput` of the declaration's default preset, or null when none is declared. */
function defaultNumberInput(decl: MachineParamsDecl | undefined): NumberInput | null {
  const numberInput = decl?.numberInput;
  if (!numberInput || !Array.isArray(numberInput.presets)) return null;
  const preset =
    numberInput.presets.find((entry) => entry?.id === numberInput.default) ?? numberInput.presets[0];
  return preset?.value ? clone(preset.value) : null;
}

/**
 * What this profile assumes when no machine says otherwise (§8.8).
 *
 * For a profile without `machineParams` (Klartext) it is the profile's own JSON: no number
 * input to choose, no diameter parameter, and the units the profile states.
 */
export function defaultParams(p: Profile): MachineParams {
  const decl = p.machineParams;
  const variants: Record<string, string> = {};
  for (const variant of variantsOf(decl)) {
    if (typeof variant?.id === 'string' && typeof variant.default === 'string') {
      variants[variant.id] = variant.default;
    }
  }
  return {
    numberInput: defaultNumberInput(decl),
    units: decl?.units ?? p.modal?.units ?? 'mm',
    diameter: decl?.diameter ?? null,
    variants,
    // Only what a machine sets: the profile's own `modal.initial` stays in the profile,
    // where `applyMachine` merges a variant overlay into it first. Copying it in here
    // would let the "defaults" silently undo the overlay of a detected variant.
    modalInitial: {},
  };
}

/** The value a machine gives this variant, or undefined when it does not set it. */
function machineVariant(m: MachineConfig | null, id: string): string | undefined {
  const value = m?.params?.variants?.[id];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The effective machine of one document.
 *
 * `detected` is what the variant rules made of the document's text (`detectVariants`);
 * it is consulted **only when there is no machine**, because an explicit machine always
 * wins (AD-31). Detection still runs in that case, and a disagreement of margin ≥ 3 is
 * reported as `mismatch` — shown once, never acted on: gEdit does not switch a machine
 * setting because a program looks unusual.
 */
export function effectiveMachine(
  p: Profile,
  m: MachineConfig | null,
  choice: EffectiveMachine['choice'],
  detected: Record<string, { value: string; margin: number }>,
): EffectiveMachine {
  const decl = p.machineParams;
  const defaults = defaultParams(p);
  const params: MachineParams = { ...defaults, variants: { ...defaults.variants }, modalInitial: {} };
  const variantSources: Record<string, ParamSource> = {};
  let mismatch: EffectiveMachine['mismatch'] = null;

  for (const variant of variantsOf(decl)) {
    const id = variant?.id;
    if (typeof id !== 'string' || id === '') continue;
    const chosen = machineVariant(m, id);
    const found = detected[id];
    const sure = found !== undefined && found.margin >= 3 && choicesOf(variant).includes(found.value);

    if (chosen !== undefined && choicesOf(variant).includes(chosen)) {
      params.variants[id] = chosen;
      variantSources[id] = 'machine';
      if (sure && found.value !== chosen && mismatch === null) {
        mismatch = { variant: id, detected: found.value, chosen };
      }
    } else if (m === null && sure) {
      params.variants[id] = found.value;
      variantSources[id] = 'detected';
    } else {
      variantSources[id] = 'profile';
    }
  }

  const numberInput = m?.params?.numberInput;
  const hasNumberInput = decl?.numberInput !== undefined && isRecord(numberInput);
  if (hasNumberInput) params.numberInput = clone(numberInput as NumberInput);

  const units = m?.params?.units;
  const hasUnits = units === 'mm' || units === 'inch';
  if (hasUnits) params.units = units;

  const diameter = m?.params?.diameter;
  const hasDiameter = defaults.diameter !== null && (diameter === 'on' || diameter === 'off');
  if (hasDiameter) params.diameter = diameter as 'on' | 'off';

  const groups = decl?.modalGroups;
  const offered = new Set(Array.isArray(groups) ? groups : []);
  const modalSources: Record<string, ParamSource> = {};
  for (const [group, code] of Object.entries(m?.params?.modalInitial ?? {})) {
    if (typeof code !== 'string' || code === '' || !offered.has(group)) continue;
    params.modalInitial[group] = code;
    modalSources[group] = 'machine';
  }
  // Where a chosen variant's overlay sets the power-on state, the source is the variant's:
  // the user did not write `G95` anywhere, the G-code system did.
  for (const variant of variantsOf(decl)) {
    const id = variant?.id;
    if (typeof id !== 'string') continue;
    const overlay = choiceOf(variant, params.variants[id])?.overlay;
    for (const group of Object.keys(overlay?.modal?.initial ?? {})) {
      if (modalSources[group] === undefined) modalSources[group] = variantSources[id] ?? 'profile';
    }
  }
  for (const group of Object.keys(p.modal?.initial ?? {})) {
    if (modalSources[group] === undefined) modalSources[group] = 'profile';
  }

  const source: EffectiveMachine['source'] = {
    numberInput: hasNumberInput ? 'machine' : 'profile',
    units: hasUnits ? 'machine' : 'profile',
    diameter: hasDiameter ? 'machine' : 'profile',
    variants: variantSources,
    modalInitial: modalSources,
  };
  return {
    id: m?.id ?? null,
    name: m?.name ?? null,
    choice,
    params,
    source,
    key: effectiveKey(p.id, params, source),
    mismatch,
  };
}

/**
 * The effective machine of a document that has none: the profile's own defaults, every
 * source `profile`, no variant detected.
 *
 * It is what "Phase 1 behaviour" means in M6, and it is the honest answer for a document
 * nobody has chosen a machine for — `choice: 'none'` is what the status item shows as
 * assumed, and `source` is what a consumer checks before it converts a number (AD-31
 * "No machine, no guess").
 */
export function noMachine(p: Profile): EffectiveMachine {
  return effectiveMachine(p, null, 'none', {});
}

function choicesOf(variant: VariantDecl): string[] {
  const choices = variant?.choices;
  return (Array.isArray(choices) ? choices : [])
    .map((choice) => choice?.value)
    .filter((value): value is string => typeof value === 'string');
}

function choiceOf(variant: VariantDecl, value: string | undefined): VariantDecl['choices'][number] | undefined {
  const choices = variant?.choices;
  return (Array.isArray(choices) ? choices : []).find((choice) => choice?.value === value);
}

/** The overlay, with everything it is not allowed to touch left out (AD-31). */
function limitOverlay(overlay: ProfileOverlay | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isRecord(overlay)) return out;
  for (const field of OVERLAY_FIELDS) {
    if (overlay[field] !== undefined) out[field] = clone(overlay[field]);
  }
  return out;
}

/**
 * The resolved profile with `eff` applied, and the id of the code database that goes with
 * it (AD-31). The result is validated and compiled like any profile, so a variant overlay
 * cannot smuggle anything past the gate.
 *
 * With no machine and no detected variant nothing changes but `modal.units`,
 * `modal.diameter` and `modal.sources` — the P1 profiles behave exactly as they did in
 * Phase 1 (X10).
 */
export function applyMachine(p: Profile, eff: EffectiveMachine): { profile: Profile; codes: string } {
  const decl = p.machineParams;
  let out = clone(p) as unknown as Record<string, unknown>;
  let codes = typeof p.codes === 'string' ? p.codes : '';

  for (const variant of variantsOf(decl)) {
    const id = variant?.id;
    if (typeof id !== 'string') continue;
    const choice = choiceOf(variant, eff.params.variants[id]);
    if (!choice) continue;
    const overlay = limitOverlay(choice.overlay);
    if (Object.keys(overlay).length > 0) out = mergeProfile(out, overlay);
    if (typeof choice.codes === 'string' && choice.codes !== '') codes = choice.codes;
  }

  // The decimal point only means something where the control reads a point-less word as a
  // count of increments. `calculator` and `scale` both read it as written — in a `scale`
  // unit system the unit multiplies a number with a point exactly as it multiplies one
  // without, so `X10` and `X10.` are the same position there (AD-31).
  if (decl?.numberInput !== undefined && eff.params.numberInput !== null) {
    const lengthMode = eff.params.numberInput.classes?.length?.mode ?? eff.params.numberInput.mode;
    const syntax = isRecord(out.syntax) ? { ...(out.syntax as Record<string, unknown>) } : {};
    syntax.decimalPointSignificant = lengthMode === 'increment';
    out.syntax = syntax;
  }

  const modal = isRecord(out.modal) ? { ...(out.modal as Record<string, unknown>) } : {};
  const initial = isRecord(modal.initial) ? { ...(modal.initial as Record<string, string>) } : {};
  for (const [group, code] of Object.entries(eff.params.modalInitial)) initial[group] = code;
  if (Object.keys(initial).length > 0) modal.initial = initial;
  modal.units = eff.params.units;
  if (eff.params.diameter !== null) modal.diameter = eff.params.diameter;
  else delete modal.diameter;

  const sources: Record<string, ParamSource> = {};
  for (const group of Object.keys(initial)) sources[group] = eff.source.modalInitial[group] ?? 'profile';
  sources.units = eff.source.units;
  if (eff.params.diameter !== null) sources.diameter = eff.source.diameter;
  modal.sources = sources;
  out.modal = modal;

  return { profile: out as unknown as Profile, codes };
}

/** JSON with the object keys sorted, so two equal parameter sets give one string. */
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

/**
 * The cache key of an effective profile: the profile id, the parameters that change how it
 * reads a program, and **where each of them came from**. Two machines set up the same way
 * share one compiled profile, and a machine that is renamed does not invalidate anything —
 * the name is not in the key.
 *
 * The provenance belongs in it because [`applyMachine`] writes it into the profile it
 * compiles, as `modal.sources`, and every consumer of an assumed value reads it from there
 * to say where that value came from. Two documents can have the same parameters and a
 * different story — one where a `gcodeSystem: 'B'` was **detected** in the program, one
 * where a machine states it — and without this they shared the first one's compile, so the
 * second was told the wrong source for every value it had to assume (G8 M6). That is
 * exactly the guarantee this module is written for: nothing is applied without saying
 * where it came from.
 *
 * §7.15 gives this function two parameters. The third is optional, and a key built without
 * it is the key of §7.15 — it is passed wherever a source is known, which is everywhere a
 * profile is compiled (§7.16).
 */
export function effectiveKey(profileId: string, params: MachineParams, source?: EffectiveMachine['source']): string {
  const provenance = source === undefined ? '' : `|${canonical(source)}`;
  return `${profileId}|${canonical(params)}${provenance}`;
}

/**
 * True when a machine applies to a document with this profile chain: the machine's base
 * profile is the document's profile or one it extends, so a user profile
 * `extends: fanuc-lathe` (M12) uses the Fanuc-lathe machines without being told about them.
 */
export function compatible(m: MachineConfig, chain: readonly string[]): boolean {
  return typeof m?.profile === 'string' && chain.includes(m.profile);
}
