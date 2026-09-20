// The native dialogs (plan §7.2, AD-7): how a clicked button maps back to a decision,
// which filters reach the picker on which platform, and that only one dialog chain runs
// at a time.
//
// The plugin is injected, so nothing here needs a webview.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeDialogs, errorText, type DialogBackend } from './dialogs';
import { createProfileRegistry } from '$lib/stores/profiles';
import { t } from '$lib/i18n';
import type { NativeDialogs } from '$lib/app/types';

interface Recorded {
  call: 'open' | 'save' | 'message';
  message?: string;
  options: Record<string, unknown>;
}

function setup(o: { isTauri?: boolean; filtersSupported?: boolean; confirm?: boolean } = {}): {
  dialogs: NativeDialogs;
  recorded: Recorded[];
  answers: { open: unknown[]; save: (string | null)[]; message: (string | boolean)[] };
  confirmCalls: string[];
} {
  const recorded: Recorded[] = [];
  const answers: { open: unknown[]; save: (string | null)[]; message: (string | boolean)[] } = {
    open: [],
    save: [],
    message: [],
  };
  const confirmCalls: string[] = [];

  const backend = {
    async open(options?: Record<string, unknown>) {
      recorded.push({ call: 'open', options: options ?? {} });
      return answers.open.shift() ?? null;
    },
    async save(options?: Record<string, unknown>) {
      recorded.push({ call: 'save', options: options ?? {} });
      return answers.save.shift() ?? null;
    },
    async message(message: string, options?: Record<string, unknown>) {
      recorded.push({ call: 'message', message, options: options ?? {} });
      return answers.message.shift() ?? '';
    },
  } as unknown as DialogBackend;

  const dialogs = createNativeDialogs({
    backend,
    profiles: createProfileRegistry({ filtersSupported: o.filtersSupported ?? true }),
    isTauri: () => o.isTauri ?? true,
    confirmFallback: (message) => {
      confirmCalls.push(message);
      return o.confirm ?? false;
    },
  });
  return { dialogs, recorded, answers, confirmCalls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ask3', () => {
  const ask = { title: 'Unsaved', message: 'Save it?', yes: 'Save', no: "Don't Save", cancel: 'Cancel' };

  it('passes three custom buttons and maps the clicked label back', async () => {
    const { dialogs, recorded, answers } = setup();
    answers.message.push('Save');

    expect(await dialogs.ask3(ask)).toBe('yes');

    expect(recorded[0].message).toBe('Save it?');
    expect(recorded[0].options).toEqual({
      title: 'Unsaved',
      kind: 'warning',
      buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' },
    });
  });

  it.each([
    ["Don't Save", 'no'],
    ['Cancel', 'cancel'],
    ['', 'cancel'],
    ['something else', 'cancel'],
  ])('answers %s with %s', async (clicked, expected) => {
    const { dialogs, answers } = setup();
    answers.message.push(clicked);
    expect(await dialogs.ask3(ask)).toBe(expected);
  });

  it('counts a failed dialog as Cancel, the choice that changes nothing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = createNativeDialogs({
      backend: {
        open: async () => null,
        save: async () => null,
        message: async () => {
          throw new Error('no window');
        },
      } as unknown as DialogBackend,
      profiles: createProfileRegistry({ filtersSupported: true }),
      isTauri: () => true,
      confirmFallback: () => false,
    });
    expect(await failing.ask3(ask)).toBe('cancel');
    expect(await failing.confirm({ title: 'Encoding', message: 'π?', ok: 'Save as UTF-8' })).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('falls back to the browser confirm outside Tauri', async () => {
    const { dialogs, recorded, confirmCalls } = setup({ isTauri: false, confirm: true });
    expect(await dialogs.ask3(ask)).toBe('no'); // "discard", the way M0 mapped it
    expect(confirmCalls).toEqual(['Save it?']);
    expect(recorded).toEqual([]);
  });
});

describe('confirm', () => {
  it('uses an ok/cancel pair and answers true only for the ok label', async () => {
    const { dialogs, recorded, answers } = setup();
    answers.message.push('Save as UTF-8');

    expect(await dialogs.confirm({ title: 'Encoding', message: 'π?', ok: 'Save as UTF-8' })).toBe(true);

    expect(recorded[0].options).toEqual({
      title: 'Encoding',
      kind: 'warning',
      buttons: { ok: 'Save as UTF-8', cancel: t('common.cancel') },
    });
  });

  it('answers false for anything else', async () => {
    const { dialogs, answers } = setup();
    answers.message.push('Cancel');
    expect(await dialogs.confirm({ title: 'Encoding', message: 'π?', ok: 'Save as UTF-8' })).toBe(false);
  });
});

