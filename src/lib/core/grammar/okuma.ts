// The grammar of Okuma OSP code (`profile.grammar === 'okuma'`). Owner: WP8.2.
//
// Rule order follows `docs/planning/syntax/syntax-okuma.md` §3.8. What that table fixes,
// and what this file must not reorder:
//
//   - the file header `$NAME.MIN%` before everything else, so the `$` of line 1 is not
//     read as the hexadecimal sigil of an expression
//   - the closed `( … )` comment before the unclosed one, and both before any word rule:
//     parentheses are **never** expression brackets here (§3.5), which is the one thing
//     that makes this dialect incompatible with the Siemens shape
//   - the block skip at the head of the block, and after the sequence name as one grouped
//     rule, because Monarch has no lookbehind
//   - the control statements before every single-letter address, or `GOTO` becomes `G`,
//     `NOT` becomes a sequence name and the `EQ` of `[V1 EQ 5]` becomes a `Q` word
//   - the sequence name **after** the keywords for exactly that reason, and unanchored, so
//     the jump target of `GOTO N200`, of `IF [ … ] N300` and of `G85 NLAP1` is coloured
//     like the block it names (§7.2, §6.4)
//   - the system variables before the common ones (`VZOFZ` is not `V` with a value) and
//     both before the assignment rule, or the `V5` of `V5 = V5 + 1` reads as an address
//   - the bare number last, for the operands of an expression
//
// Two differences from `syntax-okuma.md` §3.8 are deliberate and are explained where they
// happen: the proposal reaches for Monarch states, which this grammar does not use (only
// the Sinumerik `DEF` rules need one, see `sinumerik.ts`), and it reserves `invalid` for
// two error rules, which the generated grammar never emits — marking an error is the
// linter's job (AD-11), and `grammar.test.ts` holds every built-in to it. A `T` word of the wrong
// length is therefore left **uncoloured** rather than marked: it still stands out against
// the tool colour of its neighbours, and nothing claims it is a tool.
//
// Everything else comes from the profile and the code database. The literals here are the
// ones that define the dialect rather than a machine: `G` and `M` as the code letters and
// the 4- and 6-digit lengths of the `T` word (§5.1). The statements that take a program
// name and the shape of the name are the profile's `syntax.callTargets`.

import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';
import type { Role } from './roles';
import {
  FUNCTION_NAME,
  addressNames,
  alternation,
  blockSkipPattern,
  colonWordRule,
  commentMarkers,
  escapeClass,
  escapeLiteral,
  freeTextRules,
  hasTapeMarker,
  keywordPattern,
  letterAddresses,
  lineStart,
  namesPattern,
  nonCapturing,
  numberPattern,
  operatorClass,
  orderedKeywords,
  plainTextRule,
  variablePattern,
  type GrammarRule,
} from './shared';

/**
 * The code letters of the dialect and how many digits a code may have. Neither takes a
 * decimal part here (§3.3: `G` 0–999). An `M` function is three digits, or four where a
 * machine option has one (`M1292`, §3.2): the option codes stand beside the ordinary ones
 * in the same block, and a rule that stopped at three digits painted the fourth as a
 * number of its own.
 */
const CODE_LETTERS: readonly { letter: string; role: Role; digits: number }[] = [
  { letter: 'G', role: 'gcode', digits: 3 },
  { letter: 'M', role: 'mcode', digits: 4 },
];

/** The digit counts of a `T` word: `T ttoo` and `T rrttoo` (§5.1). Longest first. */
const TOOL_DIGITS: readonly number[] = [6, 4];

/** The comment rules of one marker, closed form first (§3.4: match non-greedily). */
function commentRules(p: Profile): GrammarRule[] {
  const rules: GrammarRule[] = [];
  for (const marker of commentMarkers(p)) {
    const start = escapeLiteral(marker.start);
    if (marker.end === null) {
      rules.push([`${start}.*$`, 'comment']);
      continue;
    }
    const end = escapeLiteral(marker.end);
    const body = marker.end.length === 1 ? `[^${escapeClass(marker.end)}]*` : '[\\s\\S]*?';
    rules.push([`${start}${body}${end}`, 'comment']);
    rules.push([`${start}${marker.end.length === 1 ? body : '[\\s\\S]*'}$`, 'comment']);
  }
  return rules;
}

/**
 * The lookahead an assignment word ends with, taken from `syntax.assignment` itself
 * (`(?=\s*=(?!=))`). Splitting the profile pattern is what lets the letters in front of
 * `=` keep the role they have as an address — `X=V1+V2` is the X axis, `F=V2` the feed —
 * while everything else in front of `=` is the extended address of §3.2.
 */
function assignmentTail(p: Profile): string | null {
  const source = p.syntax?.assignment;
  if (typeof source !== 'string' || source === '') return null;
  const at = source.indexOf('(?=');
  return at === -1 ? null : source.slice(at);
}

