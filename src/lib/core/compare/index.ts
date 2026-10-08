// Compare normalization and the unified diff (plan §7.7, AD-26). Owner: WP11.2.
//
// Review mode reads both sides of a comparison line by line through the tokenizer and
// writes each line again with the differences the options ignore taken out, so the diff
// of the two results shows only what the control would read differently. The rules every
// option obeys are the header of `./types.ts`; this file implements them and adds the
// details that header leaves to WP11.2:
//
//  - **What the number format may touch.** Only literals, and of those only:
//      - a code word (`G`, `M`): the leading zeros of the number, nothing else
//        (`G01` → `G1`, `G84.2` and `G1.` as written);
//      - a word of a value address the profile names (axes, their incremental twins, arc
//        centres, diameter and rotary words, the feed, the spindle, the feed-unit words),
//        and the value of an assignment (`#1=`, `R1=`, `Q200=`): the canonical form;
//      - any other address: the canonical form with its point kept when the value has a
//        point (`P1000.0` → `P1000.`, never `P1000`: review NC-2), as written when it has none. Without the code database nothing here can tell a count from a name,
//        and a point-less number may be one: a Sinumerik `L0123` is not `L123`, an Okuma
//        `CALL O0123` names a program as text, `M98 P0010` is a program number. A value
//        with a point is never a name.
//    Never touched: the tool word on a turning profile, a value a `numbering.references`
//    rule points with (`G70 P100 Q200`, Okuma `IF … N0020`), a value without an address
//    that is not assigned (`CYCL DEF 200`, `LBL 1`, `BLK FORM 0.1`), block numbers,
//    program markers, labels, variables, strings and comments.
//  - **The decimal point** survives where `pointSignificant` says so, with or without a
//    fraction: `X10.000` → `X10.`, never `X10`. The decimal comma becomes a point.
//  - **What a dropped token leaves behind.** A block number or a comment that goes takes
//    one of the blanks around it with it (the one behind it at the head of a line, the one
//    in front of it at the end), so `N10 G1` and `G1` meet, and `G1 (A) X1` reads
//    `G1 X1` even with whitespace significant. Two tokens that touched a dropped comment
//    touch each other (`G1(A)X1` → `G1X1`): no blank is ever inserted. On a dialect that
//    reads names, a comment between a name and a letter stays (`NAB(C)G1` is not the name
//    `NABG1`; review NC-10).
//  - **A line disappears** when it held nothing but what the options dropped (a
//    comment-only line, a lone unreferenced `N100`), or when it is blank and whitespace is
//    ignored. A blank line with whitespace significant stays, as an empty line.
//  - **Case** folds to upper case outside strings, and not in a comment the control reads
//    (`keepComments`): the case of a Sinumerik `;$PATH=` folder is the control's business.
//  - **Block numbers** are kept per file, not per program: a number one program of the
//    file jumps to is kept in every program of it. Stricter than the control, never looser.
//  - **Cycle names** (`ignoreCycleNames`, §7.16 #148) go by the span of the `(?<name>…)`
//    group of a `compare.cycleNames` pattern, and only when every token in that span is a
//    name: an unknown word or a word without a value that is no value address of the
//    profile. A span that cuts a token, or holds a value, an axis word (`X`, `IX`), a
//    variable, an operator, a comment, a string or a continuation mark, drops nothing:
//    the line is compared with its name. A dropped name leaves its blanks as a dropped
//    comment does (`CYCL DEF 200 BOHREN ~` → `CYCL DEF 200 ~`).

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, NcToken, NumericLiteral } from '$lib/core/nc/types';
import type { NumberInput } from '$lib/core/machines/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { Msg } from '$lib/app/types';
import { diffLines, type LineEdit } from '$lib/core/transforms/lineDiff';
import {
  blockKeyOf,
  comparesByText,
  labelsOf,
  mainKeyOf,
  mainPrefixOf,
  mainReferencesOn,
  referenceAddresses,
  referencesOn,
  type BlockKey,
  type ReferenceWord,
} from '$lib/core/transforms/references';
import {
  COMPARE_FALLBACK,
  COMPARE_OPTION_KEYS,
  type CompareOptions,
  type NormalizeContext,
  type Normalized,
  type NormalizedLine,
  type NormalizeOverrides,
  type SideMachine,
} from './types';

