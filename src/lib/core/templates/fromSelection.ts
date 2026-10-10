// A template from the selected lines (Phase 3 plan §6.11, P3.8 engine half, P3.9 the dialog;
// `docs/planning/code-assistant.md` "Template files and management"). Written by the P3b prelude
// as stubs; owned by P3.8.
//
// The rules (binding):
//
//  1. The selected lines (whole lines) become the body, one body line per selected line. A block
//     number at the start of a line (the profile's block-number token, Klartext's line number
//     included; spaces before it and the separator after it go with it) becomes `{{N}}`, which
//     the engine writes with the profile's own separator; a main block number (Sinumerik `:10`)
//     is no `{{N}}` and stays as written. The rest of every line is kept byte for byte, its
//     comment included. A `{{` in the text is written `\{{`.
//  2. The candidates are the words with a plain number as their value (`Z-5.`, `F240.`, `S1200`,
//     `T5`, `S3=2400`) and a variable set to a plain number (`Q200=2`, `#101=5`, `R5=3`), read by
//     the tokenizer: not a code (the database's code letters `G`, `M`, and any word the database
//     has as a code, such as Klartext `R0`), not `N` or `O`, not a block or program number, not a
//     variable read or an expression (`X#101`, `Q12`, `Q1=Q2+1`, `X=IC(2)`), nothing inside a
//     comment or a string, no argument of a call (`CYCLE83(…)`: backlog), and no number written
//     with a decimal comma (the engine writes a point).
//  3. A candidate's parameter: id = the address in lower case (`z`, `q201`, `s3`; a character a
//     parameter id cannot have becomes `_`, and a reserved name gets a trailing `_`), `z_2` for
//     the second **different** value of the same address, the same id again where the address
//     and the written value repeat (one parameter used twice); prefix = the address as written
//     (`Q201=` with the `=`, `IX` with Klartext's incremental `I`); type `number` when the value
//     is written with a point (`decimals: 'min1'` for a trailing point `-5.`, `'as-entered'`
//     otherwise) or the profile's decimal point is not significant (Klartext `X-60`,
//     `'as-entered'`), `integer` without a point on a profile where the point is significant
//     and for a count (`unit: 'count'` of the parameter), or the tool word, `D` and `H` where no
//     code of the block says what they are; `plusSign` where the value is written with a
//     `+` (Klartext `Y+30`); `default` = the value as written; `required: true`; label = the
//     database's label of the parameter (of the block's cycle, else of another code of the block) or of the address (at most `TEMPLATE_LIMITS.label`
//     characters; a longer one is not shortened: the address stands instead).
//  4. Nothing is a parameter until the user marks it (`draftToTemplate(draft, chosen, …)`); an
//     unmarked candidate stays literal text. A candidate's `line`, `start` and `end` are its
//     place in the **draft's body** (`body.split('\n')[line].slice(start, end)` is the word), so
//     the dialog shows and ticks the words of the text it will save.
//  5. The draft is checked by `loadTemplates` before it is offered for saving, so a draft the
//     loader would refuse (an id the user typed wrong, more than 40 parameters ticked, a body
//     over its limits) never reaches a file; `draftToTemplate` itself never shortens or corrects.
//
// P3b fix NC (plan §7 #253 ff.):
//
//  6. **References** (review NC-02). A block number of the selection that a reference of the
//     selection points at (`numbering.references`: Fanuc `G70`–`G73` `P`/`Q`, `GOTO`, `M98 Q`;
//     Sinumerik `GOTOF N…`; Okuma `GOTO N…` and, compared as text, the LAP contour name of
//     `G85`–`G88`) is **one** parameter (`TemplateDraft.references`): `N{{p}}` at the block,
//     `P{{p}}` at each reference; id from the reference's address (`p`, `q`, `goto`, `n`, Okuma
//     `name`), a whole number (Okuma name: upper-case text), required, default as written. It is
//     no candidate, so a P/Q pair cannot be split; `draftToTemplate` always adds it, and the
//     template service then offers and checks numbers the program does not use (NC-01). A
//     reference to a block outside the selection stays as written, is no candidate either, and
//     the draft says so (`templates.fromSelection.referencedKept`). A Klartext label
//     (`LBL n`, `CALL LBL n`) has no reference rule: it stays as written, with a note
//     (`templates.fromSelection.labelsKept`). A block number behind a block-delete slash that
//     nothing points at stays as written (`/N40 …`): the loader takes `{{N}}` only at the very
//     start of a line, so `/{{N}}` would make a draft that cannot be saved; the draft says so
//     (`templates.fromSelection.skipNumberKept`). A referenced one is `/N{{p}}` like any other.
//  7. **Least increments** (review NC-10): a word whose parameter the database reads in least
//     increments (`unit: 'increment'`: the lathe `G74`–`G76` and `G83` pecks) is a whole number
//     (`integer`), its label says "(least increments, no point)": a point is forbidden there.
//  8. A number is read by a pattern that cannot backtrack and is at most 40 characters
//     (review CODE-01).

