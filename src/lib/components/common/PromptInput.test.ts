// The prompt's markup contract (plan §7.2, §7.9): a `Modal` named `prompt` around one
// `form-field` called `value`. Rendered with `svelte/server`, which needs no DOM; typing,
// Enter and Esc are covered by the M2 runtime scenarios.

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import PromptInput from './PromptInput.svelte';
import { t } from '$lib/i18n';
import type { Msg } from '$lib/app/types';

interface Props {
  title: string;
  placeholder?: string;
  initial?: string;
  validate?: (v: string) => Msg | null;
  close: (value?: string) => void;
}

function markup(over: Partial<Props> = {}): string {
  return render(PromptInput, {
    props: { title: 'Rename', close: () => {}, ...over },
  }).body;
}

const required: Msg = { key: 'forms.errors.required' };

describe('PromptInput markup', () => {
  it('is a modal named prompt with the shared OK and Cancel buttons', () => {
    const html = markup();
    expect(html).toContain('data-modal="prompt"');
    expect(html).toContain('data-testid="modal-ok"');
    expect(html).toContain('data-testid="modal-cancel"');
    expect(html).toContain('aria-label="Rename"');
  });

  it('carries the single field, its placeholder and the initial value', () => {
    const html = markup({ initial: 'a.nc', placeholder: 'New name' });
    expect(html).toContain('data-testid="form-field"');
    expect(html).toContain('data-field="value"');
    expect(html).toContain('value="a.nc"');
    expect(html).toContain('placeholder="New name"');
  });

  it('shows no error and an enabled OK while the value is acceptable', () => {
    const html = markup({ initial: 'a.nc', validate: (v) => (v ? null : required) });
    expect(html).not.toContain('data-error=');
    expect(html).not.toMatch(/data-testid="modal-ok"[^>]*disabled/);
  });

  it('reports the message and blocks OK while the value is not', () => {
    const html = markup({ initial: '', validate: (v) => (v ? null : required) });
    // §7.9: `data-error` on a `form-field` is the message KEY, here and in FormRenderer,
    // so one runtime check works against a prompt and a generated form alike (G8 M2).
    expect(html).toContain('data-error="forms.errors.required"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/data-testid="modal-ok"[^>]*disabled/);
  });

  it('shows the translated message to the reader, not the key', () => {
    const html = markup({ initial: '', validate: () => ({ key: 'forms.errors.range', params: { min: 1, max: 9 } }) });
    expect(html).toContain('data-error="forms.errors.range"');
    expect(html).toContain(t('forms.errors.range', { min: 1, max: 9 }));
  });
});
