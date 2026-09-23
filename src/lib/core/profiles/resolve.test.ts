// Profile inheritance (plan §7.1, AD-16). Written with `resolve.ts` by the M6 prelude
// (P6); WP6.1 owns both from Wave A on and adds the rest of its table.

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { MAX_EXTENDS_DEPTH, mergeProfile, resolveProfiles } from './resolve';
import type { ProfileSource } from './types';

const builtin = (raw: unknown): ProfileSource => ({ raw, origin: 'builtin' });
const user = (raw: unknown, file = 'user.json'): ProfileSource => ({ raw, origin: 'user', file });

/** A child with the three fields AD-16 makes it write itself. */
function child(id: string, parent: string, rest: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: id, shortName: id, extends: parent, ...rest };
}

describe('mergeProfile', () => {
  it('merges plain objects key by key, recursively', () => {
    const parent = { syntax: { comments: [{ start: '(', end: ')' }], decimalSeparator: '.' } };
    const kid = { syntax: { decimalPointSignificant: false } };
    expect(mergeProfile(parent, kid)).toEqual({
      syntax: {
        comments: [{ start: '(', end: ')' }],
        decimalSeparator: '.',
        decimalPointSignificant: false,
      },
    });
  });

  it('replaces an array whole, because an outline rule list is ordered', () => {
    const parent = { outline: [{ kind: 'tool' }, { kind: 'end' }] };
    expect(mergeProfile(parent, { outline: [{ kind: 'program' }] })).toEqual({
      outline: [{ kind: 'program' }],
    });
  });

  it('replaces a scalar and lets null switch an inherited field off', () => {
    expect(mergeProfile({ a: 1, b: 'x' }, { a: 2, b: null })).toEqual({ a: 2, b: null });
  });

  it('drops $schema and keeps extends', () => {
    const merged = mergeProfile({ $schema: 'p', a: 1 }, { $schema: 'c', extends: 'p' });
    expect(merged).toEqual({ a: 1, extends: 'p' });
  });

  it('never lets a JSON member called __proto__ become a prototype', () => {
    // G8 M6. `JSON.parse` makes `__proto__` an own enumerable member, and writing it into
    // a plain object with `out[key] = …` runs the prototype setter instead: the merged
    // object would silently get a new prototype and no member of that name, and the
    // fields reached through it are visible to the validator and lost by the next copy.
    // Nothing that ships goes down this path; M12's `<config>/profiles` will.
    const hostile = JSON.parse('{"id": "evil", "__proto__": {"syntax": {"decimalSeparator": ","}}}');
    const merged = mergeProfile({ id: 'base', syntax: { decimalSeparator: '.' } }, hostile);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(false);
    expect((merged as { syntax: { decimalSeparator: string } }).syntax.decimalSeparator).toBe('.');
    // …from either side of the merge, and one level down as well.
    const fromParent = mergeProfile(JSON.parse('{"a": {"__proto__": {"b": 1}}}'), {});
    expect(Object.getPrototypeOf(fromParent.a as object)).toBe(Object.prototype);
    expect(fromParent).toEqual({ a: {} });
    // `constructor` and `prototype` are not members of any profile either.
    expect(mergeProfile({}, JSON.parse('{"constructor": 1, "prototype": 2, "id": "x"}'))).toEqual({ id: 'x' });
  });

  it('shares nothing with either input', () => {
    const parent = { syntax: { comments: [{ start: '(', end: ')' }] } };
    const merged = mergeProfile(parent, {});
    (merged.syntax as { comments: unknown[] }).comments.push({ start: ';', end: null });
    expect(parent.syntax.comments).toHaveLength(1);
  });
});