import type { Msg } from '$lib/app/types';
import { codeAddressesOf } from '$lib/core/codes/hoverText';
import { lookupWord } from '$lib/core/codes/lookup';
import type { CodeDb, CodeEntry } from '$lib/core/codes/types';
import { blockEntries, paramOf } from '$lib/core/codes/wordValue';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { comparesByText, labelsOf, maskedOf, referenceAddresses, referencesOn } from '$lib/core/transforms/references';
import { FORMULA_CONSTANTS, FORMULA_FUNCTIONS } from './formula';
import { TEMPLATE_LIMITS } from './load';
import type { SelectionCandidate, TemplateDef, TemplateDraft, TemplateParam } from './types';

const RESERVED = new Set<string>(['sys', ...FORMULA_FUNCTIONS, ...FORMULA_CONSTANTS]);
/** A plain decimal number; no two ways to match the same digits, so a long one cannot backtrack (rule 8). */
const PLAIN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
/** The longest number text rule 2 reads (rule 8). */
const PLAIN_MAX = 40;

function plain(text: string): boolean {
  return text.length <= PLAIN_MAX && PLAIN.test(text);
}

function upper(text: string | undefined | null): string {
  return typeof text === 'string' ? text.toUpperCase() : '';
}

/** `{{` written as `\{{` (rule 1). */
function escape(text: string): string {
  return text.split('{{').join('\\{{');
}

/** A parameter id from an address (rule 3). */
function idOf(address: string): string {
  let id = address.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!/^[a-z_]/.test(id)) id = `_${id}`;
  id = id.slice(0, 29);
  return RESERVED.has(id) ? `${id}_` : id;
}

interface Found {
  token: NcToken;
  prefix: string;
  written: string;
  address: string;
  /** Where the candidate ends on its line. */
  end: number;
}

/** A word whose value is a plain number and that may become a parameter (rule 2), or null. */
function candidateOf(token: NcToken, db: CodeDb, codeAddresses: ReadonlySet<string>): Found | null {
  if (token.kind !== 'word' || token.address === undefined || token.address === '') return null;
  const written = token.valueText ?? '';
  if (!token.value || !plain(written)) return null;
  const address = upper(token.address);
  const letter = address.replace(/[^A-Z].*$/, '');
  if (letter === 'N' || letter === 'O' || codeAddresses.has(letter)) return null;
  if (lookupWord(db, token)?.entry) return null; // a code (Klartext `R0`, an `M3=3` the database knows)
  const prefix = token.text.slice(0, token.text.length - written.length);
  if (prefix === '' || /[{}\s]/.test(prefix) || prefix.length > TEMPLATE_LIMITS.affix) return null;
  return { token, prefix, written, address: token.address, end: token.end };
}

/** The next token that is not whitespace, or -1. */
function next(tokens: readonly NcToken[], i: number): number {
  for (let j = i + 1; j < tokens.length; j++) if (tokens[j].kind !== 'whitespace') return j;
  return -1;
}

