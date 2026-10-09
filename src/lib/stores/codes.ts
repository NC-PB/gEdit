// The code database service (plan §7.3). Owner: WP3.3.
//
// One database per dialect, shared by every profile that names it in `profile.codes`, so
// a Fanuc mill and a Fanuc lathe profile will read the same file. A database is loaded
// and indexed on first use and then cached, which makes a hover or a completion a map
// lookup.
//
// A database that fails to load never breaks the editor: the profile gets an empty
// database, the assistant answers "unknown" for every word, and the reason is logged
// once.
//
// M13 (WP13.2, AD-29) adds the user's databases from `<config>/codes/` on top of the
// built-ins, which is why this is a service with injected sources and not a plain import:
// `reload(user)` resolves the set again. A user file whose `dialect` (= its file stem) is a
// built-in id is an **overlay**, laid over that database before its children resolve; any
// other id is a database of its own that must `extends` another one. A user database
// follows a machine's variant (`over`): see its comment.
//
// M13 review (owner decision of 2026-10-09, NC-1): an entry of a user file for a code its
// parent already has is laid over the parent's entry **member by member** (`resolve.ts`,
// `memberMerge`), unless it says `"replace": true`; every meaning it changes comes back
// from `reload` as an `info` problem. The same holds for every layer `over` rebuilds.

import { CodeDbError, loadCodeDb, emptyCodeDb, type CodeDbProblem } from '$lib/core/codes/load';
import { completionsFor, lookupWord as lookupWordIn, normalizeCode } from '$lib/core/codes/lookup';
import { MAX_CODE_DB_DEPTH, resolveCodeDbFiles, type CodeDbMergeNotice } from '$lib/core/codes/resolve';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { profiles } from '$lib/stores/profiles';
import type { CodeDbService, UserFileText } from '$lib/app/types';
import type { CodeDb, CodeEntry, CodeLookup } from '$lib/core/codes/types';
import type { NcToken } from '$lib/core/nc/types';
import type { ProfileProblem } from '$lib/core/profiles/types';

export interface CodeDbServiceDeps {
  /** The database id a profile points at, `profile.codes`; undefined for an unknown profile. */
  dialectOf(profileId: string): string | undefined;
  /** The stored JSON of one database; undefined when the dialect has no file. */
  source(dialect: string): unknown | undefined;
  /**
   * M6, AD-17: every stored database, keyed by dialect id, so `extends` and `remove` can be
   * resolved — a child cannot be merged without its parent in hand. A dialect that is not
   * in this map still goes through `source` on its own.
   */
  sources?(): Record<string, unknown>;
  /** Where a broken database is reported. Defaults to `console.warn`. */
  warn?(message: string, detail?: unknown): void;
  /**
   * M13 review (NC-3, NC-6): which databases the loaded profiles read, one row per profile:
   * `codes` is the profile's own, `variants` the `codes` of each variant's choices (one
   * list per declared variant), `machineType` the profile's. `reload` reads it for two
   * notices: a user database's entries the other G-code system defines itself, and an
   * overlay that reaches the databases of another machine type. Absent: no such notices.
   */
  profileUse?(): readonly ProfileCodeUse[];
}

/** One profile's databases, for `CodeDbServiceDeps.profileUse`. */
export interface ProfileCodeUse {
  codes: string;
  variants: readonly (readonly string[])[];
  machineType?: string;
}

/**
 * What the service offers beyond the §7.3 contract, for `stores/profiles.ts` (which the
 * contract's callers never see): the raw stored files, so a profile reload validates against
 * the databases that exist after a code reload, and the variant rule of a user database.
 */
export interface CodeDbServiceInternals extends CodeDbService {
  /**
   * Every stored database file as the loaded set has it, keyed by dialect id: the built-ins,
   * each overlay laid over its built-in, the accepted user databases. Unresolved (`extends`
   * is still in them). An overlay's untouched built-in sits under `<id>@base`, which no profile
   * can name (`@` is not part of an id).
   */
  files(): Record<string, unknown>;
  /**
   * AD-29 (§7.16 #195), the variant rule. `own` is the database a profile names in `codes`,
   * `variant` the one a machine's variant switched the document to (`applyMachine`).
   *
   * When `own` is a user database and `variant` shares an ancestor with the database the
   * user's files `extends` (`fanuc-lathe` and `fanuc-lathe-b`, in either direction), the
   * answer is the user's own entries laid over `variant`, member by member, cached per pair;
   * otherwise it is `byId(variant)`, which is what `variant === own` and every built-in
   * profile get.
   *
   * M13 review NC-3: the user's entries for a code that `variant` resolves differently from
   * the extended database (or that only one of the two has) are left out: the variant
   * decides those (`G90`/`G92` of system A are not system B's). `reload` reports each one
   * once, as an `info` problem. A builder M-code that both systems share stays the user's.
   */
  over(own: string, variant: string): CodeDb;
}

