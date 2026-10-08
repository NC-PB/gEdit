// Sibling names and the document's own channel, pure (plan §7.17, WP12.1 deliver; written by
// P12, extended by WP12.1).

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { documentChannel, fileChannel, siblingNames } from './siblings';
import type { ChannelParams } from './types';

const base = (over: Partial<ChannelParams>): ChannelParams => ({
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Channel 1' },
    { id: '2', name: 'Channel 2' },
    { id: '3', name: 'Channel 3' },
  ],
  syncMarks: [],
  ...over,
});

const names = (r: ReturnType<typeof siblingNames>) => r?.map((s) => [s.channel.id, s.name]) ?? null;

describe('siblingNames', () => {
  it('replaces the channel capture of a shared pattern, ignoring case', () => {
    const p = base({ fileName: '^(?<stem>.+)_CH(?<channel>\\d+)\\.nc$' });
    expect(names(siblingNames('part.v2_ch1.NC', p))).toEqual([
      ['2', 'part.v2_ch2.NC'],
      ['3', 'part.v2_ch3.NC'],
    ]);
  });

  it('reads the channel at the end of the extension', () => {
    const p = base({ fileName: '^(?<stem>.+)\\.[A-Za-z]*-?(?<channel>\\d{1,2})$' });
    expect(names(siblingNames('SHAFT.X-2', p))).toEqual([
      ['1', 'SHAFT.X-1'],
      ['3', 'SHAFT.X-3'],
    ]);
  });

  it('uses per-channel templates for a pair with no shared token', () => {
    const p = base({
      list: [
        { id: 'main', name: 'Main', fileName: '{{stem}}.MPF' },
        { id: 'sub', name: 'Counter spindle', fileName: '{{stem}}_GS.MPF' },
      ],
    });
    expect(names(siblingNames('PART_GS.MPF', p))).toEqual([['main', 'PART.MPF']]);
    expect(names(siblingNames('PART.MPF', p))).toEqual([['sub', 'PART_GS.MPF']]);
  });

  it('prefers fileNameFor over the derived name', () => {
    const p = base({ fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.nc$', fileNameFor: '{{stem}}-K{{channel}}.nc' });
    expect(names(siblingNames('a_CH1.nc', p))?.[0]).toEqual(['2', 'a-K2.nc']);
  });

  it('answers null for a name that is not a channel file, and name null where it cannot derive one', () => {
    const p = base({ fileName: '^(?<stem>.+)_CH(?<channel>\\d+)\\.nc$' });
    expect(siblingNames('notachannel.nc', p)).toBeNull();
    expect(siblingNames('a_CH9.nc', p)).toBeNull();
    const t = base({
      list: [
        { id: '1', name: 'One', fileName: '{{stem}}.A' },
        { id: '2', name: 'Two' },
      ],
    });
    expect(names(siblingNames('x.A', t))).toEqual([['2', null]]);
  });

  it('never answers a name with a separator', () => {
    const p = base({ fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.nc$', fileNameFor: '../{{stem}}{{channel}}.nc' });
    expect(names(siblingNames('a_CH1.nc', p))?.[0]).toEqual(['2', null]);
  });
});

describe('siblingNames, WP12.1', () => {
  it('keeps a stem with dots and the case the name is written in', () => {
    const p = base({ fileName: '^(?<stem>.+)_CH(?<channel>\\d+)\\.nc$' });
    expect(names(siblingNames('Flange.OP10.rev2_CH3.NC', p))).toEqual([
      ['1', 'Flange.OP10.rev2_CH1.NC'],
      ['2', 'Flange.OP10.rev2_CH2.NC'],
    ]);
  });

  it('matches per-channel templates ignoring case', () => {
    const p = base({
      list: [
        { id: 'main', name: 'Main', fileName: '{{stem}}.MPF' },
        { id: 'sub', name: 'Counter spindle', fileName: '{{stem}}_GS.MPF' },
      ],
    });
    expect(fileChannel('part_gs.mpf', p)).toMatchObject({ channel: { id: 'sub' }, stem: 'part' });
  });

  it('derives no name from a capture that holds an alias, because the other spelling is not known', () => {
    const p = base({
      list: [
        { id: '1', name: 'One', aliases: ['A'] },
        { id: '2', name: 'Two', aliases: ['B'] },
      ],
      fileName: '^(?<stem>.+)_(?<channel>[A-Z0-9])\\.nc$',
    });
    expect(names(siblingNames('x_A.nc', p))).toEqual([['2', null]]);
    expect(names(siblingNames('x_1.nc', p))).toEqual([['2', 'x_2.nc']]);
  });

  it('never answers the document’s own name or one name for two channels', () => {
    const p = base({ fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.nc$', fileNameFor: '{{stem}}_CH1.nc' });
    expect(names(siblingNames('a_CH1.nc', p))).toEqual([
      ['2', null],
      ['3', null],
    ]);
  });

  it('is no channel file when two templates explain the name equally well', () => {
    const p = base({
      list: [
        { id: '1', name: 'One', fileName: '{{stem}}.nc' },
        { id: '2', name: 'Two', fileName: '{{stem}}.NC' },
      ],
    });
    expect(siblingNames('a.nc', p)).toBeNull();
  });

  it('leaves out the channel the document really is when that is not the one its name says', () => {
    const p = base({ fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.nc$' });
    expect(names(siblingNames('a_CH1.nc', p, '2'))).toEqual([
      // Channel 1's derived name is this document's own: not a sibling's.
      ['1', null],
      ['3', 'a_CH3.nc'],
    ]);
  });
});

describe('documentChannel', () => {
  const lathe = cpOf('fanuc-lathe');
  const p = base({ fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.nc$', marker: '^\\(PATH (?<channel>\\d+)\\)' });

  it('takes the file name when the header says nothing', () => {
    expect(documentChannel('a_CH2.nc', ['%', 'O1'], lathe, p)).toMatchObject({ channel: { id: '2' }, by: 'fileName', stem: 'a', problems: [] });
  });

  it('lets the header win, and reports a disagreement', () => {
    const r = documentChannel('a_CH2.nc', ['(PATH 3)'], lathe, p);
    expect(r).toMatchObject({ channel: { id: '3' }, by: 'marker' });
    expect(r.problems).toEqual([
      { path: 'line:1', message: { key: 'channels.problems.markerDisagrees', params: { line: 1, marker: 'Channel 3', fileName: 'Channel 2' } } },
    ]);
    expect(documentChannel('a_CH3.nc', ['(PATH 3)'], lathe, p).problems).toEqual([]);
  });

  it('answers no channel when the header names an undeclared channel or two channels', () => {
    expect(documentChannel('a_CH2.nc', ['(PATH 9)'], lathe, p)).toMatchObject({ channel: null, by: null });
    expect(documentChannel('a_CH2.nc', ['(PATH 1)', '(PATH 2)'], lathe, p)).toMatchObject({ channel: null, by: null });
  });

  it('falls back to the file name when the marker pattern does not compile, and reports it', () => {
    const r = documentChannel('a_CH2.nc', ['(PATH 1)'], lathe, { ...p, marker: '(' });
    expect(r).toMatchObject({ channel: { id: '2' }, by: 'fileName' });
    expect(r.problems[0].message.key).toBe('channels.problems.badPattern');
  });
});
