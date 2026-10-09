// Hover text for one word (plan §5 WP3.6). Owner: WP3.6; the modal context: P3.3.
//
// Pure and Monaco-free: this module turns a line plus a cursor offset into the markdown
// of a hover, and `monaco/providers/hover.ts` puts it into a Monaco hover. Everything is
// unit-testable in node, which is where the rules below are pinned.
//
// Security (plan §3, rule 3): the hover is rendered with `isTrusted: false` and
// `supportHtml: false`, and every value that comes from a profile, a code database or the
// document is escaped here with `escapeMarkdown`, because a user database (P2) and the
// open file are untrusted content.
//
// What is shown (plan §5 WP3.6, `docs/planning/code-assistant.md` "Hover help"):
//
//   - a code: its label, its description and a line with its group and, when it is one,
//     `modal`; a code with required parameters also lists them;
//   - an address letter: its label and description (`X10.` → `X`, `X axis`);
//   - a variable (`#100`, `Q200`): its kind only. The value is unknown without
//     simulation, and the hover says so instead of guessing;
//   - a call (P8, `CYCLE83(…)`, `MSG("…")`): the cycle or function the database
//     describes, by its name. A subprogram the program calls by its own name is not a
//     code, and stays silent;
//   - an assignment word (P8, `M3=3`, `S3=2400`): shown as written, and read as the code
//     or the address it is — `M3=3` is `M3` for spindle 3, never a code `M33`;
//   - an assignment word the database does not describe, on a profile that lists the
//     control's own addresses (`syntax.extendedAddresses`, Okuma): when the word is not one
//     of them it is a local variable (`DIA1=50`, `ZL=-20`), and says so, instead of being
//     called a word the database "does not describe yet" — or, when its name is longer than
//     two letters, staying silent;
//   - a word the database does not describe: shown as such, never guessed. An entry that
//     still carries `verify: true` counts as "not described" — its label and description
//     stay out of hover until someone has confirmed them (content rule, §5 WP3.3);
//   - a code word the document's machine lists as a wait code (M12.5 decision 4, §7.16 #178:
//     `M198` in a machine's `M190-M199`): "Wait code on this machine (<machine>): <rule>",
//     instead of the database's meaning and its required words, which describe the
//     control's own use of the code and not this machine's. Only a plain `codes` list
//     answers (`ChannelService.waitCodeRule`); without a machine the database speaks;
//   - P3.3, with a `HoverContext` whose state after the block is known: a cycle word's
//     parameters with the values of the block, one context line for an address word, and the
//     value of a number that depends on the machine (the last section of this file).
//
// What stays silent, because saying "unknown" about it would be noise rather than help:
// comments, strings, operators, expressions, block skips, a bare value with no address
// (`TOOL CALL 5`), a many-lettered word that is a name and not a code
// (`BEGIN PGM TEST`), and `text` (M12.5, §7.16 #179: text the control keeps and shows but
// does not execute — a Klartext cycle name, a program name — which no word is read from).

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { parseNumber } from '$lib/core/nc/numbers';
import { readingsOf, valueOf } from '$lib/core/machines/numbers';
import { axisWordsOf, isAssignmentWord, lookupCode, lookupWord, normalizeCode } from './lookup';
import { inspectBlock, type InspectInput, type InspectView, type InspectedCycle } from './inspect';
import {
  blockEntries,
  feedUnitSource,
  inForceEntries,
  incrementalAxisOf,
  isAxisWord,
  isFeedWord,
  paramOf,
  readWord,
  unitsAfter,
  type WordReading,
} from './wordValue';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { LineState, ModalState, ModalValue, NcToken } from '$lib/core/nc/types';
import type { EffectiveMachine, ParamSource, ResolvedClass } from '$lib/core/machines/types';
import type { Translate } from '$lib/app/types';
import type { CodeDb, CodeEntry, CodeLookup, CodeParam } from './types';

/** The markdown of one hover and the range in the line it belongs to (UTF-16 offsets). */
export interface HoverInfo {
  markdown: string;
  start: number;
  end: number;
}

/** What `ChannelService.waitCodeRule` answers for a code word of the document's machine. */
export interface WaitCodeAnswer {
  ruleId: string;
  /** The rule's label (data, untranslated); `null` when the rule has none. */
  label: string | null;
  machineName: string | null;
  /** The rule's semantics (`rendezvous`, `count`, `ordered`); absent means a rendezvous. */
  semantics?: string;
}

/** Asks the document's machine whether `letter` + `value` is one of its wait codes. */
export type WaitCodeLookup = (letter: string, value: number) => WaitCodeAnswer | null;

/**
 * Phase 3 (P3a prelude; Phase 3 plan §6.5; P3.3 fills the text). What the hover needs to
 * explain a word **in context**: the cycle's parameters with the values of the block, one
 * context line for an address word (`X — target, diameter, absolute, work offset G54`), and
 * the effective value of a word whose reading depends on the machine, or every reading with
 * no machine. `monaco/providers/hover.ts` builds it from `modal.stateAfter` and
 * `machines.effective(docId)`.
 *
 * Absent (a diff side, a scratch model), or `after` null while the modal index has not
 * reached the block: the hover explains the word as it did in Phase 2, and says nothing about
 * the modal state rather than something stale.
 */
