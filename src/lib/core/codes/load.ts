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
import type { CodeDb, CodeEntry, CodeParam, CodeSets } from './types';
import type { NumberClass } from '$lib/core/machines/types';

/**
 * M6 (§7.2, AD-19). What a `sets` member may say, one list per member.
 *
 * The modal interpreter reads these and nothing else, so an unknown value has to be
 * dropped and reported rather than carried: a `feedUnit: "per-minutes"` that reached the
 * interpreter would leave the feed unit unknown on every block after it, and the reason
 * would be a typo nobody was told about.
 */
const SETS_VALUES = {
  feedUnit: ['per-minute', 'per-rev', 'per-tooth', 'inverse-time'],
  speedUnit: ['rpm', 'surface'],
  distance: ['absolute', 'incremental'],
  units: ['mm', 'inch'],
  plane: ['XY', 'ZX', 'YZ'],
  cycle: ['start', 'cancel'],
  diameter: ['on', 'off', 'absolute-only'],
} as const satisfies Record<string, readonly string[]>;

/** M6 (§7.2, AD-31). How a cycle parameter's value is read, whatever its address suggests. */
const PARAM_UNITS: readonly (NumberClass | 'increment' | 'count')[] = [
  'length',
  'angle',
  'feedPerMin',
  'feedPerRev',
  'dwell',
  'increment',
  'count',
];

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
    if (item.unit !== undefined) {
      const unit = str(item.unit);
      if (unit !== undefined && (PARAM_UNITS as readonly string[]).includes(unit)) {
        param.unit = unit as CodeParam['unit'];
      } else {
        report({ path: `${at}.unit`, message: `unit has to be one of ${PARAM_UNITS.join(', ')}` });
      }
    }
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

/**
 * M6 (§7.2, AD-19): what a code switches on. An unknown member or an unknown value is
 * dropped and reported; the rest of the entry still loads, because a wrong `sets` must not
 * take a label and a description with it.
 */
function readSets(raw: unknown, path: string, report: (p: CodeDbProblem) => void): CodeSets | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    report({ path, message: 'sets is not an object' });
    return undefined;
  }

  const out: Record<string, unknown> = {};
  for (const [member, value] of Object.entries(raw)) {
    const at = `${path}.${member}`;
    if (member === 'speedLimit') {
      if (value === true) out.speedLimit = true;
      else if (value !== false) report({ path: at, message: 'speedLimit has to be true or false' });
      continue;
    }
    const allowed = (SETS_VALUES as Record<string, readonly string[] | undefined>)[member];
    if (allowed === undefined) {
      report({ path: at, message: `${member} is not something a code sets` });
      continue;
    }
    const text = str(value);
    if (text === undefined || !allowed.includes(text)) {
      report({ path: at, message: `${member} has to be one of ${allowed.join(', ')}` });
      continue;
    }
    out[member] = text;
  }
  return Object.keys(out).length > 0 ? (out as CodeSets) : undefined;
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
  const sets = readSets(raw.sets, `${path}.sets`, report);
  if (sets) entry.sets = sets;

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
