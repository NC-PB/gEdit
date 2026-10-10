// Block numbers a template names (P3b fix NC: review NC-01, NC-02, SK-02; plan §7 #253 ff.).
// Owner: the P3b NC fix batch (with `app/templateService.ts`, which calls it).
//
// A Fanuc lathe roughing cycle names its contour by block number (`G71 P100 Q200` /
// `N100 …` / `N200 …` / `G70 P100 Q200`), an Okuma LAP cycle by a sequence name (`NLAP1 G81`
// … `G85 NLAP1`). The manuals allow each such number or name once in a program (the lathe
// manual's restrictions of the multiple repetitive cycles; the Okuma sequence-name rules; the
// citations are in plan §7 #253): a second `N100` lets the cycle rough along whichever contour
// the control finds first. So:
//
//   1. **Which parameters are block numbers** (`blockNumberParams`), read from the body, so
//      a built-in template, a user's own and a draft "from selection" are treated alike:
//      a parameter written at a line start right after the profile's block-number address
//      (`N{{ns}}`, also behind a block-delete `/`), and a parameter written alone at a line
//      start that a line of the body names in a `numbering.references` rule (Okuma
//      `{{name}} G81` with `G85 {{name}}`). A `consecutive` profile (Klartext) has no
//      references to block numbers and none.
//   2. **What the program already uses** (`documentNumbers`): every block number (on a
//      control that compares sequence numbers as text, Okuma, every sequence name as written,
//      `N0100` ≠ `N100`) and every number a reference names, each with its first line. Read
//      once when the form opens and once more before the text is written.
//   3. **The values the form starts with** (`freeBlockValues`): a default that nothing uses
//      stays; otherwise the next free number above the program's highest one (a multiple of
//      the profile's step, distinct from the template's other block numbers and from the
//      numbers its own `{{N}}` writes, within the parameter's and the profile's maximum; when
//      that overflows, the lowest free one), or for a name the next free one of its kind
//      (`NLAP1` → `NLAP2`, at most four characters after `N`).
//   4. **What is refused** (`blockValueErrors`): a value a block of the program carries, one
//      a reference of the program names, one the template's own `{{N}}` writes, and one that
//      another block-number field of the same form has.
//   5. **What is only said** (`namedOwnNumbers`): a number the template writes with `{{N}}`
//      that a reference of the program names (SK-02). `{{N}}` continues the numbering by
//      design and the user cannot change it, so this is a note, not a refusal.

