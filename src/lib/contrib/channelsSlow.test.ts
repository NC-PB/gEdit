// M12 perf review PERF-2: a program whose channel resolution ran out of its time is said as
// such by every command that steps through it, never as "This program has no channels".

import { describe, expect, it, vi } from 'vitest';
import type { ChannelSet } from '$lib/core/channels/types';
import { t } from '$lib/i18n';

const shown: { text: string; error: boolean }[] = [];
const slow = {
  layout: 'none',
  self: null,
  members: [],
  missing: [],
  outside: [],
  marks: [],
  problems: [{ path: '', message: { key: 'channels.problems.tooSlow' } }],
  truncated: true,
} as unknown as ChannelSet;
const none = { ...slow, problems: [], truncated: false } as ChannelSet;
let current: ChannelSet = slow;

vi.mock('$lib/stores/channels', () => ({
  channels: { fresh: () => current, forDoc: () => current, params: () => ({ layout: 'single-file', list: [{ id: '1', name: 'A' }], syncMarks: [] }), ruleLabel: () => '' },
  sameMarkId: (a: string, b: string) => a === b,
}));
vi.mock('$lib/app/dialogs', () => ({ dialogs: {} }));
vi.mock('$lib/app/fileOps', () => ({ files: {} }));
vi.mock('$lib/app/modals', () => ({ modals: {} }));
vi.mock('$lib/app/outlineService', () => ({ computeJumpLines: () => ({}) }));
vi.mock('$lib/app/status', () => ({ status: { show: (text: string, o?: { error?: boolean }) => shown.push({ text, error: o?.error === true }) } }));
vi.mock('$lib/monaco/editorService', () => ({ editor: { cursor: () => ({ line: 3 }), getLines: () => [], getLineCount: () => 0 } }));
vi.mock('$lib/stores/documents', () => ({ docs: { getActiveId: () => 'd1', get: () => ({ title: 'x.nc', path: null }) } }));
vi.mock('$lib/stores/machines', () => ({ machines: {} }));
vi.mock('$lib/stores/results', () => ({ results: {} }));

const { default: contribution } = await import('./channels');

async function run(command: string): Promise<{ text: string; error: boolean } | undefined> {
  shown.length = 0;
  const cmd = (contribution.commands ?? []).find((c) => c.id === command);
  await cmd?.run();
  return shown[shown.length - 1];
}

describe('a program too slow to read for channels (PERF-2)', () => {
  it('is said as too slow by Next/Previous Sync Point, Go to Partner and the split', async () => {
    current = slow;
    for (const command of ['channels.nextSyncPoint', 'channels.prevSyncPoint', 'channels.gotoPartner', 'channels.splitToDocuments']) {
      expect(await run(command), command).toEqual({ text: t('channels.problems.tooSlow'), error: true });
    }
  });

  it('a program without channels still says so', async () => {
    current = none;
    expect((await run('channels.nextSyncPoint'))?.text).toBe(t('channels.nav.noChannels'));
    expect((await run('channels.gotoPartner'))?.text).toBe(t('channels.nav.noChannels'));
  });
});
