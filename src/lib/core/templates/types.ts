// The template contracts (Phase 2 plan §7.8, extended by the P3b prelude; Phase 3 plan §6.11).
// Written by the P3b prelude; binding. Owner from Wave A on: P3.4 (this file and the engine),
// with the formula, cycle-form and selection shapes below owned by P3.8.
//
// A template is a named piece of NC text with parameters, scoped to one code database and one
// group ("Program", "Tool change", "Drilling"). It lives in the database file's `templates`
// array (`src/lib/data/codes/<id>.json` for the built-ins, `<config>/codes/<id>.json` for the
// user's, merged by `id`: a user template with the id of a built-in one replaces it). The file
// format, its limits and the "review pending" marker are read by `load.ts` (`loadTemplates`),
// the one reader for built-in and user files alike.
//
// Every label, group, description and help text is data: shown as text, never as markdown,
// never translated (AD-14). The engine (`engine.ts`) is pure: no Monaco, no store, no clock;
// the caller passes the date, the time and the file name in `TemplateEnv.sys`.

import type { Msg } from '$lib/app/types';
import type { CodeEntry } from '$lib/core/codes/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { CompiledProfile } from '$lib/core/profiles/types';

/**
 * What a parameter collects. `formula` (P3.8) is read-only and computed from the other
 * parameters (`formula.ts`); it is shown in the form as a read-only field unless `hidden`.
 */
export type TemplateParamType = 'number' | 'integer' | 'text' | 'choice' | 'formula';

/**
 * How a number is written: `'as-entered'` as typed (a leading `+` only with `plusSign`),
 * `'min1'` with at least a decimal point (`10` → `10.`, the Fanuc style), or a fixed count of
 * decimals (0–6). A typed value with **more** decimals than a fixed count is refused, never
 * rounded; a formula result is rounded half away from zero to the fixed count.
 */
export type TemplateDecimals = 'as-entered' | 'min1' | number;

/** One option of a `choice` parameter: `label` is shown, `value` is inserted. */
export interface TemplateChoice {
  label: string;
  value: string;
}

/** One parameter of a template (P2 §7.8 + `formula`, `hidden`). */
export interface TemplateParam {
  /** `TEMPLATE_PARAM_ID` (`[a-z_][a-z0-9_]{0,31}`); unique in the template; never `sys`, `pi` or a formula function name. */
  id: string;
  label: string;
  type: TemplateParamType;
  help?: string;
  /** An empty value is refused. Not on a `formula`. */
  required?: boolean;
  /** Inclusive bounds of a `number` or `integer`. */
  min?: number;
  max?: number;
  /** The value the form starts with when nothing is remembered; a number's default is kept as decimal text. Not on a `formula`. */
  default?: string | number;
  /** `choice` only: 1 to `TEMPLATE_LIMITS.choices` options with distinct values. */
  choices?: TemplateChoice[];
  /** Written before and after the value (usually the address letter, `Z`, `Q201=`). An empty optional value drops both. */
  prefix?: string;
  suffix?: string;
  /** `number` and `formula`. */
  decimals?: TemplateDecimals;
  /** `integer` and `formula`: zero padding to this many digits (`42` → `0042`), 1–9. */
  digits?: number;
  /** Writes `+` before a positive number. */
  plusSign?: boolean;
  /** `text`: the value is refused unless it is upper case (never changed silently). */
  uppercase?: boolean;
  /** `text`: wrapped in the profile's comment delimiters. */
  comment?: boolean;
  /** The last value is remembered in `state.json` (`ui.lastParams['template:<dialect>:<id>']`). */
  remember?: boolean;
  /** `formula` only (P3.8): the expression over the other parameters, e.g. `s * z * fz`. */
  formula?: string;
  /** `formula` only: not shown in the form (the value is still computed and inserted). */
  hidden?: boolean;
}

/** One template (P2 §7.8 + `machineType`, `review`). */
export interface TemplateDef {
  /** `TEMPLATE_ID` (`[a-z0-9-]`, at most 64, no leading or trailing `-`); the command is `insert.template:<id>`. */
  id: string;
  label: string;
  /** The Insert tab's group and the completion's sort key; free text, at most 40 characters. */
  group: string;
  description?: string;
  /** A button on the Insert tab (the others are in the group's "More…" list). */
  toolbar?: boolean;
  /** No form: the body is Monaco snippet syntax (`${1:Z-5.}`) inserted by the snippet controller. No `params`. */
  snippet?: boolean;
  /** Plain NC text with placeholders: `{{id}}`, `{{N}}` at a line start, `{{sys.date|time|file|stem}}`, `\{{` for a literal `{{`. */
  body: string;
  /** In form order (the form's order may differ from the order in the body). */
  params?: TemplateParam[];
  /**
   * Only documents whose profile has this machine type see the template. A database that
   * profiles of both machine types read (Fanuc `fanuc` through `fanuc-lathe`, Sinumerik) marks
   * every template with it. Absent: every profile that reads the database.
   */
  machineType?: 'mill' | 'lathe';
  /**
   * `'pending'`: the template has not been reviewed by the owner yet (owner decision of
   * 2026-10-09: the built-in content ships marked so). The Insert tab, the completion item and
   * the form say so; removed template by template by the owner's review.
   */
  review?: 'pending';
}

