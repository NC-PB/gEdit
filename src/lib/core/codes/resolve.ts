// Code-database inheritance (plan §7.2, AD-17). Implemented by the M6 prelude (P6);
// **WP6.1 owns it from Wave A on**.
//
// A database file may name a parent dialect with `extends` and list parent codes it does
// not have in `remove`. The Fanuc lathe databases are the reason: `fanuc-lathe` is the
// mill database without the mill cycles and with the turning meanings of `G70`–`G76`, and
// `fanuc-lathe-b` is that one again with the handful of codes G-code system B numbers
// differently. Written out in full, the three files would drift apart entry by entry.
//
// The merge rules, and why:
//
//   - **A child entry replaces the parent's entry of the same normalized code, whole.**
//     Not a field merge: a reviewer has to be able to read one entry and know what the
//     control does. A field merge would leave `pitchFeed: true` from the parent standing
//     under a child label that says "facing cycle", and G10 could not see it.
//   - **`remove` drops a parent code** (by its normalized spelling), for codes the child's
//     control does not have at all — a lathe has no `G81` drilling cycle in the mill's
//     sense, and offering one in completion is worse than offering nothing.
//   - **Addresses override by letter**; everything else the parent lists stays.
//   - **Aliases are re-checked after the merge**, by `loadCodeDb`: a child may take over an
//     alias the parent gave to another entry, and the clash has to be found on the result,
//     not on either input.
//
// Two functions, because the resolved JSON is needed on both sides of the app:
// [`resolveCodeDbFiles`] answers with the merged **file** objects (what
// `tests/fixtures/resolved/codes/**` holds and what the Python side reads, so no second
// implementation ever merges a database), and [`resolveCodeDbs`] loads those into the
// `CodeDb` the app uses.
//
// Nothing throws. A file that cannot be resolved is reported and left out, so one broken
// user database cannot take the editor's assistant with it.

import { MAX_EXTENDS_DEPTH } from '$lib/core/profiles/resolve';
import { loadCodeDb, type CodeDbProblem } from './load';
import { normalizeCode } from './lookup';
import type { CodeDb } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keys that are never copied out of JSON (the twin of `profiles/resolve.ts`).
 *
 * `JSON.parse` makes `__proto__` an own enumerable member, and `out[key] = …` on a plain
 * object then runs the prototype setter instead of writing a member, so the merged
 * database gets a new prototype and no member of that name (G8 M6). No built-in database
 * goes down this path; M12's `<config>/codes` does.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clone(entry)) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      out[key] = clone(entry);
    }
    return out as T;
  }
  return value;
}

function codeOf(entry: unknown): string | null {
  if (!isRecord(entry)) return null;
  const code = entry.code;
  return typeof code === 'string' && code.trim() !== '' ? normalizeCode(code) : null;
}

