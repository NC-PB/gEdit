// In-app modals (plan §7.2, AD-6): one at a time, `isOpen` for the key dispatcher, and
// `prompt`/`form` (M2) as `component` requests over the WP2.2 dialogs. The DOM half
// (QuickPick, ModalHost) is covered by the runtime harness, which is the only place a
// component actually renders.

import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import { closeModalForTest, currentModal, dismissModal, modals } from './modals';
import FormDialog from '$lib/components/forms/FormDialog.svelte';
import PromptInput from '$lib/components/common/PromptInput.svelte';
import type { FieldSpec } from '$lib/core/forms/types';
import type { Msg, QuickPickItem } from '$lib/app/types';

const items: QuickPickItem<string>[] = [
  { label: 'CRLF', value: 'crlf' },
  { label: 'LF', description: 'Unix', value: 'lf' },
];

afterEach(() => {
  closeModalForTest();
});

describe('quickPick', () => {
  it('publishes the request and resolves with the picked value', async () => {
    const picked = modals.quickPick(items, { placeholder: 'Line ending', initialIndex: 1 });
    const request = get(currentModal);
    expect(request?.kind).toBe('quickPick');
    expect(get(modals.isOpen)).toBe(true);
    if (request?.kind !== 'quickPick') throw new Error('expected a quickPick');
    expect(request.items).toEqual(items);
    expect(request.placeholder).toBe('Line ending');
    expect(request.initialIndex).toBe(1);

    request.resolve('lf');
    await expect(picked).resolves.toBe('lf');
    expect(get(currentModal)).toBeNull();
    expect(get(modals.isOpen)).toBe(false);
  });

  it('resolves undefined when it is dismissed', async () => {
    const picked = modals.quickPick(items);
    get(currentModal)?.resolve(undefined);
    await expect(picked).resolves.toBeUndefined();
  });

  it('ignores a second resolve', async () => {
    const picked = modals.quickPick(items);
    const request = get(currentModal);
    request?.resolve('crlf');
    request?.resolve('lf');
    await expect(picked).resolves.toBe('crlf');
  });

  it('refuses a re-entrant call instead of stealing the host', async () => {
    const first = modals.quickPick(items);
    await expect(modals.quickPick(items)).resolves.toBeUndefined();
    expect(get(currentModal)?.kind).toBe('quickPick');
    get(currentModal)?.resolve('crlf');
    await expect(first).resolves.toBe('crlf');
  });
});

describe('open', () => {
  it('publishes the component and its props, and resolves with the result', async () => {
    const dialog = (() => {}) as unknown as Component<{ path: string; close: (r?: number) => void }>;
    const result = modals.open(dialog, { path: '/nc/a.nc' });
    const request = get(currentModal);
    expect(request?.kind).toBe('component');
    if (request?.kind !== 'component') throw new Error('expected a component modal');
    expect(request.props).toEqual({ path: '/nc/a.nc' });
    request.resolve(42);
    await expect(result).resolves.toBe(42);
  });
});

