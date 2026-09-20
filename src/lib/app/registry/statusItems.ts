// The status-item registry (plan §7.1). Owner: WP1.1.
//
// `items` is sorted by side ('left' before 'right'), then by `order`, then by
// registration order. The StatusBar (WP1.5) renders each side from this list; every item
// component carries `data-testid="status-item"` with its `data-item` name (§7.9).
// A duplicate item id throws, like a duplicate command or panel id.

import { derived, writable } from 'svelte/store';
import type { Disposable, StatusItemDef, StatusItemRegistry } from '$lib/app/types';

interface Entry {
  def: StatusItemDef;
  seq: number;
}

const entries = writable<Entry[]>([]);
const ids = new Set<string>();
let nextSeq = 0;

export const statusItems: StatusItemRegistry = {
  add(s: StatusItemDef): Disposable {
    if (!s.id) throw new Error('status item registration: an item has no id');
    if (ids.has(s.id)) throw new Error(`status item "${s.id}" is already registered`);
    ids.add(s.id);
    const entry: Entry = { def: s, seq: nextSeq++ };
    entries.update((list) =>
      [...list, entry].sort(
        (a, b) =>
          (a.def.side === b.def.side ? 0 : a.def.side === 'left' ? -1 : 1) ||
          a.def.order - b.def.order ||
          a.seq - b.seq,
      ),
    );
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      ids.delete(s.id);
      entries.update((list) => list.filter((e) => e !== entry));
    };
  },
  items: derived(entries, (list) => list.map((e) => e.def)),
};

/** Test seam: drops every registration. */
export function resetStatusItemsForTest(): void {
  ids.clear();
  entries.set([]);
}
