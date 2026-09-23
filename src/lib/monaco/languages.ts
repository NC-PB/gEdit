// Registering the dialects with Monaco (plan §5 WP3.4). Owner: WP3.4.
//
// One Monaco language per profile, with the profile id as the language id — that is what
// `EditorService.createModel(..., languageId, ...)` already passes, so a document opened
// as `heidenhain-klartext` is highlighted as Klartext without anything else changing.
//
// Three things are registered per profile:
//   `register`                   the id, its extensions and the display names
//   `setLanguageConfiguration`   the comment markers (so Ctrl+/ comments an NC block the
//                                way the dialect writes one), the bracket pairs, the
//                                auto-closing pairs and a word pattern that keeps an NC
//                                word (`X10.`, `G54.1`, `#101`, `CYCL`) in one piece, for
//                                double-click, Ctrl+arrow and the completion prefix
//   `setMonarchTokensProvider`   the generated grammar (`core/grammar`)
//
// The two generated themes are defined here as well, because this is the one place that
// holds the Monaco instance early enough: `monaco/theme.ts` only names a theme, and a name
// Monaco does not know falls back to `vs` without a word of warning.
//
// The Monaco instance is passed in rather than imported: `setup.ts` already has it, and
// nothing may import `$lib/monaco/core` statically (it would pull the whole editor into
// the initial bundle and evaluate it during prerender).

import { THEME_IDS, generateGrammar, generateThemes } from '$lib/core/grammar';
import { codes } from '$lib/stores/codes';
import { profiles } from '$lib/stores/profiles';
import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';
import type { Monaco } from '$lib/monaco/setup';

/** What the registration needs to know, so a test can hand over its own profiles. */
export interface LanguageSources {
  /** The profiles to register, in registry order. */
  list(): Profile[];
  /** The code database of one profile; an empty one is fine. */
  codeDb(profileId: string): CodeDb;
}

/** `ILanguageConfiguration`, typed here so the builder stays testable without Monaco. */
export interface LanguageConfiguration {
  comments: { lineComment?: string; blockComment?: [string, string] };
  brackets: [string, string][];
  autoClosingPairs: { open: string; close: string }[];
  surroundingPairs: { open: string; close: string }[];
  wordPattern: RegExp;
}

/** The bracket pairs a dialect could use, minus anything it spends on comments. */
const BRACKET_PAIRS: readonly [string, string][] = [
  ['[', ']'],
  ['(', ')'],
];

/**
 * The language configuration of one profile.
 *
 * `wordPattern` is the piece that matters for the assistant: Monaco asks it for the word
 * under the cursor, and WP3.6 looks that word up in the code database. An NC word is the
 * address and its value (`G54.1`, `X10.`, `Q200`), a variable with its sigil (`#101`), or
 * a bare number — never the sign, which is an operator.
 */
export function languageConfiguration(p: Profile): LanguageConfiguration {
  const markers = (p.syntax?.comments ?? []).filter((marker) => typeof marker?.start === 'string' && marker.start !== '');
  const line = markers.find((marker) => marker.end === null || marker.end === undefined);
  const block = markers.find((marker) => typeof marker.end === 'string' && marker.end !== '');
  const reserved = new Set(markers.flatMap((marker) => [marker.start[0], marker.end?.[0]]));

  const brackets = BRACKET_PAIRS.filter(([open, close]) => !reserved.has(open) && !reserved.has(close));
  const pairs = brackets.map(([open, close]) => ({ open, close }));
  // A comment is worth auto-closing even where its delimiters are not brackets: `(` is how
  // a Fanuc comment starts, and typing one should not leave it open.
  if (block) pairs.push({ open: block.start, close: block.end as string });
  if (p.grammar === 'klartext') pairs.push({ open: '"', close: '"' });

  const sigil = sigilOf(p);
  const point = (p.syntax?.decimalSeparator ?? '.').replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
  const branches = [
    ...(sigil === '' ? [] : [`${sigil}\\d+`]),
    `[A-Za-z_]+\\d*(?:${point}\\d*)?`,
    `\\d+(?:${point}\\d*)?`,
  ];
  const wordPattern = new RegExp(branches.map((branch) => `(?:${branch})`).join('|'), 'g');

  return {
    comments: {
      ...(line ? { lineComment: line.start } : {}),
      ...(block ? { blockComment: [block.start, block.end as string] as [string, string] } : {}),
    },
    brackets,
    autoClosingPairs: pairs,
    surroundingPairs: pairs,
    wordPattern,
  };
}