describe('resolveProfiles', () => {
  it('resolves a parent that is declared after its child', () => {
    const { resolved, problems } = resolveProfiles([
      builtin(child('kid', 'base', { axes: ['X'] })),
      builtin({ id: 'base', name: 'Base', shortName: 'B', axes: ['X', 'Y'], grammar: 'iso' }),
    ]);
    expect(problems).toEqual([]);
    // Source order is registry order, so the child stays where it was declared.
    expect(resolved.map((entry) => entry.profile.id)).toEqual(['kid', 'base']);
    expect(resolved[0].profile.grammar).toBe('iso');
    expect(resolved[0].chain).toEqual(['kid', 'base']);
  });

  it('reports a child that would inherit its id, name or short name', () => {
    const { resolved, problems } = resolveProfiles([
      builtin({ id: 'base', name: 'Base', shortName: 'B' }),
      user({ extends: 'base', grammar: 'iso' }),
    ]);
    expect(resolved).toHaveLength(1);
    expect(problems[0].path).toBe('id');
  });

  it('reports an unknown parent and leaves the child out', () => {
    const { resolved, problems } = resolveProfiles([user(child('kid', 'nowhere'))]);
    expect(resolved).toEqual([]);
    expect(problems[0]).toMatchObject({ origin: 'user', file: 'user.json', profileId: 'kid', path: 'extends' });
    expect(problems[0].message).toContain('was not found');
  });

  it('reports a cycle instead of looping', () => {
    const { resolved, problems } = resolveProfiles([user(child('a', 'b')), user(child('b', 'a'))]);
    expect(resolved).toEqual([]);
    expect(problems.some((p) => p.message.includes('extends itself'))).toBe(true);
  });

  it('reports a profile that extends itself', () => {
    const { resolved, problems } = resolveProfiles([user(child('a', 'a'))]);
    expect(resolved).toEqual([]);
    expect(problems.length).toBeGreaterThan(0);
  });

  it(`allows ${MAX_EXTENDS_DEPTH} parents and reports the next one`, () => {
    const chain: ProfileSource[] = [builtin({ id: 'p0', name: 'p0', shortName: 'p0' })];
    for (let i = 1; i <= MAX_EXTENDS_DEPTH + 1; i++) chain.push(builtin(child(`p${i}`, `p${i - 1}`)));

    const ok = resolveProfiles(chain.slice(0, MAX_EXTENDS_DEPTH + 1));
    expect(ok.problems).toEqual([]);
    expect(ok.resolved.at(-1)?.chain).toHaveLength(MAX_EXTENDS_DEPTH + 1);

    const deep = resolveProfiles(chain);
    expect(deep.problems.some((p) => p.message.includes('at most'))).toBe(true);
    expect(deep.resolved.map((entry) => entry.profile.id)).not.toContain(`p${MAX_EXTENDS_DEPTH + 1}`);
  });

  it('keeps the first of two profiles with the same id, and says which it was', () => {
    const { resolved, problems } = resolveProfiles([
      builtin({ id: 'base', name: 'First', shortName: 'B' }),
      user({ id: 'base', name: 'Second', shortName: 'B' }),
    ]);
    expect(resolved).toHaveLength(1);
    expect((resolved[0].profile as { name: string }).name).toBe('First');
    expect(problems[0].message).toContain('belongs to a built-in profile');
    expect(problems[0].index).toBe(1);
  });

  it('refuses a built-in that extends a user profile', () => {
    const { problems } = resolveProfiles([user({ id: 'u', name: 'U', shortName: 'U' }), builtin(child('b', 'u'))]);
    expect(problems[0].message).toContain('only extend a built-in');
  });

  it('names a source that is not an object at all by its position', () => {
    const { resolved, problems } = resolveProfiles([builtin(42)]);
    expect(resolved).toEqual([]);
    expect(problems[0].index).toBe(0);
  });

  it('resolves the shipped built-ins without a problem', () => {
    const { resolved, problems } = resolveProfiles(BUILTIN_PROFILE_SOURCES);
    expect(problems).toEqual([]);
    expect(resolved.map((entry) => entry.chain)).toEqual([
      ['fanuc-gcode'],
      ['fanuc-lathe', 'fanuc-gcode'],
      ['heidenhain-klartext'],
    ]);
  });

  it('is idempotent, so a list of resolved profiles resolves to itself', () => {
    const once = resolveProfiles(BUILTIN_PROFILE_SOURCES);
    const twice = resolveProfiles(once.resolved.map((entry) => builtin(entry.profile)));
    expect(twice.problems).toEqual([]);
    expect(twice.resolved.map((entry) => entry.profile)).toEqual(once.resolved.map((entry) => entry.profile));
  });
});
