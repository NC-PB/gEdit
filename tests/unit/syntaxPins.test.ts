// The M9 syntax pins (plan §6 M9, P9 item 4; §7.1 "The M9 syntax pins"). Owned by
// the M9 integration, together with `tests/fixtures/pins/m9-syntax.json`.
//
// P8 pinned the syntax sections of its two new profiles by a rule in the plan. M9 changes
// five live profiles at once — the tokenizer rules of WP9.3, the milling profile of WP9.1,
// the variants of WP9.4 and the content of WP9.5 all read the same `syntax` — so the rule
// is a test as well: every built-in's resolved `syntax` and its outline call rules (the
// `subprogram-call` patterns) equal the pinned record. A content WP that needs another
// value writes a hand-off note; integration applies it and updates the record.
//
// `deferred` lists the values P9 decided but could not write without changing an existing
// golden or snapshot (§5.2 rule 2). WP9.3 writes exactly those, together with the golden
// changes they cause, and this test accepts either the pinned or the deferred value of such
// a member until I9 folds the deferred values into `pinned`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { validateProfile } from '$lib/core/profiles/validate';
import { FIXTURES_DIR } from './helpers/fixtures';
import type { Profile } from '$lib/core/profiles/types';

interface PinRecord {
  syntax: Record<string, unknown>;
  callRules: string[];
}
interface Deferred {
  profiles: string[];
  member: string;
  by: string;
  why: string;
  value: unknown;
}
interface PinFile {
  milestone: string;
  pinned: Record<string, PinRecord>;
  deferred: Deferred[];
}

const PINS = JSON.parse(readFileSync(join(FIXTURES_DIR, 'pins', 'm9-syntax.json'), 'utf8')) as PinFile;

const PROFILES: Profile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return checked.profile;
});

/** What the pin covers of one profile, in the record's shape. */
function recordOf(profile: Profile): PinRecord {
  const outline = (profile as unknown as { outline?: { kind: string; pattern: string }[] }).outline ?? [];
  return {
    syntax: JSON.parse(JSON.stringify(profile.syntax)) as Record<string, unknown>,
    callRules: outline.filter((rule) => rule.kind === 'subprogram-call').map((rule) => rule.pattern),
  };
}

/** The member at `path` (`syntax.keywords`) of a record, or undefined. */
function memberOf(record: PinRecord, path: string): unknown {
  let at: unknown = record;
  for (const part of path.split('.')) {
    if (typeof at !== 'object' || at === null) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

function setMember(record: PinRecord, path: string, value: unknown): void {
  const parts = path.split('.');
  let at = record as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) at = at[part] as Record<string, unknown>;
  at[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
}

/**
 * `actual` with every deferred value that a work package has already written counted as
 * the pinned one (only for the profiles the entry names). A copy; `actual` is not changed.
 */
function acceptingDeferred(id: string, actual: PinRecord, pinned: PinRecord, deferredList: Deferred[]): PinRecord {
  const accepted = JSON.parse(JSON.stringify(actual)) as PinRecord;
  for (const deferred of deferredList) {
    if (!deferred.profiles.includes(id)) continue;
    const now = memberOf(accepted, deferred.member);
    if (JSON.stringify(now) === JSON.stringify(deferred.value)) {
      setMember(accepted, deferred.member, memberOf(pinned, deferred.member));
    }
  }
  return accepted;
}

/** What is wrong with a deferred list against the pinned records, as messages. */
function deferredProblems(pins: Record<string, PinRecord>, deferredList: Deferred[]): string[] {
  const problems: string[] = [];
  for (const deferred of deferredList) {
    for (const id of deferred.profiles) {
      const pinned = pins[id];
      if (pinned === undefined) {
        problems.push(`${id} has no pin record`);
        continue;
      }
      const current = memberOf(pinned, deferred.member);
      if (current === undefined) problems.push(`${id} ${deferred.member} is not in the pinned record`);
      else if (JSON.stringify(current) === JSON.stringify(deferred.value)) problems.push(`${id} ${deferred.member} is deferred to its pinned value`);
    }
  }
  return problems;
}

describe('the M9 syntax pins', () => {
  it('pin every built-in profile, and nothing else', () => {
    expect(Object.keys(PINS.pinned).sort()).toEqual(PROFILES.map((p) => p.id).sort());
  });

  for (const profile of PROFILES) {
    it(`${profile.id}: the syntax section and the call rules are the pinned ones`, () => {
      const actual = recordOf(profile);
      const pinned = PINS.pinned[profile.id];
      expect(pinned, `${profile.id} has no pin record`).toBeDefined();
      // A deferred value that a work package has written counts as the pinned one.
      expect(acceptingDeferred(profile.id, actual, pinned, PINS.deferred)).toEqual(pinned);
    });
  }

  it('keeps a deferred list that names real members and values that differ from the pinned ones', () => {
    // Empty since I9 folded the three values in; the check is for the day one is added again.
    expect(Array.isArray(PINS.deferred)).toBe(true);
    expect(deferredProblems(PINS.pinned, PINS.deferred)).toEqual([]);
  });
});

// The deferred machinery above is dead code while the list is empty, so it is tested on a
// list of its own: a regression in it would otherwise wait for the next deferred pin.
describe('the deferred pins, on a list of their own', () => {
  const pinned: Record<string, PinRecord> = {
    a: { syntax: { keywords: ['IF'], header: 'old' }, callRules: [] },
    b: { syntax: { keywords: ['IF'], header: 'old' }, callRules: [] },
  };
  const deferred: Deferred[] = [{ profiles: ['a'], member: 'syntax.header', by: 'WP', why: 'a golden', value: 'new' }];
  /** The profile as it is once the work package has written the deferred value. */
  const written = (id: string): PinRecord => ({ ...pinned[id], syntax: { ...pinned[id].syntax, header: 'new' } });

  it('accepts the deferred value as the pinned one for the profile it names', () => {
    expect(acceptingDeferred('a', written('a'), pinned.a, deferred)).toEqual(pinned.a);
  });

  it('still accepts the pinned value', () => {
    expect(acceptingDeferred('a', pinned.a, pinned.a, deferred)).toEqual(pinned.a);
  });

  it('does not accept it for a profile the entry does not name', () => {
    expect(acceptingDeferred('b', written('b'), pinned.b, deferred)).not.toEqual(pinned.b);
  });

  it('does not accept a third value', () => {
    const other = { ...pinned.a, syntax: { ...pinned.a.syntax, header: 'else' } };
    expect(acceptingDeferred('a', other, pinned.a, deferred)).not.toEqual(pinned.a);
  });

  it('refuses a deferred list that names a missing record or member, or the pinned value itself', () => {
    expect(deferredProblems(pinned, deferred)).toEqual([]);
    expect(deferredProblems(pinned, [{ ...deferred[0], profiles: ['zz'] }])).toEqual(['zz has no pin record']);
    expect(deferredProblems(pinned, [{ ...deferred[0], member: 'syntax.nope' }])).toEqual(['a syntax.nope is not in the pinned record']);
    expect(deferredProblems(pinned, [{ ...deferred[0], value: 'old' }])).toEqual(['a syntax.header is deferred to its pinned value']);
  });
});
