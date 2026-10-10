// The grammar of Sinumerik code (`profile.grammar === 'sinumerik'`). Owner: WP8.4.
//
// Rule order follows `docs/planning/syntax/syntax-sinumerik.md` §3.8, with the two
// corrections that document asks for in its own text:
//
//   - the **string** rule runs before the `;` comment (§3.4), so the `;` of
//     `MSG("ROUGH ; PASS")` stays inside the message instead of turning the rest of the
//     block into a comment
//   - the **label** is read before the block number (§3.1 rule 3). It is read where the
//     control reads one — at the head of the block, behind the skip and the block number
//     when the block has them — which is the shape of the profile's `syntax.labels`, and
//     so the place `core/nc/tokenizer.ts` finds it too. Anywhere else a name in front of a
//     colon is not a label: `FRAME_A:CROT(Z,45)` chains two frames.
//
// What makes this grammar different from `iso.ts` is the block, not the dialect:
//
//   - `( … )` is **never** a comment here. It carries call arguments and groups an
//     expression, so the brackets stay ordinary punctuation and a name written in front of
//     one is a call (§3.4).
//   - a value that is not a plain number is written with `=` (§3.2). An address is
//     therefore a letter and a *number*, and nothing else — which is what keeps `CR=15`
//     from reading as the C axis followed by an R parameter, the way a value pattern with
//     the ISO lookahead for a variable reads it.
//   - the block skip stands in front of the block number, and both are optional, so
//     neither can be the anchor the other is found by. Its level runs from `/0` to `/9`,
//     where `/0` is the same level as the bare `/` (§3.1 rule 1).
//
// Everything else comes from the profile and the code database. The literals below are
// the ones that define the dialect rather than a machine: `G` and `M` as the code letters,
// `L` as the subprogram call by number (§3.8 rule 10), the level digit of the skip, the
// shape of a label and the quoted constants of §3.3.
//
// Three things this dialect has and the palette has no role of its own for, so each one
// borrows the role that says the most about it — a role of its own would mean a new
// colour and a new WCAG pair to measure in `roles.test.ts`:
//
//   - a **label** is a `section`: it names a stretch of the program, which is what a
//     Klartext structure block does with the same colour and weight. The Okuma grammar
//     paints its sequence names the same way, so a jump target looks alike in both.
//   - a **call** is a `keyword`, cycle or not (`CYCLE81(…)`, `MSG(…)`, `L10`) — the
//     grammar is built before anybody chooses a machine, so it cannot know which names the
//     code database will turn out to hold
//   - an **assignment word** the dialect has no address for is a `keyword` as well
//     (§3.8 rule 12): `S3=2500` drives another spindle and `T1=4` names a tool on one, and
//     a block has to show at a glance that neither of them is the speed or the tool word a
//     script may scale (WP8.7). An address we do know keeps its own role whichever way it
//     is written, so `X=AC(10)` stays an axis and `LIMS=3000` reads as one of the other
//     value words of the block — never as the speed it is there to limit.

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
  hasColonProgram,
  keywordPattern,
  letterAddresses,
  lineStart,
  namesPattern,
  nonCapturing,
  numberPattern,
  operatorClass,
  orderedKeywords,
  plainTextRule,
  stackedSkipRules,
  STATE_EXIT,
  variablePattern,
  variableSigil,
  type GrammarAction,
  type GrammarEntry,
  type GrammarRule,
  type GrammarStep,
} from './shared';

/**
 * The code letters of this dialect, the role each one gets and how many digits its number
 * may have (§3.8 rules 8 and 9). A G code has at most three. An M function is any whole
 * number: the ones above the few the control predefines are the machine builder's, and
 * they may well be longer. Neither carries a decimal part.
 */
const CODE_LETTERS: readonly { letter: string; role: Role; digits: string }[] = [
  { letter: 'G', role: 'gcode', digits: '\\d{1,3}' },
  { letter: 'M', role: 'mcode', digits: '\\d+' },
];

