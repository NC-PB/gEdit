// The generated view of the shipped data (plan M6 P6 item 12, §5.2 rule 3, gate G10).
// Written by the M6 prelude (P6); **WP6.1 owns it from Wave A on**.
//
// Three kinds of consumer read `tests/fixtures/resolved/**`, and none of them may compute
// it for itself:
//
//   - the **G10 review** reads what the app really uses, not what a file says. A profile
//     that `extends` another and a database that `extends` another are half-written by
//     design (AD-16, AD-17); reviewing the halves would miss exactly the mistakes that
//     only appear in the merge.
//   - the **Python tests** (`tests/python/helpers.py`) read the resolved profiles and the
//     effective ones. Python never merges a machine into a profile — if it did, the two
//     implementations would drift and the goldens would stop proving anything.
//   - a **golden that names a machine** (§7.4) runs against the one merge result recorded
//     here, so "this program reads like this on that machine" is pinned to a file a
//     reviewer can read.
//
// `UPDATE_RESOLVED=1 npm test -- resolved` rewrites everything; a plain run compares, and
// a missing entry says which command to run. Integration regenerates after Wave A (I6),
// because a content WP may write a golden whose effective profile does not exist yet.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { applyMachine, effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { fnv1a32 } from '$lib/core/text/hash';
import { FIXTURES_DIR } from './helpers/fixtures';
import type { Profile } from '$lib/core/profiles/types';
import type { EffectiveMachine, MachineConfig } from '$lib/core/machines/types';

const ROOT = join(FIXTURES_DIR, 'resolved');
const UPDATE = process.env.UPDATE_RESOLVED === '1';
const HOW = 'run `UPDATE_RESOLVED=1 npm test -- resolved`';

/** The folders that may hold a golden with a `machine` member (§7.4). */
const GOLDEN_ROOTS = ['modal', 'scripts', 'machines'];

/** Stable JSON: object keys sorted, two-space indent, one trailing newline. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) out[key] = canonical(entry);
    }
    return out;
  }
  return value;
}

function text(value: unknown): string {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

/** A short, stable name for one machine block; the same string always gives the same file. */
function keyOf(machine: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(machine)));
  return `k-${fnv1a32(bytes).toString(16).padStart(8, '0')}`;
}

/** The files this run produced: published path (relative to `resolved/`) → contents. */
const produced = new Map<string, string>();

function emit(path: string, value: unknown): void {
  produced.set(path, text(value));
}

/** Every committed file under `resolved/`, so a stale one is noticed. */
function committed(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) out.push(relative(ROOT, full).split('\\').join('/'));
    }
  };
  try {
    walk(ROOT);
  } catch {
    return [];
  }
  return out.sort();
}

