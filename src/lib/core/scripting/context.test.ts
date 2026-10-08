// `buildContext` (plan §5 WP5.1 "Tests: … Also `buildContext`", §7.5): the JSON a script
// reads back with `gedit_nc.load_context()`, pinned without an editor.
//
// Two things the tests below are really about. The **document block describes the file**
// and not stdin, which is what stops a script from writing CRLF into a CRLF document and
// doubling every line ending. And `input.precedingLines` — carry-over (2) from M4 — is
// filled under exactly one condition and omitted, never truncated, when it does not fit.

import { describe, expect, it } from 'vitest';
import type { ChannelSet } from '$lib/core/channels/types';
import { noMachine } from '$lib/core/machines/effective';
import {
  buildContext,
  MAX_PRECEDING_CHARS,
  MAX_PRECEDING_LINES,
  primingLines,
} from './context';
import type { DocMeta } from '$lib/app/types';
import type { CodeEntry } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';
import type { BuildContextInput, ScriptContextInput } from './types';

const PROFILE = { id: 'fanuc-gcode', name: 'Fanuc', shortName: 'Fanuc' } as unknown as Profile;
const CODES: CodeEntry[] = [{ code: 'G84', label: 'Tapping cycle', group: 'cycle', pitchFeed: true }];

function doc(over: Partial<DocMeta> = {}): DocMeta {
  return {
    id: 'd1',
    path: '/jobs/part42.nc',
    untitledIndex: null,
    title: 'part42.nc',
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'windows-1252', hasBom: false },
    eol: 'crlf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: true,
    metaDirty: false,
    dirty: true,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
    ...over,
  };
}

function input(over: Partial<ScriptContextInput> = {}): ScriptContextInput {
  return { scope: 'selection', startLine: 120, endLine: 180, ...over };
}

function build(over: Partial<BuildContextInput> = {}) {
  return buildContext({
    doc: doc(),
    profile: PROFILE,
    codes: CODES,
    input: input(),
    cursor: { line: 130, column: 5 },
    params: { percent: 90 },
    machine: noMachine(PROFILE),
    ...over,
  });
}

