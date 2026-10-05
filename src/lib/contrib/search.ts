// The Home tab's "Search" group (plan §6 M11, WP11.1, §7.13, AD-25). One feature per file
// (plan AD-3); see ./README.md.
//
// Three commands:
//
//  - `search.findAll` (`Mod+Shift+F`) asks the form, finds in the active document or in
//    every open one, and puts the hits in the Results panel. A row carries the id of its
//    own document (§7.16 #139), because two documents can have the same name. The panel
//    shows at most `SEARCH_MAX_HITS` rows and says how many more there were.
//  - `search.replace` is the `replace` transform: this file asks the form (so it can offer
//    "in a new tab" next to the text) and hands the answers to the runner, which does the
//    rest of the sequence (scope, lock, one undo step, summary).
//  - `search.wholeAddressInFind` turns an address (`G1`) into the regex of
//    `wholeAddressRegex` and opens the editor's own find widget with it, for the user who
//    wants the widget's next/previous and highlighting instead of a list.
//
// A form that does not parse is asked again with what was typed, so a slip in a regex
// costs one correction and not the whole form.

import Replace from 'lucide-svelte/icons/replace';
import ScanSearch from 'lucide-svelte/icons/scan-search';
import Search from 'lucide-svelte/icons/search';
import { asIcon } from '$lib/app/icons';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { transforms } from '$lib/app/transforms';
import type { FieldSpec } from '$lib/core/forms/types';
import { initialValues } from '$lib/core/forms/values';
import { findInLines, parseQuery, SEARCH_MAX_HITS, wholeAddressRegex } from '$lib/core/search';
import type { SearchHit } from '$lib/core/search';
import { flagsOf, replace, searchFields } from '$lib/core/search/replace';
import { t } from '$lib/i18n';
import { editor } from '$lib/monaco/editorService';
import { docs } from '$lib/stores/documents';
import { machines } from '$lib/stores/machines';
import { results } from '$lib/stores/results';
import { uiState } from '$lib/stores/uiState';
import type { CommandContext, Contribution, DocId, Msg, ReportData } from '$lib/app/types';

/** `uiState.lastParams` keys of the two forms. */
const FIND_KEY = 'search:findAll';
const REPLACE_KEY = 'search:replace';

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

function say(msg: Msg, error = false): void {
  status.show(t(msg.key, msg.params), error ? { error: true } : undefined);
}

/** What the user has selected on one line, as the starting query; the remembered one otherwise. */
function selectedQuery(): string | undefined {
  const text = editor.selectedText();
  return text !== '' && !/[\r\n]/.test(text) ? text.trim() : undefined;
}

/**
 * Shows the form until its answers parse as a query for the active document, or the user
 * cancels. Returns the answers.
 */
async function askQuery(
  title: string,
  fields: FieldSpec[],
  key: string,
  docId: DocId,
): Promise<Record<string, unknown> | undefined> {
  let values = initialValues(fields, uiState.getLastParams(key));
  const selected = selectedQuery();
  if (selected !== undefined) values = { ...values, query: selected };
  for (;;) {
    const answered = await modals.form({ title, fields, values });
    if (answered === undefined) return undefined;
    uiState.setLastParams(key, answered);
    const parsed = parseQuery(String(answered.query ?? ''), machines.effective(docId).cp, flagsOf(answered));
    if (!('error' in parsed)) return answered;
    say(parsed.error, true);
    values = answered;
  }
}

function findAllFields(): FieldSpec[] {
  return [
    ...searchFields(),
    {
      id: 'scope',
      type: 'choice',
      label: t('search.scope'),
      default: 'active',
      choices: [
        { label: t('search.scopeActive'), value: 'active' },
        { label: t('search.scopeOpen'), value: 'open' },
      ],
    },
  ];
}

/** How many hits `lines` holds in all, for the "dropped" count of a capped search. */
function countHits(...args: Parameters<typeof findInLines>): number {
  const [lines, cp, q, o] = args;
  return findInLines(lines, cp, q, { ...o, max: Infinity }).hits.length;
}

async function findAll(context: CommandContext): Promise<void> {
  const activeId = context.activeDocId;
  if (activeId === null) return;
  const answers = await askQuery(t('search.findAll'), findAllFields(), FIND_KEY, activeId);
  if (answers === undefined) return;

  const flags = flagsOf(answers);
  const text = String(answers.query);
  const targets: { id: DocId; title: string }[] =
    answers.scope === 'open'
      ? docs.all().filter((doc) => editor.hasModel(doc.id)).map((doc) => ({ id: doc.id, title: doc.title }))
      : [{ id: activeId, title: docs.get(activeId)?.title ?? '' }];
  if (targets.length === 0) {
    say({ key: 'search.noOpenDocuments' }, true);
    return;
  }

  const rows: Record<string, unknown>[] = [];
  let dropped = 0;
  for (const target of targets) {
    const view = machines.effective(target.id);
    const query = parseQuery(text, view.cp, flags);
    if ('error' in query) continue; // the active document parsed it; a word parses the same everywhere
    const lines = editor.getLines(target.id, 1, editor.getLineCount(target.id));
    const room = SEARCH_MAX_HITS - rows.length;
    const found = findInLines(lines, view.cp, query, { max: Math.max(room, 0), codes: view.codes });
    for (const hit of found.hits) rows.push(rowOf(hit, target));
    if (found.truncated) dropped += countHits(lines, view.cp, query, { codes: view.codes }) - found.hits.length;
  }

  const report: ReportData = {
    title: rows.length === 0 ? t('search.titleNone', { query: text }) : t('search.title', { count: rows.length + dropped, query: text }),
    columns: [
      ...(answers.scope === 'open' ? [{ key: 'document', label: t('search.columnDocument') }] : []),
      { key: 'line', label: t('search.columnLine') },
      { key: 'text', label: t('search.columnText') },
    ],
    rows,
    docId: activeId,
    ...(dropped > 0 ? { dropped } : {}),
  };
  results.show(report);
  status.show(rows.length === 0 ? t('search.foundNone') : t('search.found', { count: rows.length + dropped }));
}

