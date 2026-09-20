// Turning the flat registry list into ribbon tabs and groups (plan §7.1).
// The registry sorts by tab only, so everything below is what the Ribbon adds.

import { describe, expect, it } from 'vitest';
import { groupsOf, TAB_LABEL, TAB_ORDER, tabsOf, type RibbonEntry } from './ribbonModel';
import { hasKey } from '$lib/i18n';
import ScriptOutputPanel from '$lib/components/panels/ScriptOutputPanel.svelte';
import type { RibbonGroupDef, RibbonItemDef, RibbonTab } from '$lib/app/types';

function item(tab: RibbonTab, group: string, command: string, order: number): RibbonItemDef {
  return { tab, group, command, order };
}

function custom(tab: RibbonTab, group: string, order: number): RibbonGroupDef {
  return { tab, group, order, component: ScriptOutputPanel };
}

describe('tab labels', () => {
  it('has a message for every tab', () => {
    for (const tab of TAB_ORDER) expect(hasKey(TAB_LABEL[tab]), tab).toBe(true);
  });
});

describe('tabsOf', () => {
  it('keeps only the tabs that have entries, in AD-6 order', () => {
    const entries: RibbonEntry[] = [
      item('view', 'view.groupPanels', 'view.toggleSidePanel', 10),
      item('insert', 'blocks.groupBlocks', 'insert.block:start', 10),
    ];
    expect(tabsOf(entries)).toEqual(['home', 'insert', 'view']);
  });

  it('always offers Home, so the ribbon has a selected tab before anything loads', () => {
    expect(tabsOf([])).toEqual(['home']);
  });
});

describe('groupsOf', () => {
  it('collects the items of one tab into their groups', () => {
    const entries: RibbonEntry[] = [
      item('home', 'files.group', 'file.open', 10),
      item('home', 'files.group', 'file.save', 20),
      item('home', 'blocks.groupProgram', 'insert.block:start', 20),
      item('view', 'view.groupPanels', 'view.toggleSidePanel', 10),
    ];
    const groups = groupsOf(entries, 'home');
    expect(groups.map((g) => g.key)).toEqual(['files.group', 'blocks.groupProgram']);
    expect(groups[0].items.map((i) => i.command)).toEqual(['file.open', 'file.save']);
  });

  it('sorts the items of a group by order, then by registration', () => {
    const late = item('tools', 'g', 'c.late', 5);
    const entries: RibbonEntry[] = [
      item('tools', 'g', 'c.first', 5),
      item('tools', 'g', 'c.last', 30),
      late,
    ];
    expect(groupsOf(entries, 'tools')[0].items.map((i) => i.command)).toEqual([
      'c.first',
      'c.late',
      'c.last',
    ]);
  });

  it('orders the groups by the smallest order they carry, then by first appearance', () => {
    const entries: RibbonEntry[] = [
      item('home', 'second', 'a', 20),
      item('home', 'first', 'b', 10),
      item('home', 'third', 'c', 20),
    ];
    expect(groupsOf(entries, 'home').map((g) => g.key)).toEqual(['first', 'second', 'third']);
  });

  it('places a custom group among the item groups by its own order', () => {
    const entries: RibbonEntry[] = [
      item('tools', 'later', 'a', 50),
      custom('tools', 'scripts.groupScripts', 10),
    ];
    const groups = groupsOf(entries, 'tools');
    expect(groups.map((g) => g.key)).toEqual(['scripts.groupScripts', 'later']);
    expect(groups[0].customs).toHaveLength(1);
    expect(groups[0].items).toEqual([]);
  });

  it('lets a custom group join an item group with the same key', () => {
    const entries: RibbonEntry[] = [
      item('tools', 'same', 'a', 10),
      custom('tools', 'same', 20),
    ];
    const groups = groupsOf(entries, 'tools');
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.command)).toEqual(['a']);
    expect(groups[0].customs).toHaveLength(1);
  });

  it('ignores the other tabs', () => {
    const entries: RibbonEntry[] = [item('view', 'g', 'a', 10)];
    expect(groupsOf(entries, 'home')).toEqual([]);
  });
});
