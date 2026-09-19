/** Values for `{name}` placeholders. A numeric `count` also selects the plural form. */
export type Params = Record<string, string | number>;

/**
 * A namespace file's default export: nested objects whose leaves are messages.
 * Key segments are identifiers; plural forms are sibling leaves `<key>_one` and `<key>_other`.
 */
export interface Messages {
  readonly [key: string]: string | Messages;
}

export interface Translator {
  t(key: string, params?: Params): string;
  hasKey(key: string): boolean;
}
