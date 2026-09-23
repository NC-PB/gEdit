// Reading and writing `machines.json` (plan §7.15, AD-31). Owner: WP6.8.
//
// The samples in `tests/fixtures/machines/files/` are the four states a real file is found
// in: good, broken, written by a newer gEdit, and holding a record this build cannot use.
// Every one of them has to survive a round trip, because this file is meant to be edited
// by hand and a save from the Machines page must never be the thing that loses an edit.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyMachinesFile, keepPosition, parseMachinesFile, serializeMachinesFile } from './file';
import { MACHINES_VERSION } from './types';
import { MAX_MACHINES } from './validate';
import type { MachineConfig } from './types';

const FILES = fileURLToPath(new URL('../../../../tests/fixtures/machines/files/', import.meta.url));

function text(name: string): string {
  return readFileSync(`${FILES}${name}.json`, 'utf8');
}

function sample(name: string): Record<string, unknown> {
  return JSON.parse(text(name)) as Record<string, unknown>;
}

/** What a round trip has to reproduce: the file without the `$version` Rust stamps itself. */
function withoutVersion(raw: Record<string, unknown>): Record<string, unknown> {
  const { $version: _version, ...rest } = raw;
  return rest;
}

describe('a good file', () => {
  it('reads the records, the defaults and the version', () => {
    const file = parseMachinesFile(sample('valid'));
    expect(file.error).toBeNull();
    expect(file.version).toBe(MACHINES_VERSION);
    expect(file.machines.map((m) => m.id)).toEqual(['lathe-2', 'mill-1']);
    expect(file.invalid).toEqual([]);
    expect(file.defaults).toEqual({ 'fanuc-lathe': 'lathe-2' });
    expect(file.machines[0].params.variants).toEqual({ gcodeSystem: 'B' });
    expect(file.machines[0].notes).toContain('G-code system B');
  });

  it('writes back exactly what it read', () => {
    const raw = sample('valid');
    expect(serializeMachinesFile(parseMachinesFile(raw))).toEqual(withoutVersion(raw));
  });

  it('leaves the `$version` to Rust, which refuses to stamp a newer file down', () => {
    expect(serializeMachinesFile(parseMachinesFile(sample('valid')))).not.toHaveProperty('$version');
  });
});

describe('a broken file', () => {
  // The sample is the mistake a hand edit really makes: the list of machines written
  // where the object belongs. Rust refuses it with "expected a JSON object", so
  // `config_load` answers `{}` plus `machinesError` — and the webview must refuse it too,
  // because a file it does not understand is never the file it overwrites.
  it('gives no machines and an error, whatever shape it has', () => {
    for (const raw of [JSON.parse(text('broken')), null, 'a string', 42, [1, 2, 3]]) {
      const file = parseMachinesFile(raw);
      expect(file.machines).toEqual([]);
      expect(file.error).toContain('JSON object');
    }
  });

  it('is handed over as {} when Rust could not parse it, which is a usable empty file', () => {
    const file = parseMachinesFile({});
    expect(file.error).toBeNull();
    expect(file.machines).toEqual([]);
  });

  it('refuses a "machines" or "defaults" member of the wrong shape instead of dropping it', () => {
    expect(parseMachinesFile({ machines: { a: 1 } }).error).toContain('"machines" must be a list');
    expect(parseMachinesFile({ defaults: [] }).error).toContain('"defaults" must be a JSON object');
  });
});

describe('a file from a newer gEdit', () => {
  it('reports its version, so the service can refuse to write it', () => {
    const file = parseMachinesFile(sample('newer-version'));
    expect(file.version).toBe(2);
    expect(file.version).toBeGreaterThan(MACHINES_VERSION);
    expect(file.machines.map((m) => m.id)).toEqual(['lathe-2']);
  });

  it('keeps every member it does not know, at the record level and at the top', () => {
    const raw = sample('newer-version');
    const file = parseMachinesFile(raw);
    expect(file.unknown).toEqual({ workshop: 'hall 2' });
    expect(file.machines[0]).toHaveProperty('spindleGearRange', 'low');
    expect(serializeMachinesFile(file)).toEqual(withoutVersion(raw));
  });
});

