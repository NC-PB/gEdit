// Profile detection (plan §5 WP3.1, AD-11): the scoring rules, and the answer for every
// NC fixture.
//
// The fixture answers and the list of results that moved since the M0 characterization
// live in `tests/fixtures/expected/detect/fixtures.json`, so the Python side (§7.10) and
// a future profile can be checked against the same table.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { FIXTURES_DIR, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import { compileProfile } from './compile';
import { MAX_SNIFF_LINES, detectProfile, extensionOf } from './detect';
import { validateProfile } from './validate';
import type { CompiledProfile, Profile } from './types';

const FANUC = 'fanuc-gcode';
const KLARTEXT = 'heidenhain-klartext';

/** The built-ins, through the same gate the registry uses. */
const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

/** Detects `text` once with each fallback; the pair shows whether the fallback was used. */
function detectBoth(path: string | null, text: string, profiles = BUILTINS): [string, string] {
  return [detectProfile(profiles, path, text, FANUC), detectProfile(profiles, path, text, KLARTEXT)];
}

/** A profile built for one rule of the test, on top of a built-in so it stays complete. */
function variant(id: string, detect: Partial<Profile['detect']>): CompiledProfile {
  const base = BUILTINS[0].profile;
  const profile: Profile = {
    ...structuredClone(base),
    id,
    detect: { extensions: {}, content: [], ...structuredClone(detect) },
  };
  return compileProfile(profile);
}

interface ExpectedDetect {
  fixtures: Record<string, string>;
  improvements: { case: string; path: string; text: string; m0: string; expected: string }[];
}

const EXPECTED = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'expected/detect/fixtures.json'), 'utf8'),
) as ExpectedDetect;

describe('the extension weight', () => {
  it('decides on its own when the file says nothing', () => {
    expect(detectBoth('/work/a.h', '')).toEqual([KLARTEXT, KLARTEXT]);
    expect(detectBoth('/work/a.nc', '')).toEqual([FANUC, FANUC]);
    // .min stays with Fanuc until an Okuma profile exists.
    expect(detectBoth('/work/a.min', '')).toEqual([FANUC, FANUC]);
  });

  it('reads the extension off the file name only, in any case', () => {
    expect(extensionOf('/work/A.H')).toBe('h');
    expect(extensionOf('C:\\work\\B.NC')).toBe('nc');
    // A dot in a folder name is not an extension, and neither is a leading dot.
    expect(extensionOf('/work/dir.h/prog')).toBe('');
    expect(extensionOf('/work/.nc')).toBe('');
    expect(extensionOf('/work/O1234')).toBe('');
    expect(detectBoth('C:\\work\\B.NC', '')).toEqual([FANUC, FANUC]);
  });

  it('keeps the fallback for an extension no profile claims', () => {
    expect(detectBoth('/work/a.txt', '')).toEqual([FANUC, KLARTEXT]);
    expect(detectBoth('/work/O1234', '')).toEqual([FANUC, KLARTEXT]);
  });

  it('is not outvoted by a single weak content line', () => {
    expect(detectBoth('/work/a.nc', '12 L X+10 Y+5 R0')).toEqual([FANUC, FANUC]);
  });
});

