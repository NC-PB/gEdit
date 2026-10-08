// The resolution after an edit (M12 performance fix F2): whatever `patchResolution` answers
// equals a full `resolveDocument` of the edited text, over random edits of random programs,
// and it declines (null) exactly where it cannot know.

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { mergeDirty, patchResolution, type DirtySpan, type LineResolution } from './incremental';
import { resolveDocument } from './marks';
import type { ChannelParams } from './types';

const lathe = cpOf('fanuc-lathe');

const single: ChannelParams = {
  layout: 'single-file',
  list: [
    { id: '1', name: 'Channel 1' },
    { id: '2', name: 'Channel 2' },
  ],
  sectionStart: '^O21(?<channel>\\d\\d)(?![\\d.])',
  sectionEnd: '^M99',
  syncMarks: [
    { id: 'wait', label: 'w', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'none' } } },
    { id: 'm1', label: 'm', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } },
  ],
};
// The channel token is the two digits after O21 (`O2101` = channel "01" = 1 by value).

const multi: ChannelParams = {
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Path 1' },
    { id: '2', name: 'Path 2' },
  ],
  fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.nc$',
  syncMarks: [{ id: 'wait', label: 'w', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'all' } }],
};

/** A small deterministic random source, so a failure can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const BODY = ['G01 X10. Z-2. F0.2', 'G00 X50.', 'M901 P12', 'M902', 'M100', '(M903 IN A COMMENT)', 'T0101', 'N10 M904 P1', 'G01 Z-5.'];
const ALL = [...BODY, 'O2101', 'O2102', 'M99', 'M30', '%'];

function program(next: () => number, size: number): string[] {
  const lines = ['%', 'O0001 (HEAD)'];
  let channel = 1;
  while (lines.length < size) {
    if (next() < 0.03) lines.push(`O210${channel++ % 2 === 1 ? 1 : 2}`);
    else if (next() < 0.01) lines.push('M99');
    else lines.push(BODY[Math.floor(next() * BODY.length)]);
  }
  lines.push('M30', '%');
  return lines;
}

function resolution(name: string, lines: string[], p: ChannelParams) {
  const r = resolveDocument(name, lines, lathe, p);
  return r.layout === 'none'
    ? null
    : { layout: r.layout, self: r.self, sections: r.sections, outside: r.outside, marks: r.marks, boundaries: r.boundaries ?? [], lineCount: lines.length, problems: r.problems, dropped: r.dropped };
}

/** Replaces old lines `start..endOld` with `text`, as one Monaco change; the span it reports. */
function edit(lines: string[], start: number, endOld: number, text: string[]): DirtySpan {
  lines.splice(start - 1, endOld - start + 1, ...text);
  return { startLine: start, endLineOld: endOld, endLineNew: start + text.length - 1 };
}

const pick = (r: LineResolution) => ({ sections: r.sections, outside: r.outside, marks: r.marks });

