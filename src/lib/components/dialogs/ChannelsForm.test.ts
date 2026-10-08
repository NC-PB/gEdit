// The Channels step's markup contract (WP12.3, plan §7.15, AD-32): the plain controls first, the
// patterns only behind "Advanced", the presets offered but never applied, the problems of a
// broken block listed with their JSON paths. The edits themselves are pure functions of
// `core/machines/channelFields.ts` and are tested there; rendered here with `svelte/server`
// (no DOM), like the other dialogs. Typing and clicking are the H12 runtime scenarios.

import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { profiles } from '$lib/stores/profiles';
import type { ChannelParams } from '$lib/core/channels/types';
import ChannelsForm from './ChannelsForm.svelte';

const decl = (id: string) => profiles.profile(id).machineParams!.channels!;
const preset = (profile: string, id: string): ChannelParams => structuredClone(decl(profile).presets.find((p) => p.id === id)!.value);

function markup(value: ChannelParams | undefined, over: Record<string, unknown> = {}): string {
  return render(ChannelsForm, {
    props: { value, onChange: () => {}, waitLetters: decl('fanuc-lathe').waitLetters, presets: decl('fanuc-lathe').presets, ...over },
  }).body;
}

describe('ChannelsForm: no channels yet', () => {
  const html = markup(undefined);

  it('offers the layout choice and the presets, and nothing else', () => {
    expect(html).toContain('data-testid="channels-form"');
    expect(html).toContain('data-field="layout"');
    expect(html).toContain('data-testid="channels-none"');
    expect(html).not.toContain('data-testid="channel-row"');
    expect(html).not.toContain('data-testid="channels-advanced"');
    expect(html).not.toContain('data-field="stopsAndEndsWait"');
  });

  it('lists the presets with the verify marker, and copies none of them', () => {
    expect(html).toContain('data-testid="channels-preset"');
    for (const p of decl('fanuc-lathe').presets) expect(html).toContain(p.id);
    expect(html).toContain('(verify)');
    expect(html).not.toContain('data-testid="channels-preset-applied"');
    expect(html).not.toContain('data-testid="rule-card"');
  });

  it('leaves the preset box out for a profile without presets', () => {
    expect(markup(undefined, { presets: [] })).not.toContain('data-testid="channels-presets"');
  });
});

describe('ChannelsForm: the Fanuc three-path preset', () => {
  const value = preset('fanuc-lathe', 'fanuc-3path-digits');
  const html = markup(value);

  it('shows the paths, the code field with its preview, the P-word dropdown and the tick', () => {
    expect((html.match(/data-testid="channel-row"/g) ?? []).length).toBe(3);
    expect(html).toContain('data-field="codes"');
    expect(html).toContain('M900-M999');
    expect(html).toContain('data-testid="codes-preview"');
    expect(html).toContain('data-state="ok"');
    expect(html).toContain('Matches M900 … M999 (100 codes)');
    expect(html).toContain('data-field="partners"');
    expect(html).toContain('P12 = paths 1 and 2');
    expect(html).toContain('data-field="stopsAndEndsWait"');
    expect(html).toContain('Stops and ends count as waits');
    expect(html).toContain('data-testid="channels-advanced"');
  });

  it('keeps Advanced closed and the patterns out of the plain part', () => {
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain('data-field="fileName"'); // inside the closed disclosure
    expect(html.indexOf('data-testid="channels-advanced"')).toBeLessThan(html.indexOf('data-field="fileName"'));
    expect(html.indexOf('data-field="codes"')).toBeLessThan(html.indexOf('data-testid="channels-advanced"'));
  });

  it('shows no problem for a valid block', () => {
    expect(html).not.toContain('data-testid="channels-problems"');
  });

  it('links the regex help only when the page can open it', () => {
    expect(html).not.toContain('data-testid="channels-regex-help"');
    expect(markup(value, { onOpenRegexHelp: () => {} })).toContain('data-testid="channels-regex-help"');
  });
});

