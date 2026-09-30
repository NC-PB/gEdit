// The contradiction guard (R1, TODO Next up 5): a rewrite by a dialect's rules refuses
// to run on a program whose own text says it is written in another dialect.
//
// Detection (`detect.ts`) weighs evidence and can be wrong, and the user can choose a
// dialect by hand. Either way, Remove Comments and Renumber then rewrite the program by
// the wrong comment, string and block-number rules: under the Fanuc profile a Siemens
// `MCALL CYCLE83 (52,50,2,-4.887)` loses its arguments as a "comment", and every Klartext
// block of a `BEGIN PGM` program gets an `N10` in front of it. This module answers one
// question before any such rewrite: does the text carry something only another dialect
// writes? It is not a second detection. It never weighs, never picks the best of several
// dialects and never looks at the file name; it looks for **certain** evidence only.
//
// - A **header** decides alone: a Klartext `BEGIN PGM` block, a Sinumerik `%_N_…_MPF`
//   or `;$PATH=` line, an Okuma `$NAME.MIN%` line, a Fanuc tape start `O1234`. It is
//   looked for in the first `HEADER_LINES` non-empty lines, where a control writes it.
//   A program whose header is certain for its own dialect is never refused for a marker
//   further down: the header is the statement, a stray line is a stray line.
// - A **marker** is a line only another dialect writes (a Siemens call with arguments,
//   an Okuma sequence name, a Fanuc lathe cycle with `P`/`Q`). It counts in the first
//   `GUARD_LINES` non-empty lines, and one is enough, because one is enough to be wrecked.
//
// "Only another dialect writes" is decided by the profile's `grammar`, the syntax family
// the comment, string and block-number rules come from (plan §7.4): a user profile that
// extends Sinumerik reads `;` as Sinumerik does, so a Sinumerik program is its own. Where
// a marker is also valid in one other grammar, that grammar is spared (`$` at the start of
// a Sinumerik line is a system variable; `CR=` is an Okuma `G303` word too).
//
// Cost: the header lines plus at most `GUARD_LINES` non-empty lines, each tried against a
// fixed list of anchored patterns — the same bound as detection, and it stops at the
// first hit. Deterministic: the answer depends on the text and the grammar only.

import type { Msg } from '$lib/app/types';
import type { CompiledProfile, Profile } from './types';

/** How many non-empty lines are scanned for a marker (detection's bound, `MAX_SNIFF_LINES`). */
export const GUARD_LINES = 400;

/** How many leading non-empty lines may carry a header. */
export const HEADER_LINES = 5;

/**
 * The most lines read to find `GUARD_LINES` non-empty ones: a file that opens with
 * thousands of empty lines is not scanned to its end.
 */
export const GUARD_READ_LIMIT = 20_000;

/** The syntax family of a profile (plan §7.4): what its comments, strings and numbers are. */
export type Grammar = Profile['grammar'];

/** What the guard found: the dialect the text is written in, and the line that says so. */
export interface Contradiction {
  /** The syntax family the evidence belongs to. */
  grammar: Grammar;
  /** The built-in profile a user most likely wants instead. */
  likely: string;
  /** Its short name, as the dialect picker shows it (data, untranslated). */
  dialect: string;
  /** 1-based line of the evidence, counted over the lines handed in. */
  line: number;
  /** The evidence as written, cut to `EVIDENCE_CHARS`. */
  text: string;
  /** A header (decides alone) or a marker line. */
  kind: 'header' | 'marker';
}

/** How much of the evidence the message quotes. */
export const EVIDENCE_CHARS = 32;

interface Evidence {
  grammar: Grammar;
  likely: string;
  dialect: string;
  kind: 'header' | 'marker';
  re: RegExp;
  /** Grammars on which the same text is valid too, so it contradicts nothing there. */
  spares?: readonly Grammar[];
}

const KLARTEXT = { grammar: 'klartext', likely: 'heidenhain-klartext', dialect: 'Heidenhain' } as const;
const SINUMERIK = { grammar: 'sinumerik', likely: 'sinumerik', dialect: 'Sinumerik' } as const;
const OKUMA = { grammar: 'okuma', likely: 'okuma-osp', dialect: 'Okuma' } as const;
const FANUC = { grammar: 'iso', likely: 'fanuc-gcode', dialect: 'Fanuc' } as const;
const FANUC_LATHE = { grammar: 'iso', likely: 'fanuc-lathe', dialect: 'Fanuc' } as const;

/**
 * The evidence, tried in this order. Every pattern is anchored at the line start and reads
 * the line once (no pattern tries every position of a long line). `[^(;]*` in front of a
 * marker keeps it out of a Fanuc or Okuma `( … )` comment and a Siemens or Klartext `;`
 * comment, whichever dialect the program is read with: a note that mentions `CYCLE800(` is
 * not a call.
 *
 * Flags: `i`, like the profiles (`compileProfile` adds it unless a profile is case
 * sensitive; all five built-ins are not).
 */
