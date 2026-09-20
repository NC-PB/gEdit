// The contribution loader (plan AD-3): everything a contribution declares is registered,
// `activate()` runs last, a failing contribution is logged and rolled back without taking
// the others down, and the returned disposer undoes everything.
//
// `registerContributions` takes the list, so this test never evaluates the real
// `contrib/*.ts` modules (several of them reach for Tauri at module level from M1 on).

import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';
import { registerContributions } from './contributions';
import { commands, resetCommandsForTest } from './registry/commands';
import { keybindingRemovals, resetKeybindingRemovalsForTest } from './registry/keybindings';
import { panels, resetPanelsForTest } from './registry/panels';
import { resetRibbonForTest, ribbon } from './registry/ribbon';
import { resetStatusItemsForTest, statusItems } from './registry/statusItems';
import type { Contribution } from '$lib/app/types';

const component = (() => {}) as unknown as Component;

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetCommandsForTest();
  resetRibbonForTest();
  resetPanelsForTest();
  resetStatusItemsForTest();
  resetKeybindingRemovalsForTest();
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
});

const full: Contribution = {
  id: 'files',
  commands: [{ id: 'file.save', title: 't.save', run: () => {} }],
  ribbon: [{ tab: 'home', group: 'g.file', command: 'file.save', order: 0 }],
  ribbonGroups: [{ tab: 'home', group: 'g.custom', order: 1, component }],
  panels: [{ id: 'output', region: 'bottom', title: 't.output', component, order: 0 }],
  statusItems: [{ id: 'file', side: 'left', order: 0, component }],
  keybindingRemovals: [{ keys: 'F2', command: 'editor.action.rename' }],
};

describe('registerContributions', () => {
  it('registers every section and calls activate', async () => {
    const order: string[] = [];
    const dispose = await registerContributions([
      { ...full, activate: () => void order.push('activate') },
    ]);
    expect(order).toEqual(['activate']);
    expect(commands.has('file.save')).toBe(true);
    expect(get(ribbon.entries)).toHaveLength(2);
    expect(get(panels.panels).map((p) => p.id)).toEqual(['output']);
    expect(get(statusItems.items).map((s) => s.id)).toEqual(['file']);
    expect(keybindingRemovals.list()).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();

    dispose();
    dispose();
    expect(commands.list()).toEqual([]);
    expect(get(ribbon.entries)).toEqual([]);
    expect(get(panels.panels)).toEqual([]);
    expect(get(statusItems.items)).toEqual([]);
    expect(keybindingRemovals.list()).toEqual([]);
  });

  it('runs an async activate and keeps its disposer', async () => {
    const stop = vi.fn();
    const dispose = await registerContributions([
      { id: 'late', activate: async () => stop },
    ]);
    dispose();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('loads contributions in the given order', async () => {
    const seen: string[] = [];
    await registerContributions([
      { id: 'a', activate: () => void seen.push('a') },
      { id: 'b', activate: () => void seen.push('b') },
    ]);
    expect(seen).toEqual(['a', 'b']);
  });

  it('logs and skips a contribution whose activate throws, and rolls its registrations back', async () => {
    await registerContributions([
      {
        ...full,
        id: 'broken',
        activate: () => {
          throw new Error('boom');
        },
      },
      { id: 'healthy', commands: [{ id: 'view.left', title: 't.left', run: () => {} }] },
    ]);
    expect(String(errors.mock.calls[0][0])).toContain('broken');
    expect(commands.has('file.save')).toBe(false);
    expect(get(ribbon.entries)).toEqual([]);
    expect(get(panels.panels)).toEqual([]);
    expect(commands.has('view.left')).toBe(true);
  });

  it('logs and skips a contribution that claims an id another one already took', async () => {
    await registerContributions([
      { id: 'first', commands: [{ id: 'file.save', title: 't.save', run: () => {} }] },
      { id: 'second', commands: [{ id: 'file.save', title: 't.save2', run: () => {} }] },
    ]);
    expect(String(errors.mock.calls[0][0])).toContain('second');
    expect(commands.get('file.save')?.title).toBe('t.save');
  });

  it('logs a module whose default export is not a contribution', async () => {
    await registerContributions([undefined as unknown as Contribution, { id: '' } as Contribution]);
    expect(errors).toHaveBeenCalledTimes(2);
  });
});
