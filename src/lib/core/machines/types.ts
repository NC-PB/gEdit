// The machine-configuration contract (plan §7.15, AD-31). Written by the M6 prelude (P6)
// and binding for every M6 work package: an implementation may change, a signature here
// may not (a deviation needs a hand-off note and integration approval).
//
// What a machine configuration is, in one paragraph: a **profile** says what a dialect
// looks like, a **machine configuration** says how one particular control reads the
// programs written in it. Whether `X50` means 50 mm or 0.050 mm, whether the lathe is set
// up for G-code system A or B, whether the spindle starts in feed per revolution — none of
// that is a property of "Fanuc". It is a property of the machine in the workshop, and
// getting it wrong scraps a part. So it is user data, declared by the profile
// (`machineParams`, §7.1) and chosen per document.
//
// Two rules run through everything below:
//
//  1. **Every effective value names its source.** `machine`, `detected` or `profile`
//     (`ParamSource`). A value that is not the machine's is shown as assumed, never as
//     fact.
//  2. **No machine, no guess** (AD-31). Without a machine a literal has a value only when
//     every preset the profile declares reads it the same way. A word without a value is
//     reported, never converted.
//
// This file holds types only, so it can be imported from anywhere, `core/` included
// (AD-1). The pure functions live next to it in `effective.ts` (P6, owned by WP6.8 from
// Wave A on) and `numbers.ts` (WP6.9), and `stores/machines.ts` holds the service.

import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile, MachineParamsDecl, Profile } from '$lib/core/profiles/types';

/** The file format version of `machines.json`. Must match `MACHINES_VERSION` in `machines.rs`. */
export const MACHINES_VERSION = 1;

/**
 * The classes a control may read differently. They are the classes the manuals
 * distinguish, not address letters: `X` and `Z` are both `length`, `C` is an `angle`
 * because the profile lists it in `addresses.angular`, and the dwell `X` of `G04` is
 * `dwell` because the code database says so (`CodeParam.unit`).
 */
export type NumberClass = 'length' | 'angle' | 'feedPerMin' | 'feedPerRev' | 'dwell';

/**
 * How a numeric literal of a class is read (AD-31):
 *
 * - `increment`  — with a decimal point mm/inch/deg/s as written, without one a count of
 *                  least input increments (Fanuc IS-B/IS-C with calculator-type input off:
 *                  `X50` is 0.050 mm, `X50.` is 50 mm).
 * - `calculator` — as written, with or without a point (Fanuc calculator-type input; the
 *                  Okuma 1 mm and 1 inch unit systems, which are `scale` with a unit of 1).
 * - `scale`      — **every** literal, with or without a point, times the class's unit: the
 *                  Okuma 1 µm, 10 µm and 1/10000 inch unit systems, where `X0.1` is
 *                  0.001 mm under 10 µm and `F23.456` is 0.23456 mm/rev.
 */
export type NumberReading = 'increment' | 'calculator' | 'scale';

/**
 * One way of reading numbers, as a preset stores it and as a machine keeps it.
 *
 * Increments are **decimal text**, never a JS number: `0.001` and `0.0001` have to survive
 * a round trip through JSON and through Python's `Decimal` unchanged, and a float would
 * quietly turn `0.1` into `0.1000000000000000055…`.
 */
export interface NumberInput {
  /** For `length` words and for every class without an entry in `classes`. */
  mode: NumberReading;
  /**
   * The increment (`increment`) or the value of "1" (`scale`) for a length in a metric
   * program, as decimal text: `'0.001'` (IS-B), `'0.0001'` (IS-C), `'0.01'` (Okuma 10 µm),
   * `'1'`.
   */
  incrementMm: string;
  /** The same in an inch program. Absent: a tenth of `incrementMm` (IS-B 0.0001 in). */
  incrementInch?: string;
  /**
   * Angle words, in degrees, in metric **and** inch programs (the `angle` class ignores
   * `units`). Absent: the digits of `incrementMm`, so IS-B reads `C90000` as 90° in both.
   */
  incrementDeg?: string;
  /** Dwell words, in seconds, in metric and inch programs alike. Absent: as `incrementDeg`. */
  incrementSec?: string;
  /**
   * Where the control reads a class differently (Okuma's unit table; Fanuc feeds and
   * dwell). `increment` is millimetres for `length` and the feed classes in a metric
   * program, degrees for `angle` and seconds for `dwell`; `incrementInch` may only appear
   * on a class that follows `units`.
   */
  classes?: Partial<Record<NumberClass, { mode?: NumberReading; increment?: string; incrementInch?: string }>>;
}

/**
 * The complete set of machine parameters of one document, after the profile's defaults,
 * the detected variants and the chosen machine have been merged (`effectiveMachine`).
 *
 * `MachineConfig.params` is a `Partial` of this — only what the user set — and this is
 * what every consumer reads.
 */
export interface MachineParams {
  /** `null`: the profile declares no `numberInput`, so numbers are read as its JSON says. */
  numberInput: NumberInput | null;
  units: 'mm' | 'inch';
  /** `null`: not a lathe parameter of this profile. */
  diameter: 'on' | 'off' | null;
  /** Variant id → choice value: `{ gcodeSystem: 'B' }`. */
  variants: Record<string, string>;
  /** Modal group → canonical code, over the profile's `modal.initial`. */
  modalInitial: Record<string, string>;
}

