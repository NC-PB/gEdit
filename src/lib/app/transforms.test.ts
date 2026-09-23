// The transform runner (plan §5 WP4.1, §7.3): the seven steps, in order, and every way
// out of them.
//
// The real document store, the real profile registry, the real results store and the real
// i18n catalog are used; the editor, the modals, the dialogs, the status bar and the apply
// step are fakes, so no test needs Monaco or a webview. What each case asserts is what the
// user would see: which lines the transform was handed, what reached the model, what the
// status bar says, and what the Results panel ends up holding.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransformService, formKey, type TransformDeps } from './transforms';
import { createDocumentStore } from '$lib/stores/documents';
import { noMachine } from '$lib/core/machines/effective';
import { profiles } from '$lib/stores/profiles';
import { results } from '$lib/stores/results';
import { t } from '$lib/i18n';
import type {
  DocId,
  DocumentStore,
  Msg,
  NewDocMeta,
  ReportData,
  TransformService,
} from '$lib/app/types';
import type { CodeDb } from '$lib/core/codes/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { TransformContext, TransformDef, TransformResult } from '$lib/core/transforms/types';

// ---------------------------------------------------------------------------
// Fixtures and fakes
// ---------------------------------------------------------------------------

const CODES: CodeDb = { dialect: 'fanuc', version: 1, addresses: {}, codes: [] };

function newDoc(over: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
    path: null,
    untitledIndex: 1,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'crlf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
    ...over,
  };
}

interface Harness {
  service: TransformService;
  docs: DocumentStore;
  docId: DocId;
  lines: string[];
  selection: { startLine: number; endLine: number; empty: boolean } | null;
  status: { text: string; error: boolean }[];
  forms: { title: string; fields: FieldSpec[]; values?: Record<string, unknown> }[];
  formAnswers: (Record<string, unknown> | undefined)[];
  confirms: { title: string; message: string }[];
  confirmAnswers: boolean[];
  applied: { id: DocId; startLine: number; endLine: number; lines: string[]; map?: Int32Array }[];
  created: { profileId?: string; text?: string }[];
  remembered: Map<string, Record<string, unknown>>;
}

function harness(o: { profileId?: string; lines?: string[] } = {}): Harness {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const docId = docs.add(newDoc({ profileId: o.profileId ?? 'fanuc-gcode' }));

  const h: Harness = {
    service: undefined as unknown as TransformService,
    docs,
    docId,
    lines: o.lines ?? ['N10 G0 X0', 'N20 G1 X10.', 'N30 M30'],
    selection: null,
    status: [],
    forms: [],
    formAnswers: [],
    confirms: [],
    confirmAnswers: [],
    applied: [],
    created: [],
    remembered: new Map(),
  };

  const deps: TransformDeps = {
    docs,
    editor: {
      getLineCount: () => h.lines.length,
      getLines: (_id, startLine, endLine) => h.lines.slice(startLine - 1, endLine),
      selectionLines: () => h.selection,
    },
    // The effective view of the document (AD-31). Without a machine it is the profile's
    // own compile, which is exactly what this service used to ask the registry for.
    machines: {
      effective: (id) => {
        const profileId = docs.get(id)?.profileId ?? 'fanuc-gcode';
        const profile = profiles.profile(profileId);
        return { profile, cp: profiles.compiled(profileId), codes: CODES, machine: noMachine(profile) };
      },
    },
    modals: {
      form: (request) => {
        h.forms.push(request);
        return Promise.resolve(h.formAnswers.shift());
      },
    },
    dialogs: {
      confirm: (request) => {
        h.confirms.push({ title: request.title, message: request.message });
        return Promise.resolve(h.confirmAnswers.shift() ?? false);
      },
    },
    status: {
      show: (text, options) => h.status.push({ text, error: options?.error === true }),
    },
    uiState: {
      getLastParams: (key) => h.remembered.get(key),
      setLastParams: (key, value) => h.remembered.set(key, value),
    },
    results,
    files: {
      newUntitled: (options) => {
        h.created.push({ profileId: options?.profileId, text: options?.text });
        return 'd-new';
      },
    },
    applyLines: (id, startLine, endLine, lines, map) => {
      h.applied.push({ id, startLine, endLine, lines, map });
      return { changedLines: lines.length };
    },
    t,
  };

  h.service = createTransformService(deps);
  return h;
}

