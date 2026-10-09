// The inspector panel's markup contract (Phase 3 plan P3.2b, §6.8): the test ids and attributes the
// runtime harness reads, and what each state of the service looks like. Rendered with
// `svelte/server`, so there is no DOM and no `onMount`: the service is a fake whose `snapshot` the
// test sets, built from the real `createInspectorService` over a small program so the rows are the
// ones `inspectBlock` gives. Clicks, double-clicks and Enter reach `inspector.edit`, which
// `app/inspectorService.test.ts` drives; the key test here pins which key edits.

import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import { ModalIndex } from '$lib/core/nc/modal';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { hasKey } from '$lib/i18n';
import { profileOf } from '../../../../tests/unit/helpers/profiles';
import type { InspectorSnapshot } from '$lib/app/inspectorService';

const snapshot = vi.hoisted(() => ({ store: null as unknown as import('svelte/store').Writable<unknown> }));

// The real store with its `active` replaced, so the panel's document can be set by the test.
vi.mock('$lib/stores/documents', async (original) => {
  const actual = await original<typeof import('$lib/stores/documents')>();
  const { writable: w } = await import('svelte/store');
  const active = w<unknown>(null);
  return { ...actual, docs: { ...actual.docs, active, __set: (v: unknown) => active.set(v) } };
});
vi.mock('$lib/app/inspectorService', async () => {
  const { writable: w } = await import('svelte/store');
  snapshot.store = w({ kind: 'none' });
  return { inspector: { snapshot: snapshot.store, follow: () => () => {}, edit: vi.fn(), reveal: vi.fn() } };
});

const { default: InspectorPanel, isEditDoubleClick, isEditKey, LINK_CLICK_WINDOW_MS, rowKey, uniqueKeys } = await import('./InspectorPanel.svelte');
const { docs } = (await import('$lib/stores/documents')) as unknown as { docs: { __set(v: unknown): void } };
const { createInspectorService } = await vi.importActual<typeof import('$lib/app/inspectorService')>('$lib/app/inspectorService');

const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

