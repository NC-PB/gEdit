// What makes a stored machine configuration usable (plan §7.15, AD-31). Owner: WP6.8.
//
// Two steps, and the split is the point:
//
//   `readMachine`      identity only — is this a record at all, is its id a stable slug,
//                      is its name free? Needs no profile, so it runs while `machines.json`
//                      is parsed, before anything knows which profiles exist.
//   `validateMachine`  the record against its base profile's declaration — the parameters
//                      it sets have to be ones that profile offers, and the values have to
//                      be ones it declares.
//
// The rule both halves serve: **a record that is not understood is kept, reported and not
// used.** Never dropped (a hand edit is the user's work), never repaired (a repaired
// machine reads numbers differently from the one the user wrote down), never silently
// selectable. `validateMachine` therefore reports and the caller treats any problem as
// "inactive": every parameter here decides how a program is read — the number input, the
// units, the diameter mode, the G-code system, the power-on state — and a machine that is
// half understood would misread a program while looking chosen.
//
// (M12 adds the one exception, AD-32: a broken `channels` block costs the channels, not
// the record. It is not a parameter of the number reading, so `validateMachine` never
// reports it; `channelBlock` below does, and WP12.3 owns those rules.)

import { normalizeCode } from '$lib/core/codes/lookup';
import type { CodeDb } from '$lib/core/codes/types';
import type { MachineParamsDecl, Profile, VariantDecl } from '$lib/core/profiles/types';
import { parseWaitCodes } from '$lib/core/channels/codes';
import { CHANNEL_CAPS, STOPS_AND_ENDS_RULE, type ChannelParams } from '$lib/core/channels/types';
import { t } from '$lib/i18n';
import { patternSubsetProblem } from '$lib/core/profiles/validate';
import type { MachineConfig, MachineProblem, NumberClass, NumberReading } from './types';

/** `MachineConfig.id`, in characters; [`MACHINE_ID_RE`] is written from it. */
export const MAX_ID_LENGTH = 64;

/** `MachineConfig.id`: a slug that per-file memory and recovery entries point at (M7). */
export const MACHINE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `MachineConfig.name`, in characters. */
export const MAX_NAME_LENGTH = 64;

/** `MachineConfig.notes`, in characters. */
export const MAX_NOTES_LENGTH = 500;

/** How many records one `machines.json` may hold (§7.15). */
export const MAX_MACHINES = 100;

/** The three readings a `NumberInput` may name. */
const READINGS: readonly NumberReading[] = ['increment', 'calculator', 'scale'];

/** The classes a `NumberInput.classes` entry may name. */
const CLASSES: readonly NumberClass[] = ['length', 'angle', 'feedPerMin', 'feedPerRev', 'dwell'];

/**
 * Decimal text, the way an increment is stored: digits, optionally a point and more
 * digits. No exponent, no sign, no spaces — the value goes into `Decimal` arithmetic in
 * Python and into string arithmetic in TypeScript, and a float would already have lost
 * `0.001` by the time anyone noticed.
 */
