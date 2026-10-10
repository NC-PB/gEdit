// The generated-form dialog (plan §7.2, §7.5): `Modal` named `form` around
// `FormRenderer`, starting at `initialValues()` and keeping OK disabled while
// `validateFields()` has something to say.
//
// Rendered with `svelte/server`, which needs no DOM: it covers the starting values and
// the initial OK state. Editing a field and confirming are covered by the M2 runtime
// scenarios.

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import FormDialog from './FormDialog.svelte';
import type { FieldSpec } from '$lib/core/forms/types';
import type { FormLiveResult } from '$lib/app/types';

interface Props {
  title: string;
  fields: FieldSpec[];
  values?: Record<string, unknown>;
  okLabel?: string;
  context?: { addresses?: string[] };
  live?: (values: Record<string, unknown>) => FormLiveResult;
  note?: string;
  marker?: { testid: string; data: Record<string, string> };
  close: (values?: Record<string, unknown>) => void;
}

const fields: FieldSpec[] = [
  { id: 'start', type: 'integer', label: 'Start at', default: 10, min: 1, max: 9999 },
  { id: 'comments', type: 'bool', label: 'Renumber comments', default: false },
];

function markup(over: Partial<Props> = {}): string {
  return render(FormDialog, {
    props: { title: 'Renumber', fields, close: () => {}, ...over },
  }).body;
}

describe('FormDialog markup', () => {
  it('is a modal named form, with the title and the shared buttons', () => {
    const html = markup();
    expect(html).toContain('data-modal="form"');
    expect(html).toContain('aria-label="Renumber"');
    expect(html).toContain('data-testid="modal-ok"');
    expect(html).toContain('data-testid="modal-cancel"');
  });

  it('starts every field at its default and enables OK', () => {
    const html = markup();
    expect(html).toContain('data-field="start"');
    expect(html).toContain('value="10"');
    expect(html).toContain('data-field="comments"');
    expect(html).not.toMatch(/data-testid="modal-ok"[^>]*disabled/);
  });

  it('prefers the values it was handed, which is where remembered parameters arrive', () => {
    expect(markup({ values: { start: 500 } })).toContain('value="500"');
  });

  it('falls back to the default when a remembered value no longer suits the field', () => {
    expect(markup({ values: { start: 'many' } })).toContain('value="10"');
  });

  it('blocks OK and names the problem when a starting value is out of range', () => {
    const required: FieldSpec[] = [{ id: 'name', type: 'text', label: 'Name', required: true }];
    const html = markup({ fields: required });
    expect(html).toContain('data-error="forms.errors.required"');
    expect(html).toMatch(/data-testid="modal-ok"[^>]*disabled/);
  });

  it('takes the confirm label it is given', () => {
    expect(markup({ okLabel: 'Run' })).toContain('Run');
  });

  it('says so for a form with no fields at all', () => {
    const html = markup({ fields: [] });
    expect(html).toContain('There is nothing to set here.');
    expect(html).not.toContain('data-testid="form-field"');
    expect(html).not.toMatch(/data-testid="modal-ok"[^>]*disabled/);
  });

  it('passes the context through to the address list', () => {
    const list: FieldSpec[] = [{ id: 'keep', type: 'address-list', label: 'Keep' }];
    const html = markup({ fields: list, context: { addresses: ['X', 'Z'] } });
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  });
});

// Phase 3 (P3.5): the `live` hook, the note and the marker.
describe('FormDialog with a live hook', () => {
  const template: FieldSpec[] = [
    { id: 'n', type: 'text', label: 'Speed', required: true, default: '3000' },
    { id: 'feed', type: 'text', label: 'Feed', readOnly: true },
  ];

  it('shows the values the hook computes in the read-only fields and the text it previews', () => {
    const html = markup({
      fields: template,
      live: () => ({ values: { feed: '600' }, preview: 'N10 G1 F600.' }),
    });
    expect(html).toContain('data-field="feed"');
    expect(html).toContain('data-readonly="true"');
    expect(html).toContain('value="600"');
    expect(html).toContain('data-testid="template-preview"');
    expect(html).toContain('N10 G1 F600.');
    expect(html).not.toMatch(/data-testid="template-preview"[^>]*data-error/);
    expect(html).not.toMatch(/data-testid="modal-ok"[^>]*disabled/);
  });

  it('calls the hook with the starting values', () => {
    const seen: Record<string, unknown>[] = [];
    markup({ fields: template, values: { n: '4000' }, live: (v) => (seen.push(v), {}) });
    expect(seen[0]).toMatchObject({ n: '4000' });
  });

  it('puts the hook’s field errors beside their fields, in place of the form’s own, and blocks OK', () => {
    const html = markup({
      fields: template,
      live: () => ({ fieldErrors: { n: { key: 'templates.value.notANumber' } } }),
    });
    expect(html).toContain('data-field="n"');
    expect(html).toContain('data-error="templates.value.notANumber"');
    expect(html).toContain('Enter a number.');
    expect(html).toMatch(/data-testid="modal-ok"[^>]*disabled/);
    // No text to show while a value is refused: the preview says why, with the key to look for.
    expect(html).toMatch(/data-testid="template-preview"[^>]*data-error="templates.value.notANumber"/);
    expect(html).toContain('Correct the marked values to see the text.');
  });

  it('shows an error that belongs to no field in place of the preview and blocks OK', () => {
    const html = markup({ fields: template, live: () => ({ error: { key: 'templates.value.blockNumberMax', params: { max: 99999 } } }) });
    expect(html).toMatch(/data-testid="template-preview"[^>]*data-error="templates.value.blockNumberMax"/);
    expect(html).toContain('The next block number would be above 99999.');
    expect(html).toMatch(/data-testid="modal-ok"[^>]*disabled/);
  });

  it('draws no preview when the hook answers nothing to preview', () => {
    expect(markup({ fields: template, live: () => ({}) })).not.toContain('template-preview');
  });

  it('draws the note above the fields, and an element for the marker even when the note is empty', () => {
    const html = markup({ fields: template, note: 'Review pending: check it.' });
    expect(html).toContain('data-testid="form-note"');
    expect(html).toContain('Review pending: check it.');
    expect(html.indexOf('form-note')).toBeLessThan(html.indexOf('data-field="n"'));

    const cycle = markup({ fields: template, marker: { testid: 'cycle-form', data: { cycle: 'G83', mode: 'edit' } } });
    expect(cycle).toMatch(/data-testid="cycle-form"/);
    expect(cycle).toContain('data-cycle="G83"');
    expect(cycle).toContain('data-mode="edit"');
  });

  it('is the P2 form without any of them', () => {
    const html = markup();
    expect(html).not.toContain('form-note');
    expect(html).not.toContain('template-preview');
  });
});
