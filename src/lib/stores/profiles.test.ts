// The profile registry (plan §7.2, §7.4, AD-7, AD-11): what the status bar, the save
// dialog and `files.open` read off a profile, which filters reach a picker on which
// platform, and what happens to a profile that does not load.

import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createProfileRegistry } from './profiles';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { t } from '$lib/i18n';

const withFilters = createProfileRegistry({ filtersSupported: true });
const noFilters = createProfileRegistry({ filtersSupported: false });

const FANUC_EXTENSIONS = ['nc', 'tap', 'cnc', 'eia', 'iso', 'min', 'ncc', 'ptp', 'txt'];

/** A registry over hand-written sources, with the problems it reported. */
function registryOver(sources: readonly unknown[], defaultProfileId?: () => string) {
  const problems: string[] = [];
  const registry = createProfileRegistry({
    filtersSupported: true,
    sources,
    defaultProfileId,
    onProblem: (message) => problems.push(message),
  });
  return { registry, problems };
}

/** The built-in Fanuc profile, with one field changed. */
function fanucWith(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...(structuredClone(fanucJson) as unknown as Record<string, unknown>), ...patch };
}

describe('the profile list', () => {
  it('holds both P1 dialects with the default one first', () => {
    expect(withFilters.list().map((p) => p.id)).toEqual(['fanuc-gcode', 'heidenhain-klartext']);
    expect(withFilters.defaultId()).toBe('fanuc-gcode');
    expect(get(withFilters.all)).toEqual(withFilters.list());
  });

  it('describes a profile the way the status bar and Save As need it', () => {
    expect(withFilters.get('fanuc-gcode')).toEqual({
      id: 'fanuc-gcode',
      // The dialog-filter name, not the display name `Fanuc (ISO) mill`.
      name: 'Fanuc G-Code',
      shortName: 'Fanuc',
      extensions: FANUC_EXTENSIONS,
      defaultFileName: 'program.nc',
      newFileEol: 'crlf',
    });
    expect(withFilters.get('heidenhain-klartext')).toEqual({
      id: 'heidenhain-klartext',
      name: 'Heidenhain Klartext',
      shortName: 'Heidenhain',
      extensions: ['h'],
      defaultFileName: 'program.h',
      newFileEol: 'crlf',
    });
  });

  it('answers undefined for an unknown id', () => {
    expect(withFilters.get('siemens')).toBeUndefined();
  });

  it('hands out the profile and its compiled patterns', () => {
    expect(withFilters.profile('fanuc-gcode').name).toBe('Fanuc (ISO) mill');
    expect(withFilters.compiled('fanuc-gcode').profile).toBe(withFilters.profile('fanuc-gcode'));
    expect(withFilters.compiled('fanuc-gcode').re.toolTrigger.test('N10T1M6')).toBe(true);
    // The same objects every time: no profile is compiled twice.
    expect(withFilters.compiled('heidenhain-klartext')).toBe(withFilters.compiled('heidenhain-klartext'));
    expect(() => withFilters.profile('siemens')).toThrow('Unknown profile: siemens');
    expect(() => withFilters.compiled('siemens')).toThrow('Unknown profile: siemens');
  });
});

describe('the default profile', () => {
  it('follows the `files.defaultProfile` setting', () => {
    const both = createProfileRegistry({ filtersSupported: true, defaultProfileId: () => 'heidenhain-klartext' });
    expect(both.defaultId()).toBe('heidenhain-klartext');

    // A setting that names a profile this registry did not load falls back to the first.
    const { registry } = registryOver([fanucJson], () => 'heidenhain-klartext');
    expect(registry.defaultId()).toBe('fanuc-gcode');
  });

  it('ignores a setting that names a profile this build does not have', () => {
    const registry = createProfileRegistry({ filtersSupported: true, defaultProfileId: () => 'siemens-840d' });
    expect(registry.defaultId()).toBe('fanuc-gcode');
  });
});

