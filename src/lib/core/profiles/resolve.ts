// Profile inheritance (plan §7.1, AD-16). Implemented by the M6 prelude (P6) because
// every Wave A work package builds on it; **WP6.1 owns it from Wave A on**.
//
// A child profile names a parent with `extends` and writes down only what differs. The
// Fanuc lathe is the reason: it is the mill profile with other addresses, another tool
// rule and another database, and copying 200 lines of JSON to say so would mean every
// later correction has to be made twice — which is how two profiles drift apart until one
// of them is quietly wrong.
//
// The merge rules, and why each one is the safe choice for NC data:
//
//   - **Plain objects merge key by key, recursively.** `syntax` and `addresses` are
//     collections of independent settings, and a child that changes `decimalSeparator`
//     must not lose the comment markers.
//   - **Arrays replace, whole.** `detect.content`, `outline` and `program.start` are
//     *ordered rule lists* where the first match wins. Appending a parent's rules to a
//     child's would put rules the child never saw in front of or behind its own, and the
//     child could not remove one at all. Replacing is the only rule that lets a child say
//     "not this one" — at the price of restating the list, which §8.1 does on purpose.
//   - **Scalars and `null` replace.** `null` is how a child switches an inherited optional
//     field off.
//   - **`$schema` is dropped**, `extends` is kept on the result so the UI can show the
//     chain.
//
// Resolution runs **before** validation (F20): the merged object goes through the same
// validator and compiler as a built-in, so a child cannot slip a field past the gate by
// inheriting it.
//
// Nothing here throws. A source that cannot be resolved is reported with its file and the
// JSON path of the field at fault and is **left out** — the app has to start even when a
// user profile names a parent that does not exist.

import type { ProfileProblem, ProfileSource, ResolvedProfile } from './types';

/** How many `extends` hops a chain may have. A sixth profile in a line is a mistake, not a design. */
export const MAX_EXTENDS_DEPTH = 4;

/** The fields a child must set itself; inheriting one would give two profiles one identity. */
const OWN_FIELDS = ['id', 'name', 'shortName'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keys that are never copied out of JSON, whatever a file calls them.
 *
 * `JSON.parse('{"__proto__": …}')` makes an **own** enumerable member, `Object.entries`
 * hands it over, and `out[key] = …` on a plain object then runs `Object.prototype`'s
 * `__proto__` setter instead of writing a member: the merged object silently gets a new
 * prototype and no member of that name. Fields reached through that prototype are visible
 * to `validateProfile` and to `compileProfile` and are lost by the next `clone()`, so the
 * profile the validator checked and the profile a later copy carries can differ (G8 M6).
 *
 * Nothing that ships goes down this path — the built-ins are ours. M12 makes user JSON
 * (`<config>/profiles`, `<config>/codes`, an imported machine) the input, and §4 standing
 * rule 9 says such content is data. `constructor` and `prototype` join it: neither is a
 * member of any profile, and both are names that only ever appear here by accident or on
 * purpose.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** A deep copy of JSON data, so a merged profile never shares a sub-object with its parent. */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clone(entry)) as unknown as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      out[key] = clone(entry);
    }
    return out as T;
  }
  return value;
}

/**
 * `child` merged over `parent` by the rules in the header. Both are raw JSON objects, and
 * the result is a fresh object that shares nothing with either.
 */
export function mergeProfile(
  parent: Readonly<Record<string, unknown>>,
  child: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (key === '$schema' || FORBIDDEN_KEYS.has(key)) continue;
    out[key] = clone(value);
  }
  for (const [key, value] of Object.entries(child)) {
    if (key === '$schema' || FORBIDDEN_KEYS.has(key)) continue;
    const mine = out[key];
    out[key] = isPlainObject(mine) && isPlainObject(value) ? mergeProfile(mine, value) : clone(value);
  }
  return out;
}

/** The raw object of a source, or null when the source is not a JSON object at all. */
function objectOf(source: ProfileSource): Record<string, unknown> | null {
  return isPlainObject(source.raw) ? source.raw : null;
}

