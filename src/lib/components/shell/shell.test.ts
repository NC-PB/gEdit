// The shell's markup contract (plan §7.9). Renaming one of these test ids breaks the
// runtime scenarios in `tests/runtime/`, so they are pinned here too.
//
// Rendered with `svelte/server`, which needs no DOM and runs no `onMount` or `$effect`:
// it covers the structure, the test ids and what the registries put where. The live
// behaviour (startup, splitters, panel switching) is covered by the M1 runtime scenarios.

import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands, resetCommandsForTest } from '$lib/app/registry/commands';
import { panels, resetPanelsForTest } from '$lib/app/registry/panels';
import { ribbon, resetRibbonForTest } from '$lib/app/registry/ribbon';
import { resetStatusItemsForTest, statusItems } from '$lib/app/registry/statusItems';
import { layout } from '$lib/stores/layout';
import ProgramMapPanel from '$lib/components/panels/ProgramMapPanel.svelte';
import ScriptOutputPanel from '$lib/components/panels/ScriptOutputPanel.svelte';
import ScriptStatus from '$lib/components/panels/ScriptStatus.svelte';
import FileStatus from '$lib/components/status/FileStatus.svelte';
import AppShell from './AppShell.svelte';
import Ribbon from './Ribbon.svelte';
import StatusBar from './StatusBar.svelte';

function reset(): void {
  resetCommandsForTest();
  resetRibbonForTest();
  resetPanelsForTest();
  resetStatusItemsForTest();
  layout.restore({ left: { visible: true, width: 260, active: null }, bottom: { visible: false, height: 200, active: null }, overlay: null });
}

/** A small stand-in for the contributions the real app loads. */
function contribute(): void {
  commands.register([
    { id: 'file.open', title: 'common.open', keys: 'Mod+O', global: true, run: () => {} },
    { id: 'file.save', title: 'common.save', enabled: () => false, run: () => {} },
  ]);
  ribbon.add([
    { tab: 'home', group: 'shell.panels', command: 'file.open', order: 10 },
    { tab: 'home', group: 'shell.panels', command: 'file.save', order: 20 },
    { tab: 'view', group: 'view.groupPanels', command: 'file.open', order: 10 },
  ]);
  panels.add({ id: 'programMap', region: 'left', title: 'programMap.title', component: ProgramMapPanel, order: 10 });
  panels.add({ id: 'output', region: 'bottom', title: 'scripts.outputTitle', component: ScriptOutputPanel, order: 10 });
  statusItems.add({ id: 'script', side: 'right', order: 50, component: ScriptStatus });
}

beforeEach(reset);
afterEach(reset);

describe('AppShell', () => {
  it('carries the app-shell seam and starts not ready', () => {
    const html = render(AppShell).body;
    expect(html).toContain('data-testid="app-shell"');
    expect(html).toContain('data-ready="0"');
  });

  it('renders the ribbon, the tab bar, the editor and the status bar', () => {
    const html = render(AppShell).body;
    for (const id of ['ribbon', 'tab-bar', 'editor-host', 'status-bar']) {
      expect(html, id).toContain(`data-testid="${id}"`);
    }
  });

  it('shows a region only once a panel is registered for it', () => {
    expect(render(AppShell).body).not.toContain('data-testid="panel"');
    contribute();
    const html = render(AppShell).body;
    expect(html).toContain('data-region="left"');
    expect(html).toContain('data-panel="programMap"');
    // The bottom region is closed until something shows it.
    expect(html).not.toContain('data-region="bottom"');
  });

  it('opens the bottom region when a panel there is shown', () => {
    contribute();
    layout.show('output');
    const html = render(AppShell).body;
    expect(html).toContain('data-region="bottom"');
    expect(html).toContain('data-panel="output"');
    expect(html).toContain('data-testid="output-panel"');
  });

  it('hides the editor behind the overlay panel', () => {
    contribute();
    panels.add({ id: 'compare', region: 'overlay', title: 'common.open', component: ScriptOutputPanel, order: 10 });
    layout.openOverlay('compare');
    const html = render(AppShell).body;
    expect(html).toContain('data-region="overlay"');
    expect(html).not.toContain('data-testid="editor-host"');
    layout.closeOverlay();
  });
});

describe('Ribbon', () => {
  it('renders one tab per used tab and selects Home', () => {
    contribute();
    const html = render(Ribbon).body;
    expect(html.match(/data-testid="ribbon-tab"/g)).toHaveLength(2);
    expect(html).toContain('data-tab="home"');
    expect(html).toContain('data-tab="view"');
    expect(html).not.toContain('data-tab="nc"');
    expect(/data-tab="home"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-tab="home"/.test(html)).toBe(true);
  });

  it('renders a cmd-button per item of the selected tab, with its command id', () => {
    contribute();
    const html = render(Ribbon).body;
    expect(html.match(/data-testid="cmd-button"/g)).toHaveLength(2);
    expect(html).toContain('data-command="file.open"');
    expect(html).toContain('data-command="file.save"');
  });

  it('disables a command whose enablement says no', () => {
    contribute();
    const html = render(Ribbon).body;
    const save = html.slice(html.indexOf('data-command="file.save"'));
    expect(save.slice(0, save.indexOf('</button>'))).toContain('disabled');
  });

  it('puts the shortcut into the tooltip', () => {
    contribute();
    const html = render(Ribbon).body;
    expect(html).toMatch(/title="Open \((⌘O|Ctrl\+O)\)"/);
  });
});

describe('StatusBar', () => {
  it('always shows the message slot', () => {
    const html = render(StatusBar).body;
    expect(html).toContain('data-testid="status-bar"');
    expect(html).toContain('data-item="message"');
    // Nothing is open yet, so there is no message element inside the slot.
    expect(html).not.toContain('data-testid="status-message"');
  });

  it('renders the registered items', () => {
    contribute();
    expect(render(StatusBar).body).toContain('data-item="script"');
  });

  // I2: the file name is `contrib/files.ts`'s registered item, not shell chrome. The bar
  // used to hard-code a second one, which put two `data-item="file"` elements in the DOM
  // and made `h.q('status-item', { item: 'file' })` ambiguous.
  it('leaves the file item to the registry', () => {
    expect(render(StatusBar).body).not.toContain('data-item="file"');
    statusItems.add({ id: 'file', side: 'left', order: 10, component: FileStatus });
    const html = render(StatusBar).body;
    expect(html.match(/data-item="file"/g)).toHaveLength(1);
  });
});
