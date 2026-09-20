// The grammar of word-address ISO code (`profile.grammar === 'iso'`). Owner: WP3.4.
//
// Rule order follows `docs/planning/syntax/syntax-fanuc.md` §3.8. What that table fixes,
// and what this file must not reorder:
//
//   - a closed `( … )` comment before the unclosed one, so an unclosed comment never leaks
//     into the next line (the grammar is stateless, one line at a time)
//   - the block skip after the N-word as one grouped rule, because Monarch has no
//     lookbehind
//   - the macro keywords before every single-letter address, or `GOTO` becomes `G`, `DO`
//     becomes `D` and `IF` becomes `I`; this is safe because a real address is always
//     followed by a digit, a sign, a decimal point, the variable sigil or `[`
//   - the bare number last, for the operands of an expression and for a jump target
//
// Nothing below is dialect-specific: the comment markers, the block-skip character, the
// block-number prefix, the variable pattern, the keywords and the axis, arc, feed, spindle
// and tool letters all come from the profile, and the remaining address letters from the
// code database. `G` and `M` are the two code letters of word-address code itself — that
// is what "ISO grammar" means — and they are the only literals here.

import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';
import type { Role } from './roles';
import {
  addressNames,
  alternation,
  blockSkipPattern,
  commentMarkers,
  escapeClass,
  escapeLiteral,
  hasColonProgram,
  hasTapeMarker,
  keywordPattern,
  letterAddresses,
  lineStart,
  namesPattern,
  numberPattern,
  operatorClass,
  orderedKeywords,
  variablePattern,
  variableSigil,
  wholeLine,
  type GrammarRule,
} from './shared';

/**
 * The code letters of word-address code, the role each one gets, and whether the code may
 * carry a decimal part — `G54.1` and `G68.2` exist, `M30.5` does not (§3.2, §3.8).
 */
const CODE_LETTERS: readonly { letter: string; role: Role; decimals: boolean }[] = [
  { letter: 'G', role: 'gcode', decimals: true },
  { letter: 'M', role: 'mcode', decimals: false },
];

/** The comment rules of one marker, closed form first (§3.8 rules 2 and 3). */
function commentRules(p: Profile): GrammarRule[] {
  const rules: GrammarRule[] = [];
  const continuation = p.syntax?.continuation;
  for (const marker of commentMarkers(p)) {
    const start = escapeLiteral(marker.start);
    if (marker.end === null) {
      // A line comment must not swallow the continuation mark that follows it.
      if (typeof continuation === 'string' && continuation !== '') {
        rules.push([`${start}.*?(?=\\s*(?:${continuation}))`, 'comment']);
      }
      rules.push([`${start}.*$`, 'comment']);
      continue;
    }
    const end = escapeLiteral(marker.end);
    if (marker.end.length === 1) {
      const body = `[^${escapeClass(marker.end)}]*`;
      rules.push([`${start}${body}${end}`, 'comment']);
      rules.push([`${start}${body}$`, 'comment']);
    } else {
      rules.push([`${start}[\\s\\S]*?${end}`, 'comment']);
      rules.push([`${start}[\\s\\S]*$`, 'comment']);
    }
  }
  return rules;
}