const DECIMAL_RE = /^\d+(?:\.\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for decimal text that is greater than zero: an increment of `0` reads every word as 0. */
function isPositiveDecimal(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_RE.test(value) && /[1-9]/.test(value);
}

function problem(machineId: string | null, path: string, message: string): MachineProblem {
  return { machineId, path, message };
}

/** The variants a declaration offers, tolerant of a hand-written profile. */
function variantsOf(decl: MachineParamsDecl | undefined): VariantDecl[] {
  return Array.isArray(decl?.variants) ? decl.variants : [];
}

function choicesOf(variant: VariantDecl): string[] {
  return (Array.isArray(variant?.choices) ? variant.choices : [])
    .map((choice) => choice?.value)
    .filter((value): value is string => typeof value === 'string');
}

export interface ReadMachineOptions {
  /** JSON path of this record in `machines.json`, e.g. `machines[3]`. */
  path: string;
  /** The ids already taken by earlier records. */
  ids: ReadonlySet<string>;
  /** The names already taken, lower-cased. */
  names: ReadonlySet<string>;
}

export interface ReadMachineResult {
  /** The record, or `null` when it cannot even be identified. */
  machine: MachineConfig | null;
  problems: MachineProblem[];
}

/**
 * One record's identity: is it an object, is its id a valid, free slug, is its name a free
 * name, is `params` an object?
 *
 * The result **is the raw object**, with the known members normalised in place, so every
 * member this build does not know — and every future parameter — survives the round trip
 * in its original position (§7.15: "unknown members at any level are kept").
 */
export function readMachine(raw: unknown, o: ReadMachineOptions): ReadMachineResult {
  const problems: MachineProblem[] = [];
  if (!isRecord(raw)) {
    return { machine: null, problems: [problem(null, o.path, 'not a JSON object')] };
  }

  const id = raw.id;
  const known = typeof id === 'string' ? id : null;
  if (typeof id !== 'string' || !MACHINE_ID_RE.test(id)) {
    problems.push(
      problem(
        known,
        `${o.path}.id`,
        'an id must be 1–64 characters of a–z, 0–9 and "-", starting with a letter or a digit',
      ),
    );
  } else if (o.ids.has(id)) {
    problems.push(problem(known, `${o.path}.id`, `the id "${id}" is used by an earlier machine`));
  }

  const name = raw.name;
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME_LENGTH) {
    problems.push(
      problem(known, `${o.path}.name`, `a name must be 1–${MAX_NAME_LENGTH} characters`),
    );
  } else if (o.names.has(name.trim().toLowerCase())) {
    problems.push(
      problem(known, `${o.path}.name`, `the name "${name}" is used by another machine`),
    );
  }

  if (typeof raw.profile !== 'string' || raw.profile === '') {
    problems.push(problem(known, `${o.path}.profile`, 'a machine names the profile it is for'));
  }

  if (raw.params !== undefined && !isRecord(raw.params)) {
    problems.push(problem(known, `${o.path}.params`, 'params must be a JSON object'));
  }

  if (raw.notes !== undefined && (typeof raw.notes !== 'string' || raw.notes.length > MAX_NOTES_LENGTH)) {
    problems.push(
      problem(known, `${o.path}.notes`, `notes must be text of at most ${MAX_NOTES_LENGTH} characters`),
    );
  }

  if (problems.length > 0) return { machine: null, problems };

  // The raw object itself, so unknown members keep their place; the known ones are
  // re-assigned, which in JavaScript leaves their position alone.
  const machine = { ...raw } as unknown as MachineConfig;
  machine.params = isRecord(raw.params) ? ({ ...raw.params } as MachineConfig['params']) : {};
  return { machine, problems: [] };
}

export interface ValidateMachineOptions {
  /** JSON path of this record, e.g. `machines[3]`. */
  path: string;
  /** The resolved base profile, or `undefined` when this build does not know it. */
  profile: Profile | undefined;
  /**
   * The code database the record's variants resolve to, for the `modalInitial` codes.
   * Absent: the codes are not checked, only the groups (a caller that has no database
   * still gets the rest of the rules).
   */
  codes?: CodeDb;
}

/**
 * One record against its base profile's declaration. An empty result means the machine can
 * be chosen; anything else means it is kept, listed with its problems and not selectable.
 */
