// The v2 running-script indicator (plan §5 WP5.2, §7.9: `status-item` with
// `data-item="script"`). Rendered with `svelte/server`, so there is no DOM and no
// `$effect` — the one-second tick is browser-only and nothing here depends on it.
//
// What the three cases pin is what a scenario reads: the element is always there, it is
// empty and inert while nothing runs, and while a run is in flight it names the script,
// carries its id and is the Cancel control. `core/scripting/filter.ts` is WP5.1's and
// still the P5 stub, so `scriptLabel` is faked.

import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScriptEntry } from '$lib/platform/commands';

vi.mock('$lib/core/scripting/filter', () => ({
  scriptLabel: (entry: ScriptEntry) => entry.meta?.name || entry.fileName,
  scriptsForProfile: (entries: ScriptEntry[]) => entries,
  groupScripts: (entries: ScriptEntry[]) => [{ group: null, scripts: entries }],
}));

const ScriptStatusItem = (await import('./ScriptStatusItem.svelte')).default;
const { resetScriptsForTest, runningScript, scriptList } = await import('$lib/stores/scripts');

afterEach(resetScriptsForTest);

function entry(id: string, fileName: string): ScriptEntry {
  return {
    id,
    root: 'bundled',
    group: null,
    fileName,
    meta: null,
    headerError: null,
    shadowed: false,
    editable: false,
  };
}

const item = (): string => render(ScriptStatusItem).body;

describe('ScriptStatusItem', () => {
  it('is in the DOM but empty and inert while nothing runs', () => {
    const html = item();
    expect(html).toContain('data-testid="status-item"');
    expect(html).toContain('data-item="script"');
    expect(html).toContain('data-running="0"');
    expect(html).toContain('disabled');
    expect(html).not.toContain('Script:');
  });

  it('names the running script, carries its id and becomes the Cancel control', () => {
    scriptList.set([entry('bundled:scale_feed.py', 'scale_feed.py')]);
    runningScript.set({ runId: 'r1', scriptId: 'bundled:scale_feed.py', docId: 'd1', startedAt: Date.now() });
    const html = item();
    expect(html).toContain('Script: scale_feed.py');
    expect(html).toContain('data-running="1"');
    expect(html).toContain('data-script-id="bundled:scale_feed.py"');
    expect(html).not.toContain('disabled');
  });

  it('falls back to the id when the script has left the list mid-run', () => {
    runningScript.set({ runId: 'r1', scriptId: 'user:gone.py', docId: 'd1', startedAt: Date.now() });
    expect(item()).toContain('Script: user:gone.py');
  });
});
