// Loading a code database (plan §7.4). Owner: WP3.3.
//
// The file format is `docs/planning/code-assistant.md`, "Code database format", without
// `templates` (P2). A built-in database goes through this function exactly like a user
// database from `<config>/codes/` will, so the built-ins are checked by the same rules.
//
// Two levels of strictness, because a bad user database must not stop the app:
//   - the file itself has to be a database — an object with a `dialect` and a `codes`
//     array. If it is not, `loadCodeDb` throws `CodeDbError` and the caller falls back to
//     an empty database.
//   - a single broken entry, address or parameter is dropped and reported through
//     `onProblem`. The rest of the file still loads.
//
// `code` and `aliases` are stored normalised (`G01` → `G1`, `cycl def 200` →
// `CYCL DEF 200`), so the loaded database is canonical: completion inserts the canonical
// spelling and the duplicate check sees the same key the lookup will.

import { normalizeCode } from './lookup';
import type { CodeDb, CodeEntry, CodeParam } from './types';

/** The file is not a code database at all. */
export class CodeDbError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(message);
    this.name = 'CodeDbError';
    this.path = path;
  }
}

/** One dropped entry, address or parameter. `path` points into the JSON. */
export interface CodeDbProblem {
  path: string;
  message: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function bool(v: unknown): boolean | undefined {
  return v === true ? true : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readParams(
  raw: unknown,
  path: string,
  report: (p: CodeDbProblem) => void,
): CodeParam[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    report({ path, message: 'params is not an array' });
    return undefined;
  }
  const out: CodeParam[] = [];
  raw.forEach((item, i) => {
    const at = `${path}[${i}]`;
    if (!isRecord(item)) {
      report({ path: at, message: 'parameter is not an object' });
      return;
    }
    const address = str(item.address);
    const label = str(item.label);
    if (!address || !label) {
      report({ path: at, message: 'parameter needs an address and a label' });
      return;
    }
    const param: CodeParam = { address: address.toUpperCase(), label };
    if (bool(item.required)) param.required = true;
    const min = num(item.min);
    const max = num(item.max);
    if (min !== undefined) param.min = min;
    if (max !== undefined) param.max = max;
    out.push(param);
  });
  return out.length > 0 ? out : undefined;
}

function readAddresses(
  raw: unknown,
  report: (p: CodeDbProblem) => void,
): CodeDb['addresses'] {
  const out: CodeDb['addresses'] = {};
  if (raw === undefined) return out;
  if (!isRecord(raw)) {
    report({ path: 'addresses', message: 'addresses is not an object' });
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    const at = `addresses.${key}`;
    const letter = str(key)?.toUpperCase();
    if (!letter) {
      report({ path: at, message: 'address has no name' });
      continue;
    }
    if (!isRecord(value)) {
      report({ path: at, message: 'address is not an object' });
      continue;
    }
    const label = str(value.label);
    if (!label) {
      report({ path: at, message: 'address has no label' });
      continue;
    }
    if (out[letter]) {
      report({ path: at, message: `duplicate address ${letter}` });
      continue;
    }
    const description = str(value.description);
    out[letter] = description ? { label, description } : { label };
  }
  return out;
}

function readEntry(
  raw: unknown,
  path: string,
  report: (p: CodeDbProblem) => void,
): CodeEntry | null {
  if (!isRecord(raw)) {
    report({ path, message: 'entry is not an object' });
    return null;
  }
  const rawCode = str(raw.code);
  const label = str(raw.label);
  if (!rawCode) {
    report({ path, message: 'entry has no code' });
    return null;
  }
  if (!label) {
    report({ path: `${path}.label`, message: `entry ${rawCode} has no label` });
    return null;
  }

  const entry: CodeEntry = { code: normalizeCode(rawCode), label };
  const group = str(raw.group);
  if (group) entry.group = group;
  if (bool(raw.modal)) entry.modal = true;
  if (bool(raw.pitchFeed)) entry.pitchFeed = true;
  if (bool(raw.pitchFeedAmbiguous)) entry.pitchFeedAmbiguous = true;
  if (bool(raw.verify)) entry.verify = true;
  const description = str(raw.description);
  if (description) entry.description = description;
  const params = readParams(raw.params, `${path}.params`, report);
  if (params) entry.params = params;

  if (raw.aliases !== undefined) {
    if (!Array.isArray(raw.aliases)) {
      report({ path: `${path}.aliases`, message: `aliases of ${entry.code} is not an array` });
    } else {
      const aliases: string[] = [];
      raw.aliases.forEach((alias, i) => {
        const text = str(alias);
        if (!text) {
          report({ path: `${path}.aliases[${i}]`, message: 'alias is not a string' });
          return;
        }
        const key = normalizeCode(text);
        // An alias that only differs in zero padding or case is already covered by the
        // normalisation, so it is dropped without a word. It is a common way to write a
        // database and not a mistake.
        if (key === entry.code || aliases.includes(key)) return;
        aliases.push(key);
      });
      if (aliases.length > 0) entry.aliases = aliases;
    }
  }
  return entry;
}

/**
 * Reads and checks one code database file.
 *
 * Throws `CodeDbError` when the file is not a database. Broken or duplicated entries are
 * dropped and reported through `onProblem`; the shipped databases report nothing, which
 * is what `codes.data.test.ts` asserts.
 */
export function loadCodeDb(raw: unknown, onProblem?: (p: CodeDbProblem) => void): CodeDb {
  const report = onProblem ?? (() => {});

  if (!isRecord(raw)) throw new CodeDbError('', 'the code database is not an object');
  const dialect = str(raw.dialect);
  if (!dialect) throw new CodeDbError('dialect', 'the code database has no dialect id');
  if (!Array.isArray(raw.codes)) throw new CodeDbError('codes', 'codes is not an array');

  const version = num(raw.version);
  if (version === undefined) report({ path: 'version', message: 'version is missing; read as 1' });

  const addresses = readAddresses(raw.addresses, report);
  const codes: CodeEntry[] = [];
  const seen = new Map<string, string>();

  raw.codes.forEach((item, i) => {
    const path = `codes[${i}]`;
    const entry = readEntry(item, path, report);
    if (!entry) return;

    const clash = seen.get(entry.code);
    if (clash !== undefined) {
      report({ path, message: `duplicate code ${entry.code}, already defined by ${clash}` });
      return;
    }
    const kept: string[] = [];
    for (const alias of entry.aliases ?? []) {
      const owner = seen.get(alias);
      if (owner !== undefined) {
        report({
          path: `${path}.aliases`,
          message: `alias ${alias} of ${entry.code} is already defined by ${owner}`,
        });
        continue;
      }
      kept.push(alias);
    }
    if (kept.length > 0) entry.aliases = kept;
    else delete entry.aliases;

    seen.set(entry.code, path);
    for (const alias of kept) seen.set(alias, path);
    codes.push(entry);
  });

  return { dialect, version: version ?? 1, addresses, codes };
}

/** A database with nothing in it, for a dialect that has no file (or a broken one). */
export function emptyCodeDb(dialect: string): CodeDb {
  return { dialect, version: 0, addresses: {}, codes: [] };
}
