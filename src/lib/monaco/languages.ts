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
  // A dialect with strings closes them: Klartext tool and label names, and the `T="…"`,
  // `MSG("…")` and `EXTCALL "…"` of a Sinumerik program (P8).
  if (p.syntax?.strings === true) pairs.push({ open: '"', close: '"' });

  const sigil = sigilOf(p.syntax?.variables);
  const systemSigil = sigilOf(p.syntax?.systemVariables);
  const escape = (text: string): string => text.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
  const point = escape(p.syntax?.decimalSeparator ?? '.');
  // B1: the second decimal mark (`syntax.decimalSeparatorAlt`, the Klartext comma) keeps a
  // number in one piece too, so a double-click on `241,781` selects all of it. It needs a
  // digit behind it, as in the tokenizer, so a comma between two words stays a comma.
  const alt = p.syntax?.decimalSeparatorAlt;
  const fraction =
    typeof alt === 'string' && alt.length === 1 && alt !== (p.syntax?.decimalSeparator ?? '.')
      ? `(?:${point}\\d*|${escape(alt)}\\d+)`
      : `(?:${point}\\d*)`;
  // Order is the whole of it: Monaco takes the first branch that matches where the cursor
  // is. The longer, more specific forms come first, so `$AA_IM` is not read as the
  // identifier `AA_IM` next to an operator and `SB=` is not read as the address `SB`
  // (P8: `T010101`, `SB=`, `NLAP1`, `CYCLE81`, `$AA_IM` and `R10` each stay one word).
  const branches = [
    ...(systemSigil === '' ? [] : [`${systemSigil}[A-Za-z_][A-Za-z0-9_]*`]),
    ...(sigil === '' ? [] : [`${sigil}\\d+`]),
    ...(typeof p.syntax?.assignment === 'string' && p.syntax.assignment !== ''
      ? [`[A-Za-z_][A-Za-z0-9_]*=`]
      : []),
    `[A-Za-z_]+\\d*${fraction}?`,
    `\\d+${fraction}?`,
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
 * The literal first character of a variable pattern, escaped for a regular expression, or
 * an empty alternative when the dialect has no sigil. Mirrors `variableLead` in
 * `core/nc/tokenizer.ts`, so the word Monaco hands the assistant is the word the tokenizer
 * would have produced.
 *
 * A pattern that begins with an escape (`\$` of the Sinumerik system variables) leads with
 * that character, and one that begins with a letter (Okuma's `V[A-Z]…`) has no sigil at
 * all — its names are ordinary identifiers, which the identifier branch already keeps in
 * one piece.
 */
function sigilOf(source: string | undefined): string {
  if (typeof source !== 'string' || source === '') return '';
  // `\$…` states the character; anything else has to be a plain one to be a sigil.
  const escaped = source.startsWith('\\');
  const lead = escaped ? source[1] : source[0];
  if (lead === undefined || /[A-Za-z0-9]/.test(lead)) return '';
  if (!escaped && /[\\^$.|?*+()[\]{}]/.test(lead)) return '';
  return lead.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
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

/** What was handed to Monaco for one language id, so a second call can tell a change from none. */
interface Registered {
  profile: Profile;
  db: CodeDb;
  /** `JSON.stringify` of the two, built when a later call needs to compare (identity decides first). */
  signature?: string;
}

/** Per Monaco instance (a test makes its own), the languages it has been given. */
const registered = new WeakMap<Monaco, Map<string, Registered>>();

/** Per Monaco instance, the ids `register` was called for: an id is registered once, whatever else fails. */
const registeredIds = new WeakMap<Monaco, Set<string>>();

function signatureOf(entry: Registered): string {
  entry.signature ??= JSON.stringify([entry.profile, entry.db]);
  return entry.signature;
}

/**
 * Registers every profile of `sources` as a Monaco language, and updates the ones it has
 * registered before (M13, AD-29).
 *
 * **A language id is registered once**, whatever the number of calls: Monaco's `register`
 * would add the extensions and aliases of the second call to the first's, and an id cannot be
 * removed again. A later call (a reload) therefore sets the language configuration and the
 * grammar again only for an id whose profile or database is different, and defines the two
 * themes again when any language was added or changed — they are generated from the whole
 * list. A model whose language is a changed id re-tokenizes by itself when its token provider
 * is replaced. An id that has gone from `sources` stays registered, harmlessly: nothing opens
 * a document as it any more.
 *
 * What a reload cannot change on an id that exists is its extensions and display names (the
 * `register` call): they only matter to Monaco's own language detection by file name, which
 * the app does not use (the profile decides).
 */
export function registerLanguages(monaco: Monaco, sources: LanguageSources): void {
  const list = sources.list();
  let known = registered.get(monaco);
  if (known === undefined) {
    known = new Map();
    registered.set(monaco, known);
  }
  let ids = registeredIds.get(monaco);
  if (ids === undefined) {
    ids = new Set();
    registeredIds.set(monaco, ids);
  }
  let changed = false;
  for (const p of list) {
    // One profile that Monaco or the generators choke on is logged and skipped: the others are
    // registered and the themes are defined (M13 review fix CODE-14b).
    try {
      const db = sources.codeDb(p.id);
      const before = known.get(p.id);
      if (before !== undefined) {
        const same =
          (before.profile === p && before.db === db) ||
          signatureOf(before) === signatureOf({ profile: p, db });
        if (same) {
          before.profile = p;
          before.db = db;
          continue;
        }
      }
      if (!ids.has(p.id)) {
        monaco.languages.register({
          id: p.id,
          extensions: (p.files?.extensions ?? []).map((extension) => `.${extension}`),
          aliases: [p.name, p.shortName].filter((alias): alias is string => typeof alias === 'string' && alias !== ''),
        });
        ids.add(p.id);
      }
      monaco.languages.setLanguageConfiguration(
        p.id,
        languageConfiguration(p) as Parameters<typeof monaco.languages.setLanguageConfiguration>[1],
      );
      monaco.languages.setMonarchTokensProvider(
        p.id,
        generateGrammar(p, db) as Parameters<typeof monaco.languages.setMonarchTokensProvider>[1],
      );
      known.set(p.id, { profile: p, db });
      changed = true;
    } catch (error) {
      console.error(`The dialect ${p.id} could not be registered`, error);
    }
  }
  // The first call defines the themes even for an empty list, as before.
  if (changed || !themesDefined.has(monaco)) {
    defineThemes(monaco, list);
    themesDefined.add(monaco);
  }
}

const themesDefined = new WeakSet<Monaco>();

/** The profiles as Monaco should know them now, from the registries. */
const registrySources: LanguageSources = {
  list: () => profiles.list().map((info) => profiles.profile(info.id)),
  codeDb: (profileId) => unionCodeDb(variantDialects(profiles.profile(profileId)).map((id) => codes.byId(id))),
};

/**
 * Registers every profile as a Monaco language, with its configuration and grammar, and keeps
 * them current: a `profiles.revision` bump (a reload of the user's profiles or code files,
 * AD-29) registers the new ids and sets the configuration, grammar and themes again for the
 * changed ones, without registering any id twice. Answers the disposer of that subscription.
 */
export function registerAll(monaco: Monaco): () => void {
  try {
    registerLanguages(monaco, registrySources);
  } catch (error) {
    // The editor has to load even when the dialects cannot be listed (CODE-14b).
    console.error('The dialects could not be registered', error);
  }
  let first = true;
  return profiles.revision.subscribe(() => {
    // `subscribe` calls back at once with the current value; the registration above covered it.
    if (first) {
      first = false;
      return;
    }
    try {
      registerLanguages(monaco, registrySources);
    } catch (error) {
      // A throw here would travel up through `profiles.reload` and stop the other subscribers.
      console.error('The dialects could not be registered again after a reload', error);
    }
  });
}
