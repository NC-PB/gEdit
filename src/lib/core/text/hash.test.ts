// fnv1a32 (plan §7.2): the content half of a disk stamp.

import { describe, expect, it } from 'vitest';
import { fnv1a32 } from './hash';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('fnv1a32', () => {
  it('matches the published FNV-1a 32-bit test vectors', () => {
    expect(fnv1a32(new Uint8Array(0))).toBe(0x811c9dc5);
    expect(fnv1a32(bytes('a'))).toBe(0xe40c292c);
    expect(fnv1a32(bytes('foobar'))).toBe(0xbf9cf968);
  });

  it('is unsigned and fits in 32 bits', () => {
    for (const text of ['', 'a', 'foobar', 'G0 X0. Y0.\r\n', 'ÿþ\u0000']) {
      const hash = fnv1a32(bytes(text));
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('depends on the bytes, not on the array they sit in', () => {
    const whole = bytes('<<G1 Z-1. F200.>>');
    const part = whole.subarray(2, whole.length - 2);
    expect(fnv1a32(part)).toBe(fnv1a32(bytes('G1 Z-1. F200.')));
  });

  it('separates a changed byte, a swapped pair and a NUL', () => {
    const base = fnv1a32(bytes('M30'));
    expect(fnv1a32(bytes('M03'))).not.toBe(base);
    expect(fnv1a32(bytes('M31'))).not.toBe(base);
    expect(fnv1a32(new Uint8Array([0x4d, 0x33, 0x30, 0x00]))).not.toBe(base);
  });
});
