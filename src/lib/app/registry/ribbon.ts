// The ribbon registry (plan §7.1). Owner: WP1.1.
//
// `entries` is the merged list of command items and custom groups, sorted by ribbon tab
// and, inside a tab, kept in contribution order (contributions load alphabetically by
// file name). Grouping by `group` and ordering inside a group is the Ribbon component's
// job (WP1.5): `RibbonItemDef.order` counts inside a group, `RibbonGroupDef.order` inside
// a tab, so the two cannot be merged into one global sort here.

import { derived, writable } from 'svelte/store';
import type {
  Disposable,
  RibbonGroupDef,
  RibbonItemDef,
  RibbonRegistry,
  RibbonTab,
} from '$lib/app/types';

/** Left-to-right order of the ribbon tabs (plan AD-6). */
const TAB_ORDER: readonly RibbonTab[] = ['home', 'insert', 'nc', 'tools', 'view'];

interface Entry {
  def: RibbonItemDef | RibbonGroupDef;
  seq: number;
}

const entries = writable<Entry[]>([]);
let nextSeq = 0;

function tabIndex(tab: RibbonTab): number {
  const i = TAB_ORDER.indexOf(tab);
  return i < 0 ? TAB_ORDER.length : i;
}

function addAll(defs: (RibbonItemDef | RibbonGroupDef)[]): Disposable {
  const added: Entry[] = defs.map((def) => ({ def, seq: nextSeq++ }));
  entries.update((list) =>
    [...list, ...added].sort((a, b) => tabIndex(a.def.tab) - tabIndex(b.def.tab) || a.seq - b.seq),
  );
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const seqs = new Set(added.map((e) => e.seq));
    entries.update((list) => list.filter((e) => !seqs.has(e.seq)));
  };
}

export const ribbon: RibbonRegistry = {
  add(items: RibbonItemDef[]): Disposable {
    return addAll(items);
  },
  addGroup(g: RibbonGroupDef): Disposable {
    return addAll([g]);
  },
  entries: derived(entries, (list) => list.map((e) => e.def)),
};

/** Test seam: drops every registration. */
export function resetRibbonForTest(): void {
  entries.set([]);
}
