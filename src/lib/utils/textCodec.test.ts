// Characterization tests: they freeze what today's codec does with the fixture files
// (which open, as which encoding, and that an unedited save writes the same bytes),
// so the M1 codec (WP1.3) can show what it keeps and what it improves.
// Cases marked KNOWN GAP (M1) are expected to change in M1.

import { describe, expect, it } from 'vitest';
import { listFixtures, readFixture } from '../../../tests/unit/helpers/fixtures';
import {
  decodeBytes,
  encodeText,
  encodingLabel,
  unsupportedContent,
  type FileEncoding,
} from './textCodec';

const UTF8: FileEncoding = { encoding: 'utf-8', hasBom: false };
const UTF8_BOM: FileEncoding = { encoding: 'utf-8', hasBom: true };
const CP1252: FileEncoding = { encoding: 'windows-1252', hasBom: false };
const BINARY = 'it contains binary data (NUL bytes)';
const UTF16 = 'it is UTF-16 encoded, which gEdit does not support yet';

// Encoding each file opens with, or the reason the app refuses it.
const ENCODING_FIXTURES: Record<string, FileEncoding | string> = {
  'cp1252-crlf.nc': CP1252,
  'cr-only.nc': UTF8,
  'mixed-eol.nc': UTF8,
  'nul-heavy.bin': BINARY,
  // KNOWN GAP (M1): refused; the M1 codec strips inner NULs and marks the document modified.
  'nul-inside.nc': BINARY,
  // KNOWN GAP (M1): opens, but the leader and trailer stay in the editor text.
  'nul-leader-trailer.nc': UTF8,
  // KNOWN GAP (M1): UTF-16 is refused; M1 reads and writes it.
  'utf16be-bom.nc': UTF16,
  'utf16le-bom.nc': UTF16,
  'utf8-bom-crlf.nc': UTF8_BOM,
  'utf8-lf.nc': UTF8,
};

describe('encoding fixtures', () => {
  it('has an expectation for every encoding fixture', () => {
    expect(Object.keys(ENCODING_FIXTURES).map((name) => `nc/encoding/${name}`).sort()).toEqual(
      listFixtures('nc/encoding'),
    );
  });

  for (const [name, expected] of Object.entries(ENCODING_FIXTURES)) {
    it(`${name} -> ${typeof expected === 'string' ? 'refused' : encodingLabel(expected)}`, () => {
      const bytes = readFixture(`nc/encoding/${name}`);
      if (typeof expected === 'string') {
        expect(unsupportedContent(bytes)).toBe(expected);
        return;
      }
      expect(unsupportedContent(bytes)).toBeNull();
      const { encoding, hasBom } = decodeBytes(bytes);
      expect({ encoding, hasBom }).toEqual(expected);
    });
  }
});

describe('unedited save', () => {
  const openable = listFixtures('nc').filter((rel) => unsupportedContent(readFixture(rel)) === null);

  it.each(openable)('writes back the bytes of %s', (rel) => {
    const bytes = readFixture(rel);
    const decoded = decodeBytes(bytes);
    const encoded = encodeText(decoded.text, decoded);
    expect(encoded.ok).toBe(true);
    if (encoded.ok) expect(Buffer.from(encoded.bytes).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('decoded text', () => {
  const text = (name: string) => decodeBytes(readFixture(`nc/encoding/${name}`)).text;

  it('reads the Windows-1252 characters', () => {
    const cp1252 = text('cp1252-crlf.nc');
    expect(cp1252).toContain('(Ø10 END MILL, 30° CHAMFER, RA 0.8 µM)');
    expect(cp1252).toContain('(CUSTOMER: MÜLLER AG – TOOL COST 12 €)');
  });

  it('drops the UTF-8 byte order mark from the text', () => {
    const withBom = text('utf8-bom-crlf.nc');
    expect(withBom.startsWith('(WRITTEN FOR GEDIT')).toBe(true);
    expect(withBom).toContain('(Ø10 END MILL, 30° CHAMFER)');
    expect(text('utf8-lf.nc')).toContain('ROUGH → FINISH');
  });

  it('keeps the line breaks as they are in the file', () => {
    expect(text('cr-only.nc')).not.toContain('\n');
    expect(text('utf8-bom-crlf.nc').replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const mixed = text('mixed-eol.nc');
    expect(mixed.match(/\r\n/g)).toHaveLength(10);
    expect(mixed.match(/\r(?!\n)/g)).toHaveLength(1);
    expect(mixed.match(/(?<!\r)\n/g)).toHaveLength(2);
  });

  // KNOWN GAP (M1): AD-7 keeps leader and trailer out of the editor text.
  it('keeps the NUL leader and trailer in the text', () => {
    const nul = text('nul-leader-trailer.nc');
    expect(nul.startsWith('\0'.repeat(40) + '(WRITTEN')).toBe(true);
    expect(nul.endsWith('%\r\n' + '\0'.repeat(40))).toBe(true);
  });
});

describe('saving an edited Windows-1252 file', () => {
  const decoded = decodeBytes(readFixture('nc/encoding/cp1252-crlf.nc'));

  it('reports the first character Windows-1252 cannot store, with line and column', () => {
    const edited = decoded.text.replace('O2001 (ENCODING)', 'O2001 (ENCODING → 2)');
    expect(encodeText(edited, decoded)).toEqual({ ok: false, badChar: '→', line: 3, column: 17 });
  });

  it('stores an added Windows-1252 character as one byte', () => {
    const edited = decoded.text.replace('O2001 (ENCODING)', 'O2001 (ENCODING Ä)');
    const encoded = encodeText(edited, decoded);
    expect(encoded.ok && encoded.bytes.length).toBe(readFixture('nc/encoding/cp1252-crlf.nc').length + 2);
    expect(encoded.ok && encoded.bytes.includes(0xc4)).toBe(true);
  });
});