export * from './types';

/**
 * The message keys of `Normalized.notes` (WP11.3 writes the texts, `compare` namespace).
 *
 * - `blockNumbers`: a jump with a computed target keeps every block number of this side;
 *   `params.line` is the first such line (1-based).
 * - `pointWithoutMachine`: no machine says how numbers are read, the declared presets
 *   disagree about the decimal point, so it counts (`X10` ≠ `X10.`).
 */
export const COMPARE_NOTE_KEYS = {
  blockNumbers: 'compare.noteBlockNumbers',
  pointWithoutMachine: 'compare.notePointWithoutMachine',
} as const;

/** The letters of code words, whose number loses its leading zeros and nothing else. */
const CODE_LETTERS: ReadonlySet<string> = new Set(['G', 'M']);

/** The default context of `unifiedDiff`: three lines, as in AD-26. */
const DEFAULT_CONTEXT = 3;

/**
 * The review-mode toggles a comparison of this profile starts with: the profile's
 * `compare` block over `COMPARE_FALLBACK`. A member that is not a boolean is the fallback's
 * (the validator reports it; this never throws). `tolerance` and `keepComments` are not
 * toggles and are not part of the answer.
 */
export function compareDefaults(p: Profile): CompareOptions {
  const block = p?.compare;
  const out: CompareOptions = { ...COMPARE_FALLBACK };
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return out;
  for (const key of COMPARE_OPTION_KEYS) {
    const value = (block as Record<string, unknown>)[key];
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** True when the profile declares where its cycle names stand (`compare.cycleNames`). */
function declaresCycleNames(p: Profile): boolean {
  const patterns = p?.compare?.cycleNames;
  return Array.isArray(patterns) && patterns.some((pattern) => typeof pattern === 'string' && pattern !== '');
}

/**
 * The review-mode toggles the compare toolbar offers for this profile, in toolbar order:
 * every one of `COMPARE_OPTION_KEYS`, except `ignoreCycleNames` where the profile declares
 * no `compare.cycleNames` (§7.16 #148). A toggle that is not offered keeps its default and
 * changes nothing on that profile's sides.
 */
export function offeredOptions(p: Profile): (keyof CompareOptions)[] {
  const names = declaresCycleNames(p);
  return COMPARE_OPTION_KEYS.filter((key) => key !== 'ignoreCycleNames' || names);
}

// ---------------------------------------------------------------------------
// The decimal point (AD-26)
// ---------------------------------------------------------------------------

/** True when any class of this reading counts a point-less literal in increments. */
function readsIncrements(input: NumberInput | null | undefined): boolean {
  if (input === null || typeof input !== 'object') return false;
  if (input.mode === 'increment') return true;
  const classes = input.classes;
  if (classes === null || typeof classes !== 'object') return false;
  return Object.values(classes).some((entry) => entry?.mode === 'increment');
}

/** The number inputs of every preset the profile declares, unreadable entries left out. */
function presetInputs(p: Profile): NumberInput[] {
  const presets = p?.machineParams?.numberInput?.presets;
  if (!Array.isArray(presets)) return [];
  return presets
    .map((preset) => preset?.value)
    .filter((value): value is NumberInput => value !== null && typeof value === 'object');
}

/** True when the side's machine states its own number input (AD-31 "No machine, no guess"). */
function machineReadsNumbers(machine: SideMachine): boolean {
  return machine?.source?.numberInput === 'machine';
}

/**
 * True when a decimal point can change a value under a reading that applies to this side
 * (AD-26): the machine's own number input when `machine.source.numberInput` is `machine`,
 * else every preset `p.machineParams` declares; with no presets, `syntax.decimalPointSignificant`
 * as the profile writes it. "Can change" means any class of any such reading is an
 * `increment` reading.
 *
 * A profile that leaves `decimalPointSignificant` out counts the point, as `formatNumber`
 * does: shown, never hidden.
 */
export function pointSignificant(p: Profile, machine: SideMachine): boolean {
  if (machineReadsNumbers(machine)) return readsIncrements(machine?.params?.numberInput);
  const presets = presetInputs(p);
  if (presets.length > 0) return presets.some(readsIncrements);
  return p?.syntax?.decimalPointSignificant !== false;
}

/** True when the point counts only because the presets disagree and no machine settles it. */
function pointUnsettled(p: Profile, machine: SideMachine): boolean {
  if (machineReadsNumbers(machine)) return false;
  const presets = presetInputs(p);
  return presets.some(readsIncrements) && !presets.every(readsIncrements);
}

// ---------------------------------------------------------------------------
// Once per file
// ---------------------------------------------------------------------------

/** The block numbers the references of a file keep, and the first computed jump. */
interface KeptNumbers {
  keep: 'all' | Set<BlockKey>;
  /** The 1-based line of the first reference whose target is not a literal; 0 when none. */
  computedAt: number;
}

/** Adds the targets of one line's references; answers false once a target is computed. */
function collectTargets(words: readonly ReferenceWord[], keep: Set<BlockKey>): boolean {
  for (const word of words) {
    if (word.key === null) return false;
    keep.add(word.key);
  }
  return true;
}

/** Escapes a literal for a `RegExp`. */
function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Walks the file's references. A line is tokenized only when its text holds one of the
 * reference addresses at all, which the comment-masked line the rules test can only hold
 * if the line does; on a profile with a continuation marker every line is tokenized,
 * because a line's tokens depend on the line before it.
 */
function keptNumbers(lines: readonly string[], cp: CompiledProfile): KeptNumbers {
  const keep = new Set<BlockKey>();
  if (cp.re.references.length === 0) return { keep, computedAt: 0 };
  const addresses = referenceAddresses(cp);
  // A jump to one of the file's labels (`GOTOF LOOP_A`) names no block; to any other name
  // (`GOTOF DEST`, a `STRING` variable) it is computed (review NC-3).
  const labels = labelsOf(lines, cp);
  const sequential = cp.re.continuation !== undefined;
  const candidate = new RegExp([...addresses].map(escapeLiteral).join('|'), 'i');
  let state: LineState | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!sequential && !candidate.test(line)) continue;
    const { tokens, state: next } = tokenizeLine(line, cp, state);
    state = next;
    const words = referencesOn(tokens, line, cp, addresses, labels);
    if (words.length > 0 && !collectTargets(words, keep)) return { keep: 'all', computedAt: i + 1 };
    // `GOTOF :200` names the main block `:200` (Sinumerik), which `referencesOn` cannot see.
    const main = mainReferencesOn(tokens, line, cp);
    if (main.length > 0 && !collectTargets(main, keep)) return { keep: 'all', computedAt: i + 1 };
  }
  return { keep, computedAt: 0 };
}

