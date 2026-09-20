// UTF-16 LE/BE with a byte order mark. Internal to core/text; the public API is codec.ts.
//
// A JS string is a sequence of UTF-16 code units already, so each unit is one pair of
// bytes and a round trip is exact, surrogate pairs included. Written by hand rather than
// with TextDecoder('utf-16be'), because TextEncoder only ever produces UTF-8 and the two
// directions must agree byte for byte.

import { stringOfCodes } from './cp1252';

/** True when `bytes` starts with the byte order mark of UTF-16 in the given byte order. */
export function hasUtf16Bom(bytes: Uint8Array, littleEndian: boolean): boolean {
  const [first, second] = littleEndian ? [0xff, 0xfe] : [0xfe, 0xff];
  return bytes.length >= 2 && bytes[0] === first && bytes[1] === second;
}

/**
 * Text of `bytes` after its byte order mark. A trailing odd byte cannot form a code
 * unit and is dropped; such a file is truncated, and no round trip can restore it.
 */
export function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const units = (bytes.length - 2) >> 1;
  const codes = new Uint16Array(units);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < units; i++) codes[i] = view.getUint16(2 + i * 2, littleEndian);
  return stringOfCodes(codes);
}

/** Byte order mark followed by the code units of `text`. */
export function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, littleEndian);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), littleEndian);
  return bytes;
}
