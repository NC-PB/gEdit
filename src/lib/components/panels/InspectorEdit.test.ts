// The inspector's value prompt (Phase 3 plan P3.2b, §6.8: `inspector-edit`): the field the harness
// types into, the attributes it reads, and the refusal next to the field. Rendered with
// `svelte/server`; typing, Enter and Esc belong to `Modal` and are pinned by its own test.

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import InspectorEdit, { isHeldEnter } from './InspectorEdit.svelte';
import type { Msg } from '$lib/app/types';

function html(validate: (v: string) => Msg | null, initial = '0.05'): string {
  return render(InspectorEdit, {
    props: { title: 'Change X50', label: 'New value in mm', address: 'X', initial, validate, close: () => {} },
  }).body;
}

describe('InspectorEdit', () => {
  it('is a dialog with the value in a field that carries the word and no error', () => {
    const body = html(() => null);
    expect(body).toContain('data-modal="inspector-edit"');
    expect(body).toContain('Change X50');
    expect(body).toContain('New value in mm');
    const input = body.match(/<input[^>]*data-testid="inspector-edit"[^>]*>/)![0];
    expect(input).toContain('data-address="X"');
    expect(input).toContain('value="0.05"');
    expect(input).not.toContain('data-error');
    expect(body).not.toContain('class="error');
    expect(body).not.toMatch(/data-testid="modal-ok"[^>]*disabled/);
  });

  it('shows the refusal under the field in plain words, keeps its message key in data-error, and disables OK', () => {
    const body = html((v) => ({ key: 'inspector.why.min', params: { min: '1' } }), '0');
    const input = body.match(/<input[^>]*data-testid="inspector-edit"[^>]*>/)![0];
    expect(input).toContain('data-error="inspector.why.min"');
    expect(input).toContain('aria-invalid="true"');
    expect(body).toContain('The smallest value allowed is 1.');
    expect(body).toMatch(/<button[^>]*data-testid="modal-ok"[^>]*disabled/);
  });

  it('CODE-10: announces the refusal to a screen reader as soon as it appears', () => {
    const body = html(() => ({ key: 'inspector.why.min', params: { min: '1' } }), '0');
    expect(body).toMatch(/<p[^>]*id="inspector-edit-error"[^>]*role="alert"/);
  });

  it('CODE-10: an Enter that repeats from a key held down is not an Enter that confirms', () => {
    expect(isHeldEnter({ key: 'Enter', repeat: true })).toBe(true);
    expect(isHeldEnter({ key: 'Enter', repeat: false })).toBe(false);
    expect(isHeldEnter({ key: 'a', repeat: true })).toBe(false);
  });
});