export function validateMachine(m: MachineConfig, o: ValidateMachineOptions): MachineProblem[] {
  const problems: MachineProblem[] = [];
  const id = typeof m.id === 'string' ? m.id : null;
  const at = (member: string): string => `${o.path}.params.${member}`;

  if (o.profile === undefined) {
    return [
      problem(
        id,
        `${o.path}.profile`,
        `the profile "${m.profile}" is not loaded, so this machine cannot be used`,
      ),
    ];
  }

  const decl = o.profile.machineParams;
  if (decl === undefined) {
    return [
      problem(
        id,
        `${o.path}.profile`,
        `the profile "${m.profile}" has no machine parameters, so it has no machines`,
      ),
    ];
  }

  const params = isRecord(m.params) ? m.params : {};

  if (params.numberInput !== undefined && params.numberInput !== null) {
    if (decl.numberInput === undefined) {
      problems.push(problem(id, at('numberInput'), `the profile "${m.profile}" does not read numbers by a setting`));
    } else {
      problems.push(...numberInputProblems(params.numberInput, id, at('numberInput')));
    }
  }

  if (params.units !== undefined && params.units !== 'mm' && params.units !== 'inch') {
    problems.push(problem(id, at('units'), 'the unit at power-on is "mm" or "inch"'));
  }

  if (params.diameter !== undefined && params.diameter !== null) {
    if (decl.diameter === undefined) {
      problems.push(problem(id, at('diameter'), `the profile "${m.profile}" has no diameter mode`));
    } else if (params.diameter !== 'on' && params.diameter !== 'off') {
      problems.push(problem(id, at('diameter'), 'the diameter mode is "on" or "off"'));
    }
  }

  const variants = params.variants;
  if (variants !== undefined) {
    if (!isRecord(variants)) {
      problems.push(problem(id, at('variants'), 'variants must be a JSON object'));
    } else {
      const declared = new Map(variantsOf(decl).map((variant) => [variant.id, choicesOf(variant)]));
      for (const [variantId, value] of Object.entries(variants)) {
        const choices = declared.get(variantId);
        if (choices === undefined) {
          problems.push(
            problem(id, `${at('variants')}.${variantId}`, `the profile "${m.profile}" has no variant "${variantId}"`),
          );
        } else if (typeof value !== 'string' || !choices.includes(value)) {
          problems.push(
            problem(
              id,
              `${at('variants')}.${variantId}`,
              `"${String(value)}" is not one of ${choices.map((choice) => `"${choice}"`).join(', ')}`,
            ),
          );
        }
      }
    }
  }

  const modalInitial = params.modalInitial;
  if (modalInitial !== undefined) {
    if (!isRecord(modalInitial)) {
      problems.push(problem(id, at('modalInitial'), 'modalInitial must be a JSON object'));
    } else {
      const offered = new Set(Array.isArray(decl.modalGroups) ? decl.modalGroups : []);
      for (const [group, code] of Object.entries(modalInitial)) {
        const where = `${at('modalInitial')}.${group}`;
        if (!offered.has(group)) {
          problems.push(problem(id, where, `the profile "${m.profile}" does not offer the group "${group}"`));
          continue;
        }
        if (typeof code !== 'string' || code === '') {
          problems.push(problem(id, where, 'a power-on code is written as text, e.g. "G95"'));
          continue;
        }
        if (o.codes === undefined) continue;
        const wanted = normalizeCode(code);
        const entry = o.codes.codes.find(
          (candidate) =>
            normalizeCode(candidate.code) === wanted ||
            (candidate.aliases ?? []).some((alias) => normalizeCode(alias) === wanted),
        );
        if (entry === undefined) {
          problems.push(problem(id, where, `"${code}" is not a code of the database "${o.codes.dialect}"`));
        } else if (entry.group !== group) {
          problems.push(
            problem(id, where, `"${code}" belongs to the group "${entry.group ?? 'none'}", not to "${group}"`),
          );
        }
      }
    }
  }

  return problems;
}

/**
 * A stored `NumberInput`, member by member. A machine keeps the **whole** value of the
 * preset it was given (§7.15), so this is the shape that decides how every literal of that
 * machine is read — and the one place a typo in the file has to be caught.
 */