/** Where one effective parameter came from. Shown next to every assumed value (AD-31). */
export type ParamSource = 'machine' | 'detected' | 'profile';

/** The effective machine of one document: always complete, every value with its source. */
export interface EffectiveMachine {
  id: string | null;
  name: string | null;
  /**
   * Why this machine: `document` = chosen for this document or remembered for its file
   * (`id` null = an explicit "none"); `default` = the profile's default machine; `none` =
   * nothing chosen and no default.
   */
  choice: 'document' | 'default' | 'none';
  params: MachineParams;
  source: {
    numberInput: ParamSource;
    units: ParamSource;
    diameter: ParamSource;
    variants: Record<string, ParamSource>;
    modalInitial: Record<string, ParamSource>;
  };
  /** Profile id + the canonical JSON of `params`; the cache key of the effective profile. */
  key: string;
  /** Variant detection disagrees with the machine by a margin ≥ 3 (shown once per open). */
  mismatch: { variant: string; detected: string; chosen: string } | null;
}

/** What `machines.effective(docId)` answers: one document's whole NC view. */
export interface EffectiveProfile {
  profile: Profile;
  cp: CompiledProfile;
  codes: CodeDb;
  machine: EffectiveMachine;
}

/** One machine configuration, as it is stored in `machines.json`. */
export interface MachineConfig {
  /** `^[a-z0-9][a-z0-9-]{0,63}$`, stable: per-file memory refers to it (M7). */
  id: string;
  /** 1–64 characters, unique ignoring case. */
  name: string;
  /** Base profile id. */
  profile: string;
  /**
   * Only what the user set; everything else — and every variant or modal group left out —
   * follows the profile's defaults.
   */
  params: Partial<MachineParams>;
  /** ≤ 500 characters. */
  notes?: string;
}

/** `<config>/machines.json` (AD-31, D50). Rust owns the file; this is its shape. */
export interface MachinesFile {
  $version: 1;
  /** ≤ 100 records. */
  machines: MachineConfig[];
  /** Base profile id → the default machine for documents of that profile. */
  defaults: Record<string, string>;
}

/** Where `machines.json` is broken. `path` is a JSON path, so the message points at the file. */
export interface MachineProblem {
  machineId: string | null;
  path: string;
  message: string;
}

/**
 * What one preset reads a literal as, for "no machine, no guess": one entry per preset the
 * profile declares, the default first. `value` is `null` when that preset cannot give the
 * word a value at all.
 */
export interface Reading {
  preset: string;
  label: string;
  value: string | null;
}

/**
 * A `machines.json` as it was read, invalid records and unknown members included
 * (`core/machines/file.ts`, WP6.8).
 *
 * A record that fails validation is **kept verbatim** in `invalid` with its problems and
 * written back byte-stable: a hand edit is never lost because this build did not
 * understand it.
 */
export interface ParsedMachinesFile {
  version: number;
  machines: MachineConfig[];
  defaults: Record<string, string>;
  invalid: { raw: unknown; problems: MachineProblem[] }[];
  /** Members of the file this build does not know, kept for the write-back. */
  unknown: Record<string, unknown>;
  /** The file itself could not be used (not the records): no machine is active. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// The pure functions, `src/lib/core/machines/effective.ts` (P6; WP6.8 owns them
// from Wave A on). The signatures are the contract; the bodies are not.
// ---------------------------------------------------------------------------

/** The declaration's defaults; for a profile without `machineParams`, its own JSON. */
export type DefaultParams = (p: Profile) => MachineParams;

/**
 * The effective machine of one document: `machine` → `detected` (only when there is no
 * machine) → `profile`, per parameter, with the source recorded next to it.
 */
export type EffectiveMachineFn = (
  p: Profile,
  m: MachineConfig | null,
  choice: EffectiveMachine['choice'],
  detected: Record<string, { value: string; margin: number }>,
) => EffectiveMachine;

/** The resolved profile with the machine applied: overlays, `modal.*`, the variant database. */
export type ApplyMachine = (p: Profile, eff: EffectiveMachine) => { profile: Profile; codes: string };

/** Profile id + a canonical string of the parameters; two equal machines share one compile. */
export type EffectiveKey = (profileId: string, params: MachineParams) => string;

/** True when `chain` (the document profile's resolution chain) contains the machine's base profile. */
export type Compatible = (m: MachineConfig, chain: readonly string[]) => boolean;

// ---------------------------------------------------------------------------
// The number rules, `src/lib/core/machines/numbers.ts` (WP6.9), with Python twins
// in `_nc_machine.py` and one golden set in `tests/fixtures/machines/numbers.json`.
// The declarations live here so both halves of M6 read one contract.
// ---------------------------------------------------------------------------

/** What `numberClassOf` may answer; `null` = no class, or undecidable, so no value. */
export type ResolvedClass = NumberClass | 'increment' | 'count' | null;

/** What a consumer asks for one word: a value, or the readings to show instead (AD-31). */
export interface ResolvedValue {
  value: string | null;
  /** Empty when the value is settled or the word has no class. */
  readings: Reading[];
}

/** Re-exported for the declarations above, so a consumer imports one machine module. */
export type { MachineParamsDecl };
