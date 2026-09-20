// decodeFile / encodeFile (plan §7.2, AD-7): what a file becomes in the editor, and that
// saving it again writes the same bytes.

import { describe, expect, it } from 'vitest';
import type { DecodeResult, Eol, FileEncoding } from '$lib/app/types';
import { listFixtures, readFixture } from '../../../../tests/unit/helpers/fixtures';
import { generateLarge } from '../../../../tests/gen/gen-large.mjs';
import { decodeFile, encodeFile, encodingLabel } from './codec';

const UTF8: FileEncoding = { encoding: 'utf-8', hasBom: false };
const UTF8_BOM: FileEncoding = { encoding: 'utf-8', hasBom: true };
const CP1252: FileEncoding = { encoding: 'windows-1252', hasBom: false };
const UTF16LE: FileEncoding = { encoding: 'utf-16le', hasBom: true };
const UTF16BE: FileEncoding = { encoding: 'utf-16be', hasBom: true };

const encoding = (name: string) => `nc/encoding/${name}`;
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/** The decoded fixture, or a failing expectation if it was refused. */
function open(rel: string, o?: { stripNul?: boolean }): Extract<DecodeResult, { ok: true }> {
  const result = decodeFile(readFixture(rel), o);
  if (!result.ok) throw new Error(`${rel} was refused: ${result.message.key}`);
  return result;
}

/** Saves a decoded document unchanged, or with `text` in its place. */
function save(decoded: Extract<DecodeResult, { ok: true }>, text = decoded.text, eol?: Eol) {
  return encodeFile(text, { encoding: decoded.encoding, eol: eol ?? decoded.eol ?? 'crlf', nul: decoded.nul });
}

describe('decodeFile: the encoding of every fixture', () => {
  const expected: Record<string, FileEncoding | 'binary'> = {
    'cp1252-crlf.nc': CP1252,
    'cr-only.nc': UTF8,
    'mixed-eol.nc': UTF8,
    'nul-heavy.bin': 'binary',
    'nul-inside.nc': UTF8,
    'nul-leader-trailer.nc': UTF8,
    'utf16be-bom.nc': UTF16BE,
    'utf16le-bom.nc': UTF16LE,
    'utf8-bom-crlf.nc': UTF8_BOM,
    'utf8-lf.nc': UTF8,
  };

  it('has an expectation for every encoding fixture', () => {
    expect(Object.keys(expected).map(encoding).sort()).toEqual(listFixtures('nc/encoding'));
  });

  for (const [name, want] of Object.entries(expected)) {
    it(`${name} opens as ${want === 'binary' ? 'refused' : encodingLabel(want)}`, () => {
      const result = decodeFile(readFixture(encoding(name)));
      if (want === 'binary') {
        expect(result.ok).toBe(false);
        return;
      }
      expect(result.ok && result.encoding).toEqual(want);
    });
  }
});

describe('an unedited save writes the same bytes', () => {
  // Both exceptions change the text on purpose: mixed line endings become the majority
  // one, and the stray NULs of nul-inside are stripped.
  const skipped = [encoding('mixed-eol.nc'), encoding('nul-inside.nc')];
  const files = listFixtures('nc').filter((rel) => decodeFile(readFixture(rel)).ok && !skipped.includes(rel));

  it('covers every fixture that opens', () => {
    expect(files).toHaveLength(listFixtures('nc').length - skipped.length - 1); // -1: nul-heavy.bin is refused
  });

  it.each(files)('%s', (rel) => {
    const bytes = readFixture(rel);
    const encoded = save(open(rel));
    expect(encoded.ok).toBe(true);
    expect(encoded.ok && hex(encoded.bytes)).toBe(hex(bytes));
  });
});