function numberInputProblems(raw: unknown, id: string | null, path: string): MachineProblem[] {
  const problems: MachineProblem[] = [];
  if (!isRecord(raw)) return [problem(id, path, 'the number input must be a JSON object')];

  if (typeof raw.mode !== 'string' || !READINGS.includes(raw.mode as NumberReading)) {
    problems.push(problem(id, `${path}.mode`, `the reading is one of ${READINGS.join(', ')}`));
  }
  if (!isPositiveDecimal(raw.incrementMm)) {
    problems.push(problem(id, `${path}.incrementMm`, 'the metric increment is decimal text above zero, e.g. "0.001"'));
  }
  for (const member of ['incrementInch', 'incrementDeg', 'incrementSec'] as const) {
    if (raw[member] !== undefined && !isPositiveDecimal(raw[member])) {
      problems.push(problem(id, `${path}.${member}`, 'an increment is decimal text above zero, e.g. "0.001"'));
    }
  }

  const classes = raw.classes;
  if (classes === undefined) return problems;
  if (!isRecord(classes)) {
    problems.push(problem(id, `${path}.classes`, 'classes must be a JSON object'));
    return problems;
  }
  for (const [name, value] of Object.entries(classes)) {
    const where = `${path}.classes.${name}`;
    if (!CLASSES.includes(name as NumberClass)) {
      problems.push(problem(id, where, `"${name}" is not one of ${CLASSES.join(', ')}`));
      continue;
    }
    if (!isRecord(value)) {
      problems.push(problem(id, where, 'a class entry must be a JSON object'));
      continue;
    }
    if (value.mode !== undefined && (typeof value.mode !== 'string' || !READINGS.includes(value.mode as NumberReading))) {
      problems.push(problem(id, `${where}.mode`, `the reading is one of ${READINGS.join(', ')}`));
    }
    for (const member of ['increment', 'incrementInch'] as const) {
      if (value[member] !== undefined && !isPositiveDecimal(value[member])) {
        problems.push(problem(id, `${where}.${member}`, 'an increment is decimal text above zero, e.g. "0.001"'));
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// M12: the `channels` block (AD-32, §7.17). P12 wrote the signatures; WP12.3 owns the
// rules and fills `validateChannels`.
// ---------------------------------------------------------------------------

/** What a machine's `params.channels` amounts to (§7.16 #149). */
export type ChannelBlock =
  /** The record has no `channels` member: no channels, nothing shown. */
  | { state: 'absent' }
  /** Every rule of §7.17 holds: the channel service resolves with `params`. */
  | { state: 'valid'; params: ChannelParams }
  /**
   * Kept verbatim in the file, listed on the Machines page with its JSON paths, resolved as
   * `layout: 'none'`; the machine stays selectable with every other parameter (X12 d).
   */
  | { state: 'invalid'; problems: MachineProblem[] };

/** The id of a channel: lower case letters and digits, `-` and `_`, at most 16 characters. */
export const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,15}$/;

const SEMANTICS = ['rendezvous', 'count', 'ordered'] as const;
const DECODES = ['split', 'digits', 'bitmask'] as const;
const TEMPLATE_NAMES = new Set(['stem', 'channel']);

/** True when `source` declares the named group `(?<name>…)`. */
function hasGroup(source: string, name: string): boolean {
  return source.includes(`(?<${name}>`);
}

/** The `{{…}}` names of a file-name template that are not `stem` or `channel`. */
export function templateStrangers(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{\{([^}]*)\}\}/g)) {
    if (!TEMPLATE_NAMES.has(m[1].trim())) out.push(m[0]);
  }
  return out;
}

/** `{stem}` or `{channel}` written with one brace: the product only knows the double form. */
export function singleBraceNames(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/(?<!\{)\{(stem|channel)\}(?!\})/g)) out.push(m[0]);
  return out;
}

/**
 * Does a pattern repeat a group whose inside repeats again, or chooses (`(\d+)+`, `(.*)*`,
 * `(a|aa)+`)? Those can take exponentially long on a line that almost matches. A heuristic
 * scan (escapes and character classes are skipped); the price of a false alarm is a pattern
 * written another way. Returns true for the first such group.
 */
export function hasRepeatedGroupShape(source: string): boolean {
  const open: { unbounded: boolean; choice: boolean }[] = [];
  let i = 0;
  const unboundedAt = (at: number): number => {
    const c = source[at];
    if (c === '+' || c === '*') return 1;
    if (c === '{') {
      const m = /^\{\d+,\}/.exec(source.slice(at, at + 12));
      return m === null ? 0 : m[0].length;
    }
    return 0;
  };
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') {
      i++;
      while (i < source.length && source[i] !== ']') i += source[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '(') {
      open.push({ unbounded: false, choice: false });
    } else if (c === '|') {
      const top = open[open.length - 1];
      if (top) top.choice = true;
    } else if (c === ')') {
      const group = open.pop();
      const q = unboundedAt(i + 1);
      if (group !== undefined && q > 0 && (group.unbounded || group.choice)) return true;
      // What the group holds counts for the group around it.
      const parent = open[open.length - 1];
      if (parent && (group?.unbounded || q > 0)) parent.unbounded = true;
    } else {
      const q = unboundedAt(i);
      if (q > 0) {
        const top = open[open.length - 1];
        if (top) top.unbounded = true;
        i += q;
        continue;
      }
    }
    i++;
  }
  return false;
}

/**
 * One user pattern: text, at most 1,000 characters, compiles, inside the AD-11 subset
 * (standing rule 15). The messages are written for someone who has never seen a regular
 * expression: they say where the pattern is and what is wrong, and point at Advanced.
 * Returns the source when it is usable, `null` after pushing the problem.
 */
