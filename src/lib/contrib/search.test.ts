// What the search contribution declares and does (plan §6 M11, WP11.1, §7.13): the three
// commands and their key, find-all from the form into Results, the replace handed to the
// transform runner, and the whole-address find handed to the editor's find widget.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandDef, ReportData } from '$lib/app/types';
import { compileProfile } from '$lib/core/profiles/compile';
import type { Profile } from '$lib/core/profiles/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';

const cp = compileProfile(fanucJson as unknown as Profile);

const fake = vi.hoisted(() => ({
  answers: [] as (Record<string, unknown> | undefined)[],
  forms: [] as Record<string, unknown>[],
  documents: {} as Record<string, string[]>,
  titles: {} as Record<string, string>,
  reports: [] as unknown[],
  said: [] as { text: string; error: boolean }[],
  ran: [] as { id: string; o: unknown }[],
  actions: [] as { id: string; payload: unknown }[],
  selected: '',
  models: new Set<string>(),
}));

vi.mock('$lib/app/modals', () => ({
  modals: {
    form: (o: { values?: Record<string, unknown> }): Promise<Record<string, unknown> | undefined> => {
      fake.forms.push({ ...o.values });
      return Promise.resolve(fake.answers.shift());
    },
  },
}));
vi.mock('$lib/app/status', () => ({
  status: { show: (text: string, o?: { error?: boolean }) => fake.said.push({ text, error: o?.error === true }) },
}));
vi.mock('$lib/app/transforms', () => ({
  transforms: {
    run: (def: { id: string }, o: unknown): Promise<null> => {
      fake.ran.push({ id: def.id, o });
      return Promise.resolve(null);
    },
  },
}));
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    selectedText: () => fake.selected,
    hasModel: (id: string) => fake.models.has(id),
    getLineCount: (id: string) => fake.documents[id].length,
    getLines: (id: string, from: number, to: number) => fake.documents[id].slice(from - 1, to),
    triggerAction: (id: string, payload?: unknown) => fake.actions.push({ id, payload }),
    presetFind: (s: string) => fake.actions.push({ id: 'preset', payload: s }),
  },
}));
vi.mock('$lib/stores/documents', () => ({
  docs: {
    all: () => Object.keys(fake.documents).map((id) => ({ id, title: fake.titles[id] })),
    get: (id: string) => (id in fake.documents ? { id, title: fake.titles[id] } : undefined),
  },
}));
vi.mock('$lib/stores/machines', () => ({ machines: { effective: () => ({ cp, codes: undefined }) } }));
vi.mock('$lib/stores/results', () => ({ results: { show: (r: unknown) => fake.reports.push(r) } }));
vi.mock('$lib/stores/uiState', () => ({ uiState: { getLastParams: () => undefined, setLastParams: () => undefined } }));

const search = (await import('./search')).default;
const { hasKey } = await import('$lib/i18n');

const byId = new Map<string, CommandDef>((search.commands ?? []).map((def) => [def.id, def]));
const run = (id: string, docId = 'a'): unknown => byId.get(id)?.run({ activeDocId: docId } as never);

const FORM = { query: 'G1', wholeAddress: true, caseSensitive: false, regex: false, inComments: false, scope: 'active' };

beforeEach(() => {
  Object.assign(fake, {
    answers: [],
    forms: [],
    documents: { a: ['G1 X1', 'G0 X2', 'G01 (G1)', 'G10'], b: ['G1', 'X5'] },
    titles: { a: 'part.nc', b: 'part.nc' },
    reports: [],
    said: [],
    ran: [],
    actions: [],
    selected: '',
    models: new Set(['a', 'b']),
  });
});

describe('the search commands', () => {
  it('are the three of plan §7.13, and only find-all has a key', () => {
    expect([...byId.keys()]).toEqual(['search.findAll', 'search.replace', 'search.wholeAddressInFind']);
    expect(byId.get('search.findAll')?.keys).toBe('Mod+Shift+F');
    expect(byId.get('search.replace')?.keys).toBeUndefined();
    expect(byId.get('search.wholeAddressInFind')?.keys).toBeUndefined();
  });

  it('need a document, and have a message for every title and category', () => {
    for (const def of byId.values()) {
      expect(def.enabled?.({ activeDocId: null } as never), def.id).toBe(false);
      expect(def.enabled?.({ activeDocId: 'd1' } as never), def.id).toBe(true);
      expect(hasKey(def.title), def.title).toBe(true);
      expect(def.category !== undefined && hasKey(def.category), def.id).toBe(true);
    }
  });

  it('sit in one Home-tab group, with a caption', () => {
    for (const item of search.ribbon ?? []) {
      expect(item.tab).toBe('home');
      expect(item.group).toBe('search.group');
    }
    expect((search.ribbon ?? []).map((item) => item.command)).toEqual([...byId.keys()]);
    expect(hasKey('search.group')).toBe(true);
  });
});

