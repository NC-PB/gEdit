// The layout store (plan §7.2, AD-6). Owner: WP1.5.
//
// Regions: 'left' (program map), 'bottom' (Output, Results) and 'overlay' (compare, which
// takes the editor's place). 'banner' panels are always shown above the editor and have no
// layout state of their own.
//
// A plain `svelte/store` module (AD-2): no runes, so it can be imported anywhere and unit
// tested in node. `show(panelId)` has to know which region a panel belongs to, which is a
// panel-registry lookup; it is injected so the store can be tested without registering
// real panels.

import { derived, get, writable } from 'svelte/store';
import { panels } from '$lib/app/registry/panels';
import type { LayoutState, LayoutStore, PanelRegion } from '$lib/app/types';

/** Sizes are in CSS pixels; the splitters clamp to the same range. */
export const SIZE_LIMITS = {
  left: { min: 160, max: 640, default: 260 },
  bottom: { min: 80, max: 640, default: 200 },
} as const;

export const DEFAULT_LAYOUT: LayoutState = {
  left: { visible: true, width: SIZE_LIMITS.left.default, active: null },
  bottom: { visible: false, height: SIZE_LIMITS.bottom.default, active: null },
  overlay: null,
};

export interface LayoutStoreDeps {
  /** The region a panel is registered in, or undefined when there is no such panel. */
  regionOf(panelId: string): PanelRegion | undefined;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** A fresh copy of the defaults; callers may keep the value, so it is never shared. */
export function defaultLayout(): LayoutState {
  return {
    left: { ...DEFAULT_LAYOUT.left },
    bottom: { ...DEFAULT_LAYOUT.bottom },
    overlay: DEFAULT_LAYOUT.overlay,
  };
}

export function createLayoutStore(deps: LayoutStoreDeps): LayoutStore {
  const state = writable<LayoutState>(defaultLayout());

  function setRegion(region: 'left' | 'bottom', patch: Partial<LayoutState['left' | 'bottom']>): void {
    state.update((s) => ({ ...s, [region]: { ...s[region], ...patch } }));
  }

  return {
    state: derived(state, (s) => s),

    show(panelId: string): void {
      const region = deps.regionOf(panelId);
      if (region === 'overlay') {
        state.update((s) => ({ ...s, overlay: panelId }));
        return;
      }
      if (region === 'left' || region === 'bottom') {
        setRegion(region, { visible: true, active: panelId });
        return;
      }
      // 'banner' panels are always visible, and an unknown id is a contribution bug.
      // A warning, not an error: the runtime harness fails the run on a console error.
      if (region === undefined) console.warn(`layout: no panel "${panelId}" is registered`);
    },

    hide(region: 'left' | 'bottom'): void {
      setRegion(region, { visible: false });
    },

    toggle(region: 'left' | 'bottom'): void {
      state.update((s) => ({ ...s, [region]: { ...s[region], visible: !s[region].visible } }));
    },

    setSize(region: 'left' | 'bottom', px: number): void {
      const { min, max } = SIZE_LIMITS[region];
      const size = clamp(px, min, max);
      setRegion(region, region === 'left' ? { width: size } : { height: size });
    },

    openOverlay(panelId: string): void {
      state.update((s) => ({ ...s, overlay: panelId }));
    },

    closeOverlay(): void {
      state.update((s) => ({ ...s, overlay: null }));
    },

    /**
     * Applies a persisted layout (M2 `ui.layout`). Missing fields keep their current
     * value and sizes are clamped, so an old or hand-edited state file cannot produce a
     * panel that covers the editor.
     */
    restore(s: Partial<LayoutState>): void {
      state.update((current) => ({
        left: {
          ...current.left,
          ...s.left,
          width: clamp(s.left?.width ?? current.left.width, SIZE_LIMITS.left.min, SIZE_LIMITS.left.max),
        },
        bottom: {
          ...current.bottom,
          ...s.bottom,
          height: clamp(
            s.bottom?.height ?? current.bottom.height,
            SIZE_LIMITS.bottom.min,
            SIZE_LIMITS.bottom.max,
          ),
        },
        overlay: s.overlay === undefined ? current.overlay : s.overlay,
      }));
    },
  };
}

/** The application-wide layout, backed by the real panel registry. */
export const layout: LayoutStore = createLayoutStore({
  regionOf: (panelId) => get(panels.panels).find((p) => p.id === panelId)?.region,
});
