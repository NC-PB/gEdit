// What the program-map contribution declares, the panel's markup, and the pure half of
// the two Monaco providers it registers (plan §5 WP3.5, §7.9).
//
// The panel's own markup is covered by `components/panels/panels.test.ts` (the §7.9 test
// ids, rendered with `svelte/server`); the rows are covered by the outline goldens
// (`core/profiles/outline.test.ts`) and by the `m3-outline` scenario.

import { describe, expect, it } from 'vitest';
import programMap from './programMap';
import { docIdOf, flatten, rangeOf, type ModelLike } from '$lib/monaco/providers/symbols';
import { hasKey } from '$lib/i18n';
import type { OutlineItem } from '$lib/core/profiles/outline';
import type { Contribution } from '$lib/app/types';

describe('the contribution', () => {
  it('puts the program map in the left region, first', () => {
    expect(programMap.panels).toEqual([
      { id: 'programMap', region: 'left', title: 'programMap.title', component: expect.anything(), order: 10 },
    ]);
    expect(hasKey('programMap.title')).toBe(true);
  });

  it('brings no command and no shortcut of its own', () => {
    // `satisfies Contribution` keeps the literal type, so the optional members are not on
    // it at all; navigation owns every M3 shortcut.
    const declared: Contribution = programMap;
    expect(declared.commands).toBeUndefined();
    expect(declared.keybindingRemovals).toBeUndefined();
  });

  it('has a name for every outline kind', () => {
    for (const key of ['tool', 'program', 'section', 'comment', 'label', 'stop', 'end', 'subprogramCall']) {
      expect(hasKey(`programMap.kinds.${key}`), key).toBe(true);
    }
  });
});

describe('the providers', () => {
  const model: ModelLike = {
    uri: { scheme: 'inmemory', authority: 'doc', path: '/d7' },
    getLineCount: () => 40,
    getLineMaxColumn: (line) => line * 2,
  };

  it('reads the document id out of the model uri', () => {
    expect(docIdOf(model)).toBe('d7');
    // The compare view's own models are not documents, and must not be answered for.
    expect(docIdOf({ ...model, uri: { scheme: 'inmemory', authority: 'model', path: '/1' } })).toBeNull();
    expect(docIdOf({ ...model, uri: { scheme: 'file', authority: 'doc', path: '/d7' } })).toBeNull();
    expect(docIdOf({ ...model, uri: { scheme: 'inmemory', authority: 'doc', path: '/' } })).toBeNull();
  });

  it('flattens the two-level tree in line order', () => {
    const items: OutlineItem[] = [
      { kind: 'program', line: 1, text: 'O1' },
      { kind: 'tool', line: 3, text: 'T1', children: [{ kind: 'comment', line: 5, text: 'C' }] },
    ];
    expect(flatten(items).map((item) => item.line)).toEqual([1, 3, 5]);
  });

  it('clamps a range to the model and ends it at the last column', () => {
    expect(rangeOf({ kind: 'tool', line: 3, endLine: 9, text: 'T1' }, model)).toEqual({
      startLineNumber: 3,
      startColumn: 1,
      endLineNumber: 9,
      endColumn: 18,
    });
    // An item without `endLine` is one line, and a stale line never leaves the document.
    expect(rangeOf({ kind: 'stop', line: 3, text: 'M1' }, model).endLineNumber).toBe(3);
    expect(rangeOf({ kind: 'tool', line: 99, endLine: 200, text: 'T1' }, model)).toEqual({
      startLineNumber: 40,
      startColumn: 1,
      endLineNumber: 40,
      endColumn: 80,
    });
  });
});
