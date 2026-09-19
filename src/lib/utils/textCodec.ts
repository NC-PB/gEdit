// Bytes <-> text for opened and saved files. Valid UTF-8 is read as UTF-8, anything
// else as Windows-1252, which maps every byte to a character. Both paths write back
// exactly the bytes that were read as long as the text is not edited.

export type EncodingName = 'utf-8' | 'windows-1252';

export interface FileEncoding {
  encoding: EncodingName;
  /** UTF-8 only: the file starts with a byte order mark (EF BB BF). */
  hasBom: boolean;
}

/** Encoding of new (untitled) documents. */
export const UTF8: FileEncoding = { encoding: 'utf-8', hasBom: false };

export interface DecodedText extends FileEncoding {
  /** File content without the BOM. */
  text: string;
}

/** First character the target encoding cannot store; line and column are 1-based (UTF-16 columns, as in Monaco). */
export interface Unencodable {
  badChar: string;
  line: number;
  column: number;
}

export type EncodeResult = { ok: true; bytes: Uint8Array } | ({ ok: false } & Unencodable);

const UTF8_BOM = [0xef, 0xbb, 0xbf];

// Windows-1252 characters of bytes 0x80-0x9F; all other bytes are U+0000-U+00FF unchanged.
// The five unassigned bytes (81, 8D, 8F, 90, 9D) become the C1 control of the same value,
// as in the WHATWG Encoding Standard, so every byte decodes and encodes back to itself.
const CP1252_80_9F = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

/** Character code of each byte. */
const CP1252_DECODE = Uint16Array.from({ length: 256 }, (_, byte) =>
  byte >= 0x80 && byte <= 0x9f ? CP1252_80_9F[byte - 0x80] : byte,
);

/** Byte of each non-ASCII character Windows-1252 can store (the exact inverse of CP1252_DECODE). */
const CP1252_ENCODE = new Map<number, number>();
CP1252_DECODE.forEach((code, byte) => {
  if (byte >= 0x80) CP1252_ENCODE.set(code, byte);
});

// String.fromCharCode takes one argument per character, so large files are converted in slices.
const DECODE_SLICE = 0x2000;

const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const utf8Encoder = new TextEncoder();

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return UTF8_BOM.every((b, i) => bytes[i] === b);
}

/**
 * Why `bytes` can't be edited as text without changing the file on save, or null if they can.
 * UTF-16 would be misread as UTF-8/Windows-1252 and its line breaks rewritten; NUL bytes inside
 * the text mean binary data. NUL runs at the start or end are the feed leader/trailer that
 * controls punch around a program, and round-trip fine.
 */
export function unsupportedContent(bytes: Uint8Array): string | null {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return 'it is UTF-16 encoded, which gEdit does not support yet';
  }
  let start = 0;
  let end = bytes.length;
  while (start < end && bytes[start] === 0) start++;
  while (end > start && bytes[end - 1] === 0) end--;
  if (bytes.subarray(start, end).includes(0)) return 'it contains binary data (NUL bytes)';
  return null;
}

function decodeWindows1252(bytes: Uint8Array): string {
  const codes = new Uint16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) codes[i] = CP1252_DECODE[bytes[i]];
  let text = '';
  for (let i = 0; i < codes.length; i += DECODE_SLICE) {
    text += String.fromCharCode(...codes.subarray(i, i + DECODE_SLICE));
  }
  return text;
}

/** Decodes file bytes: strict UTF-8 (BOM stripped and remembered), otherwise Windows-1252. */
export function decodeBytes(bytes: Uint8Array): DecodedText {
  const hasBom = hasUtf8Bom(bytes);
  try {
    const text = utf8Decoder.decode(hasBom ? bytes.subarray(UTF8_BOM.length) : bytes);
    return { text, encoding: 'utf-8', hasBom };
  } catch {
    // Not valid UTF-8 (typically Latin-1/Windows-1252 umlauts from CAM posts or controls).
    return { text: decodeWindows1252(bytes), encoding: 'windows-1252', hasBom: false };
  }
}

/** UTF-8 bytes of `text`, optionally with a BOM. */
export function encodeUtf8(text: string, hasBom = false): Uint8Array {
  const body = utf8Encoder.encode(text);
  if (!hasBom) return body;
  const bytes = new Uint8Array(UTF8_BOM.length + body.length);
  bytes.set(UTF8_BOM);
  bytes.set(body, UTF8_BOM.length);
  return bytes;
}

function encodeWindows1252(text: string): EncodeResult {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const byte = code < 0x80 ? code : CP1252_ENCODE.get(code);
    if (byte === undefined) {
      const before = text.slice(0, i);
      return {
        ok: false,
        badChar: String.fromCodePoint(text.codePointAt(i) ?? code),
        line: before.split('\n').length,
        column: i - before.lastIndexOf('\n'),
      };
    }
    bytes[i] = byte;
  }
  return { ok: true, bytes };
}

/**
 * Encodes `text` for saving. Never substitutes characters: if Windows-1252 cannot
 * store one, the result reports the first such character instead of bytes.
 */
export function encodeText(text: string, { encoding, hasBom }: FileEncoding): EncodeResult {
  if (encoding === 'windows-1252') return encodeWindows1252(text);
  return { ok: true, bytes: encodeUtf8(text, hasBom) };
}

/** Status bar name of an encoding. */
export function encodingLabel({ encoding, hasBom }: FileEncoding): string {
  if (encoding === 'windows-1252') return 'Windows-1252';
  return hasBom ? 'UTF-8 BOM' : 'UTF-8';
}

/** "U+65E5" style code point of the first character of `char`. */
export function codePointLabel(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}
