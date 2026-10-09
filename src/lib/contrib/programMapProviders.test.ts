// The symbol and folding providers of the program map, per profile id (M13 WP13.2, AD-29):
// once for each id, also for an id that a reload of the user's profiles adds after activation.

import { afterEach, describe, expect, it, vi } from 'vitest';

const symbols = vi.fn((_monaco: unknown, id: string) => () => disposed.push(`symbols:${id}`));
const folding = vi.fn((_monaco: unknown, id: string) => () => disposed.push(`folding:${id}`));
const disposed: string[] = [];

vi.mock('$lib/monaco/providers/symbols', () => ({ registerSymbols: (m: unknown, id: string) => symbols(m, id) }));
vi.mock('$lib/monaco/providers/folding', () => ({ registerFolding: (m: unknown, id: string) => folding(m, id) }));
vi.mock('$lib/monaco/setup', () => ({ getMonaco: () => Promise.resolve({ fake: true }) }));
vi.mock('$lib/app/outlineService', () => ({ outline: { start: () => () => {} } }));

import programMap from './programMap';
import { profiles } from '$lib/stores/profiles';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const file = { name: 'shop.json', text: JSON.stringify({ id: 'shop', name: 'Shop', shortName: 'Shop', extends: 'fanuc-gcode' }) };

afterEach(() => {
  profiles.reload([]);
  symbols.mockClear();
  folding.mockClear();
  disposed.length = 0;
});

describe('the providers of the program map', () => {
  it('registers symbols and folding for every profile', async () => {
    const stop = programMap.activate();
    await settle();
    const ids = profiles.list().map((p) => p.id);
    expect(symbols.mock.calls.map((call) => call[1])).toEqual(ids);
    expect(folding.mock.calls.map((call) => call[1])).toEqual(ids);
    stop();
  });

  it('gives a profile id that a reload adds its providers, once', async () => {
    const stop = programMap.activate();
    await settle();
    profiles.reload([file]);
    profiles.reload([file]);
    profiles.reload([]);
    profiles.reload([file]);
    expect(symbols.mock.calls.filter((call) => call[1] === 'shop')).toHaveLength(1);
    expect(folding.mock.calls.filter((call) => call[1] === 'shop')).toHaveLength(1);
    stop();
  });

  it('disposes the providers of a late id and listens no more', async () => {
    const stop = programMap.activate();
    await settle();
    profiles.reload([file]);
    stop();
    expect(disposed).toContain('symbols:shop');
    expect(disposed).toContain('folding:shop');
    const calls = symbols.mock.calls.length;
    profiles.reload([{ ...file, name: 'o.json', text: JSON.stringify({ id: 'o', name: 'O', shortName: 'O', extends: 'fanuc-gcode' }) }]);
    expect(symbols.mock.calls).toHaveLength(calls);
  });
});
