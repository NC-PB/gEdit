// NC-aware search and replace: find-all into Results, replace by value, the whole-address
// find (contrib/search.ts, core/search/*). Owner: WP11.1 (plan §6 M11); `category`, `group`
// and the three command titles were pinned by the M11 prelude (P11, §7.13).
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Search',
  /** Caption of the Edit-tab ribbon group (`{ tab: 'edit', group: 'search.group' }`). */
  group: 'Search',
  /** `search.findAll`, `Mod+Shift+F` (§7.13): the search form, hits into Results. */
  findAll: 'Find All…',
  /** `search.replace`: the `nc.replace` transform (replace, or into a new tab). */
  replace: 'Replace All…',
  /** `search.wholeAddressInFind`: the editor's find widget with the whole-address regex. */
  wholeAddressInFind: 'Find Whole Address…',

  // The form (field ids are pinned in §7.12: query, replacement, wholeAddress, caseSensitive, regex, inComments, scope, output).
  query: 'Find',
  /** The D51 statement: a value condition never converts by the machine's decimal mode. */
  queryHelp:
    'Text, or with "Whole address" a word such as G1, T1, S>12000 or SB=500. A word condition compares the value as written: X>50 finds X60 and X60. alike, whatever the machine\'s decimal mode.',
  wholeAddress: 'Whole address',
  wholeAddressHelp: 'G1 finds G1, G01 and G1. and not G10, G100 or a G1 in a comment.',
  caseSensitive: 'Match case',
  regex: 'Regular expression',
  regexHelp:
    'The editor\'s flavour; with "Whole address" the text is a word, not a pattern. A match that is empty (such as $ or ^ alone) is skipped.',
  /** Applies to text searches only (§7.6): a word never matches inside a comment or a string. */
  inComments: 'Also in comments (text searches only)',
  scope: 'Look in',
  scopeActive: 'The active document',
  scopeOpen: 'All open documents',
  replacement: 'Replace with',
  replacementHelp: 'A whole word is replaced whole. A word typed without a value (S, X, SB) replaces only the address and keeps the value. With a regular expression, $1 is the first group. Calls that name a program are never renamed.',
  output: 'Put the result',
  outputReplace: 'In place of the text',
  outputNewDocument: 'In a new tab',

  // Find All
  /** Title of the Results report; `query` is what was typed. */
  title_one: '1 hit for {query}',
  title_other: '{count} hits for {query}',
  titleNone: 'No hits for {query}',
  columnLine: 'Line',
  columnText: 'Text',
  columnDocument: 'Document',
  /** Status line after find-all. */
  found_one: '1 hit.',
  found_other: '{count} hits.',
  foundNone: 'No hits.',
  noOpenDocuments: 'There is no open document to search.',

  // Replace
  replaceSummary_one: 'Replaced 1 hit.',
  replaceSummary_other: 'Replaced {count} hits.',
  replaceNone: 'Nothing to replace.',

  // Errors (a `Msg` of `parseQuery`)
  errorEmpty: 'Type what to find.',
  errorWord: '"{query}" is not a word. Use an address with an optional value or condition: G1, T01, S>12000, SB=500.',
  errorValue: '"{query}" needs a number to compare with.',
  errorRegex: 'The regular expression is not valid: {message}',

  // Find Whole Address
  wholeAddressTitle: 'Find Whole Address',
  wholeAddressNeedsValue: '"{query}" is a condition. The editor\'s find takes an address, or an address with a number: G, G1, T1, S12000.',
} as const satisfies Messages;
