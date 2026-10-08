// The tester's markup contract (rendered with `svelte/server`, no DOM): closed until opened,
// "Take the active document" only when the page can supply one, the file-name box only for
// one-file-per-channel settings. The report itself is `core/channels/tester.test.ts`.

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { profiles } from '$lib/stores/profiles';
import type { ChannelParams } from '$lib/core/channels/types';
import ChannelsTester from './ChannelsTester.svelte';

const decl = profiles.profile('fanuc-lathe').machineParams!.channels!;
const okuma = profiles.profile('okuma-osp').machineParams!.channels!;
const preset = (id: string): ChannelParams => structuredClone(decl.presets.find((p) => p.id === id)!.value);
const markup = (params: ChannelParams, over: Record<string, unknown> = {}): string =>
  render(ChannelsTester, { props: { params, cp: profiles.compiled('fanuc-lathe'), ...over } }).body;

describe('ChannelsTester', () => {
  it('is a closed disclosure with a paste box and no report', () => {
    const html = markup(preset('fanuc-2path'));
    expect(html).toContain('data-testid="channels-tester"');
    expect(html).toContain('data-testid="channels-tester-text"');
    expect(html).not.toContain('data-testid="channels-tester-report"');
  });

  it('offers the active document only when the page can supply it', () => {
    expect(markup(preset('fanuc-2path'))).not.toContain('channels-tester-take');
    expect(markup(preset('fanuc-2path'), { takeDocument: () => null })).toContain('channels-tester-take');
  });

  it('asks for a file name only when each channel has a program of its own', () => {
    expect(markup(preset('fanuc-2path'))).toContain('channels-tester-name');
    expect(markup(structuredClone(okuma.presets.find((p) => p.id === 'okuma-2turret')!.value))).not.toContain('channels-tester-name');
  });
});