describe('open options and the host’s own dismissal (P3b intB)', () => {
  const dialog = (() => {}) as unknown as Component<{ close: (r?: number) => void }>;

  it('passes `wide` and `mayClose` on to the request', () => {
    const mayClose = () => true;
    void modals.open(dialog, {}, { wide: true, mayClose });
    const request = get(currentModal);
    if (request?.kind !== 'component') throw new Error('expected a component modal');
    expect(request.wide).toBe(true);
    expect(request.mayClose).toBe(mayClose);
  });

  it('closes a dialog without a hook at once, as before', async () => {
    const result = modals.open(dialog, {});
    await expect(dismissModal()).resolves.toBe(true);
    await expect(result).resolves.toBeUndefined();
    expect(get(modals.isOpen)).toBe(false);
  });

  it('closes a quick pick, which has no hook', async () => {
    const picked = modals.quickPick(items);
    await expect(dismissModal()).resolves.toBe(true);
    await expect(picked).resolves.toBeUndefined();
  });

  it('keeps the dialog open when the hook says no, and closes it when the hook says yes', async () => {
    let answer = false;
    let asked = 0;
    const result = modals.open(dialog, {}, { mayClose: async () => (asked++, answer) });
    await expect(dismissModal()).resolves.toBe(false);
    expect(asked).toBe(1);
    expect(get(modals.isOpen)).toBe(true);
    answer = true;
    await expect(dismissModal()).resolves.toBe(true);
    await expect(result).resolves.toBeUndefined();
    expect(get(modals.isOpen)).toBe(false);
  });

  it('asks once while a question is open (a second press waits), and keeps the dialog when the hook throws', async () => {
    let release: (v: boolean) => void = () => {};
    let asked = 0;
    void modals.open(dialog, {}, { mayClose: () => new Promise<boolean>((r) => ((asked++, (release = r)))) });
    const first = dismissModal();
    await expect(dismissModal()).resolves.toBe(false);
    expect(asked).toBe(1);
    release(false);
    await expect(first).resolves.toBe(false);
    closeModalForTest();

    const quiet = console.error;
    console.error = () => {};
    try {
      void modals.open(dialog, {}, { mayClose: () => Promise.reject(new Error('boom')) });
      await expect(dismissModal()).resolves.toBe(false);
      expect(get(modals.isOpen)).toBe(true);
    } finally {
      console.error = quiet;
    }
  });

  it('does nothing when no modal is open', async () => {
    await expect(dismissModal()).resolves.toBe(false);
  });
});

describe('prompt', () => {
  it('opens PromptInput with the options it was given and resolves with the value', async () => {
    // A `Msg`, not display text: `data-error` on a `form-field` is the key (§7.9).
    const validate = (v: string): Msg | null => (v ? null : { key: 'forms.errors.required' });
    const answer = modals.prompt({
      title: 'Rename',
      placeholder: 'New name',
      initial: 'a.nc',
      validate,
    });
    const request = get(currentModal);
    expect(request?.kind).toBe('component');
    if (request?.kind !== 'component') throw new Error('expected a component modal');
    expect(request.component).toBe(PromptInput);
    expect(request.props).toEqual({
      title: 'Rename',
      placeholder: 'New name',
      initial: 'a.nc',
      validate,
    });
    expect(get(modals.isOpen)).toBe(true);

    request.resolve('b.nc');
    await expect(answer).resolves.toBe('b.nc');
    expect(get(modals.isOpen)).toBe(false);
  });

  it('resolves undefined when it is dismissed', async () => {
    const answer = modals.prompt({ title: 'Rename' });
    get(currentModal)?.resolve(undefined);
    await expect(answer).resolves.toBeUndefined();
  });

  it('refuses a re-entrant call instead of stealing the host', async () => {
    const first = modals.prompt({ title: 'Rename' });
    await expect(modals.prompt({ title: 'Other' })).resolves.toBeUndefined();
    expect(get(currentModal)?.kind).toBe('component');
    get(currentModal)?.resolve('b.nc');
    await expect(first).resolves.toBe('b.nc');
  });
});

describe('form', () => {
  const fields: FieldSpec[] = [{ id: 'feed', type: 'number', label: 'Feed', default: 100 }];

  it('opens FormDialog with the fields, remembered values and context', async () => {
    const result = modals.form({
      title: 'Renumber',
      fields,
      values: { feed: 250 },
      okLabel: 'Run',
      context: { addresses: ['X', 'Y'] },
    });
    const request = get(currentModal);
    if (request?.kind !== 'component') throw new Error('expected a component modal');
    expect(request.component).toBe(FormDialog);
    expect(request.props).toEqual({
      title: 'Renumber',
      fields,
      values: { feed: 250 },
      okLabel: 'Run',
      context: { addresses: ['X', 'Y'] },
    });

    request.resolve({ feed: 250 });
    await expect(result).resolves.toEqual({ feed: 250 });
  });

  it('resolves undefined when it is cancelled', async () => {
    const result = modals.form({ title: 'Renumber', fields });
    get(currentModal)?.resolve(undefined);
    await expect(result).resolves.toBeUndefined();
  });
});