/**
 * A variable set to a plain number (`Q200=2`, `#101=5`, `R5=3`, `Q201 = -15`), the whole
 * statement up to the next word: the variable and the `=` are the prefix (rule 2). Null for a
 * value that is read (`Q12`) or computed (`Q1=Q2+1`).
 */
function assignmentOf(tokens: readonly NcToken[], i: number, line: string): Found | null {
  const variable = tokens[i];
  if (variable.kind !== 'variable') return null;
  const op = next(tokens, i);
  if (op < 0 || tokens[op].kind !== 'operator' || tokens[op].text !== '=') return null;
  const num = next(tokens, op);
  if (num < 0) return null;
  const value = tokens[num];
  if (value.kind !== 'word' || value.address !== undefined || !value.value || !plain(value.text)) return null;
  const after = next(tokens, num);
  if (after >= 0 && (tokens[after].kind === 'operator' || tokens[after].kind === 'expression')) return null;
  const prefix = line.slice(variable.start, value.start);
  if (/[{}]/.test(prefix) || prefix.length > TEMPLATE_LIMITS.affix) return null;
  const token: NcToken = { kind: 'word', start: variable.start, end: value.end, text: line.slice(variable.start, value.end), address: variable.text, valueText: value.text, value: value.value };
  return { token, prefix, written: value.text, address: variable.text, end: value.end };
}

