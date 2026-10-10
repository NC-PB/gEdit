// The templates of every open document (Phase 3 plan §6.11, AD-28; `TemplateService` in
// `app/types.ts`). Built by P3.5.
//
// `createTemplateService(deps)` plus the singleton wired to the real modules (AD-2), so a unit
// test drives it with a fake editor, a scripted form and a fake clock.
//
// What it does, in the order the plan binds it:
//
//   1. **`list(id)`** reads the document's **effective** database (`machines.effective(id)
//      .codes.templates`) through `templatesForMachine` with the profile's machine type: never
//      the profile id, so a system-B lathe document sees the `fanuc-lathe-b` overrides and the
//      same document under system A the `fanuc-lathe` ones (AD-31).
//   2. **`render(id, templateId, values, line)`** builds the `TemplateEnv` from the document: the
//      compiled profile; the number of the nearest numbered block at or above `line` (at most
//      `SCAN_UP` lines up); whether the program is numbered (a `consecutive` profile always,
//      else a block number found above or in the `SCAN_DOWN` lines below); the date and time
//      of the user's clock (`sys.date` `YYYY-MM-DD`, `sys.time` `HH:MM`); the file name and
//      stem. It then calls `renderTemplate`.
//   3. **`insert(templateId, values?)`** on the active document. A locked document is refused
//      with the read-only message before anything is asked. Without `values` the form opens
//      through `modals.form` (`templateFields`; the values the user gave last time for the
//      `remember` parameters, under `templateMemoKey(dialect, id)`; the `live` hook: the
//      formulas' values, the engine's errors and a preview of the text; the "review pending"
//      note). A **snippet** template goes to the snippet controller instead. The text goes
//      **after the cursor's block** (a Klartext block is all its `~` lines), or in place of the
//      cursor's line when that line is blank (so "Program start" in a new file is its first
//      line, not its second), as **one** `applyLines` call, which is one undo step; a
//      `consecutive` profile (Klartext) renumbers the blocks after it in the same edit.
//   4. **`changed`** bumps on `machines.revision`, `profiles.revision` (a code reload bumps it),
//      a change of any document's profile or machine, and a favourite.
//   5. **`favorites` / `setFavorite`** keep the starred ids per database in `state.json`
//      (`ui.lastParams['templates:favorites']`), read as untrusted.
//
// P3b fix NC (plan §7 #253 ff.), on top of the five items:
//
//   6. **Block numbers a template names** (review NC-01, SK-02; `core/templates/blockNumbers.ts`):
//      when the form opens the whole program is read once for its block numbers (Okuma: its
//      sequence names) and the numbers its references name. A contour number (`N{{ns}}`, Okuma
//      `{{name}}`) starts at its default when nothing uses it, else at a free one; the form
//      refuses one the program uses, one a reference names, one the template's own `{{N}}`
//      writes and one another field has; the insert reads the program again and refuses the
//      same. A number the template's `{{N}}` writes that a `P`/`Q`/`GOTO` of the program names
//      is said in the form's note (numbering continues by design; the user cannot change it).
//   7. **The machine** (review NC-09, NC-13): on a machine that scales every number (Okuma
//      1 µm / 10 µm) the note says that the sample values are for the 1 mm setting; on a
//      machine that reads a point-less length in increments (Fanuc IS-B, IS-C) a length or an
//      angle typed with more decimals than the increment is refused (the control would round
//      it). Without a machine neither applies: nothing is guessed.
//
// Known limit: a snippet template whose body uses `{{N}}` in a `consecutive` profile inserts
// its numbers, but the following blocks are not renumbered (the snippet controller makes its own
// edit); no built-in template is a snippet.