import type { Msg } from '$lib/app/types';
import { blockHeadReader, commentAt, commentEndAt, lexSpec, tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { comparesByText, labelsOf, referenceAddresses, referencesOn } from '$lib/core/transforms/references';
import type { TemplateDef, TemplateEnv } from './types';

/** A parameter that names a block: `number` (`N{{ns}}`, compared as the number) or `name` (`{{name}}`, the whole sequence name). */
export interface BlockParam {
  id: string;
  kind: 'number' | 'name';
}

/** Where a number or a name stands in the program (1-based line), and the reference word as written. */
export interface UsedSite {
  line: number;
  /** The reference as written (`P130`, `GOTO 70`), for a number that a reference names. */
  word?: string;
}

/** What the program uses, keyed as `keyOf` keys a value. */
export interface DocumentNumbers {
  blocks: Map<string, UsedSite>;
  referenced: Map<string, UsedSite>;
  /** The highest numeric block number, or null. */
  max: number | null;
  /** False when only the referenced numbers were read (`blocks` is empty and `max` null then). */
  withBlocks: boolean;
}

const PARAM = /\{\{([a-z_][a-z0-9_]*)\}\}/g;

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The block-number address of the profile (`N`), or null where a block number is a bare integer. */
function prefixOf(cp: CompiledProfile): string | null {
  const bn = cp.profile.syntax?.blockNumber;
  if (!bn || bn.mode === 'leading-integer') return null;
  return typeof bn.prefix === 'string' && bn.prefix !== '' ? bn.prefix : 'N';
}

/** The body line with every placeholder replaced by something a reference rule can be tested on. */
function probeLine(line: string): string {
  return line.replace(/\{\{N\}\}/g, 'N10 ').replace(PARAM, '1');
}

/** Rule 1: the parameters of `t` that name a block, in the template's parameter order. */
export function blockNumberParams(t: TemplateDef, cp: CompiledProfile): BlockParam[] {
  if (cp.profile.numbering?.mode === 'consecutive') return [];
  const prefix = prefixOf(cp);
  const lines = t.body.split(/\r\n?|\n/);
  const numbered = new Set<string>();
  const alone = new Set<string>();
  const head = prefix === null ? null : new RegExp(`^\\s*(?:/\\s*)?${escapeRe(prefix)}\\{\\{([a-z_][a-z0-9_]*)\\}\\}`, 'i');
  const bare = /^\s*(?:\/\s*)?\{\{([a-z_][a-z0-9_]*)\}\}(?=\s|$)/;
  for (const line of lines) {
    const n = head?.exec(line);
    if (n && n[1] !== 'N') numbered.add(n[1]);
    const a = bare.exec(line);
    if (a && a[1] !== 'N') alone.add(a[1]);
  }
  // A parameter alone at a line start names a block only where a reference of the body names it.
  const referenced = new Set<string>();
  if (alone.size > 0 && cp.re.references.length > 0) {
    for (const line of lines) {
      const probe = probeLine(line);
      if (!cp.re.references.some((rule) => rule.trigger.test(probe))) continue;
      for (const m of line.matchAll(PARAM)) if (alone.has(m[1])) referenced.add(m[1]);
    }
  }
  const byText = comparesByText(cp);
  const out: BlockParam[] = [];
  for (const p of t.params ?? []) {
    if (p.type === 'formula' || p.type === 'choice') continue;
    // `N{{id}}`: the digits after the address, compared as the dialect compares block numbers.
    if (numbered.has(p.id)) out.push({ id: p.id, kind: 'number' });
    else if (referenced.has(p.id)) out.push({ id: p.id, kind: p.type === 'integer' && !byText ? 'number' : 'name' });
  }
  return out;
}

/** True when `t` names blocks or writes `{{N}}`: the only templates that need the program's numbers. */
export function needsDocumentNumbers(t: TemplateDef, cp: CompiledProfile): boolean {
  if (cp.profile.numbering?.mode === 'consecutive') return false;
  return blockNumberParams(t, cp).length > 0 || (cp.re.references.length > 0 && t.body.includes('{{N}}'));
}

/** The key of a block-number value: the number (`'100'` for `0100`), or on a control that compares by text `N` + the digits as written. */
function numberKey(digits: string, byText: boolean): string | null {
  const n = digits.length;
  if (n < 1 || n > 9) return null;
  for (let i = 0; i < n; i++) {
    const code = digits.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return null;
  }
  // Without leading zeros the number's text is the digits themselves.
  if (byText || n === 1 || digits.charCodeAt(0) !== 0x30) return byText ? `N${digits}` : digits;
  return String(Number(digits));
}

/** The key of a value of `param` as typed, or null when it is no block number or name at all. */
export function keyOf(param: BlockParam, value: unknown, cp: CompiledProfile): string | null {
  const text = typeof value === 'number' && Number.isInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (text === '') return null;
  if (param.kind === 'name') return text.toUpperCase();
  return numberKey(text.replace(/^\+/, ''), comparesByText(cp));
}

function noteBlock(out: DocumentNumbers, digits: string, at: number, byText: boolean): void {
  const key = numberKey(digits, byText);
  if (key === null) return;
  if (!out.blocks.has(key)) out.blocks.set(key, { line: at });
  const n = Number(digits);
  if (out.max === null || n > out.max) out.max = n;
}

/** Okuma: a sequence name (`NLAP1`), where it names its block and where G85 names it. */
function noteName(out: DocumentNumbers, text: string, at: number): void {
  const name = text.trim().toUpperCase();
  if (/^N[A-Z0-9]+$/.test(name) && !out.blocks.has(name)) out.blocks.set(name, { line: at });
}

/** The tokenizer's reading of one line, taken into `out`. */
function noteTokens(out: DocumentNumbers, at: number, line: string, tokens: NcToken[], cp: CompiledProfile, byText: boolean, addresses: Set<string>, labels: ReadonlySet<string> | undefined, withBlocks = true): void {
  if (withBlocks) {
    for (const token of tokens) {
      if (token.kind === 'blockNumber' && token.valueText !== undefined) noteBlock(out, token.valueText, at, byText);
      else if (byText && token.kind === 'label' && typeof token.text === 'string') noteName(out, token.text, at);
    }
  }
  if (addresses.size === 0) return;
  for (const word of referencesOn(tokens, line, cp, addresses, labels)) {
    const key = numberKey(word.text, byText);
    if (key === null || out.referenced.has(key)) continue;
    const from = line.toUpperCase().lastIndexOf(word.address.toUpperCase(), word.start);
    out.referenced.set(key, { line: at, word: line.slice(from < 0 ? word.start : from, word.end).trim() });
  }
}

/**
 * Rule 2, the reference reading: every line through `tokenizeLine`. Kept as the definition of
 * what `documentNumbers` has to answer (`blockNumbers.test.ts` holds the two together) and
 * used for the lines and profiles the fast reading cannot vouch for.
 */
export function documentNumbersByTokens(lines: readonly string[], cp: CompiledProfile): DocumentNumbers {
  const out: DocumentNumbers = { blocks: new Map(), referenced: new Map(), max: null, withBlocks: true };
  if (cp.profile.numbering?.mode === 'consecutive') return out;
  const byText = comparesByText(cp);
  const addresses = referenceAddresses(cp);
  const labels = addresses.size > 0 ? labelsOf(lines, cp) : new Set<string>();
  let state: LineState | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = typeof lines[i] === 'string' ? lines[i] : '';
    const r = tokenizeLine(line, cp, state);
    state = r.state;
    noteTokens(out, i + 1, line, r.tokens, cp, byText, addresses, labels);
  }
  return out;
}

