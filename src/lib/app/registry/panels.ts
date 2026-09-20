// The panel registry (plan §7.1, AD-6). Owner: WP1.1.
//
// `panels` is sorted by region ('left', 'bottom', 'overlay', 'banner'), then by `order`,
// then by registration order. AppShell (WP1.5) renders each region from this list.
// A duplicate panel id throws, the same way a duplicate command id does: ids address
// panels in `layout.show()` and in the `panel` test id, so two of them is a defect.

import { derived, writable } from 'svelte/store';
import type { Disposable, PanelDef, PanelRegion, PanelRegistry } from '$lib/app/types';

const REGION_ORDER: readonly PanelRegion[] = ['left', 'bottom', 'overlay', 'banner'];

interface Entry {
  def: PanelDef;
  seq: number;
}

const entries = writable<Entry[]>([]);
const ids = new Set<string>();
let nextSeq = 0;

function regionIndex(region: PanelRegion): number {
  const i = REGION_ORDER.indexOf(region);
  return i < 0 ? REGION_ORDER.length : i;
}

export const panels: PanelRegistry = {
  add(p: PanelDef): Disposable {
    if (!p.id) throw new Error('panel registration: a panel has no id');
    if (ids.has(p.id)) throw new Error(`panel "${p.id}" is already registered`);
    ids.add(p.id);
    const entry: Entry = { def: p, seq: nextSeq++ };
    entries.update((list) =>
      [...list, entry].sort(
        (a, b) =>
          regionIndex(a.def.region) - regionIndex(b.def.region) ||
          a.def.order - b.def.order ||
          a.seq - b.seq,
      ),
    );
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      ids.delete(p.id);
      entries.update((list) => list.filter((e) => e !== entry));
    };
  },
  panels: derived(entries, (list) => list.map((e) => e.def)),
};

/** Test seam: drops every registration. */
export function resetPanelsForTest(): void {
  ids.clear();
  entries.set([]);
}
