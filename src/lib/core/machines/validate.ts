// What makes a stored machine configuration usable (plan §7.15, AD-31). Owner: WP6.8.
//
// Two steps, and the split is the point:
//
//   `readMachine`      identity only — is this a record at all, is its id a stable slug,
//                      is its name free? Needs no profile, so it runs while `machines.json`
//                      is parsed, before anything knows which profiles exist.
//   `validateMachine`  the record against its base profile's declaration — the parameters
//                      it sets have to be ones that profile offers, and the values have to
//                      be ones it declares.
//
// The rule both halves serve: **a record that is not understood is kept, reported and not
// used.** Never dropped (a hand edit is the user's work), never repaired (a repaired
// machine reads numbers differently from the one the user wrote down), never silently
// selectable. `validateMachine` therefore reports and the caller treats any problem as
// "inactive": every parameter here decides how a program is read — the number input, the
// units, the diameter mode, the G-code system, the power-on state — and a machine that is
// half understood would misread a program while looking chosen.
//
// (M10 adds the one exception, AD-32: a broken `channels` block costs the channels, not
// the record. It is not a parameter of the number reading, and WP10.1 owns that rule.)

import { normalizeCode } from '$lib/core/codes/lookup';
import type { CodeDb } from '$lib/core/codes/types';
import type { MachineParamsDecl, Profile, VariantDecl } from '$lib/core/profiles/types';
import type { MachineConfig, MachineProblem, NumberClass, NumberReading } from './types';

/** `MachineConfig.id`, in characters; [`MACHINE_ID_RE`] is written from it. */
export const MAX_ID_LENGTH = 64;

/** `MachineConfig.id`: a slug that per-file memory and recovery entries point at (M7). */
export const MACHINE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `MachineConfig.name`, in characters. */
export const MAX_NAME_LENGTH = 64;

/** `MachineConfig.notes`, in characters. */
export const MAX_NOTES_LENGTH = 500;

/** How many records one `machines.json` may hold (§7.15). */
export const MAX_MACHINES = 100;

/** The three readings a `NumberInput` may name. */
const READINGS: readonly NumberReading[] = ['increment', 'calculator', 'scale'];

/** The classes a `NumberInput.classes` entry may name. */
const CLASSES: readonly NumberClass[] = ['length', 'angle', 'feedPerMin', 'feedPerRev', 'dwell'];

/**
 * Decimal text, the way an increment is stored: digits, optionally a point and more
 * digits. No exponent, no sign, no spaces — the value goes into `Decimal` arithmetic in
 * Python and into string arithmetic in TypeScript, and a float would already have lost
 * `0.001` by the time anyone noticed.
 */