/** What tells the fast reading that a line holds nothing beyond its head: the words a line must contain to hold a reference or a sequence name. */
interface Gate {
  /** The first word of every address a reference rule names, or null when no rule names one. */
  references: RegExp | null;
  /** The block-number prefix followed by a letter, on a dialect whose sequence names stand anywhere (Okuma `GOTO NLAP1`), else null. */
  names: RegExp | null;
}

const GATES = new WeakMap<CompiledProfile, Gate | null>();

function gateOf(cp: CompiledProfile, addresses: Set<string>, byText: boolean): Gate | null {
  const known = GATES.get(cp);
  if (known !== undefined) return known;
  let gate: Gate | null = null;
  const words: string[] = [];
  for (const address of addresses) {
    const first = address.trim().split(/\s+/)[0] ?? '';
    if (first !== '') words.push(escapeRe(first));
  }
  const labelAfter = cp.profile.syntax?.labelAfter;
  const jumpLabels = Array.isArray(labelAfter) && labelAfter.length > 0;
  const bn = cp.profile.syntax?.blockNumber;
  const prefixes =
    bn && bn.mode !== 'leading-integer'
      ? [bn.prefix, ...(bn.altPrefixes ?? [])].filter((x): x is string => typeof x === 'string' && x !== '')
      : [];
  // An address that is no word (an empty one) or a label that a jump names on a dialect that
  // reads names as text: the tokenizer decides every line.
  if (words.length === addresses.size && !(byText && jumpLabels)) {
    gate = {
      references: words.length > 0 ? new RegExp(words.join('|'), `g${cp.flags}`) : null,
      names: byText && prefixes.length > 0 ? new RegExp(`(?:${prefixes.map(escapeRe).join('|')})[A-Za-z]`, `g${cp.flags}`) : null,
    };
  }
  GATES.set(cp, gate);
  return gate;
}

function holds(re: RegExp | null, line: string, from: number): boolean {
  if (re === null) return false;
  re.lastIndex = from;
  return re.test(line);
}

/** True when `re` finds a match that starts at or after `from` and ends at or before `limit`. */
function endsBefore(re: RegExp | null, line: string, from: number, limit: number): boolean {
  if (re === null) return false;
  re.lastIndex = from;
  return re.test(line) && re.lastIndex <= limit;
}

/**
 * The characters a block may hold in front of a comment marker for the tokenizer to reach the marker
 * as the start of a token: words and numbers (`G1 X-1.5 F0.2 `). Anything else (a bracket, a quote,
 * `=`, `*`, `$`, a name in angle brackets, a free-text rule) is a context in which the tokenizer
 * may read the marker's characters as something other than a comment, and the line is not trusted.
 */
