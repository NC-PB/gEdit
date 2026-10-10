// The generated grammars against the tokenizer (B1-G).
//
// `core/nc/tokenizer.ts` is the source of truth for hover, outline and the program checks; the
// Monarch grammar of `core/grammar` only paints. They are two separate scanners, and the
// M12.5 `syntax` fields (`freeText`, `colonWords`, `callTargets`, `labelAfter`, `declareAfter`,
// `plainTextRun`, a keyword shaped like a sequence name) were read by the first and not by
// the second: a Klartext cycle name was painted word by word, `GOTOF SKIPSIM` showed no
// label, and so on. Nothing held the two together, so the drift went unseen.
//
// This test does. For every built-in profile it takes the lines of the token goldens
// (`tests/fixtures/tokens`), every NC fixture of the dialect and a list of lines written for
// the shapes above, tokenizes each with the real tokenizer and with the Monarch grammar, and
// requires that the role the grammar gives to each character is one the token at that
// character allows. `ALLOWED` is the one table that says which — a token kind, and for a
// word its address, to the roles that may paint it. Where the grammar knowingly paints
// differently, `WAIVERS` says so, with the reason; a waiver that no line uses any more
// fails the test, so the list cannot go stale.
//
// The grammar is stateless line by line, the tokenizer is not for the one thing a Klartext
// block can carry over (`~`); lines that continue the one above are left out.

import { describe, expect, it } from 'vitest';
import { monarchRun, rolePerChar } from './monarchSim';
import { DIALECTS, corpus, type Dialect } from './testCorpus';
import { letterAddresses, wordCodes } from './shared';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { Profile } from '$lib/core/profiles/types';
import type { NcToken } from '$lib/core/nc/types';

// ---------------------------------------------------------------------------------------
// The table: which grammar roles may paint a token. `null` means "any role": the token holds
// parts that are tokens of their own to the grammar (an expression, the argument list of a call).
// ---------------------------------------------------------------------------------------

type Allowed = readonly string[] | null;

/** Token kinds whose colour does not depend on anything but the kind. */
const ALLOWED: Readonly<Record<string, Allowed>> = {
  whitespace: [''],
  blockNumber: ['blockNumber'],
  skip: ['skip'],
  // A structure block is read as a comment and painted as a section (Klartext `12 * - NOTE`).
  comment: ['comment', 'section'],
  // A Sinumerik label, an Okuma sequence name, and the name behind a Sinumerik jump.
  label: ['section'],
  programMarker: ['programMarker'],
  continuation: ['operator'],
  string: ['string'],
  variable: ['variable'],
  operator: ['operator'],
  expression: null,
  // `text` is the text the control keeps and does not execute: one uncoloured piece.
  text: [''],
  // Names and plain text the profile gives no meaning to.
  unknown: [''],
};

/** A value that is a plain number; anything else (`Q5`, `[#1/2]`, `R10`) is an expression to the grammar. */
const PLAIN_NUMBER = /^[+-]?(?:\d+[.,]?\d*|[.,]\d+)(?:EX[+-]?\d+)?$/i;

/** The roles that may paint a word whose address is `address`, by what the profile says it is. */
function addressRoles(dialect: Dialect, address: string, text: string): string[] {
  const { profile } = dialect;
  const own = letterAddresses(profile);
  const upper = address.toUpperCase();
  const roles: string[] = [];
  // The words of the code database (Klartext `R0`, `RL`, `DR+`) are keywords to the grammar
  // and words to the tokenizer.
  if (wordCodes(dialect.db, ['M']).includes(text.toUpperCase())) roles.push('keyword');
  const family = (letter: string | null): boolean => letter !== null && upper.length > 1 && upper.startsWith(letter);
  // A rotation direction (`DR-`) is one of those words too: a lone sign behind the letters.
  if (/^[A-Z]+[+-]$/.test(text.toUpperCase())) roles.push('keyword');
  if (own.tool === upper) roles.push('tool');
  // A longer address that starts with the feed or spindle letter (`FQ`, `SMAX`) is the feed or
  // the speed where the database knows it, and a plain address where it does not (`SPA`).
  else if (own.feed === upper) roles.push('feed');
  else if (own.spindle === upper) roles.push('spindle');
  else if (family(own.feed)) roles.push('feed', 'number', '');
  else if (family(own.spindle)) roles.push('spindle', 'number', '');
  else if (own.axes.includes(upper)) roles.push('axis');
  else if (own.arcCenter.includes(upper)) roles.push('arcCenter');
  else if (upper === 'G') roles.push('gcode');
  else if (upper === 'M') roles.push('mcode');
  else {
    const prefixes = [profile.syntax.blockNumber?.prefix, ...(profile.syntax.blockNumber?.altPrefixes ?? [])].filter(
      (name): name is string => typeof name === 'string' && name !== '',
    );
    // Any other address is a plain value: `number`, or uncoloured where the dialect knows no
    // such address. Never one of the roles that mean something on their own.
    roles.push('number', '', ...(prefixes.some((prefix) => prefix.toUpperCase() === upper) ? ['blockNumber'] : []));
  }
  return roles;
}