describe('error', () => {
  it('logs and shows the detail as a native error alert', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { dialogs, recorded } = setup();
    await dialogs.error('Could not save a.nc', new Error('permission denied'));
    expect(spy).toHaveBeenCalled();
    expect(recorded[0]).toEqual({
      call: 'message',
      message: 'permission denied',
      options: { title: 'Could not save a.nc', kind: 'error' },
    });
  });

  it('only logs outside Tauri', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { dialogs, recorded } = setup({ isTauri: false });
    await dialogs.error('boom', 'detail');
    expect(spy).toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });
});

describe('file pickers', () => {
  it('opens a multi-select without filters on macOS (F7)', async () => {
    const { dialogs, recorded, answers } = setup({ filtersSupported: false });
    answers.open.push(['/nc/a.nc', '/nc/b.h']);

    expect(await dialogs.openFiles()).toEqual(['/nc/a.nc', '/nc/b.h']);

    expect(recorded[0].options).toEqual({ title: t('files.openTitle'), multiple: true, directory: false });
    expect(recorded[0].options).not.toHaveProperty('filters');
  });

  it('carries the profile filters on Windows and Linux', async () => {
    const { dialogs, recorded, answers } = setup({ filtersSupported: true });
    answers.open.push([]);
    await dialogs.openFiles();
    const filters = recorded[0].options.filters as { name: string; extensions: string[] }[];
    expect(filters.map((f) => f.name)).toEqual([t('profiles.filterNc'), t('profiles.filterAll')]);
    expect(filters[0].extensions).toContain('nc');
    expect(filters[0].extensions).toContain('h');
  });

  it('wraps a single pick in an array and a cancelled one in an empty list', async () => {
    const { dialogs, answers } = setup();
    answers.open.push('/nc/a.nc');
    expect(await dialogs.openFiles({ multiple: false })).toEqual(['/nc/a.nc']);
    answers.open.push(null);
    expect(await dialogs.openFiles()).toEqual([]);
  });

  it('offers the document profile first in the save dialog', async () => {
    const { dialogs, recorded, answers } = setup({ filtersSupported: true });
    answers.save.push('/nc/copy.h');

    expect(await dialogs.saveFile({ defaultPath: '/nc/b.h', profileId: 'heidenhain-klartext' })).toBe('/nc/copy.h');

    const filters = recorded[0].options.filters as { name: string; extensions: string[] }[];
    expect(recorded[0].options.defaultPath).toBe('/nc/b.h');
    expect(filters[0].extensions).toContain('h');
    expect(filters.at(-1)?.name).toBe(t('profiles.filterAll'));
  });

  it('saves without filters on macOS', async () => {
    const { dialogs, recorded, answers } = setup({ filtersSupported: false });
    answers.save.push(null);
    await dialogs.saveFile({ defaultPath: 'program.nc', profileId: 'fanuc-gcode' });
    expect(recorded[0].options).toEqual({ title: t('files.saveAsTitle'), defaultPath: 'program.nc' });
  });

  it('answers cancelled outside Tauri instead of reaching for the plugin', async () => {
    const { dialogs, recorded } = setup({ isTauri: false });
    expect(await dialogs.openFiles()).toEqual([]);
    expect(await dialogs.saveFile({ defaultPath: 'a.nc' })).toBeNull();
    expect(await dialogs.pickFolder()).toBeNull();
    expect(await dialogs.pickFile()).toBeNull();
    expect(recorded).toEqual([]);
  });

  it('picks one folder and one file', async () => {
    const { dialogs, recorded, answers } = setup();
    answers.open.push('/nc');
    expect(await dialogs.pickFolder({ title: 'Scripts' })).toBe('/nc');
    expect(recorded[0].options).toEqual({ directory: true, multiple: false, title: 'Scripts' });
    answers.open.push('/nc/a.nc');
    expect(await dialogs.pickFile()).toBe('/nc/a.nc');
    expect(recorded[1].options).toEqual({ directory: false, multiple: false, title: undefined });
  });
});

describe('exclusive', () => {
  it('runs one chain at a time and answers undefined to a re-entrant call', async () => {
    const { dialogs } = setup();
    let release = (): void => {};
    const first = dialogs.exclusive(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('done');
        }),
    );

    expect(await dialogs.exclusive(async () => 'second')).toBeUndefined();
    release();
    expect(await first).toBe('done');

    // The lock is free again afterwards, including after a failure.
    expect(await dialogs.exclusive(async () => 'third')).toBe('third');
    await expect(dialogs.exclusive(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await dialogs.exclusive(async () => 'fourth')).toBe('fourth');
  });
});

describe('errorText', () => {
  it('reads a string, an Error and an object', () => {
    expect(errorText('plain')).toBe('plain');
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText({ code: 2 })).toBe('{"code":2}');
  });
});