/** Characters of a line a Results row shows; the rest is one click away in the editor. */
const ROW_TEXT_MAX = 200;

/** The line, cut to about `ROW_TEXT_MAX` characters around the hit when it is longer. */
function rowText(hit: SearchHit): string {
  const text = hit.text;
  if (text.length <= ROW_TEXT_MAX) return text.trim();
  const from = Math.max(0, hit.start - 60);
  const to = Math.min(text.length, from + ROW_TEXT_MAX);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

function rowOf(hit: SearchHit, target: { id: DocId; title: string }): Record<string, unknown> {
  return { document: target.title, docId: target.id, line: hit.line, text: rowText(hit) };
}

/** Asks for the replacement and hands it to the runner. */
async function replaceAll(context: CommandContext): Promise<void> {
  const docId = context.activeDocId;
  if (docId === null) return;
  const cp = machines.effective(docId).cp;
  const fields = replace.options?.(cp) ?? [];
  const selected = selectedQuery();
  const answers = await askQuery(t('search.replace'), fields, REPLACE_KEY, docId);
  if (answers === undefined) return;
  // CODE-3: a query that is the selection, still as it was pre-filled, is not a scope. The
  // runner takes the selection as the scope, so "select G01, Replace All" would have
  // changed one line while the form looked like a whole-program replace. Collapsing the
  // selection to the cursor makes the scope the whole document.
  if (selected !== undefined && String(answers.query ?? '').trim() === selected) {
    editor.triggerAction('cancelSelection');
  }
  await transforms.run(replace, {
    options: answers,
    skipForm: true,
    target: answers.output === 'new-document' ? 'new-document' : 'replace',
  });
}

/** Asks for an address and opens the editor's find widget on the regex that matches it whole. */
async function wholeAddressInFind(context: CommandContext): Promise<void> {
  const docId = context.activeDocId;
  if (docId === null) return;
  const cp = machines.effective(docId).cp;
  const field: FieldSpec = { id: 'query', type: 'text', label: t('search.query'), required: true, default: '' };
  let values: Record<string, unknown> = { query: selectedQuery() ?? '' };
  for (;;) {
    const answered = await modals.form({ title: t('search.wholeAddressTitle'), fields: [field], values });
    if (answered === undefined) return;
    const text = String(answered.query ?? '');
    const parsed = parseQuery(text, cp, { wholeAddress: true, regex: false, caseSensitive: false, inComments: false });
    if ('error' in parsed) {
      say(parsed.error, true);
    } else if (parsed.kind === 'word' && (parsed.op === undefined || parsed.op === '=')) {
      const searchString = wholeAddressRegex(parsed.address, parsed.value ?? '');
      // First: with the widget's search empty, Monaco seeds it from the word at the cursor
      // and that overrides the argument below.
      editor.presetFind(searchString);
      editor.triggerAction('editor.actions.findWithArgs', {
        searchString,
        isRegex: true,
        isCaseSensitive: false,
        matchWholeWord: false,
      });
      return;
    } else {
      say({ key: 'search.wholeAddressNeedsValue', params: { query: text } }, true);
    }
    values = answered;
  }
}

export default {
  id: 'search',
  commands: [
    {
      id: 'search.findAll',
      title: 'search.findAll',
      category: 'search.category',
      icon: asIcon(Search),
      keys: 'Mod+Shift+F',
      global: true,
      enabled: hasDocument,
      run: findAll,
    },
    {
      id: 'search.replace',
      title: 'search.replace',
      category: 'search.category',
      icon: asIcon(Replace),
      enabled: hasDocument,
      run: replaceAll,
    },
    {
      id: 'search.wholeAddressInFind',
      title: 'search.wholeAddressInFind',
      category: 'search.category',
      icon: asIcon(ScanSearch),
      enabled: hasDocument,
      run: wholeAddressInFind,
    },
  ],
  ribbon: [
    { tab: 'home', group: 'search.group', command: 'search.findAll', order: 130 },
    { tab: 'home', group: 'search.group', command: 'search.replace', order: 131 },
    { tab: 'home', group: 'search.group', command: 'search.wholeAddressInFind', order: 132 },
  ],
} satisfies Contribution;
