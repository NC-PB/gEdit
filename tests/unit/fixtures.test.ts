// Checks the fixture files themselves: the generated ones still equal the generator
// output, the byte-level details that git or an editor could destroy are intact, and
// every file says it was written for gEdit and is listed in tests/fixtures/README.md.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEncodingFixtures } from '../gen/gen-encoding.mjs';
import { FIXTURES_DIR, listFixtures, readFixture } from './helpers/fixtures';

const count = (bytes: Uint8Array, byte: number) => bytes.reduce((n, b) => n + (b === byte ? 1 : 0), 0);

/** NUL bytes between the first and the last non-NUL byte. */
function innerNuls(bytes: Uint8Array): { nuls: number; length: number } {
  let start = 0;
  let end = bytes.length;
  while (start < end && bytes[start] === 0) start++;
  while (end > start && bytes[end - 1] === 0) end--;
  const inner = bytes.subarray(start, end);
  return { nuls: count(inner, 0), length: inner.length };
}

/** Text of a fixture good enough to read its first lines (ASCII comments). */
function roughText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return new TextDecoder('latin1').decode(bytes).replace(/^ï»¿/, '');
}

describe('encoding fixtures', () => {
  const generated = buildEncodingFixtures();

  it('are exactly the output of tests/gen/gen-encoding.mjs', () => {
    const names = [...generated.keys()].map((name) => `nc/encoding/${name}`).sort();
    expect(listFixtures('nc/encoding')).toEqual(names);
    for (const [name, bytes] of generated) {
      const committed = Buffer.from(readFixture(`nc/encoding/${name}`));
      expect(committed.equals(Buffer.from(bytes)), `${name} differs; run node tests/gen/gen-encoding.mjs`).toBe(true);
    }
  });

  it('cr-only.nc breaks lines with CR and contains no LF (0x0A)', () => {
    const bytes = readFixture('nc/encoding/cr-only.nc');
    expect(count(bytes, 0x0a)).toBe(0);
    expect(count(bytes, 0x0d)).toBe(13);
  });

  it('mixed-eol.nc mixes 10 CRLF, 2 LF and 1 CR', () => {
    const text = roughText(readFixture('nc/encoding/mixed-eol.nc'));
    expect(text.match(/\r\n/g)).toHaveLength(10);
    expect(text.match(/(?<!\r)\n/g)).toHaveLength(2);
    expect(text.match(/\r(?!\n)/g)).toHaveLength(1);
  });

  it('keep their byte order marks', () => {
    expect([...readFixture('nc/encoding/utf8-bom-crlf.nc').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect([...readFixture('nc/encoding/utf16le-bom.nc').subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect([...readFixture('nc/encoding/utf16be-bom.nc').subarray(0, 2)]).toEqual([0xfe, 0xff]);
    expect([...readFixture('nc/encoding/utf8-lf.nc').subarray(0, 1)]).toEqual([0x28]);
  });

  it('cp1252-crlf.nc is not valid UTF-8', () => {
    const decode = () => new TextDecoder('utf-8', { fatal: true }).decode(readFixture('nc/encoding/cp1252-crlf.nc'));
    expect(decode).toThrow();
  });

  it('put NUL bytes where their names say', () => {
    const leader = readFixture('nc/encoding/nul-leader-trailer.nc');
    expect([...leader.subarray(0, 40)].every((b) => b === 0)).toBe(true);
    expect([...leader.subarray(-40)].every((b) => b === 0)).toBe(true);
    expect(leader[40]).not.toBe(0);
    expect(innerNuls(leader).nuls).toBe(0);

    // The M1 codec strips inner NULs up to 10 % of the bytes and refuses more (AD-7).
    const inside = innerNuls(readFixture('nc/encoding/nul-inside.nc'));
    expect(inside.nuls).toBe(3);
    expect(inside.nuls / inside.length).toBeLessThan(0.1);
    const heavy = innerNuls(readFixture('nc/encoding/nul-heavy.bin'));
    expect(heavy.nuls / heavy.length).toBeGreaterThan(0.1);
  });
});

describe('hand-written fixtures', () => {
  const handWritten = listFixtures('nc').filter((rel) => !rel.startsWith('nc/encoding/'));
  const crlf = ['nc/fanuc/f01-mill-3tools.nc', 'nc/heidenhain/h01-3tools.h'];

  it.each(handWritten)('%s keeps its line endings', (rel) => {
    const text = roughText(readFixture(rel));
    if (crlf.includes(rel)) expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    else expect(text).not.toContain('\r');
    expect(text === '' || text.endsWith('\n')).toBe(true);
  });
});

describe('provenance', () => {
  const readme = readFileSync(join(FIXTURES_DIR, 'README.md'), 'utf8');

  it.each(listFixtures('nc'))('%s is marked as written for gEdit and listed in the README', (rel) => {
    expect(readme).toContain(`\`${rel.split('/').pop()}\``);
    const bytes = readFixture(rel);
    if (bytes.length === 0) return; // empty.txt has no room for a comment
    // First line, or the block after BEGIN PGM in Klartext programs.
    const head = roughText(bytes).replace(/^\0+/, '').split(/\r\n|\r|\n/, 2);
    expect(head.some((line) => /^(?:\d+ ; |; |\()WRITTEN FOR GEDIT\b/.test(line)), head.join(' | ')).toBe(true);
  });
});
