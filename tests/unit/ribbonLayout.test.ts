// Where the shipped contributions put their ribbon buttons (B1 A9): the seven tabs
// File · Edit · Insert · NC · Tools · Scripts · View.
//
// The modules reach for Tauri when they load and cannot be imported here, so this reads the
// `{ tab, group, command }` literals out of the contribution sources (the same approach as
// `commandPins.test.ts`). It holds the owner's layout of 2026-10-10: a command that moves to
// another tab, or a retired `home` tab coming back, fails here and not only in a hosted run.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TAB_ORDER } from '$lib/components/shell/ribbonModel';
import { hasKey } from '$lib/i18n';

const CONTRIB = join(fileURLToPath(new URL('../..', import.meta.url)), 'src', 'lib', 'contrib');

interface Placed {
  tab: string;
  group: string;
  /** A command id, or `component:<name>` for a custom group. */
  what: string;
  file: string;
}

const placed: Placed[] = [];
for (const file of readdirSync(CONTRIB).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
  const source = readFileSync(join(CONTRIB, file), 'utf8');
  for (const m of source.matchAll(/\{\s*tab:\s*'(\w+)',\s*group:\s*'([\w.]+)',\s*command:\s*'([\w.:-]+)'/g)) {
    placed.push({ tab: m[1], group: m[2], what: m[3], file });
  }
  for (const m of source.matchAll(/\{\s*tab:\s*'(\w+)',\s*group:\s*'([\w.]+)',\s*order:\s*\d+,\s*component:\s*(\w+)/g)) {
    placed.push({ tab: m[1], group: m[2], what: `component:${m[3]}`, file });
  }
  // `ribbonItems(SPECS, 'tab', 'group', base)` in editing.ts.
  for (const m of source.matchAll(/ribbonItems\((\w+),\s*'(\w+)',\s*'([\w.]+)'/g)) {
    placed.push({ tab: m[2], group: m[3], what: `specs:${m[1]}`, file });
  }
}

const groupsOf = (tab: string): string[] => [...new Set(placed.filter((p) => p.tab === tab).map((p) => p.group))];
const inGroup = (group: string): string[] => placed.filter((p) => p.group === group).map((p) => p.what);

describe('the ribbon layout', () => {
  it('only uses the seven tabs, and no `home`', () => {
    const used = new Set(placed.map((p) => p.tab));
    expect(used.has('home')).toBe(false);
    for (const tab of used) expect(TAB_ORDER as readonly string[], tab).toContain(tab);
    expect(placed.length).toBeGreaterThan(40);
  });

  it('File: New, Open, Save, Save As, Save All, Close, Reload, and Recent', () => {
    expect(groupsOf('file')).toEqual(['files.groupFile', 'recent.groupRecent']);
    expect(inGroup('files.groupFile')).toEqual([
      'file.new',
      'file.open',
      'file.save',
      'file.saveAs',
      'file.saveAll',
      'file.close',
      'file.reload',
    ]);
    expect(inGroup('recent.groupRecent')).toEqual(['component:RecentMenu']);
  });

  it('Edit: the edit commands, Find and Replace, Go to Line and the typing options', () => {
    expect(groupsOf('edit').sort()).toEqual(
      ['editing.groupEdit', 'navigation.groupGoto', 'search.group', 'typing.group'].sort(),
    );
    expect(inGroup('navigation.groupGoto')).toEqual(['nav.goto']);
    expect(inGroup('typing.group')).toEqual(['edit.toggleForceUppercase']);
    expect(inGroup('search.group')).toEqual(['search.findAll', 'search.replace', 'search.wholeAddressInFind']);
  });

  it('Insert: the template groups, Edit Cycle and Manage Templates', () => {
    expect(groupsOf('insert').sort()).toEqual(['cycleForm.group', 'templateManager.group', 'templates.groupTemplates'].sort());
    expect(inGroup('templateManager.group')).toEqual(['templates.fromSelection', 'templates.manage']);
  });

  it('Program start is offered on the Insert tab only: no ribbon entry names it anywhere else', () => {
    expect(placed.filter((p) => p.what.includes('program-start'))).toEqual([]);
    expect(placed.filter((p) => p.group === 'templates.groupProgram')).toEqual([]);
  });

  it('NC: numbering, cleanup, block skip, segments and channels', () => {
    expect(groupsOf('nc').sort()).toEqual(
      ['channels.group', 'ncBlockSkip.group', 'ncCleanup.group', 'ncNumbering.group', 'segments.group'].sort(),
    );
    expect(inGroup('ncNumbering.group')).toEqual(['nc.renumber', 'nc.removeBlockNumbers']);
  });

  it('Tools: Compare and the built-in NC scripts (program checks, scale feed and speed, tool list, extents, address arithmetic)', () => {
    expect(groupsOf('tools')).toContain('compare.group');
    expect(inGroup('compare.group')).toEqual(['compare.with', 'compare.files']);
    expect(placed.filter((p) => p.tab === 'tools' && p.what === 'component:BundledScriptsMenu')).toHaveLength(1);
    expect(groupsOf('tools')).not.toContain('scripts.groupManage');
    expect(groupsOf('tools')).not.toContain('scripts.groupScripts');
  });

  it('Scripts: Run, Rescan, New Script, Edit Script, Add Folder and the user\'s own scripts', () => {
    expect(groupsOf('scripts').sort()).toEqual(['scripts.groupManage', 'scripts.groupOwn', 'scripts.groupScripts'].sort());
    expect(inGroup('scripts.groupScripts')).toEqual(['script.runPicker', 'script.cancel']);
    expect(inGroup('scripts.groupManage')).toEqual(['script.new', 'script.openSource', 'script.rescan', 'script.addFolder']);
    expect(inGroup('scripts.groupOwn')).toEqual(['component:OwnScriptsMenu']);
  });

  it('View: panels, inspector, motion colours, theme, settings and help', () => {
    const view = groupsOf('view');
    for (const group of ['view.groupPanels', 'motionColors.group', 'theme.group', 'settings.group', 'help.group']) {
      expect(view, group).toContain(group);
    }
    expect(inGroup('view.groupPanels')).toEqual(
      expect.arrayContaining(['view.toggleSidePanel', 'view.toggleInspector', 'view.toggleBottomPanel', 'view.showOutput']),
    );
  });

  it('has a caption for every group', () => {
    const missing = [...new Set(placed.map((p) => p.group))].filter((key) => !hasKey(key));
    expect(missing).toEqual([]);
  });
});
