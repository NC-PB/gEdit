// The layout store (plan §7.2, AD-6), with the panel-registry lookup injected.

import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { createLayoutStore, defaultLayout, SIZE_LIMITS } from './layout';
import type { PanelRegion } from '$lib/app/types';

const REGIONS: Record<string, PanelRegion> = {
  programMap: 'left',
  output: 'bottom',
  results: 'bottom',
  compare: 'overlay',
  externalChange: 'banner',
};

function store() {
  return createLayoutStore({ regionOf: (id) => REGIONS[id] });
}

describe('defaults', () => {
  it('opens with the side panel visible and the bottom panel closed', () => {
    expect(get(store().state)).toEqual(defaultLayout());
    expect(defaultLayout().left.visible).toBe(true);
    expect(defaultLayout().bottom.visible).toBe(false);
  });

  it('hands out a fresh object, so a caller cannot edit the defaults', () => {
    const a = defaultLayout();
    a.left.width = 999;
    expect(a.left.width).toBe(999);
    expect(defaultLayout().left.width).toBe(SIZE_LIMITS.left.default);
  });
});

describe('show', () => {
  it('reveals the region a panel lives in and makes it active', () => {
    const layout = store();
    layout.show('output');
    expect(get(layout.state).bottom).toEqual({ visible: true, height: SIZE_LIMITS.bottom.default, active: 'output' });
    layout.show('results');
    expect(get(layout.state).bottom.active).toBe('results');
  });

  it('routes an overlay panel to the overlay slot', () => {
    const layout = store();
    layout.show('compare');
    expect(get(layout.state).overlay).toBe('compare');
    expect(get(layout.state).left.visible).toBe(true);
  });

  it('ignores a banner panel, which is always shown', () => {
    const layout = store();
    const before = get(layout.state);
    layout.show('externalChange');
    expect(get(layout.state)).toEqual(before);
  });

  it('warns about an unknown panel instead of throwing', () => {
    const layout = store();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    layout.show('nope');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('hide and toggle', () => {
  it('hides a region but keeps its active panel and size', () => {
    const layout = store();
    layout.show('output');
    layout.setSize('bottom', 320);
    layout.hide('bottom');
    expect(get(layout.state).bottom).toEqual({ visible: false, height: 320, active: 'output' });
  });

  it('flips visibility both ways', () => {
    const layout = store();
    layout.toggle('left');
    expect(get(layout.state).left.visible).toBe(false);
    layout.toggle('left');
    expect(get(layout.state).left.visible).toBe(true);
  });
});

describe('setSize', () => {
  it('clamps to the region limits and rounds', () => {
    const layout = store();
    layout.setSize('left', 10);
    expect(get(layout.state).left.width).toBe(SIZE_LIMITS.left.min);
    layout.setSize('left', 5000);
    expect(get(layout.state).left.width).toBe(SIZE_LIMITS.left.max);
    layout.setSize('left', 260.6);
    expect(get(layout.state).left.width).toBe(261);
  });

  it('falls back to the minimum for a size that is not a number', () => {
    const layout = store();
    layout.setSize('bottom', Number.NaN);
    expect(get(layout.state).bottom.height).toBe(SIZE_LIMITS.bottom.min);
  });
});

describe('overlay', () => {
  it('opens and closes without touching the other regions', () => {
    const layout = store();
    layout.show('output');
    layout.openOverlay('compare');
    expect(get(layout.state).overlay).toBe('compare');
    expect(get(layout.state).bottom.visible).toBe(true);
    layout.closeOverlay();
    expect(get(layout.state).overlay).toBeNull();
  });
});

describe('restore', () => {
  it('merges a partial state and clamps the sizes', () => {
    const layout = store();
    layout.restore({ left: { visible: false, width: 5000, active: 'programMap' } });
    expect(get(layout.state).left).toEqual({
      visible: false,
      width: SIZE_LIMITS.left.max,
      active: 'programMap',
    });
    // Untouched regions keep their value.
    expect(get(layout.state).bottom).toEqual(defaultLayout().bottom);
  });

  it('keeps the current overlay when the persisted state has none', () => {
    const layout = store();
    layout.openOverlay('compare');
    layout.restore({ bottom: { visible: true, height: 150, active: 'output' } });
    expect(get(layout.state).overlay).toBe('compare');
    layout.restore({ overlay: null });
    expect(get(layout.state).overlay).toBeNull();
  });
});