describe('line endings', () => {
  it('reports the ending of a file that uses one throughout', () => {
    expect(open(encoding('utf8-lf.nc'))).toMatchObject({ eol: 'lf', eolMixed: false });
    expect(open(encoding('utf8-bom-crlf.nc'))).toMatchObject({ eol: 'crlf', eolMixed: false });
    expect(open(encoding('cr-only.nc'))).toMatchObject({ eol: 'cr', eolMixed: false });
  });

  it('hands the editor LF text whatever the file uses', () => {
    for (const name of ['utf8-lf.nc', 'utf8-bom-crlf.nc', 'cr-only.nc', 'mixed-eol.nc']) {
      expect(open(encoding(name)).text).not.toMatch(/\r/);
    }
  });

  it('takes the majority ending of a mixed file', () => {
    const mixed = open(encoding('mixed-eol.nc'));
    expect(mixed).toMatchObject({ eol: 'crlf', eolMixed: true });
    // The fixture has 10 CRLF, 2 LF and 1 CR; saving it writes 13 CRLF.
    const encoded = save(mixed);
    expect(encoded.ok && Buffer.from(encoded.bytes).toString('latin1').match(/\r\n/g)).toHaveLength(13);
  });

  it('gives a tie between CRLF and LF to CRLF', () => {
    const text = 'O1\r\nO2\r\nO3\nO4\n';
    const decoded = decodeFile(new TextEncoder().encode(text));
    expect(decoded.ok && decoded.eol).toBe('crlf');
  });

  it('reports no ending for a file without a line break', () => {
    const decoded = decodeFile(new TextEncoder().encode('O1234 (NO BREAK)'));
    expect(decoded.ok && decoded.eol).toBeNull();
    expect(decoded.ok && decoded.eolMixed).toBe(false);
  });

  it('keeps CR, LF and CRLF when the text was edited', () => {
    for (const [name, eol, breaks] of [
      ['cr-only.nc', 'cr', /\r(?!\n)/g],
      ['utf8-lf.nc', 'lf', /(?<!\r)\n/g],
      ['utf8-bom-crlf.nc', 'crlf', /\r\n/g],
    ] as const) {
      const decoded = open(encoding(name));
      const edited = decoded.text.replace('M30', 'M30 (EDITED)\nG0 Z25.');
      const encoded = save(decoded, edited);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) continue;
      const written = Buffer.from(encoded.bytes).toString('latin1');
      expect(written).toContain(`M30 (EDITED)`);
      expect(written.match(breaks)).toHaveLength(edited.split('\n').length - 1);
      expect(decoded.eol).toBe(eol);
      // No other kind of break leaked in.
      if (eol !== 'crlf') expect(written).not.toMatch(eol === 'cr' ? /\n/ : /\r/);
    }
  });
});

describe('Windows-1252', () => {
  const cp1252 = () => open(encoding('cp1252-crlf.nc'));

  it('reads the characters the file stores as single bytes', () => {
    const { text } = cp1252();
    expect(text).toContain('(Ø10 END MILL, 30° CHAMFER, RA 0.8 µM)');
    expect(text).toContain('(CUSTOMER: MÜLLER AG – TOOL COST 12 €)');
  });

  it('reports the first character it cannot store, with line and column', () => {
    const decoded = cp1252();
    const edited = decoded.text.replace('O2001 (ENCODING)', 'O2001 (ENCODING → 2)');
    expect(save(decoded, edited)).toEqual({ ok: false, badChar: '→', line: 3, column: 17 });
  });

  it('counts the line and column of the editor text, not of the joined CR-only text', () => {
    const decoded: Extract<DecodeResult, { ok: true }> = { ...cp1252(), eol: 'cr' };
    const edited = decoded.text.replace('O2001 (ENCODING)', 'O2001 (ENCODING → 2)');
    expect(save(decoded, edited)).toMatchObject({ line: 3, column: 17 });
  });

  it('stores an added Windows-1252 character as one byte', () => {
    const decoded = cp1252();
    const encoded = save(decoded, decoded.text.replace('O2001 (ENCODING)', 'O2001 (ENCODING Ä)'));
    expect(encoded.ok && encoded.bytes.length).toBe(readFixture(encoding('cp1252-crlf.nc')).length + 2);
    expect(encoded.ok && encoded.bytes.includes(0xc4)).toBe(true);
  });

  it('reports an astral character as the whole code point', () => {
    expect(encodeFile('M30 \u{1f600}\n', { encoding: CP1252, eol: 'lf', nul: { leader: 0, trailer: 0 } })).toEqual({
      ok: false,
      badChar: '\u{1f600}',
      line: 1,
      column: 5,
    });
  });
});