/** The selection as a draft (rules 1–3). `lines` without line breaks. */
export function templateFromSelection(lines: readonly string[], cp: CompiledProfile, db: CodeDb): TemplateDraft {
  const profile = cp.profile;
  const codeAddresses = codeAddressesOf(db);
  const tool = upper(profile.addresses?.tool);
  const pointSignificant = profile.syntax?.decimalPointSignificant === true;
  const mainPrefix = profile.syntax?.blockNumber?.mainPrefix;

  // Tokens per line, and the cycle of each block (a `~` block spans lines).
  const tokens: NcToken[][] = [];
  let state: LineState | undefined;
  for (const line of lines) {
    const r = tokenizeLine(typeof line === 'string' ? line : '', cp, state);
    tokens.push(r.tokens);
    state = r.state;
  }
  // The codes of each line's block, its cycle first (a parameter is read from them, rule 3).
  const codesOfLine: CodeEntry[][] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length - 1 && tokenizeLine(lines[j] ?? '', cp).state.continuation) j++;
    const entries = blockEntries(tokens.slice(i, j + 1).flat(), db);
    const isCycle = (e: CodeEntry): boolean => e.sets?.cycle === 'start' || e.sets?.cycle === 'define';
    const ordered = [...entries.filter(isCycle), ...entries.filter((e) => !isCycle(e))];
    for (let k = i; k <= j; k++) codesOfLine.push(ordered);
    i = j + 1;
  }

  // Rule 6: the block number at the head of each line (behind a block-delete slash), and the
  // references of the selection, keyed as the dialect tells blocks apart.
  const byText = comparesByText(cp);
  const keyOfDigits = (digits: string): string | null => (/^\d{1,9}$/.test(digits) ? (byText ? `N${digits}` : String(Number(digits))) : null);
  const heads: (Head | null)[] = lines.map((raw, n) => headOf(typeof raw === 'string' ? raw : '', tokens[n], mainPrefix, byText, keyOfDigits));
  const addresses = referenceAddresses(cp);
  const labels = addresses.size > 0 ? labelsOf(lines.map((l) => (typeof l === 'string' ? l : '')), cp) : new Set<string>();
  const refsOfLine: Ref[][] = lines.map((raw, n) => {
    const line = typeof raw === 'string' ? raw : '';
    const out: Ref[] = [];
    if (addresses.size === 0) return out;
    for (const word of referencesOn(tokens[n], line, cp, addresses, labels)) {
      if (word.ambiguous) continue;
      const from = line.toUpperCase().lastIndexOf(word.address.toUpperCase(), word.start);
      out.push({ address: word.address, start: word.start, end: word.end, key: keyOfDigits(word.text), written: line.slice(from < 0 ? word.start : from, word.end).trim(), name: false });
    }
    if (byText) {
      // Okuma: a sequence name behind a reference code (`G85 NLAP1`) is a label token.
      const masked = maskedOf(line, tokens[n]);
      if (cp.re.references.some((rule) => rule.trigger.test(masked))) {
        const head = heads[n];
        for (const token of tokens[n]) {
          if (token.kind !== 'label' || !SEQUENCE_NAME.test(token.text) || (head !== null && token.start === head.start)) continue;
          out.push({ address: 'N', start: token.start, end: token.end, key: token.text.toUpperCase(), written: token.text, name: true });
        }
      }
    }
    return out;
  });

  const defined = new Map<string, Head>();
  for (const head of heads) if (head !== null && head.key !== null && !defined.has(head.key)) defined.set(head.key, head);
  const usedIds = new Set<string>();
  const shared = new Map<string, TemplateParam>(); // key → the reference parameter
  const kept: string[] = [];
  const skipKept: string[] = [];
  refsOfLine.forEach((refs) => {
    for (const ref of refs) {
      if (ref.key === null) continue;
      const target = defined.get(ref.key);
      if (target === undefined) {
        if (!kept.includes(ref.written)) kept.push(ref.written);
        continue;
      }
      if (shared.has(ref.key)) continue;
      let id = ref.name ? 'name' : idOf(ref.address);
      for (let k = 2; usedIds.has(id); k++) id = `${ref.name ? 'name' : idOf(ref.address)}_${k}`;
      usedIds.add(id);
      shared.set(ref.key, referenceParam(id, target, ref));
    }
  });

  const body: string[] = [];
  const candidates: SelectionCandidate[] = [];
  const ids = new Map<string, string>(); // `${ADDRESS}\u0000${prefix}\u0000${written}` → id
  const perAddress = new Map<string, number>(); // ADDRESS → different values seen

  lines.forEach((raw, n) => {
    const line = typeof raw === 'string' ? raw : '';
    const toks = tokens[n];
    let from = 0;
    let out = '';
    // Rule 1: the block number at the start becomes {{N}}; rule 6: a referenced one its parameter.
    const head = heads[n];
    if (head !== null) {
      const param = head.key === null ? undefined : shared.get(head.key);
      if (param !== undefined) {
        out = escape(line.slice(0, head.start)).trimStart() + (head.name ? `{{${param.id}}}` : `${head.prefix}{{${param.id}}}`);
        from = head.end;
      } else if (!head.name && head.slash === '') {
        out = '{{N}}';
        from = head.end;
        while (from < line.length && (line[from] === ' ' || line[from] === '\t')) from++;
      } else if (!head.name) {
        // Behind a block-delete slash: kept as written (rule 6), and said.
        skipKept.push(line.slice(0, head.end).trim());
      }
    }
    const refs = refsOfLine[n];
    const inRef = (start: number, end: number): boolean => refs.some((r) => start < r.end && end > r.start);
    // The edits of this line in order: the references to a shared block, then the candidates.
    const edits: ({ kind: 'ref'; start: number; end: number; id: string } | { kind: 'word'; found: Found })[] = [];
    for (const ref of refs) {
      const param = ref.key === null ? undefined : shared.get(ref.key);
      if (param !== undefined && ref.start >= from) edits.push({ kind: 'ref', start: ref.start, end: ref.end, id: param.id });
    }
    for (let i = 0; i < toks.length; i++) {
      const token = toks[i];
      if (token.start < from) continue;
      const found = candidateOf(token, db, codeAddresses) ?? assignmentOf(toks, i, line);
      if (!found || inRef(found.token.start, found.end)) continue;
      edits.push({ kind: 'word', found });
    }
    edits.sort((a, b) => (a.kind === 'ref' ? a.start : a.found.token.start) - (b.kind === 'ref' ? b.start : b.found.token.start));
    for (const edit of edits) {
      if (edit.kind === 'ref') {
        if (edit.start < from) continue;
        out += escape(line.slice(from, edit.start)) + `{{${edit.id}}}`;
        from = edit.end;
        continue;
      }
      const found = edit.found;
      if (found.token.start < from) continue;
      out += escape(line.slice(from, found.token.start));
      const start = out.length;
      out += found.token.text;
      from = found.end;

      const address = upper(found.address);
      const key = `${address}\u0000${found.prefix}\u0000${found.written}`;
      let id = ids.get(key);
      if (id === undefined) {
        const count = (perAddress.get(address) ?? 0) + 1;
        perAddress.set(address, count);
        const base = idOf(found.address);
        id = count === 1 ? base : `${base}_${count}`;
        while (usedIds.has(id)) id = `${id}_`;
        usedIds.add(id);
        ids.set(key, id);
      }
      candidates.push({
        key: `${n}:${start}`,
        line: n,
        start,
        end: out.length,
        address: found.address,
        written: found.written,
        param: paramFor(id, found, codesOfLine[n] ?? [], db, pointSignificant, tool),
      });
    }
    out += escape(line.slice(from));
    body.push(out);
  });
  const draft: TemplateDraft = { body: body.join('\n'), candidates };
  if (shared.size > 0) draft.references = [...shared.values()];
  const notes: Msg[] = [];
  if (kept.length > 0) notes.push({ key: 'templates.fromSelection.referencedKept', params: { words: kept.join(' ') } });
  if (skipKept.length > 0) notes.push({ key: 'templates.fromSelection.skipNumberKept', params: { words: skipKept.join(' ') } });
  if (profile.numbering?.mode === 'consecutive' && lines.some((l) => typeof l === 'string' && /(?<![A-Z])LBL(?![A-Z])/i.test(l))) {
    notes.push({ key: 'templates.fromSelection.labelsKept' });
  }
  if (notes.length > 0) draft.notes = notes;
  return draft;
}

