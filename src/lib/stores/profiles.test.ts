// The M1 profile registry (plan §7.2, AD-7, AD-11): what the status bar, the save dialog
// and `files.open` read off a dialect, and which filters reach a picker on which platform.

import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createProfileRegistry } from './profiles';
import { t } from '$lib/i18n';

const withFilters = createProfileRegistry({ filtersSupported: true });
const noFilters = createProfileRegistry({ filtersSupported: false });

describe('the profile list', () => {
  it('holds both P1 dialects with the default one first', () => {
    expect(withFilters.list().map((p) => p.id)).toEqual(['fanuc-gcode', 'heidenhain-klartext']);
    expect(withFilters.defaultId()).toBe('fanuc-gcode');
    expect(get(withFilters.all)).toEqual(withFilters.list());
  });

  it('describes a profile the way the status bar and Save As need it', () => {
    expect(withFilters.get('fanuc-gcode')).toEqual({
      id: 'fanuc-gcode',
      name: 'Fanuc G-Code',
      shortName: 'Fanuc',
      extensions: ['nc', 'txt', 'min'],
      defaultFileName: 'program.nc',
      newFileEol: 'crlf',
    });
    expect(withFilters.get('heidenhain-klartext')?.shortName).toBe('Heidenhain');
    expect(withFilters.get('heidenhain-klartext')?.defaultFileName).toBe('program.h');
  });

  it('answers undefined for an unknown id', () => {
    expect(withFilters.get('siemens')).toBeUndefined();
  });
});

describe('detect', () => {
  const klartext = '0 BEGIN PGM TEST MM\n1 TOOL CALL 5 Z S2000\n2 END PGM TEST MM\n';
  const fanuc = '%\nO1234\nN10 G0 X0\nM30\n%\n';

  it('trusts a specific extension over the content', () => {
    expect(withFilters.detect('/nc/a.h', fanuc, 'fanuc-gcode')).toBe('heidenhain-klartext');
    expect(withFilters.detect('/nc/a.nc', klartext, 'heidenhain-klartext')).toBe('fanuc-gcode');
    expect(withFilters.detect('/nc/a.min', '', 'heidenhain-klartext')).toBe('fanuc-gcode');
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
      { name: t('profiles.filterNc'), extensions: ['nc', 'txt', 'min', 'h'] },
      { name: t('profiles.filterAll'), extensions: ['*'] },
    ]);
  });

  it('puts the document profile first when saving', () => {
    expect(withFilters.saveFilters('heidenhain-klartext')).toEqual([
      { name: 'Heidenhain Klartext', extensions: ['h', 'txt'] },
      { name: 'Fanuc G-Code', extensions: ['nc', 'txt', 'min'] },
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

describe('the M3 half', () => {
  it('has no compiled profiles yet', () => {
    expect(() => withFilters.profile('fanuc-gcode')).toThrow('not implemented: M3');
    expect(() => withFilters.compiled('fanuc-gcode')).toThrow('not implemented: M3');
  });
});