export interface HoverContext {
  /** The state after the line before the block (`stateAfter(first - 1)`): what the block changed. */
  before: ModalState | null;
  /**
   * The state after the block's last line, in which every word of the block is read: the
   * block's own codes are in force for it (`G91 X10.`, `G99 F.2`; Phase 3 AD-35).
   */
  after: ModalState | null;
  /** The document's effective profile and machine (AD-31), for the readings of a number. */
  profile: Profile;
  machine: EffectiveMachine;
  /**
   * The document around the hovered line. `first` and `last` are the block's lines (the
   * provider read the two states with them); `line` is the hovered line and `lineCount` the
   * document's, so the hover can read every line of a block that continues over several
   * (a Klartext cycle definition's parameters stand on its `~` lines), the block next to a
   * two-block cycle (`G76`), and the definition a cycle call runs. Absent: the block is the
   * hovered line alone. P3.3 added `line` and `lineCount` to the prelude's contract.
   */
  blockLines?: { first: number; last: number; line: number; lineCount: number; getLine(n: number): string };
}

export interface HoverOptions {
  /**
   * Address letters the database uses for numbered codes (`G`, `M`). A word with such an
   * address and no entry is an *unknown code* (`G12`), not an address; every other letter
   * falls back to its address help. `codeAddressesOf()` derives the set from a database.
   */
  codeAddresses?: ReadonlySet<string>;
  /**
   * `syntax.extendedAddresses` of the profile, anchored to the whole identifier (see
   * `extendedAddressesOf`). Present, an assignment word whose address the database does not
   * know and this pattern does not list is a local variable; absent, the profile has no such
   * list and the word is described as before.
   */
  extendedAddresses?: RegExp | null;
  /**
   * M12.5 (§7.16 #178): the document's machine's wait codes. Absent (no document, no machine)
   * or answering `null`, the database describes the word as before.
   */
  waitCode?: WaitCodeLookup;
  /** Phase 3 (P3.3): the modal context and the machine; see `HoverContext`. */
  context?: HoverContext;
}

