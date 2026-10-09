// Exit criterion X2 (plan §2.2), the TypeScript tokenizer on the exit programs: neither the Okuma
// lathe program nor the Sinumerik lathe program has a token the tokenizer cannot place, outside a
// comment. `exit2-x2` (runtime) reads the painted colours and runs the Python tokenizer as a user
// script; this is the app's own tokenizer, with no machine chosen, as a document without one is read.
// The `.txt` copies are the same bytes, so one would do for the tokens, but their detection is the
// other half of the criterion and is asserted as well.

import { describe, expect, it } from 'vitest';
import { readFixture } from './helpers/fixtures';
import { detect, effectiveFor, openBytes, unknownTokens } from './helpers/realPrograms';

const PROGRAMS: ReadonlyArray<readonly [file: string, profile: string]> = [
  ['okuma-lathe.MIN', 'okuma-osp'],
  ['okuma-lathe.txt', 'okuma-osp'],
  ['sinumerik-lathe.MPF', 'sinumerik'],
  ['sinumerik-lathe.txt', 'sinumerik'],
];

describe('the exit programs of X2 and the TypeScript tokenizer', () => {
  it.each(PROGRAMS)('%s is detected as %s', (file, profile) => {
    const opened = openBytes(readFixture(`exit2/${file}`));
    if (!opened.ok) throw new Error(`${file} does not open: ${opened.reason}`);
    expect(detect(`/work/${file}`, opened.text)).toBe(profile);
  });

  it.each(PROGRAMS)('%s has no unknown token outside a comment', (file, profile) => {
    const opened = openBytes(readFixture(`exit2/${file}`));
    if (!opened.ok) throw new Error(`${file} does not open: ${opened.reason}`);
    expect(opened.text.split('\n').length, 'the program is not empty').toBeGreaterThan(20);
    const eff = effectiveFor(profile, opened.text, null);
    expect(unknownTokens(eff.cp, opened.text)).toEqual([]);
  });
});