/** Appended to a built-in's id while an overlay holds that id. An id cannot contain it. */
const BASE = '@base';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bytewise, so the order is the same on every platform and every locale. */
function byName(a: UserFileText, b: UserFileText): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** A message without the entry numbers, to tell the same complaint at two paths apart from two complaints. */
function shape(message: string): string {
  return message.replace(/codes\[\d+\]/g, 'codes[]');
}

/** One accepted user file. */
interface Layer {
  file: string;
  raw: Record<string, unknown>;
  /** The index in the file of each entry of `raw.codes` (broken entries are left out of it). */
  indexOf: number[];
}

/** Deeper than `limit` levels of objects and arrays? Iterative, so a deep file cannot overflow the stack. */
function nestedDeeperThan(value: unknown, limit: number): boolean {
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length > 0) {
    const [item, depth] = stack.pop() as [unknown, number];
    if (typeof item !== 'object' || item === null) continue;
    if (depth > limit) return true;
    for (const child of Array.isArray(item) ? item : Object.values(item)) stack.push([child, depth + 1]);
  }
  return false;
}

/** A value in a notice: short JSON, `nothing` for an absent one. */
function shown(value: unknown): string {
  if (value === undefined) return 'nothing';
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** A database id as a notice names it: an overlay's untouched built-in is "the built-in fanuc". */
function dbName(id: string): string {
  return id.endsWith(BASE) ? `the built-in ${id.slice(0, -BASE.length)}` : `"${id}"`;
}

/** What a notice adds for the members whose change the scripts act on most. */
const CONSEQUENCE: Record<string, (after: unknown) => string | null> = {
  pitchFeed: (after) => (after === true ? null : 'scale feed will scale its F like a feed, and the tool list counts it as one'),
  'sets.feedUnit': () => 'the feeds after it are read in that unit',
};

/** The `info` text of one changed member (NC-1). */
function noticeText(n: CodeDbMergeNotice): string {
  const parent = dbName(n.parent);
  const head =
    n.after === undefined || n.after === false
      ? n.replaced && n.after === undefined
        ? `${n.code}: "replace": true drops ${n.member} (${parent} has ${shown(n.before)})`
        : `${n.code}: your entry sets ${n.member} to ${shown(n.after)} (${parent} has ${shown(n.before)})`
      : n.before === undefined
        ? `${n.code}: your entry adds ${n.member}: ${shown(n.after)} (${parent} has none)`
        : `${n.code}: your entry changes ${n.member} from ${shown(n.before)} to ${shown(n.after)} (${parent})`;
  const tail = CONSEQUENCE[n.member]?.(n.after);
  return tail ? `${head}; ${tail}` : head;
}

/** `codes[i]` of a layer's filtered list as `codes[j]` of the file. */
function inFile(path: string, layer: Layer): string {
  return path.replace(/^codes\[(\d+)\]/, (whole, i: string) => {
    const at = layer.indexOf[Number(i)];
    return at === undefined ? whole : `codes[${at}]`;
  });
}

/** Two resolved entries mean the same (key order does not count). */
function sameEntry(a: CodeEntry, b: CodeEntry): boolean {
  const stable = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(stable).join(',')}]`
      : typeof value === 'object' && value !== null
        ? `{${Object.keys(value)
            .sort()
            .map((key) => `${key}:${stable((value as Record<string, unknown>)[key])}`)
            .join(',')}}`
        : JSON.stringify(value) ?? 'undefined';
  return stable(a) === stable(b);
}

export function createCodeDbService(deps: CodeDbServiceDeps): CodeDbServiceInternals {
  const warn = deps.warn ?? ((message: string, detail?: unknown) => console.warn(message, detail));
  let cache = new Map<string, CodeDb>();
  /** The variant rule's answers, by `own` and `variant`. */
  let overCache = new Map<string, CodeDb>();
  /** One object, so the lookup index behind it is built once and not per call. */
  const none = emptyCodeDb('');
  /** The resolved set, built once: resolution is by dialect id, not by profile (AD-17). */
  let resolved: Record<string, CodeDb> | null = null;
  /** The user files that were accepted by the last `reload`. */
  let overlays = new Map<string, Layer>();
  let own = new Map<string, Layer>();

  /** The stored files of a set: built-ins, overlays over them, user databases. */
  function sourcesOf(ov: Map<string, Layer>, ow: Map<string, Layer>): Record<string, unknown> {
    const base = deps.sources?.() ?? {};
    if (ov.size === 0 && ow.size === 0) return base;
    const out: Record<string, unknown> = { ...base };
    for (const [dialect, layer] of ov) {
      out[`${dialect}${BASE}`] = base[dialect];
      out[dialect] = { ...layer.raw, extends: `${dialect}${BASE}` };
    }
    for (const [dialect, layer] of ow) out[dialect] = layer.raw;
    return out;
  }

  /** The stored files of the loaded set. */
  function currentSources(): Record<string, unknown> {
    return sourcesOf(overlays, own);
  }

  /** The loaded databases of `sources`, and the problems found on the way. */
  function resolveSet(
    sources: Record<string, unknown>,
    report: (dialect: string, p: CodeDbProblem) => void,
    userLayer: (dialect: string) => boolean,
    onMerge?: (notice: CodeDbMergeNotice) => void,
    onEntryProblem?: (dialect: string, p: CodeDbProblem, index: number) => void,
  ): Record<string, CodeDb> {
    const out: Record<string, CodeDb> = {};
    const merged = resolveCodeDbFiles(sources, report, { memberMerge: userLayer, onMerge, onEntryProblem });
    for (const [dialect, file] of Object.entries(merged)) {
      if (dialect.endsWith(BASE)) continue;
      try {
        out[dialect] = loadCodeDb(file, (problem) => report(dialect, problem));
      } catch (error) {
        report(dialect, { path: '', message: error instanceof Error ? error.message : String(error) });
      }
    }
    return out;
  }

  /** Is `dialect` one of the user's layers in this set (an overlay or a database of the user's own)? */
  const userLayerOf = (ov: Map<string, Layer>, ow: Map<string, Layer>) => (dialect: string) =>
    ov.has(dialect) || ow.has(dialect);

  function resolveAll(): Record<string, CodeDb> {
    if (resolved === null) {
      resolved = resolveSet(
        currentSources(),
        (dialect, p) => warn(`code database "${dialect}": ${p.path}: ${p.message}`),
        userLayerOf(overlays, own),
      );
    }
    return resolved;
  }

  /** A loaded database of the set by id; own members only (M13 review CODE-13). */
  function resolvedOf(dialect: string): CodeDb | undefined {
    const all = resolveAll();
    return Object.hasOwn(all, dialect) ? all[dialect] : undefined;
  }

  /** A database that is not part of the resolved set, read on its own (a test, a user file). */
  function loadOne(dialect: string): CodeDb {
    let db = emptyCodeDb(dialect);
    const raw = overlays.has(dialect) || own.has(dialect) ? currentSources()[dialect] : deps.source(dialect);
    if (raw === undefined) {
      warn(`code database "${dialect}" is not available`);
      return db;
    }
    const problems: CodeDbProblem[] = [];
    try {
      db = loadCodeDb(raw, (p) => problems.push(p));
    } catch (err) {
      warn(`code database "${dialect}" could not be read`, err);
    }
    for (const p of problems) warn(`code database "${dialect}": ${p.path}: ${p.message}`);
    return db;
  }

  function byDialect(dialect: string): CodeDb {
    const cached = cache.get(dialect);
    if (cached) return cached;
    const db = resolvedOf(dialect) ?? loadOne(dialect);
    cache.set(dialect, db);
    return db;
  }

  function forProfile(profileId: string): CodeDb {
    const dialect = deps.dialectOf(profileId);
    if (dialect === undefined) return none;
    return byDialect(dialect);
  }

  /** The id `dialect` extends in the loaded set, or null. */
  function parentOf(sources: Record<string, unknown>, dialect: string): string | null {
    const raw = Object.hasOwn(sources, dialect) ? sources[dialect] : undefined;
    const parent = isRecord(raw) ? raw.extends : undefined;
    return typeof parent === 'string' && parent !== '' ? parent : null;
  }

  /** `dialect` and every id on its `extends` chain, an overlay's `@base` read as its built-in. */
  function ancestors(sources: Record<string, unknown>, dialect: string): Set<string> {
    const out = new Set<string>();
    const seen = new Set<string>();
    let id: string | null = dialect;
    while (id !== null && !seen.has(id)) {
      seen.add(id);
      out.add(id.endsWith(BASE) ? id.slice(0, -BASE.length) : id);
      id = parentOf(sources, id);
    }
    return out;
  }

  /** The codes `a` and `b` resolve differently, or that only one of them has (NC-3). */
  function differingCodes(a: string, b: string): Set<string> {
    const out = new Set<string>();
    const left = resolvedOf(a)?.codes ?? [];
    const right = new Map((resolvedOf(b)?.codes ?? []).map((entry) => [entry.code, entry]));
    const seen = new Set<string>();
    for (const entry of left) {
      seen.add(entry.code);
      const other = right.get(entry.code);
      if (other === undefined || !sameEntry(entry, other)) out.add(entry.code);
    }
    for (const code of right.keys()) if (!seen.has(code)) out.add(code);
    return out;
  }

  /**
   * The variant rule (see the interface). `dropped` hears every user entry left out because
   * `variant` decides its code, with the layer it is in and its index in that file.
   */
  function overWith(
    ownId: string,
    variant: string,
    dropped?: (layer: string, index: number, code: string) => void,
  ): CodeDb {
    // The user's own layers, the one the profile names first, up to the first database that
    // is not a user database of its own: that one is the "database the user file extends".
    const sources = currentSources();
    const layers: string[] = [];
    let at: string | null = ownId;
    while (at !== null && own.has(at) && !layers.includes(at)) {
      layers.push(at);
      at = parentOf(sources, at);
    }
    if (at === null) return byDialect(variant);
    // The database the files extend is the variant: nothing to rebuild.
    if (at === variant) return byDialect(ownId);
    const shared = ancestors(sources, variant);
    if (![...ancestors(sources, at)].some((id) => shared.has(id))) return byDialect(variant);

    const differs = differingCodes(at, variant);
    // The lowest layer is rebuilt on the variant, every layer above it on the one below.
    const files: Record<string, unknown> = { ...sources };
    const rebuilt = new Set<string>();
    let below = variant;
    for (const id of [...layers].reverse()) {
      const layer = own.get(id) as Layer;
      const layerKey = `${id}\u0000${variant}`;
      const codes = ((layer.raw.codes ?? []) as unknown[]).filter((entry, i) => {
        const code = isRecord(entry) && typeof entry.code === 'string' ? normalizeCode(entry.code) : null;
        if (code === null || !differs.has(code)) return true;
        dropped?.(id, layer.indexOf[i] ?? i, code);
        return false;
      });
      files[layerKey] = { ...layer.raw, codes, extends: below };
      rebuilt.add(layerKey);
      below = layerKey;
    }
    try {
      const merged = resolveCodeDbFiles(files, undefined, { memberMerge: (dialect) => rebuilt.has(dialect) })[below];
      if (merged !== undefined) return loadCodeDb({ ...merged, dialect: ownId });
    } catch {
      // Falls through to the variant's own database.
    }
    return byDialect(variant);
  }

  function over(ownId: string, variant: string): CodeDb {
    if (variant === '') return none;
    if (!own.has(ownId) || variant === ownId) return byDialect(variant);
    const key = `${ownId}\u0000${variant}`;
    const cached = overCache.get(key);
    if (cached) return cached;
    const db = overWith(ownId, variant);
    overCache.set(key, db);
    return db;
  }

  /** Reads one user file; null (and a problem) when it cannot be used at all. */
  function readUserFile(
    f: UserFileText,
    builtinIds: ReadonlySet<string>,
    problems: ProfileProblem[],
    standalone: Set<string>,
  ): { dialect: string; layer: Layer; overlay: boolean } | null {
    const stem = f.name.replace(/\.json$/i, '');
    const fail = (path: string, message: string): null => {
      problems.push({ origin: 'user', file: f.name, profileId: stem, path, message, kind: 'codes' });
      return null;
    };
    let raw: unknown;
    try {
      raw = JSON.parse(f.text);
    } catch (error) {
      return fail(
        '',
        f.text.charCodeAt(0) === 0xfeff
          ? 'the file starts with a byte order mark; save it as UTF-8 without one'
          : `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isRecord(raw)) return fail('', 'a code file must be a JSON object');
    // M13 review CODE-2: the merge copies members recursively; a file thousands of levels
    // deep would overflow the stack there, so it is refused here, by name.
    if (nestedDeeperThan(raw, MAX_CODE_DB_DEPTH)) {
      return fail('', `the file is nested more than ${MAX_CODE_DB_DEPTH} levels deep`);
    }
    if (raw.dialect !== stem) {
      return fail('dialect', `must be "${stem}", the file name without .json (it is ${JSON.stringify(raw.dialect ?? null)})`);
    }
    if (raw.codes !== undefined && !Array.isArray(raw.codes)) return fail('codes', 'codes is not an array');
    const overlay = builtinIds.has(stem);
    const parent = raw.extends;
    if (parent !== undefined && (typeof parent !== 'string' || parent === '')) {
      return fail('extends', 'extends must be the id of a code database');
    }
    if (overlay && parent !== undefined) {
      return fail('extends', `"${stem}" is a built-in database: a file with that id is laid over it and cannot extend another`);
    }
    if (!overlay && parent === undefined) {
      return fail('extends', 'a code file with a new id must extend a built-in code database or another one of yours');
    }

    // The file on its own, entry by entry: the same reader as a built-in database, so a
    // broken entry is named by its path in THIS file, and it is left out of the merge. Without
    // that, a broken entry laid over a built-in's entry of the same code would delete the
    // built-in's entry along with itself.
    //
    // An entry without a `label` is a delta (NC-1): it takes the label of the entry it is
    // laid over, so it is read here with a stand-in; one with no entry to lay itself over is
    // reported by the merge.
    const alone: CodeDbProblem[] = [];
    const asRead = ((raw.codes ?? []) as unknown[]).map((entry) =>
      isRecord(entry) && entry.label === undefined && typeof entry.code === 'string' ? { ...entry, label: entry.code } : entry,
    );
    let loaded: CodeDb;
    try {
      loaded = loadCodeDb({ ...raw, dialect: stem, version: raw.version ?? 1, codes: asRead }, (p) => alone.push(p));
    } catch (error) {
      return fail(error instanceof CodeDbError ? error.path : '', error instanceof Error ? error.message : String(error));
    }
    for (const p of alone) {
      problems.push({ origin: 'user', file: f.name, profileId: stem, path: p.path, message: p.message, kind: 'codes' });
      standalone.add(shape(p.message));
    }
    const kept = new Set(loaded.codes.map((entry) => entry.code));
    const seen = new Set<string>();
    const indexOf: number[] = [];
    const codes = ((raw.codes ?? []) as unknown[]).filter((entry, i) => {
      const code = isRecord(entry) && typeof entry.code === 'string' ? normalizeCode(entry.code) : null;
      if (code === null || !kept.has(code) || seen.has(code)) return false;
      seen.add(code);
      indexOf.push(i);
      return true;
    });
    return { dialect: stem, layer: { file: f.name, raw: { ...raw, codes }, indexOf }, overlay };
  }

  /**
   * NC-3: for each user database whose extended database is one choice of a variant
   * (`fanuc-lathe` of the G-code system), the entries the other choices define themselves.
   * The pairs are worked out (and cached) now, so the notice comes with the load.
   */
  function variantNotices(): ProfileProblem[] {
    const out: ProfileProblem[] = [];
    if (own.size === 0) return out;
    const families = (deps.profileUse?.() ?? []).flatMap((use) => use.variants);
    const sources = currentSources();
    for (const ownId of own.keys()) {
      let at: string | null = ownId;
      const seen = new Set<string>();
      while (at !== null && own.has(at) && !seen.has(at)) {
        seen.add(at);
        at = parentOf(sources, at);
      }
      if (at === null) continue;
      const base = at;
      const targets = new Set<string>();
      for (const family of families) {
        if (!family.includes(base)) continue;
        for (const id of family) if (id !== base && id !== ownId) targets.add(id);
      }
      for (const variant of [...targets].sort()) {
        const db = overWith(ownId, variant, (layerId, index, code) => {
          const layer = own.get(layerId) as Layer;
          const path = `codes[${index}]`;
          if (out.some((p) => p.file === layer.file && p.path === path && p.message.includes(`"${variant}"`))) return;
          out.push({
            origin: 'user',
            file: layer.file,
            profileId: layerId,
            path,
            message: `${code}: not used under "${variant}", which defines ${code} itself (it differs from "${base}"); your other entries apply there`,
            kind: 'codes',
            severity: 'info',
          });
        });
        overCache.set(`${ownId}\u0000${variant}`, db);
      }
    }
    return out;
  }

  /** NC-6: an overlay that reaches a database a profile of another machine type reads. */
  function reachNotices(): ProfileProblem[] {
    const out: ProfileProblem[] = [];
    if (overlays.size === 0) return out;
    const typesOf = new Map<string, Set<string>>();
    for (const use of deps.profileUse?.() ?? []) {
      if (use.machineType === undefined) continue;
      for (const dialect of [use.codes, ...use.variants.flat()]) {
        const types = typesOf.get(dialect) ?? new Set<string>();
        types.add(use.machineType);
        typesOf.set(dialect, types);
      }
    }
    const sources = currentSources();
    const all = Object.keys(resolveAll()).sort();
    for (const [dialect, layer] of overlays) {
      const ownTypes = typesOf.get(dialect) ?? new Set<string>();
      const reached: string[] = [];
      const otherTypes = new Set<string>();
      for (const id of all) {
        if (id === dialect || !ancestors(sources, id).has(dialect)) continue;
        const foreign = [...(typesOf.get(id) ?? [])].filter((type) => !ownTypes.has(type));
        if (foreign.length === 0) continue;
        reached.push(id);
        for (const type of foreign) otherTypes.add(type);
      }
      if (reached.length === 0) continue;
      out.push({
        origin: 'user',
        file: layer.file,
        profileId: dialect,
        path: '',
        message:
          `laid over the built-in ${dialect}, this file also reaches ${reached.map((id) => `"${id}"`).join(', ')}, ` +
          `which ${[...otherTypes].sort().join(' and ')} profiles read; a table for one machine type belongs in a code file ` +
          `of its own that extends ${dialect}, named by a profile of yours`,
        kind: 'codes',
        severity: 'info',
      });
    }
    return out;
  }

  return {
    forProfile,

    /**
     * A resolved database by its own id, for the variant databases a machine switches to
     * (`fanuc-lathe-b`). A document's own database comes through `machines.effective`,
     * never from here (AD-31).
     */
    byId(dialect: string): CodeDb {
      return dialect === '' ? none : byDialect(dialect);
    },

    lookupWord(profileId: string, token: NcToken): CodeLookup | null {
      return lookupWordIn(forProfile(profileId), token);
    },

    completions(profileId: string, prefix: string, atBlockStart: boolean): CodeEntry[] {
      return completionsFor(forProfile(profileId), prefix, atBlockStart);
    },

    forScripts(profileId: string): CodeEntry[] {
      return forProfile(profileId).codes;
    },

    files: currentSources,

    over,

    /**
     * M13 (AD-29, §7.16 #195): the built-ins plus `user`, resolved again; every cache dropped.
     *
     * A file is accepted or reported, never half-applied: bad JSON, not an object, a `dialect`
     * that is not its file stem, no `extends` on a new id, an `extends` on an overlay, a
     * `codes` that is not an array are reported and the file is ignored. Entries of an accepted
     * file that the reader rejects are reported with their path in the file and left out, so a
     * bad file cannot take a built-in entry away. A user database whose parent is missing or
     * cyclic is reported too and left out. The built-ins load whatever `user` holds.
     *
     * Not a bump: `profiles.reload` follows and bumps `revision` for both kinds of file.
     */
    reload(user: UserFileText[]): ProfileProblem[] {
      const problems: ProfileProblem[] = [];
      // M13 review CODE-2: transactional. Everything is worked out in locals and committed
      // at the end; a throw on the way keeps the set in force as it was and is reported.
      try {
        const builtinIds = new Set(Object.keys(deps.sources?.() ?? {}));
        const nextOverlays = new Map<string, Layer>();
        const nextOwn = new Map<string, Layer>();
        const standalone = new Set<string>();
        for (const f of [...user].sort(byName)) {
          const read = readUserFile(f, builtinIds, problems, standalone);
          if (read === null) continue;
          (read.overlay ? nextOverlays : nextOwn).set(read.dialect, read.layer);
        }

        // The file a problem of `dialect` belongs to: its own, or the nearest user file on its chain.
        const sources = sourcesOf(nextOverlays, nextOwn);
        const layerOf = (id: string): Layer | undefined => nextOwn.get(id) ?? nextOverlays.get(id);
        const fileOf = (dialect: string): { file: string | null; user: boolean } => {
          const seen = new Set<string>();
          let id: string | null = dialect;
          while (id !== null && !seen.has(id)) {
            seen.add(id);
            const layer = layerOf(id);
            if (layer !== undefined) return { file: layer.file, user: true };
            id = parentOf(sources, id.endsWith(BASE) ? id.slice(0, -BASE.length) : id);
          }
          return { file: null, user: false };
        };
        const reported = new Set<string>();
        const push = (problem: ProfileProblem): void => {
          const key = `${problem.file}|${problem.profileId}|${problem.path}|${problem.message}`;
          if (reported.has(key)) return;
          reported.add(key);
          problems.push(problem);
        };
        const nextResolved = resolveSet(
          sources,
          (dialect, p) => {
            const at = fileOf(dialect);
            // A complaint the file's own reading already made (at another index) is not made twice.
            if (standalone.has(shape(p.message))) return;
            push({ origin: at.user ? 'user' : 'builtin', file: at.file, profileId: dialect, path: p.path, message: p.message, kind: 'codes' });
          },
          userLayerOf(nextOverlays, nextOwn),
          // NC-1: every meaning a user entry changes, as a notice in its own file.
          (n) => {
            const layer = layerOf(n.dialect);
            if (layer === undefined) return;
            push({
              origin: 'user',
              file: layer.file,
              profileId: n.dialect,
              path: `codes[${layer.indexOf[n.index] ?? n.index}].${n.member}`,
              message: noticeText(n),
              kind: 'codes',
              severity: 'info',
            });
          },
          (dialect, p) => {
            const layer = layerOf(dialect);
            push({
              origin: 'user',
              file: layer?.file ?? null,
              profileId: dialect,
              path: layer ? inFile(p.path, layer) : p.path,
              message: p.message,
              kind: 'codes',
            });
          },
        );

        overlays = nextOverlays;
        own = nextOwn;
        cache = new Map();
        overCache = new Map();
        resolved = nextResolved;
      } catch (error) {
        problems.push({
          origin: 'user',
          file: null,
          profileId: null,
          path: '',
          message: `the code files could not be read, the ones loaded before stay in force: ${error instanceof Error ? error.message : String(error)}`,
          kind: 'codes',
        });
        return problems;
      }

      // The notices that need the profiles' view (NC-3, NC-6). A notice can never cost the load.
      try {
        problems.push(...variantNotices(), ...reachNotices());
      } catch (error) {
        warn('code files: the notices could not be worked out', error);
      }
      return problems;
    },
  };
}

