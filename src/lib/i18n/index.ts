// UI strings (plan §7.8, AD-14). Every file in en/ is one namespace, named after the file,
// that default-exports nested messages. A key is '<namespace>.<path>', e.g. 'common.cancel'.
// Messages take `{name}` placeholders. A numeric `count` param selects the plural form:
// '<key>_<category>' (Intl plural category: one, other, ...), then '<key>_other', then '<key>'.
// English is the only locale for now.

import type { Messages, Params, Translator } from './types';

export type { Messages, Params, Translator } from './types';

export interface TranslatorOptions {
  /** Called when a key has no message; `t()` then returns the key itself. */
  onMissing?: (key: string) => void;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Adds every message of `messages` to `into` under '<prefix>.<path>'. Non-string leaves are skipped (keys.test.ts rejects them). */
function flatten(prefix: string, messages: Messages, into: Map<string, string>): void {
  for (const [name, value] of Object.entries(messages)) {
    const key = `${prefix}.${name}`;
    if (typeof value === 'string') into.set(key, value);
    else if (value && typeof value === 'object') flatten(key, value, into);
  }
}

/** Fills `{name}` placeholders; unknown names stay as written, so a missing param is visible. */
function interpolate(message: string, params: Params | undefined): string {
  if (!params) return message;
  return message.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** Builds `t` and `hasKey` over `namespaces` (namespace name → messages). */
export function createTranslator(
  namespaces: Readonly<Record<string, Messages>>,
  locale = 'en',
  options: TranslatorOptions = {},
): Translator {
  const table = new Map<string, string>();
  for (const [ns, messages] of Object.entries(namespaces)) flatten(ns, messages, table);
  const plural = new Intl.PluralRules(locale);

  function lookup(key: string, count: number | undefined): string | undefined {
    if (count === undefined) return table.get(key) ?? table.get(`${key}_other`);
    return table.get(`${key}_${plural.select(count)}`) ?? table.get(`${key}_other`) ?? table.get(key);
  }

  return {
    t(key, params) {
      const count = typeof params?.count === 'number' ? params.count : undefined;
      const message = lookup(key, count);
      if (message === undefined) {
        options.onMissing?.(key);
        return key;
      }
      return interpolate(message, params);
    },
    hasKey(key) {
      return lookup(key, undefined) !== undefined;
    },
  };
}

// Eager, so every namespace ships with the app and t() works synchronously from the first render.
const modules = import.meta.glob<{ default: Messages }>(['./en/*.ts', '!./en/*.test.ts'], { eager: true });

/** The loaded English namespaces by name (file name without `.ts`). */
export const namespaces: Readonly<Record<string, Messages>> = Object.fromEntries(
  Object.entries(modules).map(([path, module]) => [path.slice(path.lastIndexOf('/') + 1, -'.ts'.length), module.default]),
);

const warned = new Set<string>();
const en = createTranslator(namespaces, 'en', {
  onMissing(key) {
    // Dynamic keys (command and panel titles) are not covered by keys.test.ts, so dev builds say so once.
    if (import.meta.env.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`i18n: no message for "${key}"`);
    }
  },
});

/** The message for `key` with its placeholders filled from `params`, or the key itself when there is none. */
export function t(key: string, params?: Params): string {
  return en.t(key, params);
}

/** True when `t(key)` finds a message. A plural key counts when its `_other` form exists. */
export function hasKey(key: string): boolean {
  return en.hasKey(key);
}
