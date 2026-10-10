// Loading a code database (plan §7.4). Owner: WP3.3.
//
// The file format is `docs/planning/code-assistant.md`, "Code database format". A built-in
// database goes through this function exactly like a user database from `<config>/codes/`, so
// the built-ins are checked by the same rules. Phase 3 (P3b prelude): the `templates` member is
// read by `core/templates/load.ts` (`loadTemplates`), its problems reported here with the path
// `templates[i]…`; `blocks: 2` marks a two-block cycle. B1: `CodeParam.block` (which block of
// such a cycle a parameter belongs to, checked by `checkBlockParams`) and `review: 'pending'`.
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
import { loadTemplates } from '$lib/core/templates/load';
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
  feedUnit: ['per-minute', 'per-rev', 'per-tooth', 'inverse-time', 'travel-time'],
  speedUnit: ['rpm', 'surface'],
  distance: ['absolute', 'incremental'],
  units: ['mm', 'inch'],
  plane: ['XY', 'ZX', 'YZ'],
  // P9: `define`, `call` and `call-modal` are the "defined cycle" of §7.4 (Klartext);
  // Phase 3: `call-modal-next` makes the cycle written behind it modal (Sinumerik `MCALL`).
  cycle: ['start', 'cancel', 'define', 'call', 'call-modal', 'call-modal-next'],
  diameter: ['on', 'off', 'absolute-only'],
  // P9: which side a `speedLimit` bounds; checked against `speedLimit` in `readSets`.
  speedLimitBound: ['upper', 'lower'],
  // P10: tool centre point control on or off (decision of 2026-10-04, §7.16 #107).
  tcp: ['on', 'off'],
  // M10 (WP10.2, the program checks): the spindle, the driven tool's spindle, a rapid or a
  // feed move, radius and length compensation, the speed a code leaves behind, and the
  // language the control reads the program in.
  spindle: ['on', 'off'],
  toolSpindle: ['on', 'off'],
  motion: ['rapid', 'feed'],
  radiusComp: ['on', 'off'],
  lengthComp: ['on', 'off'],
  exitSpeed: ['zero'],
  language: ['iso', 'native'],
  // Phase 3 (P3a prelude, P3.7): an arc rather than a straight line, for the motion colours;
  // `cycle`: every block of the code is a whole pass (the lathe single-pass cycles).
  path: ['arc', 'cycle'],
} as const satisfies Record<string, readonly string[]>;

/** P10: the `sets` members that are flags, `true` or absent (`false` is read as absent). */
const SETS_FLAGS = ['speedLimit', 'planeFromAxisWord'] as const;

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

/** P10 (R8, §7.2, §7.16 #106). What a parameter is to a program shift. */
const POSITIONS = ['tool-axis', 'none', 'other', 'mode'] as const;

/** P11 (§7.6). How a parameter's value names a program. */
const PROGRAM_NUMBERS = ['plain', 'packed'] as const;

/** P9 (R3, §7.2). What the axis words of a block are, where they are not a position. */
const AXIS_WORDS = ['data', 'machine'] as const;
/** P9 (R3, §7.2). Whether a code opens or closes a coordinate frame. */
const FRAMES = ['open', 'close'] as const;
/** M10 review (NC-2): `CodeEntry.pole`. */
const POLES = ['set', 'use'] as const;

/** M10 (WP10.2). The states `CodeEntry.conflicts` may name, besides `frame:<group>`. */
const CONFLICTS = ['tcp', 'radiusComp', 'lengthComp', 'cycle', 'surfaceSpeed', 'feedNotPerMinute'] as const;