describe('search.findAll', () => {
  it('puts the hits of the active document into Results', async () => {
    fake.answers.push(FORM);
    await run('search.findAll');
    const report = fake.reports[0] as ReportData;
    expect(report.title).toBe('2 hits for G1');
    expect(report.rows).toEqual([
      { document: 'part.nc', docId: 'a', line: 1, text: 'G1 X1' },
      { document: 'part.nc', docId: 'a', line: 3, text: 'G01 (G1)' },
    ]);
    expect(report.columns.map((c) => c.key)).toEqual(['line', 'text']);
    expect(report.dropped).toBeUndefined();
  });

  it('searches every open document, each row with its own document id', async () => {
    fake.answers.push({ ...FORM, scope: 'open' });
    await run('search.findAll');
    const report = fake.reports[0] as ReportData;
    expect(report.rows.map((r) => [r.docId, r.line])).toEqual([['a', 1], ['a', 3], ['b', 1]]);
    expect(report.columns.map((c) => c.key)).toEqual(['document', 'line', 'text']);
  });

  it('says so when nothing is found', async () => {
    fake.answers.push({ ...FORM, query: 'T9' });
    await run('search.findAll');
    expect((fake.reports[0] as ReportData).title).toBe('No hits for T9');
    expect(fake.said.at(-1)).toEqual({ text: 'No hits.', error: false });
  });

  it('asks again, with what was typed, when the query does not parse', async () => {
    fake.answers.push({ ...FORM, query: '(', wholeAddress: false, regex: true }, FORM);
    await run('search.findAll');
    expect(fake.said[0].error).toBe(true);
    expect(fake.forms[1].query).toBe('(');
    expect((fake.reports[0] as ReportData).rows).toHaveLength(2);
  });

  it('starts from the selected text', async () => {
    fake.selected = 'G10';
    await run('search.findAll');
    expect(fake.forms[0].query).toBe('G10');
    expect(fake.reports).toEqual([]);
  });

  it('cuts a very long line to a few hundred characters around the hit (CODE-16)', async () => {
    fake.documents.a = [`${'X1 '.repeat(40_000)}G1 ${'Y2 '.repeat(40_000)}`];
    fake.answers.push(FORM);
    await run('search.findAll');
    const [row] = (fake.reports[0] as ReportData).rows;
    const text = String(row.text);
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text).toContain('G1');
  });

  it('caps the rows and counts what it left out', async () => {
    fake.documents.a = Array.from({ length: 10_050 }, () => 'G1');
    fake.answers.push(FORM);
    await run('search.findAll');
    const report = fake.reports[0] as ReportData;
    expect(report.rows).toHaveLength(10_000);
    expect(report.dropped).toBe(50);
    expect(report.title).toBe('10050 hits for G1');
  });
});

describe('search.replace', () => {
  it('hands the answers to the replace transform, into the text by default', async () => {
    const answers = { ...FORM, replacement: 'G0', output: 'replace' };
    fake.answers.push(answers);
    await run('search.replace');
    expect(fake.ran).toEqual([{ id: 'replace', o: { options: answers, skipForm: true, target: 'replace' } }]);
  });

  it('can put the result into a new tab', async () => {
    fake.answers.push({ ...FORM, replacement: 'G0', output: 'new-document' });
    await run('search.replace');
    expect((fake.ran[0].o as { target: string }).target).toBe('new-document');
  });

  it('runs nothing when the form is cancelled', async () => {
    fake.answers.push(undefined);
    await run('search.replace');
    expect(fake.ran).toEqual([]);
  });

  it('drops the selection that was only the starting query, so the whole program is the scope (CODE-3)', async () => {
    fake.selected = 'G01';
    fake.answers.push({ ...FORM, query: 'G01', replacement: 'G1', output: 'replace' });
    await run('search.replace');
    expect(fake.actions).toEqual([{ id: 'cancelSelection', payload: undefined }]);
    expect(fake.ran).toHaveLength(1);
  });

  it('keeps a selection the user did not use as the query (a real scope)', async () => {
    fake.selected = 'G01';
    fake.answers.push({ ...FORM, query: 'G1', replacement: 'G0', output: 'replace' });
    await run('search.replace');
    expect(fake.actions).toEqual([]);
  });
});

describe('search.wholeAddressInFind', () => {
  it('opens the find widget on the whole-address regex', async () => {
    fake.answers.push({ query: 'g1' });
    await run('search.wholeAddressInFind');
    expect(fake.actions).toEqual([
      { id: 'preset', payload: '(?<![A-Z_])G\\+?0*1(?:\\.0*)?(?![\\d.])' },
      {
        id: 'editor.actions.findWithArgs',
        payload: { searchString: '(?<![A-Z_])G\\+?0*1(?:\\.0*)?(?![\\d.])', isRegex: true, isCaseSensitive: false, matchWholeWord: false },
      },
    ]);
  });

  it('refuses a condition, which a regex cannot express, and asks again', async () => {
    fake.answers.push({ query: 'S>100' }, undefined);
    await run('search.wholeAddressInFind');
    expect(fake.said[0].error).toBe(true);
    expect(fake.actions).toEqual([]);
  });
});

describe('the form texts (CODE-2, NC-4, CODE-7, CODE-17)', () => {
  it('say that Also in comments is for text searches', async () => {
    const { t } = await import('$lib/i18n');
    expect(t('search.inComments')).toMatch(/text/i);
  });

  it('say that a word without a value replaces only the address', async () => {
    const { t } = await import('$lib/i18n');
    expect(t('search.replacementHelp')).toMatch(/without a value/);
  });

  it('say that empty regex matches are skipped, and that find takes a bare address', async () => {
    const { t } = await import('$lib/i18n');
    expect(t('search.regexHelp')).toMatch(/empty/);
    expect(t('search.wholeAddressNeedsValue', { query: 'S>1' })).toMatch(/address, or an address with a number/);
  });
});
