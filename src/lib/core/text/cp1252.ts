// Windows-1252 <-> text, and the shared byte/string helpers the codec builds on.
// Internal to core/text: the public API is codec.ts (plan §7.2, AD-7).

import type { EncodeResult } from '$lib/app/types';

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
const SLICE = 0x2000;

/** A string from UTF-16 code units, in slices so the argument list stays small. */
export function stringOfCodes(codes: Uint16Array): string {
  if (codes.length <= SLICE) return String.fromCharCode(...codes);
  let text = '';
  for (let i = 0; i < codes.length; i += SLICE) text += String.fromCharCode(...codes.subarray(i, i + SLICE));
  return text;
}

/** One character per byte, following Windows-1252. */
export function decodeCp1252(bytes: Uint8Array): string {
  const codes = new Uint16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) codes[i] = CP1252_DECODE[bytes[i]];
  return stringOfCodes(codes);
}

/**
 * One byte per character. Never substitutes: the first character Windows-1252 cannot
 * store is reported instead of bytes, with a 1-based line and column (UTF-16 columns,
 * as in Monaco). `breakChar` is the last character of the document's line ending, so
 * the position is the one the editor shows even when lines are joined with CR or CRLF.
 */
export function encodeCp1252(text: string, breakChar = '\n'): EncodeResult {
  const breakCode = breakChar.charCodeAt(0);
  const bytes = new Uint8Array(text.length);
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const byte = code < 0x80 ? code : CP1252_ENCODE.get(code);
    if (byte === undefined) {
      return {
        ok: false,
        badChar: String.fromCodePoint(text.codePointAt(i) ?? code),
        line,
        column: i - lineStart + 1,
      };
    }
    bytes[i] = byte;
    if (code === breakCode) {
      line++;
      lineStart = i + 1;
    }
  }
  return { ok: true, bytes };
}
