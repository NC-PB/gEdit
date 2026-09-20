// The modal frame's markup contract (plan §7.9): `modal` with `data-modal`, plus
// `modal-ok` and `modal-cancel`. Renaming one of these breaks the M2 runtime scenarios,
// so they are pinned here.
//
// Rendered with `svelte/server`, which needs no DOM. The focus trap, Esc, Enter and the
// focus that goes back to the editor need a real window and are covered by the M2 runtime
// scenarios.

import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Modal from './Modal.svelte';
import type { Snippet } from 'svelte';

const body = createRawSnippet(() => ({ render: () => '<p>Body</p>' })) as Snippet;
const extra = createRawSnippet(() => ({ render: () => '<button>Reset</button>' })) as Snippet;

interface Props {
  id: string;
  title: string;
  okLabel?: string;
  cancelLabel?: string;
  okDisabled?: boolean;
  hideOk?: boolean;
  onOk?: () => void;
  onCancel: () => void;
  children: Snippet;
  footer?: Snippet;
}

function markup(over: Partial<Props> = {}): string {
  return render(Modal, {
    props: { id: 'settings', title: 'Settings', onCancel: () => {}, children: body, ...over },
  }).body;
}

describe('Modal markup', () => {
  it('carries the test ids, the modal name and the title', () => {
    const html = markup();
    expect(html).toContain('data-testid="modal"');
    expect(html).toContain('data-modal="settings"');
    expect(html).toContain('data-testid="modal-ok"');
    expect(html).toContain('data-testid="modal-cancel"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain('<p>Body</p>');
  });

  it('labels the buttons from the common namespace by default', () => {
    const html = markup();
    expect(html).toContain('OK');
    expect(html).toContain('Cancel');
  });

  it('takes the labels it is given', () => {
    const html = markup({ okLabel: 'Run', cancelLabel: 'Close' });
    expect(html).toContain('Run');
    expect(html).toContain('Close');
    expect(html).not.toContain('>OK<');
  });

  it('disables the confirm button on request', () => {
    expect(markup()).not.toMatch(/data-testid="modal-ok"[^>]*disabled/);
    expect(markup({ okDisabled: true })).toMatch(/data-testid="modal-ok"[^>]*disabled/);
  });

  it('drops the confirm button for a close-only dialog', () => {
    const html = markup({ hideOk: true });
    expect(html).not.toContain('data-testid="modal-ok"');
    expect(html).toContain('data-testid="modal-cancel"');
  });

  it('renders the extra footer controls before the confirm button', () => {
    const html = markup({ footer: extra });
    expect(html).toContain('<button>Reset</button>');
    expect(html.indexOf('Reset')).toBeLessThan(html.indexOf('data-testid="modal-ok"'));
  });
});
