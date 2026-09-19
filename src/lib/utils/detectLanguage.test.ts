// Characterization tests: they freeze what detection does today, so the M3 profile
// detection (WP3.1) can show that its results are the same or list the improvements.
// Cases marked KNOWN GAP (M3) describe behavior that M3 is expected to change.

import { describe, expect, it } from 'vitest';
import { listFixtures, openFixture } from '../../../tests/unit/helpers/fixtures';
import { detectLanguage } from './detectLanguage';
import type { Dialect } from './dialects';

const FANUC: Dialect = 'fanuc-gcode';
const KLARTEXT: Dialect = 'heidenhain-klartext';

/** Detects `text` once with each fallback; the pair shows whether the fallback was used. */
function detectBoth(path: string, text: string): [Dialect, Dialect] {
  return [detectLanguage(path, text, FANUC), detectLanguage(path, text, KLARTEXT)];
}

// 'fallback': the content was inconclusive and the current dialect stays.
// 'refused': the app does not open the file, so detection never runs.
const EXPECTED: Record<string, Dialect | 'fallback' | 'refused'> = {
  // Today a whole-line ( ) comment counts as a Fanuc marker.
  'nc/ambiguous/comment-only.txt': FANUC,
  'nc/ambiguous/empty.txt': 'fallback',
  'nc/ambiguous/fanuc-fragment.txt': FANUC,
  'nc/ambiguous/heidenhain-fragment.txt': KLARTEXT,
  'nc/encoding/cp1252-crlf.nc': FANUC,
  'nc/encoding/cr-only.nc': FANUC,
  'nc/encoding/mixed-eol.nc': FANUC,
  'nc/encoding/nul-heavy.bin': 'refused',
  // KNOWN GAP (M1): inner NULs and UTF-16 are refused; the M1 codec opens these files.
  'nc/encoding/nul-inside.nc': 'refused',
  'nc/encoding/nul-leader-trailer.nc': FANUC,
  'nc/encoding/utf16be-bom.nc': 'refused',
  'nc/encoding/utf16le-bom.nc': 'refused',
  'nc/encoding/utf8-bom-crlf.nc': FANUC,
  'nc/encoding/utf8-lf.nc': FANUC,
  'nc/fanuc/O1234': FANUC,
  'nc/fanuc/detect-fanuc.txt': FANUC,
  'nc/fanuc/f01-mill-3tools.nc': FANUC,
  'nc/fanuc/f02-packed.nc': FANUC,
  'nc/fanuc/f03-multi-program.nc': FANUC,
  'nc/fanuc/f04-feed-modes.nc': FANUC,
  'nc/fanuc/f05-comments-edge.nc': FANUC,
  'nc/fanuc/f07.tap': FANUC,
  'nc/heidenhain/detect-heidenhain.txt': KLARTEXT,
  'nc/heidenhain/h01-3tools.h': KLARTEXT,
  'nc/heidenhain/h02-tool-names.h': KLARTEXT,
  'nc/heidenhain/h03-speed-only.h': KLARTEXT,
  'nc/heidenhain/h04-cycle-feeds.h': KLARTEXT,
};

/** Editor text of a fixture the app can open. */
function fixtureText(rel: string): string {
  const opened = openFixture(rel);
  if (opened.refused !== null) throw new Error(`${rel} does not open: ${opened.refused}`);
  return opened.text;
}

describe('detectLanguage on every fixture', () => {
  it('has an expectation for every fixture file', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(listFixtures('nc'));
  });

  for (const [rel, expected] of Object.entries(EXPECTED)) {
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

describe('detectLanguage extension rules', () => {
  const fanucText = fixtureText('nc/fanuc/f01-mill-3tools.nc');
  const klartextText = fixtureText('nc/heidenhain/h01-3tools.h');

  it('maps .h, .nc and .min by extension alone, in any case', () => {
    expect(detectBoth('/work/A.H', '')).toEqual([KLARTEXT, KLARTEXT]);
    expect(detectBoth('C:\\work\\B.NC', '')).toEqual([FANUC, FANUC]);
    // .min stays Fanuc until an Okuma profile exists; M3 leaves it out of the Fanuc profile.
    expect(detectBoth('/work/c.min', '')).toEqual([FANUC, FANUC]);
  });

  it('sniffs every other extension, and names without one', () => {
    for (const path of ['/work/a.txt', '/work/a.tap', '/work/O1234', '/work/.nc', '/work/dir.h/prog']) {
      expect(detectBoth(path, fanucText), path).toEqual([FANUC, FANUC]);
      expect(detectBoth(path, klartextText), path).toEqual([KLARTEXT, KLARTEXT]);
    }
  });

  // KNOWN GAP (M3): the extension always wins; profile detection adds it as a weight,
  // so strong content can outvote it.
  it('ignores the content when the extension is known', () => {
    expect(detectBoth('/work/prog.nc', klartextText)).toEqual([FANUC, FANUC]);
    expect(detectBoth('/work/prog.h', fanucText)).toEqual([KLARTEXT, KLARTEXT]);
  });
});

describe('detectLanguage content sniffing', () => {
  it('falls back on a tie', () => {
    expect(detectBoth('/work/a.txt', '%\n0 BEGIN PGM A MM\n')).toEqual([FANUC, KLARTEXT]);
  });

  it('reads only the first 400 non-empty lines', () => {
    // Lines that score for neither dialect, with empty lines in between.
    const neutral = Array.from({ length: 400 }, (_, i) => `X${i}.`);
    const marker = '0 BEGIN PGM A MM';
    expect(detectBoth('/work/a.txt', [...neutral, marker].join('\n\n'))).toEqual([FANUC, KLARTEXT]);
    expect(detectBoth('/work/a.txt', [...neutral.slice(1), marker].join('\n\n'))).toEqual([KLARTEXT, KLARTEXT]);
  });

  // KNOWN GAP (M3): program numbers with more than 5 digits are not a strong marker;
  // the M3 Fanuc profile accepts up to 8.
  it('treats O12345 as a program number but not O123456', () => {
    expect(detectBoth('/work/a.txt', 'O12345')).toEqual([FANUC, FANUC]);
    expect(detectBoth('/work/a.txt', 'O123456')).toEqual([FANUC, KLARTEXT]);
  });
});
