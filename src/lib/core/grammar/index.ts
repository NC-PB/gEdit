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
// The module is Monaco-free (AD-1): `generateGrammar` returns a plain object that happens
// to be an `IMonarchLanguage`, which is what lets the whole generator be unit-tested in
// node and keeps Monaco out of the initial bundle.

import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';
import { isoRules } from './iso';
import { klartextRules } from './klartext';
import type { MonarchGrammar } from './shared';

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
export type { GrammarAction, GrammarRule, MonarchGrammar } from './shared';

/**
 * Builds the Monarch grammar for `p`. The return value is an `IMonarchLanguage`; it is
 * typed loosely here so that `core/` keeps its Monaco-free rule (AD-1) and the generator
 * stays unit-testable in node.
 *
 * An unknown `grammar` falls back to `iso`, the word-address shape every ISO-style dialect
 * shares, rather than leaving a profile with no highlighting at all.
 */
export function generateGrammar(p: Profile, db: CodeDb): Record<string, unknown> {
  const rules = p?.grammar === 'klartext' ? klartextRules(p, db) : isoRules(p, db);
  const grammar: MonarchGrammar = {
    defaultToken: '',
    ignoreCase: p?.syntax?.caseSensitive !== true,
    tokenizer: { root: rules },
  };
  return grammar as unknown as Record<string, unknown>;
}