describe('buildContext', () => {
  it('is the shape scripting.md documents', () => {
    expect(build()).toEqual({
      contract: 2,
      document: {
        path: '/jobs/part42.nc',
        name: 'part42.nc',
        profile: 'fanuc-gcode',
        encoding: 'windows-1252',
        hasBom: false,
        lineEnding: 'crlf',
        modified: true,
      },
      input: { scope: 'selection', startLine: 120, endLine: 180 },
      cursor: { line: 130, column: 5 },
      params: { percent: 90 },
      profile: PROFILE,
      codes: CODES,
      // M6, AD-31: no machine means the profile's own defaults, with every source
      // `profile` — which is exactly what a Phase 1 document ran with.
      machine: {
        id: null,
        name: null,
        choice: 'none',
        params: { numberInput: null, units: 'mm', diameter: null, variants: {}, modalInitial: {} },
        source: {
          numberInput: 'profile',
          units: 'profile',
          diameter: 'profile',
          variants: {},
          modalInitial: {},
        },
      },
    });
  });

  it('describes the file, not stdin: the encoding and the line ending are the document’s', () => {
    const context = build({ doc: doc({ encoding: { encoding: 'utf-16le', hasBom: true }, eol: 'lf' }) });
    expect(context.document).toMatchObject({ encoding: 'utf-16le', hasBom: true, lineEnding: 'lf' });
  });

  it('calls an untitled document by its title and gives it no path', () => {
    const context = build({ doc: doc({ path: null, untitledIndex: 2, title: 'Untitled-2' }) });
    expect(context.document).toMatchObject({ path: null, name: 'Untitled-2' });
  });

  it('reports metadata changes as modified, not only text changes', () => {
    const context = build({ doc: doc({ textDirty: false, metaDirty: true, dirty: true }) });
    expect(context.document.modified).toBe(true);
  });

  it('pins a `none` scope to 0..0', () => {
    const context = build({ input: input({ scope: 'none', startLine: 40, endLine: 90 }) });
    expect(context.input).toEqual({ scope: 'none', startLine: 0, endLine: 0 });
  });

  it('normalises a range that arrived reversed or fractional', () => {
    const context = build({ input: input({ startLine: 12.7, endLine: 4 }) });
    expect(context.input).toMatchObject({ startLine: 12, endLine: 12 });
  });

  it('never sends a line or column below 1', () => {
    const context = build({ cursor: { line: 0, column: Number.NaN } });
    expect(context.cursor).toEqual({ line: 1, column: 1 });
  });

  it('copies params and codes, so the run cannot be changed underneath', () => {
    const params = { percent: 90 };
    const codes = [...CODES];
    const context = build({ params, codes });
    params.percent = 200;
    codes.length = 0;
    expect(context.params).toEqual({ percent: 90 });
    expect(context.codes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Carry-over (2): the modal state above a selection
// ---------------------------------------------------------------------------

describe('precedingLines', () => {
  const above = ['N10 G95', 'N20 G84 R2. Z-10. F1.5'];

  it('is carried for a selection that starts below the top of the program', () => {
    const context = build({ input: input({ startLine: 3, endLine: 9, precedingLines: above }) });
    expect(context.input.precedingLines).toEqual(above);
  });

  it('is left out for a whole-document run, which already sees everything', () => {
    const context = build({
      input: input({ scope: 'document', startLine: 1, endLine: 9, precedingLines: above }),
    });
    expect(context.input.precedingLines).toBeUndefined();
  });

  it('is left out for a selection that starts at line 1', () => {
    const context = build({ input: input({ startLine: 1, endLine: 9, precedingLines: [] }) });
    expect(context.input).toEqual({ scope: 'selection', startLine: 1, endLine: 9 });
  });

  it('is left out for a `none` scope', () => {
    const context = build({
      input: input({ scope: 'none', startLine: 3, endLine: 9, precedingLines: above }),
    });
    expect(context.input.precedingLines).toBeUndefined();
  });

  it('is dropped, not truncated, past the line cap', () => {
    const many = Array.from({ length: MAX_PRECEDING_LINES + 1 }, () => 'N10');
    expect(primingLines({ scope: 'selection', startLine: many.length + 1 }, many)).toBeUndefined();
  });

  it('is dropped, not truncated, past the character cap', () => {
    const huge = ['x'.repeat(MAX_PRECEDING_CHARS + 1)];
    expect(primingLines({ scope: 'selection', startLine: 2 }, huge)).toBeUndefined();
  });

  it('still fits right at the caps', () => {
    const lines = ['x'.repeat(MAX_PRECEDING_CHARS - 1)];
    expect(primingLines({ scope: 'selection', startLine: 2 }, lines)).toEqual(lines);
  });

  it('copies the lines it takes', () => {
    const source = [...above];
    const taken = primingLines({ scope: 'selection', startLine: 3 }, source);
    source.length = 0;
    expect(taken).toEqual(above);
  });

  it('absent by default keeps the M4 behaviour', () => {
    expect(build({ input: input({ startLine: 3, endLine: 9 }) }).input.precedingLines).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// M12 (AD-32): the channels member
// ---------------------------------------------------------------------------

const REF = (id: string, index: number) => ({ id, name: `Channel ${id}`, index });

function set(over: Partial<ChannelSet>): ChannelSet {
  return { layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], problems: [], truncated: false, ...over };
}

describe('buildContext: channels', () => {
  it('has no member without a set, for layout none, and the M11 shape is untouched', () => {
    expect('channels' in build()).toBe(false);
    expect('channels' in build({ channels: set({}) })).toBe(false);
    expect(Object.keys(build({ channels: set({}) })).sort()).toEqual(Object.keys(build()).sort());
    expect(build({ channels: set({}) }).contract).toBe(2);
  });

  it('single-file: every range of every channel in declared order, outside, and the marks', () => {
    const ctx = build({
      channels: set({
        layout: 'single-file',
        members: [
          { kind: 'section', channel: REF('2', 1), docId: 'd1', ranges: [{ startLine: 8, endLine: 9 }] },
          {
            kind: 'section',
            channel: REF('1', 0),
            docId: 'd1',
            ranges: [{ startLine: 3, endLine: 4 }, { startLine: 10, endLine: 12 }],
          },
        ],
        outside: [{ startLine: 1, endLine: 2 }, { startLine: 5, endLine: 7 }],
        marks: [
          { ruleId: 'w', mark: 'M901', line: 4, channel: '1', partners: ['1', '2'], blocking: true },
          { ruleId: 's', mark: 'M31', line: 6, channel: '', partners: [], blocking: false },
        ],
      }),
    });
    expect(ctx.channels).toEqual({
      layout: 'single-file',
      self: null,
      list: [
        { id: '1', name: 'Channel 1', ranges: [{ startLine: 3, endLine: 4 }, { startLine: 10, endLine: 12 }] },
        { id: '2', name: 'Channel 2', ranges: [{ startLine: 8, endLine: 9 }] },
      ],
      outside: [{ startLine: 1, endLine: 2 }, { startLine: 5, endLine: 7 }],
      marks: [
        { id: 'M901', line: 4, channel: '1', partners: ['1', '2'], blocking: true },
        { id: 'M31', line: 6, channel: '', partners: [], blocking: false },
      ],
    });
  });

  it('lists a declared channel that was not found, empty, and never drops it', () => {
    const ctx = build({
      channels: set({
        layout: 'single-file',
        members: [{ kind: 'section', channel: REF('1', 0), docId: 'd1', ranges: [{ startLine: 1, endLine: 2 }] }],
        missing: [REF('2', 1)],
      }),
    });
    expect(ctx.channels?.list).toEqual([
      { id: '1', name: 'Channel 1', ranges: [{ startLine: 1, endLine: 2 }] },
      { id: '2', name: 'Channel 2', ranges: [] },
    ]);
  });

  it('multi-file: this channel, the files, their paths and whether they are open; no ranges, no outside', () => {
    const self = REF('1', 0);
    const ctx = build({
      channels: set({
        layout: 'multi-file',
        self,
        members: [
          { kind: 'file', channel: self, name: 'twin_CH1.nc', path: '/jobs/twin_CH1.nc', exists: true, docId: 'd1', by: 'fileName' },
          { kind: 'file', channel: REF('2', 1), name: 'twin_CH2.nc', path: '/jobs/twin_CH2.nc', exists: true, docId: null, by: 'fileName' },
        ],
        missing: [REF('3', 2)],
        marks: [{ ruleId: 'w', mark: 'M901', line: 7, channel: '1', partners: ['2'], blocking: true }],
      }),
    });
    expect(ctx.channels).toEqual({
      layout: 'multi-file',
      self: '1',
      list: [
        { id: '1', name: 'Channel 1', file: 'twin_CH1.nc', path: '/jobs/twin_CH1.nc', open: true },
        { id: '2', name: 'Channel 2', file: 'twin_CH2.nc', path: '/jobs/twin_CH2.nc', open: false },
        { id: '3', name: 'Channel 3', open: false },
      ],
      marks: [{ id: 'M901', line: 7, channel: '1', partners: ['2'], blocking: true }],
    });
  });

  it('copies: changing the set afterwards does not change the context', () => {
    const marks = [{ ruleId: 'w', mark: 'M901', line: 4, channel: '1', partners: ['2'], blocking: true }];
    const ctx = build({ channels: set({ layout: 'single-file', members: [{ kind: 'section', channel: REF('1', 0), docId: 'd1', ranges: [{ startLine: 1, endLine: 4 }] }], marks }) });
    marks[0].partners.push('3');
    expect(ctx.channels?.marks[0].partners).toEqual(['2']);
  });
});