/** M10 (WP10.2). A list of conditions: one of `CONFLICTS` or `frame:<group>`, `!` in front to negate. */
function readConflicts(raw: unknown, path: string, report: (p: CodeDbProblem) => void): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    report({ path, message: 'conflicts is not an array' });
    return undefined;
  }
  const out: string[] = [];
  raw.forEach((item, i) => {
    const text = str(item);
    const name = text?.startsWith('!') ? text.slice(1) : text;
    const ok =
      name !== undefined &&
      ((CONFLICTS as readonly string[]).includes(name) || /^frame:[A-Za-z][A-Za-z0-9]*$/.test(name));
    if (ok && text !== undefined) out.push(text);
    else report({ path: `${path}[${i}]`, message: `has to be one of ${CONFLICTS.join(', ')} or frame:<group>` });
  });
  return out.length > 0 ? out : undefined;
}

/** M10 (WP10.2). A list of addresses or keywords, upper case. */
function readWords(raw: unknown, path: string, report: (p: CodeDbProblem) => void): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    report({ path, message: 'is not an array' });
    return undefined;
  }
  const out: string[] = [];
  raw.forEach((item, i) => {
    const text = str(item);
    if (text !== undefined) out.push(text.toUpperCase());
    else report({ path: `${path}[${i}]`, message: 'has to be an address or a keyword' });
  });
  return out.length > 0 ? out : undefined;
}

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

/**
 * A flag that is `true` or absent. A flag written as anything else (`"yes"`, `1`) is
 * reported and dropped: a typo that silently turns a check off is worse than one that
 * says so, and `false` is the same as not writing it.
 */
function flag(v: unknown, path: string, report: (p: CodeDbProblem) => void): true | undefined {
  if (v === true) return true;
  if (v !== undefined && v !== null && v !== false) report({ path, message: `${path.split('.').pop()} has to be true or false` });
  return undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** A string member that has to be one of `allowed`; anything else is reported and dropped. */
function oneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  path: string,
  report: (p: CodeDbProblem) => void,
): T | undefined {
  if (raw === undefined) return undefined;
  const text = str(raw);
  if (text !== undefined && (allowed as readonly string[]).includes(text)) return text as T;
  report({ path, message: `has to be one of ${allowed.join(', ')}` });
  return undefined;
}

/**
 * B1: the members of a parameter that change how its value is read or moved. On a two-block
 * entry an address declared once per block has to agree on all of them (`CodeParam.block`).
 */
const READING_MEMBERS = ['unit', 'position', 'axis', 'programNumber'] as const;

/**
 * B1 (`CodeParam.block`): on a two-block entry, an address is declared at most once per block
 * (a declaration without `block` counts for both), and two declarations of one address agree on
 * `READING_MEMBERS`, so a reader that does not know the block still reads the value right. A
 * declaration that breaks either rule is reported and dropped; the first one stays.
 */
function checkBlockParams(params: CodeParam[], path: string, report: (p: CodeDbProblem) => void): CodeParam[] {
  const kept: CodeParam[] = [];
  params.forEach((param, i) => {
    const blocks = param.block === undefined ? [1, 2] : [param.block];
    const others = kept.filter((k) => k.address === param.address);
    const clash = others.find((k) => k.block === undefined || blocks.includes(k.block));
    if (clash) {
      report({
        path: `${path}[${i}]`,
        message: `parameter ${param.address} is declared twice for the same block; declare it once per block with "block": 1 and "block": 2`,
      });
      return;
    }
    const differs = others.length > 0 ? READING_MEMBERS.find((m) => others[0][m] !== param[m]) : undefined;
    if (differs !== undefined) {
      report({
        path: `${path}[${i}].${differs}`,
        message: `parameter ${param.address} has to have the same ${differs} in both blocks; only its label may differ`,
      });
      return;
    }
    kept.push(param);
  });
  return kept;
}