function idOf(raw: Record<string, unknown>): string | null {
  const id = raw.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

function parentOf(raw: Record<string, unknown>): string | null {
  const parent = raw.extends;
  return typeof parent === 'string' && parent !== '' ? parent : null;
}

function problem(
  source: ProfileSource,
  profileId: string | null,
  path: string,
  message: string,
  index?: number,
): ProfileProblem {
  return {
    origin: source.origin,
    file: source.file ?? null,
    profileId,
    path,
    message,
    ...(index === undefined ? {} : { index }),
  };
}

/**
 * Resolves every source against its parents.
 *
 * The result keeps the **source order**, which is the registry order and therefore the
 * detection tie-break: a child does not move because its parent was declared later.
 *
 * Reported and skipped: a source that is not an object, one without an id, a duplicate id,
 * a user id that shadows a built-in, an unknown parent, a cycle, a chain deeper than
 * [`MAX_EXTENDS_DEPTH`], a built-in that extends a user profile, and a child that would
 * inherit its `id`, `name` or `shortName`.
 */
export function resolveProfiles(sources: readonly ProfileSource[]): {
  resolved: ResolvedProfile[];
  problems: ProfileProblem[];
} {
  const problems: ProfileProblem[] = [];
  /** Source index by profile id, for the parent lookup. */
  const byId = new Map<string, number>();
  const raws: (Record<string, unknown> | null)[] = [];

  sources.forEach((source, i) => {
    const raw = objectOf(source);
    raws.push(raw);
    if (raw === null) {
      problems.push(problem(source, null, '', 'a profile must be a JSON object', i));
      return;
    }
    const id = idOf(raw);
    if (id === null) {
      problems.push(problem(source, null, 'id', 'a profile must have a non-empty id', i));
      return;
    }
    const first = byId.get(id);
    if (first !== undefined) {
      const builtinFirst = sources[first].origin === 'builtin' && source.origin === 'user';
      problems.push(
        problem(
          source,
          id,
          'id',
          builtinFirst ? `the id belongs to a built-in profile` : `the id is already taken`,
          i,
        ),
      );
      return;
    }
    byId.set(id, i);
  });

  /** Resolved objects by id, so a parent is merged once however many children it has. */
  const done = new Map<string, ResolvedProfile>();
  /** Ids that turned out to be unusable, so a child of one is not tried again. */
  const failed = new Set<string>();

  /** Resolves one source, following its parents first. `seen` carries the chain for the cycle check. */
  function resolveAt(index: number, seen: string[]): ResolvedProfile | null {
    const source = sources[index];
    const raw = raws[index];
    if (raw === null) return null;
    const id = idOf(raw);
    if (id === null || byId.get(id) !== index) return null;
    const ready = done.get(id);
    if (ready) return ready;
    if (failed.has(id)) return null;

    const parentId = parentOf(raw);
    let merged: Record<string, unknown>;
    let chain: string[] = [id];

    if (parentId === null) {
      merged = mergeProfile({}, raw);
    } else if (seen.includes(parentId)) {
      failed.add(id);
      problems.push(problem(source, id, 'extends', `"${parentId}" extends itself through "${id}"`));
      return null;
    } else {
      const parentIndex = byId.get(parentId);
      if (parentIndex === undefined) {
        failed.add(id);
        problems.push(problem(source, id, 'extends', `the parent profile "${parentId}" was not found`));
        return null;
      }
      if (source.origin === 'builtin' && sources[parentIndex].origin === 'user') {
        failed.add(id);
        problems.push(problem(source, id, 'extends', 'a built-in profile may only extend a built-in profile'));
        return null;
      }
      const parent = resolveAt(parentIndex, [...seen, id]);
      if (parent === null) {
        failed.add(id);
        problems.push(problem(source, id, 'extends', `the parent profile "${parentId}" could not be used`));
        return null;
      }
      if (parent.chain.length > MAX_EXTENDS_DEPTH) {
        failed.add(id);
        problems.push(
          problem(source, id, 'extends', `a profile may extend at most ${MAX_EXTENDS_DEPTH} parents`),
        );
        return null;
      }
      // The child's own fields are checked against what it wrote, not against the merge:
      // after merging it would carry the parent's name and look complete.
      const missing = OWN_FIELDS.filter((field) => typeof raw[field] !== 'string' || raw[field] === '');
      if (missing.length > 0) {
        failed.add(id);
        problems.push(
          problem(source, id, missing[0], `a profile that extends "${parentId}" must set its own ${missing.join(', ')}`),
        );
        return null;
      }
      merged = mergeProfile(parent.profile, raw);
      chain = [id, ...parent.chain];
    }

    const result: ResolvedProfile = {
      profile: merged,
      origin: source.origin,
      ...(source.file === undefined ? {} : { file: source.file }),
      chain,
    };
    done.set(id, result);
    return result;
  }

  const resolved: ResolvedProfile[] = [];
  sources.forEach((_source, i) => {
    const result = resolveAt(i, []);
    if (result !== null) resolved.push(result);
  });

  return { resolved, problems };
}