import { get, readable, writable, type Readable } from 'svelte/store';
import { blockRange, type InspectInput } from '$lib/core/codes/inspect';
import { initialValues } from '$lib/core/forms/values';
import { numberClassOf, valueOf } from '$lib/core/machines/numbers';
import { parseNumber } from '$lib/core/nc/numbers';
import { blockNumberOf } from '$lib/core/nc/tokenizer';
import { isNcDocumentPath } from '$lib/core/profiles/ncDocument';
import {
  evaluateFormulas,
  renderTemplate,
  templateFields,
  templateMemoKey,
  templatesForMachine,
  validateTemplateValues,
  TEMPLATE_ID,
  TEMPLATE_LIMITS,
  type RenderResult,
  type TemplateDef,
  type TemplateEnv,
} from '$lib/core/templates';
import {
  blockNumberParams,
  blockValueErrors,
  documentNumbers,
  freeBlockValues,
  namedOwnNumbers,
  needsDocumentNumbers,
  numberPlaceholders,
  ownNumbers,
  type BlockParam,
  type DocumentNumbers,
} from '$lib/core/templates/blockNumbers';
import { applyLines as applyLinesToModel } from '$lib/monaco/applyLines';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { machines as appMachines } from '$lib/stores/machines';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { uiState as appUiState } from '$lib/stores/uiState';
import { modals as appModals } from '$lib/app/modals';
import { lockRefusal } from '$lib/app/readOnlyLock';
import { status as appStatus } from '$lib/app/status';
import { t as translate } from '$lib/i18n';
import type { EffectiveProfile } from '$lib/core/machines/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type {
  Disposable,
  DocId,
  DocumentStore,
  EditorService,
  FormLiveResult,
  Modals,
  Msg,
  StatusService,
  TemplateService,
  Translate,
  UiStateStore,
} from '$lib/app/types';

/** The `ui.lastParams` key of the starred templates (AD-40). */
export const FAVORITES_KEY = 'templates:favorites';

/** How many lines above the insertion point are searched for the block number to continue from. */
export const SCAN_UP = 2000;
/** How many lines below it are searched to find out that a program is numbered. */
export const SCAN_DOWN = 200;

