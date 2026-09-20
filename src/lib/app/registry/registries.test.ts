// The ribbon, panel, status-item and keybinding-removal registries (plan §7.1):
// ordering, disposers and duplicate ids.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import { keybindingRemovals, resetKeybindingRemovalsForTest } from './keybindings';
import { panels, resetPanelsForTest } from './panels';
import { resetRibbonForTest, ribbon } from './ribbon';
import { resetStatusItemsForTest, statusItems } from './statusItems';
import type { PanelDef, RibbonGroupDef, RibbonItemDef, StatusItemDef } from '$lib/app/types';

/** Components are never rendered here; only identity and ordering matter. */
const component = (() => {}) as unknown as Component;

function item(over: Partial<RibbonItemDef> & { command: string }): RibbonItemDef {
  return { tab: 'home', group: 'g.file', order: 0, ...over };
}

function panel(over: Partial<PanelDef> & { id: string }): PanelDef {
  return { region: 'left', title: `t.${over.id}`, component, order: 0, ...over };
}

function statusItem(over: Partial<StatusItemDef> & { id: string }): StatusItemDef {
  return { side: 'left', order: 0, component, ...over };
}

beforeEach(() => {
  resetRibbonForTest();
  resetPanelsForTest();
  resetStatusItemsForTest();
  resetKeybindingRemovalsForTest();
});

describe('ribbon', () => {
  it('merges items and custom groups, sorted by tab', () => {
    const group: RibbonGroupDef = { tab: 'nc', group: 'g.custom', order: 0, component };
    ribbon.add([item({ command: 'view.left', tab: 'view' }), item({ command: 'file.save' })]);
    ribbon.addGroup(group);
    expect(get(ribbon.entries).map((e) => ('command' in e ? e.command : e.group))).toEqual([
      'file.save',
      'g.custom',
      'view.left',
    ]);
  });

  it('keeps contribution order inside a tab', () => {
    ribbon.add([item({ command: 'b', order: 9 }), item({ command: 'a', order: 1 })]);
    expect(get(ribbon.entries).map((e) => ('command' in e ? e.command : ''))).toEqual(['b', 'a']);
  });

  it('disposes items and groups independently', () => {
    const disposeItems = ribbon.add([item({ command: 'file.save' })]);
    const disposeGroup = ribbon.addGroup({ tab: 'home', group: 'g.custom', order: 0, component });
    expect(get(ribbon.entries)).toHaveLength(2);
    disposeItems();
    disposeItems();
    expect(get(ribbon.entries)).toHaveLength(1);
    disposeGroup();
    expect(get(ribbon.entries)).toHaveLength(0);
  });
});

describe('panels', () => {
  it('sorts by region, then order, then registration', () => {
    panels.add(panel({ id: 'results', region: 'bottom', order: 20 }));
    panels.add(panel({ id: 'banner', region: 'banner', order: 0 }));
    panels.add(panel({ id: 'output', region: 'bottom', order: 10 }));
    panels.add(panel({ id: 'map', region: 'left', order: 0 }));
    panels.add(panel({ id: 'compare', region: 'overlay', order: 0 }));
    expect(get(panels.panels).map((p) => p.id)).toEqual([
      'map',
      'output',
      'results',
      'compare',
      'banner',
    ]);
  });

  it('throws on a duplicate id and frees it again on dispose', () => {
    const dispose = panels.add(panel({ id: 'map' }));
    expect(() => panels.add(panel({ id: 'map' }))).toThrow(/already registered/);
    dispose();
    dispose();
    expect(get(panels.panels)).toHaveLength(0);
    expect(() => panels.add(panel({ id: 'map' }))).not.toThrow();
  });
});

describe('statusItems', () => {
  it('sorts left before right, then by order', () => {
    statusItems.add(statusItem({ id: 'cursor', side: 'right', order: 20 }));
    statusItems.add(statusItem({ id: 'encoding', side: 'right', order: 10 }));
    statusItems.add(statusItem({ id: 'message', side: 'left', order: 10 }));
    statusItems.add(statusItem({ id: 'file', side: 'left', order: 0 }));
    expect(get(statusItems.items).map((s) => s.id)).toEqual([
      'file',
      'message',
      'encoding',
      'cursor',
    ]);
  });

  it('throws on a duplicate id', () => {
    const dispose = statusItems.add(statusItem({ id: 'cursor' }));
    expect(() => statusItems.add(statusItem({ id: 'cursor' }))).toThrow(/already registered/);
    dispose();
    expect(get(statusItems.items)).toHaveLength(0);
  });
});

describe('keybindingRemovals', () => {
  it('collects removals and gives them back in order', () => {
    const dispose = keybindingRemovals.add([
      { keys: 'F2', command: 'editor.action.rename' },
      { keys: 'Mod+F2', command: 'editor.action.changeAll' },
    ]);
    expect(keybindingRemovals.list()).toEqual([
      { keys: 'F2', command: 'editor.action.rename' },
      { keys: 'Mod+F2', command: 'editor.action.changeAll' },
    ]);
    expect(get(keybindingRemovals.removals)).toHaveLength(2);
    dispose();
    dispose();
    expect(keybindingRemovals.list()).toEqual([]);
  });
});
