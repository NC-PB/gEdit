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
import { describe, expect, it } from 'vitest';
import ProgramMapPanel from './ProgramMapPanel.svelte';

describe('ProgramMapPanel', () => {
  it('keeps the program-map seam and says why it is empty', () => {
    const html = render(ProgramMapPanel).body;
    expect(html).toContain('data-testid="program-map"');
    expect(html).not.toContain('data-testid="program-map-item"');
    expect(html).toContain('Open a program to see its structure.');
  });
});
