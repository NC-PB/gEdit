// Generated Monarch grammars and the role palette (plan §7.4, AD-11). Owner: WP3.4.
//
// A grammar is generated from the profile, not hand-written per dialect. `profile.grammar`
// picks the shape — `iso` for word-address code (`syntax-fanuc.md` §3.8), `klartext` for
// the conversational block (`syntax-heidenhain.md` §3.2) — and everything inside it comes
// from the profile and the code database: the comment delimiters, the block-number prefix,
// the skip mark, the continuation, the variable pattern, the keywords, the axis, arc,
// feed, spindle and tool addresses, and the remaining address letters of the dialect.
//
// Every rule emits a **role** (`roles.ts`), and Monarch appends the profile id at
// registration, so a token is `feed.fanuc-gcode`. `defaultToken` is `''`, never `invalid`:
// marking errors is the linter's job, not the grammar's, and the generator never emits the
// `invalid` role at all. Anything the grammar does not recognise is left uncoloured.
//
// A grammar is one state, `root`, and stateless line by line, with one exception: the names a
// Sinumerik `DEF` block declares depend on what stood before them on the line, so that grammar
// has three more states (`sinumerik.ts`, `declareStates`), each of which ends at the first
// character of the next line. `syntax.freeText`, `colonWords`, `callTargets`, `labelAfter`
// and `plainTextRun` (M12.5) are rules of `root`, built so that the grammar paints what the
// tokenizer reads; `differential.test.ts` holds the two together.
//
// The module is Monaco-free (AD-1): `generateGrammar` returns a plain object that happens
// to be an `IMonarchLanguage`, which is what lets the whole generator be unit-tested in
// node and keeps Monaco out of the initial bundle.

import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';
import { isoRules } from './iso';
import { klartextRules } from './klartext';
import { okumaRules } from './okuma';
import { sinumerikRules, sinumerikStates } from './sinumerik';
import type { GrammarRule, MonarchGrammar } from './shared';

export {
  ROLES,
  ROLE_COLORS,
  ROLE_FONT_STYLE,
  THEME_IDS,
  THEME_BASE,
  EDITOR_COLORS,
  type Role,
} from './roles';
export { generateThemes, profileOverrides, type GeneratedTheme, type ThemeRule } from './themes';
export type { GrammarAction, GrammarEntry, GrammarRule, GrammarStep, MonarchGrammar } from './shared';

/**
 * The rule builder one profile asks for (P8).
 *
 * An unknown `grammar` falls back to `iso`, the word-address shape every ISO-style dialect
 * shares, rather than leaving a profile with no highlighting at all — which is also why a
 * user profile may name a grammar this version does not have yet.
 */
function rulesFor(p: Profile, db: CodeDb): GrammarRule[] {
  switch (p?.grammar) {
    case 'klartext':
      return klartextRules(p, db);
    case 'okuma':
      return okumaRules(p, db);
    case 'sinumerik':
      return sinumerikRules(p, db);
    default:
      return isoRules(p, db);
  }
}

/**
 * Builds the Monarch grammar for `p`. The return value is an `IMonarchLanguage`; it is
 * typed loosely here so that `core/` keeps its Monaco-free rule (AD-1) and the generator
 * stays unit-testable in node.
 */
export function generateGrammar(p: Profile, db: CodeDb): Record<string, unknown> {
  const rules = rulesFor(p, db);
  const grammar: MonarchGrammar = {
    defaultToken: '',
    ignoreCase: p?.syntax?.caseSensitive !== true,
    tokenizer: { root: rules, ...(p?.grammar === 'sinumerik' ? sinumerikStates(p, db) : {}) },
  };
  return grammar as unknown as Record<string, unknown>;
}