describe('ChannelsForm: Advanced opens by itself when the settings need it', () => {
  it('a rule found by pattern opens it and says so in the rule', () => {
    const value = preset('sinumerik', 'sinumerik-2channel');
    const html = markup(value, { waitLetters: decl('sinumerik').waitLetters, presets: decl('sinumerik').presets });
    expect(html).toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain('data-testid="rule-pattern-note"');
    expect(html).toContain('data-testid="rule-advanced"');
  });

  it('a single-file block without a section start opens it', () => {
    const value: ChannelParams = { ...preset('okuma-osp', 'okuma-2turret'), sectionStart: '' };
    expect(markup(value)).toMatch(/<details[^>]*\bopen\b/);
  });

  it('the Okuma preset shows turrets in its own word and the section-start helper', () => {
    const html = markup(preset('okuma-osp', 'okuma-2turret'), { waitLetters: ['M', 'P'], presets: decl('okuma-osp').presets });
    expect(html).toContain('Add a turret');
    expect(html).toContain('data-testid="section-from-names"');
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });
});

describe('ChannelsForm: a broken block', () => {
  it('lists the problems in plain words with their JSON paths and a wait-code error that quotes the item', () => {
    const value = preset('fanuc-lathe', 'fanuc-2path');
    (value.syncMarks[0].match as { codes: string }).codes = 'M9O0';
    const html = markup(value);
    expect(html).toContain('data-testid="channels-problems"');
    expect(html).toContain('data-path="channels.syncMarks[0].match.codes"');
    expect(html).toContain('“M9O0”: not a number.');
    expect(html).toContain('data-state="error"');
  });

  it('says a multi-file block nothing addresses must be assigned by hand', () => {
    const value: ChannelParams = { layout: 'multi-file', list: [{ id: '1', name: 'Path 1' }, { id: '2', name: 'Path 2' }], syncMarks: [] };
    expect(markup(value)).toContain('data-testid="channels-assign-only"');
    expect(markup(preset('fanuc-lathe', 'fanuc-2path'))).not.toContain('data-testid="channels-assign-only"');
  });
});

describe('ChannelsForm: disabled while the machines file cannot be written', () => {
  it('disables the buttons', () => {
    const html = markup(preset('fanuc-lathe', 'fanuc-2path'), { disabled: true });
    expect(html).toMatch(/data-testid="channel-add"[^>]*disabled|disabled[^>]*data-testid="channel-add"/);
    expect(html).toMatch(/data-testid="rule-add"[^>]*disabled|disabled[^>]*data-testid="rule-add"/);
  });
});

describe('ChannelsForm: blocks and lists the form must survive', () => {
  it('renders a stored block without syncMarks (CODE-2)', () => {
    const multi = { layout: 'multi-file', list: [{ id: '1', name: 'Path 1' }, { id: '2', name: 'Path 2' }], fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.nc$' } as unknown as ChannelParams;
    expect(() => markup(multi)).not.toThrow();
    const single = { layout: 'single-file', list: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }], sectionStart: 'G1[34]' } as unknown as ChannelParams;
    const html = markup(single);
    expect(html).toContain('data-testid="rule-add"');
    expect(html).not.toContain('data-testid="rule-card"');
  });

  it('renders two identical wait-code errors (CODE-9)', () => {
    const value = preset('fanuc-lathe', 'fanuc-2path');
    (value.syncMarks[0].match as { codes: string }).codes = 'abc abc';
    const html = markup(value);
    expect((html.match(/not a number/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('never keys a list of user text by the text (CODE-9: Svelte stops on a repeated key)', () => {
    for (const file of ['ChannelsForm.svelte', 'MachinesPage.svelte']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      const keyed = source.match(/\{#each [^}]*\((?:problem|error)[^)]*\)\}/g) ?? [];
      expect(keyed, file).toEqual([]);
    }
  });
});