function patternProblems(raw: unknown, what: string, at: string, id: string | null, out: MachineProblem[]): string | null {
  if (typeof raw !== 'string' || raw === '') {
    out.push(problem(id, at, `${what} has to be a pattern written as text`));
    return null;
  }
  if (raw.length > CHANNEL_CAPS.patternLength) {
    out.push(problem(id, at, `${what} is longer than ${CHANNEL_CAPS.patternLength} characters`));
    return null;
  }
  try {
    new RegExp(raw, 'i');
  } catch (e) {
    out.push(problem(id, at, `${what} is not a valid pattern: ${e instanceof Error ? e.message : String(e)}`));
    return null;
  }
  const subset = patternSubsetProblem(raw);
  if (subset !== null) {
    out.push(problem(id, at, `${what} uses something gEdit's pattern language does not have: ${subset}`));
    return null;
  }
  if (hasRepeatedGroupShape(raw)) {
    out.push(
      problem(
        id,
        at,
        `${what} can take very long on some lines; write it without a repeated part inside a repeated part, and without a choice (|) inside a repeated part`,
      ),
    );
    return null;
  }
  return raw;
}

/**
 * The problems of a `channels` block against §7.17, each with a JSON path under `path`
 * (`machines[2].params.channels.syncMarks[0].match.codes`). Also run over every built-in
 * preset (`machineParams.channels.presets[i].value`) by `validateProfile`.
 *
 * `waitLetters` are the profile's `machineParams.channels.waitLetters`, for the plain
 * wait-code list (`parseWaitCodes`).
 *
 * Messages are plain English sentences like the rest of this file (the page wraps each in
 * `machines.page.problem`); the wait-code list messages come from `channels.codes.*` and
 * quote the item. Unknown members are kept and never reported. **A problem invalidates the
 * block, never the record** (X12 d): `validateMachine` does not call this.
 */