/** A list of profile patterns compiled with the profile's flags (and `extra`); a broken one is skipped. */
function compiledList(patterns: unknown, cp: CompiledProfile, extra = ''): RegExp[] {
  if (!Array.isArray(patterns)) return [];
  const out: RegExp[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue;
    try {
      out.push(new RegExp(pattern, cp.flags + extra));
    } catch {
      // The validator refuses a pattern that does not compile; a hand-built profile that
      // slipped one past it keeps the other patterns rather than failing the comparison.
    }
  }
  return out;
}

/** `profile.compare.keepComments`, compiled with the profile's flags. */
function keepCommentPatterns(cp: CompiledProfile): RegExp[] {
  return compiledList(cp.profile.compare?.keepComments, cp);
}

/** `profile.compare.cycleNames` with `d`, so the span of `(?<name>…)` is known (§7.16 #148). */
function cycleNamePatterns(cp: CompiledProfile): RegExp[] {
  return compiledList(cp.profile.compare?.cycleNames, cp, 'd');
}

/**
 * Works out what one side's normalization needs (`NormalizeContext`), once per file.
 * `over.pointSignificant` replaces the side's own answer (§7.16 #144; see `normalizeLines`).
 */
export function prepareNormalize(
  lines: readonly string[],
  cp: CompiledProfile,
  machine?: SideMachine,
  over?: NormalizeOverrides,
): NormalizeContext {
  const kept = keptNumbers(lines, cp);
  return contextOf(cp, machine, kept, over);
}