describe('patchResolution', () => {
  it('equals a full resolution after every edit it accepts, and accepts most edits', () => {
    for (const p of [single, multi]) {
      let accepted = 0;
      let declined = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const next = rng(seed);
        const name = 'part_CH1.nc';
        const lines = p.layout === 'multi-file' ? [...Array(420).fill('G00 X1.'), ...program(next, 300)] : program(next, 300);
        let prev = resolution(name, lines, p);
        if (prev === null) continue;
        for (let k = 0; k < 25 && prev !== null; k++) {
          // In a multi-file document most edits are below the header the marker is read from.
          const floor = p.layout === 'multi-file' && next() < 0.9 ? 401 : 1;
          const start = floor + Math.floor(next() * (lines.length - floor + 1));
          const span = Math.floor(next() * 3);
          const endOld = Math.min(lines.length, start + span);
          // An edit is one or a few lines, sometimes a typed character, sometimes a new section line.
          const count = Math.floor(next() * 4);
          const text = Array.from({ length: Math.max(1, count) }, () => (next() < 0.5 ? `${lines[start - 1] ?? ''}1` : ALL[Math.floor(next() * ALL.length)]));
          // Two edits merged into one span, as the service does between two resolutions.
          let d = edit(lines, start, endOld, text);
          if (next() < 0.3) {
            const at = Math.min(lines.length, d.startLine + Math.floor(next() * 5));
            d = mergeDirty(d, edit(lines, at, at, [lines[at - 1] + ' ', 'G01 X2.']));
          }
          const full = resolution(name, lines, p);
          const patched = patchResolution(prev, d, lines.length, (a, b) => lines.slice(a - 1, b), lathe, p);
          if (patched === null) declined++;
          else {
            accepted++;
            expect(full, `seed ${seed} edit ${k}`).not.toBeNull();
            expect(pick(patched), `seed ${seed} edit ${k}`).toEqual(pick(full as LineResolution));
            expect(patched.boundaries).toEqual((full as LineResolution).boundaries);
          }
          prev = full;
        }
      }
      expect(accepted, p.layout).toBeGreaterThan(declined);
    }
  });

  it('declines an edit that touches a section start, writes one, or makes a line too long', () => {
    const lines = ['%', 'O2101', 'M901 P12', 'G01 X1.', 'O2102', 'M901 P12', 'G01 X2.', 'M30'];
    const prev = resolution('a.nc', lines, single) as NonNullable<ReturnType<typeof resolution>>;
    const read = (copy: string[]) => (a: number, b: number) => copy.slice(a - 1, b);
    const run = (start: number, endOld: number, text: string[]) => {
      const copy = [...lines];
      const d = edit(copy, start, endOld, text);
      return patchResolution(prev, d, copy.length, read(copy), lathe, single);
    };
    expect(run(2, 2, ['O2101 '])).toBeNull(); // a start line edited
    expect(run(4, 4, ['O2102'])).toBeNull(); // a start written
    expect(run(4, 4, ['M99'])).toBeNull(); // an end written
    expect(run(4, 4, ['X'.repeat(1001)])).toBeNull(); // too long to read
    expect(run(4, 4, ['G01 X1.', 'M902 P12'])?.marks.map((m) => [m.mark, m.line, m.channel])).toEqual([
      ['M901', 3, '1'],
      ['M902', 5, '1'],
      ['M901', 7, '2'],
    ]);
  });

  it('holds the edited lines to the budget: past the deadline it declines, for the full reading to say (PERF-4)', () => {
    const lines = ['%', 'O2101', 'M901 P12', 'G01 X1.', 'O2102', 'M901 P12', 'G01 X2.', 'M30'];
    const prev = resolution('a.nc', lines, single) as NonNullable<ReturnType<typeof resolution>>;
    const pasted = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? 'M902 P12' : 'G01 X3.'));
    const copy = [...lines];
    const d = edit(copy, 4, 4, pasted);
    const read = (a: number, b: number) => copy.slice(a - 1, b);
    let t = 0;
    const clock = { deadline: 10, now: () => (t += 1) }; // the deadline passes on the 10th line
    expect(patchResolution(prev, d, copy.length, read, lathe, single, clock)).toBeNull();
    expect(patchResolution(prev, d, copy.length, read, lathe, single, { deadline: 1e9, now: () => 0 })?.marks).toHaveLength(12);
  });

  it('merges two edits into one span of the text before both', () => {
    // Line 10 edited, then a line inserted after it, then line 20 (of the new text) edited.
    expect(mergeDirty(mergeDirty({ startLine: 10, endLineOld: 10, endLineNew: 10 }, { startLine: 10, endLineOld: 10, endLineNew: 11 }), { startLine: 20, endLineOld: 20, endLineNew: 20 })).toEqual({
      startLine: 10,
      endLineOld: 19,
      endLineNew: 20,
    });
  });

  it('patches one keystroke in a 300k-line program with 20,000 waits in a few milliseconds (G7, F2)', () => {
    const lines: string[] = ['%'];
    for (const channel of ['1', '2']) {
      lines.push(`O210${channel}`);
      for (let i = 1; i <= 150_000; i++) lines.push(i % 15 === 0 ? `M${900 + (i % 100)} P12` : `G01 X${i % 80}.25 Z-${i % 40}. F0.2`);
    }
    lines.push('M30', '%');
    const prev = resolution('big.nc', lines, single) as NonNullable<ReturnType<typeof resolution>>;
    expect(prev.marks.length).toBe(20_000);
    const at = 70_000;
    const typed = [...lines];
    typed[at - 1] += '1';
    let out: LineResolution | null = null;
    const ms = fastest(5, () => {
      out = patchResolution(prev, { startLine: at, endLineOld: at, endLineNew: at }, typed.length, (a, b) => typed.slice(a - 1, b), lathe, single);
    });
    expect(out).not.toBeNull();
    // A new line shifts every later wait: the worst case, still far below a frame.
    const inserted = [...lines.slice(0, at), 'G01 X1.', ...lines.slice(at)];
    const msShift = fastest(5, () => {
      out = patchResolution(prev, { startLine: at, endLineOld: at, endLineNew: at + 1 }, inserted.length, (a, b) => inserted.slice(a - 1, b), lathe, single);
    });
    expect((out as unknown as LineResolution).marks.length).toBe(20_000);
    expectWithin(ms, 5, 'patched resolution, one keystroke, 300k lines');
    expectWithin(msShift, 10, 'patched resolution, one inserted line, 300k lines, 10,000 waits shifted');
  });
});
