// What makes a stored machine usable (plan §7.15, AD-31). Owner: WP6.8.
//
// Each rule on its own, because each of them protects a different way of misreading a
// program: the id ties a document to a machine, the number input decides what `X50` is,
// the variant decides which code database answers, and the power-on state decides what is
// assumed before the program says anything.

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import { validateProfile } from '$lib/core/profiles/validate';
import { codes } from '$lib/stores/codes';
import { MACHINE_ID_RE, MAX_NOTES_LENGTH, readMachine, validateMachine } from './validate';
import type { Profile } from '$lib/core/profiles/types';
import type { MachineConfig } from './types';

const PROFILES: Profile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return checked.profile;
});

function profile(id: string): Profile {
  const found = PROFILES.find((p) => p.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

const LATHE = profile('fanuc-lathe');
const MILL = profile('fanuc-gcode');
const KLARTEXT = profile('heidenhain-klartext');

const FRESH = { path: 'machines[0]', ids: new Set<string>(), names: new Set<string>() };

function read(raw: unknown, o: Partial<typeof FRESH> = {}): ReturnType<typeof readMachine> {
  return readMachine(raw, { ...FRESH, ...o });
}

function machine(over: Partial<MachineConfig> = {}): MachineConfig {
  return { id: 'lathe-2', name: 'Lathe 2', profile: 'fanuc-lathe', params: {}, ...over };
}

/**
 * The record against a profile, with the database **its own variants resolve to** — which
 * is what `stores/machines.ts` hands in (`codesFor`). The distinction is the whole point
 * on a lathe: in system A the per-revolution feed mode is `G99` and there is no `G95` at
 * all, while in system B `G95` is exactly that mode. Checking a B machine against the A
 * database would refuse a correct power-on state (I6).
 */
function check(m: MachineConfig, p: Profile | undefined = LATHE): string[] {
  const dialect = p === undefined ? '' : applyMachine(p, effectiveMachine(p, m, 'document', {})).codes;
  return validateMachine(m, {
    path: 'machines[0]',
    profile: p,
    codes: p === undefined ? undefined : codes.byId(dialect),
  }).map((problem) => `${problem.path}: ${problem.message}`);
}

describe('the identity of a record', () => {
  it('takes a well-formed record and keeps every member it does not know', () => {
    const read1 = read({
      id: 'lathe-2',
      name: 'Lathe 2',
      profile: 'fanuc-lathe',
      params: { units: 'inch', spindleGearRange: 'low' },
      notes: 'hall 2',
      workshopTag: 7,
    });
    expect(read1.problems).toEqual([]);
    expect(read1.machine).toHaveProperty('workshopTag', 7);
    expect(read1.machine?.params).toHaveProperty('spindleGearRange', 'low');
  });

  it('refuses anything that is not an object', () => {
    for (const raw of [null, 7, 'x', ['a']]) {
      expect(read(raw).machine).toBeNull();
      expect(read(raw).problems[0].message).toContain('not a JSON object');
    }
  });

  it('insists on an id that per-file memory can point at', () => {
    for (const id of ['', 'Lathe 2', '-lathe', 'lathe_2', 'l'.repeat(65), 7]) {
      const result = read({ id, name: 'Lathe 2', profile: 'fanuc-lathe', params: {} });
      expect(result.machine, String(id)).toBeNull();
      expect(result.problems[0].path).toBe('machines[0].id');
    }
    expect(MACHINE_ID_RE.test('lathe-2')).toBe(true);
    expect(MACHINE_ID_RE.test('2')).toBe(true);
  });

  it('refuses an id that an earlier record already used', () => {
    const result = read({ id: 'lathe-2', name: 'Other', profile: 'p', params: {} }, { ids: new Set(['lathe-2']) });
    expect(result.machine).toBeNull();
    expect(result.problems[0].message).toContain('used by an earlier machine');
  });

  it('refuses a name that is only a different case of one already used', () => {
    const result = read({ id: 'b', name: 'LATHE 2', profile: 'p', params: {} }, { names: new Set(['lathe 2']) });
    expect(result.machine).toBeNull();
    expect(result.problems[0].path).toBe('machines[0].name');
  });

  it('insists on a name, a profile, an object for params and short enough notes', () => {
    expect(read({ id: 'a', name: '   ', profile: 'p', params: {} }).problems[0].path).toBe('machines[0].name');
    expect(read({ id: 'a', name: 'A', params: {} }).problems[0].path).toBe('machines[0].profile');
    expect(read({ id: 'a', name: 'A', profile: 'p', params: 7 }).problems[0].path).toBe('machines[0].params');
    const notes = 'x'.repeat(MAX_NOTES_LENGTH + 1);
    expect(read({ id: 'a', name: 'A', profile: 'p', params: {}, notes }).problems[0].path).toBe('machines[0].notes');
  });

  it('gives a record without params an empty one, so nothing downstream guards for it', () => {
    expect(read({ id: 'a', name: 'A', profile: 'p' }).machine?.params).toEqual({});
  });
});

describe('a record against its base profile', () => {
  it('passes a machine that only picks what the profile declares', () => {
    expect(
      check(
        machine({
          params: {
            numberInput: { mode: 'increment', incrementMm: '0.001', incrementSec: '0.001' },
            units: 'inch',
            diameter: 'off',
            variants: { gcodeSystem: 'B' },
            modalInitial: { feedmode: 'G95' },
          },
        }),
      ),
    ).toEqual([]);
  });

  it('keeps a record whose base profile is not loaded, and says it cannot be used', () => {
    const problems = validateMachine(machine({ profile: 'user-lathe' }), {
      path: 'machines[0]',
      profile: undefined,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].path).toBe('machines[0].profile');
    expect(problems[0].message).toContain('is not loaded');
  });

  it('refuses a machine for a profile that has no machine parameters at all', () => {
    // Klartext declares none, so it has no machine item (§8.8) and no machines either.
    const problems = check(machine({ profile: 'heidenhain-klartext' }), KLARTEXT);
    expect(problems[0]).toContain('no machine parameters');
  });

  it('refuses a variant the profile does not have, and a choice it does not offer', () => {
    expect(check(machine({ params: { variants: { toolFormat: '4' } } }))[0]).toContain('has no variant');
    expect(check(machine({ params: { variants: { gcodeSystem: 'C' } } }))[0]).toContain('"A", "B"');
  });

  it('refuses a diameter mode on a profile that has none, and a value that is not on/off', () => {
    expect(check(machine({ profile: 'fanuc-gcode', params: { diameter: 'on' } }), MILL)[0]).toContain(
      'no diameter mode',
    );
    expect(
      check(machine({ params: { diameter: 'sometimes' as unknown as 'on' } }))[0],
    ).toContain('"on" or "off"');
  });

  it('refuses a unit that is neither mm nor inch', () => {
    expect(check(machine({ params: { units: 'metric' as unknown as 'mm' } }))[0]).toContain('"mm" or "inch"');
  });

  it('refuses a power-on group the profile does not offer', () => {
    expect(check(machine({ params: { modalInitial: { coolant: 'M8' } } }))[0]).toContain('does not offer the group');
  });

  it('refuses a power-on code the database does not have, or that belongs to another group', () => {
    expect(check(machine({ params: { modalInitial: { feedmode: 'G999' } } }))[0]).toContain('is not a code');
    expect(check(machine({ params: { modalInitial: { feedmode: 'G17' } } }))[0]).toContain('belongs to the group');
  });

  it('takes a power-on code as it is written: G099 and g99 are G99', () => {
    for (const code of ['G99', 'G099', 'g99']) {
      expect(check(machine({ params: { modalInitial: { feedmode: code } } })), code).toEqual([]);
    }
  });

  it('checks the groups even when no database is at hand', () => {
    const problems = validateMachine(machine({ params: { modalInitial: { feedmode: 'G999' } } }), {
      path: 'machines[0]',
      profile: LATHE,
    });
    expect(problems).toEqual([]);
  });
});

describe('the stored number input', () => {
  function numberInput(value: unknown): string[] {
    return check(machine({ params: { numberInput: value as MachineConfig['params']['numberInput'] } }));
  }

  it('insists on one of the three readings and on a metric increment above zero', () => {
    expect(numberInput({ mode: 'inches', incrementMm: '0.001' })[0]).toContain('increment, calculator, scale');
    expect(numberInput({ mode: 'increment' })[0]).toContain('incrementMm');
    expect(numberInput({ mode: 'increment', incrementMm: '0' })[0]).toContain('above zero');
    expect(numberInput({ mode: 'increment', incrementMm: 0.001 })[0]).toContain('decimal text');
    expect(numberInput({ mode: 'increment', incrementMm: '1e-3' })[0]).toContain('decimal text');
  });

  it('takes the increments that the presets of §8.8 are written with', () => {
    for (const increment of ['0.001', '0.0001', '0.00001', '0.01', '1']) {
      expect(numberInput({ mode: 'increment', incrementMm: increment }), increment).toEqual([]);
    }
  });

  it('checks the optional increments the same way', () => {
    for (const member of ['incrementInch', 'incrementDeg', 'incrementSec']) {
      const problems = numberInput({ mode: 'increment', incrementMm: '0.001', [member]: '-1' });
      expect(problems[0], member).toContain(member);
    }
  });

  it('checks every per-class override, by name and by value', () => {
    expect(numberInput({ mode: 'increment', incrementMm: '0.001', classes: { torque: {} } })[0]).toContain(
      'not one of length, angle',
    );
    expect(
      numberInput({ mode: 'increment', incrementMm: '0.001', classes: { feedPerRev: { mode: 'as-written' } } })[0],
    ).toContain('increment, calculator, scale');
    expect(
      numberInput({ mode: 'increment', incrementMm: '0.001', classes: { dwell: { increment: 'x' } } })[0],
    ).toContain('decimal text');
    expect(numberInput({ mode: 'increment', incrementMm: '0.001', classes: 'none' })[0]).toContain(
      'classes must be a JSON object',
    );
  });

  it('refuses a number input on a profile that does not read numbers by a setting', () => {
    const m = machine({ profile: 'heidenhain-klartext', params: { numberInput: { mode: 'calculator', incrementMm: '1' } } });
    // Klartext has no `machineParams` at all, so the record is refused one step earlier.
    expect(check(m, KLARTEXT)[0]).toContain('no machine parameters');
  });

  it('takes the whole value of a preset, per-class overrides included', () => {
    expect(
      numberInput({
        mode: 'increment',
        incrementMm: '0.001',
        incrementInch: '0.0001',
        incrementDeg: '0.001',
        incrementSec: '0.001',
        classes: { feedPerMin: { mode: 'calculator' }, feedPerRev: { mode: 'calculator' } },
      }),
    ).toEqual([]);
  });
});
