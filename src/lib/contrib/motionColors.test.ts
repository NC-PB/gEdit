// The motion-colours contribution (Phase 3 plan AD-34, §6.7; P3.7): one command that switches
// the setting `assist.motionColors`, one View-tab button, no key, and the wiring of the
// decoration service to the real stores. The service itself is `monaco/motionColors.test.ts`.

import { get, writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contribution } from '$lib/app/types';

const state = vi.hoisted(() => ({
  values: undefined as unknown as { set(v: unknown): void; subscribe: unknown },
  saved: [] as unknown[],
  shown: [] as string[],
  deps: undefined as undefined | Record<string, unknown>,
  stop: undefined as unknown as () => void,
  start: undefined as unknown as () => () => void,
  profiles: new Set<string>(['fanuc-gcode']),
}));

vi.mock('$lib/stores/settings', async () => {
  const { writable: w } = await import('svelte/store');
  const values = w({ 'assist.motionColors': true });
  state.values = values as never;
  return {
    settings: {
      values: { subscribe: values.subscribe },
      get: (key: string) => (get(values) as Record<string, unknown>)[key],
      save: async (patch: Record<string, unknown>) => {
        state.saved.push(patch);
        values.update((v) => ({ ...v, ...patch }));
      },
    },
  };
});
vi.mock('$lib/app/status', () => ({ status: { show: (text: string) => state.shown.push(text) } }));
vi.mock('$lib/app/modalService', () => ({ modal: { statesAfter: () => null, changed: writable(0) } }));
vi.mock('$lib/app/theme', () => ({ effectiveTheme: writable('dark') }));
vi.mock('$lib/monaco/editorService', () => ({ editor: { fake: true } }));
vi.mock('$lib/stores/documents', () => ({
  docs: { get: (id: string) => (id === 'd1' ? { profileId: 'fanuc-gcode', path: '/x/o1.nc' } : id === 'd2' ? { profileId: 'gone', path: null } : undefined), list: writable([]), getActiveId: () => 'd1' },
}));
vi.mock('$lib/stores/machines', () => ({
  machines: { revision: writable(0), effective: () => ({ cp: { fake: 'cp' }, codes: { fake: 'db' } }) },
}));
vi.mock('$lib/stores/profiles', () => ({ profiles: { revision: writable(0), get: (id: string) => (state.profiles.has(id) ? {} : undefined) } }));
vi.mock('$lib/monaco/motionColors', () => ({
  createMotionColors: (deps: Record<string, unknown>) => {
    state.deps = deps;
    state.stop = vi.fn();
    state.start = vi.fn(() => state.stop);
    return { start: state.start, flush: () => {} };
  },
}));

const { default: contribution } = await import('./motionColors');
const declared: Contribution = contribution;

beforeEach(() => {
  state.saved.length = 0;
  state.shown.length = 0;
  state.values.set({ 'assist.motionColors': true });
});

describe('the motion-colours contribution', () => {
  it('declares the toggle, in the View tab group "Lines", with no key', () => {
    expect(declared.id).toBe('motionColors');
    expect(declared.commands?.map((c) => c.id)).toEqual(['view.toggleMotionColors']);
    const command = declared.commands?.[0];
    expect(command?.title).toBe('motionColors.toggle');
    expect(command?.category).toBe('motionColors.category');
    expect(command?.keys).toBeUndefined();
    expect(declared.ribbon).toEqual([{ tab: 'view', group: 'motionColors.group', command: 'view.toggleMotionColors', order: 50 }]);
    expect(declared.keybindingRemovals).toBeUndefined();
  });

  it('switches the setting and says which way', async () => {
    const run = declared.commands?.[0].run as () => Promise<void>;
    await run();
    expect(state.saved).toEqual([{ 'assist.motionColors': false }]);
    expect(state.shown).toEqual(['Motion colors off.']);
    await run();
    expect(state.saved[1]).toEqual({ 'assist.motionColors': true });
    expect(state.shown[1]).toBe('Motion colors on.');
  });

  it('starts the decoration service with the real stores and stops it with its disposer', () => {
    const dispose = contribution.activate();
    expect(state.start).toHaveBeenCalledTimes(1);
    const deps = state.deps as Record<string, never> & {
      enabled: { subscribe: (cb: (v: boolean) => void) => () => void };
      effective(id: string): unknown;
      isNc(id: string): boolean;
    };
    const seen: boolean[] = [];
    const off = deps.enabled.subscribe((v) => seen.push(v));
    state.values.set({ 'assist.motionColors': false });
    off();
    expect(seen).toEqual([true, false]);
    expect(deps.effective('d1')).toEqual({ cp: { fake: 'cp' }, db: { fake: 'db' } });
    expect(deps.effective('d2'), 'a profile that was removed').toBeNull();
    expect(deps.effective('nobody')).toBeNull();
    expect(deps.isNc('d1')).toBe(true);
    dispose();
    expect(state.stop).toHaveBeenCalledTimes(1);
  });
});
