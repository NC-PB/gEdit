// The crash-recovery warning light (B1 A2: `status-item` with `data-item="recovery"`).
// Rendered with `svelte/server`, so there is no DOM: what is pinned is what a scenario
// reads. The item is absent while snapshots are written, present while they are not, and
// names the documents in its tooltip.

import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import RecoveryStatus from './RecoveryStatus.svelte';
import { setSnapshotTrouble } from '$lib/app/recovery';

afterEach(() => setSnapshotTrouble([]));

const item = (): string => render(RecoveryStatus).body;

describe('RecoveryStatus', () => {
  it('is not there while all snapshots are written', () => {
    expect(item()).not.toContain('data-item="recovery"');
  });

  it('shows while a snapshot cannot be written and names the documents', () => {
    setSnapshotTrouble(['a.nc', 'b.nc']);
    const html = item();
    expect(html).toContain('data-testid="status-item"');
    expect(html).toContain('data-item="recovery"');
    expect(html).toContain('Crash recovery is not saving');
    expect(html).toContain('a.nc, b.nc');
  });

  it('cuts a long list of names', () => {
    setSnapshotTrouble(['1.nc', '2.nc', '3.nc', '4.nc']);
    const html = item();
    expect(html).toContain('1.nc, 2.nc, 3.nc …');
    expect(html).not.toContain('4.nc');
  });

  it('goes when the trouble is over', () => {
    setSnapshotTrouble(['a.nc']);
    setSnapshotTrouble([]);
    expect(item()).not.toContain('data-item="recovery"');
  });
});
