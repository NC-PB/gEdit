// The modal host renders whatever `modals` has open, one at a time, with the `modal` and
// `data-modal` test seams (plan §7.9, AD-6). Focus trapping, Esc and the click outside
// need a real window and are covered by the M1 runtime scenarios.

import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import ModalHost from './ModalHost.svelte';
import { closeModalForTest, modals } from '$lib/app/modals';

function markup(): string {
  return render(ModalHost).body;
}

afterEach(() => {
  closeModalForTest();
});

describe('ModalHost markup', () => {
  it('renders nothing while no modal is open', () => {
    expect(markup()).not.toContain('data-testid="modal"');
  });

  it('renders the QuickPick of an open quickPick request', () => {
    void modals.quickPick([{ label: 'CRLF', value: 'crlf' }], { placeholder: 'Line ending' });
    const html = markup();
    expect(html).toContain('data-testid="modal"');
    expect(html).toContain('data-modal="quick-pick"');
    expect(html).toContain('data-testid="quick-pick"');
    expect(html).toContain('placeholder="Line ending"');
  });
});