/** The block-number prefixes of the profile, longest first (`N`, plus `altPrefixes`). */
function blockNumberPrefixes(p: Profile): string[] {
  const block = p.syntax?.blockNumber;
  const all = [block?.prefix, ...(block?.altPrefixes ?? [])].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  return [...new Set(all)].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** Builds the rules of an `iso` grammar, in the order Monarch tries them. */
export function isoRules(p: Profile, db: CodeDb): GrammarRule[] {
  const rules: GrammarRule[] = [];
  const point = escapeLiteral(p.syntax?.decimalSeparator ?? '.');
  const number = numberPattern(p);
  const sigil = variableSigil(p);
  const variables = variablePattern(p);
  const packed = p.syntax?.wordSeparatorRequired !== true;
  const gap = packed ? '\\s*' : '';

  // The value of a word: a number, or the sign in front of a variable or an expression,
  // so `X#101` and `Z-[#1+2]` keep the role of their address (§3.8 rule 19).
  const valueLead = `[${escapeClass(`${sigil ?? ''}[`)}]`;
  const value = `(?:${gap}${number}|${gap}[+-]?${gap}(?=${valueLead}))`;

  const address = (names: readonly string[], role: Role): void => {
    const pattern = namesPattern(names);
    if (pattern !== null) rules.push([`${pattern}${value}`, role]);
  };

  // 1 tape marker, 2 section heading, 3 comments, 4 continuation
  if (hasTapeMarker(p)) rules.push([lineStart('\\s*%.*$'), 'programMarker']);
  const heading = p.syntax?.sectionHeading;
  if (typeof heading === 'string' && heading !== '') rules.push([wholeLine(heading), 'section']);
  rules.push(...commentRules(p));
  const continuation = p.syntax?.continuation;
  if (typeof continuation === 'string' && continuation !== '') rules.push([continuation, 'operator']);

  // 4, 5 block skip — before the block number, and after it as one grouped rule
  const prefixes = blockNumberPrefixes(p);
  const prefix = namesPattern(prefixes);
  const blockNumber =
    p.syntax?.blockNumber?.mode === 'leading-integer' ? '\\d+' : prefix === null ? null : `${prefix}\\s*\\d+`;
  const skip = blockSkipPattern(p);
  if (skip?.before) rules.push([lineStart(`\\s*${skip.pattern}`), 'skip']);
  if (skip?.after && blockNumber !== null) {
    rules.push([lineStart(`(\\s*)(${blockNumber})(\\s*)(${skip.pattern})`), ['', 'blockNumber', '', 'skip']]);
  }

  // 6 program number: the `program.start` patterns that are anchored to the line, plus the
  // `:1234` spelling the punched-tape convention allows beside `O1234`.
  for (const pattern of p.program?.start ?? []) {
    if (typeof pattern === 'string' && pattern.startsWith('^')) rules.push([pattern, 'programMarker']);
  }
  if (hasColonProgram(p)) rules.push([lineStart('\\s*:\\s*\\d+'), 'programMarker']);

  // 7 keywords, before every single-letter address. 8 a function call before a bracket.
  const keywords = alternation(orderedKeywords(p).map(keywordPattern));
  if (keywords !== null) rules.push([`${keywords}(?![A-Za-z])`, 'keyword']);
  rules.push(['[A-Za-z]{2,}(?=\\s*\\[)', 'keyword']);

  // 9 block number, 10 and 11 the code letters
  if (blockNumber !== null) rules.push([blockNumber, 'blockNumber']);
  for (const { letter, role, decimals } of CODE_LETTERS) {
    const fraction = decimals ? `(?:${point}\\d{1,2})?` : '';
    rules.push([`${escapeLiteral(letter)}\\s*\\d{1,3}${fraction}`, role]);
  }

  // 12 to 18: the addresses the profile gives a meaning, then the rest of the database.
  const own = letterAddresses(p);
  if (own.tool) address([own.tool], 'tool');
  const comma = commentMarkers(p).some((marker) => marker.start[0] === ',' || marker.end?.[0] === ',');
  if (!comma) rules.push([`,[A-Za-z]${value}`, 'number']); // §3.6 direct drawing input
  address(own.axes, 'axis');
  address(own.arcCenter, 'arcCenter');
  if (own.feed) address([own.feed], 'feed');
  if (own.spindle) address([own.spindle], 'spindle');
  const used = [...CODE_LETTERS.map((code) => code.letter), ...prefixes, own.tool, own.feed, own.spindle]
    .concat(own.axes, own.arcCenter)
    .filter((name): name is string => typeof name === 'string');
  address(addressNames(db, used), 'number');

  // 20 variables, 21 to 25 the rest
  if (variables !== null) rules.push([variables, 'variable']);
  if (sigil !== null) rules.push([`${escapeLiteral(sigil)}\\s*(?=\\[)`, 'variable']);
  rules.push([numberPattern(p, { signed: false }), 'number']);
  const operators = operatorClass(p, '[];');
  if (operators !== null) rules.push([operators, 'operator']);
  rules.push(['\\s+', '']);

  return rules;
}