describe('UTF-16', () => {
  it('reads both byte orders as the same text', () => {
    const le = open(encoding('utf16le-bom.nc'));
    const be = open(encoding('utf16be-bom.nc'));
    expect(le.text).toBe(be.text);
    expect(le.text).toContain('(Ø10 END MILL, 30° CHAMFER, ROUGH → FINISH)');
    expect(le).toMatchObject({ eol: 'crlf', eolMixed: false, nul: { leader: 0, trailer: 0, stripped: 0 } });
  });

  it('is not mistaken for a file full of NUL bytes', () => {
    // Every ASCII character costs a NUL byte, so the binary rule must not see them.
    expect(decodeFile(readFixture(encoding('utf16le-bom.nc'))).ok).toBe(true);
    expect(decodeFile(readFixture(encoding('utf16be-bom.nc'))).ok).toBe(true);
  });

  it('writes an edit back in its own byte order, with the byte order mark', () => {
    for (const [name, first] of [
      ['utf16le-bom.nc', [0xff, 0xfe]],
      ['utf16be-bom.nc', [0xfe, 0xff]],
    ] as const) {
      const decoded = open(encoding(name));
      const encoded = save(decoded, decoded.text.replace('M30', 'M30 (Ø)'));
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) continue;
      expect([...encoded.bytes.subarray(0, 2)]).toEqual([...first]);
      // Each added character is two bytes; the Ø survives the round trip.
      expect(encoded.bytes.length).toBe(readFixture(encoding(name)).length + ' (Ø)'.length * 2);
      const back = decodeFile(encoded.bytes);
      expect(back.ok && back.text).toBe(decoded.text.replace('M30', 'M30 (Ø)'));
    }
  });

  it('keeps a character outside the basic plane', () => {
    const bytes = encodeFile('O1 \u{1f600}\n', { encoding: UTF16LE, eol: 'lf', nul: { leader: 0, trailer: 0 } });
    expect(bytes.ok).toBe(true);
    expect(bytes.ok && decodeFile(bytes.bytes)).toMatchObject({ ok: true, text: 'O1 \u{1f600}\n' });
  });
});