/** The real service over `lines`, with the document `d1` on a Fanuc mill with no machine or an IS-B one. */
function serviceFor(lines: string[], line: number, isB: boolean) {
  const base = profileOf('fanuc-gcode');
  const preset = base.machineParams?.numberInput?.presets.find((p) => p.id === 'is-b')?.value;
  const config = isB && preset ? { id: 'm', name: 'Mill IS-B', profile: 'fanuc-gcode', params: { numberInput: preset } } : null;
  const eff = effectiveMachine(base, config, config ? 'document' : 'none', {});
  const applied = applyMachine(base, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const effective = { profile: checked.profile, cp: compileProfile(checked.profile), codes: loadCodeDb(DBS[applied.codes]), machine: eff };
  const index = new ModalIndex(effective.cp, effective.codes, { every: 3 });
  index.reset(lines.length, (n) => lines[n - 1]);
  while (!index.buildSome(1000)) {
    /* until built */
  }
  const cursor = { line, column: 1, selectedChars: 0, selections: 1 };
  return createInspectorService({
    docs: { getActiveId: () => 'd1', get: () => ({ id: 'd1', path: null, title: 'T', readOnly: false, readOnlyReason: null }) as never },
    editor: {
      cursor: () => cursor,
      getLineCount: () => lines.length,
      getLines: (_id, s, e) => lines.slice(s - 1, e),
      versionId: () => 1,
      reveal: () => {},
      onDidChangeCursor: () => () => {},
      onDidChangeContent: () => () => {},
      onDidActivate: () => () => {},
    },
    effective: () => effective,
    modal: { stateAfter: (_id, n) => index.stateAfter(n), changed: writable(0), revisionOf: () => 1 },
    revisions: [],
    frame: (fn) => (fn(), () => {}),
    applyLines: () => ({ changedLines: 0 }),
    prompt: async () => undefined,
    status: { show: () => {} },
    t: (key) => key,
  });
}

const PROGRAM = ['O0001', 'G21 G90 G54', 'G0 X50 Y10', 'G1 X50. F200', 'G83 Z-20. R2. Q5. F100', 'M30'];

/** The opening tags that carry `data-testid="<id>"`, in document order. */
function tagsOf(html: string, id: string): string[] {
  return html.match(new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`, 'g')) ?? [];
}

function show(s: InspectorSnapshot): string {
  snapshot.store.set(s);
  docs.__set(s.kind === 'none' ? null : { id: 'd1' });
  return render(InspectorPanel).body;
}

describe('InspectorPanel', () => {
  it('keeps the panel seam, with empty attributes, and says to open a program', () => {
    const html = show({ kind: 'none' });
    expect(html).toContain('data-testid="inspector-panel"');
    expect(html).toContain('data-ready="0"');
    expect(html).toContain('Open a program to inspect it.');
    expect(html).not.toContain('data-testid="inspector-row"');
  });

  it('says why a file that is not a program, and a line that is too long, show nothing', () => {
    expect(show({ kind: 'notProgram' })).toContain('The inspector reads NC programs; this file is not one.');
    expect(show({ kind: 'tooLong', line: 7 })).toContain('Line 7 is too long to inspect.');
  });

  it('has a row per word with address, line, kind, editable, value and readings', () => {
    const html = show(serviceFor(PROGRAM, 3, true).inspectNow());
    expect(html).toContain('data-doc-id="d1"');
    expect(html).toContain('data-first-line="3"');
    expect(html).toContain('data-last-line="3"');
    expect(html).toContain('data-ready="1"');
    const rows = tagsOf(html, 'inspector-row');
    expect(rows).toHaveLength(3);
    const x = rows.find((row) => row.includes('data-address="X"'))!;
    expect(x).toContain('data-line="3"');
    expect(x).toContain('data-kind="address"');
    expect(x).toContain('data-editable="1"');
    expect(x).toContain('data-value="0.05"');
    expect(x).toContain('data-readings="0"');
    const g = rows.find((row) => row.includes('data-address="G"'))!;
    expect(g).toContain('data-kind="code"');
    expect(g).toContain('data-editable="0"');
    expect(html).toContain('0.05 mm');
    expect(html).toContain('Double-click a value, or press Enter on it, to change it.');
  });

  it('lists every reading of a word that depends on the machine, and marks the row not editable', () => {
    const html = show(serviceFor(PROGRAM, 3, false).inspectNow());
    const x = tagsOf(html, 'inspector-row').find((row) => row.includes('data-address="X"'))!;
    expect(x).toContain('data-editable="0"');
    expect(x).toContain('data-value=""');
    expect(x).toMatch(/data-readings="[2-9]"/);
    expect(html).toContain('Depends on the machine:');
    expect(html).toContain('Depends on the machine; choose a machine');
  });

  it('has state rows with key, line, assumed and set-here, and a link to the line that set them', () => {
    const html = show(serviceFor(PROGRAM, 3, true).inspectNow());
    const states = tagsOf(html, 'inspector-state');
    const motion = states.find((tag) => tag.includes('data-key="motion"'))!;
        expect(motion).toContain('data-line="3"');
    expect(motion).toContain('data-assumed="0"');
    expect(motion).toContain('data-set-here="1"');
    expect(html).toContain('set here');
    expect(html).toContain('>line 2</button>');
    expect(states.some((tag) => tag.includes('data-assumed="1"') && tag.includes('data-from="profile"'))).toBe(true);
    expect(html).toMatch(/Assumed: (profile default|machine|detected from the program)/);
  });

  it('has the cycle table with the code, the role and each parameter, written or not', () => {
    const html = show(serviceFor(PROGRAM, 5, true).inspectNow());
    const [cycle] = tagsOf(html, 'inspector-cycle');
    expect(cycle).toBeDefined();
    expect(cycle).toContain('data-code="G83"');
    expect(cycle).toContain('data-role="runs"');
    expect(html).toContain('Runs G83');
    expect(html).toMatch(/<tr[^>]*data-address="Q"[^>]*data-written="1"/);
    expect(html).toContain('not written');
  });

  it('says "waiting" in the state section and shows no state while the index has not got there', () => {
    const service = serviceFor(PROGRAM, 3, true);
    const ready = service.inspectNow();
    if (ready.kind !== 'block') throw new Error('block expected');
    const waiting: InspectorSnapshot = { ...ready, inspection: { ...ready.inspection, stateReady: false, state: [] } };
    const html = show(waiting);
    expect(html).toContain('data-ready="0"');
    expect(html).toContain('Waiting for the program to be read.');
    expect(html).not.toContain('data-testid="inspector-state"');
  });

  it('shows a name from a database as text, never as markup', () => {
    const service = serviceFor(PROGRAM, 3, true);
    const ready = service.inspectNow();
    if (ready.kind !== 'block') throw new Error('block expected');
    const words = ready.inspection.words.map((w) => (w.address === 'X' ? { ...w, meaning: '<img src=x onerror=alert(1)>' } : w));
    const html = show({ ...ready, inspection: { ...ready.inspection, words } });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  const row = {};
  const key = (o: Partial<Parameters<typeof isEditKey>[0]> = {}): Parameters<typeof isEditKey>[0] => ({
    key: 'Enter',
    isComposing: false,
    repeat: false,
    target: row,
    currentTarget: row,
    ...o,
  });

  it('only Enter edits, and not during an input method composition', () => {
    expect(isEditKey(key())).toBe(true);
    expect(isEditKey(key({ isComposing: true }))).toBe(false);
    expect(isEditKey(key({ key: ' ' }))).toBe(false);
    expect(isEditKey(key({ key: 'Escape' }))).toBe(false);
  });

  it('CODE-5: Enter on the "line N" link inside a row follows the link, it does not edit', () => {
    const link = {};
    expect(isEditKey(key({ target: link, currentTarget: row }))).toBe(false);
    expect(isEditKey(key({ target: row, currentTarget: row }))).toBe(true);
  });

  it('CODE-10: a key held down does not edit again', () => {
    expect(isEditKey(key({ repeat: true }))).toBe(false);
  });

  it('CODE-5: a double-click edits, but not one on the "line N" link or right after a click on it', () => {
    const inLink = { closest: (selector: string) => (selector === 'button' ? {} : null) };
    const inText = { closest: () => null };
    expect(isEditDoubleClick({ target: inText }, Infinity)).toBe(true);
    expect(isEditDoubleClick({ target: inLink }, Infinity)).toBe(false);
    // The first click of the pair moved the cursor and the link went away; the second lands on the row.
    expect(isEditDoubleClick({ target: inText }, LINK_CLICK_WINDOW_MS - 1)).toBe(false);
    expect(isEditDoubleClick({ target: inText }, LINK_CLICK_WINDOW_MS)).toBe(true);
  });

  it('CODE-10: the key of a row does not change when an edit changes the width of its value', () => {
    expect(rowKey({ line: 7, token: { start: 3 } })).toBe(rowKey({ line: 7, token: { start: 3 } }));
    const before = { line: 7, token: { start: 3, end: 5 } }; // X5
    const after = { line: 7, token: { start: 3, end: 6 } }; // X10
    expect(rowKey(after)).toBe(rowKey(before));
    expect(rowKey({ line: 7, token: { start: 9 } })).not.toBe(rowKey(before));
  });

  it('CODE-11: a parameter address or a preset that repeats still gets a key of its own', () => {
    const keyed = uniqueKeys([{ a: 'Q' }, { a: 'R' }, { a: 'Q' }], (p) => p.a);
    expect(new Set(keyed.map((k) => k.key)).size).toBe(3);
    expect(keyed.map((k) => k.item.a)).toEqual(['Q', 'R', 'Q']);
  });

  it('CODE-11: a cycle with two parameters of one address renders both', () => {
    const ready = serviceFor(PROGRAM, 5, true).inspectNow();
    if (ready.kind !== 'block' || !ready.inspection.cycle) throw new Error('cycle expected');
    const cycle = ready.inspection.cycle;
    const q = cycle.params.find((p) => p.param.address === 'Q')!;
    const html = show({ ...ready, inspection: { ...ready.inspection, cycle: { ...cycle, params: [...cycle.params, q] } } });
    expect(html.match(/<tr[^>]*data-address="Q"/g)).toHaveLength(2);
  });

  it('has a message for every key it names', () => {
    for (const key of [
      'inspector.panel.noDocument',
      'inspector.panel.notProgram',
      'inspector.panel.tooLong',
      'inspector.panel.setHere',
      'inspector.cycle.runs',
      'inspector.edit.title',
      'inspector.why.waiting',
    ]) {
      expect(hasKey(key), key).toBe(true);
    }
  });
});