/** Characters markdown would read as formatting. */
const MARKDOWN = /[\\`*_{}[\]()#+\-.!|<>~]/g;

/** An address letter written together with digits: `G83`, `M8`, `R0`. */
const NUMBERED_CODE = /^([A-Z])\d/;

/**
 * How many numbered codes a letter needs before a word with that address counts as a code
 * rather than as a value. Two keeps Klartext's single `R0` out of the set — `R+5` is a
 * radius, and calling it an unknown code would be wrong — while `G` and `M` are far above
 * it in both built-in databases.
 */
const MIN_NUMBERED_CODES = 2;

/** A word whose address is longer than this is a name (`BEGIN PGM TEST`), not a code. */
const MAX_ADDRESS_LENGTH = 2;

/** A Klartext parameter word, as the tokenizer writes it into a variable token. */
const Q_PARAMETER = /^Q[LRS]?\d+$/i;

/** Text that is safe inside markdown, whatever a profile or a database put in it. */
export function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN, '\\$&');
}

const EXTENDED = new WeakMap<CompiledProfile, RegExp | null>();

/**
 * The profile's `syntax.extendedAddresses` as a pattern for a whole identifier, or null when
 * it declares none (or one that does not compile; the profile validator reports that).
 */
export function extendedAddressesOf(cp: CompiledProfile): RegExp | null {
  const cached = EXTENDED.get(cp);
  if (cached !== undefined) return cached;
  const source = cp.profile.syntax?.extendedAddresses;
  let re: RegExp | null = null;
  if (typeof source === 'string' && source !== '') {
    try {
      re = new RegExp(`^(?:${source})$`, cp.flags);
    } catch {
      re = null;
    }
  }
  EXTENDED.set(cp, re);
  return re;
}

const CODE_ADDRESSES = new WeakMap<CodeDb, ReadonlySet<string>>();

/**
 * The address letters `db` describes numbered codes for, cached against the database.
 *
 * Fanuc answers `G` and `M`, Klartext `M`. It is what tells `G12` (an unknown code) from
 * `X12` (an X position the database has nothing more to say about).
 */
export function codeAddressesOf(db: CodeDb): ReadonlySet<string> {
  const cached = CODE_ADDRESSES.get(db);
  if (cached) return cached;

  const counts = new Map<string, number>();
  for (const entry of db.codes) {
    const match = NUMBERED_CODE.exec(normalizeCode(entry.code));
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  const letters = new Set<string>();
  for (const [letter, count] of counts) if (count >= MIN_NUMBERED_CODES) letters.add(letter);
  CODE_ADDRESSES.set(db, letters);
  return letters;
}

/** The token at `offset`, or null past the end of the line. Tokens cover the line. */
function tokenAt(tokens: NcToken[], offset: number): number {
  for (let i = 0; i < tokens.length; i++) {
    if (offset >= tokens[i].start && offset < tokens[i].end) return i;
  }
  return -1;
}

/** The next token that is not whitespace, in `step` direction. */
function contentNeighbour(tokens: NcToken[], from: number, step: 1 | -1): NcToken | null {
  for (let i = from + step; i >= 0 && i < tokens.length; i += step) {
    if (tokens[i].kind !== 'whitespace') return tokens[i];
  }
  return null;
}

/**
 * The digits of a word that carries nothing else: the `200` of `CYCL DEF 200`, or the `19.1`
 * of the sub-block `CYCL DEF 19.1` (M9: real Klartext programs write the sub-blocks of the
 * older cycles with a decimal part).
 */
function bareNumberOf(token: NcToken | null): string | null {
  if (!token || token.kind !== 'word' || token.address !== undefined) return null;
  return /^\d+(?:\.\d+)?$/.test(token.text) ? token.text : null;
}

/**
 * A keyword and the number behind it, as one token, when the database knows the pair.
 *
 * Klartext writes its cycles that way (`CYCL DEF 200`), and the tokenizer hands the
 * keyword and the number over separately, so hovering either half has to find the cycle.
 * The join only happens when the joined form really is in the database, so `LBL 1` still
 * describes `LBL` and a number that just follows a keyword stays a number.
 */
function joinWithNumber(tokens: NcToken[], index: number, line: string, db: CodeDb): NcToken | null {
  const token = tokens[index];
  const keyword = token.kind === 'keyword' ? token : contentNeighbour(tokens, index, -1);
  const number = token.kind === 'keyword' ? contentNeighbour(tokens, index, 1) : token;
  if (!keyword || keyword.kind !== 'keyword') return null;

  const digits = bareNumberOf(number);
  if (digits === null || !number) return null;
  if (number.start < keyword.end) return null;

  const name = keyword.address ?? keyword.text;
  let code = `${name} ${digits}`;
  if (!lookupCode(db, code)) {
    // A sub-block (`CYCL DEF 19.1`) is described by its cycle (`CYCL DEF 19`), when the
    // database has no entry for the sub-block itself.
    const whole = /^(\d+)\.\d+$/.exec(digits)?.[1];
    if (whole === undefined) return null;
    code = `${name} ${whole}`;
    if (!lookupCode(db, code)) return null;
  }
  return {
    kind: 'keyword',
    start: keyword.start,
    end: number.end,
    text: line.slice(keyword.start, number.end),
    address: code,
  };
}

/**
 * The token a hover at `offset` describes, with a Klartext cycle joined into one token.
 *
 * `offset` is a UTF-16 offset into `line` (Monaco's `column - 1`).
 */
export function hoverTarget(
  line: string,
  offset: number,
  cp: CompiledProfile,
  db: CodeDb,
  prev?: LineState,
): NcToken | null {
  const { tokens } = tokenizeLine(line, cp, prev);
  const index = tokenAt(tokens, offset);
  if (index < 0 || tokens[index].kind === 'whitespace') return null;
  return joinWithNumber(tokens, index, line, db) ?? tokens[index];
}

/** Kinds `lookupWord` says nothing about, although the database describes their address. */
const ASK_AS_WORD = new Set<NcToken['kind']>(['variable', 'blockNumber', 'programMarker']);

/**
 * What the database knows about `token`.
 *
 * `lookupWord` answers only about words and keywords, because that is what a *code*
 * database is about. Three other kinds still carry an address it describes — a variable
 * (`Q200` → the `Q` parameter class), a block number (`N10` → `N`) and a program number
 * (`O1234` → `O`) — so those are asked about as if they were words. A variable has no
 * address of its own, and its text is the class the lookup then matches.
 */
function lookupFor(db: CodeDb, token: NcToken): CodeLookup | null {
  if (!ASK_AS_WORD.has(token.kind)) return lookupWord(db, token);
  return lookupWord(db, { ...token, kind: 'word', address: token.address ?? token.text.toUpperCase() });
}

/** The whole hover for a position in a line, or null when there is nothing to say. */
export function hoverAt(
  line: string,
  offset: number,
  cp: CompiledProfile,
  db: CodeDb,
  t: Translate,
  prev?: LineState,
  o: Pick<HoverOptions, 'waitCode' | 'context'> = {},
): HoverInfo | null {
  const token = hoverTarget(line, offset, cp, db, prev);
  if (!token) return null;
  const lookup = lookupFor(db, token);
  const o2: HoverOptions = {
    codeAddresses: codeAddressesOf(db),
    extendedAddresses: extendedAddressesOf(cp),
    waitCode: o.waitCode,
  };
  const markdown = hoverText(token, lookup, t, o2);
  if (markdown === null) return null;
  // M12.5: a wait code of the machine says what the machine says, and nothing more.
  const context = o.context && !answersAsWaitCode(token, o2) ? contextParagraphs(token, line, cp, db, t, o.context) : [];
  return { markdown: paragraphs([markdown, ...context]), start: token.start, end: token.end };
}

/** The machine's wait list answers for this word (the hover then shows the wait, not the database). */
function answersAsWaitCode(token: NcToken, o: HoverOptions): boolean {
  if (token.kind !== 'word' || !o.waitCode) return false;
  const wait = waitCodeWord(token);
  return wait !== null && o.waitCode(wait.letter, wait.value) !== null;
}

// ---------------------------------------------------------------------------
// The markdown
// ---------------------------------------------------------------------------

/** `**title** — subtitle`, both escaped; the subtitle is left out when there is none. */
function heading(title: string, subtitle?: string): string {
  const head = `**${escapeMarkdown(title)}**`;
  return subtitle ? `${head} — ${escapeMarkdown(subtitle)}` : head;
}

/** Paragraphs, blank ones dropped. */
function paragraphs(parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => !!part).join('\n\n');
}

/** The group name in English, or the raw id when the catalog has no message for it. */
function groupLabel(group: string, t: Translate): string {
  const key = `assistant.group.${group}`;
  const label = t(key);
  return label === key ? group : label;
}

/** `_Cycle · modal_`, or null for an entry with neither. */
function groupLine(entry: CodeEntry, t: Translate): string | null {
  const parts: string[] = [];
  if (entry.group) parts.push(escapeMarkdown(groupLabel(entry.group, t)));
  if (entry.modal) parts.push(escapeMarkdown(t('assistant.hover.modal')));
  return parts.length === 0 ? null : `_${parts.join(' · ')}_`;
}

/** `Required: Z, R, Q, F`, or null when the code has no required parameter. */
function requiredLine(entry: CodeEntry, t: Translate): string | null {
  const required = (entry.params ?? []).filter((param) => param.required).map((param) => param.address);
  if (required.length === 0) return null;
  return escapeMarkdown(t('assistant.hover.required', { list: required.join(', ') }));
}

/** A code the database describes: label, description, group and required parameters. */
function codeHover(display: string, entry: CodeEntry, t: Translate): string {
  return paragraphs([
    heading(display, entry.label),
    entry.description ? escapeMarkdown(entry.description) : null,
    entry.pitchFeed ? escapeMarkdown(t('assistant.hover.pitchFeed')) : null,
    groupLine(entry, t),
    requiredLine(entry, t),
  ]);
}

/** An address letter: what it means in this dialect. */
function addressHover(address: NonNullable<CodeLookup['address']>, t: Translate, incremental?: boolean): string {
  return paragraphs([
    heading(address.letter, address.label),
    address.description ? escapeMarkdown(address.description) : null,
    incremental ? escapeMarkdown(t('assistant.hover.incremental')) : null,
  ]);
}

/** A word the database does not describe, with the address as context when it knows it. */
function unknownHover(display: string, t: Translate, address?: CodeLookup['address']): string {
  return paragraphs([
    heading(display),
    escapeMarkdown(t('assistant.hover.unknown')),
    address ? `_${escapeMarkdown(`${address.letter} — ${address.label}`)}_` : null,
  ]);
}

/** A variable: its kind, and the reminder that the editor does not know its value. */
function variableHover(token: NcToken, lookup: CodeLookup | null, t: Translate): string {
  const kind = lookup?.address;
  const isParameter = kind !== undefined && Q_PARAMETER.test(token.text);
  return paragraphs([
    heading(token.text, isParameter ? kind.label : t('assistant.hover.variable')),
    isParameter && kind.description ? escapeMarkdown(kind.description) : null,
    escapeMarkdown(t('assistant.hover.variableValue')),
  ]);
}

/** A local variable the program sets with `=` (`DIA1=50`): its kind, and that only the control knows the value. */
function localVariableHover(name: string, t: Translate): string {
  return paragraphs([heading(name, t('assistant.hover.variable')), escapeMarkdown(t('assistant.hover.variableValue'))]);
}

/**
 * The code as the database spells it: the canonical address plus the value as written.
 * An assignment keeps its `=` (`M3=3`, `S3=2400`), because without it the address and
 * the value would read as one code that does not exist. An indexed one keeps its bracket
 * (`M[2]=3`, `FA[X]=100`), which is what says whose word it is.
 */
function wordDisplay(token: NcToken): string {
  const gap = isAssignmentWord(token) ? '=' : '';
  const index = token.index !== undefined ? `[${token.index}]` : '';
  return `${token.address ?? ''}${index}${gap}${token.valueText ?? ''}`;
}

/**
 * A code word the machine's wait list could name: one address letter, a whole number written
 * without sign or point (`M198`, `M0198`), no assignment and no index. `M198.` and `M2=198`
 * are other words, as they are to the wait-code reader (`waitCodeWordRe`).
 */
function waitCodeWord(token: NcToken): { letter: string; value: number } | null {
  const v = token.value;
  if (token.address === undefined || !/^[A-Za-z]$/.test(token.address)) return null;
  if (isAssignmentWord(token) || token.index !== undefined) return null;
  if (!v || v.sign !== '' || v.hasPoint || !/^\d+$/.test(v.intPart)) return null;
  return { letter: token.address.toUpperCase(), value: Number(v.intPart) };
}

/**
 * A wait code of the document's machine: what the machine says, not the database. The
 * database's meaning and its required words are left out (they describe the control's own
 * use of the code); `hasEntry` adds the note that says so, when the database has one.
 */
function waitCodeHover(display: string, answer: WaitCodeAnswer, hasEntry: boolean, t: Translate): string {
  const machine = answer.machineName ?? '';
  // An `ordered` rule (an order number such as `P1-P9999`) is not a wait: it names the
  // place in a sequence, so the hover says "sync code", not "wait code".
  const sync = answer.semantics === 'ordered' ? 'Sync' : '';
  const line = answer.label
    ? t(`assistant.hover.${sync ? 'syncCode' : 'waitCode'}`, { machine, rule: answer.label })
    : t(`assistant.hover.${sync ? 'syncCodeNoLabel' : 'waitCodeNoLabel'}`, { machine });
  return paragraphs([heading(display), escapeMarkdown(line), hasEntry ? `_${escapeMarkdown(t(sync ? 'assistant.hover.syncCodeNote' : 'assistant.hover.waitCodeNote'))}_` : null]);
}

/** True for a value that could be the number of a code: `83`, not `+5` and not `#101`. */
function looksLikeCodeNumber(token: NcToken): boolean {
  return token.valueText !== undefined && token.value !== null && token.value !== undefined && token.value.sign === '';
}

/**
 * The markdown for one token, or null when there is nothing to say.
 *
 * `lookup` is what the database answered for the token (`lookupWord`, or the variable
 * form of it); `null` counts as "the database has nothing".
 */
export function hoverText(
  token: NcToken,
  lookup: CodeLookup | null,
  t: Translate,
  o: HoverOptions = {},
): string | null {
  const entry = lookup?.entry ?? null;
  const described = entry && entry.verify !== true ? entry : null;

  switch (token.kind) {
    case 'variable':
      return variableHover(token, lookup, t);

    case 'blockNumber':
    case 'programMarker':
      // `N10` and `O1234` carry an address letter the database describes; `%` and a
      // Klartext leading-integer block number carry none, and stay silent.
      return lookup?.address ? addressHover(lookup.address, t) : null;

    case 'keyword': {
      const display = token.address ?? token.text;
      return described ? codeHover(display, described, t) : unknownHover(display, t);
    }

    case 'call': {
      // A cycle or a function the database has an entry for; a subprogram the program
      // calls by its own name (`PROBE_DIA(1,,3)`) is not a code of the dialect.
      const display = token.address ?? token.text;
      if (described) return codeHover(display, described, t);
      return entry ? unknownHover(display, t) : null;
    }

    case 'word': {
      if (token.address === undefined) return null; // a bare value: `TOOL CALL 5`
      const display = wordDisplay(token);
      // M12.5 decision 4: the machine's wait codes win over the database.
      const wait = o.waitCode ? waitCodeWord(token) : null;
      const answer = wait && o.waitCode ? o.waitCode(wait.letter, wait.value) : null;
      if (answer) return waitCodeHover(display, answer, entry !== null, t);
      if (described) return codeHover(display, described, t);
      const address = lookup?.address;
      if (entry) return unknownHover(display, t, address); // an unverified entry
      if (address) {
        const isCode = o.codeAddresses?.has(address.letter) === true && looksLikeCodeNumber(token);
        return isCode ? unknownHover(display, t, address) : addressHover(address, t, token.incremental);
      }
      // Nothing is known about the address. Where the profile lists the control's own
      // addresses, a name in front of `=` that is none of them is the program's own variable.
      if (o.extendedAddresses && isAssignmentWord(token) && !o.extendedAddresses.test(token.address)) {
        return localVariableHover(token.address, t);
      }
      return token.address.length <= MAX_ADDRESS_LENGTH ? unknownHover(display, t) : null;
    }

    case 'text':
      // M12.5 (§7.16 #179): text the control shows but does not execute says nothing.
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// P3.3: the modal context (Phase 3 plan §6.5, X14)
// ---------------------------------------------------------------------------
//
// With a `HoverContext` whose `after` state is known, the Phase 2 hover gains:
//
//   - on a cycle word (`G83`, `G76`, `CYCL DEF 200`, `CYCLE83(…)`, and the call of a defined
//     cycle, `CYCL CALL`): a table of the cycle's parameters with what the block writes for
//     each (`inspect.ts` finds the cycle and its values: the lines of a Klartext definition,
//     a call's arguments by position, which of the two blocks of a lathe `G76` this is);
//   - on an address word, one context line: `X — target, diameter, absolute (G90), work
//     offset G54`; `U — incremental X`; `F — feed per revolution (G99)`; `F — thread lead
//     (G76)`; `S — surface speed (G96), clamp 2500 rpm (line 11)`; a cycle parameter by its
//     meaning (`R — Retract plane (G83)`). A mode the program never set is marked with the
//     source of the assumption (`G99, assumed: profile default`);
//   - where the value depends on the machine: the effective value and why
//     (`X50 — 0.05 mm: no decimal point, increments of 0.001 mm (machine 'Lathe 2')`), or,
//     with no machine, every reading instead of one value, the profile default first.
//
// Every word is read by `wordValue.ts` `readWord` in the state after its block (AD-35), the
// reading the inspector shows, so the two can never disagree. With no context, or `after`
// null (the modal index has not reached the line), nothing is added: the Phase 2 hover,
// never something stale. All of it is data and escaped like the rest of the hover.

/** `assistant.context.<key>`. */
function say(t: Translate, key: string, params?: Record<string, string | number>): string {
  return t(`assistant.context.${key}`, params);
}

/** The tokens of lines `first`…`last`, the tokenizer's state carried from line to line. */
function tokensOf(input: InspectInput, cp: CompiledProfile, first: number, last: number): NcToken[] {
  const out: NcToken[] = [];
  let state: LineState | undefined;
  for (let n = first; n <= last; n++) {
    const text = input.getLine(n);
    const result = tokenizeLine(typeof text === 'string' ? text : '', cp, state);
    state = result.state;
    for (const token of result.tokens) out.push(token);
  }
  return out;
}

/** The code entry a code token names: a code word, a keyword (joined with its number), a call. */
function entryOfToken(token: NcToken, db: CodeDb): CodeEntry | null {
  if (token.kind === 'keyword' || token.kind === 'call') return lookupCode(db, token.address ?? token.text);
  if (token.kind === 'word' && token.address !== undefined && token.valueText !== undefined && !isAssignmentWord(token)) {
    return lookupCode(db, token.address + token.valueText);
  }
  return null;
}

/**
 * Whether hovering this code shows the cycle's table: the cycle's own code, or — for a call of
 * a defined cycle (`CYCL CALL`, `M99`) — the code that calls it. A call is only answered when
 * the hover can read the document, where the definition stands.
 */
function showsCycle(entry: CodeEntry | null, cycle: InspectedCycle, db: CodeDb, document: boolean): boolean {
  if (!entry) return false;
  if (cycle.role === 'calls') {
    const role = entry.sets?.cycle;
    return document && (role === 'call' || role === 'call-modal');
  }
  return lookupCode(db, cycle.code) === entry;
}

/** Text for a table cell: escaped, on one line. */
function cell(text: string): string {
  return escapeMarkdown(text.replace(/\s+/g, ' ').trim());
}

/** The heading and the table of a cycle's parameters, or null for a cycle that declares none. */
function cycleTable(cycle: InspectedCycle, t: Translate): string | null {
  if (cycle.params.length === 0) return null;
  let title =
    cycle.role === 'calls'
      ? say(t, 'table.calls', { code: cycle.code, line: cycle.line })
      : say(t, 'table.title', { code: cycle.code });
  if (cycle.part) title = say(t, 'table.withPart', { title, part: say(t, 'table.part', { index: cycle.part.index, of: cycle.part.of }) });
  const notWritten = `_${escapeMarkdown(say(t, 'table.notWritten'))}_`;
  const rows = cycle.params.map(
    ({ param, written }) =>
      `| ${cell(param.address)} | ${cell(param.label ?? '')} | ${written === null ? notWritten : cell(written)} |`,
  );
  const head = `| ${cell(say(t, 'table.word'))} | ${cell(say(t, 'table.meaning'))} | ${cell(say(t, 'table.written'))} |`;
  return paragraphs([`**${escapeMarkdown(title)}**`, [head, '| --- | --- | --- |', ...rows].join('\n')]);
}

/** The address as the block writes it, without its value: `X`, `U`, `IX`, `Q200`, `S1`. */
function displayAddress(token: NcToken): string {
  const value = token.valueText ?? '';
  const text = token.text;
  if (value !== '' && text.endsWith(value)) {
    const head = text.slice(0, text.length - value.length).replace(/[\s=]+$/, '');
    if (head !== '') return head;
  }
  return token.address ?? text;
}

/** The modal group whose code in force sets `member` (`feedUnit`, `speedUnit`), or null. */
function settingCode(after: ModalState, db: CodeDb, member: 'feedUnit' | 'speedUnit'): ModalValue | null {
  for (const value of Object.values(after.groups)) {
    if (!value || typeof value.code !== 'string') continue;
    if (lookupCode(db, value.code)?.sets?.[member] !== undefined) return value;
  }
  return null;
}

/** `assumed: profile default`. */
function assumedText(t: Translate, from: ParamSource | undefined): string {
  return say(t, 'assumed', { source: say(t, `source.${from ?? 'profile'}`) });
}

/** `feed per revolution (G99)`, `absolute (G90, assumed: profile default)`, or `what` alone. */
function withCode(t: Translate, what: string, value: ModalValue | null | undefined): string {
  if (!value) return what;
  const code = value.assumed ? `${value.code}, ${assumedText(t, value.from)}` : value.code;
  return say(t, 'withCode', { what, code });
}

const FEED_KEY: Partial<Record<NonNullable<ResolvedClass>, string>> = {
  feedPerMin: 'feedPerMinute',
  feedPerRev: 'feedPerRev',
  feedPerTooth: 'feedPerTooth',
  inverseTime: 'inverseTime',
};

/** The parameter `address` is of among `entries`, with the entry that declares it. */
function paramOwner(address: string, entries: readonly (CodeEntry | null)[]): { param: CodeParam; entry: CodeEntry } | null {
  for (const entry of entries) {
    const param = paramOf(entry, address);
    if (entry && param) return { param, entry };
  }
  return null;
}

interface LineInputs {
  token: NcToken;
  reading: WordReading;
  after: ModalState;
  view: InspectView;
  blockCodes: readonly CodeEntry[];
  /** The block's cycle, when the word is one of its parameters. */
  cycleEntry: CodeEntry | null;
}

function feedPart(x: LineInputs, address: string, t: Translate): string | null {
  const { reading, after, view, blockCodes } = x;
  const inForce = inForceEntries(after, blockCodes, view.db);
  if (reading.lead) {
    const code = [...blockCodes, ...inForce].find((e) => e.pitchFeed === true && paramOf(e, address)?.unit === 'feedPerRev')?.code ?? '';
    return say(t, 'lead', { code });
  }
  if (reading.cls === 'dwell') {
    const code = blockCodes.find((e) => e.fNotFeed === true || paramOf(e, address)?.unit === 'dwell')?.code ?? '';
    return say(t, 'dwell', { code });
  }
  if (reading.cls === null) {
    return after.pitchFeedAmbiguous ? say(t, 'ambiguousFeed', { code: after.pitchFeedAmbiguous }) : say(t, 'feedUnknown');
  }
  const key = FEED_KEY[reading.cls];
  if (!key) return null;
  // A feed word that carries its own unit (Klartext `FU`, `FZ`) is set by nothing else; the
  // code named is the one that gave this class (`wordValue.ts` `feedUnitSource`), never a
  // feed-unit code that says the opposite (Okuma `G101 … F` under `G95`).
  const unitWord = Object.keys(view.profile.addresses?.feedUnitWords ?? {}).some((w) => w.toUpperCase() === address);
  return withCode(t, say(t, key), unitWord ? null : feedUnitSource(after, view.db, reading.cls, address, blockCodes, 0));
}

function speedParts(x: LineInputs, t: Translate): string[] {
  const { after, view, blockCodes } = x;
  if (after.block.speedLimit) {
    const code = blockCodes.find((e) => e.sets?.speedLimit === true)?.code;
    return [code ? say(t, 'speedLimitBy', { code }) : say(t, 'speedLimit')];
  }
  if (after.speedUnit !== 'surface' && after.speedUnit !== 'rpm') return [];
  const parts = [withCode(t, say(t, after.speedUnit === 'surface' ? 'surfaceSpeed' : 'rpm'), settingCode(after, view.db, 'speedUnit'))];
  if (after.speedUnit === 'surface' && after.speedLimit) {
    parts.push(say(t, 'clamp', { value: after.speedLimit.valueText, line: after.speedLimit.line }));
  }
  return parts;
}

function diameterPart(x: LineInputs, t: Translate): string | null {
  const { reading, after, view } = x;
  if (reading.diameter === null || (reading.cls !== null && reading.cls !== 'length')) return null;
  // On a milling profile a radius is the ordinary reading; only diameter programming (a
  // mill-turn program that switches it on) is worth a word.
  if (reading.diameter === 'radius' && view.profile.machineType === 'mill') return null;
  const what = say(t, reading.diameter === 'diameter' ? 'diameter' : reading.diameter === 'radius' ? 'radius' : 'diameterUnknown');
  return after.diameter?.assumed ? say(t, 'withCode', { what, code: assumedText(t, after.diameter.from) }) : what;
}

function axisParts(x: LineInputs, address: string, t: Translate): string[] {
  const { token, reading, after, view, blockCodes, cycleEntry } = x;
  const parts: string[] = [];
  const push = (part: string | null): void => {
    if (part) parts.push(part);
  };
  let what: 'data' | 'machine' | null = null;
  let whatEntry: CodeEntry | null = null;
  for (const entry of blockCodes) {
    const kind = axisWordsOf(entry);
    if (kind !== null) {
      what = kind;
      whatEntry = entry;
      break;
    }
  }
  if (what === 'data' && whatEntry) {
    // `G50 X100.`, `G4 X2.`: a value for the code, not a place the tool goes to.
    const param = paramOf(whatEntry, address);
    push(param ? say(t, 'param', { label: param.label, code: whatEntry.code }) : say(t, 'data', { code: whatEntry.code }));
    push(diameterPart(x, t));
    return parts;
  }
  const twin = incrementalAxisOf(view.profile, address);
  const cycleParam = cycleEntry ? paramOf(cycleEntry, address) : null;
  // `G28`, `G30`: the axis words are the intermediate point, in the program's coordinates,
  // absolute or incremental (the code declares them); `G53` alone is machine coordinates.
  const via = what === 'machine' && whatEntry ? paramOf(whatEntry, address) : null;
  if (via && whatEntry) push(say(t, 'param', { label: via.label, code: whatEntry.code }));
  if (twin !== null) push(say(t, 'incrementalOf', { axis: twin }));
  else if (!via) {
    if (cycleParam && cycleEntry) push(say(t, 'param', { label: cycleParam.label, code: cycleEntry.code }));
    else if (what === 'machine' && whatEntry) push(say(t, 'machineCoordinates', { code: whatEntry.code }));
    else push(say(t, 'target'));
  }
  const target = twin === null && !cycleParam && what !== 'machine';
  push(diameterPart(x, t));
  if (what === 'machine' && !via) return parts;
  if (twin === null) {
    if (reading.incremental) {
      // `G91 X10.` names the code; a Klartext `IX` is incremental by its own prefix.
      push(withCode(t, say(t, 'incremental'), token.incremental === true ? null : after.groups.distance));
    } else if (after.distance === 'absolute') {
      push(withCode(t, say(t, 'absolute'), after.groups.distance));
    }
  }
  const offset = after.groups.offset;
  if (offset) push(offset.assumed ? say(t, 'withCode', { what: say(t, 'workOffset', { code: offset.code }), code: assumedText(t, offset.from) }) : say(t, 'workOffset', { code: offset.code }));
  if (after.frame) push(say(t, 'frame', { code: after.frame.code, line: after.frame.line }));
  // A position under a modal cycle (`G81` until `G80`, `MCALL`, `M89`): the cycle it runs with.
  // A threading move in force (`G33`) is another pass, not a cycle.
  if (target && after.activeCycle) {
    const move = lookupCode(view.db, after.activeCycle.code)?.group === 'motion';
    push(say(t, move ? 'threadInForce' : 'cycleInForce', { code: after.activeCycle.code, line: after.activeCycle.line }));
  }
  return parts;
}

/** The one context line of an address word, or null when there is nothing to say about it. */
function contextLine(x: LineInputs, t: Translate): string | null {
  const { token, view, blockCodes, after, cycleEntry } = x;
  const profile = view.profile;
  const address = (token.address ?? '').toUpperCase();
  if (address === '') return null;
  const base = address.replace(/\d+$/, '');
  const spindle = (profile.addresses?.spindle ?? '').toUpperCase();
  const limitWords = (profile.addresses?.speedLimitWords ?? []).map((w) => w.toUpperCase());

  let parts: string[] = [];
  if (isFeedWord(profile, address)) {
    const part = feedPart(x, address, t);
    if (part) parts.push(part);
  } else if (spindle !== '' && base === spindle && (address === base || isAssignmentWord(token))) {
    parts = speedParts(x, t);
  } else if (limitWords.includes(address)) {
    parts.push(say(t, 'speedLimit'));
  } else if (isAxisWord(profile, address)) {
    parts = axisParts(x, address, t);
  } else {
    const owner = paramOwner(address, [cycleEntry, ...blockCodes, ...inForceEntries(after, blockCodes, view.db)]);
    if (owner) parts.push(say(t, 'param', { label: owner.param.label, code: owner.entry.code }));
  }
  if (parts.length === 0) return null;
  return escapeMarkdown(say(t, 'line', { address: displayAddress(token), parts: parts.join(', ') }));
}

/** What one written "1" is worth on the machine, or null where it is 1 (`inspect.ts` `stepOf`). */
function stepOf(cls: ResolvedClass, machine: EffectiveMachine, units: 'mm' | 'inch', withPoint: boolean): string | null {
  if (cls === null || cls === 'count') return null;
  const one = parseNumber(withPoint ? '1.' : '1');
  if (!one) return null;
  const value = valueOf(one, cls, machine.params, units);
  return value !== null && value !== '1' ? value : null;
}

/** A preset's name: its label up to the colon (`Increments of 0.001 mm (IS-B)`), else its id. */
function presetName(label: string, id: string): string {
  const head = label.split(':')[0].trim();
  return head !== '' ? head : id;
}

/**
 * The value of a word whose reading depends on the machine: the effective value and why, under
 * the document's machine; every reading, the profile default first, with none. Null where
 * every machine reads the word alike (`X50.` on a Fanuc control) or the word has no class.
 */
function valueParagraph(x: LineInputs, t: Translate): string | null {
  const { token, reading, view, after } = x;
  const literal = token.value;
  if (!literal || reading.cls === null || reading.cls === 'count') return null;
  const word = token.text.trim();
  const unit = reading.unit ?? '';
  const machine = view.machine;

  if (reading.readings.length > 0) {
    const head =
      machine.id !== null
        ? say(t, 'value.readingsUnset', { word, name: machine.name ?? '' })
        : say(t, 'value.readings', { word });
    const items = reading.readings.map((r, i) => {
      // A value in least increments (`G76 Q100`) is not what "as written" suggests: the
      // whole label says how the preset reads it (the panel shows it the same way).
      const label = reading.cls === 'increment' ? r.label.trim() || r.preset : presetName(r.label, r.preset);
      const text =
        r.value === null
          ? say(t, 'value.noValue', { label })
          : say(t, i === 0 ? 'value.readingDefault' : 'value.reading', { value: r.value, unit, label });
      return `- ${escapeMarkdown(text)}`;
    });
    return [escapeMarkdown(head), ...items].join('\n');
  }

  if (reading.value === null || reading.source !== 'machine') return null;
  const units = unitsAfter(after, machine);
  const all = readingsOf(literal, reading.cls, view.profile.machineParams, units);
  if (all.length < 2 || all.every((r) => r.value === all[0].value)) return null;
  // A machine that scales a word with a point too (`scale`) counts every number in units;
  // one that reads only a point-less word in increments (`increment`) says so.
  const scaled = stepOf(reading.cls, machine, units, true);
  const increments = scaled === null ? stepOf(reading.cls, machine, units, false) : null;
  const why =
    scaled !== null
      ? say(t, 'value.scaled', { step: scaled, unit })
      : increments !== null
        ? say(t, 'value.noPoint', { step: increments, unit })
        : say(t, 'value.asWritten');
  return escapeMarkdown(say(t, 'value.machine', { word, value: reading.value, unit, why, name: machine.name ?? '' }));
}

/**
 * What the modal context adds to the hover of `token` (on `line`), as markdown paragraphs; none
 * while the state after the block is not known.
 */
function contextParagraphs(
  token: NcToken,
  line: string,
  cp: CompiledProfile,
  db: CodeDb,
  t: Translate,
  ctx: HoverContext,
): string[] {
  const after = ctx.after;
  if (!after) return [];
  const doc = ctx.blockLines;
  const here = doc ? doc.line : 1;
  const input: InspectInput = doc
    ? { line: here, lineCount: doc.lineCount, getLine: (n) => (n === here ? line : doc.getLine(n)) }
    : { line: 1, lineCount: 1, getLine: () => line };
  const view: InspectView = { profile: ctx.profile, cp, db, machine: ctx.machine };
  const inspection = inspectBlock(input, view, ctx.before, after);
  const word = inspection.words.find((w) => w.line === here && w.token.start <= token.start && token.start < w.token.end);
  if (!word) return [];

  if (word.kind === 'code' || word.kind === 'call') {
    const cycle = inspection.cycle;
    if (!cycle || !showsCycle(entryOfToken(word.token, db), cycle, db, doc !== undefined)) return [];
    const table = cycleTable(cycle, t);
    return table ? [table] : [];
  }
  if (word.kind !== 'address' && word.kind !== 'cycleParam' && word.kind !== 'assignment') return [];
  if (word.token.kind !== 'word') return []; // a block or a program number

  const blockTokens = tokensOf(input, cp, inspection.firstLine, inspection.lastLine);
  const reading = readWord(word.token, blockTokens, after, view);
  if (!reading) return [];
  const cycleEntry = word.kind === 'cycleParam' && inspection.cycle ? lookupCode(db, inspection.cycle.code) : null;
  const x: LineInputs = { token: word.token, reading, after, view, blockCodes: blockEntries(blockTokens, db), cycleEntry };
  return [contextLine(x, t), valueParagraph(x, t)].filter((p): p is string => p !== null);
}