/** An Okuma sequence name (`NLAP1`): `N` and letters or digits. */
const SEQUENCE_NAME = /^N[A-Z0-9]+$/i;

/** The head of a selected line: its block number (or Okuma sequence name) and where it stands. */
interface Head {
  /** Where the number (or name) starts and ends on the line. */
  start: number;
  end: number;
  /** The text before it that stays (a block-delete slash); `''` for none. */
  slash: string;
  /** The address as written (`N`), `''` for a name. */
  prefix: string;
  /** The digits as written (`0100`), or the name (`NLAP1`). */
  written: string;
  key: string | null;
  name: boolean;
}

/** A reference word of the selection: its value's span, the block it points at, and the word as written. */
interface Ref {
  address: string;
  start: number;
  end: number;
  key: string | null;
  written: string;
  name: boolean;
}

function headOf(line: string, toks: readonly NcToken[], mainPrefix: string | undefined, byText: boolean, keyOfDigits: (d: string) => string | null): Head | null {
  let i = toks.findIndex((t) => t.kind !== 'whitespace');
  if (i < 0) return null;
  let slash = '';
  if (toks[i].kind === 'skip') {
    slash = line.slice(toks[i].start, toks[i].end);
    i++;
    while (i < toks.length && toks[i].kind === 'whitespace') i++;
    if (i >= toks.length) return null;
  }
  const t = toks[i];
  if (t.kind === 'blockNumber' && !(mainPrefix && t.address === mainPrefix)) {
    const digits = t.valueText ?? '';
    return { start: t.start, end: t.end, slash, prefix: t.text.slice(0, t.text.length - digits.length), written: digits, key: keyOfDigits(digits), name: false };
  }
  if (byText && t.kind === 'label' && SEQUENCE_NAME.test(t.text)) {
    return { start: t.start, end: t.end, slash, prefix: '', written: t.text, key: t.text.toUpperCase(), name: true };
  }
  return null;
}