function contextOf(cp: CompiledProfile, machine: SideMachine, kept: KeptNumbers, over?: NormalizeOverrides): NormalizeContext {
  const own = pointSignificant(cp.profile, machine);
  return {
    pointSignificant: typeof over?.pointSignificant === 'boolean' ? over.pointSignificant : own,
    keepBlockNumbers: kept.keep,
    keepComments: keepCommentPatterns(cp),
    cycleNames: cycleNamePatterns(cp),
  };
}

// ---------------------------------------------------------------------------
// One line
// ---------------------------------------------------------------------------

/** What the number format needs to know about a profile, worked out once per profile. */
interface NumberRules {
  /** Addresses whose values are quantities: the canonical form, point or not. */
  values: ReadonlySet<string>;
  /** The tool word that is never reformatted (a turning profile's `T`), or null. */
  tool: string | null;
  /** `syntax.incrementalPrefix` (Klartext `I`), upper case, or null. */
  incremental: string | null;
  /** The profile has `"…"` strings, whose case and blanks are never touched. */
  strings: boolean;
  /** The profile reads names (`syntax.names`), so letters written together may be one. */
  names: boolean;
  byText: boolean;
  references: Set<string>;
  /** The main-block prefix (Sinumerik `:`), whose blocks have keys of their own; null without. */
  main: string | null;
}

const RULES = new WeakMap<CompiledProfile, NumberRules>();

function upper(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value.toUpperCase() : null;
}

function rulesOf(cp: CompiledProfile): NumberRules {
  const cached = RULES.get(cp);
  if (cached) return cached;
  const p = cp.profile;
  const a = p.addresses ?? { axes: [] };
  const values = new Set<string>();
  const add = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const address = upper(entry);
      if (address !== null) values.add(address);
    }
  };
  add(a.axes);
  add(a.arcCenter);
  add(a.diameter);
  add(a.angular);
  add(Object.keys(a.incremental ?? {}));
  add(Object.keys(a.feedUnitWords ?? {}));
  add([a.feed, a.spindle]);
  const rules: NumberRules = {
    values,
    tool: p.machineType === 'lathe' ? upper(a.tool) : null,
    incremental: upper(p.syntax?.incrementalPrefix),
    strings: p.syntax?.strings === true,
    names: cp.re.names !== undefined,
    byText: comparesByText(cp),
    references: referenceAddresses(cp),
    main: mainPrefixOf(cp),
  };
  RULES.set(cp, rules);
  return rules;
}

/** `digits` without its leading zeros, one zero left for a zero. */
function withoutLeadingZeros(digits: string): string {
  let i = 0;
  while (i < digits.length - 1 && digits.charCodeAt(i) === 0x30) i++;
  return digits.slice(i);
}

/**
 * The canonical form of a literal: no `+`, no leading zeros, no trailing zeros after the
 * point, a point (not a comma), and the point itself only where `keepPoint` and the
 * literal has one. A negative zero is a zero.
 */
export function canonicalNumber(lit: NumericLiteral, keepPoint: boolean): string {
  const integer = withoutLeadingZeros(lit.intPart === '' ? '0' : lit.intPart);
  let end = (lit.fracPart ?? '').length;
  const fraction = lit.fracPart ?? '';
  while (end > 0 && fraction.charCodeAt(end - 1) === 0x30) end--;
  const digits = fraction.slice(0, end);
  const zero = integer === '0' && digits === '';
  const sign = lit.sign === '-' && !zero ? '-' : '';
  if (digits !== '') return `${sign}${integer}.${digits}`;
  return `${sign}${integer}${lit.hasPoint && keepPoint ? '.' : ''}`;
}