describe('a record this build cannot identify', () => {
  it('is kept verbatim with its problem and is not one of the machines', () => {
    const file = parseMachinesFile(sample('invalid-record'));
    expect(file.machines.map((m) => m.id)).toEqual(['lathe-c', 'lathe-ok']);
    expect(file.invalid).toHaveLength(1);
    expect(file.invalid[0].raw).toEqual(sample('invalid-record').machines?.[0 as never]);
    expect(file.invalid[0].problems[0].path).toBe('machines[0].id');
    expect(file.invalid[0].problems[0].machineId).toBe('Lathe 2');
  });

  it('is written back byte-stable, in its own position', () => {
    const raw = sample('invalid-record');
    const written = serializeMachinesFile(parseMachinesFile(raw));
    expect(written).toEqual(withoutVersion(raw));
    expect((written.machines as { id: string }[])[0].id).toBe('Lathe 2');
  });

  it('keeps a defaults entry that names a machine nobody has, so a rename is recoverable', () => {
    expect(parseMachinesFile(sample('invalid-record')).defaults).toEqual({ 'fanuc-lathe': 'gone' });
  });

  it('refuses a duplicate id and a duplicate name, keeping the first of each', () => {
    const file = parseMachinesFile({
      machines: [
        { id: 'a', name: 'One', profile: 'p', params: {} },
        { id: 'a', name: 'Two', profile: 'p', params: {} },
        { id: 'b', name: 'ONE', profile: 'p', params: {} },
      ],
    });
    expect(file.machines.map((m) => m.id)).toEqual(['a']);
    expect(file.invalid.map((entry) => entry.problems[0].path)).toEqual([
      'machines[1].id',
      'machines[2].name',
    ]);
  });

  it(`keeps the records over the limit of ${MAX_MACHINES} instead of writing them away`, () => {
    const many = Array.from({ length: MAX_MACHINES + 2 }, (_unused, n) => ({
      id: `m-${n}`,
      name: `M ${n}`,
      profile: 'p',
      params: {},
    }));
    const file = parseMachinesFile({ machines: many });
    expect(file.machines).toHaveLength(MAX_MACHINES);
    expect(file.invalid).toHaveLength(2);
    expect(file.invalid[0].problems[0].message).toContain(`at most ${MAX_MACHINES}`);
    expect(serializeMachinesFile(file).machines).toEqual(many);
  });
});

describe('writing', () => {
  it('appends a record that has no position in the file, in the order it was given', () => {
    const file = parseMachinesFile(sample('valid'));
    const added: MachineConfig[] = [
      { id: 'new-a', name: 'New A', profile: 'fanuc-gcode', params: {} },
      { id: 'new-b', name: 'New B', profile: 'fanuc-gcode', params: {} },
    ];
    const written = serializeMachinesFile({ ...file, machines: [...file.machines, ...added] });
    expect((written.machines as MachineConfig[]).map((m) => m.id)).toEqual([
      'lathe-2',
      'mill-1',
      'new-a',
      'new-b',
    ]);
  });

  it('keeps an edited record where it was, so a diff of the file shows the one change', () => {
    const file = parseMachinesFile(sample('valid'));
    const [first, second] = file.machines;
    const edited = keepPosition({ ...first, name: 'Lathe two' }, first);
    const written = serializeMachinesFile({ ...file, machines: [second, edited] });
    expect((written.machines as MachineConfig[]).map((m) => m.name)).toEqual(['Lathe two', 'Mill 1']);
  });

  it('writes an empty file as an empty list and no defaults', () => {
    expect(serializeMachinesFile(emptyMachinesFile())).toEqual({ machines: [], defaults: {} });
  });
});