/** What `renderTemplate` needs to know about the document and the insertion point. */
export interface TemplateEnv {
  cp: CompiledProfile;
  /** The block number of the nearest numbered block above the insertion point, or null. */
  prevBlockNumber: number | null;
  /** False: `{{N}}` is empty (an unnumbered document). A `consecutive` profile (Klartext) is always numbered. */
  numbered: boolean;
  /** Date and time as the caller formats them; `file` and `stem` empty for an untitled document. */
  sys: { date: string; time: string; file: string; stem: string };
}

/** The result of `renderTemplate`. `blocks` is how many `{{N}}` numbers were used (the Klartext renumber reads it). */
export type RenderResult = { ok: true; text: string; blocks: number } | { ok: false; errors: Record<string, Msg> };

/** One problem of a template file; `path` points into the JSON below `templates`, e.g. `[3].params[1].prefix`. */
export interface TemplateProblem {
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------------------------
// P3.8: formula parameters (`formula.ts`)
// ---------------------------------------------------------------------------------------------

/** The value of every formula parameter of a template: decimal text, or null when it is empty (it read an empty optional parameter). */
export interface FormulaResult {
  values: Record<string, string | null>;
  /** By parameter id: why its formula has no value (a division by zero, a root of a negative number, …). */
  errors: Record<string, Msg>;
}

// ---------------------------------------------------------------------------------------------
// P3.8: cycle forms (`cycleForm.ts`)
// ---------------------------------------------------------------------------------------------

/**
 * The form of one cycle, from the database's entry: one field per parameter, in the database's
 * order, keyed by the parameter's address (`Z`, `Q201`, `RTP`), pre-filled with the values as
 * written in the block (`''` for a word the block does not have).
 */
export interface CycleForm {
  entry: CodeEntry;
  /** `edit`: the cursor is on the cycle's block; `insert`: a new block after the cursor's line. */
  mode: 'edit' | 'insert';
  /** The block's lines (1-based, inclusive) in `edit` mode; null in `insert` mode. */
  block: { first: number; last: number } | null;
  fields: FieldSpec[];
  values: Record<string, string>;
  /** The block's words the database does not know, as written; kept by `applyCycleForm` (shown as a note). */
  kept: string[];
  /**
   * P3b fix NC (review NC-08): by field id, how the machine reads a value written without a
   * point (`cycleForm.withoutPoint`: `Q4000` is 4 mm on IS-B), for a field whose literal and
   * reading differ. The caller shows it as the field's help.
   */
  readings?: Record<string, Msg>;
}

/** What `cycleFormAt` found at the cursor. */
export type CycleFormAt = { ok: true; form: CycleForm } | { ok: false; reason: Msg };

/**
 * The edit `applyCycleForm` makes: the lines `first`…`last` (1-based, inclusive) are replaced by
 * `lines`; `last === first - 1` inserts before `first`. One undo step (`applyLines`).
 */
export type CycleFormEdit = { ok: true; first: number; last: number; lines: string[] } | { ok: false; errors: Record<string, Msg> };

// ---------------------------------------------------------------------------------------------
// P3.8: a template from the selection (`fromSelection.ts`)
// ---------------------------------------------------------------------------------------------

/** One number of the selection that can become a parameter (`Z-5.` → `z`, prefix `Z`). */
export interface SelectionCandidate {
  /** Stable within the draft: `<line>:<start>`. */
  key: string;
  /** 0-based line within the selection, and the word's columns on it (0-based, end exclusive). */
  line: number;
  start: number;
  end: number;
  /** The address as written (`Z`, `Q201`), and the number as written (`-5.`). */
  address: string;
  written: string;
  /** The parameter it becomes: id, type, prefix and number style read from how it is written. */
  param: TemplateParam;
}

/** The selection as a template body, with `{{N}}` for its block numbers, and the numbers that can become parameters. */
export interface TemplateDraft {
  body: string;
  candidates: SelectionCandidate[];
  /**
   * P3b fix NC (review NC-02): a block number of the selection that a reference of the selection
   * points at (`G71 P120` and `N120 …`, `GOTO 70` and `N70 …`, Okuma `G85 NLAP1` and `NLAP1 …`)
   * is one parameter, written in the body at the block and at every reference. It is no
   * candidate: `draftToTemplate` always adds it, so a P/Q pair cannot be split.
   */
  references?: TemplateParam[];
  /** P3b fix NC: what the draft leaves as written and why (`templates.fromSelection.*`), for the dialog to show. */
  notes?: Msg[];
}
