// Search contracts (plan §7.6, AD-25). Written by the M11 prelude (P11); binding.
// WP11.1 implements `index.ts`, the `search.*` commands and the `nc.replace` transform.
//
// A query is one of two kinds:
//
//  - **A word** (`T1`, `G01`, `S`, `S>12000`, `F<=0`, `SB=500`, `Q206`): matched on the
//    tokenizer's `word` tokens by address and **decimal value as written** — `1` = `01` =
//    `1.` = `1.0`, `T1` ≠ `T10`. Comments and strings never match (they are other token
//    kinds). A value condition compares the value as written, never converted by the
//    machine (D51): `X>50` finds `X60` and `X60.` alike, and the search form says so. The
//    address is read with the profile (an assignment identifier such as Okuma `SB` or
//    Sinumerik `S1` is one address). On the program-number address (Fanuc `O`, `:`) a word
//    query also finds the calls that name that program: the parameters the code database
//    marks with `CodeParam.programNumber` (`M98 P`, `G65 P`, `G66 P`; §7.16 #136).
//  - **Text** — literal or a regular expression (the editor's JS flavour) on the line as
//    written; with `inComments` false, a hit that overlaps a comment is not a hit
//    (`maskComments` from `core/nc/mask.ts` blanks comments and keeps strings).

import type { Msg } from '$lib/app/types';

export type WordOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

export type SearchQuery =
  | { kind: 'word'; address: string; op?: WordOp; value?: string /* decimal text; absent = any value */ }
  | { kind: 'text'; text: string; regex: boolean; caseSensitive: boolean; inComments: boolean };

export interface SearchHit {
  /** 1-based. */
  line: number;
  /** 0-based columns, `end` exclusive (Monaco ranges add 1). */
  start: number;
  end: number;
  /** The line as written, for the Results panel. */
  text: string;
}

/** What the search form hands to `parseQuery` (the form ids of §7.12). */
export interface SearchFlags {
  wholeAddress: boolean;
  regex: boolean;
  caseSensitive: boolean;
  inComments: boolean;
}

/** The cap of find-all (AD-25): beyond it the panel shows a "dropped" count. */
export const SEARCH_MAX_HITS = 10_000;

export type ParseQueryResult = SearchQuery | { error: Msg };
