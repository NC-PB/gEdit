// The inspector contribution (Phase 3 plan P3.2b, AD-27, §6.7): what it declares, where the panel
// sits, how the toggle moves between the inspector and the panel it replaces, and when
// `inspector.editValue` is available. The service behind it is `app/inspectorService.test.ts`.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { panels, resetPanelsForTest } from '$lib/app/registry/panels';
import { layout, defaultLayout } from '$lib/stores/layout';
import { hasKey } from '$lib/i18n';
import type { CommandContext, CommandDef, RibbonItemDef } from '$lib/app/types';

const service = vi.hoisted(() => ({ editAtCursor: vi.fn(async () => 'applied' as const) }));
vi.mock('$lib/app/inspectorService', () => ({ inspector: service }));

const { default: contribution, toggleInspector, INSPECTOR_PANEL_ID } = await import('./inspector');
const programMap = (await import('./programMap')).default;

const commands = contribution.commands as CommandDef[];
const command = (id: string): CommandDef => commands.find((c) => c.id === id)!;
const context = (over: Partial<CommandContext> = {}): CommandContext => ({
  activeDocId: 'd1',
  profileId: 'fanuc-gcode',
  hasSelection: false,
  editorFocused: true,
  compareOpen: false,
  modalOpen: false,
  scriptRunning: false,
  ...over,
});

beforeEach(() => {
  resetPanelsForTest();
  layout.restore(defaultLayout());
  service.editAtCursor.mockClear();
  for (const def of [...programMap.panels, ...contribution.panels]) panels.add(def);
});

describe('the inspector contribution', () => {
  it('declares the two commands the prelude pinned, with their keys, titles and category', () => {
    expect(commands.map((c) => [c.id, c.keys, c.title, c.category])).toEqual([
      ['view.toggleInspector', 'Mod+Alt+A', 'inspector.toggle', 'inspector.category'],
      ['inspector.editValue', undefined, 'inspector.editValue', 'inspector.category'],
    ]);
    for (const c of commands) {
      expect(hasKey(c.title), c.title).toBe(true);
      expect(hasKey(c.category!), c.category).toBe(true);
    }
    expect(command('view.toggleInspector').global).toBe(true);
  });

  it('puts the toggle on the View tab, in the Panels group, after Side Panel and before Bottom Panel', () => {
    const items = contribution.ribbon as RibbonItemDef[];
    expect(items).toEqual([{ tab: 'view', group: 'view.groupPanels', command: 'view.toggleInspector', order: 15 }]);
    expect(hasKey(items[0].group)).toBe(true);
  });

  it('registers the panel in the left region, behind the program map, so it is hidden by default', () => {
    const [panel] = contribution.panels;
    expect([panel.id, panel.region, panel.title]).toEqual(['inspector', 'left', 'inspector.title']);
    expect(hasKey(panel.title)).toBe(true);
    const left = get(panels.panels).filter((p) => p.region === 'left').map((p) => p.id);
    expect(left).toEqual(['programMap', 'inspector']);
    // PanelHost shows `layout.left.active` or the first panel: nothing selects the inspector at start.
    expect(get(layout.state).left.active).toBeNull();
  });

  it('shows the inspector on the first toggle and the program map again on the second', () => {
    toggleInspector();
    expect(get(layout.state).left).toMatchObject({ visible: true, active: INSPECTOR_PANEL_ID });
    toggleInspector();
    expect(get(layout.state).left).toMatchObject({ visible: true, active: 'programMap' });
    toggleInspector();
    expect(get(layout.state).left.active).toBe(INSPECTOR_PANEL_ID);
  });

  it('opens a hidden side panel on the inspector, and hides the region when no other panel is there', () => {
    layout.hide('left');
    command('view.toggleInspector').run(context());
    expect(get(layout.state).left).toMatchObject({ visible: true, active: INSPECTOR_PANEL_ID });

    resetPanelsForTest();
    panels.add(contribution.panels[0]);
    toggleInspector();
    expect(get(layout.state).left.visible).toBe(false);
  });

  it('edits the value at the cursor only with a document open, and hands over to the service', async () => {
    const edit = command('inspector.editValue');
    expect(edit.enabled?.(context({ activeDocId: null }))).toBe(false);
    expect(edit.enabled?.(context())).toBe(true);
    await edit.run(context());
    expect(service.editAtCursor).toHaveBeenCalledTimes(1);
  });
});
