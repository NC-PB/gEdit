// Reading and writing `machines.json` (plan §7.15, AD-31, D50). Owner: WP6.8.
//
// Rust owns the bytes; this module owns what they mean. Two pure functions, and one rule
// between them: **what came in comes out again.**
//
//   `parseMachinesFile`      tolerant. A record it cannot identify is kept verbatim in
//                            `invalid` with its problems; members it does not know are
//                            kept; a `defaults` entry naming a machine that is not there
//                            is kept in the file and ignored when it is read.
//   `serializeMachinesFile`  writes the whole object back — the valid records, the invalid
//                            ones at their original positions, byte for byte, and the
//                            unknown members.
//
// Why that matters more than it looks: this file is meant to be edited by hand (AD-31
// lists "Open machines file" as a first-class action). A user who adds a per-class
// `numberInput` value this build does not understand, or who opens the file from a newer
// gEdit, must not lose it because the Machines page was clicked afterwards. And a record
// that is broken is a record the user is in the middle of writing — dropping it would
// delete work, rewriting it would change how a machine reads numbers without saying so.
//
// The positions are kept because a diff of `machines.json` is something the owner reads:
// a save that reorders every record hides the one line that actually changed.

import { MACHINES_VERSION } from './types';
import { MAX_MACHINES, readMachine } from './validate';
import type { MachineConfig, MachineProblem, ParsedMachinesFile } from './types';

/** The members this build knows at the top level of the file. */
const KNOWN_MEMBERS: ReadonlySet<string> = new Set(['$version', 'machines', 'defaults']);

/**
 * Where a record stood in the file it was read from, so a write puts it back there.
 *
 * A `WeakMap` and not a member of the record: a member would be written into the file.
 */
const ORIGIN = new WeakMap<object, number>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An empty, usable file: what a fresh install and "Replace with an empty file" both mean. */
export function emptyMachinesFile(): ParsedMachinesFile {
  return {
    version: MACHINES_VERSION,
    machines: [],
    defaults: {},
    invalid: [],
    unknown: {},
    error: null,
  };
}

/** A file that could not be used at all: no machine is active and no write is allowed. */
function unusable(error: string): ParsedMachinesFile {
  return { ...emptyMachinesFile(), error };
}

/**
 * `machines.json` as it was read. `raw` is what `config_load` handed over — always an
 * object when Rust could parse the file, `{}` when it could not.
 *
 * `error` is set only for the file **as a whole**. A record that is broken is not a broken
 * file: the other machines keep working, which is the difference between "one machine is
 * being edited" and "nothing is available".
 */
export function parseMachinesFile(raw: unknown): ParsedMachinesFile {
  if (!isRecord(raw)) return unusable('machines.json: expected a JSON object');

  const stamp = raw.$version;
  const version = typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : MACHINES_VERSION;

  // A `machines` or `defaults` member of the wrong shape is not something to repair: the
  // file says something this build does not understand, and the next write would throw it
  // away. It is refused as a whole, so the user is sent to the file itself.
  if (raw.machines !== undefined && !Array.isArray(raw.machines)) {
    return unusable('machines.json: "machines" must be a list');
  }
  if (raw.defaults !== undefined && !isRecord(raw.defaults)) {
    return unusable('machines.json: "defaults" must be a JSON object');
  }

  const machines: MachineConfig[] = [];
  const invalid: ParsedMachinesFile['invalid'] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  const list: unknown[] = Array.isArray(raw.machines) ? raw.machines : [];
  list.forEach((entry, index) => {
    const path = `machines[${index}]`;
    if (machines.length >= MAX_MACHINES) {
      const problem: MachineProblem = {
        machineId: isRecord(entry) && typeof entry.id === 'string' ? entry.id : null,
        path,
        message: `a machines file holds at most ${MAX_MACHINES} machines; this one is not used`,
      };
      const kept = { raw: entry, problems: [problem] };
      ORIGIN.set(kept, index);
      invalid.push(kept);
      return;
    }
    const read = readMachine(entry, { path, ids, names });
    if (read.machine === null) {
      const kept = { raw: entry, problems: read.problems };
      ORIGIN.set(kept, index);
      invalid.push(kept);
      return;
    }
    ids.add(read.machine.id);
    names.add(read.machine.name.trim().toLowerCase());
    ORIGIN.set(read.machine, index);
    machines.push(read.machine);
  });

  const defaults: Record<string, string> = isRecord(raw.defaults)
    ? ({ ...raw.defaults } as Record<string, string>)
    : {};

  const unknown: Record<string, unknown> = {};
  for (const [member, value] of Object.entries(raw)) {
    if (!KNOWN_MEMBERS.has(member)) unknown[member] = value;
  }

  return { version, machines, defaults, invalid, unknown, error: null };
}

/**
 * The whole file, ready for `machines_save`. Rust stamps `$version` itself, so it is not
 * written here — a file read from a newer gEdit would otherwise be stamped down to this
 * build's version on its way through.
 *
 * Every record goes back where it came from; a record added in this session has no
 * position and is appended in the order the caller holds it.
 */
export function serializeMachinesFile(file: ParsedMachinesFile): Record<string, unknown> {
  // Anything without a remembered position was added in this session and goes after
  // everything that came from the file, in the order the caller holds it.
  const appendBase = Number.MAX_SAFE_INTEGER - 1_000_000;
  const placed: { at: number; value: unknown }[] = [];
  let next = 0;
  for (const machine of file.machines) {
    placed.push({ at: ORIGIN.get(machine) ?? appendBase + next++, value: machine });
  }
  for (const entry of file.invalid) {
    placed.push({ at: ORIGIN.get(entry) ?? appendBase + next++, value: entry.raw });
  }
  placed.sort((a, b) => a.at - b.at);

  return {
    ...file.unknown,
    machines: placed.map((entry) => entry.value),
    defaults: { ...file.defaults },
  };
}

/**
 * Where this record stands in the file it was read from, or `undefined` for one that was
 * added in this session.
 *
 * The Machines page shows a problem by its JSON path, and that path has to point at the
 * line the user would open: a record that is the second **usable** one may be the fourth
 * in the file, because the ones before it were not understood.
 */
export function positionOf(value: object): number | undefined {
  return ORIGIN.get(value);
}

/**
 * Remembers that `machine` replaces `previous` in the file, so an edit keeps its position
 * in the list instead of jumping to the end on every save.
 */
export function keepPosition(machine: MachineConfig, previous: MachineConfig): MachineConfig {
  const at = ORIGIN.get(previous);
  if (at !== undefined) ORIGIN.set(machine, at);
  return machine;
}
