// The effective machine (plan §7.15, AD-31). Written with `effective.ts` by the M6
// prelude (P6); **WP6.8 owns both from Wave A on** and adds the selection-order and
// mismatch cases that need the service around them.

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { validateProfile } from '$lib/core/profiles/validate';
import { applyMachine, compatible, defaultParams, effectiveKey, effectiveMachine, noMachine } from './effective';
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

function machine(over: Partial<MachineConfig> = {}): MachineConfig {
  return { id: 'lathe-2', name: 'Lathe 2', profile: 'fanuc-lathe', params: {}, ...over };
}

const LATHE = profile('fanuc-lathe');
const MILL = profile('fanuc-gcode');
const KLARTEXT = profile('heidenhain-klartext');

describe('defaultParams', () => {
  it('takes the declared default preset, the units and the diameter parameter', () => {
    const params = defaultParams(LATHE);
    // §8.8: the lathe's default preset is `calculator`, the mill's is `is-b`.
    expect(params.numberInput?.mode).toBe('calculator');
    expect(params.units).toBe('mm');
    expect(params.diameter).toBe('on');
    expect(params.variants).toEqual({ gcodeSystem: 'A' });
    expect(defaultParams(MILL).numberInput?.mode).toBe('increment');
    expect(defaultParams(MILL).diameter).toBeNull();
  });

  it('answers for a profile that declares no machine parameters at all', () => {
    // Klartext has no machine item (§8.8); "no parameters" is an answer, not a gap.
    expect(defaultParams(KLARTEXT)).toEqual({
      numberInput: null,
      units: 'mm',
      diameter: null,
      variants: {},
      modalInitial: {},
    });
  });

  it('leaves the power-on state to the profile, so an overlay is not undone', () => {
    // `modalInitial` holds only what a MACHINE sets. If it carried the profile's own
    // `modal.initial`, applying it after a variant overlay would put `G99` back over the
    // `G95` that G-code system B just set.
    expect(defaultParams(LATHE).modalInitial).toEqual({});
  });
});

describe('effectiveMachine', () => {
  it('records the source of every parameter', () => {
    const eff = effectiveMachine(LATHE, machine({ params: { units: 'inch' } }), 'document', {});
    expect(eff.params.units).toBe('inch');
    expect(eff.source.units).toBe('machine');
    expect(eff.source.numberInput).toBe('profile');
    expect(eff.source.diameter).toBe('profile');
    expect(eff.choice).toBe('document');
    expect(eff.id).toBe('lathe-2');
  });

  it('takes a detected variant only when there is no machine, and only above the margin', () => {
    const detected = { gcodeSystem: { value: 'B', margin: 3 } };
    const none = effectiveMachine(LATHE, null, 'none', detected);
    expect(none.params.variants.gcodeSystem).toBe('B');
    expect(none.source.variants.gcodeSystem).toBe('detected');

    const weak = effectiveMachine(LATHE, null, 'none', { gcodeSystem: { value: 'B', margin: 2 } });
    expect(weak.params.variants.gcodeSystem).toBe('A');
    expect(weak.source.variants.gcodeSystem).toBe('profile');
  });

  it('lets an explicit machine win over detection and reports the disagreement once', () => {
    const chosen = machine({ params: { variants: { gcodeSystem: 'A' } } });
    const eff = effectiveMachine(LATHE, chosen, 'document', { gcodeSystem: { value: 'B', margin: 5 } });
    expect(eff.params.variants.gcodeSystem).toBe('A');
    expect(eff.source.variants.gcodeSystem).toBe('machine');
    expect(eff.mismatch).toEqual({ variant: 'gcodeSystem', detected: 'B', chosen: 'A' });
  });

  it('ignores a variant value and a modal group the profile does not offer', () => {
    const odd = machine({
      params: { variants: { gcodeSystem: 'Z', nosuch: 'x' }, modalInitial: { feedmode: 'G95', coolant: 'M8' } },
    });
    const eff = effectiveMachine(LATHE, odd, 'document', {});
    expect(eff.params.variants).toEqual({ gcodeSystem: 'A' });
    expect(eff.params.modalInitial).toEqual({ feedmode: 'G95' });
  });

  it('refuses a diameter setting on a profile that has no such parameter', () => {
    const eff = effectiveMachine(MILL, machine({ profile: 'fanuc-gcode', params: { diameter: 'on' } }), 'document', {});
    expect(eff.params.diameter).toBeNull();
    expect(eff.source.diameter).toBe('profile');
  });

  it('keys two machines with the same parameters alike, and a rename does not move the key', () => {
    const a = effectiveMachine(LATHE, machine({ params: { units: 'inch' } }), 'document', {});
    const b = effectiveMachine(LATHE, machine({ id: 'other', name: 'Other', params: { units: 'inch' } }), 'default', {});
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(noMachine(LATHE).key);
    expect(effectiveKey(LATHE.id, a.params, a.source)).toBe(a.key);
    // The key of §7.15 — profile and parameters — is what a caller without a source gets.
    expect(a.key.startsWith(effectiveKey(LATHE.id, a.params))).toBe(true);
  });

  it('keys a detected parameter apart from the same parameter a machine states', () => {
    // G8 M6. The profile a key caches carries `modal.sources`, which comes out of
    // `source` and out of nothing else — so two documents whose parameters agree and
    // whose provenance does not must not share one compile. Document A has no machine and
    // the program says system B; document B has a machine that says so. Same parameters,
    // and the second one would otherwise have been told "detected" for every assumed
    // value of a document where the user had chosen the machine himself, or the other way
    // round.
    const detected = effectiveMachine(LATHE, null, 'none', { gcodeSystem: { value: 'B', margin: 4 } });
    const stated = effectiveMachine(LATHE, machine({ params: { variants: { gcodeSystem: 'B' } } }), 'document', {});
    expect(stated.params).toEqual(detected.params);
    expect(detected.source.variants.gcodeSystem).toBe('detected');
    expect(stated.source.variants.gcodeSystem).toBe('machine');
    expect(detected.key).not.toBe(stated.key);
    // …and the parameters really are the only thing the old key held.
    expect(effectiveKey(LATHE.id, detected.params)).toBe(effectiveKey(LATHE.id, stated.params));
  });
});