describe('NUL bytes', () => {
  it('keeps the tape leader and trailer out of the text and writes them back', () => {
    const decoded = open(encoding('nul-leader-trailer.nc'));
    expect(decoded.nul).toEqual({ leader: 40, trailer: 40, stripped: 0 });
    expect(decoded.text.startsWith('(WRITTEN FOR GEDIT')).toBe(true);
    expect(decoded.text).not.toContain('\0');

    const encoded = save(decoded, decoded.text.replace('M30', 'M30 (EDITED)'));
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect([...encoded.bytes.subarray(0, 40)].every((b) => b === 0)).toBe(true);
    expect([...encoded.bytes.subarray(-40)].every((b) => b === 0)).toBe(true);
    expect(encoded.bytes[40]).not.toBe(0);
  });

  it('strips the NULs inside the text and counts them', () => {
    const decoded = open(encoding('nul-inside.nc'));
    expect(decoded.nul).toEqual({ leader: 0, trailer: 0, stripped: 3 });
    expect(decoded.text).not.toContain('\0');
    expect(decoded.text).toContain('G0 X0. Y0.');
    expect(decoded.text).toContain('X40. F800.');
    // Saving writes the cleaned text: three bytes shorter than the file.
    const encoded = save(decoded);
    expect(encoded.ok && encoded.bytes.length).toBe(readFixture(encoding('nul-inside.nc')).length - 3);
  });

  it('keeps the NULs inside the text when stripNul is off', () => {
    const decoded = open(encoding('nul-inside.nc'), { stripNul: false });
    expect(decoded.nul).toEqual({ leader: 0, trailer: 0, stripped: 0 });
    expect(decoded.text).toContain('G0 X0.\0 Y0.');
    const encoded = save(decoded);
    expect(encoded.ok && hex(encoded.bytes)).toBe(hex(readFixture(encoding('nul-inside.nc'))));
  });

  it('refuses a file with more than 10 % NUL between leader and trailer', () => {
    const result = decodeFile(readFixture(encoding('nul-heavy.bin')));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('binary');
    expect(result.message.key).toBe('files.binaryRefused');
    expect(result.message.params?.percent).toBeGreaterThan(10);
  });

  it('draws the line at more than 10 %, leader and trailer not counted', () => {
    // A 100-byte program between a 40-byte leader and trailer, with `nuls` bytes of it
    // overwritten with NUL at odd positions, so the core keeps its length.
    const wrapped = (nuls: number) => {
      const out = new Uint8Array(40 + 100 + 40);
      out.set(new TextEncoder().encode('G0 X0. Y0.'.repeat(10)), 40);
      for (let i = 0; i < nuls; i++) out[40 + 1 + i * 2] = 0;
      return out;
    };
    expect(decodeFile(wrapped(10)).ok).toBe(true); // exactly 10 %
    expect(decodeFile(wrapped(11)).ok).toBe(false); // more than 10 %
  });

  it('writes no tape leader for UTF-16, so the BOM stays at offset 0', () => {
    // G8 F1: the encoding QuickPick offers UTF-16 for any document, and a tape program
    // wrapped in a UTF-16 body put the BOM behind the leader — bytes gEdit then refused
    // to open as anything but binary, with the original content already overwritten.
    const decoded = open(encoding('nul-leader-trailer.nc'));
    expect(decoded.nul).toEqual({ leader: 40, trailer: 40, stripped: 0 });

    for (const utf16 of [UTF16LE, UTF16BE]) {
      const encoded = encodeFile(decoded.text, {
        encoding: utf16,
        eol: decoded.eol ?? 'crlf',
        nul: decoded.nul,
      });
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) return;
      const bom = utf16 === UTF16LE ? [0xff, 0xfe] : [0xfe, 0xff];
      expect([...encoded.bytes.subarray(0, 2)]).toEqual(bom);
      // And it reads back as the same program rather than as `binary`.
      const reopened = decodeFile(encoded.bytes);
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      expect(reopened.encoding).toEqual(utf16);
      expect(reopened.text).toBe(decoded.text);
      expect(reopened.nul).toEqual({ leader: 0, trailer: 0, stripped: 0 });
    }
  });

  it('reads a file that is nothing but a tape leader as an empty document', () => {
    const decoded = decodeFile(new Uint8Array(64));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.text).toBe('');
    expect(decoded.nul).toEqual({ leader: 64, trailer: 0, stripped: 0 });
    const encoded = save(decoded);
    expect(encoded.ok && encoded.bytes.length).toBe(64);
    expect(encoded.ok && encoded.bytes.every((b) => b === 0)).toBe(true);
  });
});

describe('encodingLabel', () => {
  it('names every supported encoding', () => {
    expect(encodingLabel(UTF8)).toBe('UTF-8');
    expect(encodingLabel(UTF8_BOM)).toBe('UTF-8 BOM');
    expect(encodingLabel(CP1252)).toBe('Windows-1252');
    expect(encodingLabel(UTF16LE)).toBe('UTF-16 LE');
    expect(encodingLabel(UTF16BE)).toBe('UTF-16 BE');
  });
});

describe('a big file', () => {
  const text = generateLarge({ lines: 120_000, dialect: 'fanuc', mb: 5 });
  const bytes = new TextEncoder().encode(text);

  it('is about 5 MB of CRLF UTF-8', () => {
    expect(bytes.length).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    expect(bytes.length).toBeLessThan(7 * 1024 * 1024);
  });

  it('decodes in 200 ms or less', () => {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      const decoded = decodeFile(bytes);
      const took = performance.now() - started;
      expect(decoded.ok && decoded.eol).toBe('crlf');
      best = Math.min(best, took);
    }
    expect(best).toBeLessThanOrEqual(200);
  });

  it('round trips byte for byte', () => {
    const decoded = decodeFile(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const encoded = save(decoded);
    expect(encoded.ok && Buffer.from(encoded.bytes).equals(Buffer.from(bytes))).toBe(true);
  });
});