/** Every `*.json` under one fixture folder, sorted, as paths relative to `tests/fixtures`. */
function goldenFiles(): string[] {
  const out: string[] = [];
  for (const root of GOLDEN_ROOTS) {
    const base = join(FIXTURES_DIR, root);
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.json')) out.push(relative(FIXTURES_DIR, full).split('\\').join('/'));
      }
    };
    try {
      if (statSync(base).isDirectory()) walk(base);
    } catch {
      // A folder a later milestone adds; nothing to do until it exists.
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// What the app resolves
// ---------------------------------------------------------------------------

const { resolved, problems } = resolveProfiles(BUILTIN_PROFILE_SOURCES);
const resolvedCodes = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

/** The validated profiles, by id, in registry order. */
const PROFILES = new Map<string, Profile>(
  resolved.map((entry) => {
    const checked = validateProfile(entry.profile);
    if (!checked.ok) throw new Error(`${String(entry.chain[0])}: ${checked.errors.join('; ')}`);
    return [checked.profile.id, checked.profile];
  }),
);

/**
 * One effective view as the fixtures record it: the profile with the machine applied, the
 * id of the database that goes with it, and the machine block that produced them.
 *
 * The **profile** is written out in full on purpose. It is what the Python side reads and
 * what G10 checks, and a diff of it is the one place a change of merge behaviour shows up.
 */
function effectiveOf(profile: Profile, machine: EffectiveMachine): Record<string, unknown> {
  const applied = applyMachine(profile, machine);
  return {
    profile: applied.profile,
    codes: applied.codes,
    machine: {
      id: machine.id,
      name: machine.name,
      choice: machine.choice,
      params: machine.params,
      source: machine.source,
    },
  };
}

/** A machine that sets exactly one parameter, for the per-preset and per-variant files. */
function machineWith(profile: Profile, params: MachineConfig['params']): EffectiveMachine {
  const config: MachineConfig = { id: 'review', name: 'review', profile: profile.id, params };
  return effectiveMachine(profile, config, 'document', {});
}

function buildAll(): Map<string, string> {
  produced.clear();

  for (const [id, profile] of PROFILES) emit(`profiles/${id}.json`, profile);
  for (const [dialect, file] of Object.entries(resolvedCodes)) emit(`codes/${dialect}.json`, file);

  // One file per declared preset and per declared variant choice, plus the defaults: the
  // G10 review (§8.7 item 5a) reads these to check that a preset really does what its
  // label says, and that a variant's overlay touches nothing it may not.
  for (const [id, profile] of PROFILES) {
    emit(`effective/${id}/defaults.json`, effectiveOf(profile, noMachine(profile)));
    const decl = profile.machineParams;
    for (const preset of decl?.numberInput?.presets ?? []) {
      emit(
        `effective/${id}/preset-${preset.id}.json`,
        effectiveOf(profile, machineWith(profile, { numberInput: preset.value })),
      );
    }
    for (const variant of decl?.variants ?? []) {
      for (const choice of variant.choices ?? []) {
        emit(
          `effective/${id}/variant-${variant.id}-${choice.value}.json`,
          effectiveOf(profile, machineWith(profile, { variants: { [variant.id]: choice.value } })),
        );
      }
    }
  }

  // One file per distinct context a golden runs with, and an index from the golden to it,
  // so a Python test looks its context up by the golden it runs and never computes an
  // effective key of its own.
  const index: Record<string, string> = {};
  for (const path of goldenFiles()) {
    const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, path), 'utf8')) as Record<string, unknown>;
    if (typeof raw !== 'object' || raw === null) continue;
    const isModal = path.startsWith('modal/');
    const machineBlock = raw.machine;
    if (!isModal && (typeof machineBlock !== 'object' || machineBlock === null)) continue;

    const profileId = profileOfGolden(path, raw);
    const profile = PROFILES.get(profileId);
    if (!profile) throw new Error(`${path}: unknown profile "${profileId}"`);

    // The golden's `machine` member is a partial `MachineParams`; absent means "no
    // machine", and the variants are then the ones detected on that golden's input.
    const machine =
      typeof machineBlock === 'object' && machineBlock !== null
        ? machineWith(profile, machineBlock as MachineConfig['params'])
        : noMachine(profile);
    const name = `effective/${profileId}/${keyOf(machine.params)}.json`;
    emit(name, effectiveOf(profile, machine));
    index[path] = name;
  }
  emit('effective/index.json', index);
  return new Map(produced);
}

/**
 * The profile a golden runs with: its `profile` member, else the folder under `modal/`,
 * else the P1 default. `tests/fixtures/modal/<profileId>/<case>.json` is the §7.4 layout.
 */
function profileOfGolden(path: string, raw: Record<string, unknown>): string {
  if (typeof raw.profile === 'string' && raw.profile !== '') return raw.profile;
  const parts = path.split('/');
  if (parts[0] === 'modal' && parts.length > 2) return parts[1];
  return 'fanuc-gcode';
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe('the resolved fixtures', () => {
  const files = buildAll();

  it('resolves every built-in without a problem', () => {
    expect(problems).toEqual([]);
    expect([...PROFILES.keys()]).toEqual(['fanuc-gcode', 'fanuc-lathe', 'heidenhain-klartext']);
  });

  if (UPDATE) {
    it('rewrites tests/fixtures/resolved/**', () => {
      rmSync(ROOT, { recursive: true, force: true });
      for (const [path, contents] of files) {
        const full = join(ROOT, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, contents, 'utf8');
      }
      expect(committed()).toEqual([...files.keys()].sort());
    });
    return;
  }

  it('has a committed file for everything the app resolves', () => {
    const missing = [...files.keys()].filter((path) => !committed().includes(path));
    expect(missing, `missing resolved fixtures; ${HOW}`).toEqual([]);
  });

  it('holds nothing the app does not resolve any more', () => {
    const stale = committed().filter((path) => !files.has(path));
    expect(stale, `stale resolved fixtures; ${HOW}`).toEqual([]);
  });

  it.each([...files.keys()].sort())('%s equals what the app resolves', (path) => {
    const full = join(ROOT, path);
    let onDisk: string;
    try {
      onDisk = readFileSync(full, 'utf8');
    } catch {
      throw new Error(`${path} is missing; ${HOW}`);
    }
    expect(onDisk, `${path} is out of date; ${HOW}`).toBe(files.get(path));
  });
});
