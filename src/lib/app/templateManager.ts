// The template manager's model (Phase 3 plan §6.7, §6.11, P3.9, AD-40; `docs/planning/code-assistant.md`
// "Template files and management"). Owner: P3.9. The dialog (`components/dialogs/TemplateManager.svelte`)
// shows this state and calls these methods; `contrib/templateManager.ts` wires the real services.
//
// What the manager edits: the `templates` member of **one user code file**, `<config>/codes/<dialect>.json`,
// for the database `dialect` (the active document's profile's own database, `profile.codes`). The built-in
// templates of that database (and of the ones it extends) are listed read-only beside them; a user
// template with the id of a built-in one **replaces** it (an "override", AD-37), any other id adds one.
//
// The rules (binding):
//
//  1. **No new Rust command** (AD-40). A file that does not exist yet is made with `user_file_create`
//     (`{ "dialect", "version": 1, "templates": […] }`, two-space indentation). An existing file is
//     changed in its **document**: the document is opened (a tab, left open) when it is not, its
//     `templates` member is replaced (every other member kept in its place, two-space indentation) as
//     one edit, and the document is saved with `files.save` — so the backup of M7, the external-change
//     check and the reload of the code files on save (M13) all apply and the change can be seen and
//     undone in the tab. The tab that was active stays the active one.
//  2. **Never an invalid file.** Save runs the edited list through `loadTemplates` (the one reader the
//     loader and the built-ins use); any problem is shown with its path and nothing is written. A
//     template in the file that the loader could not read is kept **by value** (it is shown with its
//     problems and can be deleted, never silently lost; the file is written again as JSON, so spacing,
//     a number like `1.50` and a number the double cannot hold are written in their canonical form); a
//     template that was not edited is written back from the file's own JSON, so members the loader
//     ignores survive; an edited one keeps them too, in its parameters and choices as well.
//  2a. **The control's file size.** The file is read by the program with a limit of one mebibyte
//     (`TEMPLATE_LIMITS.fileBytes`); a list that would be larger is refused before anything is written.
//  3. **No lost edits.** A file whose document has unsaved changes is refused ("Save or close <file>
//     first"); a file whose `templates` member differs from what the manager read is refused ("changed
//     since"); a file that is not one JSON object is refused with the reason. Nothing is written in
//     any of these cases. A locked file (the read-only lock, AD-23) is refused too, and a Save that
//     fails after the text was put into the file's tab puts the tab back as it was (clean).
//  4. Everything the user typed or a file holds (labels, groups, bodies, JSON paths) is data and is shown
//     as text, never translated and never as markup (AD-14).
//
// The model has no Monaco, no store and no Tauri import: `TemplateManagerDeps` is everything it reaches,
// so the unit tests drive it with fakes.

import { get, writable, type Readable } from 'svelte/store';
import { t } from '$lib/i18n';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import {
  TEMPLATE_ID,
  TEMPLATE_LIMITS,
  TEMPLATE_PARAM_ID,
  checkFormula,
  draftToTemplate,
  loadTemplates,
  renderTemplate,
  templatesForMachines,
  type SelectionCandidate,
  type TemplateDef,
  type TemplateDraft,
  type TemplateEnv,
  type TemplateParam,
  type TemplateParamType,
  type TemplateProblem,
} from '$lib/core/templates';
import type { Msg } from '$lib/app/types';

// ---------------------------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------------------------

/** Where a row comes from: the program (`builtin`), the user's file (`user`), the user's file replacing a built-in one (`override`). */
export type RowOrigin = 'builtin' | 'user' | 'override';

/** One problem of a template, with its place in plain words. */
export interface ProblemLine {
  /** The row it belongs to, or null for a problem of the whole list. */
  row: string | null;
  /** The loader's JSON path below the template (`.params[1].prefix`); `[3].id` for a problem of the whole list. */
  path: string;
  /** `Depth hole › Parameter 2 (Depth) › Prefix`. */
  where: string;
  message: string;
}

export interface ManagerRow {
  key: string;
  origin: RowOrigin;
  /** The template; null for an entry of the file the loader could not read (kept as it is). */
  def: TemplateDef | null;
  /** The entry as the file has it (user rows read from a file); absent for a row made here. */
  raw?: unknown;
  /** True once the row was changed here or must be written from the loader's reading (it had a note). */
  edited: boolean;
  /** What the loader said about the file's entry and how it read it anyway (a mistyped flag). */
  notes: ProblemLine[];
  /** The current problems; a template with any cannot be saved. */
  problems: ProblemLine[];
  /** Built-in rows: the databases that switch to their own version of this template. */
  variants: { dialect: string; label: string }[];
}

/** The numbers of the selection the user can tick ("New Template from Selection"). */
export interface DraftState {
  draft: TemplateDraft;
  /** Keys of the ticked candidates. */
  chosen: string[];
  label: string;
  id: string;
  /** True once the user typed the id: the label no longer drives it. */
  idTouched: boolean;
  group: string;
  error: Msg | null;
}

export interface ManagerState {
  ready: boolean;
  busy: boolean;
  /** The database being edited and the choices. */
  dialect: string;
  dialects: string[];
  /** `<dialect>.json`, and whether the file is there. */
  fileName: string;
  fileExists: boolean;
  /** Why the file cannot be edited (not valid JSON, `templates` not a list). */
  fileError: Msg | null;
  rows: ManagerRow[];
  selected: string | null;
  dirty: boolean;
  /** The ids starred in this database. */
  favorites: string[];
  /** Problems shown in the list at the bottom: those of the last Save. */
  problems: ProblemLine[];
  /** The last thing that happened: Saved, refused, … */
  message: { msg: Msg; error: boolean } | null;
  draft: DraftState | null;
}

/** The result of Save. */
export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'dirtyDocument' | 'changed' | 'fileError' | 'failed' | 'nothing' };

/** What the live preview shows for a template. */
export type Preview =
  | { kind: 'text'; text: string }
  /** `key`: the message key of the first reason (the dialog's `data-error`). */
  | { kind: 'errors'; key: string; lines: string[] }
  | { kind: 'none' };

/** The open documents the manager changes the user file through. */
export interface DocumentPort {
  find(path: string): { id: string; dirty: boolean; title: string } | undefined;
  /** Opens the file in a tab. An untouched new document stays (the program the user works in is not replaced). */
  open(path: string): Promise<string | null>;
  text(id: string): string;
  replace(id: string, text: string): void;
  /** Why the document cannot be changed (the read-only lock), or null; `action` is display text. */
  refusal(id: string, action: string): Msg | null;
  /** Marks the document as saved: its text is what is on disk. */
  markClean(id: string): void;
  save(id: string): Promise<boolean>;
  activeId(): string | null;
  activate(id: string): void;
}