/** A code number with its leading zeros dropped and everything else as written. */
function codeNumber(lit: NumericLiteral): string {
  if (lit.intPart.length < 2) return lit.raw;
  const head = lit.sign.length;
  return `${lit.sign}${withoutLeadingZeros(lit.intPart)}${lit.raw.slice(head + lit.intPart.length)}`;
}

/** Upper case outside `"…"` strings (where the profile has strings). */
function foldCase(text: string, strings: boolean): string {
  if (!strings || !text.includes('"')) return text.toUpperCase();
  let out = '';
  let inside = false;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 0x22) continue;
    const part = text.slice(from, i + 1);
    out += inside ? part : part.toUpperCase();
    inside = !inside;
    from = i + 1;
  }
  const rest = text.slice(from);
  return out + (inside ? rest : rest.toUpperCase());
}

const BLANKS = /[ \t\v\f ]+/g;

/** Every run of blanks outside `"…"` strings as one blank. */
function collapseBlanks(text: string, strings: boolean): string {
  if (!/[ \t\v\f ]/.test(text)) return text;
  if (!strings || !text.includes('"')) return text.replace(BLANKS, ' ');
  const parts = text.split('"');
  for (let i = 0; i < parts.length; i += 2) parts[i] = parts[i].replace(BLANKS, ' ');
  return parts.join('"');
}

/** The value of a word as the number format writes it, or null to leave the word alone. */
function formattedValue(
  token: NcToken,
  previous: NcToken | null,
  rules: NumberRules,
  ctx: NormalizeContext,
): string | null {
  const lit = token.value;
  if (!lit) return null;
  const address = token.address?.toUpperCase();
  if (address === undefined) {
    // A value without an address is a quantity only where it is assigned (`#1=5.000`);
    // after a keyword it is a number the statement names (`LBL 1`, `CYCL DEF 200`).
    return previous?.kind === 'operator' && previous.text === '=' ? canonicalNumber(lit, ctx.pointSignificant) : null;
  }
  if (address === rules.tool) return null;
  if (CODE_LETTERS.has(address)) return codeNumber(lit);
  if (rules.values.has(address)) return canonicalNumber(lit, ctx.pointSignificant);
  // Any other address keeps its point whatever the machine: a dwell `P`, a cycle `Q`, an
  // offset `H`/`D` take no point under calculator input either, so `P1000.` is not `P1000`
  // (review NC-2). Trailing zeros still go (`P1000.0` = `P1000.`).
  if (lit.hasPoint) return canonicalNumber(lit, true);
  return null;
}

/**
 * True when `token` is a block number the options drop. On a dialect whose programs name
 * things (`syntax.names`), a number written against a letter stays: `N30XNOW=62` may be
 * read as something else than `N30 XNOW=62`, and dropping the number would make the two
 * look alike.
 */
function dropsBlockNumber(
  token: NcToken,
  next: NcToken | undefined,
  o: CompareOptions,
  ctx: NormalizeContext,
  rules: NumberRules,
): boolean {
  if (!o.ignoreBlockNumbers) return false;
  if (ctx.keepBlockNumbers === 'all') return false;
  if (rules.names && next !== undefined && next.kind !== 'whitespace' && /^[A-Za-z_]/.test(next.text)) return false;
  if (token.valueText === undefined) return true;
  // A main block (`:200`) is named by its own prefix (`GOTOF :200`), so it has a key of its own.
  const key =
    rules.main !== null && token.address === rules.main && blockKeyOf(token.valueText, rules.byText) !== null
      ? mainKeyOf(rules.main, token.valueText, rules.byText)
      : blockKeyOf(token.valueText, rules.byText);
  return key === null || !ctx.keepBlockNumbers.has(key);
}

/** The value spans a reference rule points with on this line, by the offset of their end. */
function referenceEnds(tokens: NcToken[], line: string, cp: CompiledProfile, rules: NumberRules): Set<number> {
  return new Set(referencesOn(tokens, line, cp, rules.references).map((word) => word.end));
}

/**
 * True when dropping the comment at `index` would glue a name to what follows it: on a
 * dialect that reads names, `NAB(C)G1` without its comment is `NABG1`, a sequence name the
 * control reads differently (review NC-10). Such a comment stays.
 */
