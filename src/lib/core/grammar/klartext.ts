// The grammar of Klartext-style conversational code (`profile.grammar === 'klartext'`).
// Owner: WP3.4. The token classes and their order follow
// `docs/planning/syntax/syntax-heidenhain.md` §3.2.
//
// What makes this grammar different from `iso.ts` is the block, not the dialect:
//
//   - words are separated by whitespace (`syntax.wordSeparatorRequired`), so a keyword may
//     be several words joined by spaces and a word that means nothing to us stays **one**
//     neutral token instead of a scatter of coloured letters — the same rule
//     `core/nc/tokenizer.ts` follows
//   - a one-character function name (`L`, `C`) only counts with whitespace or the end of
//     the line behind it, or `C+45` (the C axis) and `L+10` (a tool length in `TOOL DEF`)
//     would turn into path functions; this is `matchKeyword` in the tokenizer, mirrored
//   - the block number is the leading integer, and a value may be a Q parameter (`X+Q5`)
//   - a comment runs to the end of the line but must not swallow the trailing `~` that
//     joins the block to the next line
//
// `M` is the one literal here: an M function is `M` and up to three digits in this dialect
// (§3.2). Everything else comes from the profile and from the code database — including
// `R0`, `RL` and `RR`, which are codes rather than keywords because `R` is also a radius.

import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';
import type { Role } from './roles';
import {
  addressNames,
  alternation,
  blockSkipPattern,
  colonWordRule,
  commentMarkers,
  escapeClass,
  escapeLiteral,
  freeTextRules,
  keywordPattern,
  letterAddresses,
  lineStart,
  namesPattern,
  operatorClass,
  orderedKeywords,
  variablePattern,
  wholeLine,
  wordCodes,
  type GrammarRule,
} from './shared';

/** The letter an M function starts with, and the role it gets. */
const M_FUNCTION = { letter: 'M', role: 'mcode' as Role };

/**
 * The decimal marks this profile reads: the manual's point, plus the owner's CAM comma
 * when `decimalSeparatorAlt` is set (§7.16 / R4). `chars` is the raw characters, for
 * embedding inside another character class; `atom` is the same marks as one pattern atom.
 */
function decimalMarks(p: Profile): { chars: string; atom: string } {
  const marks = [p.syntax?.decimalSeparator ?? '.', p.syntax?.decimalSeparatorAlt].filter(
    (mark): mark is '.' | ',' => typeof mark === 'string' && mark.length === 1,
  );
  const chars = escapeClass(marks.join(''));
  return { chars, atom: marks.length > 1 ? `[${chars}]` : escapeLiteral(marks[0] ?? '.') };
}