export interface TemplateManagerDeps {
  /** The ids a manager can open: every built-in database and every user code file. */
  dialects(): string[];
  /** The templates `dialect` has without its own user file: the built-in ones, inherited ones included. */
  baseTemplates(dialect: string): TemplateDef[];
  /**
   * The machine type of every profile whose programs use `dialect` (it names the set as its code set or
   * as the set of one of its variants), `undefined` for a profile without one. The built-in rows are
   * those the set offers to such a program (`templatesForMachines`); with none, every row is shown.
   * Absent: nothing is left out.
   */
  machineTypes?(dialect: string): (string | undefined)[];
  /** The databases that extend `dialect` and replace some of its templates (the G-code system B). */
  variants(dialect: string): { dialect: string; label: string; ids: string[] }[];
  userFiles: {
    /** The code files of the user's folder, with their text. */
    list(): Promise<{ name: string; text: string | null; error: string | null }[]>;
    path(name: string): Promise<string>;
    create(name: string, text: string): Promise<string>;
  };
  /** Reads the user folders again (so the registries and the Insert tab see the new file). */
  reloadUserFiles(): Promise<unknown>;
  docs: DocumentPort;
  confirm(o: { title: string; message: string; ok: string }): Promise<boolean>;
  favorites: { get(dialect: string): string[]; set(dialect: string, id: string, on: boolean): void };
  /** The document's environment for the preview, or null when there is none. */
  env(): TemplateEnv | null;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (also used by the dialog)
// ---------------------------------------------------------------------------------------------

/** The members a parameter of each type may carry (the loader refuses the others). */
export const PARAM_MEMBERS: Readonly<Record<TemplateParamType, readonly string[]>> = {
  number: ['id', 'label', 'type', 'help', 'required', 'min', 'max', 'default', 'decimals', 'prefix', 'suffix', 'plusSign', 'remember'],
  integer: ['id', 'label', 'type', 'help', 'required', 'min', 'max', 'default', 'digits', 'prefix', 'suffix', 'plusSign', 'remember'],
  text: ['id', 'label', 'type', 'help', 'required', 'default', 'prefix', 'suffix', 'uppercase', 'comment', 'remember'],
  choice: ['id', 'label', 'type', 'help', 'required', 'default', 'choices', 'prefix', 'suffix', 'remember'],
  formula: ['id', 'label', 'type', 'help', 'formula', 'decimals', 'digits', 'prefix', 'suffix', 'plusSign', 'hidden'],
};

export const PARAM_TYPES: readonly TemplateParamType[] = ['number', 'integer', 'text', 'choice', 'formula'];

/** The id a label suggests: lower-case letters, digits and `-`, at most 64. */
export function slugId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/** `base`, or `base-2`, `base-3`, … until `taken` does not hold it. */
export function uniqueId(base: string, taken: ReadonlySet<string>, max = 64): string {
  const start = base === '' ? 'template' : base.slice(0, max);
  if (!taken.has(start)) return start;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${start.slice(0, max - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The body with `text` put over `start…end` (a caret when equal), and where the caret goes. */
export function insertAt(body: string, start: number, end: number, text: string): { body: string; caret: number } {
  const from = Math.max(0, Math.min(start, body.length));
  const to = Math.max(from, Math.min(end, body.length));
  return { body: `${body.slice(0, from)}${text}${body.slice(to)}`, caret: from + text.length };
}

/** The `{{…}}` a placeholder button writes: `N` and `sys.*` as they are, a parameter by its id. */
export function placeholderText(name: string): string {
  return `{{${name}}}`;
}

/** The rows the list shows: built-in rows a user template of the same id replaces are left out, then the filter. */
export function visibleRows(state: Pick<ManagerState, 'rows'>, query: string): ManagerRow[] {
  const replaced = new Set(state.rows.filter((r) => r.origin === 'override' && r.def !== null).map((r) => (r.def as TemplateDef).id));
  const needle = query.trim().toLowerCase();
  return state.rows.filter((row) => {
    if (row.origin === 'builtin' && row.def !== null && replaced.has(row.def.id)) return false;
    if (needle === '') return true;
    const d = row.def;
    if (d === null) return typeof row.raw === 'object' && row.raw !== null && JSON.stringify(row.raw).toLowerCase().includes(needle);
    return `${d.label}\n${d.id}\n${d.group}\n${d.description ?? ''}`.toLowerCase().includes(needle);
  });
}

/** The rows by group, groups in the order they first appear; a row the loader could not read is in a group of no name. */
export function groupRows(rows: readonly ManagerRow[]): { group: string; rows: ManagerRow[] }[] {
  const out: { group: string; rows: ManagerRow[] }[] = [];
  for (const row of rows) {
    const group = row.def?.group ?? '';
    let entry = out.find((g) => g.group === group);
    if (entry === undefined) {
      entry = { group, rows: [] };
      out.push(entry);
    }
    entry.rows.push(row);
  }
  return out;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  return err instanceof Error ? err.message : String(err);
}

/** The field names as the dialog and the problems call them. */
function fieldName(name: string): string {
  const key = `templateManager.field.${name}`;
  const text = t(key);
  return text === key ? name : text;
}

/** `.params[1].prefix` below a template → "Depth hole › Parameter 2 (Depth) › Written before", read against its definition. */
function whereOf(def: TemplateDef | null, rel: string): string {
  const parts: string[] = [def === null ? t('templateManager.where.unreadable') : def.label];
  const match = /^\.params\[(\d+)\](?:\.(\w+))?(.*)$/.exec(rel);
  if (match !== null) {
    const index = Number(match[1]);
    const p = def?.params?.[index];
    parts.push(p === undefined ? t('templateManager.where.param', { n: index + 1 }) : t('templateManager.where.paramNamed', { n: index + 1, label: p.label }));
    if (match[2] !== undefined) parts.push(fieldName(match[2]));
    return parts.join(' › ');
  }
  const member = /^\.(\w+)/.exec(rel);
  if (member !== null) parts.push(fieldName(member[1]));
  return parts.join(' › ');
}

/** A loader problem as a line of a row, `rel` being its path below the template. */
function lineOf(row: string, def: TemplateDef | null, p: TemplateProblem, rel: string): ProblemLine {
  return { row, path: rel, where: whereOf(def, rel), message: p.message };
}

/** Splits a loader path: `[2].params[0].id` → index 2 and `.params[0].id`. */
function memberPath(path: string): { index: number | null; rel: string } {
  const m = /^\[(\d+)\](.*)$/.exec(path);
  return m === null ? { index: null, rel: path } : { index: Number(m[1]), rel: m[2] };
}

/** Puts `value` on `out` as an own member even for the key `__proto__` (a plain assignment would set the prototype). */
function setOwn(out: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

/** The text of a user code file: its members as they were, `templates` replaced in place or added. */
export function fileTextWith(existing: Record<string, unknown> | null, dialect: string, templates: unknown[]): string {
  const out: Record<string, unknown> = {};
  if (existing === null) {
    out.dialect = dialect;
    out.version = 1;
    out.templates = templates;
  } else {
    let placed = false;
    for (const [key, value] of Object.entries(existing)) {
      if (key === 'templates') {
        setOwn(out, 'templates', templates);
        placed = true;
      } else setOwn(out, key, value);
    }
    if (!placed) out.templates = templates;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

const TEMPLATE_MEMBERS = new Set(['id', 'label', 'group', 'description', 'toolbar', 'snippet', 'machineType', 'review', 'body', 'params']);
/** Every member some parameter type may carry: a member of the file's parameter outside this set is one the loader ignores. */
const KNOWN_PARAM_MEMBERS = new Set<string>([...Object.values(PARAM_MEMBERS).flat()]);
const KNOWN_CHOICE_MEMBERS = new Set(['label', 'value']);

/** The members of `raw` outside `known`, as an object (own members, `__proto__` included). */
function extrasOf(raw: unknown, known: ReadonlySet<string>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (isRecord(raw)) for (const [key, value] of Object.entries(raw)) if (!known.has(key)) setOwn(extra, key, value);
  return extra;
}

/** The file's entry that `item` (read, possibly renamed) came from: the same key, else the one at the same place whose key is no longer used. */
function sourceOf(items: readonly unknown[], at: number, keyOf: (x: unknown) => unknown, wanted: unknown, taken: ReadonlySet<unknown>): unknown {
  const same = items.find((x) => isRecord(x) && keyOf(x) === wanted);
  if (same !== undefined) return same;
  const here = items[at];
  return isRecord(here) && !taken.has(keyOf(here)) ? here : undefined;
}

/**
 * An edited template as the loader read it, plus the members of the file's entry the loader ignores
 * (a note the user wrote by hand): on the template, on each parameter and on each choice.
 */
function withUnknownMembers(read: TemplateDef, raw: unknown): unknown {
  if (!isRecord(raw)) return read;
  const out: Record<string, unknown> = { ...read };
  const rawParams = Array.isArray(raw.params) ? (raw.params as unknown[]) : [];
  if (read.params !== undefined && rawParams.length > 0) {
    const readIds = new Set<unknown>(read.params.map((p) => p.id));
    out.params = read.params.map((p, i) => {
      const source = sourceOf(rawParams, i, (x) => (x as Record<string, unknown>).id, p.id, readIds);
      if (source === undefined) return p;
      const copy: Record<string, unknown> = { ...p };
      for (const [key, value] of Object.entries(extrasOf(source, KNOWN_PARAM_MEMBERS))) setOwn(copy, key, value);
      const rawChoices = (source as Record<string, unknown>).choices;
      if (p.choices !== undefined && Array.isArray(rawChoices)) {
        const values = new Set<unknown>(p.choices.map((c) => c.value));
        copy.choices = p.choices.map((c, k) => {
          const from = sourceOf(rawChoices as unknown[], k, (x) => (x as Record<string, unknown>).value, c.value, values);
          if (from === undefined) return c;
          const choice: Record<string, unknown> = { ...c };
          for (const [key, value] of Object.entries(extrasOf(from, KNOWN_CHOICE_MEMBERS))) setOwn(choice, key, value);
          return choice;
        });
      }
      return copy;
    });
  }
  for (const [key, value] of Object.entries(extrasOf(raw, TEMPLATE_MEMBERS))) setOwn(out, key, value);
  return out;
}

/** The starting values of a template for the preview, and the required parameters that have none. */
function previewValues(def: TemplateDef): { values: Record<string, unknown>; missing: TemplateParam[] } {
  const values: Record<string, unknown> = {};
  const missing: TemplateParam[] = [];
  for (const p of def.params ?? []) {
    if (p.type === 'formula') continue;
    if (p.default !== undefined) values[p.id] = typeof p.default === 'number' ? String(p.default) : p.default;
    else if (p.required === true) missing.push(p);
  }
  return { values, missing };
}

/** Renames `{{old}}` in a body and the name `old` in the formulas, the id of a parameter changed. */
function renamedParam(def: TemplateDef, from: string, to: string): void {
  def.body = def.body.split(`{{${from}}}`).join(`{{${to}}}`);
  const word = new RegExp(`(?<![A-Za-z0-9_])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g');
  for (const p of def.params ?? []) if (p.type === 'formula' && typeof p.formula === 'string') p.formula = p.formula.replace(word, to);
}

/** The `extends` chain of `id` in a set of raw database files, `id` first (cycles and unknown parents end it). */
function chainOf(sources: Record<string, unknown>, id: string): string[] {
  const chain: string[] = [];
  let at: string | null = id;
  while (at !== null && !chain.includes(at) && Object.hasOwn(sources, at)) {
    chain.push(at);
    const raw: unknown = sources[at];
    const parent: unknown = isRecord(raw) ? raw.extends : undefined;
    at = typeof parent === 'string' && parent !== '' ? parent : null;
  }
  return chain;
}

/**
 * The templates `dialect` has without the user's own file for it: the built-in database's, with
 * everything it extends merged in. `sources` is the loaded set of raw files (`codes.files()`): an
 * overlay of the user's keeps the untouched built-in under `<id>@base`, and a database of the user's
 * own is the user's layer itself, so the user's `templates` are taken out of that one layer.
 */
export function baseTemplatesFrom(sources: Record<string, unknown>, builtinIds: readonly string[], dialect: string): TemplateDef[] {
  if (!Object.hasOwn(sources, dialect)) return [];
  const own = sources[dialect];
  const userLayer = Object.hasOwn(sources, `${dialect}@base`) || !builtinIds.includes(dialect);
  const subset: Record<string, unknown> = {};
  for (const id of chainOf(sources, dialect)) subset[id] = sources[id];
  if (userLayer && isRecord(own)) {
    const stripped = { ...own };
    delete stripped.templates;
    subset[dialect] = stripped;
  }
  const merged = resolveCodeDbFiles(subset)[dialect];
  return merged === undefined ? [] : loadTemplates(merged.templates);
}

/**
 * The databases of `labels` (the non-default choices of a profile's variants: the G-code system B)
 * that extend `dialect` and define templates of their own, with those ids.
 */
export function variantsFrom(
  sources: Record<string, unknown>,
  dialect: string,
  labels: ReadonlyMap<string, string>,
): { dialect: string; label: string; ids: string[] }[] {
  const out: { dialect: string; label: string; ids: string[] }[] = [];
  const idsOf = (id: string): string[] => {
    const raw = sources[id];
    return isRecord(raw) ? loadTemplates(raw.templates).map((d) => d.id) : [];
  };
  for (const [id, label] of labels) {
    if (id === dialect || !Object.hasOwn(sources, id)) continue;
    const chain = chainOf(sources, id);
    const at = chain.indexOf(dialect);
    if (at < 0) continue;
    // A template that a database between the variant and `dialect` defines again is the variant's
    // replacement of that one, not of `dialect`'s (`fanuc-lathe-b` replaces the lathe's "Program
    // start", the mill's stays what it is).
    const between = new Set<string>();
    for (const mid of chain.slice(1, at)) for (const tid of idsOf(mid)) between.add(tid);
    const own = idsOf(id).filter((tid) => !between.has(tid));
    if (own.length > 0) out.push({ dialect: id, label, ids: own });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

export interface TemplateManager {
  readonly state: Readable<ManagerState>;
  /** Opens database `dialect`. False when the user declined to leave unsaved changes. */
  load(dialect: string, o?: { machineType?: 'mill' | 'lathe' }): Promise<boolean>;
  /** Asks, when there are unsaved changes, whether they may go; true to continue (close, switch). */
  leave(): Promise<boolean>;
  select(key: string | null): void;
  add(): void;
  /** `copy`: a template of its own with a new id; `override`: the same id, replacing the built-in one. */
  duplicate(key: string, mode: 'copy' | 'override'): void;
  remove(key: string): Promise<boolean>;
  move(key: string, delta: -1 | 1): void;
  setFavorite(key: string, on: boolean): void;
  setField(key: string, name: 'id' | 'label' | 'group' | 'description' | 'toolbar' | 'snippet' | 'machineType', value: unknown): void;
  setBody(key: string, body: string): void;
  /** Puts a placeholder into the body over `start…end`; answers where the caret goes. */
  insertPlaceholder(key: string, name: string, start: number, end: number): number | null;
  addParam(key: string): void;
  removeParam(key: string, index: number): void;
  moveParam(key: string, index: number, delta: -1 | 1): void;
  setParam(key: string, index: number, name: string, value: unknown): void;
  setParamType(key: string, index: number, type: TemplateParamType): void;
  addChoice(key: string, index: number): void;
  removeChoice(key: string, index: number, choice: number): void;
  setChoice(key: string, index: number, choice: number, name: 'label' | 'value', value: string): void;
  preview(key: string): Preview;
  /** The check of a formula against the template's other parameters (the dialog shows it under the field). */
  formulaProblem(key: string, index: number): string | null;
  startDraft(draft: TemplateDraft, o: { label?: string; group?: string }): void;
  toggleCandidate(key: string): void;
  setAllCandidates(on: boolean): void;
  setDraft(name: 'label' | 'id' | 'group', value: string): void;
  /** The body the ticked candidates would give. */
  draftBody(): string;
  applyDraft(): boolean;
  cancelDraft(): void;
  save(): Promise<SaveResult>;
  /** Reads the file again, dropping the changes (asks when there are some). */
  revert(): Promise<boolean>;
  /** Opens the user file as a document. */
  openFile(): Promise<boolean>;
}

const MAX_FAVORITES = 200;

export function createTemplateManager(deps: TemplateManagerDeps): TemplateManager {
  const store = writable<ManagerState>({
    ready: false,
    busy: false,
    dialect: '',
    dialects: [],
    fileName: '',
    fileExists: false,
    fileError: null,
    rows: [],
    selected: null,
    dirty: false,
    favorites: [],
    problems: [],
    message: null,
    draft: null,
  });

  let counter = 0;
  /** The ids of the built-in templates of the database. */
  let baseIds = new Set<string>();
  /** The file as the manager read it: the `templates` member as JSON. */
  let initialJson = '[]';
  let machineType: 'mill' | 'lathe' | undefined;
  /**
   * The last **valid** id of each parameter of a user row, parallel to its `params` (not saved). Retyping an id
   * goes through invalid texts (empty, a capital letter); `{{id}}` and the formulas are renamed from the last
   * valid id to the next valid one, never from an id that is not one (CODE-04).
   */
  const lastIds = new Map<string, string[]>();
  /** The "leave without saving?" question while it is open. */
  let asking: Promise<boolean> | null = null;
  const lastIdsOf = (key: string, def: TemplateDef): string[] => {
    const have = lastIds.get(key) ?? [];
    const ids = (def.params ?? []).map((p, i) => (have[i] !== undefined && TEMPLATE_PARAM_ID.test(have[i]) ? have[i] : p.id));
    lastIds.set(key, ids);
    return ids;
  };

  const nextKey = (prefix: string): string => `${prefix}${++counter}`;

  const snapshot = (): ManagerState => get(store);

  // --- the list ----------------------------------------------------------------------------

  /** What the file would hold if saved now, before the loader's own reading: for the dirty flag. */
  function candidateOf(rows: readonly ManagerRow[]): unknown[] {
    const out: unknown[] = [];
    for (const row of rows) {
      if (row.origin === 'builtin') continue;
      if (row.def === null || !row.edited) out.push(row.raw);
      else out.push(clone(row.def));
    }
    return out;
  }

  /** Recomputes origins, problems and the dirty flag of `rows`. */
  function refresh(state: ManagerState): ManagerState {
    const seen = new Set<string>();
    const rows = state.rows.map((row): ManagerRow => {
      if (row.origin === 'builtin') return row;
      if (row.def === null) return { ...row, origin: 'user' };
      const origin: RowOrigin = baseIds.has(row.def.id) ? 'override' : 'user';
      const problems: ProblemLine[] = [];
      const found: TemplateProblem[] = [];
      loadTemplates([clone(row.def)], (p) => found.push(p));
      for (const p of found) problems.push(lineOf(row.key, row.def, p, memberPath(p.path).rel));
      if (seen.has(row.def.id)) {
        problems.push({
          row: row.key,
          path: '.id',
          where: whereOf(row.def, '.id'),
          message: t('templateManager.problem.idTwice', { id: row.def.id }),
        });
      }
      seen.add(row.def.id);
      return { ...row, origin, problems };
    });
    const dirty = JSON.stringify(candidateOf(rows)) !== initialJson;
    return { ...state, rows, dirty };
  }

  function commit(change: (s: ManagerState) => ManagerState): void {
    // While a Save or a reading is running the list is not changed: the reading that follows would overwrite it.
    if (snapshot().busy) return;
    // An edit makes the list of the last Save out of date.
    store.update((s) => refresh({ ...change(s), problems: [] }));
  }

  function rowOf(key: string): ManagerRow | undefined {
    return snapshot().rows.find((r) => r.key === key);
  }

  /** Changes the user row `key` (a copy of its template); nothing for a built-in row or one the loader could not read. */
  function edit(key: string, change: (def: TemplateDef) => void): void {
    const row = rowOf(key);
    if (row === undefined || row.origin === 'builtin' || row.def === null || snapshot().busy) return;
    const def = clone(row.def);
    change(def);
    commit((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, def, edited: true } : r)), message: null }));
  }

  function userRows(rows: readonly ManagerRow[]): ManagerRow[] {
    return rows.filter((r) => r.origin !== 'builtin');
  }

  function takenIds(): Set<string> {
    const ids = new Set(baseIds);
    for (const row of snapshot().rows) if (row.def !== null) ids.add(row.def.id);
    return ids;
  }

  function notify(msg: Msg, error = false): void {
    store.update((s) => ({ ...s, message: { msg, error } }));
  }

  // --- reading the database and the file ----------------------------------------------------

  async function readFile(dialect: string): Promise<{
    exists: boolean;
    error: Msg | null;
    entries: unknown[];
  }> {
    const name = `${dialect}.json`;
    let listed: Awaited<ReturnType<TemplateManagerDeps['userFiles']['list']>> = [];
    try {
      listed = await deps.userFiles.list();
    } catch (err) {
      return { exists: false, error: { key: 'templateManager.file.unreadable', params: { name, detail: errorText(err) } }, entries: [] };
    }
    const file = listed.find((f) => f.name === name);
    if (file === undefined) return { exists: false, error: null, entries: [] };
    if (file.text === null) {
      return { exists: true, error: { key: 'templateManager.file.unreadable', params: { name, detail: file.error ?? '' } }, entries: [] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.text);
    } catch (err) {
      return { exists: true, error: { key: 'templateManager.file.notJson', params: { name, detail: errorText(err) } }, entries: [] };
    }
    if (!isRecord(parsed)) return { exists: true, error: { key: 'templateManager.file.notObject', params: { name } }, entries: [] };
    const templates = parsed.templates;
    if (templates !== undefined && !Array.isArray(templates)) {
      return { exists: true, error: { key: 'templateManager.file.notList', params: { name } }, entries: [] };
    }
    return { exists: true, error: null, entries: Array.isArray(templates) ? templates : [] };
  }

  /** Reads `dialect` into the state; the selection and the favourites follow. */
  async function read(dialect: string, keepSelection: string | null = null): Promise<void> {
    const found = await readFile(dialect);
    // What the set offers a program: the inherited templates of the other machine type are not part of it.
    const base = templatesForMachines(deps.baseTemplates(dialect), deps.machineTypes?.(dialect) ?? []);
    baseIds = new Set(base.map((d) => d.id));
    const variants = deps.variants(dialect);
    const baseRows = base.map((def): ManagerRow => ({
      key: `b:${def.id}`,
      origin: 'builtin',
      def,
      edited: false,
      notes: [],
      problems: [],
      variants: variants.filter((v) => v.ids.includes(def.id)).map((v) => ({ dialect: v.dialect, label: v.label })),
    }));
    const rows: ManagerRow[] = [...baseRows];
    found.entries.forEach((raw, i) => {
      const key = nextKey('u');
      const said: TemplateProblem[] = [];
      const defs = loadTemplates([raw], (p) => said.push(p));
      if (defs.length === 1) {
        const notes = said.map((p) => lineOf(key, defs[0], p, memberPath(p.path).rel));
        // A note means the loader read it differently from the file: it is written from that reading.
        rows.push({ key, origin: 'user', def: defs[0], raw, edited: notes.length > 0, notes, problems: [], variants: [] });
      } else {
        const problems = said.map((p) => ({ row: key, path: `[${i}]${memberPath(p.path).rel}`, where: whereOf(null, memberPath(p.path).rel), message: p.message }));
        rows.push({ key, origin: 'user', def: null, raw, edited: false, notes: [], problems, variants: [] });
      }
    });
    initialJson = JSON.stringify(found.entries);
    lastIds.clear();
    const keep = keepSelection !== null && rows.some((r) => r.key === keepSelection) ? keepSelection : null;
    store.update((s) => {
      const next = refresh({
        ...s,
        ready: true,
        busy: false,
        dialect,
        dialects: deps.dialects(),
        fileName: `${dialect}.json`,
        fileExists: found.exists,
        fileError: found.error,
        rows,
        selected: keep,
        favorites: deps.favorites.get(dialect),
        problems: [],
        draft: null,
      });
      // The first template the list shows (not a built-in one that yours replaces).
      return { ...next, selected: keep ?? visibleRows(next, '')[0]?.key ?? null };
    });
  }

  // --- the draft from a selection ------------------------------------------------------------

  function draftTemplate(d: DraftState): TemplateDef {
    const id = d.id !== '' ? d.id : slugId(d.label);
    return draftToTemplate(d.draft, new Set(d.chosen), { id, label: d.label.trim(), group: d.group.trim(), ...(machineType === undefined ? {} : { machineType }) });
  }

  // --- saving --------------------------------------------------------------------------------

  /** The loader's reading of the whole list: the file's `templates` member, or the problems that stop the Save. */
  function checkAll(): { templates: unknown[] } | { problems: ProblemLine[] } {
    const rows = userRows(snapshot().rows);
    const readable = rows.filter((r) => r.def !== null);
    const input = readable.map((r) => (r.edited ? clone(r.def) : clone(r.raw)));
    const found: TemplateProblem[] = [];
    const loaded = loadTemplates(input, (p) => found.push(p));
    const problems: ProblemLine[] = [];
    for (const p of found) {
      const { index, rel } = memberPath(p.path);
      const row = index === null ? undefined : readable[index];
      if (row === undefined) problems.push({ row: null, path: p.path, where: t('templateManager.where.list'), message: p.message });
      else problems.push(lineOf(row.key, row.def, p, rel));
    }
    // A user template the loader reads with a note is written from its reading, which is fine; one it drops is a problem.
    if (problems.length === 0 && loaded.length !== readable.length) {
      problems.push({ row: null, path: '', where: t('templateManager.where.list'), message: t('templateManager.problem.dropped') });
    }
    if (problems.length > 0) return { problems };
    let at = 0;
    const templates = rows.map((row) => {
      if (row.def === null) return row.raw;
      const read = loaded[at++];
      return row.edited ? withUnknownMembers(read, row.raw) : row.raw;
    });
    return { templates };
  }

  /** True when the file would be larger than the program reads (counting every line break as two bytes: a CRLF file). */
  const tooBig = (text: string): boolean => new TextEncoder().encode(text).length + (text.match(/\n/g)?.length ?? 0) > TEMPLATE_LIMITS.fileBytes;
  const tooBigMsg = (name: string): Msg => ({ key: 'templateManager.save.tooBig', params: { name, max: Math.round(TEMPLATE_LIMITS.fileBytes / 1024 / 1024) } });

  type WriteResult = { ok: true } | { ok: false; reason: Extract<SaveResult, { ok: false }>['reason']; msg: Msg };

  async function writeExisting(path: string, state: ManagerState, templates: unknown[]): Promise<WriteResult> {
    const name = state.fileName;
    const open = deps.docs.find(path);
    if (open !== undefined && open.dirty) {
      return { ok: false, reason: 'dirtyDocument', msg: { key: 'templateManager.save.saveFirst', params: { name } } };
    }
    const previous = deps.docs.activeId();
    let id = open?.id;
    if (id === undefined) {
      const opened = await deps.docs.open(path);
      if (opened === null) return { ok: false, reason: 'failed', msg: { key: 'templateManager.save.openFailed', params: { name } } };
      id = opened;
    }
    // Opening the file's tab activated it; the tab the user was in comes back.
    const restore = (): void => {
      if (previous !== null && previous !== id) deps.docs.activate(previous);
    };
    let current: unknown;
    try {
      current = JSON.parse(deps.docs.text(id));
    } catch (err) {
      restore();
      return { ok: false, reason: 'fileError', msg: { key: 'templateManager.file.notJson', params: { name, detail: errorText(err) } } };
    }
    if (!isRecord(current)) {
      restore();
      return { ok: false, reason: 'fileError', msg: { key: 'templateManager.file.notObject', params: { name } } };
    }
    const now = current.templates;
    if ((now !== undefined && !Array.isArray(now)) || JSON.stringify(Array.isArray(now) ? now : []) !== initialJson) {
      restore();
      return { ok: false, reason: 'changed', msg: { key: 'templateManager.save.changed', params: { name } } };
    }
    const text = fileTextWith(current, state.dialect, templates);
    if (tooBig(text)) {
      restore();
      return { ok: false, reason: 'failed', msg: tooBigMsg(name) };
    }
    // The read-only lock (AD-23): the text is put into the tab without typing, so Monaco's option does not stop it.
    const locked = deps.docs.refusal(id, t('templateManager.save.lockAction'));
    if (locked !== null) {
      restore();
      return { ok: false, reason: 'failed', msg: locked };
    }
    const before = deps.docs.text(id);
    deps.docs.replace(id, text);
    if (deps.docs.text(id) !== text) {
      // A backstop for a tab that refused the text without saying so.
      restore();
      return { ok: false, reason: 'failed', msg: { key: 'templateManager.save.locked', params: { name } } };
    }
    // The tab was clean and holds the file: a Save that does not happen leaves it as it was, so a retry works.
    const putBack = (): void => {
      deps.docs.replace(id, before);
      deps.docs.markClean(id);
    };
    let saved = false;
    try {
      saved = await deps.docs.save(id);
    } finally {
      if (!saved) putBack();
      restore();
    }
    if (!saved) return { ok: false, reason: 'failed', msg: { key: 'templateManager.save.notSaved', params: { name } } };
    return { ok: true };
  }

  // --- the model -----------------------------------------------------------------------------

  const model: TemplateManager = {
    state: { subscribe: store.subscribe },

    async load(dialect, o) {
      if (!(await model.leave())) return false;
      machineType = o?.machineType ?? machineType;
      store.update((s) => ({ ...s, busy: true }));
      try {
        await read(dialect);
      } finally {
        // `read` ends the busy state itself; a reading that failed must not leave the dialog stuck.
        store.update((s) => (s.busy ? { ...s, busy: false } : s));
      }
      return true;
    },

    leave() {
      // The question that is open is the one every caller gets: a held Esc or a double click asks once.
      if (asking !== null) return asking;
      const s = snapshot();
      const d = s.draft;
      const draftStarted = d !== null && (d.chosen.length > 0 || d.label.trim() !== '' || d.id !== '');
      if (!s.dirty && !draftStarted) return Promise.resolve(true);
      const question = (async (): Promise<boolean> => {
        try {
          return await deps.confirm({
            title: t('templateManager.leave.title'),
            message: s.dirty ? t('templateManager.leave.message', { name: s.fileName }) : t('templateManager.leave.draftMessage'),
            ok: t('templateManager.leave.ok'),
          });
        } finally {
          asking = null;
        }
      })();
      asking = question;
      return question;
    },

    select(key) {
      store.update((s) => ({ ...s, selected: key === null || s.rows.some((r) => r.key === key) ? key : s.selected, draft: null }));
    },

    add() {
      const id = uniqueId('new-template', takenIds());
      const def: TemplateDef = {
        id,
        label: t('templateManager.new.label'),
        group: t('templateManager.new.group'),
        body: t('templateManager.new.body'),
        ...(machineType === undefined ? {} : { machineType }),
      };
      const key = nextKey('u');
      commit((s) => ({
        ...s,
        rows: [...s.rows, { key, origin: 'user', def, edited: true, notes: [], problems: [], variants: [] }],
        selected: key,
        draft: null,
        message: null,
      }));
    },

    duplicate(key, mode) {
      const row = rowOf(key);
      if (row === undefined || row.def === null) return;
      if (mode === 'override') {
        if (row.origin !== 'builtin') return;
        const existing = snapshot().rows.find((r) => r.origin === 'override' && r.def?.id === row.def?.id);
        if (existing !== undefined) {
          store.update((s) => ({
            ...s,
            selected: existing.key,
            message: { msg: { key: 'templateManager.duplicate.alreadyOverridden', params: { label: row.def?.label ?? '' } }, error: true },
          }));
          return;
        }
      }
      const def = clone(row.def);
      delete def.review;
      if (mode === 'copy') {
        // A copy of a copy is `-copy-2`, not `-copy-copy`.
        def.id = uniqueId(`${def.id.replace(/-copy(?:-\d+)?$/, '')}-copy`, takenIds());
        const suffix = t('templateManager.duplicate.suffix');
        const stem = def.label.endsWith(` ${suffix}`) ? def.label.slice(0, -suffix.length - 1) : def.label;
        const label = `${stem} ${suffix}`;
        def.label = label.length <= TEMPLATE_LIMITS.label ? label : def.label;
      }
      const copy = nextKey('u');
      commit((s) => {
        const index = s.rows.findIndex((r) => r.key === key);
        const after = row.origin === 'builtin' ? s.rows.length : index + 1;
        const rows = [...s.rows];
        rows.splice(after, 0, { key: copy, origin: 'user', def, edited: true, notes: [], problems: [], variants: [] });
        return { ...s, rows, selected: copy, draft: null, message: null };
      });
    },

    async remove(key) {
      const row = rowOf(key);
      if (row === undefined || row.origin === 'builtin') return false;
      const label = row.def?.label ?? t('templateManager.where.unreadable');
      const ok = await deps.confirm({
        title: t('templateManager.delete.title'),
        message: t(row.origin === 'override' ? 'templateManager.delete.overrideMessage' : 'templateManager.delete.message', { label }),
        ok: t('templateManager.delete.ok'),
      });
      if (!ok) return false;
      commit((s) => {
        const index = s.rows.findIndex((r) => r.key === key);
        const rows = s.rows.filter((r) => r.key !== key);
        const shown = visibleRows({ rows }, '');
        const selected = s.selected === key ? (shown[Math.min(index, shown.length - 1)]?.key ?? null) : s.selected;
        return { ...s, rows, selected, message: null };
      });
      return true;
    },

    move(key, delta) {
      commit((s) => {
        const users = userRows(s.rows).map((r) => r.key);
        const at = users.indexOf(key);
        const to = at + delta;
        if (at < 0 || to < 0 || to >= users.length) return s;
        const reordered = [...users];
        [reordered[at], reordered[to]] = [reordered[to], reordered[at]];
        const byKey = new Map(s.rows.map((r) => [r.key, r]));
        const rows = [...s.rows.filter((r) => r.origin === 'builtin'), ...reordered.map((k) => byKey.get(k) as ManagerRow)];
        return { ...s, rows, message: null };
      });
    },

    setFavorite(key, on) {
      const row = rowOf(key);
      if (row === undefined || row.def === null) return;
      const s = snapshot();
      if (on && !s.favorites.includes(row.def.id) && s.favorites.length >= MAX_FAVORITES) {
        notify({ key: 'templateManager.favorite.tooMany', params: { max: MAX_FAVORITES } }, true);
        return;
      }
      deps.favorites.set(s.dialect, row.def.id, on);
      store.update((st) => ({ ...st, favorites: deps.favorites.get(st.dialect) }));
    },

    setField(key, name, value) {
      edit(key, (def) => {
        const target = def as unknown as Record<string, unknown>;
        if (name === 'toolbar' || name === 'snippet') {
          if (value === true) target[name] = true;
          else delete target[name];
        } else if (name === 'machineType') {
          if (value === 'mill' || value === 'lathe') def.machineType = value;
          else delete def.machineType;
        } else if (name === 'description') {
          if (typeof value === 'string' && value !== '') def.description = value;
          else delete def.description;
        } else {
          target[name] = typeof value === 'string' ? value : '';
        }
      });
    },

    setBody(key, body) {
      edit(key, (def) => {
        def.body = body;
      });
    },

    insertPlaceholder(key, name, start, end) {
      const row = rowOf(key);
      if (row === undefined || row.origin === 'builtin' || row.def === null) return null;
      const next = insertAt(row.def.body, start, end, placeholderText(name));
      edit(key, (def) => {
        def.body = next.body;
      });
      return next.caret;
    },

    addParam(key) {
      edit(key, (def) => {
        lastIdsOf(key, def);
        const params = def.params ?? [];
        const ids = new Set(params.map((p) => p.id));
        let n = params.length + 1;
        while (ids.has(`p${n}`)) n++;
        params.push({ id: `p${n}`, label: t('templateManager.param.newLabel', { n }), type: 'number', required: true });
        def.params = params;
        lastIds.get(key)?.push(`p${n}`);
      });
    },

    removeParam(key, index) {
      edit(key, (def) => {
        if (def.params === undefined) return;
        lastIdsOf(key, def).splice(index, 1);
        def.params.splice(index, 1);
        if (def.params.length === 0) delete def.params;
      });
    },

    moveParam(key, index, delta) {
      edit(key, (def) => {
        const params = def.params;
        const to = index + delta;
        if (params === undefined || index < 0 || to < 0 || to >= params.length) return;
        const ids = lastIdsOf(key, def);
        [params[index], params[to]] = [params[to], params[index]];
        [ids[index], ids[to]] = [ids[to], ids[index]];
      });
    },

    setParam(key, index, name, value) {
      edit(key, (def) => {
        const p = def.params?.[index];
        if (p === undefined) return;
        const target = p as unknown as Record<string, unknown>;
        if (name === 'id' && typeof value === 'string' && value !== p.id) {
          const ids = lastIdsOf(key, def);
          p.id = value;
          if (TEMPLATE_PARAM_ID.test(value)) {
            // Only from a valid id to a valid one; an id that is not one has nothing to rename.
            if (TEMPLATE_PARAM_ID.test(ids[index]) && ids[index] !== value) renamedParam(def, ids[index], value);
            ids[index] = value;
          }
          return;
        }
        if (!PARAM_MEMBERS[p.type].includes(name)) return;
        if (value === undefined || value === '' || value === false) delete target[name];
        else target[name] = value;
      });
    },

    setParamType(key, index, type) {
      edit(key, (def) => {
        const p = def.params?.[index];
        if (p === undefined || p.type === type) return;
        const keep = PARAM_MEMBERS[type];
        const target = p as unknown as Record<string, unknown>;
        for (const member of Object.keys(target)) if (!keep.includes(member)) delete target[member];
        // The old default would not fit the new type.
        delete target.default;
        p.type = type;
        if (type === 'choice' && p.choices === undefined) p.choices = [{ label: t('templateManager.param.newChoice', { n: 1 }), value: '1' }];
        if (type === 'formula' && p.formula === undefined) p.formula = '';
      });
    },

    addChoice(key, index) {
      edit(key, (def) => {
        const p = def.params?.[index];
        if (p === undefined || p.type !== 'choice') return;
        const choices = p.choices ?? [];
        const values = new Set(choices.map((c) => c.value));
        let n = choices.length + 1;
        while (values.has(String(n))) n++;
        choices.push({ label: t('templateManager.param.newChoice', { n }), value: String(n) });
        p.choices = choices;
      });
    },

    removeChoice(key, index, choice) {
      edit(key, (def) => {
        const p = def.params?.[index];
        if (p?.choices === undefined) return;
        p.choices.splice(choice, 1);
        if (p.default !== undefined && !p.choices.some((c) => c.value === String(p.default))) delete p.default;
      });
    },

    setChoice(key, index, choice, name, value) {
      edit(key, (def) => {
        const c = def.params?.[index]?.choices?.[choice];
        if (c !== undefined) c[name] = value;
      });
    },

    preview(key) {
      const row = rowOf(key);
      if (row === undefined || row.def === null) return { kind: 'none' };
      const env = deps.env();
      if (env === null) return { kind: 'none' };
      if (row.problems.length > 0) return { kind: 'errors', key: 'templateManager.preview.problems', lines: [t('templateManager.preview.problems')] };
      const { values, missing } = previewValues(row.def);
      if (missing.length > 0) {
        return {
          kind: 'errors',
          key: 'templateManager.preview.needsDefault',
          lines: missing.map((p) => t('templateManager.preview.needsDefault', { label: p.label })),
        };
      }
      try {
        const result = renderTemplate(row.def, values, env);
        if (result.ok) return { kind: 'text', text: result.text };
        const labels = new Map((row.def.params ?? []).map((p) => [p.id, p.label]));
        return {
          kind: 'errors',
          key: Object.values(result.errors)[0]?.key ?? 'templateManager.preview.failed',
          lines: Object.entries(result.errors).map(([id, msg]) => `${labels.get(id) ?? id}: ${t(msg.key, msg.params)}`),
        };
      } catch {
        return { kind: 'errors', key: 'templateManager.preview.failed', lines: [t('templateManager.preview.failed')] };
      }
    },

    formulaProblem(key, index) {
      const row = rowOf(key);
      const p = row?.def?.params?.[index];
      if (row?.def == null || p === undefined || p.type !== 'formula') return null;
      return checkFormula(p.formula ?? '', new Map((row.def.params ?? []).map((q) => [q.id, q.type])));
    },

    startDraft(draft, o) {
      store.update((s) => ({
        ...s,
        draft: {
          draft,
          chosen: [],
          label: o.label ?? '',
          id: '',
          idTouched: false,
          group: o.group ?? t('templateManager.new.group'),
          error: null,
        },
        message: null,
      }));
    },

    toggleCandidate(key) {
      store.update((s) => {
        const d = s.draft;
        if (d === null) return s;
        const candidate = d.draft.candidates.find((c) => c.key === key);
        if (candidate === undefined) return s;
        // The numbers that share a parameter (the same value written again) are ticked together.
        const group = d.draft.candidates.filter((c: SelectionCandidate) => c.param.id === candidate.param.id).map((c) => c.key);
        const on = !d.chosen.includes(key);
        const chosen = on ? [...new Set([...d.chosen, ...group])] : d.chosen.filter((k) => !group.includes(k));
        return { ...s, draft: { ...d, chosen, error: null } };
      });
    },

    setAllCandidates(on) {
      store.update((s) => (s.draft === null ? s : { ...s, draft: { ...s.draft, chosen: on ? s.draft.draft.candidates.map((c) => c.key) : [], error: null } }));
    },

    setDraft(name, value) {
      store.update((s) => {
        const d = s.draft;
        if (d === null) return s;
        if (name === 'id') return { ...s, draft: { ...d, id: value, idTouched: true, error: null } };
        if (name === 'label') return { ...s, draft: { ...d, label: value, id: d.idTouched ? d.id : slugId(value), error: null } };
        return { ...s, draft: { ...d, group: value, error: null } };
      });
    },

    draftBody() {
      const d = snapshot().draft;
      return d === null ? '' : draftTemplate(d).body;
    },

    applyDraft() {
      const s = snapshot();
      const d = s.draft;
      if (d === null) return false;
      const fail = (msg: Msg): false => {
        store.update((st) => (st.draft === null ? st : { ...st, draft: { ...st.draft, error: msg } }));
        return false;
      };
      if (d.label.trim() === '') return fail({ key: 'templateManager.draft.needsName' });
      if (d.group.trim() === '') return fail({ key: 'templateManager.draft.needsGroup' });
      const id = d.id !== '' ? d.id : slugId(d.label);
      if (!TEMPLATE_ID.test(id)) return fail({ key: 'templateManager.draft.badId' });
      if (takenIds().has(id)) return fail({ key: 'templateManager.draft.idTaken', params: { id } });
      const def = draftTemplate({ ...d, id });
      const found: TemplateProblem[] = [];
      const read1 = loadTemplates([clone(def)], (p) => found.push(p));
      if (read1.length !== 1 || found.length > 0) {
        return fail({ key: 'templateManager.draft.refused', params: { detail: found[0]?.message ?? '' } });
      }
      const key = nextKey('u');
      commit((st) => ({
        ...st,
        rows: [...st.rows, { key, origin: 'user', def: read1[0], edited: true, notes: [], problems: [], variants: [] }],
        selected: key,
        draft: null,
        message: null,
      }));
      return true;
    },

    cancelDraft() {
      store.update((s) => ({ ...s, draft: null }));
    },

    async save() {
      const state = snapshot();
      if (state.busy) return { ok: false, reason: 'failed' };
      if (state.fileError !== null) {
        notify(state.fileError, true);
        return { ok: false, reason: 'fileError' };
      }
      if (!state.dirty) {
        notify({ key: 'templateManager.save.nothing' });
        return { ok: false, reason: 'nothing' };
      }
      const checked = checkAll();
      if ('problems' in checked) {
        store.update((s) => ({
          ...s,
          problems: checked.problems,
          message: { msg: { key: 'templateManager.save.invalid', params: { count: checked.problems.length } }, error: true },
        }));
        return { ok: false, reason: 'invalid' };
      }
      store.update((s) => ({ ...s, busy: true, problems: [], message: null }));
      let result: WriteResult;
      try {
        if (state.fileExists) {
          result = await writeExisting(await deps.userFiles.path(state.fileName), state, checked.templates);
        } else {
          const text = fileTextWith(null, state.dialect, checked.templates);
          if (tooBig(text)) result = { ok: false, reason: 'failed', msg: tooBigMsg(state.fileName) };
          else {
            await deps.userFiles.create(state.fileName, text);
            result = { ok: true };
          }
        }
      } catch (err) {
        result = { ok: false, reason: 'failed', msg: { key: 'templateManager.save.failed', params: { name: state.fileName, detail: errorText(err) } } };
      }
      if (!result.ok) {
        store.update((s) => ({ ...s, busy: false, message: { msg: result.msg, error: true } }));
        return { ok: false, reason: result.reason };
      }
      try {
        await deps.reloadUserFiles();
      } catch {
        // The file is written; the registries catch up with the next load.
      }
      const before = snapshot();
      const selectedId = before.rows.find((r) => r.key === before.selected)?.def?.id ?? null;
      try {
        await read(state.dialect);
      } catch (err) {
        // The file is written; the list could not be read again. The dialog must not stay busy.
        store.update((s) => ({
          ...s,
          busy: false,
          message: { msg: { key: 'templateManager.save.rereadFailed', params: { name: s.fileName, detail: errorText(err) } }, error: true },
        }));
        return { ok: true };
      }
      // The same template stays selected; its row has a new key after the reading.
      const after = snapshot();
      const again =
        selectedId === null ? undefined : (after.rows.find((r) => r.origin !== 'builtin' && r.def?.id === selectedId) ?? after.rows.find((r) => r.def?.id === selectedId));
      store.update((s) => ({
        ...s,
        selected: again?.key ?? s.selected,
        message: { msg: { key: 'templateManager.save.done', params: { name: s.fileName } }, error: false },
      }));
      return { ok: true };
    },

    async revert() {
      const s = snapshot();
      if (!(await model.leave())) return false;
      store.update((st) => ({ ...st, busy: true }));
      try {
        await read(s.dialect, s.selected);
      } finally {
        store.update((st) => (st.busy ? { ...st, busy: false } : st));
      }
      return true;
    },

    async openFile() {
      const s = snapshot();
      if (!s.fileExists) {
        notify({ key: 'templateManager.file.notThere', params: { name: s.fileName } }, true);
        return false;
      }
      try {
        const id = await deps.docs.open(await deps.userFiles.path(s.fileName));
        if (id === null) throw new Error('not opened');
        deps.docs.activate(id);
        return true;
      } catch (err) {
        notify({ key: 'templateManager.save.openFailed', params: { name: s.fileName, detail: errorText(err) } }, true);
        return false;
      }
    },
  };
  return model;
}