/** Builds the rules of an `okuma` grammar, in the order Monarch tries them. */
export function okumaRules(p: Profile, db: CodeDb): GrammarRule[] {
  const rules: GrammarRule[] = [];
  const number = numberPattern(p);
  const variables = variablePattern(p);
  const packed = p.syntax?.wordSeparatorRequired !== true;
  const gap = packed ? '\\s*' : '';
  const value = `${gap}${number}`;
  const own = letterAddresses(p);

  const address = (names: readonly (string | null)[], role: Role): void => {
    const pattern = namesPattern(names.filter((name): name is string => typeof name === 'string'));
    if (pattern !== null) rules.push([`${pattern}${value}`, role]);
  };

  // 1 file header, 2 tape marker, 3 comments
  const header = p.syntax?.header;
  if (typeof header === 'string' && header !== '') {
    rules.push([header.startsWith('^') ? header : lineStart(header), 'programMarker']);
  }
  if (hasTapeMarker(p)) rules.push([lineStart('\\s*%.*$'), 'programMarker']);
  rules.push(...commentRules(p));

  // 4 the block skip at the head of the block, 5 the block skip behind the sequence name.
  // Monarch has no lookbehind and the generated grammar has one state, so "after the
  // sequence name" is one grouped rule per spelling of the name (§3.1 allows `/` in those
  // two places only; anywhere else `/` stays the division operator of §3.5).
  const prefixes = [p.syntax?.blockNumber?.prefix, ...(p.syntax?.blockNumber?.altPrefixes ?? [])].filter(
    (name): name is string => typeof name === 'string' && name !== '',
  );
  const prefix = namesPattern(prefixes);
  // `N` + digits is a sequence *number* and is what renumbering rewrites, however many digits
  // it has and whatever follows it (`N100G0`); `N` + a letter and up to three more
  // characters is a sequence *name*, which is this dialect's label and must keep its own
  // role (§3.1, AD-24) — when a blank or the end of the block stands behind it, and when it
  // is not a command of the dialect that has the shape of a name (`NOEX`, `NOT`), which the
  // tokenizer reads as the keyword (M12.5; `scanSequenceName`).
  const named = p.syntax?.sequenceNames === true;
  const nameShaped = (word: string): boolean =>
    prefixes.some((lead) => {
      const rest = word.toUpperCase().startsWith(lead.toUpperCase()) ? word.slice(lead.length) : '';
      return /^[A-Za-z][A-Za-z0-9]{0,3}$/.test(rest);
    });
  const commands = alternation(orderedKeywords(p).filter(nameShaped).map(escapeLiteral));
  const notCommand = commands === null ? '' : `(?!${commands}(?=\\s|$))`;
  const sequences: { pattern: string; role: Role }[] =
    prefix === null
      ? []
      : [
          { pattern: `${prefix}\\s*\\d+`, role: 'blockNumber' },
          ...(named
            ? [{ pattern: `${notCommand}${prefix}[A-Za-z][A-Za-z0-9]{0,3}(?=\\s|$)`, role: 'section' as Role }]
            : []),
        ];
  const skip = blockSkipPattern(p);
  if (skip?.before) rules.push([lineStart(`\\s*${skip.pattern}`), 'skip']);
  if (skip?.after) {
    for (const sequence of sequences) {
      rules.push([lineStart(`(\\s*)(${sequence.pattern})(\\s*)(${skip.pattern})`), ['', sequence.role, '', 'skip']]);
    }
  }

  // 6 the program name on a line of its own, from the profile's `program.start`.
  for (const pattern of p.program?.start ?? []) {
    if (typeof pattern === 'string' && pattern.startsWith('^')) rules.push([pattern, 'programMarker']);
  }

  // 7 a program name behind the statement that calls it, as one grouped rule: `CALL` is a
  // keyword and `O1234` the name of the subprogram, not an `O` word with a value (§7.1).
  // The statements and the shape of the name are the profile's `syntax.callTargets`, so the
  // grammar follows the tokenizer when a profile allows a longer name (M12.5;
  // `targetBehindKeyword`). A name that runs on into more letters or digits is no target.
  const declared = new Set(orderedKeywords(p));
  const targets = p.syntax?.callTargets;
  const callers =
    targets && Array.isArray(targets.after) && typeof targets.pattern === 'string' && targets.pattern !== ''
      ? alternation(targets.after.map((name) => name.trim().toUpperCase()).filter((name) => declared.has(name)).map(keywordPattern))
      : null;
  if (callers !== null && targets) {
    rules.push([`(${callers})(\\s+)(${nonCapturing(targets.pattern)})(?![0-9A-Za-z_])`, ['keyword', '', 'programMarker']]);
  }

  // 8 the control statements and the comparison words, before every single-letter address
  // and before the sequence rules — `NE` and `NOT` are operators, not names (§3.5).
  rules.push(...freeTextRules(p, new Set(orderedKeywords(p))));
  const colonWord = colonWordRule(p, variables === null ? number : `(?:${number}|[+-]?${variables})`);
  if (colonWord !== null) rules.push(colonWord);
  const keywords = alternation(orderedKeywords(p).map(keywordPattern));
  if (keywords !== null) rules.push([`${keywords}(?![A-Za-z])`, 'keyword']);
  const plainText = plainTextRule(p, keywords);
  if (plainText !== null) rules.push(plainText);

  // 9 the sequence number and the sequence name, wherever they stand: at the head of the
  // block they name it, behind `GOTO`, `IF` or `G85`–`G88` they refer to one (§6.4, §7.2).
  for (const sequence of sequences) rules.push([sequence.pattern, sequence.role]);

  // 10 system variables before common variables, and both before the assignment rule.
  const system = p.syntax?.systemVariables;
  if (typeof system === 'string' && system !== '') rules.push([`(?:${system})`, 'variable']);
  if (variables !== null) rules.push([variables, 'variable']);

  // 11 a function name in front of its argument bracket (`SIN[30]`, `SQRT[…]`, §3.5),
  // bounded in length so a long run of letters stays linear (`FUNCTION_NAME`).
  rules.push([FUNCTION_NAME, 'keyword']);

  // 12 the words that take `=` (§3.2). The extended addresses come first, then the address
  // letters, which keep the role they have as a word: `X=V1+V2` is the X axis and `F=V2`
  // the feed. What is left in front of `=` is a local variable and falls to rule 16 —
  // `DIA1=50` in a `CALL` block sets a variable, and painting it as an address would say
  // the block does something it does not do.
  const tail = assignmentTail(p);
  if (tail !== null) {
    const assign = (names: readonly (string | null)[], role: Role): void => {
      const pattern = namesPattern(names.filter((name): name is string => typeof name === 'string'));
      if (pattern !== null) rules.push([`${pattern}${tail}`, role]);
    };
    // The control's own multi-letter addresses (§3.2) are the profile's data
    // (`syntax.extendedAddresses`), matched against the whole identifier in front of the
    // `=`: they are always written with it, which is what separates them from a local
    // variable of the same length — `SB=1200` is the driven-tool spindle, `TL=2` a tool
    // life, while `ZL1=-20` names a variable a `CALL` block passes on.
    const extended = p.syntax?.extendedAddresses;
    if (typeof extended === 'string' && extended !== '') rules.push([`(?:${extended})${tail}`, 'keyword']);
    assign([own.tool], 'tool');
    assign(own.axes, 'axis');
    assign(own.arcCenter, 'arcCenter');
    assign([own.feed], 'feed');
    assign([own.spindle], 'spindle');
  }

  // 13 the code letters. Three digits is the range of a `G` (§3.3) and four of an `M`
  // (§3.2: the option functions), and neither takes a decimal part here; the lookahead is
  // what keeps `G1800` from being painted as the code `G180` with a stray digit behind it.
  for (const { letter, role, digits } of CODE_LETTERS) {
    rules.push([`${escapeLiteral(letter)}${gap}\\d{1,${digits}}(?![\\d.])`, role]);
  }

  // 14 the `T` word in its two lengths (§5.1). Any other length is not a tool word: it is
  // left uncoloured, in one piece, for the linter to report.
  if (own.tool !== null) {
    const tool = escapeLiteral(own.tool);
    const lengths = alternation(TOOL_DIGITS.map((digits) => `\\d{${digits}}`));
    if (lengths !== null) rules.push([`${tool}${gap}${lengths}(?!\\d)`, 'tool']);
    rules.push([`${tool}${gap}\\d+`, '']);
  }

  // 15 the addresses the profile gives a meaning, then the rest of the database.
  address(own.axes, 'axis');
  address(own.arcCenter, 'arcCenter');
  address([own.feed], 'feed');
  address([own.spindle], 'spindle');
  const used = [...CODE_LETTERS.map((code) => code.letter), own.tool, own.feed, own.spindle]
    .concat(own.axes, own.arcCenter, p.syntax?.blockNumber?.prefix ?? [], p.syntax?.blockNumber?.altPrefixes ?? [])
    .filter((name): name is string => typeof name === 'string');
  address(addressNames(db, used), 'number');

  // 16 a local variable: two letters, then up to two more characters (§3.6). Everything
  // the rules above have not claimed and that is longer than that stays uncoloured — a
  // name we cannot place is better left alone than painted as something it may not be.
  rules.push(['[A-Za-z]{2}[A-Za-z0-9]{0,2}(?![0-9A-Za-z])', 'variable']);
  // A name the profile gives itself (`syntax.names`) that is longer than that is one
  // uncoloured piece, as it is one `unknown` token; without the rule its last letters
  // would be taken for a local variable (`CALRG`: a `C`, then the variable `ALRG`).
  const names = p.syntax?.names;
  if (typeof names === 'string' && names !== '') rules.push([`(?:${nonCapturing(names)})`, '']);

  // 17 bare numbers, 18 operators — `[ … ]` groups an expression here, `( … )` never does.
  rules.push([numberPattern(p, { signed: false }), 'number']);
  const operators = operatorClass(p, '[]');
  if (operators !== null) rules.push([operators, 'operator']);
  rules.push(['\\s+', '']);

  return rules;
}
