// Bytes <-> editor text for opened and saved files (plan §7.2, AD-7).
// Pure: no Svelte, no Monaco, no Tauri.
//
// Supported encodings: UTF-8 with or without BOM, Windows-1252, and UTF-16 LE/BE with a
// BOM. A file that is valid UTF-8 is read as UTF-8; anything else as Windows-1252, which
// maps every byte to a character. NUL runs at the very start and end are the punched-tape
// leader and trailer: they are counted, kept out of the editor text, and written back
// unchanged. NULs inside the text are stripped (with a count) unless `stripNul` is false,
// and the file is refused as binary when they make up more than 10 % of the bytes between
// leader and trailer.
//
// `decodeFile` returns LF text, the way the document is held in memory; `encodeFile` joins
// it with the document's line ending again. A file therefore round trips byte for byte as
// long as its text was not edited, its line endings were not mixed and no NUL was stripped.

import type { DecodeResult, EncodeResult, Eol, FileEncoding, NulInfo } from '$lib/app/types';
import { encodeCp1252, decodeCp1252 } from './cp1252';
import { detectEol, EOL_BREAK_CHAR, joinEol, toLf } from './eol';
import { decodeUtf16, encodeUtf16, hasUtf16Bom } from './utf16';

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/** Above this share of NUL bytes between leader and trailer a file is data, not a program. */
const MAX_INNER_NUL_SHARE = 0.1;

/** i18n key of the refusal; the message itself belongs to the file feature (WP1.6). */
const BINARY_KEY = 'files.binaryRefused';

const NO_NUL: NulInfo = { leader: 0, trailer: 0, stripped: 0 };

// `fatal` makes an invalid sequence throw, which is how a non-UTF-8 file is recognised.
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const utf8Encoder = new TextEncoder();

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= UTF8_BOM.length && UTF8_BOM.every((b, i) => bytes[i] === b);
}

/** Number of NUL bytes in `bytes`. */
function countNul(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) n++;
  return n;
}

/** `bytes` without its NUL bytes. Only called when there is at least one. */
function withoutNul(bytes: Uint8Array, nuls: number): Uint8Array {
  const out = new Uint8Array(bytes.length - nuls);
  let at = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) out[at++] = bytes[i];
  return out;
}

/** Strict UTF-8 (BOM stripped and remembered), otherwise Windows-1252. */
function decodeNarrow(bytes: Uint8Array): { text: string; encoding: FileEncoding } {
  const hasBom = hasUtf8Bom(bytes);
  try {
    const text = utf8Decoder.decode(hasBom ? bytes.subarray(UTF8_BOM.length) : bytes);
    return { text, encoding: { encoding: 'utf-8', hasBom } };
  } catch {
    // Not valid UTF-8: typically Latin-1/Windows-1252 umlauts from CAM posts or controls.
    return { text: decodeCp1252(bytes), encoding: { encoding: 'windows-1252', hasBom: false } };
  }
}

/** The decoded text with its line endings measured and normalised to LF. */
function finish(text: string, encoding: FileEncoding, nul: NulInfo): DecodeResult {
  const { eol, mixed, counts } = detectEol(text);
  return { ok: true, text: toLf(text, counts), encoding, eol, eolMixed: mixed, nul };
}

/**
 * Reads file bytes into editor text. The result carries everything `encodeFile` needs to
 * write the same bytes back: the encoding, the line ending and the NUL leader/trailer.
 */
