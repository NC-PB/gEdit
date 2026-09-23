// The code database service (plan §7.3, WP3.3): profile → dialect → database, caching,
// and what happens when a database is missing or broken.

import { describe, expect, it, vi } from 'vitest';
import { codes as service, createCodeDbService } from './codes';
import { profiles } from './profiles';
import type { NcToken } from '$lib/core/nc/types';

function word(address: string, valueText: string): NcToken {
  return { kind: 'word', start: 0, end: 0, text: address + valueText, address, valueText };
}

describe('the built-in code database service', () => {
  it('answers for both P1 profiles', () => {
    expect(service.forProfile('fanuc-gcode').dialect).toBe('fanuc');
    expect(service.forProfile('heidenhain-klartext').dialect).toBe('heidenhain');
  });

  // The merge wired `dialectOf` to the registry, so a profile names its database in one
  // place. A user profile (P2) resolves through the same path once the registry loads it.
  it('takes the dialect from the profile registry, not from a copy', () => {
    for (const info of profiles.list()) {
      expect(service.forProfile(info.id).dialect).toBe(profiles.profile(info.id).codes);
    }
  });

  it('hands out the same database object twice, so the lookup index is built once', () => {
    expect(service.forProfile('fanuc-gcode')).toBe(service.forProfile('fanuc-gcode'));
  });

  it('answers with an empty database for a profile it does not know', () => {
    const db = service.forProfile('okuma-osp');
    expect(db.codes).toEqual([]);
    expect(db.addresses).toEqual({});
  });

  it('looks a word up through the profile', () => {
    expect(service.lookupWord('fanuc-gcode', word('G', '83'))?.entry?.label).toBe(
      'Peck drilling cycle',
    );
    expect(service.lookupWord('okuma-osp', word('G', '83'))).toEqual({ entry: null, unknown: true });
  });

  it('completes through the profile', () => {
    expect(service.completions('fanuc-gcode', 'G8', false)).toHaveLength(10);
    expect(service.completions('heidenhain-klartext', 'CYCL DEF 2', true).length).toBeGreaterThan(0);
    expect(service.completions('okuma-osp', 'G', true)).toEqual([]);
  });

  it('hands the flat list to the script context', () => {
    const list = service.forScripts('fanuc-gcode');
    expect(list).toBe(service.forProfile('fanuc-gcode').codes);
    expect(list.length).toBeGreaterThan(50);
  });

  // M6, AD-17: a child database is written as the difference to its parent, so what the
  // service serves has to be the **resolved** one — otherwise a lathe document would find
  // four codes and call everything else unknown.
  it('serves a child database with its parent merged in', () => {
    const lathe = service.forProfile('fanuc-lathe');
    expect(lathe.dialect).toBe('fanuc-lathe');
    // I6: `G28` is inherited word for word, while `G83` is a **face** drilling cycle on a
    // lathe and the child overrides it — so the inherited entry is the one that proves the
    // merge, and the overridden one proves the child still wins.
    expect(lathe.codes.find((entry) => entry.code === 'G28')?.label).toBe('Return to the reference point');
    expect(lathe.codes.find((entry) => entry.code === 'G83')?.label).toBe('Drilling cycle on the face');
    expect(lathe.codes.length).toBeGreaterThan(50);
    expect(Object.keys(lathe.addresses).length).toBeGreaterThan(5);
  });

  it('serves a variant database by its own id, for a machine that switches to it', () => {
    const b = service.byId('fanuc-lathe-b');
    expect(b.dialect).toBe('fanuc-lathe-b');
    expect(b.codes.find((entry) => entry.code === 'G95')?.group).toBe('feedmode');
    // The same object every time; an empty id is the "no database" answer.
    expect(service.byId('fanuc-lathe-b')).toBe(b);
    expect(service.byId('')).toEqual({ dialect: '', version: 0, addresses: {}, codes: [] });
  });

  it('looks up and completes an inherited code through the child profile', () => {
    expect(service.lookupWord('fanuc-lathe', word('G', '28'))?.entry?.label).toBe('Return to the reference point');
    expect(service.completions('fanuc-lathe', 'G8', false).length).toBeGreaterThan(0);
  });
});

describe('createCodeDbService', () => {
  const db = {
    dialect: 'demo',
    version: 1,
    addresses: { X: { label: 'X axis' } },
    codes: [{ code: 'G0', label: 'Rapid' }],
  };

  it('loads a dialect once and caches it', () => {
    const source = vi.fn(() => db);
    const svc = createCodeDbService({ dialectOf: () => 'demo', source, warn: () => {} });
    expect(svc.forProfile('a')).toBe(svc.forProfile('b'));
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('falls back to an empty database and warns when the file is missing', () => {
    const warn = vi.fn();
    const svc = createCodeDbService({ dialectOf: () => 'gone', source: () => undefined, warn });
    expect(svc.forProfile('a').codes).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/gone/);
  });

  it('falls back to an empty database and warns when the file is not a database', () => {
    const warn = vi.fn();
    const svc = createCodeDbService({ dialectOf: () => 'bad', source: () => 42, warn });
    expect(svc.forProfile('a').codes).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the good part of a database and reports the rest', () => {
    const warn = vi.fn();
    const svc = createCodeDbService({
      dialectOf: () => 'partly',
      source: () => ({ dialect: 'partly', version: 1, codes: [{ code: 'G0', label: 'Rapid' }, {}] }),
      warn,
    });
    expect(svc.forProfile('a').codes.map((e) => e.code)).toEqual(['G0']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/codes\[1\]/);
  });
});
