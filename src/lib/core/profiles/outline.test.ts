// The outline index (plan §5 WP3.5, §7.4): the goldens for every NC fixture, the cases
// the M0 characterization marked as known gaps, and the two properties the incremental
// design rests on — `applyChange` agrees with `reset`, and a one-line edit in a very
// large program re-reads one line.
//
// The second one is asserted as an operation count, not as a millisecond figure. A
// wall-clock budget in a unit test measures the machine as much as the code: the one that
// stood here failed at 63.77 ms against a 50 ms budget with `npm run check` running beside
// it, and passed three times out of three when run alone. The millisecond budget of G7 is
// taken where it means something, against a real editor, in the `m3-perf` scenario.
//
// The goldens live in `tests/fixtures/expected/outline/<fixture>.json`, one file per
// fixture, so the Python side (§7.10) and a future profile can be checked against the
// same tables. Regenerate them with `npx vitest run outline -u`.

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { editorText, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import { compileProfile } from './compile';
import { detectProfile } from './detect';
import { OutlineIndex, type OutlineItem } from './outline';
import { validateProfile } from './validate';
import type { CompiledProfile, Profile } from './types';

const GOLDENS = '../../../../tests/fixtures/expected/outline/';
const FANUC = 'fanuc-gcode';
const KLARTEXT = 'heidenhain-klartext';

/** The built-ins, through the same gate the registry uses. */
const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

function compiled(id: string): CompiledProfile {
  const found = BUILTINS.find((cp) => cp.profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

/** A profile built for one rule of a test, on top of a built-in so it stays complete. */
function variant(id: string, patch: (p: Profile) => void): CompiledProfile {
  const profile = structuredClone(compiled(id).profile);
  patch(profile);
  return compileProfile(profile);
}

function index(text: string, cp: CompiledProfile): OutlineIndex {
  const outline = new OutlineIndex(cp);
  outline.reset(text.split('\n'));
  return outline;
}

/** The outline of a fixture as the app builds it: detected profile, editor text. */
function outlineOf(rel: string): { profileId: string; text: string; items: OutlineItem[] } {
  const opened = openFixture(rel);
  if (opened.refused !== null) throw new Error(`${rel} does not open: ${opened.refused}`);
  const profileId = detectProfile(BUILTINS, `/work/${rel}`, opened.text, FANUC);
  const text = editorText(opened.text);
  return { profileId, text, items: index(text, compiled(profileId)).items() };
}

/** JSON with one row per line, so a golden diff stays readable. */
function format(profileId: string, items: OutlineItem[]): string {
  const rows: string[] = [];
  for (const item of items) {
    const { children, ...own } = item;
    rows.push(`    ${JSON.stringify(own)}`);
    for (const child of children ?? []) rows.push(`      ${JSON.stringify(child)}`);
  }
  const list = rows.length > 0 ? `[\n${rows.join(',\n')}\n  ]` : '[]';
  return `{\n  "profile": ${JSON.stringify(profileId)},\n  "items": ${list}\n}\n`;
}

/** 1-based number of the first line that reads exactly `content` (trimmed). */
function lineOf(text: string, content: string): number {
  const at = text.split('\n').findIndex((line) => line.trim() === content);
  if (at < 0) throw new Error(`no line "${content}"`);
  return at + 1;
}

/** The item listed for the line that reads `content`, or null. */
function itemFor(rel: string, content: string): OutlineItem | null {
  const { text, items } = outlineOf(rel);
  const line = lineOf(text, content);
  for (const item of items) {
    if (item.line === line) return item;
    for (const child of item.children ?? []) if (child.line === line) return child;
  }
  return null;
}

const openable = listFixtures('nc').filter((rel) => openFixture(rel).refused === null);

describe('outline goldens', () => {
  for (const rel of openable) {
    it(rel, async () => {
      const { profileId, items } = outlineOf(rel);
      await expect(format(profileId, items)).toMatchFileSnapshot(`${GOLDENS}${rel.replace(/^nc\//, '')}.json`);
    });
  }

  it('covers every fixture that opens', () => {
    expect(openable.length).toBeGreaterThanOrEqual(20);
  });
});

describe('tool changes the M0 parser missed', () => {
  it.each([
    ['nc/fanuc/f02-packed.nc', 'N10T1M6', '1'],
    ['nc/fanuc/O1234', 'N10T1M06', '1'],
    ['nc/fanuc/f02-packed.nc', 'N130M06T2', '2'],
    ['nc/fanuc/f02-packed.nc', 'N180T3G43H3M6', '3'],
    ['nc/fanuc/f03-multi-program.nc', 'T6 G43 H6 M6', '6'],
  ])('%s at "%s" is tool %s', (rel, content, tool) => {
    const item = itemFor(rel, content);
    expect(item?.kind).toBe('tool');
    expect(item?.tool).toBe(tool);
  });

  it('takes the tool from the last T word when M6 stands alone', () => {
    // f03: `T5` on one line, `M6` on the next. A bare `T` is not a tool change itself.
    expect(itemFor('nc/fanuc/f03-multi-program.nc', 'T5')).toBeNull();
    const item = itemFor('nc/fanuc/f03-multi-program.nc', 'M6');
    expect(item?.kind).toBe('tool');
    expect(item?.tool).toBe('5');
  });

  it('never reads a tool change out of a comment', () => {
    expect(itemFor('nc/fanuc/f05-comments-edge.nc', '(T1 M6)')?.kind).toBe('comment');
    expect(itemFor('nc/fanuc/f05-comments-edge.nc', 'G0 Z25. (NEXT: T1 M6)')).toBeNull();
    const { items } = outlineOf('nc/fanuc/f05-comments-edge.nc');
    expect(items.filter((item) => item.kind === 'tool').map((item) => item.tool)).toEqual(['2']);
  });

  it('leaves a Klartext speed change out of the tool list', () => {
    expect(itemFor('nc/heidenhain/h03-speed-only.h', '9 TOOL CALL Z S5000')).toBeNull();
    expect(itemFor('nc/heidenhain/h03-speed-only.h', '12 TOOL CALL S6000 F900')).toBeNull();
    const { items } = outlineOf('nc/heidenhain/h03-speed-only.h');
    expect(items.filter((item) => item.kind === 'tool').map((item) => item.line)).toEqual([4]);
  });

  it('lists a named and an indexed Klartext tool', () => {
    expect(itemFor('nc/heidenhain/h02-tool-names.h', '5 TOOL CALL "MILL_D10" Z S5000 F800 DL+0.1')?.tool).toBe('"MILL_D10"');
    expect(itemFor('nc/heidenhain/h02-tool-names.h', '14 TOOL CALL QS1 Z S2800')?.tool).toBe('QS1');
    expect(itemFor('nc/heidenhain/h02-tool-names.h', '20 TOOL CALL 12.1 Z S1800 DR-0.02')?.tool).toBe('12.1');
  });
});

describe('the kinds', () => {
  it('reads Fanuc programs, whole-line comments and optional stops', () => {
    const { items } = outlineOf('nc/fanuc/f03-multi-program.nc');
    const kinds = new Map<string, number>();
    for (const item of items) kinds.set(item.kind, (kinds.get(item.kind) ?? 0) + 1);
    expect(kinds.get('program')).toBe(2);
    expect(items.filter((item) => item.kind === 'program').map((item) => item.text)).toEqual(['O3001', 'O3002']);
  });

  it('reads Klartext sections, comments and labels', () => {
    const { items } = outlineOf('nc/heidenhain/h01-3tools.h');
    const flat = items.flatMap((item) => [item, ...(item.children ?? [])]);
    expect(flat.filter((item) => item.kind === 'section').map((item) => item.text)).toEqual(['ROUGH', 'DRILL', 'FINISH']);
    expect(flat.find((item) => item.kind === 'comment' && item.line === 16)?.text).toBe('FOUR HOLES D8.5');
    // Editor line 47 is `37 LBL 1`: the only label *definition* in the file. The cycle's
    // continuation lines carry no block number of their own, which is why the editor
    // lines run ahead of the block numbers.
    expect(flat.filter((item) => item.kind === 'label').map((item) => item.line)).toEqual([47]);
    // Editor line 32 is `22 CALL LBL 1`, a call, and line 50 is `40 LBL 0`, the end
    // marker of the subprogram — neither one defines a label.
    expect(flat.filter((item) => item.kind === 'subprogram-call').map((item) => [item.line, item.text])).toEqual([
      [32, 'CALL LBL 1'],
    ]);
    expect(flat.some((item) => item.line === 50)).toBe(false);
  });

  it('lists the program header and the program end', () => {
    const { items } = outlineOf('nc/heidenhain/h01-3tools.h');
    const flat = items.flatMap((item) => [item, ...(item.children ?? [])]);
    expect(flat.find((item) => item.kind === 'program')?.text).toBe('BEGIN PGM H01_3TOOLS MM');
    expect(flat.filter((item) => item.kind === 'end').map((item) => [item.line, item.text])).toEqual([
      [46, 'M30'],
      [51, 'END PGM'],
    ]);
  });

  it('lists a Fanuc subprogram call and the program end', () => {
    const { items } = outlineOf('nc/fanuc/f01-mill-3tools.nc');
    const flat = items.flatMap((item) => [item, ...(item.children ?? [])]);
    expect(flat.filter((item) => item.kind === 'subprogram-call').map((item) => item.text)).toEqual(['M98 P2000']);
    expect(flat.filter((item) => item.kind === 'end').map((item) => item.text)).toEqual(['M30']);
    // `M0` and `M1` still win over the program-end rule that stands behind them.
    expect(flat.filter((item) => item.kind === 'stop').map((item) => item.text)).toEqual(['M1', 'M1']);
  });

  it('marks M0 and M1 as stops', () => {
    const { items } = outlineOf('nc/fanuc/f01-mill-3tools.nc');
    const flat = items.flatMap((item) => [item, ...(item.children ?? [])]);
    expect(flat.filter((item) => item.kind === 'stop').map((item) => item.text)).toEqual(['M1', 'M1']);
  });
});

describe('tool labels', () => {
  it('takes the trailing comment of the call line first', () => {
    expect(itemFor('nc/fanuc/f05-comments-edge.nc', 'T2 M6 (D8 DRILL)')?.text).toBe('T2 — D8 DRILL');
    expect(itemFor('nc/heidenhain/h01-3tools.h', '5 TOOL CALL 1 Z S3000 F800 ; D10 END MILL')?.text).toBe('T1 — D10 END MILL');
  });

  it('otherwise takes the nearest comment above, then below', () => {
    expect(itemFor('nc/fanuc/f01-mill-3tools.nc', 'T1 M6')?.text).toBe('T1 — CONTOUR ROUGH');
    expect(itemFor('nc/fanuc/f01-mill-3tools.nc', 'T2 M6')?.text).toBe('T2 — SPOT AND PECK DRILL');
    expect(itemFor('nc/heidenhain/h01-3tools.h', '16 TOOL CALL 2 Z S2400')?.text).toBe('T2 — FOUR HOLES D8.5');
    // Nothing above within three lines but a section heading, so that one describes it.
    expect(itemFor('nc/heidenhain/h01-3tools.h', '25 TOOL CALL 3 Z S5000 F600 DR-0.02')?.text).toBe('T3 — FINISH');

    const below = index('T1 M6\n(FACE MILL)\nS1000 M3\n', compiled(FANUC));
    expect(below.items()[0].text).toBe('T1 — FACE MILL');
  });

  it('looks three lines up and two down, and no further', () => {
    const cp = compiled(FANUC);
    expect(index('(FAR)\n\n\nT1 M6\n', cp).items().at(-1)?.text).toBe('T1 — FAR');
    expect(index('(FAR)\n\n\n\nT1 M6\n', cp).items().at(-1)?.text).toBe('T1');
    expect(index('T1 M6\n\n(BELOW)\n', cp).items()[0].text).toBe('T1 — BELOW');
    expect(index('T1 M6\n\n\n(BELOW)\n', cp).items()[0].text).toBe('T1');
  });

  // Naming a tool after somebody else's comment is the single most damaging thing a
  // program map can say: `T5 — T6  D6 BALL END MILL` tells the operator that the D12 flat
  // end mill is a D6 ball nose.
  it('never labels a tool with another tool\'s comment', () => {
    const cp = compiled(FANUC);
    const header = ['O1001 (PLATE)', '(T5  D12 FLAT END MILL)', '(T6  D6 BALL END MILL)', 'G21 G90', 'T5', 'M6'];
    const item = index(header.join('\n'), cp).items().find((row) => row.kind === 'tool');
    expect(item?.text).toBe('T5 — D12 FLAT END MILL');
  });

  it('does not take the program title for a tool description', () => {
    const cp = compiled(FANUC);
    expect(index('O1002(PACKED WORDS)\nN10T1M6\n', cp).items().at(-1)?.text).toBe('T1');
    // A comment line of its own above the program header is still out of reach.
    expect(index('(ROUGH)\nO1002 (TITLE)\nT1 M6\n', cp).items().at(-1)?.text).toBe('T1');
  });

  it('drops the tool number from a comment that names this very tool', () => {
    const cp = compiled(FANUC);
    expect(index('(T4  D16 FACE MILL)\nG21 G90\nT4 M6\n', cp).items().at(-1)?.text).toBe('T4 — D16 FACE MILL');
    expect(index('(T04 D16 FACE MILL)\nT4 M6\n', cp).items().at(-1)?.text).toBe('T4 — D16 FACE MILL');
  });

  it('falls back to the header tool list, and only after the comments nearby', () => {
    const cp = compiled(FANUC);
    const list = ['(T1  D10 FLAT END MILL)', '(T2  M8X1.25 TAP)', 'G21 G90'];
    // Nothing within reach of the second tool change but the list at the top.
    const far = index([...list, 'T1 M6', 'S3000 M3', 'G0 X0.', 'M5', 'T2 M6'].join('\n'), cp);
    expect(far.items().filter((row) => row.kind === 'tool').map((row) => row.text)).toEqual([
      'T1 — D10 FLAT END MILL',
      'T2 — M8X1.25 TAP',
    ]);
    // A comment of its own wins over the list: it names the operation, not the tool.
    const near = index([...list, '(CONTOUR ROUGH)', 'T1 M6'].join('\n'), cp);
    expect(near.items().at(-1)?.text).toBe('T1 — CONTOUR ROUGH');
  });

  it('stops the scan at the tool change before it', () => {
    const cp = compiled(FANUC);
    const text = ['T1 M6 (D10 END MILL)', 'S3000 M3', 'T2 M6'].join('\n');
    expect(index(text, cp).items().map((row) => row.text)).toEqual(['T1 — D10 END MILL', 'T2']);
  });

  it('skips a decorative banner line (toolList.commentFilter)', () => {
    const cp = compiled(FANUC);
    expect(index('(------------)\nT1 M6\n', cp).items().at(-1)?.text).toBe('T1');
    expect(index('(=====)\n(ROUGHING)\nT1 M6\n', cp).items().at(-1)?.text).toBe('T1 — ROUGHING');
  });

  it('honours description: above, below and trailing', () => {
    const above = variant(FANUC, (p) => {
      p.toolList = { ...p.toolList, description: 'above' };
    });
    expect(index('T1 M6 (TRAILING)\n', above).items()[0].text).toBe('T1');
    expect(index('(ABOVE)\nT1 M6 (TRAILING)\n', above).items().at(-1)?.text).toBe('T1 — ABOVE');

    const below = variant(FANUC, (p) => {
      p.toolList = { ...p.toolList, description: 'below' };
    });
    expect(index('(ABOVE)\nT1 M6 (TRAILING)\n(BELOW)\n', below).items().at(-1)?.text).toBe('T1 — BELOW');

    const trailing = variant(FANUC, (p) => {
      p.toolList = { ...p.toolList, description: 'trailing' };
    });
    expect(index('(ABOVE)\nT1 M6\n', trailing).items().at(-1)?.text).toBe('T1');
  });

  it('drops leading zeros and can collapse lathe offset digits', () => {
    expect(index('T01 M6\n', compiled(FANUC)).items()[0].text).toBe('T1');

    const lathe = variant(FANUC, (p) => {
      p.toolList = { ...p.toolList, description: 'auto', collapseOffsetDigits: true };
    });
    const item = index('T0101 M6\n', lathe).items()[0];
    expect(item.text).toBe('T1');
    expect(item.tool).toBe('0101');

    const keepZeros = variant(FANUC, (p) => {
      p.toolList = { description: 'auto', dropLeadingZeros: false };
    });
    expect(index('T01 M6\n', keepZeros).items()[0].text).toBe('T01');
  });
});

describe('the tree and the segments', () => {
  const text = [
    'O1000 (MAIN)', // 1 program
    '(HEADER)', //     2 comment, before any tool
    'T1 M6', //        3 tool
    'G0 X0.', //       4
    '(FINISH PASS)', //5 comment, inside the T1 segment
    'M1', //           6 stop
    'T2 M6', //        7 tool
    'X10.', //         8
    'O2000 (SUB)', //  9 program: closes the T2 segment
    'M99', //         10
    '', //            11
  ].join('\n');
  const outline = index(text, compiled(FANUC));

  it('keeps tools and programs at the top level and nests what is inside a segment', () => {
    expect(outline.items().map((item) => [item.kind, item.line, item.endLine])).toEqual([
      ['program', 1, 8],
      ['comment', 2, undefined],
      ['tool', 3, 6],
      ['tool', 7, 8],
      ['program', 9, 11],
      ['end', 10, undefined],
    ]);
    expect(outline.items()[2].children?.map((child) => [child.kind, child.line])).toEqual([
      ['comment', 5],
      ['stop', 6],
    ]);
    // A comment in front of the first tool call has no segment to belong to.
    expect(outline.items()[1].children).toBeUndefined();
  });

  it('lists the tool lines ascending', () => {
    expect(outline.toolLines()).toEqual([3, 7]);
  });

  it('answers itemAt with the innermost item that covers the line', () => {
    expect(outline.itemAt(1)?.kind).toBe('program');
    expect(outline.itemAt(2)?.line).toBe(2);
    expect(outline.itemAt(4)?.line).toBe(3);
    expect(outline.itemAt(5)?.line).toBe(5);
    expect(outline.itemAt(6)?.kind).toBe('stop');
    expect(outline.itemAt(8)?.line).toBe(7);
    expect(outline.itemAt(10)?.kind).toBe('end'); // `M99`, inside the program that ends there
    expect(new OutlineIndex(compiled(FANUC)).itemAt(1)).toBeNull();
  });

  it('closes a Klartext section before the next section, tool or program', () => {
    const klartext = index(
      ['0 BEGIN PGM A MM', '1 * - ROUGH', '2 TOOL CALL 1 Z S100', '3 L X+0', '4 * - FINISH', '5 TOOL CALL 2 Z S200', '6 END PGM A MM'].join('\n'),
      compiled(KLARTEXT),
    );
    const flat = klartext.items().flatMap((item) => [item, ...(item.children ?? [])]);
    // A heading that announces the next tool call is closed by that call, so it stays the
    // caption it is; a heading inside a segment ends where the segment does.
    expect(flat.filter((item) => item.kind === 'section').map((item) => [item.line, item.endLine])).toEqual([
      [2, 2],
      [5, 5],
    ]);
    expect(klartext.items().filter((item) => item.kind === 'tool').map((item) => [item.line, item.endLine])).toEqual([
      [3, 5],
      [6, 7],
    ]);
  });
});

describe('applyChange', () => {
  const cp = compiled(FANUC);
  const base = ['O1000', '(ONE)', 'T1 M6', 'G0 X0.', '(TWO)', 'T2 M6', 'M1', 'M30'];

  /** `reset` over the same lines, which is what `applyChange` has to agree with. */
  function expected(lines: string[]): string {
    return JSON.stringify(index(lines.join('\n'), cp).items());
  }

  it('replaces a range and reports what reset would', () => {
    const outline = new OutlineIndex(cp);
    outline.reset([...base]);
    outline.applyChange(3, 4, ['T7 M6']);
    const lines = [...base];
    lines.splice(2, 2, 'T7 M6');
    expect(JSON.stringify(outline.items())).toBe(expected(lines));
    expect(outline.toolLines()).toEqual([3, 5]);
  });

  it('handles an insertion, a deletion and an append', () => {
    const outline = new OutlineIndex(cp);
    const lines = [...base];
    outline.reset([...lines]);

    outline.applyChange(2, 1, ['(NEW)', 'T9 M6']); // insert before line 2
    lines.splice(1, 0, '(NEW)', 'T9 M6');
    expect(JSON.stringify(outline.items())).toBe(expected(lines));

    outline.applyChange(1, 2, []); // delete the first two lines
    lines.splice(0, 2);
    expect(JSON.stringify(outline.items())).toBe(expected(lines));

    outline.applyChange(lines.length + 1, lines.length, ['(TAIL)']);
    lines.push('(TAIL)');
    expect(JSON.stringify(outline.items())).toBe(expected(lines));
  });

  it('takes an insertion far larger than an argument list', () => {
    const outline = new OutlineIndex(cp);
    outline.reset([...base]);
    const pasted = ['(PASTED)', 'T4 M6', ...Array.from({ length: 200_000 }, (_, i) => `G1 X${i}. F800.`)];
    outline.applyChange(2, 1, pasted);
    expect(outline.toolLines()).toEqual([3, 200_005, 200_008]);
    expect(outline.items().at(-1)?.line).toBe(200_008);
  });

  it('clamps a range that is out of bounds instead of throwing', () => {
    const outline = new OutlineIndex(cp);
    outline.reset(['T1 M6']);
    outline.applyChange(-5, 99, ['T2 M6']);
    expect(outline.items().map((item) => item.tool)).toEqual(['2']);
  });

  /** A deterministic 32-bit PRNG, so a failure can be replayed. */
  function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  it('gives the same result as reset over 1,000 random edits', () => {
    const pool = ['O1000', '(ROUGH)', 'T1 M6', 'T2', 'G0 X0. Y0.', 'M1', '(T3 M6)', 'M06T4', 'G1 Z-1. F200. (CUT)', '', 'M30', 'N50 (ROUGHING)'];
    const random = rng(20260920);
    const outline = new OutlineIndex(cp);
    const lines = [...base];
    outline.reset([...lines]);

    for (let step = 0; step < 1000; step++) {
      const start = 1 + Math.floor(random() * lines.length);
      const removed = Math.floor(random() * 3);
      const endOld = Math.min(lines.length, start + removed - 1);
      const inserted = Math.floor(random() * 3);
      const fresh: string[] = [];
      for (let i = 0; i < inserted; i++) fresh.push(pool[Math.floor(random() * pool.length)]);

      const removedCount = Math.max(0, endOld - start + 1);
      // A Monaco model always holds at least one line, so the index is never asked to
      // describe an empty document.
      if (lines.length - removedCount + fresh.length === 0) continue;

      outline.applyChange(start, endOld, fresh);
      lines.splice(start - 1, removedCount, ...fresh);

      if (JSON.stringify(outline.items()) !== expected(lines)) {
        throw new Error(`step ${step} differs\n${JSON.stringify(lines)}\n${JSON.stringify(outline.items())}\n${expected(lines)}`);
      }
    }
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('the cost of an edit', () => {
  const cp = compiled(FANUC);
  const LINES = 300_000;

  function bigProgram(): string[] {
    const block = ['(ROUGHING)', 'T1 M6', 'S4800 M3', 'G0 X-15. Y-10.', 'G43 Z25. H1 M8', 'G1 Z-5. F400.', 'X110. F1500.', 'Y90.', 'M1', 'M9'];
    const lines: string[] = ['%', 'O1001 (BIG)'];
    while (lines.length < LINES) lines.push(block[lines.length % block.length]);
    return lines;
  }

  /**
   * The profile with a counter on the one regex `classify` runs for every line it reads.
   *
   * What the incremental design promises is an *operation count*, not a millisecond
   * figure: a one-line edit re-reads one line. Counting it says exactly that and says it
   * the same way on an idle laptop and on a loaded CI machine — a wall-clock budget here
   * failed at 63 ms against 50 ms while `npm run check` was running beside it, which is
   * noise about the machine and not about the index. The millisecond budget of G7 is
   * measured where it belongs, against a real editor, by the `m3-perf` scenario.
   */
  function counting(): { profile: CompiledProfile; lines: () => number } {
    const real = cp.re.toolTrigger;
    let read = 0;
    const toolTrigger = {
      test(text: string): boolean {
        read++;
        return real.test(text);
      },
    } as RegExp;
    return { profile: { ...cp, re: { ...cp.re, toolTrigger } }, lines: () => read };
  }

  it('re-reads one line after a one-line change, however long the program is', () => {
    const { profile, lines } = counting();
    const outline = new OutlineIndex(profile);
    outline.reset(bigProgram());
    outline.items();
    expect(outline.toolLines().length).toBeGreaterThan(1000);

    const before = lines();
    outline.applyChange(1000, 1000, ['X1. F1200.']);
    outline.items();
    expect(lines() - before).toBe(1);

    // And an insertion reads the inserted lines, not the ones it moved down.
    const inserted = lines();
    outline.applyChange(2000, 1999, ['T7 M6', '(NEW)']);
    outline.items();
    expect(lines() - inserted).toBe(2);
    expect(outline.itemAt(2000)?.tool).toBe('7');
  });

  it('aggregates once and hands the same tree out again until something changes', () => {
    const outline = new OutlineIndex(cp);
    outline.reset(bigProgram());
    const tree = outline.items();
    expect(outline.items()).toBe(tree);
    expect(outline.toolLines()).toBe(outline.toolLines());

    outline.applyChange(1000, 1000, ['X1. F1200.']);
    expect(outline.items()).not.toBe(tree);
  });
});