function gluesNames(tokens: NcToken[], index: number, rules: NumberRules): boolean {
  if (!rules.names) return false;
  let before = index - 1;
  while (before >= 0 && tokens[before].kind === 'comment') before--;
  let after = index + 1;
  while (after < tokens.length && tokens[after].kind === 'comment') after++;
  const left = tokens[before];
  const right = tokens[after];
  if (left === undefined || right === undefined || left.kind === 'whitespace' || right.kind === 'whitespace') return false;
  return /[A-Za-z0-9_]$/.test(left.text) && /^[A-Za-z_]/.test(right.text);
}

/** True when `token` may be dropped as part of a cycle name: a name, never a value or an address. */
function isNameToken(token: NcToken, rules: NumberRules): boolean {
  // M12.5 (§7.16 #179): the Klartext cycle name is one `text` token (`syntax.freeText`).
  if (token.kind === 'unknown' || token.kind === 'text') return true;
  if (token.kind !== 'word' || token.incremental === true) return false;
  if ((token.valueText ?? '') !== '' || (token.value !== undefined && token.value !== null)) return false;
  const address = token.address?.toUpperCase();
  if (address === undefined || rules.values.has(address) || address === rules.tool) return false;
  // `IX` written apart from its value is still an axis word.
  const prefix = rules.incremental;
  return !(prefix !== null && address.startsWith(prefix) && rules.values.has(address.slice(prefix.length)));
}

/**
 * The indexes of the tokens `ignoreCycleNames` drops on this line (§7.16 #148): those inside
 * the `(?<name>…)` span of a `compare.cycleNames` pattern that matches. A span that cuts a
 * token or holds anything but names (`isNameToken`) drops nothing.
 */
function cycleNameTokens(line: string, tokens: NcToken[], ctx: NormalizeContext, rules: NumberRules): Set<number> | null {
  let out: Set<number> | null = null;
  for (const re of ctx.cycleNames) {
    const span = re.exec(line)?.indices?.groups?.name;
    if (span === undefined || span[1] <= span[0]) continue;
    const [from, to] = span;
    const inside: number[] = [];
    let clean = true;
    for (let i = 0; i < tokens.length && clean; i++) {
      const token = tokens[i];
      if (token.end <= from || token.start >= to) continue;
      if (token.start < from || token.end > to) clean = false;
      else if (token.kind !== 'whitespace') {
        if (isNameToken(token, rules)) inside.push(i);
        else clean = false;
      }
    }
    if (!clean || inside.length === 0) continue;
    out ??= new Set();
    for (const i of inside) out.add(i);
  }
  return out;
}

