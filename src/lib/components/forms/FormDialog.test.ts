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

interface Props {
  title: string;
  fields: FieldSpec[];
  values?: Record<string, unknown>;
  okLabel?: string;
  context?: { addresses?: string[] };
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