/** A transform that upper-cases every line and reports nothing. */
function upperCase(over: Partial<TransformDef> = {}): TransformDef {
  return {
    id: 'upper',
    title: 'results.title',
    available: () => true,
    run: (lines) => ({
      lines: lines.map((line) => line.toUpperCase()),
      summary: { key: 'common.lines', params: { count: lines.length } },
      skipped: [],
      warnings: [],
    }),
    ...over,
  };
}

const NUMBER_FIELDS: FieldSpec[] = [
  { id: 'start', type: 'integer', label: 'Start', default: 10 },
  { id: 'pad', type: 'bool', label: 'Pad', default: false },
];

beforeEach(() => {
  results.clear();
});

// ---------------------------------------------------------------------------
// Step 1: can it run at all
// ---------------------------------------------------------------------------

describe('TransformService.run: availability', () => {
  it('refuses without a document, and says so', async () => {
    const h = harness();
    h.docs.remove(h.docId);
    expect(await h.service.run(upperCase())).toBeNull();
    expect(h.status).toEqual([{ text: t('transforms.noDocument'), error: true }]);
  });

  it('refuses a document whose profile is gone', async () => {
    const h = harness({ profileId: 'siemens-840d' });
    expect(await h.service.run(upperCase())).toBeNull();
    expect(h.status[0].error).toBe(true);
    expect(h.status[0].text).toContain('siemens-840d');
    expect(h.applied).toHaveLength(0);
  });

  it("shows the transform's own reason and stops", async () => {
    const h = harness();
    const reason: Msg = { key: 'transforms.noProfile', params: { profile: 'Klartext' } };
    const def = upperCase({ available: () => reason });
    expect(await h.service.run(def)).toBeNull();
    expect(h.status).toEqual([{ text: t(reason.key, reason.params), error: true }]);
    expect(h.forms).toHaveLength(0);
    expect(h.applied).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Step 2: the options form
// ---------------------------------------------------------------------------

describe('TransformService.run: the options form', () => {
  it('asks nothing when the transform has no options', async () => {
    const h = harness();
    await h.service.run(upperCase());
    expect(h.forms).toHaveLength(0);
    expect(h.applied).toHaveLength(1);
  });

  it('pre-fills the form from the profile defaults and remembers the answer', async () => {
    const h = harness();
    h.formAnswers.push({ start: 200, pad: true });
    await h.service.run(upperCase({ options: () => NUMBER_FIELDS }));
    expect(h.forms[0].values).toEqual({ start: 10, pad: false });
    expect(h.remembered.get(formKey('upper'))).toEqual({ start: 200, pad: true });
  });

  it('pre-fills the form from what was remembered last time', async () => {
    const h = harness();
    h.remembered.set(formKey('upper'), { start: 500, pad: true });
    h.formAnswers.push({ start: 500, pad: true });
    await h.service.run(upperCase({ options: () => NUMBER_FIELDS }));
    expect(h.forms[0].values).toEqual({ start: 500, pad: true });
  });

  it('lets an explicit option win over what was remembered', async () => {
    const h = harness();
    h.remembered.set(formKey('upper'), { start: 500, pad: true });
    h.formAnswers.push({ start: 7, pad: true });
    await h.service.run(upperCase({ options: () => NUMBER_FIELDS }), { options: { start: 7 } });
    expect(h.forms[0].values).toEqual({ start: 7, pad: true });
  });

  it('skipForm skips the form and what was remembered with it', async () => {
    const h = harness();
    h.remembered.set(formKey('upper'), { start: 500, pad: true });
    const seen: { options?: Record<string, unknown> } = {};
    const def = upperCase({
      options: () => NUMBER_FIELDS,
      run: (lines, ctx) => {
        seen.options = ctx.options;
        return { lines, summary: { key: 'common.ok' }, skipped: [], warnings: [] };
      },
    });
    await h.service.run(def, { skipForm: true, options: { pad: true } });
    expect(h.forms).toHaveLength(0);
    // The profile defaults plus what the caller passed, and nothing from state.json.
    expect(seen.options).toEqual({ start: 10, pad: true });
    expect(h.remembered.get(formKey('upper'))).toEqual({ start: 500, pad: true });
  });

  it('a cancelled form cancels the run', async () => {
    const h = harness();
    h.formAnswers.push(undefined);
    expect(await h.service.run(upperCase({ options: () => NUMBER_FIELDS }))).toBeNull();
    expect(h.applied).toHaveLength(0);
    expect(h.status).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Step 3: the preflight
// ---------------------------------------------------------------------------

describe('TransformService.run: the preflight', () => {
  it('asks for confirmation and runs when it is given', async () => {
    const h = harness();
    h.confirmAnswers.push(true);
    const def = upperCase({
      preflight: () => ({ key: 'transforms.skipped', params: { count: 3 } }),
    });
    expect(await h.service.run(def)).not.toBeNull();
    expect(h.confirms[0].message).toBe(t('transforms.skipped', { count: 3 }));
    expect(h.applied).toHaveLength(1);
  });

  it('applies nothing when the confirmation is declined', async () => {
    const h = harness();
    h.confirmAnswers.push(false);
    const def = upperCase({ preflight: () => ({ key: 'common.warning' }) });
    expect(await h.service.run(def)).toBeNull();
    expect(h.applied).toHaveLength(0);
  });

  it('sees the lines and the options the run will see', async () => {
    const h = harness();
    h.confirmAnswers.push(true);
    const seen: { lines?: string[]; ctx?: TransformContext } = {};
    const def = upperCase({
      options: () => NUMBER_FIELDS,
      preflight: (lines, ctx) => {
        seen.lines = lines;
        seen.ctx = ctx;
        return null;
      },
    });
    await h.service.run(def, { skipForm: true, options: { start: 42 } });
    expect(seen.lines).toEqual(h.lines);
    expect(seen.ctx?.options).toEqual({ start: 42, pad: false });
    expect(seen.ctx?.firstLine).toBe(1);
    expect(seen.ctx?.codes).toBe(CODES);
    expect(seen.ctx?.cp).toBe(profiles.compiled('fanuc-gcode'));
  });
});

// ---------------------------------------------------------------------------
// Steps 4 to 6: the run, the output and the summary
// ---------------------------------------------------------------------------

describe('TransformService.run: the output', () => {
  it('replaces the whole document by default', async () => {
    const h = harness();
    const result = await h.service.run(upperCase());
    expect(result?.lines).toEqual(['N10 G0 X0', 'N20 G1 X10.', 'N30 M30']);
    expect(h.applied).toEqual([
      { id: h.docId, startLine: 1, endLine: 3, lines: result?.lines, map: undefined },
    ]);
  });

  it('passes the lineMap straight through', async () => {
    const h = harness();
    const map = Int32Array.from([0, 1, 2]);
    await h.service.run(
      upperCase({
        run: (lines) => ({
          lines,
          lineMap: map,
          summary: { key: 'common.ok' },
          skipped: [],
          warnings: [],
        }),
      }),
    );
    expect(h.applied[0].map).toBe(map);
  });

  it('runs on the selection, extended to whole lines', async () => {
    const h = harness();
    h.selection = { startLine: 2, endLine: 3, empty: false };
    const seen: { ctx?: TransformContext } = {};
    const def = upperCase({
      run: (lines, ctx) => {
        seen.ctx = ctx;
        return {
          lines: lines.map((line) => line.toLowerCase()),
          summary: { key: 'common.ok' },
          skipped: [],
          warnings: [],
        };
      },
    });
    await h.service.run(def);
    expect(seen.ctx?.firstLine).toBe(2);
    expect(h.applied[0]).toMatchObject({ startLine: 2, endLine: 3 });
    expect(h.applied[0].lines).toEqual(['n20 g1 x10.', 'n30 m30']);
  });

  it('says in the status bar that only the selection ran', async () => {
    const h = harness();
    h.selection = { startLine: 1, endLine: 2, empty: false };
    await h.service.run(upperCase());
    expect(h.status).toEqual([
      { text: t('transforms.inSelection', { summary: t('common.lines', { count: 2 }) }), error: false },
    ]);
  });

  it('shows the summary as the transform wrote it for a whole-document run', async () => {
    const h = harness();
    await h.service.run(upperCase());
    expect(h.status).toEqual([{ text: t('common.lines', { count: 3 }), error: false }]);
  });

  it('copies only the transformed lines into a new document', async () => {
    const h = harness();
    h.selection = { startLine: 2, endLine: 3, empty: false };
    await h.service.run(upperCase(), { target: 'new-document' });
    expect(h.applied).toHaveLength(0);
    expect(h.created).toEqual([{ profileId: 'fanuc-gcode', text: 'N20 G1 X10.\nN30 M30' }]);
  });

  it('turns a throwing transform into a status error, not a crash', async () => {
    const h = harness();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const def = upperCase({
      run: () => {
        throw new Error('bad profile data');
      },
    });
    expect(await h.service.run(def)).toBeNull();
    expect(h.status[0].error).toBe(true);
    expect(h.status[0].text).toBe(t('transforms.failed', { title: t('results.title') }));
    expect(h.applied).toHaveLength(0);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Step 7: the Results panel
// ---------------------------------------------------------------------------

describe('TransformService.run: what reaches the Results panel', () => {
  function withSkips(skipped: TransformResult['skipped'], warnings: Msg[] = []): TransformDef {
    return upperCase({
      run: (lines) => ({
        lines,
        summary: { key: 'common.lines', params: { count: lines.length } },
        skipped,
        warnings,
      }),
    });
  }

  it('reports nothing when the transform skipped nothing', async () => {
    const h = harness();
    await h.service.run(upperCase());
    expect(get(results.current)).toBeNull();
  });

  it('lists the skipped lines as findings against the document that was read', async () => {
    const h = harness();
    await h.service.run(
      withSkips([{ line: 2, message: 'N20 is referenced by GOTO', severity: 'warning' }]),
    );
    const report = get(results.current) as ReportData;
    expect(report.title).toBe(t('results.title'));
    expect(report.findings).toEqual([
      { line: 2, message: 'N20 is referenced by GOTO', severity: 'warning' },
    ]);
    expect(report.docId).toBe(h.docId);
    expect(report.message).toContain(t('transforms.skipped', { count: 1 }));
  });

  it('keeps the report on the source document when the output went elsewhere', async () => {
    const h = harness();
    await h.service.run(withSkips([{ line: 1, message: 'left alone' }]), {
      target: 'new-document',
    });
    expect((get(results.current) as ReportData).docId).toBe(h.docId);
  });

  it('reports a warning even when nothing was skipped', async () => {
    const h = harness();
    await h.service.run(withSkips([], [{ key: 'common.warning' }]));
    const report = get(results.current) as ReportData;
    expect(report.message).toContain(t('common.warning'));
    expect(report.findings).toEqual([]);
  });

  it('retracts its own report when the next run has nothing to say', async () => {
    const h = harness();
    await h.service.run(withSkips([{ line: 2, message: 'skipped once' }]));
    expect(get(results.current)).not.toBeNull();
    await h.service.run(upperCase());
    expect(get(results.current)).toBeNull();
  });

  it('leaves a report it did not publish alone', async () => {
    const h = harness();
    await h.service.run(withSkips([{ line: 2, message: 'skipped once' }]));
    const foreign: ReportData = { title: 'Tool list', columns: [], rows: [] };
    results.show(foreign);
    await h.service.run(upperCase());
    expect(get(results.current)).toBe(foreign);
  });
});
