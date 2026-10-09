// The assistant contribution's providers per profile id (plan §5 WP3.6; M13 WP13.2, AD-29):
// one hover and one completion provider per profile id, once, also for an id that a reload of
// the user's profiles adds after activation.

import { afterEach, describe, expect, it, vi } from 'vitest';

const hover = vi.fn((_monaco: unknown, id: string) => () => hoverDisposed.push(id));
const completion = vi.fn((_monaco: unknown, id: string) => () => completionDisposed.push(id));
const hoverDisposed: string[] = [];
const completionDisposed: string[] = [];

vi.mock('$lib/monaco/providers/hover', () => ({ registerHover: (m: unknown, id: string) => hover(m, id) }));
vi.mock('$lib/monaco/providers/completion', () => ({ registerCompletion: (m: unknown, id: string) => completion(m, id) }));
vi.mock('$lib/monaco/setup', () => ({ getMonaco: () => Promise.resolve({ fake: true }) }));
vi.mock('$lib/monaco/editorService', () => ({ editor: { updateOptions: () => {}, ready: Promise.resolve() } }));

import assistant from './assistant';
import { profiles } from '$lib/stores/profiles';

/** Lets the activation's async part (`editor.ready`, `getMonaco()`) finish. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  profiles.reload([]);
  hover.mockClear();
  completion.mockClear();
  hoverDisposed.length = 0;
  completionDisposed.length = 0;
});

describe('the providers of the assistant', () => {
  it('registers a hover and a completion provider for every profile', async () => {
    const stop = assistant.activate();
    await settle();
    const ids = profiles.list().map((p) => p.id);
    expect(hover.mock.calls.map((call) => call[1])).toEqual(ids);
    expect(completion.mock.calls.map((call) => call[1])).toEqual(ids);
    stop();
  });

  it('gives a profile id that a reload adds its providers, once', async () => {
    const stop = assistant.activate();
    await settle();
    const before = hover.mock.calls.length;
    const file = { name: 'shop.json', text: JSON.stringify({ id: 'shop', name: 'Shop', shortName: 'Shop', extends: 'fanuc-gcode' }) };

    profiles.reload([file]);
    expect(hover.mock.calls.slice(before).map((call) => call[1])).toEqual(['shop']);
    expect(completion.mock.calls.at(-1)?.[1]).toBe('shop');

    // The same id again, and the id gone and back: nothing more.
    profiles.reload([file]);
    profiles.reload([]);
    profiles.reload([file]);
    expect(hover.mock.calls.filter((call) => call[1] === 'shop')).toHaveLength(1);
    stop();
  });

  it('disposes everything, the providers of a late id included, and listens no more', async () => {
    const stop = assistant.activate();
    await settle();
    profiles.reload([{ name: 'shop.json', text: JSON.stringify({ id: 'shop', name: 'Shop', shortName: 'Shop', extends: 'fanuc-gcode' }) }]);
    stop();
    expect(hoverDisposed).toContain('shop');
    expect(completionDisposed).toContain('shop');
    const calls = hover.mock.calls.length;
    profiles.reload([{ name: 'other.json', text: JSON.stringify({ id: 'other', name: 'Other', shortName: 'Other', extends: 'fanuc-gcode' }) }]);
    expect(hover.mock.calls).toHaveLength(calls);
  });
});
