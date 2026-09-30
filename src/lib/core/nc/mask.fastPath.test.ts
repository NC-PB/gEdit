// The whole-line fast path in `maskComments` (G7 perf regression). See `mask.ts`.
//
// A wall-clock budget here would flake under load and would not say *why* it slowed
// down. What actually regresses is the fast path silently stopping short: the character
// loop runs again, at every position, for every line — exactly the per-character cost the
// fast path exists to avoid (`programNameEndAt` sitting next to `commentAt` in that loop
// is the bug this file's fix undoes). So this counts calls to the loop's own expensive
// checks instead of timing anything: a comment-free, name-free line must never reach
// `commentAt` or `programNameEndAt`, and a line that does have something to mask still
// must, so the fast path is not just short-circuiting everything.

import { afterEach, describe, expect, it, vi } from 'vitest';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import klartextJson from '$lib/data/profiles/heidenhain-klartext.json';
import { compileProfile } from '$lib/core/profiles/compile';
import type { Profile } from '$lib/core/profiles/types';

vi.mock('./tokenizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tokenizer')>();
  return { ...actual, commentAt: vi.fn(actual.commentAt), programNameEndAt: vi.fn(actual.programNameEndAt) };
});

const { maskComments } = await import('./mask');
const { commentAt, programNameEndAt } = await import('./tokenizer');

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(klartextJson as unknown as Profile);

afterEach(() => {
  vi.clearAllMocks();
});

describe('maskComments fast path', () => {
  it('never calls the character-loop checks on a plain CAM line', () => {
    maskComments('N10 G0 X10.5 Y-20.25 Z5. F500 S3000 M3', fanuc);
    expect(commentAt).not.toHaveBeenCalled();
    expect(programNameEndAt).not.toHaveBeenCalled();
  });

  // Klartext has no `programNames`, so this also proves the fast path applies (returns
  // without the loop) on a profile where `programNameEndAt` is always a no-op, not only
  // where `programNames` is null and the check is skipped for that reason alone.
  it('never calls them on a klartext line with no `;`, no `"` and no `*`', () => {
    maskComments('8 L X+10 Y+20 R0 FMAX M3', klartext);
    expect(commentAt).not.toHaveBeenCalled();
    expect(programNameEndAt).not.toHaveBeenCalled();
  });

  it('still calls commentAt on a line that has a comment', () => {
    maskComments('N10 G0 X10. (ROUGH) Y20.', fanuc);
    expect(commentAt).toHaveBeenCalled();
  });

  it('still calls programNameEndAt on a line that has a program name', () => {
    maskComments('<SHAFT_T12> (OD PIN)', fanuc);
    expect(programNameEndAt).toHaveBeenCalled();
  });
});