const PLAIN_RUN = /[A-Za-z0-9 \t.+-]*/y;

/**
 * What the walk of `reaches` needs of a profile, or null where it cannot vouch for a comment at all:
 * markers that open with a non-alphanumeric character, no continuation mark, no free text rule. `runs`
 * finds a run of letters that the profile reads as text (`plainTextRun`), which swallows what follows.
 */
interface CommentWalk {
  spec: ReturnType<typeof lexSpec>;
  lead: RegExp;
  runs: RegExp | null;
}

const WALKS = new WeakMap<CompiledProfile, CommentWalk | null>();

function walkOf(cp: CompiledProfile): CommentWalk | null {
  const known = WALKS.get(cp);
  if (known !== undefined) return known;
  const spec = lexSpec(cp);
  const ok =
    spec.comments.length > 0 &&
    spec.continuation === null &&
    spec.freeText.length === 0 &&
    spec.maskLeadPattern !== null &&
    spec.comments.every((marker) => !/[A-Za-z0-9]/.test(marker.start.charAt(0)));
  const walk: CommentWalk | null = ok ? { spec, lead: spec.maskLeadPattern as RegExp, runs: spec.plainTextRun > 0 ? new RegExp(`[A-Za-z]{${spec.plainTextRun}}`, 'g') : null } : null;
  WALKS.set(cp, walk);
  return walk;
}

/**
 * True when the line holds a word of the gate at or after `from` that is not inside a comment.
 *
 * The raw line is tested first (one native scan, and nearly every line fails it). A line that
 * passes is walked from `from`: the text up to a comment marker has to be plain (`PLAIN_RUN`:
 * a block of words and numbers), the marker is found with the tokenizer's own rule (`commentAt`),
 * its end with the tokenizer's own `commentEndAt`, and a word of the gate in front of the marker
 * counts. A `P` or an `N` in `(CONTOUR)` or `; contour` does not send the line to the tokenizer. Anything
 * the walk cannot vouch for (a character that is not plain in front of a marker, a lead character that
 * starts no comment) counts as a word: the tokenizer decides the line, as before. A word that is only inside
 * a span the walk took for a comment is a comment word for the tokenizer too, so it names nothing
 * (the differential fuzzer of the review found that the mask of `mask.ts`, which also blanks
 * inside brackets and over a block-skip mark, is not that rule).
 */
function reaches(gate: Gate, line: string, from: number, cp: CompiledProfile): boolean {
  if (!holds(gate.references, line, from) && !holds(gate.names, line, from)) return false;
  const walk = walkOf(cp);
  if (walk === null) return true;
  const { spec, lead, runs } = walk;
  const limit = line.length;
  let pos = from;
  while (pos < limit) {
    lead.lastIndex = pos;
    if (!lead.test(line)) break;
    const at = lead.lastIndex - 1;
    PLAIN_RUN.lastIndex = pos;
    PLAIN_RUN.test(line);
    if (PLAIN_RUN.lastIndex < at) return true;
    // A run of letters the profile reads as text could swallow the marker.
    if (runs !== null) {
      runs.lastIndex = pos;
      if (runs.test(line) && runs.lastIndex <= at) return true;
    }
    const marker = commentAt(line, at, spec);
    if (marker === null) return true;
    // A word in front of the marker.
    if (at > pos && (endsBefore(gate.references, line, pos, at) || endsBefore(gate.names, line, pos, at))) return true;
    pos = Math.max(commentEndAt(line, at, limit, marker, spec), at + 1);
  }
  return pos < limit && (holds(gate.references, line, pos) || holds(gate.names, line, pos));
}