/** Builds the rules of a `klartext` grammar, in the order Monarch tries them. */
export function klartextRules(p: Profile, db: CodeDb): GrammarRule[] {
  const rules: GrammarRule[] = [];
  const marks = decimalMarks(p);
  const numberPat = (o: { signed?: boolean } = {}): string => {
    const sign = o.signed === false ? '' : '[+-]?';
    return `${sign}(?:\\d+${marks.atom}?\\d*|${marks.atom}\\d+)`;
  };
  const number = numberPat();
  const variables = variablePattern(p);
  const value = variables === null ? `(?:${number})` : `(?:${number}|[+-]?${variables})`;
  const incremental = p.syntax?.incrementalPrefix;
  const inc = typeof incremental === 'string' && incremental.length === 1 ? `(?:${escapeLiteral(incremental)})?` : '';

  /**
   * A word: the address, then its value — or nothing, when the word stands alone
   * (`TOOL CALL 5 Z S5000` names the tool axis with a bare `Z`).
   *
   * `incremental` is the `I` of `IX+10` and `IPA+90`; §3.2 gives it to the coordinate
   * words, not to the feed, the speed or the tool, so it is asked for rather than assumed.
   */
  const address = (names: readonly string[], role: Role, o: { bare?: boolean; incremental?: boolean } = {}): void => {
    const pattern = namesPattern(names);
    if (pattern === null) return;
    const prefix = o.incremental === true ? inc : '';
    rules.push([`${prefix}${pattern}(?:${value}${o.bare === true ? '|(?=\\s|$)' : ''})`, role]);
  };

  // 1 structure block, 2 comment, 3 continuation, 4 string
  const heading = p.syntax?.sectionHeading;
  if (typeof heading === 'string' && heading !== '') rules.push([wholeLine(heading), 'section']);
  const continuation = p.syntax?.continuation;
  for (const marker of commentMarkers(p)) {
    const start = escapeLiteral(marker.start);
    if (marker.end !== null) {
      const end = escapeLiteral(marker.end);
      rules.push([`${start}[\\s\\S]*?${end}`, 'comment'], [`${start}[\\s\\S]*$`, 'comment']);
      continue;
    }
    if (typeof continuation === 'string' && continuation !== '') {
      rules.push([`${start}.*?(?=\\s*(?:${continuation}))`, 'comment']);
    }
    rules.push([`${start}.*$`, 'comment']);
  }
  if (typeof continuation === 'string' && continuation !== '') rules.push([continuation, 'operator']);
  rules.push(['"[^"]*"', 'string']);

  // 5 the block skip before or behind the block number, 6 the block number itself
  //
  // Klartext's block number is `lineStart`-anchored (its leading integer would otherwise
  // paint any bare number as one), and Monarch tries a `^`-anchored rule only at column 0
  // of the *line*, never at the column a token before it stopped at (`grammar.test.ts`'s
  // harness models this: a `lineStart` rule is tried only when `pos === 0`). So a skip
  // before the number has to be captured together with it, in one rule, exactly as a skip
  // behind it already is — a rule that reads only the skip would leave the number for the
  // unanchored, unaddressed "bare numbers" rule further down (§7.16 / R1: one of the
  // owner's posts writes it this way, `/15 L …`).
  const leading = p.syntax?.blockNumber?.mode === 'leading-integer';
  const blockNumber = leading ? '\\d+' : (namesPattern([p.syntax?.blockNumber?.prefix ?? 'N']) ?? 'N') + '\\s*\\d+';
  const skip = blockSkipPattern(p);
  if (skip?.before) {
    rules.push([lineStart(`(\\s*)(${skip.pattern})(\\s*)(${blockNumber})(?=\\s|$)`), ['', 'skip', '', 'blockNumber']]);
  }
  if (skip?.after) {
    rules.push([lineStart(`(\\s*)(${blockNumber})(\\s*)(${skip.pattern})`), ['', 'blockNumber', '', 'skip']]);
  }
  rules.push([lineStart(`\\s*${blockNumber}(?=\\s|$)`), 'blockNumber']);

  const codeWords = wordCodes(db, [M_FUNCTION.letter]);
  const keywords = orderedKeywords(p, codeWords);

  // 6b the text the control keeps and does not execute (`syntax.freeText`: a cycle name, a
  // program name, a path) is one uncoloured piece, and the colon words (`VCONST:ON`,
  // `VC:120`) one word each. Both go in front of the keywords: the first holds keywords
  // of its own in its prefix, and `VC` is a code of the database as well. The tokenizer
  // asks in the same order (M12.5).
  rules.push(...freeTextRules(p, new Set(keywords)));
  const colonWord = colonWordRule(p, value);
  if (colonWord !== null) rules.push(colonWord);
  // `syntax.symbolAddresses` (`#5`, `#Q5`, the datum-table row of `CYCL DEF 7.1`): the mark
  // and its value are one word, as the tokenizer reads them when they fill a chunk.
  const symbols = (Array.isArray(p.syntax?.symbolAddresses) ? p.syntax.symbolAddresses : []).filter(
    (mark): mark is string => typeof mark === 'string' && mark.length === 1,
  );
  if (symbols.length > 0) {
    const ends = ['\\s', '$', '"', ...commentMarkers(p).map((marker) => escapeLiteral(marker.start))];
    rules.push([`[${escapeClass(symbols.join(''))}]${value}(?=${ends.join('|')})`, 'number']);
  }

  // 7 keywords: the multi-character names first, then the one-character path functions,
  // which need a separator behind them.
  const long = alternation(keywords.filter((keyword) => keyword.length > 1).map(keywordPattern));
  const short = alternation(keywords.filter((keyword) => keyword.length === 1).map(keywordPattern));
  // A word code of the database that is also the start of a number (`R0` in `R0,5`, the
  // radius 0.5) is that number, not the code with a stray fraction behind it.
  if (long !== null) rules.push([`${long}(?![A-Za-z])(?!${marks.atom}\\d)`, 'keyword']);
  if (short !== null) rules.push([`${short}(?=\\s|$)`, 'keyword']);

  // 8 M functions, 9 the rotation direction (`DR+` counter-clockwise, `DR-` clockwise;
  // a digit or a Q parameter behind it makes it the delta radius of a `TOOL CALL`).
  rules.push([`${escapeLiteral(M_FUNCTION.letter)}\\d{1,3}(?![A-Za-z0-9])`, M_FUNCTION.role]);
  const known = addressNames(db);
  if (known.includes('DR')) rules.push([`DR[+-](?![\\d${marks.chars}Q])`, 'keyword']);

  // 10 to 14: the addresses the profile gives a meaning, then the rest of the database.
  const own = letterAddresses(p);
  if (own.tool) address([own.tool], 'tool', { bare: true });
  address(own.axes, 'axis', { bare: true, incremental: true });
  address(own.arcCenter, 'arcCenter', { incremental: true });
  const family = (letter: string | null): string[] =>
    letter === null ? [] : [...known.filter((name) => name.length > 1 && name.startsWith(letter)), letter];
  address(family(own.feed), 'feed');
  address(family(own.spindle), 'spindle');
  if (variables !== null) rules.push([`[+-]?${variables}`, 'variable']);
  const used = [own.tool, own.feed, own.spindle, M_FUNCTION.letter]
    .concat(own.axes, own.arcCenter, family(own.feed), family(own.spindle))
    .filter((name): name is string => typeof name === 'string');
  // `Q`, `QL`, `QR` and `QS` are in the database as addresses, but a word that starts with
  // one of them is a parameter and the rule above has already taken it; leaving them in
  // the alternation would only add an unreachable branch.
  const variableRe = variables === null ? null : new RegExp(`^${variables}$`, 'i');
  address(
    addressNames(db, used).filter((name) => variableRe === null || !variableRe.test(`${name}1`)),
    'number',
    { incremental: true },
  );

  // 15 to 18: bare numbers, operators, and the whole word we have no meaning for — one
  // neutral token, never a letter at a time (a program name, a path, a cycle's dialog text).
  //
  // The sign belongs to the number here, unlike in `iso.ts`: the control writes every
  // position with one (`Q201=-15`), and there is no expression syntax for `-` to be the
  // operator of in a place a number can start.
  rules.push([numberPat(), 'number']);
  const operators = operatorClass(p, '[];');
  if (operators !== null) rules.push([operators, 'operator']);
  if (p.syntax?.wordSeparatorRequired === true) rules.push(['[A-Za-z][A-Za-z0-9+\\-.:\\\\/_]*', '']);
  rules.push(['\\s+', '']);

  return rules;
}