/**
 * Profile id → database id, asked of the profile registry (WP3.1 made `profile()` real
 * at the M3 merge; WP3.3 read the built-in JSON directly while it still threw).
 *
 * `get()` is the existence check, so an id the registry does not know answers `undefined`
 * instead of throwing, and a user profile from `<config>/profiles/` resolves here for free
 * once the registry has loaded it.
 */
function dialectOf(profileId: string): string | undefined {
  if (!profiles.get(profileId)) return undefined;
  const dialect = profiles.profile(profileId).codes;
  return typeof dialect === 'string' && dialect !== '' ? dialect : undefined;
}

/** The databases every loaded profile reads, for the notices of `reload` (NC-3, NC-6). */
function profileUse(): ProfileCodeUse[] {
  return profiles.list().map((info) => {
    const profile = profiles.profile(info.id);
    const decl = profile.machineParams;
    const variants = (typeof decl === 'object' && decl !== null && Array.isArray(decl.variants) ? decl.variants : []).map((variant) =>
      (Array.isArray(variant.choices) ? variant.choices : [])
        .map((choice) => choice.codes)
        .filter((id): id is string => typeof id === 'string' && id !== ''),
    );
    return { codes: typeof profile.codes === 'string' ? profile.codes : '', variants, machineType: profile.machineType };
  });
}

/** The application-wide code database. */
export const codes: CodeDbServiceInternals = createCodeDbService({
  dialectOf,
  // Own members only (M13 review CODE-13): `codes: "constructor"` names no database.
  source: (dialect) => (Object.hasOwn(BUILTIN_CODE_DB_JSON, dialect) ? BUILTIN_CODE_DB_JSON[dialect] : undefined),
  sources: () => BUILTIN_CODE_DB_JSON,
  profileUse,
});