/**
 * Rule 2: the block numbers and referenced numbers of `lines` (the whole program; `lines[0]` is line 1).
 *
 * Tokenizing 300,000 lines took 0.3 to 0.5 s in the app, and the form opened on it and
 * the Insert each did it (plan known gap 23). A block number stands at the head of a line,
 * so `blockHeadOf` reads the head alone, and a reference or a sequence name away from the head
 * needs one of the words the profile's reference rules name (a `P`, a `GOTO`) or a prefix
 * and a letter in the rest of the line (a word inside a comment does not count, `reaches`): a line
 * without them is taken from its head, and any other line goes through the tokenizer as before. The answer is the one `documentNumbersByTokens`
 * gives.
 *
 * `withBlocks: false` leaves the block numbers out (`blocks` stays empty, `max` null,
 * `withBlocks` false in the answer) and gives the referenced numbers only: all a template that
 * has no block-number field needs to say that one of its own `{{N}}` is named by a `P`. A line
 * with none of the reference words anywhere is then passed over without reading its head.
 */
export function documentNumbers(lines: readonly string[], cp: CompiledProfile, withBlocks = true): DocumentNumbers {
  const out: DocumentNumbers = { blocks: new Map(), referenced: new Map(), max: null, withBlocks };
  if (cp.profile.numbering?.mode === 'consecutive') return out;
  const byText = comparesByText(cp);
  const addresses = referenceAddresses(cp);
  const gate = gateOf(cp, addresses, byText);
  if (gate === null) return { ...documentNumbersByTokens(lines, cp), withBlocks: true };
  const headOf = blockHeadReader(cp);
  // The head is read for every line when the block numbers are wanted and where a continuation mark carries the state.
  const everyHead = withBlocks || cp.re.continuation !== undefined;
  let labels: Set<string> | undefined;
  let continues = false;
  for (let i = 0; i < lines.length; i++) {
    const line = typeof lines[i] === 'string' ? lines[i] : '';
    // Before the head is read the line may start with a header or a block skip, so a comment marker is not trusted yet: the raw words decide.
    if (!everyHead && !holds(gate.references, line, 0) && !holds(gate.names, line, 0)) continue;
    const head = headOf(line, continues);
    if (reaches(gate, line, head.end, cp)) {
      if (labels === undefined) labels = addresses.size > 0 ? labelsOf(lines, cp) : new Set<string>();
      const r = tokenizeLine(line, cp, continues ? { continuation: true } : undefined);
      continues = r.state.continuation;
      noteTokens(out, i + 1, line, r.tokens, cp, byText, addresses, labels, withBlocks);
      continue;
    }
    continues = head.continues;
    if (!withBlocks) continue;
    if (head.number !== null) noteBlock(out, head.number, i + 1, byText);
    if (byText) for (const text of head.labels) noteName(out, text, i + 1);
  }
  return out;
}

/** The numbers the template's `{{N}}` writes at `env` (`count` of them), as the engine counts them out. */
export function ownNumbers(env: TemplateEnv, count: number): number[] {
  const numbering = env.cp.profile.numbering;
  if (!env.numbered || numbering?.mode === 'consecutive' || count <= 0) return [];
  const step = Math.max(1, Math.trunc(numbering?.step ?? 10));
  const start = Math.max(0, Math.trunc(numbering?.start ?? 10));
  const out: number[] = [];
  let next = env.prevBlockNumber === null ? start : env.prevBlockNumber + step;
  for (let i = 0; i < count; i++, next += step) out.push(next);
  return out;
}

/** How many `{{N}}` the body has: the most the template can write. */
export function numberPlaceholders(t: TemplateDef): number {
  return t.body.split('{{N}}').length - 1;
}

function taken(doc: DocumentNumbers, key: string): boolean {
  return doc.blocks.has(key) || doc.referenced.has(key);
}

