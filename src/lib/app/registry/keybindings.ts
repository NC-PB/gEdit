// Default Monaco keybindings a contribution takes over (plan AD-4, `Contribution.keybindingRemovals`).
// Owner: WP1.1. Not part of §7.1: the contract puts the removals on `Contribution`, but
// gives them no registry, and `app/keys/monacoBridge.ts` needs to read them after the
// contributions have loaded.
//
// A removal is `{ keys: 'F2', command: 'editor.action.rename' }`; the bridge turns it into
// `monaco.editor.addKeybindingRules([{ keybinding, command: '-editor.action.rename' }])`.

import { derived, get, writable, type Readable } from 'svelte/store';
import type { Disposable, KeySpec } from '$lib/app/types';

export interface KeybindingRemoval {
  keys: KeySpec;
  command: string;
}

export interface KeybindingRemovalRegistry {
  add(removals: KeybindingRemoval[]): Disposable;
  list(): KeybindingRemoval[];
  readonly removals: Readable<KeybindingRemoval[]>;
}

interface Entry {
  removal: KeybindingRemoval;
  seq: number;
}

const entries = writable<Entry[]>([]);
let nextSeq = 0;

export const keybindingRemovals: KeybindingRemovalRegistry = {
  add(removals: KeybindingRemoval[]): Disposable {
    const added: Entry[] = removals.map((removal) => ({ removal, seq: nextSeq++ }));
    entries.update((list) => [...list, ...added]);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const seqs = new Set(added.map((e) => e.seq));
      entries.update((list) => list.filter((e) => !seqs.has(e.seq)));
    };
  },
  list(): KeybindingRemoval[] {
    return get(entries).map((e) => e.removal);
  },
  removals: derived(entries, (list) => list.map((e) => e.removal)),
};

/** Test seam: drops every registration. */
export function resetKeybindingRemovalsForTest(): void {
  entries.set([]);
}
