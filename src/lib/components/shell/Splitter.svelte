<!--
  A panel splitter (plan AD-6). Owner: WP1.5.

  Pointer events on purpose: HTML5 drag and drop swallows the native file drop on Windows.
  It is also a real tab stop - `role="separator"` with the arrow keys - so a panel can be
  resized without a mouse.
-->
<script lang="ts">
  interface Props {
    orientation: 'vertical' | 'horizontal';
    label: string;
    /** Current size of the panel this splitter resizes, in px. */
    value: number;
    min: number;
    max: number;
    /** Dragging right / down grows the panel; set for a panel that sits after the splitter. */
    invert?: boolean;
    onresize: (px: number) => void;
  }

  /** One arrow-key press. */
  const STEP = 16;

  let { orientation, label, value, min, max, invert = false, onresize }: Props = $props();

  let drag: { start: number; from: number } | null = null;

  function apply(px: number): void {
    onresize(Math.min(max, Math.max(min, Math.round(px))));
  }

  function onPointerDown(e: PointerEvent & { currentTarget: HTMLElement }): void {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { start: orientation === 'vertical' ? e.clientX : e.clientY, from: value };
    // A synthetic event (the runtime harness) has no live pointer to capture.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // nothing to capture
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    const delta = (orientation === 'vertical' ? e.clientX : e.clientY) - drag.start;
    apply(drag.from + (invert ? -delta : delta));
  }

  function onPointerUp(e: PointerEvent & { currentTarget: HTMLElement }): void {
    if (!drag) return;
    drag = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // nothing to release
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    const grow = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const shrink = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    let next: number | undefined;
    if (e.key === grow) next = value + (invert ? -STEP : STEP);
    else if (e.key === shrink) next = value - (invert ? -STEP : STEP);
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === undefined) return;
    e.preventDefault();
    apply(next);
  }
</script>

<!--
  The ARIA window-splitter pattern is exactly this: `role="separator"` that is focusable
  and carries `aria-valuenow`/`min`/`max`. svelte-check reads `separator` from aria-query,
  where it is a structure role, and therefore reports a focusable one as non-interactive.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="splitter {orientation}"
  role="separator"
  tabindex="0"
  aria-orientation={orientation}
  aria-label={label}
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onkeydown={onKeyDown}
></div>

<style>
  .splitter {
    flex: 0 0 auto;
    background-color: var(--border-color);
    touch-action: none;
  }
  .splitter.vertical {
    width: 4px;
    cursor: col-resize;
  }
  .splitter.horizontal {
    height: 4px;
    cursor: row-resize;
  }
  .splitter:hover,
  .splitter:focus-visible {
    background-color: var(--accent);
  }
  .splitter:focus-visible {
    outline: 1px solid var(--accent-hover);
    outline-offset: 1px;
  }
</style>