export function validateChannels(
  raw: unknown,
  path: string,
  machineId: string | null,
  o: { waitLetters?: readonly string[] } = {},
): MachineProblem[] {
  const out: MachineProblem[] = [];
  const id = machineId;
  const add = (at: string, message: string): void => void out.push(problem(id, at, message));
  if (!isRecord(raw)) return [problem(id, path, 'the channel settings have to be a JSON object')];

  const layout = raw.layout;
  if (layout !== 'single-file' && layout !== 'multi-file') {
    add(`${path}.layout`, 'the layout is "single-file" (all channels in one program) or "multi-file" (one program per channel); to have no channels, remove the block');
  }
  const single = layout === 'single-file';
  const multi = layout === 'multi-file';

  // --- the channels -------------------------------------------------------------------
  const tokens = new Map<string, string>(); // lower-cased id or alias -> where it was declared
  const ids = new Set<string>();
  const list = raw.list;
  if (!Array.isArray(list)) {
    add(`${path}.list`, 'list the channels (at least two), each with an id and a name');
  } else {
    if (list.length < 2) add(`${path}.list`, `a machine with channels has at least two of them; this one lists ${list.length}`);
    if (list.length > CHANNEL_CAPS.channels) add(`${path}.list`, `at most ${CHANNEL_CAPS.channels} channels; this one lists ${list.length}`);
    // Ids first, so an alias can be compared with every id, also a later one.
    list.forEach((entry) => {
      if (isRecord(entry) && typeof entry.id === 'string') ids.add(entry.id.toLowerCase());
    });
    list.forEach((entry, i) => {
      const at = `${path}.list[${i}]`;
      const label = `channel ${i + 1}`;
      if (!isRecord(entry)) {
        add(at, `${label} has to be an entry with an id and a name`);
        return;
      }
      if (typeof entry.id !== 'string' || !CHANNEL_ID_RE.test(entry.id)) {
        add(`${at}.id`, `the id of ${label} is 1 to 16 lower-case letters, digits, "-" or "_", starting with a letter or digit`);
      } else {
        const key = entry.id.toLowerCase();
        const first = tokens.get(key);
        if (first !== undefined) add(`${at}.id`, `the id "${entry.id}" of ${label} is already used (${first})`);
        else tokens.set(key, `${label}'s id`);
      }
      if (typeof entry.name !== 'string' || entry.name.trim() === '' || entry.name.length > 32) {
        add(`${at}.name`, `the name of ${label} is 1 to 32 characters`);
      }
      if (entry.aliases !== undefined) {
        if (!Array.isArray(entry.aliases)) add(`${at}.aliases`, `the other spellings of ${label} are a list of text`);
        else {
          if (entry.aliases.length > CHANNEL_CAPS.aliases) {
            add(`${at}.aliases`, `${label} has ${entry.aliases.length} other spellings; at most ${CHANNEL_CAPS.aliases}`);
          }
          entry.aliases.forEach((alias: unknown, k: number) => {
            const where = `${at}.aliases[${k}]`;
            if (typeof alias !== 'string' || alias.trim() === '' || alias.length > 32) {
              add(where, `an other spelling of ${label} is 1 to 32 characters`);
              return;
            }
            const key = alias.toLowerCase();
            const own = typeof entry.id === 'string' && entry.id.toLowerCase() === key;
            if (own) return; // the channel's own id again: harmless
            if (ids.has(key)) add(where, `"${alias}" is the id of another channel, so it cannot be a spelling of ${label}`);
            else if (tokens.has(key)) add(where, `"${alias}" already names ${tokens.get(key)}`);
            else tokens.set(key, `an other spelling of ${label}`);
          });
        }
      }
      if (entry.fileName !== undefined) {
        if (!multi) add(`${at}.fileName`, 'a file name for a channel only makes sense when each channel has its own program');
        else if (typeof entry.fileName !== 'string' || entry.fileName.trim() === '') {
          add(`${at}.fileName`, `the file name of ${label} is text, for example {{stem}}_CH2.nc`);
        } else {
          const strangers = templateStrangers(entry.fileName);
          if (strangers.length > 0) add(`${at}.fileName`, `a file name may use {{stem}} and {{channel}} only, not ${strangers.join(', ')}`);
          const single = singleBraceNames(entry.fileName);
          if (single.length > 0) add(`${at}.fileName`, `write ${single.map((n) => `{${n}}`).join(', ')} instead of ${single.join(', ')} (two braces on each side)`);
        }
      }
    });
  }
  const declared = (name: unknown): boolean => typeof name === 'string' && tokens.has(name.toLowerCase());

  // --- the layout's patterns ------------------------------------------------------------
  const present = (key: string): boolean => raw[key] !== undefined && raw[key] !== null;
  if (single) {
    if (!present('sectionStart')) add(`${path}.sectionStart`, 'say which line starts a channel section, for example the line with G13 or G14');
    for (const key of ['fileName', 'fileNameFor', 'marker'])
      if (present(key)) add(`${path}.${key}`, `"${key}" belongs to a layout with one program per channel, not to one program with sections`);
  }
  if (multi) {
    for (const key of ['sectionStart', 'sectionEnd', 'sectionSeparator'])
      if (present(key)) add(`${path}.${key}`, `"${key}" belongs to one program with sections, not to one program per channel`);
  }
  if (single && present('sectionStart')) patternProblems(raw.sectionStart, 'the section start', `${path}.sectionStart`, id, out);
  if (single && present('sectionEnd')) patternProblems(raw.sectionEnd, 'the section end', `${path}.sectionEnd`, id, out);
  if (single && present('sectionSeparator')) {
    const sep = raw.sectionSeparator;
    if (typeof sep !== 'string' || !/^[^\w\s]$/u.test(sep)) {
      add(`${path}.sectionSeparator`, 'the separator is one character that is not a letter, a digit or a blank, for example "/"');
    }
  }
  if (multi) {
    if (present('fileName')) {
      const src = patternProblems(raw.fileName, 'the file name pattern', `${path}.fileName`, id, out);
      if (src !== null && !(hasGroup(src, 'stem') && hasGroup(src, 'channel'))) {
        add(`${path}.fileName`, 'the file name pattern has to capture the common part of the name as (?<stem>…) and the channel as (?<channel>…)');
      }
    }
    if (present('fileNameFor')) {
      if (typeof raw.fileNameFor !== 'string' || raw.fileNameFor.trim() === '') {
        add(`${path}.fileNameFor`, 'the file name template is text, for example {{stem}}_CH{{channel}}.nc');
      } else {
        const strangers = templateStrangers(raw.fileNameFor);
        if (strangers.length > 0) add(`${path}.fileNameFor`, `a file name may use {{stem}} and {{channel}} only, not ${strangers.join(', ')}`);
        const single = singleBraceNames(raw.fileNameFor);
        if (single.length > 0) add(`${path}.fileNameFor`, `write ${single.map((n) => `{${n}}`).join(', ')} instead of ${single.join(', ')} (two braces on each side)`);
        else if (strangers.length === 0 && !/\{\{\s*channel\s*\}\}/.test(raw.fileNameFor)) add(`${path}.fileNameFor`, 'the file name template has to contain {{channel}}, or every channel would get the same name');
      }
    }
    if (present('marker')) {
      const src = patternProblems(raw.marker, 'the channel marker', `${path}.marker`, id, out);
      if (src !== null && !hasGroup(src, 'channel')) add(`${path}.marker`, 'the channel marker has to capture the channel as (?<channel>…)');
    }
  }

  // --- the wait rules -------------------------------------------------------------------
  if (raw.stopsAndEndsWait !== undefined && typeof raw.stopsAndEndsWait !== 'boolean') {
    add(`${path}.stopsAndEndsWait`, '"stops and ends count as waits" is on or off');
  }
  const rules = raw.syncMarks;
  if (rules !== undefined) {
    if (!Array.isArray(rules)) add(`${path}.syncMarks`, 'the wait rules are a list');
    else {
      if (rules.length > CHANNEL_CAPS.rules) add(`${path}.syncMarks`, `at most ${CHANNEL_CAPS.rules} wait rules; this one has ${rules.length}`);
      const seen = new Set<string>();
      rules.forEach((rule, i) => ruleProblems(rule, i, `${path}.syncMarks[${i}]`, seen, declared, o, id, out));
    }
  }
  return out;
}