/** The roles that may paint the characters of `token`, one entry per character (null = any). */
function allowedPerChar(token: NcToken, dialect: Dialect): Allowed[] {
  const length = token.end - token.start;
  const all = (allowed: Allowed): Allowed[] => Array.from({ length }, () => allowed);
  const perChar = ((): Allowed[] => {
    switch (token.kind) {
      case 'keyword':
        // `GOTO100`: the keyword and the number its target belongs to.
        return token.valueText === undefined ? all(['keyword']) : all(['keyword', 'number']);
      case 'call': {
        // The name is the call; its arguments are tokens of their own to the grammar. A name
        // that stands alone in its block (`HOME`) is a call to the tokenizer, but a grammar
        // cannot tell it from any other name.
        const open = token.text.indexOf('(');
        const name = open < 0 ? length : open;
        return [...Array.from({ length: name }, () => ['keyword', ''] as Allowed), ...Array.from({ length: length - name }, () => null)];
      }
      case 'word': {
        // An assignment (`SB=1200`, `X=V1+V2`) names a word the grammar paints in parts.
        if (token.text.includes('=')) return all(null);
        const address = token.address ?? '';
        if (address === '') return all(['number', 'variable', 'blockNumber', '']);
        const roles = addressRoles(dialect, address, token.text);
        // A word without a value stands alone (`TOOL CALL 5 Z`, `F AUTO`).
        if (token.valueText === undefined) return all([...roles, '']);
        // The value of a word keeps the role of its address while it is a number; a variable
        // or an expression (`X#101`, `F[#3*0.5]`) is painted in its parts.
        const split = length - token.valueText.length;
        return Array.from({ length }, (_, i): Allowed => (i < split || PLAIN_NUMBER.test(token.valueText!) ? roles : null));
      }
      default:
        return all(ALLOWED[token.kind] ?? null);
    }
  })();
  // A blank inside a token (`GOTO 200`, `N 10`, `X 50`) may stay uncoloured; in a comment or a
  // string it takes the colour of the whole.
  return perChar.map((allowed, i) => (/\s/.test(token.text[i]) && allowed !== null ? [...allowed, ''] : allowed));
}

// ---------------------------------------------------------------------------------------
// Where the grammar knowingly differs. Every entry is a rule that must be used by some line.
// ---------------------------------------------------------------------------------------

interface Waiver {
  profiles: readonly string[];
  reason: string;
  /** True when this mismatch (the token, the role the grammar gave, the line) is the known one. */
  applies(token: NcToken, role: string, line: string): boolean;
}