/** The parameter of a referenced block (rule 6). */
function referenceParam(id: string, head: Head, ref: Ref): TemplateParam {
  if (head.name) {
    return {
      id,
      label: 'Contour name (N and at most four letters or digits)',
      type: 'text',
      help: 'The same in every place. Each name may stand only once in the program; the form offers one the program does not use yet.',
      required: true,
      uppercase: true,
      default: head.written.toUpperCase(),
    };
  }
  return {
    id,
    label: `Block number that ${ref.address} points at`,
    type: 'integer',
    help: 'Written at the block and at every reference to it. Each number may stand only once in the program; the form offers one the program does not use yet.',
    required: true,
    min: 0,
    default: head.written,
  };
}

function paramFor(id: string, found: Found, codes: readonly CodeEntry[], db: CodeDb, pointSignificant: boolean, tool: string): TemplateParam {
  const address = upper(found.address);
  let cycleParam = null;
  for (const entry of codes) {
    cycleParam = paramOf(entry, found.address);
    if (cycleParam) break;
  }
  const dbLabel = cycleParam?.label ?? lookupWord(db, found.token)?.address?.label ?? null;
  let label = dbLabel !== null && dbLabel.trim() !== '' && dbLabel.length <= TEMPLATE_LIMITS.label ? dbLabel : found.address;
  const hasPoint = found.written.includes('.');
  // Rule 7: a word in least increments takes no point (the lathe pecks, `G76 Q`).
  const increments = cycleParam?.unit === 'increment';
  if (increments) {
    const suffix = ' (least increments, no point)';
    label = label.length + suffix.length <= TEMPLATE_LIMITS.label ? label + suffix : found.address + suffix;
  }
  // A count, or a register number (tool, `D`, `H`) where no cycle parameter says otherwise (Okuma `G85 … D4` is a depth).
  const whole = cycleParam ? cycleParam.unit === 'count' : address === tool || address === 'D' || address === 'H';
  const param: TemplateParam = { id, label, type: 'number', required: true, prefix: found.prefix };
  if (increments) {
    param.type = 'integer';
  } else if (hasPoint) {
    param.decimals = found.written.endsWith('.') ? 'min1' : 'as-entered';
  } else if (pointSignificant || whole) {
    param.type = 'integer';
  } else {
    param.decimals = 'as-entered';
  }
  if (found.written.startsWith('+')) param.plusSign = true;
  param.default = found.written;
  return param;
}

/** The template of a draft with the marked candidates (by `key`) as parameters (rule 4). */
export function draftToTemplate(
  draft: TemplateDraft,
  chosen: ReadonlySet<string>,
  meta: { id: string; label: string; group: string; machineType?: 'mill' | 'lathe' },
): TemplateDef {
  const lines = draft.body.split('\n');
  const marked = draft.candidates.filter((c) => chosen.has(c.key));
  const byLine = new Map<number, SelectionCandidate[]>();
  for (const c of marked) byLine.set(c.line, [...(byLine.get(c.line) ?? []), c]);
  for (const [n, list] of byLine) {
    let line = lines[n] ?? '';
    for (const c of [...list].sort((a, b) => b.start - a.start)) {
      line = `${line.slice(0, c.start)}{{${c.param.id}}}${line.slice(c.end)}`;
    }
    lines[n] = line;
  }
  // Rule 6: the reference parameters always, before the marked candidates.
  const params: TemplateParam[] = (draft.references ?? []).map((p) => ({ ...p }));
  const seen = new Set<string>(params.map((p) => p.id));
  for (const c of [...marked].sort((a, b) => a.line - b.line || a.start - b.start)) {
    if (seen.has(c.param.id)) continue;
    seen.add(c.param.id);
    params.push({ ...c.param });
  }
  const t: TemplateDef = { id: meta.id, label: meta.label, group: meta.group, body: lines.join('\n') };
  if (params.length > 0) t.params = params;
  if (meta.machineType !== undefined) t.machineType = meta.machineType;
  return t;
}