export interface TemplateServiceDeps {
  docs: Pick<DocumentStore, 'getActiveId' | 'get' | 'list'>;
  editor: Pick<EditorService, 'cursor' | 'getLineCount' | 'getLines' | 'insertSnippet' | 'reveal' | 'focus'> & Partial<Pick<EditorService, 'versionId'>>;
  /** `machines.effective`: the document's profile, compiled profile, code database and machine (AD-31). */
  effective(id: DocId): EffectiveProfile;
  /** Stores that bump when a document's templates may have changed (`machines.revision`, `profiles.revision`). */
  revisions: Readable<number>[];
  modals: Pick<Modals, 'form'>;
  uiState: Pick<UiStateStore, 'getLastParams' | 'setLastParams'>;
  /** `monaco/applyLines.ts`: replaces lines as one undo step. */
  applyLines(id: DocId, startLine: number, endLine: number, newLines: string[]): { changedLines: number; locked?: true };
  status: Pick<StatusService, 'show'>;
  /** The clock, for `sys.date` and `sys.time`. */
  now(): Date;
  t: Translate;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** One template group of the Insert tab and of the quick pick. */
export interface TemplateGroupView {
  /** The group's name (data), or `''` for the favourites. */
  key: string;
  favorites: boolean;
  /** The templates shown as buttons: the `toolbar` ones (all of them in the favourites). */
  buttons: TemplateDef[];
  /** The rest, in the group's "More templates…" list. */
  more: TemplateDef[];
}

/**
 * The Insert tab's groups for `list`: the starred templates first in one favourites group (all
 * as buttons, in the order they were starred), then one group per `group` text in order of first
 * appearance; a starred template appears only in the favourites. A starred id that is no
 * template of the list is skipped.
 */
export function templateGroups(list: readonly TemplateDef[], favorites: readonly string[]): TemplateGroupView[] {
  const byId = new Map(list.map((tpl) => [tpl.id, tpl]));
  const starred: TemplateDef[] = [];
  const seen = new Set<string>();
  for (const id of favorites) {
    const tpl = byId.get(id);
    if (tpl && !seen.has(id)) {
      seen.add(id);
      starred.push(tpl);
    }
  }
  const groups: TemplateGroupView[] = [];
  if (starred.length > 0) groups.push({ key: '', favorites: true, buttons: starred, more: [] });
  const index = new Map<string, TemplateGroupView>();
  for (const tpl of list) {
    if (seen.has(tpl.id)) continue;
    let group = index.get(tpl.group);
    if (!group) {
      group = { key: tpl.group, favorites: false, buttons: [], more: [] };
      index.set(tpl.group, group);
      groups.push(group);
    }
    (tpl.toolbar === true ? group.buttons : group.more).push(tpl);
  }
  return groups;
}

/** The final path segment, either separator. */
function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** The name without its last extension (`.nc`); a name that is only an extension (`.hidden`) keeps it. */
function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` and `HH:MM` in the user's own time zone. */
export function sysClock(now: Date): { date: string; time: string } {
  return {
    date: `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`,
    time: `${two(now.getHours())}:${two(now.getMinutes())}`,
  };
}

/** The typed text of a value as the engine reads it (blank = empty), for the formulas' inputs. */
function typedText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() === '' ? null : raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

/** The value of each visible formula field, as plain decimal text (`''` while it has none). */
export function formulaValues(tpl: TemplateDef, values: Record<string, unknown>, errors: Record<string, Msg>): Record<string, string> | undefined {
  const params = tpl.params ?? [];
  if (!params.some((p) => p.type === 'formula')) return undefined;
  const inputs: Record<string, unknown> = {};
  for (const p of params) {
    if (p.type === 'formula' || errors[p.id] !== undefined) continue;
    const text = typedText(values[p.id]);
    if (text !== null) inputs[p.id] = p.type === 'number' || p.type === 'integer' ? text.trim() : text;
  }
  const result = evaluateFormulas(tpl, inputs);
  const out: Record<string, string> = {};
  for (const p of params) {
    if (p.type !== 'formula' || p.hidden === true) continue;
    out[p.id] = result.errors[p.id] === undefined ? (result.values[p.id] ?? '') : '';
  }
  return out;
}

/**
 * The lines behind an insertion into a `consecutive` program (Klartext): every block number of
 * `lines` from the first numbered one on becomes `next`, `next + 1`, … in order. A tail of a
 * `~` block has no number and is left alone. `lines` is cut after the last line that changed.
 */
export function renumberFollowing(lines: readonly string[], next: number, numberOf: (line: string) => { text: string; start: number; end: number } | null): string[] {
  const out: string[] = [];
  let counter = next;
  let lastChanged = -1;
  lines.forEach((line, i) => {
    const found = numberOf(line);
    if (found === null) {
      out.push(line);
      return;
    }
    const prefix = line.slice(found.start, found.end - found.text.length);
    const digits = String(counter);
    const written = found.text.length > digits.length && found.text.startsWith('0') ? digits.padStart(found.text.length, '0') : digits;
    counter += 1;
    const changed = line.slice(0, found.start) + prefix + written + line.slice(found.end);
    if (changed !== line) lastChanged = i;
    out.push(changed);
  });
  return out.slice(0, lastChanged + 1);
}

/** What the environment and the insertion plan read from a document. */
export interface DocumentLines {
  editor: Pick<EditorService, 'getLineCount' | 'getLines'>;
  docs: Pick<DocumentStore, 'get'>;
  now(): Date;
}

/**
 * The `TemplateEnv` of an insertion into document `id` with the cursor on `line` (module header,
 * item 2). Also the environment of a new cycle block (`contrib/cycleForms.ts`).
 */
export function templateEnv(io: DocumentLines, id: DocId, cp: CompiledProfile, line: number): TemplateEnv {
  const count = Math.max(1, io.editor.getLineCount(id));
  const at = Math.min(Math.max(1, Math.trunc(line) || 1), count);
  const numberValue = (text: string): number | null => {
    const found = blockNumberOf(text, cp);
    return found !== null && Number.isFinite(found.value) ? found.value : null;
  };

  let prev: number | null = null;
  const from = Math.max(1, at - SCAN_UP + 1);
  const above = io.editor.getLines(id, from, at);
  for (let i = above.length - 1; i >= 0 && prev === null; i--) prev = numberValue(above[i]);

  let numbered = cp.profile.numbering.mode === 'consecutive' || prev !== null;
  if (!numbered && at < count) {
    for (const text of io.editor.getLines(id, at + 1, Math.min(count, at + SCAN_DOWN))) {
      if (numberValue(text) !== null) {
        numbered = true;
        break;
      }
    }
  }

  const path = io.docs.get(id)?.path;
  const file = typeof path === 'string' ? baseName(path) : '';
  return { cp, prevBlockNumber: prev, numbered, sys: { ...sysClock(io.now()), file, stem: stemOf(file) } };
}

/** One edit of the program: lines `start`…`end` (1-based, inclusive) become `lines`. */
export interface InsertionPlan {
  start: number;
  end: number;
  lines: string[];
  /** The line of the program the last inserted line will be on. */
  lastInserted: number;
}

/**
 * Where `text` goes and what else changes with it (module header, item 3): after line `last`
 * (the last line of the cursor's block), or in place of it when it is blank; in a `consecutive`
 * profile the block numbers behind it move up by the `blocks` the text used. One edit.
 */
export function planInsertion(io: Pick<DocumentLines, 'editor'>, id: DocId, cp: CompiledProfile, o: { last: number; text: string[]; blocks: number; prevBlockNumber: number | null }): InsertionPlan {
  const count = Math.max(1, io.editor.getLineCount(id));
  const lastText = io.editor.getLines(id, o.last, o.last)[0] ?? '';
  const blank = lastText.trim() === '';
  const lines = blank ? [...o.text] : [lastText, ...o.text];
  let end = o.last;
  if (cp.profile.numbering.mode === 'consecutive' && o.blocks > 0 && o.last < count) {
    // Klartext wants its numbers consecutive: the blocks behind the insertion move up (same edit).
    const next = (o.prevBlockNumber ?? -1) + o.blocks + 1;
    const shifted = renumberFollowing(io.editor.getLines(id, o.last + 1, count), next, (line) => blockNumberOf(line, cp));
    // One at a time: a spread of 130,000 lines and more overflows the call stack (review CODE-06).
    for (const line of shifted) lines.push(line);
    end = o.last + shifted.length;
  }
  return { start: o.last, end, lines, lastInserted: (blank ? o.last : o.last + 1) + o.text.length - 1 };
}

/** The address a number parameter is written with: its prefix, else the letters in front of its first `{{id}}` in the body. */
function addressOf(tpl: TemplateDef, id: string, prefix: string | undefined): string | null {
  const own = /^([A-Za-z]+)/.exec(prefix ?? '');
  if (own) return own[1].toUpperCase();
  const at = tpl.body.indexOf(`{{${id}}}`);
  if (at < 0) return null;
  const before = /([A-Za-z]+)=?$/.exec(tpl.body.slice(Math.max(0, at - 8), at));
  return before ? before[1].toUpperCase() : null;
}

/**
 * Item 7: with a machine that reads a point-less length in increments, the most decimals a
 * length or an angle can carry (`3` on IS-B), by parameter id; empty without such a machine.
 */
export function machineDecimals(tpl: TemplateDef, view: Pick<EffectiveProfile, 'profile' | 'machine'>): Record<string, number> {
  const out: Record<string, number> = {};
  const machine = view.machine;
  if (machine?.source?.numberInput !== 'machine' || !machine.params?.numberInput) return out;
  const units = machine.params.units === 'inch' ? 'inch' : 'mm';
  const one = parseNumber('1');
  const pointed = parseNumber('1.');
  if (one === null || pointed === null) return out;
  for (const p of tpl.params ?? []) {
    if (p.type !== 'number') continue;
    const address = addressOf(tpl, p.id, p.prefix);
    if (address === null) continue;
    const cls = numberClassOf(address, { profile: view.profile, feedUnit: 'unknown', blockCodes: [], pitchFeed: false });
    if (cls !== 'length' && cls !== 'angle') continue;
    // Only where a point keeps the value as written and a point-less `1` is one increment.
    if (valueOf(pointed, cls, machine.params, units) !== '1') continue;
    const increment = valueOf(one, cls, machine.params, units);
    if (increment === null || increment === '1') continue;
    out[p.id] = (increment.split('.')[1] ?? '').replace(/0+$/, '').length;
  }
  return out;
}

/** Item 7: the values typed with more decimals than the machine has (`templates.value.tooManyDecimals`). */
export function machineDecimalErrors(tpl: TemplateDef, values: Record<string, unknown>, limits: Record<string, number>): Record<string, Msg> {
  const errors: Record<string, Msg> = {};
  for (const [id, decimals] of Object.entries(limits)) {
    const raw = values[id];
    const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
    const lit = text === '' ? null : parseNumber(text);
    if (lit === null) continue;
    if ((lit.fracPart ?? '').replace(/0+$/, '').length > decimals) errors[id] = { key: 'templates.value.tooManyDecimals', params: { decimals } };
  }
  return errors;
}

/** Item 7: the unit of a machine that scales every number (`1 µm`), or null. */
export function scaledUnit(view: Pick<EffectiveProfile, 'machine'>): string | null {
  const input = view.machine?.params?.numberInput;
  if (!input || input.mode !== 'scale') return null;
  const inch = view.machine.params.units === 'inch';
  const raw = inch ? (input.incrementInch ?? input.incrementMm) : input.incrementMm;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value === 1) return null;
  if (inch) return `${raw} in`;
  return value < 1 ? `${Math.round(value * 1e6) / 1e3} µm` : `${raw} mm`;
}

/** What the form and the insert know about the block numbers of one template in one program (item 6). */
interface BlockContext {
  params: BlockParam[];
  doc: DocumentNumbers | null;
  /** The numbers the template's `{{N}}` may write (every `{{N}}` of the body counted). */
  own: number[];
}

// ---------------------------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------------------------

export function createTemplateService(deps: TemplateServiceDeps): TemplateService {
  const { t } = deps;
  const say = (text: string, error = false): void => deps.status.show(text, error ? { error: true } : undefined);
  const sayMsg = (msg: Msg, error = false): void => say(t(msg.key, msg.params), error);

  // -- what a document offers ---------------------------------------------------------------

  function viewOf(id: DocId): EffectiveProfile | null {
    // `machines.effective` always answers; an id that is no open document has no templates.
    if (deps.docs.get(id) === undefined) return null;
    try {
      return deps.effective(id);
    } catch {
      // A reload can take a document's profile away for a moment (AD-29).
      return null;
    }
  }

  function list(id: DocId): TemplateDef[] {
    const view = viewOf(id);
    return view === null ? [] : templatesForMachine(view.codes.templates, view.profile.machineType);
  }

  function dialectOf(id: DocId): string | null {
    const view = viewOf(id);
    return view === null ? null : view.codes.dialect;
  }

  // -- the environment of an insertion ------------------------------------------------------

  const envFor = (id: DocId, view: EffectiveProfile, line: number): TemplateEnv => templateEnv(deps, id, view.cp, line);

  /**
   * The numbers the program uses (item 6). The scan of a 300,000-line program is the one thing
   * the form and the Insert would each pay for, so the answer is kept while the document stays
   * at the version it was read at (the same text, whatever happened in between) and is dropped
   * when the insertion ends.
   */
  let scanned: { id: DocId; version: number; cp: CompiledProfile; lineCount: number; doc: DocumentNumbers } | null = null;

  function numbersOf(id: DocId, view: EffectiveProfile, withBlocks: boolean): DocumentNumbers {
    const lineCount = Math.max(1, deps.editor.getLineCount(id));
    // A real version is above 0: the editor answers 0 for a document without a model, whose text can change at that same 0, so 0 (or anything that is no version) keeps nothing.
    const asked = deps.editor.versionId?.(id);
    const version = typeof asked === 'number' && Number.isFinite(asked) && asked > 0 ? asked : undefined;
    const kept = scanned;
    if (kept !== null && version !== undefined && kept.id === id && kept.version === version && kept.cp === view.cp && kept.lineCount === lineCount && (kept.doc.withBlocks || !withBlocks)) return kept.doc;
    const doc = documentNumbers(deps.editor.getLines(id, 1, lineCount), view.cp, withBlocks);
    scanned = version === undefined ? null : { id, version, cp: view.cp, lineCount, doc };
    return doc;
  }

  /** Item 6: the program's numbers, and the numbers `tpl` names or writes at `env`. */
  function blockContext(id: DocId, view: EffectiveProfile, tpl: TemplateDef, env: TemplateEnv): BlockContext {
    const params = blockNumberParams(tpl, view.cp);
    if (!needsDocumentNumbers(tpl, view.cp)) return { params, doc: null, own: [] };
    const own = ownNumbers(env, numberPlaceholders(tpl));
    // No block-number field and no number of its own (an unnumbered program): there is nothing to compare with the program's numbers.
    if (params.length === 0 && own.length === 0) return { params, doc: null, own };
    // The block numbers themselves matter to a template with a block-number field; without one only the numbers a P or a GOTO names do (SK-02).
    return { params, doc: numbersOf(id, view, params.length > 0), own };
  }

  /** Items 6 and 7: what the engine does not check, by parameter id (only for a value the engine took). */
  function contextErrors(tpl: TemplateDef, values: Record<string, unknown>, ctx: BlockContext, decimals: Record<string, number>, view: EffectiveProfile, engine: Record<string, Msg>): Record<string, Msg> {
    const out: Record<string, Msg> = {};
    const more = {
      ...machineDecimalErrors(tpl, values, decimals),
      ...(ctx.doc === null ? {} : blockValueErrors(ctx.params, values, ctx.doc, ctx.own, view.cp)),
    };
    for (const [id, msg] of Object.entries(more)) if (engine[id] === undefined) out[id] = msg;
    return out;
  }

  function render(id: DocId, templateId: string, values: Record<string, unknown>, line: number): RenderResult {
    const view = viewOf(id);
    const tpl = list(id).find((x) => x.id === templateId);
    if (view === null || tpl === undefined) return { ok: false, errors: { [templateId]: { key: 'templates.notOffered', params: { id: templateId } } } };
    return renderTemplate(tpl, values, envFor(id, view, line));
  }

  // -- the form -----------------------------------------------------------------------------

  /** The `live` hook of the form of `tpl` in document `id`, the cursor on `line`. */
  function liveFor(id: DocId, view: EffectiveProfile, tpl: TemplateDef, fieldIds: Set<string>, line: number, ctx: BlockContext, decimals: Record<string, number>) {
    return (current: Record<string, unknown>): FormLiveResult => {
      const engine = validateTemplateValues(tpl, current, view.cp);
      const errors = { ...engine, ...contextErrors(tpl, current, ctx, decimals, view, engine) };
      const answer: FormLiveResult = {};
      const computed = formulaValues(tpl, current, errors);
      if (computed !== undefined) answer.values = computed;
      const fieldErrors: Record<string, Msg> = {};
      let other: Msg | undefined;
      for (const [param, msg] of Object.entries(errors)) {
        if (fieldIds.has(param)) fieldErrors[param] = msg;
        else other ??= msg;
      }
      if (Object.keys(fieldErrors).length > 0) answer.fieldErrors = fieldErrors;
      if (other !== undefined) answer.error = other;
      if (Object.keys(errors).length === 0) {
        const rendered = renderTemplate(tpl, current, envFor(id, view, line));
        if (rendered.ok) answer.preview = rendered.text;
        else answer.error = Object.values(rendered.errors)[0];
      }
      return answer;
    };
  }

  function remember(key: string, tpl: TemplateDef, values: Record<string, unknown>): void {
    const kept: Record<string, unknown> = {};
    for (const p of tpl.params ?? []) {
      if (p.remember === true && p.type !== 'formula' && Object.prototype.hasOwnProperty.call(values, p.id)) kept[p.id] = values[p.id];
    }
    if (Object.keys(kept).length > 0) deps.uiState.setLastParams(key, kept);
  }

  // -- the edit -----------------------------------------------------------------------------

  const lineOf = (id: DocId, n: number): string => deps.editor.getLines(id, n, n)[0] ?? '';

  /** Where an insertion goes: after the cursor's block, or in place of its line when that line is blank. */
  function targetOf(id: DocId, view: EffectiveProfile): { cursorLine: number; last: number; blank: boolean; lineCount: number } {
    const lineCount = Math.max(1, deps.editor.getLineCount(id));
    const cursorLine = Math.min(Math.max(1, deps.editor.cursor()?.line ?? lineCount), lineCount);
    const input: InspectInput = { line: cursorLine, lineCount, getLine: (n) => lineOf(id, n) };
    const { last } = blockRange(input, view.cp);
    return { cursorLine, last, blank: lineOf(id, last).trim() === '', lineCount };
  }

  /** Writes `rendered` into document `id` as one `applyLines` call; false when nothing was written. */
  function write(id: DocId, view: EffectiveProfile, tpl: TemplateDef, rendered: Extract<RenderResult, { ok: true }>, env: TemplateEnv): boolean {
    const target = targetOf(id, view);
    const text = rendered.text.split('\n');
    const plan = planInsertion(deps, id, view.cp, { last: target.last, text, blocks: rendered.blocks, prevBlockNumber: env.prevBlockNumber });
    const done = deps.applyLines(id, plan.start, plan.end, plan.lines);
    if (done.locked === true) {
      const doc = deps.docs.get(id);
      const locked = doc === undefined ? null : lockRefusal(doc, t('readOnly.insertTemplate', { template: tpl.label }));
      if (locked !== null) sayMsg(locked, true);
      return false;
    }
    if (done.changedLines === 0) return false;
    deps.editor.reveal(id, plan.lastInserted, text[text.length - 1].length + 1);
    return true;
  }

  async function insert(templateId: string, given?: Record<string, unknown>): Promise<boolean> {
    try {
      return await insertNow(templateId, given);
    } finally {
      scanned = null;
    }
  }

  async function insertNow(templateId: string, given?: Record<string, unknown>): Promise<boolean> {
    const id = deps.docs.getActiveId();
    const doc = id === null ? undefined : deps.docs.get(id);
    if (id === null || doc === undefined) {
      say(t('templates.noDocument'), true);
      return false;
    }
    if (!isNcDocumentPath(doc.path)) {
      say(t('templates.notProgram'), true);
      return false;
    }
    const view = viewOf(id);
    const tpl = list(id).find((x) => x.id === templateId);
    if (view === null || tpl === undefined) {
      say(t('templates.notOffered', { id: templateId }), true);
      return false;
    }
    // The editor's own `readOnly` refuses the edit as well, but silently (AD-23).
    const locked = lockRefusal(doc, t('readOnly.insertTemplate', { template: tpl.label }));
    if (locked !== null) {
      sayMsg(locked, true);
      return false;
    }

    const refuse = (errors: Record<string, Msg>): false => {
      const first = Object.values(errors)[0];
      say(t('templates.refused', { label: tpl.label, reason: first === undefined ? '' : t(first.key, first.params) }), true);
      return false;
    };

    // A snippet template has no form: the snippet controller owns the tab stops.
    if (tpl.snippet === true) {
      const target = targetOf(id, view);
      const rendered = renderTemplate(tpl, {}, envFor(id, view, target.cursorLine));
      if (!rendered.ok) return refuse(rendered.errors);
      deps.editor.insertSnippet(rendered.text, { line: target.last, replace: target.blank });
      return true;
    }

    const dialect = view.codes.dialect;
    const memoKey = templateMemoKey(dialect, tpl.id);
    let values = given;
    const decimals = machineDecimals(tpl, view);
    if (values === undefined) {
      const fields = templateFields(tpl);
      const fieldIds = new Set(fields.map((f) => f.id));
      const line = targetOf(id, view).cursorLine;
      const env = envFor(id, view, line);
      const ctx = blockContext(id, view, tpl, env);
      const start = initialValues(fields, deps.uiState.getLastParams(memoKey));
      // Item 6: a contour number starts free, whatever was remembered.
      if (ctx.doc !== null) Object.assign(start, freeBlockValues(tpl, ctx.params, ctx.doc, ctx.own, view.cp));
      const answered = await deps.modals.form({
        title: tpl.label,
        fields,
        values: start,
        okLabel: t('templates.insertOk'),
        note: noteFor(tpl, view, ctx, env, start),
        live: liveFor(id, view, tpl, fieldIds, line, ctx, decimals),
      });
      if (answered === undefined) return false;
      values = answered;
      remember(memoKey, tpl, answered);
    }

    // The program may have moved on while the form was open: read it again.
    const current = deps.docs.get(id);
    if (current === undefined) return false;
    const stillLocked = lockRefusal(current, t('readOnly.insertTemplate', { template: tpl.label }));
    if (stillLocked !== null) {
      sayMsg(stillLocked, true);
      return false;
    }
    const target = targetOf(id, view);
    const env = envFor(id, view, target.cursorLine);
    const rendered = renderTemplate(tpl, values, env);
    if (!rendered.ok) return refuse(rendered.errors);
    // Items 6 and 7 against the program as it is now.
    const late = contextErrors(tpl, values, blockContext(id, view, tpl, env), decimals, view, {});
    if (Object.keys(late).length > 0) return refuse(late);
    return write(id, view, tpl, rendered, env);
  }

  /** The form's note: the review mark, the scaled machine (item 7), the referenced numbers the template writes (item 6). */
  function noteFor(tpl: TemplateDef, view: EffectiveProfile, ctx: BlockContext, env: TemplateEnv, start: Record<string, unknown>): string | undefined {
    const parts: string[] = [];
    if (tpl.review === 'pending') parts.push(t('templates.reviewPending'));
    const unit = scaledUnit(view);
    if (unit !== null) parts.push(t('templates.unitScaled', { unit }));
    if (ctx.doc !== null && ctx.doc.referenced.size > 0) {
      // The numbers the text with these values writes; every `{{N}}` when it cannot be rendered yet.
      const shown = renderTemplate(tpl, start, env);
      const own = shown.ok ? ownNumbers(env, shown.blocks) : ctx.own;
      for (const hit of namedOwnNumbers(own, ctx.doc, view.cp).slice(0, 3)) parts.push(t('templates.numberNamed', hit));
    }
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  // -- favourites ---------------------------------------------------------------------------

  const favoriteRevision = writable(0);

  function favoritesOf(dialect: string): string[] {
    const memo = deps.uiState.getLastParams(FAVORITES_KEY);
    if (memo === undefined || !Object.prototype.hasOwnProperty.call(memo, dialect)) return [];
    const raw = memo[dialect];
    if (!Array.isArray(raw)) return [];
    const ids: string[] = [];
    for (const entry of raw) {
      if (typeof entry === 'string' && TEMPLATE_ID.test(entry) && !ids.includes(entry)) ids.push(entry);
      if (ids.length >= TEMPLATE_LIMITS.templates) break;
    }
    return ids;
  }

  function setFavorite(dialect: string, templateId: string, on: boolean): void {
    if (!TEMPLATE_ID.test(templateId)) return;
    const now = favoritesOf(dialect);
    const next = on ? (now.includes(templateId) ? now : [...now, templateId].slice(-TEMPLATE_LIMITS.templates)) : now.filter((x) => x !== templateId);
    if (next.length === now.length && next.every((x, i) => x === now[i])) return;
    const memo = deps.uiState.getLastParams(FAVORITES_KEY) ?? {};
    // Own members only: a dialect id such as `__proto__` is just a name here.
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(memo)) Object.defineProperty(copy, key, { value: memo[key], enumerable: true, writable: true, configurable: true });
    Object.defineProperty(copy, dialect, { value: next, enumerable: true, writable: true, configurable: true });
    deps.uiState.setLastParams(FAVORITES_KEY, copy);
    favoriteRevision.update((n) => n + 1);
  }

  // -- changed ------------------------------------------------------------------------------

  /** What of the open documents decides their templates: the profile and the machine of each. */
  function signatureOfDocs(): string {
    return get(deps.docs.list)
      .map((d) => `${d.id}:${d.profileId}:${d.machineId === undefined ? '' : d.machineId === null ? '-' : d.machineId}`)
      .join('|');
  }

  const changed: Readable<number> = readable(0, (set) => {
    let count = 0;
    let ready = false;
    const bump = (): void => {
      if (ready) set(++count);
    };
    let signature = signatureOfDocs();
    const stops: Disposable[] = [
      ...deps.revisions.map((store) => store.subscribe(bump)),
      deps.docs.list.subscribe(() => {
        const next = signatureOfDocs();
        if (next === signature) return;
        signature = next;
        bump();
      }),
      favoriteRevision.subscribe(bump),
    ];
    ready = true;
    return () => {
      for (const stop of stops) stop();
    };
  });

  return {
    list,
    dialectOf,
    render,
    insert,
    favorites: favoritesOf,
    setFavorite,
    changed,
  };
}

/** The application-wide template service; `ctx.templates`, the Insert tab, completion and the palette use it. */
export const templates: TemplateService = createTemplateService({
  docs: appDocs,
  editor: appEditor,
  effective: (id) => appMachines.effective(id),
  revisions: [appMachines.revision, appProfiles.revision],
  modals: appModals,
  uiState: appUiState,
  applyLines: applyLinesToModel,
  status: appStatus,
  now: () => new Date(),
  t: translate,
});
