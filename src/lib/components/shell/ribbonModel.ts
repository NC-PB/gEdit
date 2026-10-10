// Turning `ribbon.entries` into tabs and groups (plan §7.1, §5 WP1.5). Owner: WP1.5.
//
// The registry sorts only by tab and keeps registration order inside a tab (WP1.1 D6),
// because `RibbonItemDef.order` counts *inside a group* while `RibbonGroupDef.order`
// counts *inside a tab*: one global sort cannot express both. The grouping below is the
// other half, kept out of the component so it can be unit tested in node.
//
// Group order inside a tab: the smallest `order` any of the group's entries carries, and
// first appearance breaks a tie. Item order inside a group: `order`, then appearance.
// A `RibbonGroupDef` whose `group` key equals an item group's key joins that group and is
// rendered after its buttons, so a feature can add a custom control to an existing group.

import type { RibbonGroupDef, RibbonItemDef, RibbonTab } from '$lib/app/types';

/** Left-to-right order of the ribbon tabs (plan AD-6). */
export const TAB_ORDER: readonly RibbonTab[] = ['file', 'edit', 'insert', 'nc', 'tools', 'scripts', 'view'];

/** i18n key of each tab's label. Kept here so the component has no dynamic key building. */
export const TAB_LABEL: Readonly<Record<RibbonTab, string>> = {
  file: 'shell.tabFile',
  edit: 'shell.tabEdit',
  insert: 'shell.tabInsert',
  nc: 'shell.tabNc',
  tools: 'shell.tabTools',
  scripts: 'shell.tabScripts',
  view: 'shell.tabView',
};

/** The tab the ribbon opens on, and the one an unknown or retired tab id falls back to. */
export const DEFAULT_TAB: RibbonTab = 'file';

/**
 * A tab id read from somewhere (a remembered choice, a test) as a tab that exists in `tabs`.
 * 'home', the first tab of the old layout (before B1 A9), becomes the File tab, which took
 * its File and Recent groups; anything else that is not offered falls back to the first tab.
 */
export function resolveTab(saved: unknown, tabs: readonly RibbonTab[]): RibbonTab {
  const wanted = saved === 'home' ? DEFAULT_TAB : saved;
  const found = tabs.find((tab) => tab === wanted);
  return found ?? tabs[0] ?? DEFAULT_TAB;
}

export type RibbonEntry = RibbonItemDef | RibbonGroupDef;

export interface RibbonGroup {
  /** i18n key of the group label, and the group's identity inside a tab. */
  key: string;
  items: RibbonItemDef[];
  /** Custom groups (`ribbon.addGroup`) contributed under the same key. */
  customs: RibbonGroupDef[];
}

function isCustom(entry: RibbonEntry): entry is RibbonGroupDef {
  return 'component' in entry;
}

/**
 * The tabs that have at least one entry, in AD-6 order. The File tab is always present, so
 * the ribbon has a selected tab even before any contribution has loaded.
 */
export function tabsOf(entries: readonly RibbonEntry[]): RibbonTab[] {
  const used = new Set<RibbonTab>([DEFAULT_TAB]);
  for (const entry of entries) used.add(entry.tab);
  return TAB_ORDER.filter((tab) => used.has(tab));
}

/** The groups of one tab, ordered as described in the file header. */
export function groupsOf(entries: readonly RibbonEntry[], tab: RibbonTab): RibbonGroup[] {
  interface Bucket extends RibbonGroup {
    order: number;
    seq: number;
    itemSeq: Map<RibbonItemDef, number>;
  }
  const buckets = new Map<string, Bucket>();
  let seq = 0;

  for (const entry of entries) {
    if (entry.tab !== tab) continue;
    const at = seq++;
    let bucket = buckets.get(entry.group);
    if (!bucket) {
      bucket = { key: entry.group, items: [], customs: [], order: entry.order, seq: at, itemSeq: new Map() };
      buckets.set(entry.group, bucket);
    }
    bucket.order = Math.min(bucket.order, entry.order);
    if (isCustom(entry)) bucket.customs.push(entry);
    else {
      bucket.itemSeq.set(entry, at);
      bucket.items.push(entry);
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.order - b.order || a.seq - b.seq)
    .map((bucket) => ({
      key: bucket.key,
      items: bucket.items.sort(
        (a, b) => a.order - b.order || (bucket.itemSeq.get(a) ?? 0) - (bucket.itemSeq.get(b) ?? 0),
      ),
      customs: bucket.customs.sort((a, b) => a.order - b.order),
    }));
}
