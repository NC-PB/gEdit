// The channel status item: the words of the tooltip and the label at the first paint
// (rendered with `svelte/server`, so no cursor event and no `$effect` has run yet).

import { writable } from 'svelte/store';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelParams, ChannelSet } from '$lib/core/channels/types';

const A = { id: '1', name: 'Turret A', index: 0 };
const B = { id: '2', name: 'Turret B', index: 1 };
const params = { layout: 'single-file', list: [{ id: '1', name: 'Turret A' }, { id: '2', name: 'Turret B' }], syncMarks: [] } as unknown as ChannelParams;

const state = {
  set: {
    layout: 'single-file',
    self: null,
    members: [{ kind: 'section', channel: A, docId: 'd1', ranges: [{ startLine: 5, endLine: 20 }] }],
    missing: [B],
    outside: [{ startLine: 1, endLine: 4 }],
    marks: [],
    problems: [{ path: 'list[1]', message: { key: 'channels.problems.channelNotFound', params: { channel: 'Turret B' } } }],
    truncated: false,
  } as unknown as ChannelSet,
};

vi.mock('$lib/monaco/editorService', () => ({ editor: { cursor: () => ({ line: 10, column: 1 }), onDidChangeCursor: () => () => {} } }));
vi.mock('$lib/app/registry/commands', () => ({ commands: { run: () => {} } }));
vi.mock('$lib/stores/documents', () => ({ docs: { active: writable({ id: 'd1' }) } }));
vi.mock('$lib/stores/channels', () => ({
  channels: {
    revision: writable(0),
    forDoc: () => state.set,
    params: () => params,
    unassigned: () => false,
    channelAt: (_id: string, line: number) => (line >= 5 && line <= 20 ? A : null),
  },
}));

const ChannelStatus = (await import('./ChannelStatus.svelte')).default;

describe('ChannelStatus', () => {
  const html = render(ChannelStatus, { props: {} }).body;

  it('names the channel of the cursor at the first paint, not "Outside the channels" (CODE-8)', () => {
    expect(html).toContain('data-channel-id="1"');
    expect(html).toContain('Turret A');
  });

  it('says "not found" for a channel without a section, not "could not be checked" (CODE-8)', () => {
    const title = /title="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(title).toContain('Turret B: not found');
    expect(title).not.toContain('could not be checked');
  });

  it('says a resolution that ran out of time instead of hiding the item (F4)', () => {
    const shown = state.set;
    state.set = { layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], problems: [{ path: '', message: { key: 'channels.problems.tooSlow' } }], truncated: true } as unknown as ChannelSet;
    try {
      const slow = render(ChannelStatus, { props: {} }).body;
      expect(slow).toContain('data-slow="1"');
      expect(slow).toContain('Channels: too slow to read');
      expect(/title="([^"]*)"/.exec(slow)?.[1]).toContain('took too long to read for channels');
    } finally {
      state.set = shown;
    }
  });
});