const EVIDENCE: readonly Evidence[] = [
  // Headers.
  { ...KLARTEXT, kind: 'header', re: /^\d+[ \t]+BEGIN[ \t]+PGM[ \t]+\S+[ \t]+(?:MM|INCH)(?![A-Z0-9_])/i },
  { ...SINUMERIK, kind: 'header', re: /^%_N_\w+_(?:MPF|SPF)(?![A-Z0-9])/i },
  { ...SINUMERIK, kind: 'header', re: /^;\$PATH=/i },
  { ...OKUMA, kind: 'header', re: /^\$[\w-]+\.(?:MIN|SUB|SSB|SDF)%/i },
  // A Fanuc tape starts with its program number; Okuma writes the same line.
  { ...FANUC, kind: 'header', re: /^[O:]\d{1,8}(?![\d.])/i, spares: ['okuma'] },

  // Klartext: a block number, a blank and a Klartext statement; no other dialect starts a
  // line with a bare number.
  {
    ...KLARTEXT,
    kind: 'marker',
    re: /^\d+[ \t]+(?:L|LN|LP|CC|CR|CT|CP|RND|CHF|APPR|DEP|LBL|TOOL[ \t]+CALL|CYCL[ \t]+(?:DEF|CALL)|END[ \t]+PGM|BLK[ \t]+FORM)(?![A-Z0-9_])/i,
  },
  // Sinumerik: calls with arguments, absolute/incremental value functions, operator
  // messages and tool names as strings, arc radii and transformations.
  { ...SINUMERIK, kind: 'marker', re: /^[^(;]*(?<![A-Z0-9_$])CYCLE\d+[ \t]*\(/i },
  { ...SINUMERIK, kind: 'marker', re: /^[^(;]*=[ \t]*(?:AC|IC|DC|ACP|ACN)[ \t]*\(/i },
  { ...SINUMERIK, kind: 'marker', re: /^[^(;]*(?<![A-Z0-9_$])MSG[ \t]*\([ \t]*"/i },
  { ...SINUMERIK, kind: 'marker', re: /^[^(;]*(?<![A-Z0-9_$])T\d*[ \t]*=[ \t]*"/i },
  { ...SINUMERIK, kind: 'marker', re: /^[^(;]*(?<![A-Z0-9_$])(?:MCALL|TRAORI|TRAFOOF|WORKPIECE[ \t]*\()/i },
  { ...SINUMERIK, kind: 'marker', re: /^[^(;]*(?<![A-Z0-9_$])CR[ \t]*=/i, spares: ['okuma'] },
  // Okuma: sequence names (a Sinumerik line may start with a command such as `NORM`), LAP
  // calls by name, subprogram calls (Sinumerik has `CALL` too) and returns, the `$`
  // continuation line (a Sinumerik line may start with a `$` system variable)…
  { ...OKUMA, kind: 'marker', re: /^[ \t]*(?:\/[ \t]*)?N[A-Z][A-Z0-9]{0,3}(?=[ \t]|$)/i, spares: ['sinumerik'] },
  { ...OKUMA, kind: 'marker', re: /^[^(;]*(?<![A-Z])G0*8[5-8][ \t]*N[A-Z][A-Z0-9]{0,3}(?![A-Z0-9])/i },
  { ...OKUMA, kind: 'marker', re: /^[^(;]*(?<![A-Z])(?:CALL|MODIN)[ \t]+O[A-Z0-9]{1,4}(?![A-Z0-9_])/i, spares: ['sinumerik'] },
  { ...OKUMA, kind: 'marker', re: /^[ \t]*(?:N\w+[ \t]+)?(?:RTS|MODOUT)(?![A-Z0-9])/i },
  { ...OKUMA, kind: 'marker', re: /^\$(?:[ \t]+[A-Z]|[A-Z]{1,2}[-+.\d= \t])/i, spares: ['sinumerik'] },
  // …and its G71/G72 thread cycle, which carries a thread height H and a first cut D and
  // no P: a Fanuc G71/G72 is a roughing cycle, and a feed script would take its lead for
  // a feed.
  {
    ...OKUMA,
    kind: 'marker',
    re: /^(?=[^(;]*(?<![A-Z])H[-+]?[.\d])(?=[^(;]*(?<![A-Z])D[-+]?[.\d])(?![^(;]*(?<![A-Z])P[-+]?[.\d])[^(;]*(?<![A-Z])G0*7[12](?![\d.])/i,
  },
  // Fanuc: a lathe cycle that names its contour by P and Q (Okuma's G71/G72 are thread
  // cycles and take neither), and macro variables.
  {
    ...FANUC_LATHE,
    kind: 'marker',
    re: /^(?=[^(;]*(?<![A-Z])P[ \t]*\d)(?=[^(;]*(?<![A-Z])Q[ \t]*\d)[^(;]*(?<![A-Z])G0*7[0-2](?![\d.])/i,
  },
  { ...FANUC, kind: 'marker', re: /^[^(;]*(?<![A-Z0-9_$])#\d+[ \t]*=/i },
];

/** Whether `evidence` says the text is not written in `grammar`. */
function contradicts(evidence: Evidence, grammar: Grammar): boolean {
  return evidence.grammar !== grammar && !(evidence.spares ?? []).includes(grammar);
}

function quote(line: string): string {
  return line.length <= EVIDENCE_CHARS ? line : `${line.slice(0, EVIDENCE_CHARS - 1)}…`;
}

/**
 * The first certain evidence in `lines` that the text is not written in `cp`'s dialect, or
 * `null`. `lines` are the document's first lines, in order; line numbers count from 1 over
 * them, empty lines included. More lines than the scan needs are ignored.
 */
export function findContradiction(cp: CompiledProfile, lines: readonly string[]): Contradiction | null {
  const grammar = cp.profile.grammar;
  let nonEmpty = 0;
  let ownHeader = false;

  for (let i = 0; i < lines.length && nonEmpty < GUARD_LINES; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    nonEmpty++;
    const inHeader = nonEmpty <= HEADER_LINES;

    for (const evidence of EVIDENCE) {
      if (evidence.kind === 'header' && !inHeader) continue;
      if (evidence.kind === 'marker' && ownHeader) continue;
      if (!evidence.re.test(line)) continue;
      if (!contradicts(evidence, grammar)) {
        // The program states its own dialect: markers further down do not overrule it. A
        // header two dialects write (`O1234`) states neither.
        if (evidence.kind === 'header' && evidence.grammar === grammar && !evidence.spares) ownHeader = true;
        continue;
      }
      return {
        grammar: evidence.grammar,
        likely: evidence.likely,
        dialect: evidence.dialect,
        line: i + 1,
        text: quote(line),
        kind: evidence.kind,
      };
    }
  }
  return null;
}

/**
 * The document's first lines, read in chunks until the scan has what it needs: a 10 MB
 * program is never read whole. `read(first, last)` is 1-based and inclusive, like
 * `EditorService.getLines`.
 */
export function leadingLines(read: (first: number, last: number) => string[], lineCount: number): string[] {
  const out: string[] = [];
  let nonEmpty = 0;
  const chunk = GUARD_LINES * 2;
  for (let first = 1; first <= lineCount && nonEmpty < GUARD_LINES && out.length < GUARD_READ_LIMIT; first += chunk) {
    const last = Math.min(lineCount, first + chunk - 1);
    for (const line of read(first, last)) {
      out.push(line);
      if (line.trim() !== '') nonEmpty++;
    }
  }
  return out;
}

/**
 * The transforms whose rewrite depends on the dialect's comment, string or block-number
 * syntax, by `TransformDef.id`. Each one refuses on a contradicted program:
 *
 * - `remove-comments`: what a comment is (`( … )` or `;`) is the dialect's.
 * - `renumber`, `remove-block-numbers`: what a block number is (`N10`, a Klartext leading
 *   integer, an Okuma sequence name) and which words point at one.
 * - `insert-spaces`, `remove-spaces`: where a word ends, and that strings and comments
 *   are left alone.
 * - `convert-case`: that strings (Siemens tool names) and, on request, comments keep
 *   their case.
 *
 * `remove-empty-lines` is not guarded: an empty line is empty in every dialect, and the
 * transform reads nothing else.
 */
export const GUARDED_TRANSFORMS: ReadonlySet<string> = new Set([
  'remove-comments',
  'renumber',
  'remove-block-numbers',
  'insert-spaces',
  'remove-spaces',
  'convert-case',
]);

/**
 * Whether a script run with this header `output` is guarded. A script reads the program
 * through the profile it is handed (it never detects one itself), so its result is only as
 * right as the dialect: `replace` writes that result over the program, `new-document`
 * hands it over as a program. `panel` and `report` only show something and change no text.
 */
export function guardsScriptOutput(output: string | undefined): boolean {
  return output === 'replace' || output === 'new-document';
}

/** The i18n keys the refusal uses, one per namespace that shows it. */
export const CONTRADICTION_KEYS = {
  transforms: 'transforms.contradiction',
  scripts: 'scripts.contradiction',
} as const;

/**
 * The refusal for a rewrite named `action` (the transform's title or the script's label)
 * under `cp`, or `null` when the program does not contradict its dialect. `ns` picks the
 * namespace of the message: the transform runner's or the script runner's.
 */
export function contradictionRefusal(
  cp: CompiledProfile,
  read: (first: number, last: number) => string[],
  lineCount: number,
  action: string,
  ns: keyof typeof CONTRADICTION_KEYS,
): Msg | null {
  const found = findContradiction(cp, leadingLines(read, lineCount));
  if (found === null) return null;
  return {
    key: CONTRADICTION_KEYS[ns],
    params: {
      action,
      profile: cp.profile.name,
      likely: found.dialect,
      line: found.line,
      evidence: found.text,
    },
  };
}