describe('applyMachine', () => {
  it('changes nothing but modal.units, modal.diameter and modal.sources without a machine', () => {
    // X10 depends on this: a Phase 1 profile with no machine has to behave exactly as it
    // did in Phase 1.
    for (const p of PROFILES) {
      const applied = applyMachine(p, noMachine(p));
      const { modal: appliedModal, ...appliedRest } = applied.profile as Record<string, unknown>;
      const { modal: ownModal, ...ownRest } = p as unknown as Record<string, unknown>;
      expect(appliedRest, p.id).toEqual(ownRest);
      expect((appliedModal as { initial?: unknown })?.initial, p.id).toEqual(
        (ownModal as { initial?: unknown })?.initial,
      );
      expect(applied.codes, p.id).toBe(p.codes);
    }
  });

  it('writes the power-on units and diameter mode with their source', () => {
    const applied = applyMachine(LATHE, noMachine(LATHE));
    expect(applied.profile.modal?.units).toBe('mm');
    expect(applied.profile.modal?.diameter).toBe('on');
    expect(applied.profile.modal?.sources?.units).toBe('profile');
    expect(applied.profile.modal?.sources?.feedmode).toBe('profile');
    // A mill has no diameter mode at all, and nothing may invent one.
    expect(applyMachine(MILL, noMachine(MILL)).profile.modal?.diameter).toBeUndefined();
  });

  it('applies the chosen variant: its database and its overlay', () => {
    const eff = effectiveMachine(LATHE, machine({ params: { variants: { gcodeSystem: 'B' } } }), 'document', {});
    const applied = applyMachine(LATHE, eff);
    expect(applied.codes).toBe('fanuc-lathe-b');
    // System B powers on in feed per revolution (§8.1); the source is the machine's,
    // because the machine is what chose the G-code system.
    expect(applied.profile.modal?.initial?.feedmode).toBe('G95');
    expect(applied.profile.modal?.sources?.feedmode).toBe('machine');
    expect(applied.profile.modal?.initial?.plane).toBe('G18');
    expect(applied.profile.modal?.sources?.plane).toBe('profile');
  });

  it('puts the machine power-on codes over the variant overlay', () => {
    const eff = effectiveMachine(
      LATHE,
      machine({ params: { variants: { gcodeSystem: 'B' }, modalInitial: { feedmode: 'G98' } } }),
      'document',
      {},
    );
    expect(applyMachine(LATHE, eff).profile.modal?.initial?.feedmode).toBe('G98');
  });

  it('follows the length class when it decides whether a decimal point matters', () => {
    const asWritten = effectiveMachine(
      MILL,
      machine({ profile: 'fanuc-gcode', params: { numberInput: { mode: 'calculator', incrementMm: '1' } } }),
      'document',
      {},
    );
    expect(applyMachine(MILL, asWritten).profile.syntax.decimalPointSignificant).toBe(false);

    const increments = effectiveMachine(
      MILL,
      machine({ profile: 'fanuc-gcode', params: { numberInput: { mode: 'increment', incrementMm: '0.001' } } }),
      'document',
      {},
    );
    expect(applyMachine(MILL, increments).profile.syntax.decimalPointSignificant).toBe(true);

    // A `scale` unit system multiplies a number with a point exactly as it multiplies one
    // without, so the point means nothing there either (AD-31).
    const scaled = effectiveMachine(
      MILL,
      machine({ profile: 'fanuc-gcode', params: { numberInput: { mode: 'scale', incrementMm: '0.001' } } }),
      'document',
      {},
    );
    expect(applyMachine(MILL, scaled).profile.syntax.decimalPointSignificant).toBe(false);
  });

  it('agrees with the profile JSON on what its own default preset means', () => {
    // WP6.1 checks this as a validation rule; here it guards the shipped data, because
    // "no machine" has to equal what the file says (§8.1).
    for (const p of PROFILES) {
      if (p.machineParams?.numberInput === undefined) continue;
      expect(applyMachine(p, noMachine(p)).profile.syntax.decimalPointSignificant, p.id).toBe(
        p.syntax.decimalPointSignificant,
      );
    }
  });
});

describe('compatible', () => {
  it('accepts the machine of a profile the document profile extends', () => {
    expect(compatible(machine(), ['fanuc-lathe', 'fanuc-gcode'])).toBe(true);
    expect(compatible(machine({ profile: 'fanuc-gcode' }), ['fanuc-lathe', 'fanuc-gcode'])).toBe(true);
    expect(compatible(machine(), ['fanuc-gcode'])).toBe(false);
  });
});