/** Writes one tokenized line the way the options read it; null = the line disappears. */
function renderLine(
  line: string,
  tokens: NcToken[],
  cp: CompiledProfile,
  o: CompareOptions,
  ctx: NormalizeContext,
): string | null {
  const rules = rulesOf(cp);
  // Both are asked only when a token needs the answer: most lines have neither a comment
  // nor a word a reference could point with.
  let readComments: boolean | undefined;
  let references: Set<number> | undefined;
  const names = o.ignoreCycleNames && ctx.cycleNames.length > 0 ? cycleNameTokens(line, tokens, ctx, rules) : null;

  let out = '';
  // Where the run of blanks at the end of `out` starts; -1 when `out` ends in a token.
  let blankAt = -1;
  // Only skip marks so far: a dropped block number there is at the head of the block.
  let head = true;
  let dropped = false;
  let droppedLast = false;
  let previous: NcToken | null = null;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const kind = token.kind;
    if (kind === 'whitespace') {
      // The blank behind a dropped token goes when the one in front of it stays, or when
      // the dropped token opened the block.
      if (droppedLast && (head || blankAt >= 0 || out === '')) continue;
      if (o.ignoreWhitespace && out === '') continue;
      blankAt = out.length;
      out += o.ignoreWhitespace ? ' ' : token.text;
      droppedLast = false;
      continue;
    }

    if (kind === 'comment') {
      // A comment the control reads keeps itself, its blanks and its case.
      readComments ??= ctx.keepComments.some((re) => re.test(line));
      if (o.ignoreComments && !readComments && !gluesNames(tokens, index, rules)) {
        dropped = droppedLast = true;
        continue;
      }
    } else if (kind === 'blockNumber' && dropsBlockNumber(token, tokens[index + 1], o, ctx, rules)) {
      dropped = droppedLast = true;
      continue;
    } else if (names?.has(index)) {
      dropped = droppedLast = true;
      continue;
    }
    droppedLast = false;
    blankAt = -1;
    if (kind !== 'skip') head = false;

    let text = token.text;
    if (kind === 'string' || (kind === 'comment' && readComments)) {
      out += text;
      previous = token;
      continue;
    }
    if (kind === 'word' && o.ignoreNumberFormat) {
      const value = formattedValue(token, previous, rules, ctx);
      if (value !== null && token.valueText !== undefined && value !== token.valueText) {
        const pointsWith = token.address !== undefined && rules.references.has(token.address);
        if (pointsWith) references ??= referenceEnds(tokens, line, cp, rules);
        if (!pointsWith || !references?.has(token.end)) {
          text = text.slice(0, text.length - token.valueText.length) + value;
        }
      }
    }
    if (o.ignoreWhitespace) text = collapseBlanks(text, rules.strings);
    if (o.ignoreCase) text = foldCase(text, rules.strings);
    out += text;
    previous = token;
  }

  // A dropped token at the end of the line takes the blank in front of it; with whitespace
  // ignored, the blank at the end goes anyway.
  if (blankAt >= 0 && (droppedLast || o.ignoreWhitespace)) out = out.slice(0, blankAt);
  if (out === '' || (dropped && out.trim() === '')) return dropped || o.ignoreWhitespace ? null : out;
  return out;
}

/** One line; `prev` is the state after the line before it (Klartext continuations). */
export function normalizeLine(
  line: string,
  cp: CompiledProfile,
  o: CompareOptions,
  ctx: NormalizeContext,
  prev?: LineState,
): NormalizedLine {
  const { tokens, state } = tokenizeLine(line, cp, prev);
  return { text: renderLine(line, tokens, cp, o, ctx), state };
}

// ---------------------------------------------------------------------------
// A whole side
// ---------------------------------------------------------------------------

/** True when no option is on, so a side is compared exactly as written. */
function nothingIgnored(o: CompareOptions): boolean {
  return COMPARE_OPTION_KEYS.every((key) => !o[key]);
}

/**
 * A whole side. `machine` is the side's effective machine (§7.16 #135: an added optional
 * parameter); absent or null reads the side with no machine, so a literal pair is equal
 * only when every preset the profile declares reads it alike.
 *
 * `over.pointSignificant` (§7.16 #144) replaces the side's own decimal-point answer. A
 * comparison passes the same value to both sides, `pointSignificant(a) ||
 * pointSignificant(b)`, so the two sides are written by one rule: `X10` on an IS-B side and
 * `X10.` on a calculator side stay apart, and the same text on both sides stays equal
 * (review NC-6). The `pointWithoutMachine` note still describes the side's own machine.
 *
 * The block-number rule reads the whole file before the first line is written (a jump can
 * stand below its target); that walk tokenizes only the lines that can hold a reference.
 */
