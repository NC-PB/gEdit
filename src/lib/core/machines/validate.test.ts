// What makes a stored machine usable (plan §7.15, AD-31). Owner: WP6.8.
//
// Each rule on its own, because each of them protects a different way of misreading a
// program: the id ties a document to a machine, the number input decides what `X50` is,
// the variant decides which code database answers, and the power-on state decides what is
// assumed before the program says anything.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import { validateProfile } from '$lib/core/profiles/validate';
import { codes } from '$lib/stores/codes';
import { channelBlock, isAssignOnly, MACHINE_ID_RE, MAX_NOTES_LENGTH, readMachine, singleBraceNames, validateChannels, validateMachine } from './validate';
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

describe('M12 (P12): the channel block', () => {
  const base: MachineConfig = { id: 'twin', name: 'Twin', profile: 'fanuc-lathe', params: {} };

  it('is absent without a channels member, and costs the record nothing', () => {
    expect(channelBlock(base, 'machines[0]')).toEqual({ state: 'absent' });
    const withBlock = { ...base, params: { channels: { layout: 'single-file', list: [], syncMarks: [] } } } as MachineConfig;
    expect(validateMachine(withBlock, { path: 'machines[0]', profile: profile('fanuc-lathe') })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WP12.3: every rule of §7.17 with one failing case, and the plain messages.
// ---------------------------------------------------------------------------

type Block = Record<string, unknown>;

/** A valid single-file block; each test breaks one thing. */
function good(): Block {
  return {
    layout: 'single-file',
    list: [
      { id: 'a', name: 'Turret A', aliases: ['G13'] },
      { id: 'b', name: 'Turret B', aliases: ['G14'] },
    ],
    sectionStart: '(?<channel>G1[34])',
    syncMarks: [
      { id: 'w', label: 'Waits', match: { kind: 'codes', codes: 'M100-M199, M300' }, partners: { kind: 'all' } },
    ],
  };
}

function multi(): Block {
  return {
    layout: 'multi-file',
    list: [
      { id: '1', name: 'Path 1' },
      { id: '2', name: 'Path 2' },
    ],
    fileName: '^(?<stem>.+)\\.(?<channel>\\d)$',
    syncMarks: [],
  };
}

const checkCh = (block: unknown, o: { waitLetters?: string[] } = {}) =>
  validateChannels(block, 'machines[0].params.channels', 'twin', o);
const rel = (list: { path: string }[]) => list.map((p) => p.path.replace('machines[0].params.channels', '').replace(/^\./, ''));

describe('M12 (WP12.3): validateChannels', () => {
  it('accepts a valid single-file and multi-file block, and keeps unknown members quiet', () => {
    expect(checkCh(good())).toEqual([]);
    expect(checkCh(multi())).toEqual([]);
    expect(checkCh({ ...good(), future: { a: 1 } })).toEqual([]);
  });

  it('needs an object with a layout of single-file or multi-file', () => {
    expect(rel(checkCh('x'))).toEqual(['']);
    expect(rel(checkCh({ ...good(), layout: 'none' }))).toContain('layout');
    expect(checkCh({ ...good(), layout: 'both' })[0].message).toMatch(/single-file.*multi-file/);
  });

  it('needs two to 32 channels with a valid, unique id and a name of 1 to 32 characters', () => {
    expect(rel(checkCh({ ...good(), list: [{ id: 'a', name: 'A' }] }))).toEqual(['list']);
    const many = Array.from({ length: 33 }, (_, i) => ({ id: `c${i}`, name: `C${i}` }));
    expect(rel(checkCh({ ...good(), list: many, sectionStart: undefined }))).toContain('list');
    expect(rel(checkCh({ ...good(), list: 'x' }))).toEqual(['list']);
    const bad = (entry: unknown) => rel(checkCh({ ...good(), list: [entry, { id: 'b', name: 'B' }] }));
    expect(bad({ id: 'A!', name: 'A' })).toEqual(['list[0].id']);
    expect(bad({ id: 'a'.repeat(17), name: 'A' })).toEqual(['list[0].id']);
    expect(bad({ id: 'a', name: '' })).toEqual(['list[0].name']);
    expect(bad({ id: 'a', name: 'x'.repeat(33) })).toEqual(['list[0].name']);
    expect(bad('nope')).toEqual(['list[0]']);
    // ids are unique (the id pattern is lower case, so a case-only clash cannot be written)
    const dup = checkCh({ ...good(), list: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] });
    expect(rel(dup)).toEqual(['list[1].id']);
    expect(dup[0].message).toMatch(/already used/);
  });

  it('checks aliases: at most 8, 1 to 32 characters, unique across the list, never another channel’s id', () => {
    const withAliases = (a: unknown, b: unknown = ['G14']) =>
      rel(checkCh({ ...good(), list: [{ id: 'a', name: 'A', aliases: a }, { id: 'b', name: 'B', aliases: b }] }));
    expect(withAliases(['G13'])).toEqual([]);
    expect(withAliases('G13')).toEqual(['list[0].aliases']);
    expect(withAliases(Array.from({ length: 9 }, (_, i) => `X${i}`))).toEqual(['list[0].aliases']);
    expect(withAliases([''])).toEqual(['list[0].aliases[0]']);
    expect(withAliases(['x'.repeat(33)])).toEqual(['list[0].aliases[0]']);
    expect(withAliases(['G13'], ['g13'])).toEqual(['list[1].aliases[0]']);
    expect(withAliases(['G13', 'g13'])).toEqual(['list[0].aliases[1]']);
    const clash = checkCh({ ...good(), list: [{ id: 'a', name: 'A', aliases: ['B'] }, { id: 'b', name: 'B' }] });
    expect(rel(clash)).toEqual(['list[0].aliases[0]']);
    expect(clash[0].message).toMatch(/id of another channel/);
    // the channel's own id as a spelling is harmless
    expect(withAliases(['A'])).toEqual([]);
  });

  it('wants the patterns the layout needs and none of the other layout’s', () => {
    expect(rel(checkCh({ ...good(), sectionStart: undefined }))).toEqual(['sectionStart']);
    expect(rel(checkCh({ ...good(), marker: '(?<channel>X)' }))).toEqual(['marker']);
    expect(rel(checkCh({ ...good(), fileName: 'x' }))).toEqual(['fileName']);
    expect(rel(checkCh({ ...multi(), sectionStart: '(?<channel>G1)' }))).toEqual(['sectionStart']);
    expect(rel(checkCh({ ...multi(), sectionEnd: 'M30' }))).toEqual(['sectionEnd']);
    expect(rel(checkCh({ ...good(), list: [{ id: 'a', name: 'A', fileName: '{{stem}}.1' }, { id: 'b', name: 'B' }] }))).toEqual(['list[0].fileName']);
  });

  it('checks every pattern: it compiles, is at most 1,000 characters and stays in the AD-11 subset', () => {
    expect(rel(checkCh({ ...good(), sectionStart: '(' }))).toEqual(['sectionStart']);
    expect(checkCh({ ...good(), sectionStart: '(' })[0].message).toMatch(/not a valid pattern/);
    expect(rel(checkCh({ ...good(), sectionStart: `(?<channel>${'x'.repeat(1000)})` }))).toEqual(['sectionStart']);
    expect(rel(checkCh({ ...good(), sectionEnd: '\\p{L}' }))).toEqual(['sectionEnd']);
    expect(checkCh({ ...good(), sectionEnd: '\\p{L}' })[0].message).toMatch(/pattern language/);
    expect(rel(checkCh({ ...good(), sectionStart: 7 }))).toEqual(['sectionStart']);
    expect(rel(checkCh({ ...multi(), fileName: '(' }))).toEqual(['fileName']);
    expect(rel(checkCh({ ...multi(), marker: '(' }))).toEqual(['marker']);
  });

  it('allows a section start without a channel capture (the Nth start is the Nth channel)', () => {
    expect(checkCh({ ...good(), sectionStart: 'G1[34]' })).toEqual([]);
  });

  it('wants a single non-word character as the section separator', () => {
    expect(checkCh({ ...good(), sectionSeparator: '/' })).toEqual([]);
    for (const bad of ['', 'ab', 'a', ' ', 5]) expect(rel(checkCh({ ...good(), sectionSeparator: bad }))).toEqual(['sectionSeparator']);
  });

  it('wants a file name pattern with stem and channel, a marker with channel, templates with stem and channel only', () => {
    expect(rel(checkCh({ ...multi(), fileName: '(?<stem>.+)\\.1' }))).toEqual(['fileName']);
    expect(rel(checkCh({ ...multi(), fileName: '(?<channel>.+)' }))).toEqual(['fileName']);
    expect(rel(checkCh({ ...multi(), marker: 'CH2' }))).toEqual(['marker']);
    expect(checkCh({ ...multi(), marker: '(?<channel>CH\\d)' })).toEqual([]);
    expect(checkCh({ ...multi(), fileNameFor: '{{stem}}_{{channel}}.nc' })).toEqual([]);
    const strange = checkCh({ ...multi(), fileNameFor: '{{stem}}_{{path}}.nc' });
    expect(rel(strange)).toEqual(['fileNameFor']);
    expect(strange[0].message).toMatch(/\{\{path\}\}/);
    expect(rel(checkCh({ ...multi(), fileNameFor: '' }))).toEqual(['fileNameFor']);
    const per = { ...multi(), list: [{ id: '1', name: 'P1', fileName: '{{stem}}.{{n}}' }, { id: '2', name: 'P2' }] };
    expect(rel(checkCh(per))).toEqual(['list[0].fileName']);
  });

  it('refuses a single-brace {stem} or {channel}, and a template that never names the channel (CODE-4)', () => {
    const one = checkCh({ ...multi(), fileNameFor: '{stem}.NC{channel}' });
    expect(rel(one)).toEqual(['fileNameFor']);
    expect(one[0].message).toContain('{{stem}}');
    expect(one[0].message).toContain('{{channel}}');
    expect(rel(checkCh({ ...multi(), fileNameFor: '{{stem}}.NC' }))).toEqual(['fileNameFor']);
    expect(checkCh({ ...multi(), fileNameFor: '{{stem}}.NC' })[0].message).toMatch(/same name/);
    const per = { ...multi(), list: [{ id: '1', name: 'P1', fileName: '{stem}.MPF' }, { id: '2', name: 'P2' }] };
    expect(rel(checkCh(per))).toEqual(['list[0].fileName']);
    expect(checkCh({ ...multi(), fileNameFor: '{{stem}}_CH{{channel}}.nc' })).toEqual([]);
  });

  it('refuses a repeated group that repeats or chooses inside, and keeps the harmless shapes (CODE-1 part 1)', () => {
    for (const bad of ['M(?<mark>(\\d+)+)X', '^(a|aa)+$', '(.*)*', '(?:\\s*\\d+)*', '((a+)b)+', '(a{2,})+']) {
      const problems = checkCh({ ...good(), sectionStart: `(?<channel>G1)${bad}` });
      expect(rel(problems), bad).toEqual(['sectionStart']);
      expect(problems[0].message, bad).toMatch(/very long/);
    }
    for (const fine of ['(?<mark>\\d+)', '(?:M|G)\\d+', '(\\d+)(?:\\.\\d+)?', '[(+*]+', '\\(\\d+\\)+', '(?:ab){2,5}', '(?<![A-Z0-9.])G1[34](?![\\d.])']) {
      expect(checkCh({ ...good(), sectionStart: `(?<channel>G1)${fine}` }), fine).toEqual([]);
    }
    const rule = { id: 'w', label: 'W', match: { kind: 'regex', pattern: 'M(?<mark>(\\d+)+)X' }, partners: { kind: 'all' } };
    expect(rel(checkCh({ ...good(), syncMarks: [rule] }))).toEqual(['syncMarks[0].match.pattern']);
  });

  it('stops running a stored block with a dangerous pattern: channelBlock reports it invalid (CODE-1)', () => {
    const m = { id: 'm', name: 'M', profile: 'fanuc-lathe', params: { channels: { ...good(), sectionStart: '(?<channel>G1)(\\d+)+' } } } as unknown as MachineConfig;
    expect(channelBlock(m, 'machines').state).toBe('invalid');
  });

  it('accepts a multi-file block nothing addresses, and isAssignOnly says so', () => {
    const bare = { layout: 'multi-file', list: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }], syncMarks: [] };
    expect(checkCh(bare)).toEqual([]);
    expect(isAssignOnly(bare as never)).toBe(true);
    expect(isAssignOnly(multi() as never)).toBe(false);
    expect(isAssignOnly({ ...bare, marker: '(?<channel>X)' } as never)).toBe(false);
    const templated = { ...bare, list: [{ id: '1', name: 'A', fileName: 'a' }, { id: '2', name: 'B', fileName: 'b' }] };
    expect(isAssignOnly(templated as never)).toBe(false);
    expect(isAssignOnly(good() as never)).toBe(false);
  });

  const rule = (over: Block): Block => ({ ...good(), syncMarks: [{ id: 'w', label: 'W', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' }, ...over }] });

  it('checks a sync rule: unique id, semantics, blocking, label', () => {
    const two = { ...good(), syncMarks: [(good().syncMarks as Block[])[0], (good().syncMarks as Block[])[0]] };
    expect(rel(checkCh(two))).toEqual(['syncMarks[1].id']);
    expect(rel(checkCh(rule({ id: '' })))).toEqual(['syncMarks[0].id']);
    expect(rel(checkCh(rule({ id: 'stops-and-ends' })))).toEqual(['syncMarks[0].id']);
    expect(rel(checkCh(rule({ semantics: 'sometimes' })))).toEqual(['syncMarks[0].semantics']);
    expect(rel(checkCh(rule({ blocking: 'yes' })))).toEqual(['syncMarks[0].blocking']);
    expect(rel(checkCh(rule({ label: undefined })))).toEqual(['syncMarks[0].label']);
    for (const semantics of ['rendezvous', 'count', 'ordered']) expect(checkCh(rule({ semantics }))).toEqual([]);
    expect(rel(checkCh({ ...good(), syncMarks: Array.from({ length: 33 }, (_, i) => ({ ...(good().syncMarks as Block[])[0], id: `r${i}` })) }))).toEqual(['syncMarks']);
    expect(rel(checkCh({ ...good(), syncMarks: {} }))).toEqual(['syncMarks']);
    expect(rel(checkCh({ ...good(), syncMarks: ['x'] }))).toEqual(['syncMarks[0]']);
  });

  it('names the bad item of a wait-code list in plain words, and honours the profile’s letters', () => {
    const codes = (text: unknown, letters?: string[]) => checkCh(rule({ match: { kind: 'codes', codes: text } }), { waitLetters: letters });
    expect(codes('M100-M199, M300 M350')).toEqual([]);
    expect(rel(codes('M2O0'))).toEqual(['syncMarks[0].match.codes']);
    expect(codes('M2O0')[0].message).toBe('“M2O0”: not a number.');
    expect(codes('M199-M100')[0].message).toBe('“M199-M100”: the range runs backwards.');
    expect(codes('')[0].message).toMatch(/at least one code/);
    expect(codes('G4', ['M'])[0].message).toBe('“G4”: wait codes on this control use M.');
    expect(codes('M100, X')[0].message).toMatch(/“X”/);
    expect(rel(codes(5))).toEqual(['syncMarks[0].match.codes']);
    expect(rel(checkCh(rule({ match: { kind: 'sideways' } })))).toEqual(['syncMarks[0].match.kind']);
    expect(rel(checkCh(rule({ match: 'x' })))).toEqual(['syncMarks[0].match']);
  });

  it('checks a prefix rule and a regex rule: a mark capture is required, except for count', () => {
    expect(checkCh(rule({ match: { kind: 'prefix', prefix: 'M1', idDigits: { min: 2, max: 2 } } }))).toEqual([]);
    expect(rel(checkCh(rule({ match: { kind: 'prefix', prefix: '' } })))).toEqual(['syncMarks[0].match.prefix']);
    expect(rel(checkCh(rule({ match: { kind: 'prefix', prefix: 'M1', idDigits: { min: 3, max: 2 } } })))).toEqual(['syncMarks[0].match.idDigits']);
    const regex = (pattern: string, semantics?: string) => checkCh(rule({ match: { kind: 'regex', pattern }, semantics }));
    expect(regex('WAITM\\((?<mark>\\d+)')).toEqual([]);
    expect(rel(regex('WAITM\\((\\d+)'))).toEqual(['syncMarks[0].match.pattern']);
    expect(regex('WAITM\\((\\d+)')[0].message).toMatch(/\(\?<mark>/);
    expect(regex('M100', 'count')).toEqual([]); // a count rule has no id
    expect(rel(regex('('))).toEqual(['syncMarks[0].match.pattern']);
    expect(rel(regex('x'.repeat(1001)))).toEqual(['syncMarks[0].match.pattern']);
  });

  it('checks the partners: fixed names declared channels or aliases; word and line forms', () => {
    const p = (partners: Block) => rel(checkCh(rule({ partners })));
    expect(p({ kind: 'all' })).toEqual([]);
    expect(p({ kind: 'fixed', channels: ['a', 'G14'] })).toEqual([]);
    expect(p({ kind: 'fixed', channels: ['a', 'zz'] })).toEqual(['syncMarks[0].partners.channels[1]']);
    expect(checkCh(rule({ partners: { kind: 'fixed', channels: ['zz'] } }))[0].message).toMatch(/“?"?zz"? is not a channel/);
    expect(p({ kind: 'fixed', channels: [] })).toEqual(['syncMarks[0].partners.channels']);
    expect(p({ kind: 'word', address: 'P', decode: 'digits' })).toEqual([]);
    expect(p({ kind: 'word', address: 'P', decode: 'bitmask', whenAbsent: { kind: 'fixed', channels: ['a', 'b'] } })).toEqual([]);
    expect(p({ kind: 'word', address: 'PP', decode: 'digits' })).toEqual(['syncMarks[0].partners.address']);
    expect(p({ kind: 'word', address: 'P', decode: 'split' })).toEqual(['syncMarks[0].partners.decode']);
    expect(p({ kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'maybe' } })).toEqual(['syncMarks[0].partners.whenAbsent']);
    expect(p({ kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'fixed', channels: ['q'] } })).toEqual(['syncMarks[0].partners.whenAbsent.channels[0]']);
    expect(p({ kind: 'line', pattern: 'WAITM\\((?<channels>[^)]*)\\)' })).toEqual([]);
    expect(p({ kind: 'line', pattern: 'WAITM' })).toEqual(['syncMarks[0].partners.pattern']);
    expect(p({ kind: 'line', pattern: '(?<channels>.)', decode: 'hex' })).toEqual(['syncMarks[0].partners.decode']);
    expect(p({ kind: 'line', pattern: '(?<channels>.)', separator: 5 })).toEqual(['syncMarks[0].partners.separator']);
    expect(p({ kind: 'nobody' })).toEqual(['syncMarks[0].partners.kind']);
    expect(rel(checkCh(rule({ partners: undefined })))).toEqual(['syncMarks[0].partners']);
  });

  it('checks stopsAndEndsWait is a boolean', () => {
    expect(checkCh({ ...good(), stopsAndEndsWait: true })).toEqual([]);
    expect(rel(checkCh({ ...good(), stopsAndEndsWait: 'yes' }))).toEqual(['stopsAndEndsWait']);
  });

  it('carries the machine id and the JSON path in every problem', () => {
    const [first] = checkCh({ ...good(), sectionStart: '(' });
    expect(first).toMatchObject({ machineId: 'twin', path: 'machines[0].params.channels.sectionStart' });
  });
});

describe('M12 (WP12.3): channelBlock', () => {
  const base: MachineConfig = { id: 'twin', name: 'Twin', profile: 'fanuc-lathe', params: {} };
  const withBlock = (channels: unknown) => ({ ...base, params: { channels } }) as MachineConfig;

  it('is valid for a good block, with a missing syncMarks read as no rules', () => {
    const block = channelBlock(withBlock(good()), 'machines[0]');
    expect(block.state).toBe('valid');
    const { syncMarks: _omit, ...noRules } = good();
    void _omit;
    const read = channelBlock(withBlock(noRules), 'machines[0]');
    expect(read.state === 'valid' && read.params.syncMarks).toEqual([]);
  });

  it('is invalid with the problems of a bad block, kept for the page, and costs the record nothing', () => {
    const broken = withBlock({ ...good(), sectionStart: '(' });
    const block = channelBlock(broken, 'machines[0]');
    expect(block.state).toBe('invalid');
    if (block.state === 'invalid') expect(block.problems[0].path).toBe('machines[0].params.channels.sectionStart');
    expect(validateMachine(broken, { path: 'machines[0]', profile: profile('fanuc-lathe') })).toEqual([]);
  });
});

describe('the user guide writes file name templates the way the product reads them (CODE-4)', () => {
  it('never writes {stem} or {channel} with one brace', () => {
    const dir = new URL('../../../../docs/user/', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(new URL(file, dir), 'utf8');
      expect(singleBraceNames(text), file).toEqual([]);
    }
  });
});
