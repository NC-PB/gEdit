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
// **The user's files are the exception (owner decision of 2026-10-09, M13 review NC-1).** A
// user's code file is a delta on a reviewed entry, not a reviewed entry: a shop that writes
// its own hover text for `G76` must not lose `pitchFeed` with it, or scale feed would scale
// a thread lead. For a file the caller marks with `memberMerge` (every user layer; never a
// built-in, so `fanuc-lathe-b`'s `G99` still does not inherit `fanuc-lathe`'s), an entry
// whose code the resolved parent already has is laid over the parent's entry **member by
// member**: objects by key (`sets`), lists and values whole (`params`, `aliases`,
// `conflicts`, …), the AD-16 rule of the profiles. Members the entry does not mention are
// kept, `label` included. `"replace": true` on the entry keeps the whole replacement.
// `replace` itself never reaches the result. Every member whose meaning the result changes
// against the parent's entry (`label` and `description` are text, not meaning) is handed to
// `onMerge`, so the caller can tell the user.
//
// Two functions, because the resolved JSON is needed on both sides of the app:
// [`resolveCodeDbFiles`] answers with the merged **file** objects (what
// `tests/fixtures/resolved/codes/**` holds and what the Python side reads, so no second
// implementation ever merges a database), and [`resolveCodeDbs`] loads those into the
// `CodeDb` the app uses.
//
// Nothing throws. A file that cannot be resolved is reported and left out, so one broken
// user database cannot take the editor's assistant with it. That includes a file nested
// deeper than [`MAX_CODE_DB_DEPTH`] (M13 review CODE-2): the copy below is recursive, and
// a hand-made file thousands of levels deep would otherwise overflow the stack.

import { MAX_EXTENDS_DEPTH } from '$lib/core/profiles/resolve';
import { CodeDbError, loadCodeDb, type CodeDbProblem } from './load';
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

/**
 * How deep a database file may nest (M13 review CODE-2). The deepest built-in member is a
 * handful of levels (`codes[].params[].…`); the Rust side refuses more than 128 when it
 * creates or imports a file, so only a file copied in by hand gets near this.
 */
export const MAX_CODE_DB_DEPTH = 64;

function clone<T>(value: T, depth = 0): T {
  if (depth > MAX_CODE_DB_DEPTH) {
    throw new CodeDbError('', `the file is nested more than ${MAX_CODE_DB_DEPTH} levels deep`);
  }
  if (Array.isArray(value)) return value.map((entry) => clone(entry, depth + 1)) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      out[key] = clone(entry, depth + 1);
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

/** What `onMerge` hears about one member of a user entry laid over its parent's entry. */
export interface CodeDbMergeNotice {
  /** The child database (the user's layer). */
  dialect: string;
  /** The database the entry was laid over. */
  parent: string;
  /** The entry's index in the child's `codes`. */
  index: number;
  /** The normalized code. */
  code: string;
  /** The member, `sets` by key (`'pitchFeed'`, `'sets.cycle'`). */
  member: string;
  /** The parent's value; `undefined` when it has none. */
  before: unknown;
  /** The value in the result; `undefined` when the result has none. */
  after: unknown;
  /** The entry said `"replace": true`. */
  replaced: boolean;
}

export interface ResolveCodeDbOptions {
  /** Lay this child's entries over its parent's member by member (the user's files; see the header). */
  memberMerge?: (dialect: string) => boolean;
  /** Every meaning a member-merged entry changes against its parent's entry. */
  onMerge?: (notice: CodeDbMergeNotice) => void;
  /**
   * A problem with one entry of a member-merged file, with the entry's index in the child's
   * `codes` (its `path` says `codes[index]` too). Defaults to `onProblem`.
   */
  onEntryProblem?: (dialect: string, p: CodeDbProblem, index: number) => void;
}

/** Members that are text for a reader, not meaning for the scripts: never reported. */
const TEXT_MEMBERS = new Set(['code', 'label', 'description', 'replace']);

/** `false`, an empty list and an absent member read the same in `loadCodeDb`. */
function meaningOf(value: unknown): string | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  return stableJson(value);
}

/** JSON with the keys of every object sorted, so two spellings of one value compare equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** Objects by key, everything else whole: `over` laid on `base` (AD-16). */
function mergeMembers(base: Record<string, unknown>, over: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out = clone(base, depth);
  for (const [key, value] of Object.entries(over)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const below = out[key];
    out[key] = isRecord(below) && isRecord(value) ? mergeMembers(below, value, depth + 1) : clone(value, depth + 1);
  }
  return out;
}

/** The members of `before` and `after` whose meaning differs, `sets` by key. */
function changedMembers(before: Record<string, unknown>, after: Record<string, unknown>): { member: string; before: unknown; after: unknown }[] {
  const out: { member: string; before: unknown; after: unknown }[] = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const key of keys) {
    if (TEXT_MEMBERS.has(key) || FORBIDDEN_KEYS.has(key)) continue;
    const was = before[key];
    const is = after[key];
    if (key === 'sets' && (isRecord(was) || isRecord(is))) {
      const a = isRecord(was) ? was : {};
      const b = isRecord(is) ? is : {};
      for (const sub of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
        if (meaningOf(a[sub]) !== meaningOf(b[sub])) out.push({ member: `sets.${sub}`, before: a[sub], after: b[sub] });
      }
      continue;
    }
    if (meaningOf(was) !== meaningOf(is)) out.push({ member: key, before: was, after: is });
  }
  return out;
}

