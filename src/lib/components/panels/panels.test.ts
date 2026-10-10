// The panel markup contract (plan §7.9): the M0 program-map test ids survive the move into
// the panel regions. Rendered with `svelte/server`, so no DOM, no Monaco and no `onMount`.
//
// M5 note: this file used to cover the script panel and the v1 script status too. The
// `ScriptOutputPanel` cases moved to `./ScriptOutputPanel.test.ts` when WP5.2 rewrote that
// component against `stores/scripts.ts`, and the `ScriptStatus` case went with the v1 UI
// when I5 deleted it — `data-item="script"` is now covered by
// `../status/ScriptStatusItem.test.ts`. Plan §8.1: tests sit next to their modules, so
// ownership follows the module.

import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ProgramMapPanel, { scrollToActiveRow } from './ProgramMapPanel.svelte';

describe('ProgramMapPanel', () => {
  it('keeps the program-map seam and says why it is empty', () => {
    const html = render(ProgramMapPanel).body;
    expect(html).toContain('data-testid="program-map"');
    expect(html).not.toContain('data-testid="program-map-item"');
    expect(html).toContain('Open a program to see its structure.');
  });
});

// B1 A4: the map follows the cursor.
describe('ProgramMapPanel scrollToActiveRow', () => {
  function rootWith(row: { kind: string; line: string; channelId?: string } | null) {
    const scrollIntoView = vi.fn();
    const root = {
      querySelector: (selector: string) => {
        expect(selector).toContain('[data-active="1"]');
        return row === null ? null : { dataset: row as unknown as DOMStringMap, scrollIntoView };
      },
    };
    return { root, scrollIntoView };
  }

  it('scrolls the active row into view, the least it takes', () => {
    const { root, scrollIntoView } = rootWith({ kind: 'tool', line: '120' });
    const key = scrollToActiveRow(root, null);
    expect(key).toBe('tool:120:');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('leaves the map alone while the cursor stays on the same row', () => {
    const { root, scrollIntoView } = rootWith({ kind: 'tool', line: '120' });
    expect(scrollToActiveRow(root, 'tool:120:')).toBe('tool:120:');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('follows the cursor to the next row, and tells two channel rows on one line apart', () => {
    const first = rootWith({ kind: 'channel', line: '5', channelId: 'S1' });
    const key = scrollToActiveRow(first.root, null);
    const second = rootWith({ kind: 'channel', line: '5', channelId: 'S3' });
    expect(scrollToActiveRow(second.root, key)).toBe('channel:5:S3');
    expect(second.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an active row, or without a root, or where scrollIntoView does not exist', () => {
    expect(scrollToActiveRow(rootWith(null).root, 'tool:1:')).toBeNull();
    expect(scrollToActiveRow(undefined, null)).toBeNull();
    const bare: Parameters<typeof scrollToActiveRow>[0] = {
      querySelector: () => ({ dataset: { kind: 'label', line: '3' } as unknown as DOMStringMap }),
    };
    expect(scrollToActiveRow(bare, null)).toBe('label:3:');
  });
});
