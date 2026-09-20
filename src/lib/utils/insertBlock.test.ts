// The block lookup behind `insert.block:<id>` (plan §5 WP1.5).

import { describe, expect, it } from 'vitest';
import { allBlockIds, blockFor, blocksFor } from './insertBlock';

describe('blocksFor', () => {
  it('lists a profile blocks in JSON order', () => {
    expect(blocksFor('fanuc-gcode').map(([id]) => id)).toEqual(['start', 'example', 'drill']);
  });

  it('is empty for a profile that has none', () => {
    expect(blocksFor('no-such-profile')).toEqual([]);
    expect(blocksFor('')).toEqual([]);
  });
});

describe('blockFor', () => {
  it('returns the block of that profile, not another one', () => {
    expect(blockFor('fanuc-gcode', 'start')?.TextBlock).toContain('O1000');
    expect(blockFor('heidenhain-klartext', 'start')?.TextBlock).toContain('BEGIN PGM');
  });

  it('returns null for an unknown profile or block', () => {
    expect(blockFor('fanuc-gcode', 'nope')).toBeNull();
    expect(blockFor('nope', 'start')).toBeNull();
  });
});

describe('allBlockIds', () => {
  it('is the union over the profiles, without duplicates', () => {
    const ids = allBlockIds();
    expect(ids).toContain('start');
    expect(new Set(ids).size).toBe(ids.length);
    for (const profile of ['fanuc-gcode', 'heidenhain-klartext']) {
      for (const [id] of blocksFor(profile)) expect(ids, `${profile}/${id}`).toContain(id);
    }
  });
});
