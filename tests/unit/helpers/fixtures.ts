// Access to tests/fixtures for unit tests, and the app's way of opening a file.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFile } from '$lib/core/text';
import type { Eol, FileEncoding, NulInfo } from '$lib/app/types';

export const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/', import.meta.url));

/** Paths relative to tests/fixtures ('nc/fanuc/f01-mill-3tools.nc') of every file below `subdir`, sorted. */
export function listFixtures(subdir: string): string[] {
  const entries = readdirSync(join(FIXTURES_DIR, subdir), { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(FIXTURES_DIR.length).split('\\').join('/'))
    .sort();
}

export function readFixture(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, rel)));
}

/** What a fixture looks like once opened; `refused` carries the i18n key of the refusal. */
export type OpenedFixture =
  | {
      refused: null;
      /** Editor text: LF endings, BOM and NUL leader/trailer removed (see `decodeFile`). */
      text: string;
      encoding: FileEncoding;
      eol: Eol | null;
      eolMixed: boolean;
      nul: NulInfo;
    }
  | { refused: string };

/**
 * Reads a fixture the way the app's Open command does, through the production decoder
 * (`$lib/core/text`, plan §7.2/AD-7): refused, or decoded to the editor text.
 *
 * I2: this used to call the pre-M1 `utils/textCodec` shim, which refused UTF-16 and any
 * inner NUL. That shim is gone, so the characterization baselines below now describe the
 * decoder the app actually ships.
 */
export function openFixture(rel: string): OpenedFixture {
  const result = decodeFile(readFixture(rel));
  if (!result.ok) return { refused: result.message.key };
  const { text, encoding, eol, eolMixed, nul } = result;
  return { refused: null, text, encoding, eol, eolMixed, nul };
}

/**
 * The text the program map sees. `decodeFile` already normalizes every line break to LF,
 * so this is a no-op guard for fixture text and only does work for hand-written strings.
 */
export function editorText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