const WAIVERS: Waiver[] = [
  {
    profiles: ['okuma-osp'],
    reason: 'a function name in front of its bracket is a keyword to the grammar (FUNCTION_NAME), a name to the tokenizer',
    applies: (token, role, line) => token.kind === 'unknown' && role === 'keyword' && line.slice(token.end).trimStart().startsWith('['),
  },
  {
    profiles: ['okuma-osp'],
    reason: 'a local variable of up to four characters is painted as a variable (syntax-okuma §3.6), the tokenizer calls it a name',
    applies: (token, role) => token.kind === 'unknown' && role === 'variable' && /^[A-Za-z]{2}[A-Za-z0-9]{0,2}$/.test(token.text),
  },
  {
    profiles: ['okuma-osp'],
    reason: 'a T word of the wrong length is a word to the tokenizer and left uncoloured by the grammar, for the linter to report',
    applies: (token, role) => token.kind === 'word' && token.address === 'T' && role === '',
  },
  {
    profiles: ['sinumerik', 'sinumerik-mill'],
    reason: 'a two-letter address with a number (CR15) is a name to the tokenizer and an address word to the grammar',
    applies: (token, role) => ['call', 'unknown'].includes(token.kind) && role === 'number' && /^[A-Za-z]{1,2}\d+$/.test(token.text),
  },
  {
    profiles: ['sinumerik', 'sinumerik-mill'],
    reason: 'L<n> is the call of a subprogram by number to the grammar (rule 10), an L word to the tokenizer',
    applies: (token, role) => token.kind === 'word' && token.address === 'L' && role === 'keyword',
  },
  {
    profiles: ['sinumerik', 'sinumerik-mill'],
    reason: 'an address with a bracket expression as its value (X[1]) is a name and brackets to the grammar, which takes a computed value after an =',
    applies: (token, role) => token.kind === 'word' && /^[A-Za-z]\[/.test(token.text) && role === '',
  },
];

// ---------------------------------------------------------------------------------------

interface Mismatch {
  line: string;
  token: string;
  kind: string;
  role: string;
}

/** The mismatches of one dialect, waived ones counted by reason. */
function compare(dialect: Dialect): { mismatches: Mismatch[]; waived: Map<string, number>; lines: number } {
  const mismatches: Mismatch[] = [];
  const waived = new Map<string, number>();
  const heading = dialect.cp.re.sectionHeading;
  let lines = 0;
  for (const { line, prev } of corpus(dialect)) {
    if (prev?.continuation === true) continue;
    lines += 1;
    const roles = rolePerChar(dialect.grammar, line);
    const isHeading = heading !== null && heading !== undefined && heading.test(line);
    for (const token of tokenizeLine(line, dialect.cp, prev).tokens) {
      const allowed = allowedPerChar(token, dialect);
      for (let i = 0; i < allowed.length; i++) {
        const role = roles[token.start + i] ?? '';
        if (token.kind === 'whitespace' || allowed[i] === null || allowed[i]!.includes(role)) continue;
        // A structure block is painted as one heading, whatever its words are.
        if (isHeading && role === 'section') continue;
        const waiver = WAIVERS.find((entry) => entry.profiles.includes(dialect.id) && entry.applies(token, role, line));
        if (waiver) {
          waived.set(waiver.reason, (waived.get(waiver.reason) ?? 0) + 1);
          continue;
        }
        mismatches.push({ line, token: token.text, kind: token.kind, role });
        break;
      }
    }
  }
  return { mismatches, waived, lines };
}

describe('the grammar paints what the tokenizer reads', () => {
  const results = new Map(DIALECTS.map((dialect) => [dialect.id, compare(dialect)]));

  it.each(DIALECTS.map((dialect) => dialect.id))('%s: every character has a role its token allows', (id) => {
    const { mismatches, lines } = results.get(id)!;
    expect(lines).toBeGreaterThan(60);
    const shown = mismatches.slice(0, 25).map((m) => `${m.kind} ${JSON.stringify(m.token)} painted ${m.role || '(none)'} in ${JSON.stringify(m.line)}`);
    expect(shown, `${mismatches.length} mismatches`).toEqual([]);
  });

  it('keeps no waiver that no line needs any more', () => {
    const used = new Set([...results.values()].flatMap((result) => [...result.waived.keys()]));
    expect(WAIVERS.map((waiver) => waiver.reason).filter((reason) => !used.has(reason))).toEqual([]);
  });
});

describe('a state never outlives its line', () => {
  const sinumerik = DIALECTS.find((dialect) => dialect.id === 'sinumerik')!;

  it.each([
    ['DEF INT A'],
    ['DEF INT'],
    ['DEF REAL A[3,'],
    ['DEF STRING[32'],
    ['N10 DEF INT A, B=SIN('],
    ['DEF'],
    ['DEF INT A ; comment'],
  ])('%s', (line) => {
    const { stack } = monarchRun(sinumerik.grammar, line);
    // Whatever state the line ends in, the next line starts as a line of the base state does.
    for (const next of ['N20 G1 X10', 'GOTOF LOOP_A', '  X5 Y6', '', 'DEF INT A,B', ';NOTE']) {
      expect(rolePerChar(sinumerik.grammar, next, stack), next).toEqual(rolePerChar(sinumerik.grammar, next));
      expect(monarchRun(sinumerik.grammar, next, stack).stack, next).toEqual(monarchRun(sinumerik.grammar, next).stack);
    }
  });
});