/** One sync rule. `seen` collects the ids of the earlier rules. */
function ruleProblems(
  rule: unknown,
  index: number,
  at: string,
  seen: Set<string>,
  declared: (name: unknown) => boolean,
  o: { waitLetters?: readonly string[] },
  id: string | null,
  out: MachineProblem[],
): void {
  const add = (where: string, message: string): void => void out.push(problem(id, where, message));
  const label = `wait rule ${index + 1}`;
  if (!isRecord(rule)) {
    add(at, `${label} has to be an entry with an id, a label, what it matches and who it waits for`);
    return;
  }
  if (typeof rule.id !== 'string' || rule.id.trim() === '') add(`${at}.id`, `${label} needs an id`);
  else if (rule.id === STOPS_AND_ENDS_RULE) add(`${at}.id`, `the id "${STOPS_AND_ENDS_RULE}" is kept for the "stops and ends count as waits" setting`);
  else if (seen.has(rule.id)) add(`${at}.id`, `the id "${rule.id}" of ${label} is already used by another rule`);
  else seen.add(rule.id);
  if (typeof rule.label !== 'string') add(`${at}.label`, `${label} needs a label`);
  const sem = rule.semantics ?? 'rendezvous';
  if (!SEMANTICS.includes(sem as (typeof SEMANTICS)[number])) {
    add(`${at}.semantics`, `what ${label} checks is one of ${SEMANTICS.join(', ')}`);
  }
  if (rule.blocking !== undefined && typeof rule.blocking !== 'boolean') add(`${at}.blocking`, `"blocking" of ${label} is on or off`);

  // what it matches
  const match = rule.match;
  if (!isRecord(match)) add(`${at}.match`, `${label}: say which codes it matches`);
  else if (match.kind === 'codes') {
    if (typeof match.codes !== 'string') add(`${at}.match.codes`, `${label}: the wait codes are text, for example M100-M199`);
    else {
      const parsed = parseWaitCodes(match.codes, { letters: o.waitLetters });
      for (const error of parsed.errors) add(`${at}.match.codes`, t(error.key, error.params));
    }
  } else if (match.kind === 'prefix') {
    if (typeof match.prefix !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,7}$/.test(match.prefix)) {
      add(`${at}.match.prefix`, `${label}: the start of a code is a letter and up to seven letters or digits, for example M1`);
    }
    const d = match.idDigits;
    if (d !== undefined) {
      const ok = isRecord(d) && Number.isInteger(d.min) && Number.isInteger(d.max) && (d.min as number) >= 1 && (d.max as number) <= 8 && (d.min as number) <= (d.max as number);
      if (!ok) add(`${at}.match.idDigits`, `${label}: the number of digits is "min" and "max", from 1 to 8, with min not above max`);
    }
  } else if (match.kind === 'regex') {
    const src = patternProblems(match.pattern, `the pattern of ${label}`, `${at}.match.pattern`, id, out);
    if (src !== null && sem !== 'count' && !hasGroup(src, 'mark')) {
      add(`${at}.match.pattern`, `the pattern of ${label} has to capture the wait's number as (?<mark>…); only a rule that checks by count has none`);
    }
  } else {
    add(`${at}.match.kind`, `${label}: a rule matches "codes", a "prefix" or a "regex"`);
  }

  // who it waits for
  const partners = rule.partners;
  if (!isRecord(partners)) {
    add(`${at}.partners`, `${label}: say which channels it waits for`);
    return;
  }
  const names = (value: unknown, where: string): void => {
    if (!Array.isArray(value) || value.length === 0) {
      add(where, `${label}: list at least one channel`);
      return;
    }
    for (const [k, name] of value.entries()) {
      if (!declared(name)) add(`${where}[${k}]`, `${label}: "${String(name)}" is not a channel of this machine`);
    }
  };
  const whenAbsent = (value: unknown, where: string): void => {
    if (value === undefined) return;
    if (!isRecord(value) || !['none', 'all', 'fixed'].includes(String(value.kind))) {
      add(where, `${label}: a wait without the P word means "none", "all" or "fixed"`);
    } else if (value.kind === 'fixed') names(value.channels, `${where}.channels`);
  };
  switch (partners.kind) {
    case 'all':
      break;
    case 'fixed':
      names(partners.channels, `${at}.partners.channels`);
      break;
    case 'word':
      if (typeof partners.address !== 'string' || !/^[A-Za-z]$/.test(partners.address)) {
        add(`${at}.partners.address`, `${label}: the address letter is one letter, for example P`);
      }
      if (partners.decode !== 'digits' && partners.decode !== 'bitmask') {
        add(`${at}.partners.decode`, `${label}: the number is read as "digits" (path numbers) or "bitmask" (a bit sum)`);
      }
      whenAbsent(partners.whenAbsent, `${at}.partners.whenAbsent`);
      break;
    case 'line': {
      const src = patternProblems(partners.pattern, `the partner pattern of ${label}`, `${at}.partners.pattern`, id, out);
      if (src !== null && !hasGroup(src, 'channels')) {
        add(`${at}.partners.pattern`, `the partner pattern of ${label} has to capture the channels as (?<channels>…)`);
      }
      if (partners.separator !== undefined && typeof partners.separator !== 'string') {
        add(`${at}.partners.separator`, `${label}: the separator is text, for example ","`);
      }
      if (partners.decode !== undefined && !DECODES.includes(partners.decode as (typeof DECODES)[number])) {
        add(`${at}.partners.decode`, `${label}: the channels are read as ${DECODES.join(', ')}`);
      }
      whenAbsent(partners.whenAbsent, `${at}.partners.whenAbsent`);
      break;
    }
    default:
      add(`${at}.partners.kind`, `${label}: it waits for "all" channels, "fixed" channels, a "word" or a "line" pattern`);
  }
}