function readParams(
  raw: unknown,
  path: string,
  report: (p: CodeDbProblem) => void,
  twoBlocks = false,
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
    if (flag(item.required, `${at}.required`, report)) param.required = true;
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
    // B1 (NC-06): a count that is a real number; it means nothing without `unit: 'count'`.
    if (flag(item.decimals, `${at}.decimals`, report)) {
      if (param.unit === 'count') param.decimals = true;
      else report({ path: `${at}.decimals`, message: 'decimals needs "unit": "count"' });
    }
    // P10 (R8): an unknown role is dropped and reported, and the parameter is then "not
    // reviewed", which address arithmetic refuses: a typo can only make it refuse more.
    const position = oneOf(item.position, POSITIONS, `${at}.position`, report);
    if (position !== undefined) param.position = position;
    // M10 review (NC-3): the axis a parameter is a coordinate of; a letter or nothing.
    if (item.axis !== undefined) {
      const axis = str(item.axis);
      if (axis !== undefined && /^[A-Za-z]$/.test(axis)) param.axis = axis.toUpperCase();
      else report({ path: `${at}.axis`, message: 'axis has to be one axis letter' });
    }
    // P11: a parameter whose value names a program, for search; unknown values are dropped.
    const programNumber = oneOf(item.programNumber, PROGRAM_NUMBERS, `${at}.programNumber`, report);
    if (programNumber !== undefined) param.programNumber = programNumber;
    // B1: the block of a two-block cycle this parameter belongs to; only on such an entry.
    if (item.block !== undefined) {
      if (item.block !== 1 && item.block !== 2) report({ path: `${at}.block`, message: 'block has to be 1 or 2' });
      else if (!twoBlocks) report({ path: `${at}.block`, message: 'block needs "blocks": 2 on the entry' });
      else param.block = item.block;
    }
    out.push(param);
  });
  const checked = twoBlocks ? checkBlockParams(out, path, report) : out;
  return checked.length > 0 ? checked : undefined;
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
    if ((SETS_FLAGS as readonly string[]).includes(member)) {
      if (value === true) out[member] = true;
      else if (value !== false) report({ path: at, message: `${member} has to be true or false` });
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
  // P9: a bound without a limit says nothing a reader could act on, and a reader that
  // trusted it would have to guess which word is limited.
  if (out.speedLimitBound !== undefined && out.speedLimit !== true) {
    report({ path: `${path}.speedLimitBound`, message: 'speedLimitBound needs speedLimit: true' });
    delete out.speedLimitBound;
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
  if (flag(raw.modal, `${path}.modal`, report)) entry.modal = true;
  if (flag(raw.pitchFeed, `${path}.pitchFeed`, report)) entry.pitchFeed = true;
  if (flag(raw.pitchFeedAmbiguous, `${path}.pitchFeedAmbiguous`, report)) entry.pitchFeedAmbiguous = true;
  if (flag(raw.tappingElsewhere, `${path}.tappingElsewhere`, report)) entry.tappingElsewhere = true;
  // P8: a dwell block's `F` is a time. The loader is what the scripts and the interpreter
  // read, so a flag the file sets and the loader drops would be a flag that does nothing.
  if (flag(raw.fNotFeed, `${path}.fNotFeed`, report)) entry.fNotFeed = true;
  // 2026-09: the scripts read these two from the loaded database as well.
  if (flag(raw.tapping, `${path}.tapping`, report)) entry.tapping = true;
  if (flag(raw.wordsAreData, `${path}.wordsAreData`, report)) entry.wordsAreData = true;
  // P9 (R3): the two flags extents and address arithmetic read instead of code lists.
  const axisWords = oneOf(raw.axisWords, AXIS_WORDS, `${path}.axisWords`, report);
  if (axisWords !== undefined) {
    // Every word of a `wordsAreData` block is data already; calling its axis words a
    // machine position as well would be two answers to one question.
    if (entry.wordsAreData === true && axisWords !== 'data') {
      report({ path: `${path}.axisWords`, message: `axisWords of ${entry.code} contradicts wordsAreData` });
    } else {
      entry.axisWords = axisWords;
    }
  }
  const frame = oneOf(raw.frame, FRAMES, `${path}.frame`, report);
  if (frame !== undefined) entry.frame = frame;
  // P10: the close a code makes when it is written without values (`CYCLE800()`, `TRANS`).
  const bare = oneOf(raw.frameWithoutValues, ['close'] as const, `${path}.frameWithoutValues`, report);
  if (bare !== undefined) entry.frameWithoutValues = bare;
  // Owner decision of 2026-10-08 (M10-2): the angle words whose zero closes the frame.
  const zeroWords = readWords(raw.frameZeroWords, `${path}.frameZeroWords`, report);
  if (zeroWords) entry.frameZeroWords = zeroWords;
  // M12.5 (§7.16 #180): the sub-block whose empty block closes the tilt (`"1"`: an empty
  // `CYCL DEF 19.1`). Digits only, and only beside `frameZeroWords`, whose reading it ends.
  if (raw.frameEmptyCloses !== undefined) {
    const sub = typeof raw.frameEmptyCloses === 'string' ? raw.frameEmptyCloses.trim() : undefined;
    if (sub === undefined || !/^\d+$/.test(sub)) {
      report({ path: `${path}.frameEmptyCloses`, message: 'has to be a sub-block number such as "1"' });
    } else if (!entry.frameZeroWords) {
      report({ path: `${path}.frameEmptyCloses`, message: `frameEmptyCloses of ${entry.code} needs frameZeroWords` });
    } else {
      entry.frameEmptyCloses = sub;
    }
  }
  // M10 (WP10.2): what the program checks read about a code besides its `sets`.
  const conflicts = readConflicts(raw.conflicts, `${path}.conflicts`, report);
  if (conflicts) entry.conflicts = conflicts;
  if (flag(raw.alone, `${path}.alone`, report)) entry.alone = true;
  const requires = readWords(raw.requires, `${path}.requires`, report);
  if (requires) entry.requires = requires;
  // B1 (A6): the words behind a code that are its own (Klartext `M128 F800`); the scripts read
  // them from the loaded database, so a member the loader dropped would be one they never see.
  const ownWords = readWords(raw.ownWords, `${path}.ownWords`, report);
  if (ownWords) entry.ownWords = ownWords;
  const contour = oneOf(raw.contour, FRAMES, `${path}.contour`, report);
  if (contour !== undefined) entry.contour = contour;
  // M10 review: the pole, a program call and a coordinate shift (NC-2, NC-6, NC-7).
  const pole = oneOf(raw.pole, POLES, `${path}.pole`, report);
  if (pole !== undefined) entry.pole = pole;
  if (flag(raw.call, `${path}.call`, report)) entry.call = true;
  if (flag(raw.shift, `${path}.shift`, report)) entry.shift = true;
  if (flag(raw.verify, `${path}.verify`, report)) entry.verify = true;
  // B1: written from the manuals and not reviewed by the owner yet; changes nothing else.
  if (raw.review !== undefined) {
    if (raw.review === 'pending') entry.review = 'pending';
    else report({ path: `${path}.review`, message: 'review has to be "pending"; read as reviewed' });
  }
  // Phase 3 (P3b prelude): a cycle written in two blocks (the cycle form refuses it).
  if (raw.blocks !== undefined) {
    if (raw.blocks === 2) entry.blocks = 2;
    else report({ path: `${path}.blocks`, message: 'blocks has to be 2 (a cycle written in two blocks) or absent' });
  }
  const description = str(raw.description);
  if (description) entry.description = description;
  const params = readParams(raw.params, `${path}.params`, report, entry.blocks === 2);
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

  const db: CodeDb = { dialect, version: version ?? 1, addresses, codes };
  // Phase 3 (P3b prelude): absent stays absent, so a database without templates is unchanged.
  if (raw.templates !== undefined) {
    db.templates = loadTemplates(raw.templates, (p) => report({ path: `templates${p.path}`, message: p.message }));
  }
  return db;
}

/** A database with nothing in it, for a dialect that has no file (or a broken one). */
export function emptyCodeDb(dialect: string): CodeDb {
  return { dialect, version: 0, addresses: {}, codes: [] };
}