const DECIMAL_RE = /^\d+(?:\.\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for decimal text that is greater than zero: an increment of `0` reads every word as 0. */
function isPositiveDecimal(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_RE.test(value) && /[1-9]/.test(value);
}

function problem(machineId: string | null, path: string, message: string): MachineProblem {
  return { machineId, path, message };
}

/** The variants a declaration offers, tolerant of a hand-written profile. */
function variantsOf(decl: MachineParamsDecl | undefined): VariantDecl[] {
  return Array.isArray(decl?.variants) ? decl.variants : [];
}

function choicesOf(variant: VariantDecl): string[] {
  return (Array.isArray(variant?.choices) ? variant.choices : [])
    .map((choice) => choice?.value)
    .filter((value): value is string => typeof value === 'string');
}

export interface ReadMachineOptions {
  /** JSON path of this record in `machines.json`, e.g. `machines[3]`. */
  path: string;
  /** The ids already taken by earlier records. */
  ids: ReadonlySet<string>;
  /** The names already taken, lower-cased. */
  names: ReadonlySet<string>;
}

export interface ReadMachineResult {
  /** The record, or `null` when it cannot even be identified. */
  machine: MachineConfig | null;
  problems: MachineProblem[];
}

/**
 * One record's identity: is it an object, is its id a valid, free slug, is its name a free
 * name, is `params` an object?
 *
 * The result **is the raw object**, with the known members normalised in place, so every
 * member this build does not know — and every future parameter — survives the round trip
 * in its original position (§7.15: "unknown members at any level are kept").
 */
export function readMachine(raw: unknown, o: ReadMachineOptions): ReadMachineResult {
  const problems: MachineProblem[] = [];
  if (!isRecord(raw)) {
    return { machine: null, problems: [problem(null, o.path, 'not a JSON object')] };
  }

  const id = raw.id;
  const known = typeof id === 'string' ? id : null;
  if (typeof id !== 'string' || !MACHINE_ID_RE.test(id)) {
    problems.push(
      problem(
        known,
        `${o.path}.id`,
        'an id must be 1–64 characters of a–z, 0–9 and "-", starting with a letter or a digit',
      ),
    );
  } else if (o.ids.has(id)) {
    problems.push(problem(known, `${o.path}.id`, `the id "${id}" is used by an earlier machine`));
  }

  const name = raw.name;
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME_LENGTH) {
    problems.push(
      problem(known, `${o.path}.name`, `a name must be 1–${MAX_NAME_LENGTH} characters`),
    );
  } else if (o.names.has(name.trim().toLowerCase())) {
    problems.push(
      problem(known, `${o.path}.name`, `the name "${name}" is used by another machine`),
    );
  }

  if (typeof raw.profile !== 'string' || raw.profile === '') {
    problems.push(problem(known, `${o.path}.profile`, 'a machine names the profile it is for'));
  }

  if (raw.params !== undefined && !isRecord(raw.params)) {
    problems.push(problem(known, `${o.path}.params`, 'params must be a JSON object'));
  }

  if (raw.notes !== undefined && (typeof raw.notes !== 'string' || raw.notes.length > MAX_NOTES_LENGTH)) {
    problems.push(
      problem(known, `${o.path}.notes`, `notes must be text of at most ${MAX_NOTES_LENGTH} characters`),
    );
  }

  if (problems.length > 0) return { machine: null, problems };

  // The raw object itself, so unknown members keep their place; the known ones are
  // re-assigned, which in JavaScript leaves their position alone.
  const machine = { ...raw } as unknown as MachineConfig;
  machine.params = isRecord(raw.params) ? ({ ...raw.params } as MachineConfig['params']) : {};
  return { machine, problems: [] };
}

export interface ValidateMachineOptions {
  /** JSON path of this record, e.g. `machines[3]`. */
  path: string;
  /** The resolved base profile, or `undefined` when this build does not know it. */
  profile: Profile | undefined;
  /**
   * The code database the record's variants resolve to, for the `modalInitial` codes.
   * Absent: the codes are not checked, only the groups (a caller that has no database
   * still gets the rest of the rules).
   */
  codes?: CodeDb;
}

/**
 * One record against its base profile's declaration. An empty result means the machine can
 * be chosen; anything else means it is kept, listed with its problems and not selectable.
 */
