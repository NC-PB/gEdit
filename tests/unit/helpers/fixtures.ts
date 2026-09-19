// Access to tests/fixtures for unit tests, and the app's way of opening a file.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBytes, unsupportedContent, type DecodedText } from '$lib/utils/textCodec';

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

export type OpenedFixture = ({ refused: null } & DecodedText) | { refused: string };

/** Reads a fixture like the app's Open command: refused, or decoded to the editor text. */
export function openFixture(rel: string): OpenedFixture {
  const bytes = readFixture(rel);
  const refused = unsupportedContent(bytes);
  return refused ? { refused } : { refused: null, ...decodeBytes(bytes) };
}

/**
 * The text the program map sees. Monaco normalizes every line break of a loaded file
 * to LF or CRLF and the parser trims each line, so this equals LF-only text.
 */
export function editorText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