/**
 * The literal first character of `syntax.variables`, escaped for a regular expression, or
 * an empty alternative when the dialect has no sigil. Mirrors `variableLead` in
 * `core/nc/tokenizer.ts`, so the word Monaco hands the assistant is the word the tokenizer
 * would have produced.
 */
function sigilOf(p: Profile): string {
  const source = p.syntax?.variables;
  if (typeof source !== 'string' || source === '' || !/^[^\\^$.|?*+()[\]{}A-Za-z0-9]/.test(source)) return '';
  return source[0].replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

/**
 * The databases a document of this profile can be read with: its own, and the one each
 * declared variant choice names (AD-31).
 *
 * The Monaco **language id stays the profile id**, so a variant switch must never need a
 * new language — a model cannot change its language without being recreated, and
 * recreating it would lose the undo stack. The grammar is therefore built once, from the
 * union: it reads only addresses and non-numeric word codes (F49), and those are the same
 * in every variant of a dialect. What a code *means* is not in the grammar; that comes
 * from the document's effective database, on every hover and every completion.
 */
export function variantDialects(p: Profile): string[] {
  const out = typeof p.codes === 'string' && p.codes !== '' ? [p.codes] : [];
  for (const variant of p.machineParams?.variants ?? []) {
    for (const choice of variant.choices ?? []) {
      if (typeof choice?.codes === 'string' && choice.codes !== '' && !out.includes(choice.codes)) {
        out.push(choice.codes);
      }
    }
  }
  return out;
}

/**
 * One database out of several, for the grammar only: the addresses of all of them and
 * every code, the first spelling winning. It is never handed to hover or completion —
 * there, two variants disagreeing about what `G92` means is the whole point.
 */
export function unionCodeDb(dbs: readonly CodeDb[]): CodeDb {
  const first = dbs[0];
  if (dbs.length <= 1) return first ?? { dialect: '', version: 0, addresses: {}, codes: [] };
  const addresses: CodeDb['addresses'] = {};
  const codes: CodeDb['codes'] = [];
  const seen = new Set<string>();
  for (const db of dbs) {
    for (const [letter, value] of Object.entries(db.addresses ?? {})) {
      if (addresses[letter] === undefined) addresses[letter] = value;
    }
    for (const entry of db.codes ?? []) {
      if (seen.has(entry.code)) continue;
      seen.add(entry.code);
      codes.push(entry);
    }
  }
  return { dialect: first.dialect, version: first.version, addresses, codes };
}

/** Defines `gedit-dark` and `gedit-light`, so `monaco/theme.ts` can name them. */
export function defineThemes(monaco: Monaco, list: Profile[]): void {
  const themes = generateThemes(list);
  monaco.editor.defineTheme(THEME_IDS.dark, themes.dark as Parameters<typeof monaco.editor.defineTheme>[1]);
  monaco.editor.defineTheme(THEME_IDS.light, themes.light as Parameters<typeof monaco.editor.defineTheme>[1]);
}

/** Registers every profile of `sources` as a Monaco language. */
export function registerLanguages(monaco: Monaco, sources: LanguageSources): void {
  const list = sources.list();
  for (const p of list) {
    monaco.languages.register({
      id: p.id,
      extensions: (p.files?.extensions ?? []).map((extension) => `.${extension}`),
      aliases: [p.name, p.shortName].filter((alias): alias is string => typeof alias === 'string' && alias !== ''),
    });
    monaco.languages.setLanguageConfiguration(
      p.id,
      languageConfiguration(p) as Parameters<typeof monaco.languages.setLanguageConfiguration>[1],
    );
    monaco.languages.setMonarchTokensProvider(
      p.id,
      generateGrammar(p, sources.codeDb(p.id)) as Parameters<typeof monaco.languages.setMonarchTokensProvider>[1],
    );
  }
  defineThemes(monaco, list);
}

/** Registers every profile as a Monaco language, with its configuration and grammar. */
export function registerAll(monaco: Monaco): void {
  registerLanguages(monaco, {
    list: () => profiles.list().map((info) => profiles.profile(info.id)),
    codeDb: (profileId) => unionCodeDb(variantDialects(profiles.profile(profileId)).map((id) => codes.byId(id))),
  });
}