function idOf(entry: unknown): string | null {
  if (!isRecord(entry)) return null;
  const id = entry.id;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

/**
 * The parent's list with the child's entries merged in: a child entry replaces the
 * parent's entry with the same key, a new one is appended, and `removed` keys are dropped.
 * Parent order is kept, so a diff of the resolved file stays readable.
 */
function mergeList(
  parent: unknown[],
  child: unknown[],
  keyOf: (entry: unknown) => string | null,
  removed: Set<string>,
): unknown[] {
  const byKey = new Map<string, number>();
  const out: unknown[] = [];
  for (const entry of parent) {
    const key = keyOf(entry);
    if (key !== null && removed.has(key)) continue;
    if (key !== null) byKey.set(key, out.length);
    out.push(clone(entry));
  }
  for (const entry of child) {
    const key = keyOf(entry);
    const at = key === null ? undefined : byKey.get(key);
    if (at === undefined) {
      if (key !== null) byKey.set(key, out.length);
      out.push(clone(entry));
    } else {
      out[at] = clone(entry);
    }
  }
  return out;
}

/** `child` merged over `parent`, both raw database files. `extends` and `remove` are consumed. */
function mergeFile(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): Record<string, unknown> {
  const removed = new Set<string>();
  const remove = child.remove;
  if (Array.isArray(remove)) {
    for (const code of remove) {
      if (typeof code === 'string' && code.trim() !== '') removed.add(normalizeCode(code));
    }
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (key === '$schema' || key === 'extends' || key === 'remove' || FORBIDDEN_KEYS.has(key)) continue;
    out[key] = clone(value);
  }

  const parentCodes = Array.isArray(parent.codes) ? parent.codes : [];
  const childCodes = Array.isArray(child.codes) ? child.codes : [];
  out.codes = mergeList(parentCodes, childCodes, codeOf, removed);

  const parentTemplates = Array.isArray(parent.templates) ? parent.templates : [];
  const childTemplates = Array.isArray(child.templates) ? child.templates : [];
  if (parentTemplates.length > 0 || childTemplates.length > 0) {
    out.templates = mergeList(parentTemplates, childTemplates, idOf, new Set());
  }

  const addresses: Record<string, unknown> = isRecord(out.addresses) ? (out.addresses as Record<string, unknown>) : {};
  if (isRecord(child.addresses)) {
    for (const [letter, value] of Object.entries(child.addresses)) {
      if (FORBIDDEN_KEYS.has(letter)) continue;
      addresses[letter] = clone(value);
    }
  }
  if (Object.keys(addresses).length > 0 || out.addresses !== undefined) out.addresses = addresses;

  for (const [key, value] of Object.entries(child)) {
    if (key === '$schema' || key === 'extends' || key === 'remove' || FORBIDDEN_KEYS.has(key)) continue;
    if (key === 'codes' || key === 'templates' || key === 'addresses') continue;
    out[key] = clone(value);
  }
  return out;
}

/**
 * Every database file with its parents merged in, keyed by dialect id.
 *
 * `files` is dialect id → the raw file as it was read. A file whose parent is unknown, a
 * cycle, and a chain deeper than the profile limit are reported through `onProblem` and
 * left out.
 */
export function resolveCodeDbFiles(
  files: Record<string, unknown>,
  onProblem?: (dialect: string, p: CodeDbProblem) => void,
): Record<string, Record<string, unknown>> {
  const report = onProblem ?? (() => {});
  const done = new Map<string, Record<string, unknown>>();
  const failed = new Set<string>();
  const out: Record<string, Record<string, unknown>> = {};

  function resolveOne(dialect: string, seen: string[]): Record<string, unknown> | null {
    const ready = done.get(dialect);
    if (ready) return ready;
    if (failed.has(dialect)) return null;

    const raw = files[dialect];
    if (!isRecord(raw)) {
      failed.add(dialect);
      report(dialect, { path: '', message: 'the code database is not an object' });
      return null;
    }

    const parentId = typeof raw.extends === 'string' && raw.extends !== '' ? raw.extends : null;
    let merged: Record<string, unknown>;

    if (parentId === null) {
      merged = mergeFile({}, raw);
    } else if (seen.includes(parentId)) {
      failed.add(dialect);
      report(dialect, { path: 'extends', message: `"${parentId}" extends itself through "${dialect}"` });
      return null;
    } else if (!(parentId in files)) {
      failed.add(dialect);
      report(dialect, { path: 'extends', message: `the parent code database "${parentId}" was not found` });
      return null;
    } else if (seen.length >= MAX_EXTENDS_DEPTH) {
      failed.add(dialect);
      report(dialect, {
        path: 'extends',
        message: `a code database may extend at most ${MAX_EXTENDS_DEPTH} parents`,
      });
      return null;
    } else {
      const parent = resolveOne(parentId, [...seen, dialect]);
      if (parent === null) {
        failed.add(dialect);
        report(dialect, { path: 'extends', message: `the parent code database "${parentId}" could not be used` });
        return null;
      }
      merged = mergeFile(parent, raw);
    }

    // The id is the child's own, whatever the parent called itself.
    merged.dialect = dialect;
    done.set(dialect, merged);
    return merged;
  }

  for (const dialect of Object.keys(files)) {
    const resolved = resolveOne(dialect, []);
    if (resolved !== null) out[dialect] = resolved;
  }
  return out;
}

/**
 * The modal group names a dialect's entries use, following `extends`, read off the raw
 * files (M6). Profile validation checks `machineParams.modalGroups` against this, so a
 * machine cannot be offered a power-on setting for a group its control has no code for.
 *
 * It is a union over the chain, not the resolved database: a group is a name, and a name
 * the child removed the last entry of is still one a reviewer may legitimately write. The
 * check is there to catch a typo, and an over-approximation never turns a correct profile
 * into a broken one.
 */
export function modalGroupsOf(files: Record<string, unknown>, dialect: string): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  let id: string | null = dialect;

  while (id !== null && !seen.has(id) && seen.size <= MAX_EXTENDS_DEPTH) {
    seen.add(id);
    const raw: unknown = files[id];
    if (!isRecord(raw)) break;
    for (const entry of Array.isArray(raw.codes) ? raw.codes : []) {
      if (!isRecord(entry) || entry.modal !== true) continue;
      const group = entry.group;
      if (typeof group === 'string' && group !== '') out.add(group);
    }
    id = typeof raw.extends === 'string' && raw.extends !== '' ? raw.extends : null;
  }
  return [...out];
}

/** The resolved databases, loaded and checked (`loadCodeDb`), keyed by dialect id. */
export function resolveCodeDbs(
  files: Record<string, unknown>,
  onProblem?: (dialect: string, p: CodeDbProblem) => void,
): Record<string, CodeDb> {
  const report = onProblem ?? (() => {});
  const out: Record<string, CodeDb> = {};
  for (const [dialect, file] of Object.entries(resolveCodeDbFiles(files, report))) {
    try {
      out[dialect] = loadCodeDb(file, (problem) => report(dialect, problem));
    } catch (error) {
      report(dialect, {
        path: '',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}