describe('the content score', () => {
  it('counts a line only for its strongest matching pattern', () => {
    // Both of `two`'s rules match the line. Summed they would be 13 and win; capped at
    // the strongest they are 10, and the single rule of `one` takes it.
    const two = variant('two', {
      content: [
        { pattern: '^N\\d+', weight: 10 },
        { pattern: 'G0', weight: 3 },
      ],
    });
    const exact = variant('exact', { content: [{ pattern: 'G0', weight: 10 }] });
    const higher = variant('higher', { content: [{ pattern: 'G0', weight: 12 }] });
    const line = 'N10 G0 X0\n';
    // A tie with `exact` is only a tie because the 3 did not count: the fallback decides.
    expect(detectProfile([two, exact], null, line, 'exact')).toBe('exact');
    expect(detectProfile([two, exact], null, line, 'two')).toBe('two');
    expect(detectProfile([two, higher], null, line, 'two')).toBe('higher');
  });

  it('adds up over the lines, so content outvotes an extension', () => {
    const klartext = '0 BEGIN PGM PROG MM\n1 TOOL CALL 5 Z S2000\n2 END PGM PROG MM\n';
    expect(detectBoth('/work/prog.nc', klartext)).toEqual([KLARTEXT, KLARTEXT]);
  });

  it('reads only the first 400 non-empty lines', () => {
    const neutral = Array.from({ length: MAX_SNIFF_LINES }, (_, i) => `X${i}.`);
    const marker = '0 BEGIN PGM A MM';
    expect(detectBoth('/work/a.txt', [...neutral, marker].join('\n\n'))).toEqual([FANUC, KLARTEXT]);
    expect(detectBoth('/work/a.txt', [...neutral.slice(1), marker].join('\n\n'))).toEqual([KLARTEXT, KLARTEXT]);
  });

  it('does not read the rest of a large file', () => {
    // Detection is on the open path: it has to look at 400 lines, not at 200 000.
    const big = `%\nO1234\n${Array.from({ length: 200_000 }, (_, i) => `N${i} G1 X${i}.`).join('\n')}\n`;
    const started = performance.now();
    expect(detectProfile(BUILTINS, '/work/big.nc', big, KLARTEXT)).toBe(FANUC);
    // Well under a millisecond in practice; the limit only catches a full split.
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('scores a document without a path on its content alone', () => {
    expect(detectBoth(null, '0 BEGIN PGM A MM\n')).toEqual([KLARTEXT, KLARTEXT]);
    expect(detectBoth(null, '%\nO1234\n')).toEqual([FANUC, FANUC]);
    expect(detectBoth(null, '')).toEqual([FANUC, KLARTEXT]);
  });

  it('handles CRLF and CR line endings the same as LF', () => {
    const lines = ['0 BEGIN PGM A MM', '1 TOOL CALL 5 Z S2000', '2 END PGM A MM'];
    for (const eol of ['\n', '\r\n', '\r']) {
      expect(detectProfile(BUILTINS, '/work/a.txt', lines.join(eol), FANUC)).toBe(KLARTEXT);
    }
  });
});

describe('ties', () => {
  it('keep the fallback', () => {
    expect(detectBoth('/work/a.txt', '%\n0 BEGIN PGM A MM\n')).toEqual([FANUC, KLARTEXT]);
  });

  it('go to the higher priority first', () => {
    const rule = { content: [{ pattern: 'X', weight: 5 }] };
    const plain = variant('plain', rule);
    const important = variant('important', { ...rule, priority: 5 });
    expect(detectProfile([plain, important], null, 'X\n', 'plain')).toBe('important');
    expect(detectProfile([important, plain], null, 'X\n', 'plain')).toBe('important');
  });

  it('go to the registry order when neither the priority nor the fallback decides', () => {
    const first = variant('first', { content: [{ pattern: 'X', weight: 5 }] });
    const second = variant('second', { content: [{ pattern: 'X', weight: 5 }] });
    expect(detectProfile([first, second], null, 'X\n', 'someone-else')).toBe('first');
    expect(detectProfile([second, first], null, 'X\n', 'someone-else')).toBe('second');
  });
});

describe('folders', () => {
  const machine = variant('machine', { folders: ['D:/CAM/mill3', '/Volumes/nc'] });
  const other = variant('other', { extensions: { nc: 100 }, content: [{ pattern: 'X', weight: 50 }] });
  const profiles = [other, machine];

  it('win outright, whatever the extension and the content say', () => {
    expect(detectProfile(profiles, 'D:/CAM/mill3/part.nc', 'X\n', 'other')).toBe('machine');
    expect(detectProfile(profiles, '/Volumes/nc/sub/dir/part.nc', 'X\n', 'other')).toBe('machine');
  });

  it('accept both separators and ignore case', () => {
    expect(detectProfile(profiles, 'D:\\CAM\\mill3\\part.nc', '', 'other')).toBe('machine');
    expect(detectProfile(profiles, 'd:/cam/MILL3/part.nc', '', 'other')).toBe('machine');
  });

  it('match whole path segments only', () => {
    expect(detectProfile(profiles, 'D:/CAM/mill3x/part.nc', '', 'other')).toBe('other');
    // The folder itself is not a file in it.
    expect(detectProfile(profiles, 'D:/CAM/mill3', '', 'other')).toBe('other');
  });

  it('let the deepest folder win', () => {
    const root = variant('root', { folders: ['/cam'] });
    const deep = variant('deep', { folders: ['/cam/mill3'] });
    expect(detectProfile([root, deep], '/cam/mill3/part.nc', '', 'root')).toBe('deep');
    expect(detectProfile([deep, root], '/cam/other/part.nc', '', 'deep')).toBe('root');
  });

  it('are skipped for a document without a path', () => {
    expect(detectProfile(profiles, null, 'X\n', 'machine')).toBe('other');
  });
});

describe('nothing to go on', () => {
  it('returns the fallback unchanged, even when no profile carries that id', () => {
    expect(detectProfile(BUILTINS, '/work/a.txt', '', 'siemens-840d')).toBe('siemens-840d');
    expect(detectProfile([], '/work/a.h', '0 BEGIN PGM A MM', FANUC)).toBe(FANUC);
  });
});

describe('every NC fixture', () => {
  it('has an expectation', () => {
    expect(Object.keys(EXPECTED.fixtures).sort()).toEqual(listFixtures('nc'));
  });

  for (const [rel, expected] of Object.entries(EXPECTED.fixtures)) {
    it(`${rel} -> ${expected}`, () => {
      const opened = openFixture(rel);
      if (expected === 'refused') {
        expect(opened.refused).toBeTypeOf('string');
        return;
      }
      if (opened.refused !== null) throw new Error(`${rel} was refused: ${opened.refused}`);
      // The open dialog returns absolute paths.
      const result = detectBoth(`/work/${rel}`, opened.text);
      expect(result).toEqual(expected === 'fallback' ? [FANUC, KLARTEXT] : [expected, expected]);
    });
  }
});

describe('the results that moved since M0', () => {
  it('lists an improvement for every hand-written case, and no case that did not move', () => {
    expect(EXPECTED.improvements.length).toBeGreaterThan(0);
    for (const improvement of EXPECTED.improvements) {
      expect(improvement.expected, improvement.case).not.toBe(improvement.m0);
      const answers = detectBoth(improvement.path, improvement.text);
      expect(answers, improvement.case).toEqual([improvement.expected, improvement.expected]);
    }
  });
});