describe('loading', () => {
  it('skips a profile that does not validate and says which field is wrong', () => {
    const { registry, problems } = registryOver([fanucWith({ id: 'broken', grammar: 'sinumerik' }), fanucJson]);
    expect(registry.list().map((p) => p.id)).toEqual(['fanuc-gcode']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('broken was not loaded');
    expect(problems[0]).toContain('grammar');
  });

  it('skips a profile whose pattern does not compile, with the JSON path', () => {
    const { registry, problems } = registryOver([fanucWith({ id: 'bad-pattern', program: { start: ['('], end: [] } })]);
    expect(registry.list()).toEqual([]);
    expect(problems[0]).toContain('program.start[0]');
  });

  it('keeps the first of two profiles with the same id', () => {
    const { registry, problems } = registryOver([fanucJson, fanucWith({ name: 'A copy' })]);
    expect(registry.list()).toHaveLength(1);
    expect(registry.profile('fanuc-gcode').name).toBe('Fanuc (ISO) mill');
    expect(problems[0]).toContain('the id is already taken');
  });

  it('names a profile that has no usable id at all', () => {
    const { problems } = registryOver([{ nothing: true }]);
    expect(problems[0]).toContain('profile #1 was not loaded');
  });

  it('still answers when every profile was skipped', () => {
    const { registry } = registryOver([{}]);
    expect(registry.list()).toEqual([]);
    expect(registry.defaultId()).toBe('fanuc-gcode');
    expect(registry.detect('/nc/a.h', '0 BEGIN PGM A MM', 'fanuc-gcode')).toBe('fanuc-gcode');
    expect(registry.openFilters()[0].extensions).toEqual([]);
  });
});

describe('detect', () => {
  const klartext = '0 BEGIN PGM TEST MM\n1 TOOL CALL 5 Z S2000\n2 END PGM TEST MM\n';
  const fanuc = '%\nO1234\nN10 G0 X0\nM30\n%\n';

  it('scores the extension together with the content (AD-11)', () => {
    expect(withFilters.detect('/nc/a.h', klartext, 'fanuc-gcode')).toBe('heidenhain-klartext');
    expect(withFilters.detect('/nc/a.nc', fanuc, 'heidenhain-klartext')).toBe('fanuc-gcode');
    expect(withFilters.detect('/nc/a.min', '', 'heidenhain-klartext')).toBe('fanuc-gcode');
  });

  // The M1 behaviour change: the extension is a weight, not a verdict. The full list of
  // results that moved is in `core/profiles/detect.test.ts`.
  it('lets clear content outvote the extension', () => {
    expect(withFilters.detect('/nc/a.nc', klartext, 'fanuc-gcode')).toBe('heidenhain-klartext');
    expect(withFilters.detect('/nc/a.h', fanuc, 'heidenhain-klartext')).toBe('fanuc-gcode');
  });

  it('sniffs the content for .txt and for a document with no path', () => {
    expect(withFilters.detect('/nc/a.txt', klartext, 'fanuc-gcode')).toBe('heidenhain-klartext');
    expect(withFilters.detect(null, klartext, 'fanuc-gcode')).toBe('heidenhain-klartext');
    expect(withFilters.detect(null, fanuc, 'heidenhain-klartext')).toBe('fanuc-gcode');
  });

  it('keeps the fallback when the content says nothing', () => {
    expect(withFilters.detect('/nc/a.txt', '', 'heidenhain-klartext')).toBe('heidenhain-klartext');
    expect(withFilters.detect(null, '\n\n', 'fanuc-gcode')).toBe('fanuc-gcode');
  });

  it('falls back to the default profile when the fallback is not a known id', () => {
    expect(withFilters.detect('/nc/a.txt', '', 'siemens')).toBe('fanuc-gcode');
  });
});

describe('dialog filters', () => {
  it('gives macOS none at all, so extension-less programs stay visible (F7)', () => {
    expect(noFilters.openFilters()).toEqual([]);
    expect(noFilters.saveFilters('fanuc-gcode')).toEqual([]);
  });

  it('offers one NC filter over every extension, plus All files', () => {
    expect(withFilters.openFilters()).toEqual([
      { name: t('profiles.filterNc'), extensions: [...FANUC_EXTENSIONS, 'h'] },
      { name: t('profiles.filterAll'), extensions: ['*'] },
    ]);
  });

  it('puts the document profile first when saving', () => {
    expect(withFilters.saveFilters('heidenhain-klartext')).toEqual([
      { name: 'Heidenhain Klartext', extensions: ['h'] },
      { name: 'Fanuc G-Code', extensions: FANUC_EXTENSIONS },
      { name: t('profiles.filterAll'), extensions: ['*'] },
    ]);
  });

  it('still lists every profile for an unknown id', () => {
    expect(withFilters.saveFilters('siemens').map((f) => f.name)).toEqual([
      'Fanuc G-Code',
      'Heidenhain Klartext',
      t('profiles.filterAll'),
    ]);
  });
});
