// The modal contribution (Phase 3 plan P3.1, §7 #211): it starts the modal service and
// declares nothing a user sees.

import { describe, expect, it, vi } from 'vitest';
import type { Contribution } from '$lib/app/types';

const stop = vi.fn();
const start = vi.fn(() => stop);
vi.mock('$lib/app/modalService', () => ({ modal: { start } }));
const { default: contribution } = await import('./modal');

describe('the modal contribution', () => {
  it('declares no command, panel, ribbon item, status item or key', () => {
    const declared: Contribution = contribution;
    expect(declared.id).toBe('modal');
    expect(declared.commands).toBeUndefined();
    expect(declared.panels).toBeUndefined();
    expect(declared.ribbon).toBeUndefined();
    expect(declared.statusItems).toBeUndefined();
    expect(declared.keybindingRemovals).toBeUndefined();
  });

  it('starts the modal service and stops it with its disposer', () => {
    const dispose = contribution.activate();
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    dispose();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
