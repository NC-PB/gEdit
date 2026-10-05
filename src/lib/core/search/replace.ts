// Replace All as a transform (plan §7.6, AD-25, §5 WP4.1 sequence). Owner: WP11.1.
//
// `nc.replace` is `replaceInLines` behind the transform contract, so a run gets what every
// transform gets: the selection as its scope, one undo step, the count in the status bar and
// the lock check. Whether the result replaces the text or opens a new tab is the runner's
// `target`, not an option of the transform; the form carries it as its last field so the
// user sees one dialog (`contrib/search.ts` reads it).
//
// The form fields are shared with find-all (`searchFields`), so the two dialogs say the
// same thing: the word conditions compare the value as written (D51).

import type { FieldSpec } from '$lib/core/forms/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext, TransformDef, TransformResult } from '$lib/core/transforms/types';
import { t } from '$lib/i18n';
import { parseQuery, replaceInLines } from './index';
import type { SearchFlags } from './types';

/** The search form's toggles as the form hands them over; absent ones are off. */
export function flagsOf(values: Record<string, unknown>): SearchFlags {
  return {
    wholeAddress: values.wholeAddress === true,
    regex: values.regex === true,
    caseSensitive: values.caseSensitive === true,
    inComments: values.inComments === true,
  };
}

/** The fields find-all and replace share, in the order the form shows them. */
export function searchFields(): FieldSpec[] {
  return [
    { id: 'query', type: 'text', label: t('search.query'), help: t('search.queryHelp'), required: true, default: '' },
    { id: 'wholeAddress', type: 'bool', label: t('search.wholeAddress'), help: t('search.wholeAddressHelp'), default: false },
    { id: 'caseSensitive', type: 'bool', label: t('search.caseSensitive'), default: false },
    { id: 'regex', type: 'bool', label: t('search.regex'), help: t('search.regexHelp'), default: false },
    { id: 'inComments', type: 'bool', label: t('search.inComments'), default: false },
  ];
}

export const replace: TransformDef = {
  id: 'replace',
  title: 'search.replace',
  available: () => true,
  options(cp: CompiledProfile): FieldSpec[] {
    void cp;
    const [query, ...toggles] = searchFields();
    return [
      query,
      { id: 'replacement', type: 'text', label: t('search.replacement'), help: t('search.replacementHelp'), default: '' },
      ...toggles,
      {
        id: 'output',
        type: 'choice',
        label: t('search.output'),
        default: 'replace',
        choices: [
          { label: t('search.outputReplace'), value: 'replace' },
          { label: t('search.outputNewDocument'), value: 'new-document' },
        ],
      },
    ];
  },
  run(lines: string[], ctx: TransformContext): TransformResult {
    const query = parseQuery(String(ctx.options.query ?? ''), ctx.cp, flagsOf(ctx.options));
    if ('error' in query) return { lines, summary: query.error, skipped: [], warnings: [] };

    const done = replaceInLines(lines, ctx.cp, query, String(ctx.options.replacement ?? ''));
    return {
      lines: done.lines,
      lineMap: Int32Array.from(lines, (_, i) => i),
      summary: done.count === 0 ? { key: 'search.replaceNone' } : { key: 'search.replaceSummary', params: { count: done.count } },
      skipped: [],
      warnings: [],
    };
  },
};