/** An entry without its `replace` member. */
function withoutReplace(entry: unknown): unknown {
  if (!isRecord(entry) || !('replace' in entry)) return entry;
  const { replace: _replace, ...rest } = entry;
  return rest;
}

/** How the code list of one child is merged (see the header). */
interface ListMerge {
  /** Member by member, with these reports; absent: whole entries (AD-17). */
  members?: {
    dialect: string;
    parent: string;
    report: (p: CodeDbProblem, index: number) => void;
    onMerge?: (notice: CodeDbMergeNotice) => void;
  };
}

/**
 * The parent's list with the child's entries merged in: a child entry replaces the
 * parent's entry with the same key (or, for a user file, is laid over it member by
 * member), a new one is appended, and `removed` keys are dropped. Parent order is kept, so
 * a diff of the resolved file stays readable.
 */
function mergeList(
  parent: unknown[],
  child: unknown[],
  keyOf: (entry: unknown) => string | null,
  removed: Set<string>,
  how: ListMerge = {},
): unknown[] {
  const byKey = new Map<string, number>();
  const out: unknown[] = [];
  for (const entry of parent) {
    const key = keyOf(entry);
    if (key !== null && removed.has(key)) continue;
    if (key !== null) byKey.set(key, out.length);
    out.push(clone(entry));
  }
  child.forEach((raw, index) => {
    const key = keyOf(raw);
    const at = key === null ? undefined : byKey.get(key);
    const m = how.members;
    let replace = false;
    if (m && isRecord(raw) && raw.replace !== undefined) {
      if (typeof raw.replace === 'boolean') replace = raw.replace;
      else m.report({ path: `codes[${index}].replace`, message: 'replace must be true or false; the entry is merged member by member' }, index);
    }
    const entry = withoutReplace(raw);
    if (at === undefined) {
      if (m && isRecord(entry) && entry.label === undefined) {
        // A delta needs an entry to lay itself over; a new code needs its own label.
        m.report(
          {
            path: `codes[${index}].label`,
            message: `entry ${String(entry.code)} has no label, and "${m.parent}" has no ${key ?? 'such code'} to take one from`,
          },
          index,
        );
        return;
      }
      if (key !== null) byKey.set(key, out.length);
      out.push(clone(entry));
      return;
    }
    if (!m || !isRecord(entry) || !isRecord(out[at])) {
      out[at] = clone(entry);
      return;
    }
    if (replace && entry.label === undefined) {
      m.report({ path: `codes[${index}].label`, message: `entry ${String(entry.code)} replaces the entry whole and needs its own label` }, index);
      return;
    }
    const before = out[at] as Record<string, unknown>;
    const after = replace ? clone(entry) : mergeMembers(before, entry);
    for (const change of changedMembers(before, after)) {
      m.onMerge?.({ dialect: m.dialect, parent: m.parent, index, code: key as string, replaced: replace, ...change });
    }
    out[at] = after;
  });
  return out;
}

/** `child` merged over `parent`, both raw database files. `extends` and `remove` are consumed. */
function mergeFile(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
  how: ListMerge = {},
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
  out.codes = mergeList(parentCodes, childCodes, codeOf, removed, how);

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
 * cycle, a chain deeper than the profile limit and a file nested too deeply are reported
 * through `onProblem` and left out. `options` marks the user's files (see the header).
 */
export function resolveCodeDbFiles(
  files: Record<string, unknown>,
  onProblem?: (dialect: string, p: CodeDbProblem) => void,
  options: ResolveCodeDbOptions = {},
): Record<string, Record<string, unknown>> {
  const report = onProblem ?? (() => {});
  const done = new Map<string, Record<string, unknown>>();
  const failed = new Set<string>();
  const out: Record<string, Record<string, unknown>> = {};

  function resolveOne(dialect: string, seen: string[]): Record<string, unknown> | null {
    const ready = done.get(dialect);
    if (ready) return ready;
    if (failed.has(dialect)) return null;

    // Own members only (M13 review CODE-13): `constructor` is no database.
    const raw = Object.hasOwn(files, dialect) ? files[dialect] : undefined;
    if (!isRecord(raw)) {
      failed.add(dialect);
      report(dialect, { path: '', message: 'the code database is not an object' });
      return null;
    }

    const parentId = typeof raw.extends === 'string' && raw.extends !== '' ? raw.extends : null;
    let merged: Record<string, unknown>;
    try {
      if (parentId === null) {
        merged = mergeFile({}, raw);
      } else if (seen.includes(parentId)) {
        failed.add(dialect);
        report(dialect, { path: 'extends', message: `"${parentId}" extends itself through "${dialect}"` });
        return null;
      } else if (!Object.hasOwn(files, parentId)) {
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
        const members = options.memberMerge?.(dialect)
          ? {
              dialect,
              parent: parentId,
              report: (p: CodeDbProblem, index: number) =>
                options.onEntryProblem ? options.onEntryProblem(dialect, p, index) : report(dialect, p),
              onMerge: options.onMerge,
            }
          : undefined;
        merged = mergeFile(parent, raw, { members });
      }
    } catch (error) {
      // The depth cap above, or anything else one broken file could raise: that file is out,
      // the rest of the set resolves.
      failed.add(dialect);
      report(dialect, {
        path: error instanceof CodeDbError ? error.path : '',
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
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
