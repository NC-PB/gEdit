// In-app modals (plan §7.2, AD-6): one at a time, `isOpen` for the key dispatcher, and
// `prompt`/`form` still refusing until M2. The DOM half (QuickPick, ModalHost) is covered
// by the runtime harness, which is the only place a component actually renders.

import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import { closeModalForTest, currentModal, modals } from './modals';
import type { QuickPickItem } from '$lib/app/types';

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

describe('prompt and form', () => {
  it('refuse until M2', async () => {
    await expect(modals.prompt({ title: 't' })).rejects.toThrow('not implemented: M2');
    await expect(modals.form({ title: 't', fields: [] })).rejects.toThrow('not implemented: M2');
    expect(get(modals.isOpen)).toBe(false);
  });
});