/**
 * True for a `multi-file` block no pattern or template can address: its programs can only
 * be tied to a channel by hand (`channels.assign`). The block is valid; the page says so.
 */
export function isAssignOnly(p: ChannelParams): boolean {
  if (p.layout !== 'multi-file') return false;
  const named = typeof p.fileName === 'string' && p.fileName !== '';
  const marker = typeof p.marker === 'string' && p.marker !== '';
  const templates = Array.isArray(p.list) && p.list.length > 0 && p.list.every((c) => typeof c.fileName === 'string' && c.fileName !== '');
  return !named && !marker && !templates;
}

/**
 * The channel block of one stored machine, for the channel service and the Machines page.
 * `valid` carries the stored value with a missing `syncMarks` read as no rules.
 */
export function channelBlock(m: MachineConfig, path: string, o: { waitLetters?: readonly string[] } = {}): ChannelBlock {
  const params = isRecord(m.params) ? (m.params as Record<string, unknown>) : {};
  const raw = params.channels;
  if (raw === undefined) return { state: 'absent' };
  const id = typeof m.id === 'string' ? m.id : null;
  const problems = validateChannels(raw, `${path}.params.channels`, id, o);
  if (problems.length > 0) return { state: 'invalid', problems };
  const block = raw as unknown as ChannelParams;
  return { state: 'valid', params: Array.isArray(block.syncMarks) ? block : { ...block, syncMarks: [] } };
}
