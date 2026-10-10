// The modal host renders whatever `modals` has open, one at a time, with the `modal` and
// `data-modal` test seams (plan §7.9, AD-6). Focus trapping, Esc and the click outside
// need a real window and are covered by the M1 runtime scenarios.

import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import ModalHost, { pressedOutside } from './ModalHost.svelte';
import { closeModalForTest, dismissModal, modals } from '$lib/app/modals';

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

describe('ModalHost: wide panel and the question before it closes (P3b intB)', () => {
  const dialog = (() => {}) as never;

  it('draws the panel wide only when the dialog asked for it', () => {
    void modals.open(dialog, {});
    expect(markup()).not.toMatch(/class="modal-panel[^"]*\bwide\b/);
    closeModalForTest();
    void modals.open(dialog, {}, { wide: true });
    expect(markup()).toMatch(/class="modal-panel[^"]*\bwide\b/);
  });

  // The click outside and Esc need a real window (the runtime harness drives them); what a unit
  // test can pin is that neither path resolves the request by itself any more, so the hook is asked.
  it('goes through dismissModal for Esc and for a press outside, never resolving the request itself', () => {
    const source = readFileSync(new URL('./ModalHost.svelte', import.meta.url), 'utf8');
    expect(source).not.toMatch(/request\.resolve\(undefined\)/);
    expect(source.match(/dismissModal\(\)/g)?.length).toBe(2);
  });

  // P3b fix H, finding 5 (hardening): a dialog is built for one request. A request that replaces another before the
  // host has drawn the empty state in between would be handed to the dialog that is already there, and the form dialog
  // seeds its values from its props once. No DOM here: the key is pinned in the source, the runtime harness opens the forms.
  it('draws every request in a dialog of its own: the dialog is keyed by the request', () => {
    const source = readFileSync(new URL('./ModalHost.svelte', import.meta.url), 'utf8');
    expect(source).toMatch(/\{#key request\}[\s\S]*<Dialog \{\.\.\.request\.props\}[\s\S]*\{\/key\}/);
  });

  // The grep above only pins that the handlers call dismissModal; the decision "outside the panel" is
  // a function, so a test can tell an inside press from an outside one (P3b code review CODE-16).
  it('a press counts as outside only when the panel does not contain its target', () => {
    const inside = { nodeType: 1 };
    const elsewhere = { nodeType: 1 };
    const panel = { contains: (node: unknown) => node === inside };
    expect(pressedOutside(panel, elsewhere)).toBe(true);
    expect(pressedOutside(panel, inside)).toBe(false);
    // Not a DOM node (the window) and no panel yet: not outside.
    expect(pressedOutside(panel, {})).toBe(false);
    expect(pressedOutside(panel, null)).toBe(false);
    expect(pressedOutside(undefined, elsewhere)).toBe(false);
  });

  it('the host asks the dialog before an outside press or Esc closes it: the hook decides, a refusal keeps the dialog open', async () => {
    let asked = 0;
    let answer = false;
    const closed = modals.open(dialog, {}, { mayClose: () => (asked++, answer) });
    expect(await dismissModal()).toBe(false);
    expect(asked).toBe(1);
    answer = true;
    expect(await dismissModal()).toBe(true);
    await closed;
    expect(asked).toBe(2);
  });
});
