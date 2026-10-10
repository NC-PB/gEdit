// The Insert tab's template buttons (Phase 3 plan §5 P3.5): one block per template group, the
// `toolbar` templates as `cmd-button`s with `data-command` and `data-review`, the rest in the
// group's list, a favourites block first. Rendered with `svelte/server` and a fake service; the
// live behaviour (a click, a switch of the profile) is for the runtime scenarios.

import { readable } from 'svelte/store';
import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, resetCommandsForTest } from '$lib/app/registry/commands';
import { loadTemplates, templateCommandId, type TemplateDef } from '$lib/core/templates';
import { docs } from '$lib/stores/documents';

const fake = vi.hoisted(() => ({ list: [] as unknown[], stars: [] as string[], dialect: 'demo' as string | null }));

vi.mock('$lib/app/templateService', async (original) => {
  const actual = await original<typeof import('$lib/app/templateService')>();
  return {
    ...actual,
    templates: {
      list: () => fake.list,
      dialectOf: () => fake.dialect,
      favorites: () => fake.stars,
      changed: readable(0),
    },
  };
});

const { default: TemplatesGroup } = await import('./TemplatesGroup.svelte');

const defs = (raw: unknown[]): TemplateDef[] => loadTemplates(raw);

const RAW = [
  { id: 'program-start', label: 'Program start', group: 'Program', toolbar: true, review: 'pending', description: 'Tape mark and safe start.', body: 'x' },
  { id: 'program-end', label: 'Program end', group: 'Program', toolbar: true, body: 'x' },
  { id: 'stop', label: 'Program stop', group: 'Program', body: 'x' },
  { id: 'drill', label: 'Drilling (G81)', group: 'Drilling', body: 'x' },
  { id: 'tool-change', label: 'Tool change', group: 'Tool change', toolbar: true, body: 'x' },
];

function register(ids: string[]): void {
  commands.register(ids.map((id) => ({ id: templateCommandId(id), title: id, run: () => {} })));
}

function markup(): string {
  return render(TemplatesGroup).body;
}

let docId: string;
beforeEach(() => {
  resetCommandsForTest();
  fake.list = defs(RAW);
  fake.stars = [];
  fake.dialect = 'demo';
  docId = docs.add({
    path: null,
    untitledIndex: 1,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
  });
  register(RAW.map((x) => x.id));
});
afterEach(() => {
  docs.remove(docId);
  resetCommandsForTest();
});

describe('TemplatesGroup', () => {
  it('draws one block per template group, named by the group, in order of appearance', () => {
    const html = markup();
    const groups = [...html.matchAll(/data-testid="template-group" data-group="([^"]*)"/g)].map((m) => m[1]);
    expect(groups).toEqual(['Program', 'Drilling', 'Tool change']);
    expect(html).toContain('>Drilling</div>');
  });

  it('draws the toolbar templates as command buttons with their command and review mark', () => {
    const html = markup();
    expect(html).toContain('data-command="insert.template:program-start"');
    expect(html).toMatch(/data-command="insert.template:program-start"[^>]*data-review="pending"/);
    expect(html).toContain('data-command="insert.template:program-end"');
    expect(html).not.toMatch(/data-command="insert.template:program-end"[^>]*data-review/);
    expect(html).toContain('data-command="insert.template:tool-change"');
    // The tooltip says what the template is and that it is not reviewed yet.
    expect(html).toContain('title="Tape mark and safe start. · Not yet reviewed"');
    // Not a toolbar template: no button.
    expect(html).not.toContain('data-command="insert.template:stop"');
    expect(html).not.toContain('data-command="insert.template:drill"');
  });

  it('puts the other templates of a group in its "More templates…" list', () => {
    const html = markup();
    const lists = [...html.matchAll(/data-testid="template-more" data-group="([^"]*)"/g)].map((m) => m[1]);
    expect(lists).toEqual(['Program', 'Drilling']);
    expect(html).toContain('<option value="stop"');
    expect(html).toContain('>Program stop</option>');
    expect(html).toContain('<option value="drill"');
    expect(html).toContain('More Templates…');
  });

  it('shows a Favorites block first, with each starred template as a button, and does not repeat it', () => {
    fake.stars = ['drill', 'program-end'];
    const html = markup();
    const groups = [...html.matchAll(/data-testid="template-group" data-group="([^"]*)"/g)].map((m) => m[1]);
    expect(groups).toEqual(['favorites', 'Program', 'Tool change']);
    expect(html).toContain('>Favorites</div>');
    expect(html.match(/data-command="insert.template:drill"/g)).toHaveLength(1);
    expect(html.match(/data-command="insert.template:program-end"/g)).toHaveLength(1);
  });

  it('disables the button of a command that is not registered, and draws nothing for a program with no templates', () => {
    resetCommandsForTest();
    expect(markup()).toMatch(/data-command="insert.template:program-start"[^>]*disabled/);
    fake.list = [];
    expect(markup()).not.toContain('template-group');
  });
});