/**
 * The letter that calls a subprogram by number, `L100` (§3.8 rule 10). It is a call, not
 * an axis and not an offset: `L1` and `L01` are even two different programs.
 */
const SUBPROGRAM_LETTER = 'L';

/** The level digit behind the skip mark: `/0` to `/9`, `/0` being the bare `/` (§3.1). */
const SKIP_LEVEL = '[0-9]';

/** A label: a name and its colon, which must not be the `:=` of an assignment (§3.1). */
const LABEL = '[A-Za-z_]\\w*:(?!=)';

/**
 * The label of a profile: `LABEL`, except for a jump keyword (`syntax.labelAfter`), which is
 * never a label — `GOTOF:20` is the jump to the main block `:20`, written without the blank
 * (B1; `labelSpanOf` in the tokenizer). Read as a label, the colour said a label named
 * `GOTOF` stood there.
 */
function labelPattern(p: Profile): string {
  const jumps = jumpKeywords(p).filter((name) => /^[A-Za-z_]\w*$/.test(name));
  return jumps.length === 0 ? LABEL : `(?!(?:${jumps.map(escapeLiteral).join('|')}):)${LABEL}`;
}

/** The declaring keywords of the profile (`syntax.declareAfter`, `DEF`) that are keywords of it, upper case. */
function declareKeywords(p: Profile): string[] {
  const declared = new Set(orderedKeywords(p));
  return (Array.isArray(p.syntax?.declareAfter) ? p.syntax.declareAfter : [])
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim().replace(/\s+/g, ' ').toUpperCase())
    .filter((name) => /^[A-Z_]\w*$/.test(name) && declared.has(name));
}

/** The jump keywords of the profile (`syntax.labelAfter`) that are keywords of it, upper case. */
function jumpKeywords(p: Profile): string[] {
  const declared = new Set(orderedKeywords(p));
  return (Array.isArray(p.syntax?.labelAfter) ? p.syntax.labelAfter : [])
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim().replace(/\s+/g, ' ').toUpperCase())
    .filter((name) => declared.has(name));
}

/**
 * What has to follow an assignment word: an `=` that is not the `==` of a comparison, with
 * or without a space in front of it. It is the check `core/nc/tokenizer.ts` makes behind a
 * match of `syntax.assignment`, so a word is painted as an assignment exactly where the
 * tokenizer reads one.
 */
const ASSIGNED = '(?=\\s*=(?!=))';

/**
 * What has to stand at a position before the profile's own assignment pattern is tried
 * there: an identifier with its `=` behind it, which is also the only place the tokenizer
 * asks that pattern. The identifier is bounded, because Monarch tries this rule at every
 * word of a packed run (`G1X1G1X1…`), and a pattern that reads to the end of the run
 * before it finds no `=` there made such a line quadratic: 16k characters took a quarter
 * of a second to paint (G8 M8). No name a program writes comes near 64 characters.
 */
const ASSIGNMENT_GUARD = '(?=[A-Za-z_][A-Za-z0-9_]{0,63}\\s*=(?!=))';

/**
 * An identifier with the bracket index of an indexed assignment (`LIMS[2]=1800`,
 * `S[SPI]=300`, `FA[X]=200`), up to the `=` and not including it: the tokenizer's
 * `syntax.assignmentIndex` shape, one `word` whose address is the identifier. The text of the
 * index is bounded and holds no closing bracket, so a long line stays linear.
 */
const INDEXED_ASSIGNMENT = `[A-Za-z_][A-Za-z0-9_]{0,63}\\[[^\\]]{1,63}\\]${ASSIGNED}`;

/** The operators of more than one character, which have to be tried before the single ones. */
const LONG_OPERATORS: readonly string[] = ['==', '<>', '<=', '>=', '<<'];

/**
 * A hexadecimal or binary constant between single quotes, `'H7F'` or `'B10000001'`
 * (§3.3). The control allows separators between the digits, so they are part of it.
 */
