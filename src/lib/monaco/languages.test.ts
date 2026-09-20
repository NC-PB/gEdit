// Registering the dialects with Monaco (plan §5 WP3.4).
//
// Monaco itself never loads here — it needs a DOM, and importing it in node would also
// undo the rule that `$lib/monaco/core` is only ever reached through a dynamic import.
// The fake below records the three calls `registerAll` makes per profile plus the two
// `defineTheme` calls, which is the whole contract this module has with the editor.

import { describe, expect, it } from 'vitest';
import { defineThemes, languageConfiguration, registerAll, registerLanguages } from './languages';
import { THEME_IDS } from '$lib/core/grammar';
import { validateProfile } from '$lib/core/profiles/validate';
import { loadCodeDb } from '$lib/core/codes/load';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import type { Monaco } from './setup';
import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';

interface Recorded {
  registered: { id: string; extensions?: string[]; aliases?: string[] }[];
  configured: [string, unknown][];
  grammars: [string, unknown][];
  themes: [string, unknown][];
}

/** A stand-in for the two Monaco namespaces this module touches. */
function fakeMonaco(): { monaco: Monaco; log: Recorded } {
  const log: Recorded = { registered: [], configured: [], grammars: [], themes: [] };
  const monaco = {
    languages: {
      register: (language: { id: string }) => log.registered.push(language),
      setLanguageConfiguration: (id: string, config: unknown) => log.configured.push([id, config]),
      setMonarchTokensProvider: (id: string, grammar: unknown) => log.grammars.push([id, grammar]),
    },
    editor: {
      defineTheme: (id: string, data: unknown) => log.themes.push([id, data]),
    },
  } as unknown as Monaco;
  return { monaco, log };
}

const profiles: Profile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return checked.profile;
});
const dbOf = (profileId: string): CodeDb => {
  const profile = profiles.find((entry) => entry.id === profileId);
  return loadCodeDb(BUILTIN_CODE_DB_JSON[profile?.codes ?? '']);
};
const fanuc = profiles.find((p) => p.id === 'fanuc-gcode') as Profile;
const klartext = profiles.find((p) => p.id === 'heidenhain-klartext') as Profile;

describe('registerLanguages', () => {
  it('registers one language per profile, with its extensions and names', () => {
    const { monaco, log } = fakeMonaco();
    registerLanguages(monaco, { list: () => profiles, codeDb: dbOf });

    expect(log.registered.map((entry) => entry.id)).toEqual(profiles.map((p) => p.id));
    const first = log.registered[0];
    // Monaco wants the leading dot; the profile stores the bare extension.
    expect(first.extensions).toEqual(fanuc.files.extensions.map((extension) => `.${extension}`));
    expect(first.aliases).toEqual(['Fanuc (ISO) mill', 'Fanuc']);
  });

  it('gives every language a configuration and a grammar, under the same id', () => {
    const { monaco, log } = fakeMonaco();
    registerLanguages(monaco, { list: () => profiles, codeDb: dbOf });

    const ids = profiles.map((p) => p.id);
    expect(log.configured.map(([id]) => id)).toEqual(ids);
    expect(log.grammars.map(([id]) => id)).toEqual(ids);
    for (const [, grammar] of log.grammars) {
      const value = grammar as { defaultToken: string; tokenizer: { root: unknown[] } };
      expect(value.defaultToken).toBe('');
      expect(value.tokenizer.root.length).toBeGreaterThan(5);
    }
  });

  it('defines both generated themes as part of the registration', () => {
    const { monaco, log } = fakeMonaco();
    registerLanguages(monaco, { list: () => profiles, codeDb: dbOf });
    expect(log.themes.map(([id]) => id).sort()).toEqual([THEME_IDS.dark, THEME_IDS.light].sort());
  });

  it('does nothing at all for an empty registry, without throwing', () => {
    const { monaco, log } = fakeMonaco();
    registerLanguages(monaco, { list: () => [], codeDb: dbOf });
    expect(log.registered).toEqual([]);
    // The themes are still defined: `monaco/theme.ts` names them whatever happens, and an
    // id Monaco does not know falls back to `vs` without a word of warning.
    expect(log.themes).toHaveLength(2);
  });
});

describe('defineThemes', () => {
  it('hands Monaco a theme that inherits from a built-in base', () => {
    const { monaco, log } = fakeMonaco();
    defineThemes(monaco, profiles);
    const dark = log.themes.find(([id]) => id === THEME_IDS.dark)?.[1] as { base: string; inherit: boolean };
    expect(dark.base).toBe('vs-dark');
    expect(dark.inherit).toBe(true);
  });
});

describe('registerAll', () => {
  it('wires the real registry and the real code databases to Monaco', () => {
    const { monaco, log } = fakeMonaco();
    registerAll(monaco);
    expect(log.registered.map((entry) => entry.id)).toEqual(['fanuc-gcode', 'heidenhain-klartext']);
    expect(log.grammars).toHaveLength(2);
    expect(log.themes).toHaveLength(2);
  });
});

describe('languageConfiguration', () => {
  it('reads the comment markers off the profile', () => {
    expect(languageConfiguration(fanuc).comments).toEqual({ blockComment: ['(', ')'] });
    expect(languageConfiguration(klartext).comments).toEqual({ lineComment: ';' });
  });

  it('leaves a comment delimiter out of the bracket pairs', () => {
    // `(` opens a comment in Fanuc, so bracket matching must not claim it.
    expect(languageConfiguration(fanuc).brackets).toEqual([['[', ']']]);
    expect(languageConfiguration(klartext).brackets).toEqual([
      ['[', ']'],
      ['(', ')'],
    ]);
  });

  it('still auto-closes a comment, and a Klartext string', () => {
    expect(languageConfiguration(fanuc).autoClosingPairs).toContainEqual({ open: '(', close: ')' });
    expect(languageConfiguration(klartext).autoClosingPairs).toContainEqual({ open: '"', close: '"' });
    expect(languageConfiguration(fanuc).autoClosingPairs).not.toContainEqual({ open: '"', close: '"' });
  });

  it('keeps an NC word in one piece', () => {
    const words = (p: Profile, text: string): string[] => text.match(languageConfiguration(p).wordPattern) ?? [];
    expect(words(fanuc, 'N10 G54.1 X10. F1500. #101')).toEqual(['N10', 'G54.1', 'X10.', 'F1500.', '#101']);
    // The sign is an operator, not part of the word.
    expect(words(fanuc, 'X-15.')).toEqual(['X', '15.']);
    expect(words(klartext, '5 TOOL CALL 1 Z S3000 Q200')).toEqual(['5', 'TOOL', 'CALL', '1', 'Z', 'S3000', 'Q200']);
    // Klartext writes its parameters with a letter sigil, so there is none to add.
    expect(languageConfiguration(klartext).wordPattern.source).not.toContain('#');
  });

  it('follows the decimal separator of the profile', () => {
    const comma = { ...fanuc, syntax: { ...fanuc.syntax, decimalSeparator: ',' } } as unknown as Profile;
    expect('X10,5'.match(languageConfiguration(comma).wordPattern)).toEqual(['X10,5']);
  });
});