export function validateMachine(m: MachineConfig, o: ValidateMachineOptions): MachineProblem[] {
  const problems: MachineProblem[] = [];
  const id = typeof m.id === 'string' ? m.id : null;
  const at = (member: string): string => `${o.path}.params.${member}`;

  if (o.profile === undefined) {
    return [
      problem(
        id,
        `${o.path}.profile`,
        `the profile "${m.profile}" is not loaded, so this machine cannot be used`,
      ),
    ];
  }

  const decl = o.profile.machineParams;
  if (decl === undefined) {
    return [
      problem(
        id,
        `${o.path}.profile`,
        `the profile "${m.profile}" has no machine parameters, so it has no machines`,
      ),
    ];
  }

  const params = isRecord(m.params) ? m.params : {};

  if (params.numberInput !== undefined && params.numberInput !== null) {
    if (decl.numberInput === undefined) {
      problems.push(problem(id, at('numberInput'), `the profile "${m.profile}" does not read numbers by a setting`));
    } else {
      problems.push(...numberInputProblems(params.numberInput, id, at('numberInput')));
    }
  }

  if (params.units !== undefined && params.units !== 'mm' && params.units !== 'inch') {
    problems.push(problem(id, at('units'), 'the unit at power-on is "mm" or "inch"'));
  }

  if (params.diameter !== undefined && params.diameter !== null) {
    if (decl.diameter === undefined) {
      problems.push(problem(id, at('diameter'), `the profile "${m.profile}" has no diameter mode`));
    } else if (params.diameter !== 'on' && params.diameter !== 'off') {
      problems.push(problem(id, at('diameter'), 'the diameter mode is "on" or "off"'));
    }
  }

  const variants = params.variants;
  if (variants !== undefined) {
    if (!isRecord(variants)) {
      problems.push(problem(id, at('variants'), 'variants must be a JSON object'));
    } else {
      const declared = new Map(variantsOf(decl).map((variant) => [variant.id, choicesOf(variant)]));
      for (const [variantId, value] of Object.entries(variants)) {
        const choices = declared.get(variantId);
        if (choices === undefined) {
          problems.push(
            problem(id, `${at('variants')}.${variantId}`, `the profile "${m.profile}" has no variant "${variantId}"`),
          );
        } else if (typeof value !== 'string' || !choices.includes(value)) {
          problems.push(
            problem(
              id,
              `${at('variants')}.${variantId}`,
              `"${String(value)}" is not one of ${choices.map((choice) => `"${choice}"`).join(', ')}`,
            ),
          );
        }
      }
    }
  }

  const modalInitial = params.modalInitial;
  if (modalInitial !== undefined) {
    if (!isRecord(modalInitial)) {
      problems.push(problem(id, at('modalInitial'), 'modalInitial must be a JSON object'));
    } else {
      const offered = new Set(Array.isArray(decl.modalGroups) ? decl.modalGroups : []);
      for (const [group, code] of Object.entries(modalInitial)) {
        const where = `${at('modalInitial')}.${group}`;
        if (!offered.has(group)) {
          problems.push(problem(id, where, `the profile "${m.profile}" does not offer the group "${group}"`));
          continue;
        }
        if (typeof code !== 'string' || code === '') {
          problems.push(problem(id, where, 'a power-on code is written as text, e.g. "G95"'));
          continue;
        }
        if (o.codes === undefined) continue;
        const wanted = normalizeCode(code);
        const entry = o.codes.codes.find(
          (candidate) =>
            normalizeCode(candidate.code) === wanted ||
            (candidate.aliases ?? []).some((alias) => normalizeCode(alias) === wanted),
        );
        if (entry === undefined) {
          problems.push(problem(id, where, `"${code}" is not a code of the database "${o.codes.dialect}"`));
        } else if (entry.group !== group) {
          problems.push(
            problem(id, where, `"${code}" belongs to the group "${entry.group ?? 'none'}", not to "${group}"`),
          );
        }
      }
    }
  }

  return problems;
}

/**
 * A stored `NumberInput`, member by member. A machine keeps the **whole** value of the
 * preset it was given (§7.15), so this is the shape that decides how every literal of that
 * machine is read — and the one place a typo in the file has to be caught.
 */
function numberInputProblems(raw: unknown, id: string | null, path: string): MachineProblem[] {
  const problems: MachineProblem[] = [];
  if (!isRecord(raw)) return [problem(id, path, 'the number input must be a JSON object')];

  if (typeof raw.mode !== 'string' || !READINGS.includes(raw.mode as NumberReading)) {
    problems.push(problem(id, `${path}.mode`, `the reading is one of ${READINGS.join(', ')}`));
  }
  if (!isPositiveDecimal(raw.incrementMm)) {
    problems.push(problem(id, `${path}.incrementMm`, 'the metric increment is decimal text above zero, e.g. "0.001"'));
  }
  for (const member of ['incrementInch', 'incrementDeg', 'incrementSec'] as const) {
    if (raw[member] !== undefined && !isPositiveDecimal(raw[member])) {
      problems.push(problem(id, `${path}.${member}`, 'an increment is decimal text above zero, e.g. "0.001"'));
    }
  }

  const classes = raw.classes;
  if (classes === undefined) return problems;
  if (!isRecord(classes)) {
    problems.push(problem(id, `${path}.classes`, 'classes must be a JSON object'));
    return problems;
  }
  for (const [name, value] of Object.entries(classes)) {
    const where = `${path}.classes.${name}`;
    if (!CLASSES.includes(name as NumberClass)) {
      problems.push(problem(id, where, `"${name}" is not one of ${CLASSES.join(', ')}`));
      continue;
    }
    if (!isRecord(value)) {
      problems.push(problem(id, where, 'a class entry must be a JSON object'));
      continue;
    }
    if (value.mode !== undefined && (typeof value.mode !== 'string' || !READINGS.includes(value.mode as NumberReading))) {
      problems.push(problem(id, `${where}.mode`, `the reading is one of ${READINGS.join(', ')}`));
    }
    for (const member of ['increment', 'incrementInch'] as const) {
      if (value[member] !== undefined && !isPositiveDecimal(value[member])) {
        problems.push(problem(id, `${where}.${member}`, 'an increment is decimal text above zero, e.g. "0.001"'));
      }
    }
  }
  return problems;
}