export function normalizeLines(
  lines: string[],
  cp: CompiledProfile,
  o: CompareOptions,
  machine?: SideMachine,
  over?: NormalizeOverrides,
): Normalized {
  const notes: Msg[] = [];
  if (nothingIgnored(o)) {
    const lineMap = new Int32Array(lines.length);
    for (let i = 0; i < lines.length; i++) lineMap[i] = i + 1;
    return { text: lines.join('\n'), lineMap, notes };
  }

  // The block numbers only matter when they are dropped; the walk is skipped otherwise.
  const kept: KeptNumbers = o.ignoreBlockNumbers ? keptNumbers(lines, cp) : { keep: new Set(), computedAt: 0 };
  if (kept.keep === 'all') notes.push({ key: COMPARE_NOTE_KEYS.blockNumbers, params: { line: kept.computedAt } });
  if (o.ignoreNumberFormat && pointUnsettled(cp.profile, machine)) {
    notes.push({ key: COMPARE_NOTE_KEYS.pointWithoutMachine });
  }
  const ctx = contextOf(cp, machine, kept, over);

  const out: string[] = [];
  const map: number[] = [];
  let state: LineState | undefined;
  for (let i = 0; i < lines.length; i++) {
    const { tokens, state: next } = tokenizeLine(lines[i], cp, state);
    state = next;
    const text = renderLine(lines[i], tokens, cp, o, ctx);
    if (text === null) continue;
    out.push(text);
    map.push(i + 1);
  }
  return { text: out.join('\n'), lineMap: Int32Array.from(map), notes };
}

// ---------------------------------------------------------------------------
// The unified diff
// ---------------------------------------------------------------------------

/** `@@` range: `start,count`, the count left out when it is 1 (as GNU diff writes it). */
function range(start: number, count: number): string {
  if (count === 1) return `${start + 1}`;
  // An empty range names the line in front of it.
  return `${count === 0 ? start : start + 1},${count}`;
}

/**
 * A unified diff (`--- a`, `+++ b`, `@@ -l,s +l,s @@` hunks, `context` lines around each,
 * default 3) on the P1 Myers diff of `core/transforms/lineDiff.ts`. Lines are compared
 * exactly; the caller passes normalized lines for a normalized export. No trailing newline
 * marker: the export goes into a new untitled document.
 *
 * The ranges are GNU diff's: a count of 1 is left out (`@@ -4 +4 @@`), an empty range names
 * the line in front of it (`-0,0`), and two hunks whose context touches are one.
 * Two sides with no difference give the empty string. The result has no newline after its
 * last line. A line that is in one side only at the very end (`''` after a final line
 * break) is an ordinary added or removed empty line. Past the Myers cap (2000 edits) the
 * rest of the two sides is one hunk: correct, not minimal.
 */
export function unifiedDiff(
  a: { name: string; lines: string[] },
  b: { name: string; lines: string[] },
  o?: { context?: number },
): string {
  const edits = diffLines(a.lines, b.lines);
  if (edits.length === 0) return '';
  const requested = o?.context;
  const context =
    typeof requested === 'number' && Number.isFinite(requested) && requested >= 0 ? Math.trunc(requested) : DEFAULT_CONTEXT;

  const out: string[] = [`--- ${a.name}`, `+++ ${b.name}`];
  // `shift` is how far the new side runs ahead of the old one before edit `i`.
  const shifts: number[] = [];
  let shift = 0;
  for (const edit of edits) {
    shifts.push(shift);
    shift += edit.newLines.length - (edit.oldEnd - edit.oldStart);
  }

  let first = 0;
  while (first < edits.length) {
    // Edits whose context would touch or overlap go into one hunk.
    let last = first;
    while (last + 1 < edits.length && edits[last + 1].oldStart - edits[last].oldEnd <= 2 * context) last++;

    const oldStart = Math.max(0, edits[first].oldStart - context);
    const oldEnd = Math.min(a.lines.length, edits[last].oldEnd + context);
    const newStart = oldStart + shifts[first];
    const body: string[] = [];
    let at = oldStart;
    for (let i = first; i <= last; i++) {
      const edit: LineEdit = edits[i];
      for (; at < edit.oldStart; at++) body.push(` ${a.lines[at]}`);
      for (; at < edit.oldEnd; at++) body.push(`-${a.lines[at]}`);
      for (const line of edit.newLines) body.push(`+${line}`);
    }
    for (; at < oldEnd; at++) body.push(` ${a.lines[at]}`);

    const lastShift = shifts[last] + edits[last].newLines.length - (edits[last].oldEnd - edits[last].oldStart);
    const newCount = oldEnd + lastShift - newStart;
    out.push(`@@ -${range(oldStart, oldEnd - oldStart)} +${range(newStart, newCount)} @@`, ...body);
    first = last + 1;
  }
  return out.join('\n');
}