/** Rule 3: the starting value of each block-number parameter, by id. */
export function freeBlockValues(t: TemplateDef, params: readonly BlockParam[], doc: DocumentNumbers, own: readonly number[], cp: CompiledProfile): Record<string, string> {
  const out: Record<string, string> = {};
  const byText = comparesByText(cp);
  const used = new Set<string>(own.map((n) => numberKey(String(n), byText) ?? ''));
  const numbering = cp.profile.numbering;
  const step = Math.max(1, Math.trunc(numbering?.step ?? 10));
  const profileMax = typeof numbering?.max === 'number' ? numbering.max : 99999;
  let top = Math.max(doc.max ?? 0, ...own);
  for (const bp of params) {
    const p = (t.params ?? []).find((x) => x.id === bp.id);
    if (!p) continue;
    const def = p.default === undefined ? '' : String(p.default);
    const defKey = keyOf(bp, def, cp);
    if (defKey !== null && !taken(doc, defKey) && !used.has(defKey)) {
      used.add(defKey);
      out[bp.id] = def;
      if (bp.kind === 'number') top = Math.max(top, Number(def));
      continue;
    }
    if (bp.kind === 'name') {
      const m = /^(.*?)(\d*)$/.exec(def.toUpperCase()) ?? ['', def.toUpperCase(), ''];
      const base = m[1] === '' ? 'N' : m[1];
      for (let n = m[2] === '' ? 1 : Number(m[2]) + 1; n < 10000; n++) {
        const name = `${base}${n}`;
        if (name.length > 5) break; // `N` and at most four characters
        if (!taken(doc, name) && !used.has(name)) {
          used.add(name);
          out[bp.id] = name;
          break;
        }
      }
      continue;
    }
    const limit = Math.min(typeof p.max === 'number' ? p.max : profileMax, profileMax);
    const lowest = Math.max(1, typeof p.min === 'number' ? Math.ceil(p.min) : 1);
    const free = (n: number): boolean => {
      const key = numberKey(String(n), byText);
      return key !== null && !taken(doc, key) && !used.has(key);
    };
    let pick: number | null = null;
    for (let n = (Math.floor(top / step) + 1) * step; n <= limit; n += step) {
      if (free(n)) {
        pick = n;
        break;
      }
    }
    if (pick === null) {
      for (let n = Math.ceil(lowest / step) * step; n <= limit && pick === null; n += step) if (free(n)) pick = n;
    }
    if (pick === null) continue; // nothing free: the default stays and is refused when it is used
    used.add(numberKey(String(pick), byText) ?? '');
    top = Math.max(top, pick);
    out[bp.id] = String(pick);
  }
  return out;
}

/** The block number as the profile writes it, for a message (`N100`). */
function written(bp: BlockParam, key: string, cp: CompiledProfile): string {
  if (bp.kind === 'name' || comparesByText(cp)) return key;
  return `${prefixOf(cp) ?? ''}${key}`;
}

/** Rule 4: why a typed block number or name cannot be taken, by parameter id. */
export function blockValueErrors(params: readonly BlockParam[], values: Record<string, unknown>, doc: DocumentNumbers, own: readonly number[], cp: CompiledProfile): Record<string, Msg> {
  const errors: Record<string, Msg> = {};
  const byText = comparesByText(cp);
  const mine = new Set(own.map((n) => numberKey(String(n), byText) ?? ''));
  const seen = new Map<string, string>();
  for (const bp of params) {
    const key = keyOf(bp, values[bp.id], cp);
    if (key === null) continue; // empty or not a number: the engine says so
    const number = written(bp, key, cp);
    const block = doc.blocks.get(key);
    const named = doc.referenced.get(key);
    if (block !== undefined) {
      errors[bp.id] = { key: bp.kind === 'name' ? 'templates.value.blockNameUsed' : 'templates.value.blockNumberUsed', params: { number, line: block.line } };
    } else if (named !== undefined) {
      errors[bp.id] = { key: 'templates.value.blockNumberNamed', params: { number, word: named.word ?? number, line: named.line } };
    } else if (bp.kind === 'number' && mine.has(key)) {
      errors[bp.id] = { key: 'templates.value.blockNumberOwn', params: { number } };
    } else if (seen.has(key) && seen.get(key) !== bp.id) {
      errors[bp.id] = { key: 'templates.value.blockNumberTwice', params: { number } };
    }
    if (!seen.has(key)) seen.set(key, bp.id);
  }
  return errors;
}

/** Rule 5: the numbers the template's `{{N}}` writes that a reference of the program names, with that reference. */
export function namedOwnNumbers(own: readonly number[], doc: DocumentNumbers, cp: CompiledProfile): { number: string; word: string; line: number }[] {
  const byText = comparesByText(cp);
  const out: { number: string; word: string; line: number }[] = [];
  for (const n of own) {
    const key = numberKey(String(n), byText);
    if (key === null) continue;
    const named = doc.referenced.get(key);
    if (named !== undefined) out.push({ number: `${prefixOf(cp) ?? ''}${byText ? key.slice(1) : key}`, word: named.word ?? String(n), line: named.line });
  }
  return out;
}