const QUOTED_CONSTANT = "'[HB][0-9A-F \\t]*'";

/** The block-number prefixes of the profile, longest first. */
function blockNumberPrefixes(p: Profile): string[] {
  const block = p.syntax?.blockNumber;
  const all = [block?.prefix, ...(block?.altPrefixes ?? [])].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  return [...new Set(all)].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** The comment rules of the profile; a closed marker keeps its unclosed form as well. */
function commentRules(p: Profile): GrammarRule[] {
  const rules: GrammarRule[] = [];
  for (const marker of commentMarkers(p)) {
    const start = escapeLiteral(marker.start);
    if (marker.end === null) {
      rules.push([`${start}.*$`, 'comment']);
      continue;
    }
    const end = escapeLiteral(marker.end);
    rules.push([`${start}[\\s\\S]*?${end}`, 'comment'], [`${start}[\\s\\S]*$`, 'comment']);
  }
  return rules;
}

/**
 * The block-skip mark of the profile with the level digit of this dialect, and where the
 * profile allows it to stand. The shared pattern knows the levels 1 to 9 of ISO code; here
 * `/0` is a level as well, so a skipped block reads `/0` as one mark, not as `/` and a 0.
 */
function skipMark(p: Profile): { pattern: string; before: boolean; after: boolean } | null {
  const shared = blockSkipPattern(p);
  const skip = p.syntax?.blockSkip;
  if (shared === null || !skip) return null;
  return {
    ...shared,
    pattern: `[${escapeClass(skip.chars)}]${skip.levels === true ? `${SKIP_LEVEL}?` : ''}`,
  };
}

/**
 * One rule for the head of a block, built from its parts: every part is a capture group
 * that always takes part in the match, empty or not, because Monarch reads the length of
 * every group and a group that did not take part has none.
 */
function headRule(parts: readonly [source: string, role: GrammarStep][]): GrammarRule {
  const source = lineStart(parts.map(([part]) => `(${part})`).join(''));
  const action: GrammarAction = parts.map(([, role]) => role);
  return [source, action];
}

/**
 * The states a `DEF` line moves through (`syntax.declareAfter`; `declaresNameHere` in the
 * tokenizer). `declare`: after the keyword, and after a name — a type keyword or a `,` turns
 * the next identifier into a declared name. `declareName`: an identifier now is a variable,
 * unless it is a keyword; blanks and keywords leave the state as it is, a size in brackets
 * (`STRING[32]`) is passed over, anything else gives the position back to `declare`.
 * `declareNest`: inside brackets and parentheses a `,` separates arguments, not names. Every
 * state ends at the first character of the next line (`STATE_EXIT`).
 */
function declareStates(p: Profile): { declare: GrammarEntry[]; declareName: GrammarEntry[]; declareNest: GrammarEntry[] } {
  const declaring = new Set(declareKeywords(p));
  const types = alternation(
    orderedKeywords(p)
      .filter((name) => !declaring.has(name))
      .map(keywordPattern),
  );
  const keyword = types === null ? [] : [[`${types}(?![A-Za-z0-9_])`, 'keyword'] as GrammarRule];
  return {
    declare: [
      STATE_EXIT,
      [',', { token: 'operator', switchTo: 'declareName' }],
      ...(types === null ? [] : [[`${types}(?![A-Za-z0-9_])`, { token: 'keyword', switchTo: 'declareName' }] as GrammarRule]),
      ['[(\\[]', { token: 'operator', next: 'declareNest' }],
      { include: 'root' },
    ],
    declareName: [
      STATE_EXIT,
      ['\\s+', ''],
      ...keyword,
      ['\\[', { token: 'operator', next: 'declareNest' }],
      ['[A-Za-z_][A-Za-z0-9_]*', { token: 'variable', switchTo: 'declare' }],
      ['(?=\\S)', { token: '@rematch', switchTo: 'declare' }],
    ],
    declareNest: [
      STATE_EXIT,
      ['[(\\[]', { token: 'operator', next: 'declareNest' }],
      ['[)\\]]', { token: 'operator', next: '@pop' }],
      { include: 'root' },
    ],
  };
}

/** Builds the rules of a `sinumerik` grammar, in the order Monarch tries them. */
export function sinumerikRules(p: Profile, db: CodeDb): GrammarRule[] {
  return build(p, db).rules;
}

/**
 * The states of a `sinumerik` grammar besides `root`: empty unless the profile declares
 * names (`syntax.declareAfter`, `DEF`), see `declareStates`.
 */
export function sinumerikStates(p: Profile, db: CodeDb): Record<string, GrammarEntry[]> {
  return build(p, db).states;
}

function build(p: Profile, db: CodeDb): { rules: GrammarRule[]; states: Record<string, GrammarEntry[]> } {
  const rules: GrammarRule[] = [];
  const states: Record<string, GrammarEntry[]> = {};
  const point = escapeLiteral(p.syntax?.decimalSeparator ?? '.');
  const gap = p.syntax?.wordSeparatorRequired === true ? '' : '\\s*';
  // The exponent of a number (§3.3): the profile's `syntax.exponentMarker` (`EX`), a sign
  // and digits, behind a number wherever the tokenizer reads one — an address value and a
  // bare number alike (`X1.5EX3`, `R1=2.5EX2`).
  const marker = p.syntax?.exponentMarker;
  const exponent = typeof marker === 'string' && marker !== '' ? `(?:${escapeLiteral(marker)}[+-]?\\d+)?` : '';
  // The value of a word: a signed number, and nothing else. Everything else is written
  // with `=` and handled by the assignment rules (§3.2).
  const value = `(?:${gap}${numberPattern(p)}${exponent})`;
  const own = letterAddresses(p);
  const prefixes = blockNumberPrefixes(p);
  const prefix = namesPattern(prefixes);
  const leadingInteger = p.syntax?.blockNumber?.mode === 'leading-integer';
  const blockNumber = !leadingInteger && prefix !== null ? `${prefix}${gap}\\d+` : null;
  const skip = skipMark(p);

  // Every address of the dialect and the role it paints in, in the order Monarch tries
  // them: the letters the profile gives a meaning, then whatever else the code database
  // knows. One table serves the assignment words and the plain words, so an address
  // cannot end up one colour with a number behind it (`CR15`) and another with an `=`
  // (`CR=15`).
  const used = [
    ...CODE_LETTERS.map((code) => code.letter),
    SUBPROGRAM_LETTER,
    ...prefixes,
    own.tool,
    own.feed,
    own.spindle,
    ...own.axes,
    ...own.arcCenter,
  ].filter((name): name is string => typeof name === 'string');
  const addresses: [readonly string[], Role][] = [
    [own.tool === null ? [] : [own.tool], 'tool'],
    [own.axes, 'axis'],
    [own.arcCenter, 'arcCenter'],
    [own.feed === null ? [] : [own.feed], 'feed'],
    [own.spindle === null ? [] : [own.spindle], 'spindle'],
    [addressNames(db, used), 'number'],
  ];

  // The file header (`%_N_PART_MPF`, AD-24) before anything else: it is not a block, and
  // like the tokenizer the rule reads it at the head of a line only.
  const header = p.syntax?.header;
  if (typeof header === 'string' && header !== '') {
    rules.push([header.startsWith('^') ? header : lineStart(header), 'programMarker']);
  }

  // §3.8 rules 2 and 1: the string, then the comment. The unclosed string keeps a
  // half-typed `MSG("A` from handing the rest of the line to the comment rule; a string
  // never spans a block, so it ends at the line either way.
  if (p.syntax?.strings === true) rules.push(['"[^"]*"', 'string'], ['"[^"]*$', 'string']);
  rules.push(...commentRules(p));

  // Rules 5, 4 and 3: the head of the block, `[/n] [N123 | :123] [LABEL:]` (§3.1). Monarch
  // has no lookbehind, so whatever stands in front of a label or a main block is taken by
  // the same rule, one group per part. The first group takes every leading blank: two
  // blank runs with nothing but an optional mark between them could otherwise share a
  // line of blanks in every possible way, and a padded line that turned out to be no head
  // took half a second to paint (G8 M8).
  const lead: [string, Role | ''][] = skip?.before
    ? [
        ['\\s*(?!\\s)', ''],
        [`(?:${skip.pattern})?`, 'skip'],
        ['\\s*', ''],
      ]
    : [['\\s*', '']];
  const label = labelPattern(p);
  const hasLabels = typeof p.syntax?.labels === 'string' && p.syntax.labels !== '';

  // `DEF INT COUNTER` (`syntax.declareAfter`, M12.5): on a block that starts with the
  // keyword — behind its skip mark, block number and label, as `BLOCK_HEAD_KINDS` of the
  // tokenizer says — each name behind a type keyword or a `,` is a variable. Which name
  // that is depends on what stood before it on the line, so the keyword enters a state
  // (`declareStates`) that tracks it and is left at the first character of the next line.
  // This rule comes first: the head rules below would take a block number and stop.
  const declaring = declareKeywords(p);
  const mainMark = p.syntax?.blockNumber?.mainPrefix;
  if (declaring.length > 0) {
    const numbers = [
      !leadingInteger && prefix !== null ? `${prefix}${gap}\\d+` : null,
      typeof mainMark === 'string' && mainMark !== '' ? `${escapeLiteral(mainMark)}${gap}\\d+` : null,
      leadingInteger ? '\\d+' : null,
    ].filter((part): part is string => part !== null);
    // Every blank run is `\s*(?!\s)`, which splits in exactly one way: with plain `\s*` between
    // optional parts, a padded line that is no `DEF` line is cut every possible way (G8 M8).
    const blanks: [string, Role | ''] = ['\\s*(?!\\s)', ''];
    // Two skip marks (`/1 /3 DEF INT A`) are allowed when the mark takes a level.
    const mark: [string, Role | ''] = [`(?:${skip?.pattern ?? ''})?`, 'skip'];
    const defLead: [string, Role | ''][] = !skip?.before
      ? [blanks]
      : p.syntax?.blockSkip?.levels === true
        ? [blanks, mark, blanks, mark, blanks]
        : [blanks, mark, blanks];
    rules.push(
      headRule([
        ...defLead,
        [numbers.length === 0 ? '' : `(?:${numbers.join('|')})?`, 'blockNumber'],
        blanks,
        [hasLabels ? `(?:${label})?` : '', 'section'],
        blanks,
        [`(?:${declaring.map(keywordPattern).join('|')})(?![A-Za-z0-9_])`, { token: 'keyword', next: 'declare' }],
      ]),
    );
    Object.assign(states, declareStates(p));
  }

  if (hasLabels) {
    // A label behind a block number is separated from it (`N40 LOOP_A:`); without the
    // separator the whole run is the name. The block number is written the way
    // `syntax.labels` writes it, digits right behind the prefix, so the grammar finds a
    // label on exactly the lines the tokenizer and the outline find one.
    if (!leadingInteger && prefix !== null) {
      rules.push(headRule([...lead, [`${prefix}\\d+`, 'blockNumber'], ['[ \\t]+', ''], [label, 'section']]));
    }
    rules.push(headRule([...lead, [label, 'section']]));
  }
  // The main block `:123` stands where a block number stands (§3.1 rule 2), and a leading
  // integer is a block number only there — anywhere else it is a value. The prefix is the
  // profile's `blockNumber.mainPrefix`, the one the tokenizer reads; a profile that sets none
  // keeps the colon this grammar has always painted.
  const mainPrefix = p.syntax?.blockNumber?.mainPrefix;
  const main = typeof mainPrefix === 'string' && mainPrefix !== '' ? mainPrefix : hasColonProgram(p) ? ':' : null;
  if (main !== null) rules.push(headRule([...lead, [`${escapeLiteral(main)}${gap}\\d+`, 'blockNumber']]));
  if (leadingInteger) rules.push(headRule([...lead, ['\\d+', 'blockNumber']]));
  if (skip?.before) rules.push(...stackedSkipRules(p, skip.pattern), [lineStart(`\\s*${skip.pattern}`), 'skip']);
  if (skip?.after && blockNumber !== null) {
    rules.push(
      headRule([
        ['\\s*', ''],
        [blockNumber, 'blockNumber'],
        ['\\s*', ''],
        [skip.pattern, 'skip'],
      ]),
    );
  }

  // Rule 4 once more: the block number `N123`, anywhere. The target of `GOTOF N200` is the
  // very number renumbering rewrites, so it is painted as the block number it refers to.
  if (blockNumber !== null) rules.push([blockNumber, 'blockNumber']);

  // The M12.5 fields that name text the tokenizer reads in one piece (`freeText`,
  // `colonWords`), if the profile sets them, and the name behind a jump keyword
  // (`syntax.labelAfter`): `GOTOF SKIPSIM` is a keyword and the label it names, which is
  // painted like the label's definition (`LOOP_A:`). `targetBehindKeyword` takes an
  // identifier that is not a keyword, a block number (`GOTOF N100` keeps its `N` word, which
  // a renumber rewrites) or a parameter (`GOTOB R10`), and that has no bracket, `(` or `=`
  // behind it (a call, an assignment, an indexed name).
  rules.push(...freeTextRules(p, new Set(orderedKeywords(p))));
  const colonWord = colonWordRule(p, numberPattern(p));
  if (colonWord !== null) rules.push(colonWord);
  const jumps = jumpKeywords(p);
  if (jumps.length > 0) {
    const ident = '[A-Za-z0-9_]';
    const words = orderedKeywords(p).filter((name) => /^[A-Za-z_]\w*$/.test(name));
    const vars = variablePattern(p);
    const notTarget = [
      words.length === 0 ? null : `(?!(?:${words.map(escapeLiteral).join('|')})(?!${ident}))`,
      !leadingInteger && prefix !== null ? `(?!${prefix}\\d+(?!${ident}))` : null,
      vars === null ? null : `(?!${nonCapturing(vars)}(?!${ident}))`,
    ];
    rules.push([
      `(${jumps.map(keywordPattern).join('|')})(\\s+)${notTarget.filter((guard) => guard !== null).join('')}([A-Za-z_]${ident}*)(?!${ident})(?!\\s*[(=\\[])`,
      ['keyword', '', 'section'],
    ]);
  }

  // Rules 6 and 7: system variables and R parameters, including the indirect `R[R2]`
  // (§3.6). Both are the `variable` role: which of them a program may write to is the
  // linter's business. A name that merely begins like one (`R1_SUB`) is a name.
  const system = p.syntax?.systemVariables;
  if (typeof system === 'string' && system !== '') rules.push([`(?:${system})`, 'variable']);
  const variables = variablePattern(p);
  const sigil = variableSigil(p);
  if (variables !== null) rules.push([`${variables}(?![\\w${point}])`, 'variable']);
  if (sigil !== null) rules.push([`${escapeLiteral(sigil)}${gap}(?=\\[)`, 'variable']);

  // Rules 8 to 10: the code letters and the subprogram call by number. A code carries no
  // decimal part on this control — there is no `G54.1` here — and the lookahead is what
  // keeps `G1X10` splitting into two words while `G1800` is not cut into `G180` and a 0.
  // An M function keeps its role with a spindle number in front of the `=` (`M3=3`,
  // rule 9), which is why these rules come before the assignment words.
  for (const { letter, role, digits } of CODE_LETTERS) {
    rules.push([`${escapeLiteral(letter)}${gap}${digits}(?![\\d${point}])`, role]);
  }
  rules.push([`${escapeLiteral(SUBPROGRAM_LETTER)}${gap}\\d+(?![\\d${point}])`, 'keyword']);

  // Rule 12: an address written with `=`. An address we know keeps the role it has with a
  // plain number behind it, and every other assignment word is a keyword: `S3=2500` drives
  // another spindle and `T1=4` names a tool on one, so neither may look like the spindle
  // or the tool word of the block. The rule comes **before** the plain addresses, or the
  // `S` of `S3=` would be read as the main spindle and its 3 as the speed.
  const assignment = p.syntax?.assignment;
  if (typeof assignment === 'string' && assignment !== '') {
    for (const [names, role] of addresses) {
      const pattern = namesPattern(names);
      // Directly in front of the `=`: `X=AC(10)` is the axis, `X3=10` is not.
      if (pattern !== null) rules.push([`${pattern}${ASSIGNED}`, role]);
    }
    // The indexed form (`syntax.assignmentIndex`): the identifier and its bracket, one word
    // in the tokenizer, and a keyword here for the same reason as any other assignment word
    // the dialect has no plain address for — `S[2]=500` drives spindle 2 and must not look
    // like the speed of the block, `LIMS[2]=1800` is a clamp of spindle 2.
    if (p.syntax?.assignmentIndex === true) rules.push([INDEXED_ASSIGNMENT, 'keyword']);
    // The built-in pattern already ends in that check; a derived one may not.
    rules.push([`${ASSIGNMENT_GUARD}(?:${assignment})${assignment.endsWith(ASSIGNED) ? '' : ASSIGNED}`, 'keyword']);
  }

  // `syntax.plainTextRun` (M12.5): a run of plain letters is one uncoloured piece, in front of
  // any address that would paint one of its letters.
  const keywords = alternation(orderedKeywords(p).map(keywordPattern));
  const plainText = plainTextRule(p, keywords);
  if (plainText !== null) rules.push(plainText);

  // Rule 13: the addresses with a plain number behind them.
  for (const [names, role] of addresses) {
    const pattern = namesPattern(names);
    if (pattern !== null) rules.push([`${pattern}${value}`, role]);
  }

  // Rules 14 and 11: a call, a name written in front of `(` — a cycle, a message, a
  // subprogram called by name, a function. A cycle needs no rule of its own, because it is
  // the same colour. Only the name is taken, so the arguments keep the colours of what
  // they are. Blanks may stand between the two where the identifier is a name of the
  // profile (`CYCLE840 (…)`, `MSG ("…")`), which is exactly where `core/nc/tokenizer.ts`
  // reads a call with them.
  if (p.syntax?.calls === true) {
    const names = p.syntax.names;
    const spaced = typeof names === 'string' && names !== '' ? `|(?:${names})(?![A-Za-z0-9_])(?=\\s+\\()` : '';
    rules.push([`(?:[A-Za-z_]\\w*(?=\\()${spaced})`, 'keyword']);
  }

  // Rule 15: the keywords, then any other name in **one** neutral token. A tokenizer cannot
  // tell a global user variable from a subprogram called by name (§3.6), and a scatter of
  // coloured letters would claim it could.
  if (keywords !== null) rules.push([`${keywords}(?![A-Za-z0-9_])`, 'keyword']);
  rules.push(['[A-Za-z_]\\w*', '']);

  // Rule 16: the numbers, a quoted hexadecimal or binary constant and the bare number with
  // its exponent. The sign is left to the operator rule, as in `iso.ts`: in `R1=R2-5` the
  // `-` is a subtraction, not part of the 5.
  rules.push([QUOTED_CONSTANT, 'number']);
  rules.push([`${numberPattern(p, { signed: false })}${exponent}`, 'number']);

  // Rules 17 to 19: the operators and brackets, the longer spellings first, and the
  // whitespace.
  const long = alternation(LONG_OPERATORS.map(escapeLiteral));
  if (long !== null) rules.push([long, 'operator']);
  const operators = operatorClass(p, '[]');
  if (operators !== null) rules.push([operators, 'operator']);
  rules.push(['\\s+', '']);

  return { rules, states };
}
