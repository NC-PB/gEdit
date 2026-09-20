// In-app modal UIs (plan §7.2, AD-6). Owner: WP1.1, with `prompt` and `form` from WP2.2.
//
// One modal at a time, rendered by `components/common/ModalHost.svelte`, which AppShell
// mounts exactly once. `isOpen` suspends the key dispatcher while a modal is up.
// M1 delivered `quickPick` and `open`; M2 adds `prompt` and `form`, which are ordinary
// `component` requests over `PromptInput` and `FormDialog` — the host needs no new kind,
// and both dialogs are built on `Modal`, so Esc, Enter and the focus trap are the same
// everywhere.
//
// A re-entrant call while a modal is open resolves `undefined` instead of queueing or
// stealing the host, the same rule `dialogs.exclusive` follows for native dialogs.

import { derived, writable, type Readable } from 'svelte/store';
import type { Component } from 'svelte';
import FormDialog from '$lib/components/forms/FormDialog.svelte';
import PromptInput from '$lib/components/common/PromptInput.svelte';
import type { FieldSpec } from '$lib/core/forms/types';
import type { Modals, Msg, QuickPickItem } from '$lib/app/types';

/** What ModalHost renders. `resolve` closes the modal and settles the caller's promise. */
export type ModalRequest =
  | {
      kind: 'quickPick';
      items: QuickPickItem<unknown>[];
      placeholder?: string;
      initialIndex?: number;
      resolve(value?: unknown): void;
    }
  | {
      kind: 'component';
      component: Component<Record<string, unknown>>;
      props: Record<string, unknown>;
      resolve(value?: unknown): void;
    };

const request = writable<ModalRequest | null>(null);

/** The open modal, for `ModalHost` only. Not part of the `Modals` contract. */
export const currentModal: Readable<ModalRequest | null> = derived(request, (r) => r);

let openRequest: ModalRequest | null = null;

/** Opens `build(resolve)`, or resolves undefined when another modal already owns the host. */
function openModal<T>(build: (resolve: (value?: unknown) => void) => ModalRequest): Promise<T | undefined> {
  if (openRequest) return Promise.resolve(undefined);
  return new Promise<T | undefined>((settle) => {
    let done = false;
    const resolve = (value?: unknown): void => {
      if (done) return;
      done = true;
      openRequest = null;
      request.set(null);
      settle(value as T | undefined);
    };
    const next = build(resolve);
    openRequest = next;
    request.set(next);
  });
}

/** A dialog component of ours, seen through the erased prop type the host renders with. */
function asModalComponent(c: unknown): Component<Record<string, unknown>> {
  return c as Component<Record<string, unknown>>;
}

export const modals: Modals = {
  quickPick<T>(
    items: QuickPickItem<T>[],
    o?: { placeholder?: string; initialIndex?: number },
  ): Promise<T | undefined> {
    return openModal<T>((resolve) => ({
      kind: 'quickPick',
      items: items as QuickPickItem<unknown>[],
      placeholder: o?.placeholder,
      initialIndex: o?.initialIndex,
      resolve,
    }));
  },

  prompt(o: {
    title: string;
    placeholder?: string;
    initial?: string;
    validate?: (v: string) => Msg | null;
  }): Promise<string | undefined> {
    return openModal<string>((resolve) => ({
      kind: 'component',
      component: asModalComponent(PromptInput),
      props: {
        title: o.title,
        placeholder: o.placeholder,
        initial: o.initial,
        validate: o.validate,
      },
      resolve,
    }));
  },

  form(o: {
    title: string;
    fields: FieldSpec[];
    values?: Record<string, unknown>;
    okLabel?: string;
    context?: { addresses?: string[] };
  }): Promise<Record<string, unknown> | undefined> {
    return openModal<Record<string, unknown>>((resolve) => ({
      kind: 'component',
      component: asModalComponent(FormDialog),
      props: {
        title: o.title,
        fields: o.fields,
        values: o.values,
        okLabel: o.okLabel,
        context: o.context,
      },
      resolve,
    }));
  },

  open<P extends Record<string, unknown>, R>(
    c: Component<P & { close: (r?: R) => void }>,
    props: P,
  ): Promise<R | undefined> {
    return openModal<R>((resolve) => ({
      kind: 'component',
      component: c as unknown as Component<Record<string, unknown>>,
      props,
      resolve,
    }));
  },

  isOpen: derived(request, (r) => r !== null),
};

/** Test seam: closes whatever is open (the caller's promise resolves to undefined). */
export function closeModalForTest(): void {
  openRequest?.resolve(undefined);
}