export function decodeFile(bytes: Uint8Array, o?: { stripNul?: boolean }): DecodeResult {
  // UTF-16 is all about NUL bytes, so it is settled before any of them is counted.
  if (hasUtf16Bom(bytes, true)) {
    return finish(decodeUtf16(bytes, true), { encoding: 'utf-16le', hasBom: true }, NO_NUL);
  }
  if (hasUtf16Bom(bytes, false)) {
    return finish(decodeUtf16(bytes, false), { encoding: 'utf-16be', hasBom: true }, NO_NUL);
  }

  let leader = 0;
  let end = bytes.length;
  while (leader < end && bytes[leader] === 0) leader++;
  while (end > leader && bytes[end - 1] === 0) end--;
  const trailer = bytes.length - end; // an all-NUL file is leader only: the first loop takes it all

  let core = bytes.subarray(leader, end);
  const inner = countNul(core);
  if (inner > core.length * MAX_INNER_NUL_SHARE) {
    // Rounded up, so a refused file never reports the 10 % that would still be allowed.
    const percent = Math.ceil((inner / core.length) * 100);
    return { ok: false, reason: 'binary', message: { key: BINARY_KEY, params: { percent } } };
  }

  const stripNul = o?.stripNul ?? true;
  let stripped = 0;
  if (inner > 0 && stripNul) {
    core = withoutNul(core, inner);
    stripped = inner;
  }

  const { text, encoding } = decodeNarrow(core);
  return finish(text, encoding, { leader, trailer, stripped });
}

/** UTF-16 is the one encoding that cannot carry a punched-tape leader; see `encodeFile`. */
export function keepsNulLeader(encoding: FileEncoding): boolean {
  return encoding.encoding !== 'utf-16le' && encoding.encoding !== 'utf-16be';
}

/**
 * Writes editor text back to file bytes: LF text joined with `eol`, encoded, and wrapped
 * in the NUL leader and trailer the file was read with. Never substitutes characters — if
 * Windows-1252 cannot store one, the first such character is reported with its 1-based
 * line and column instead of bytes.
 *
 * A UTF-16 file gets no leader and no trailer, whatever the document carries: the byte
 * order mark has to sit at offset 0 or nothing reads the file as UTF-16 — `decodeFile`
 * tests for the BOM before it counts NUL bytes (:78) and would answer `binary` for such a
 * file. The two can never legitimately coexist, because `decodeFile` returns `NO_NUL` for
 * every UTF-16 file; only a tape program whose encoding was switched by hand can ask for
 * both, and `fileOps.write()` then clears the leader on the document as well.
 */
export function encodeFile(
  textLF: string,
  m: { encoding: FileEncoding; eol: Eol; nul: Pick<NulInfo, 'leader' | 'trailer'> },
): EncodeResult {
  const joined = joinEol(textLF, m.eol);

  let body: Uint8Array;
  switch (m.encoding.encoding) {
    case 'windows-1252': {
      const encoded = encodeCp1252(joined, EOL_BREAK_CHAR[m.eol]);
      if (!encoded.ok) return encoded;
      body = encoded.bytes;
      break;
    }
    case 'utf-16le':
      body = encodeUtf16(joined, true);
      break;
    case 'utf-16be':
      body = encodeUtf16(joined, false);
      break;
    default:
      body = encodeUtf8(joined, m.encoding.hasBom);
  }

  if (!keepsNulLeader(m.encoding)) return { ok: true, bytes: body };
  const { leader, trailer } = m.nul;
  if (leader === 0 && trailer === 0) return { ok: true, bytes: body };
  const bytes = new Uint8Array(leader + body.length + trailer);
  bytes.set(body, leader); // the leader and trailer stay NUL, which is what a new array holds
  return { ok: true, bytes };
}

/** UTF-8 bytes of `text`, optionally with a byte order mark. */
export function encodeUtf8(text: string, hasBom = false): Uint8Array {
  const body = utf8Encoder.encode(text);
  if (!hasBom) return body;
  const bytes = new Uint8Array(UTF8_BOM.length + body.length);
  bytes.set(UTF8_BOM);
  bytes.set(body, UTF8_BOM.length);
  return bytes;
}

/** Status bar name of an encoding. */
export function encodingLabel({ encoding, hasBom }: FileEncoding): string {
  switch (encoding) {
    case 'windows-1252':
      return 'Windows-1252';
    case 'utf-16le':
      return 'UTF-16 LE';
    case 'utf-16be':
      return 'UTF-16 BE';
    default:
      return hasBom ? 'UTF-8 BOM' : 'UTF-8';
  }
}

/** "U+65E5" style code point of the first character of `char`. */
export function codePointLabel(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}
