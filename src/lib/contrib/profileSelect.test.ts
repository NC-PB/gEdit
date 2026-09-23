// How the dialect picker offers the profiles (plan §5 WP6.1, §7.3, AD-16).
//
// The names themselves are data (contrib README rule 3); what is tested here is the
// grouping around them, which is the app's: a lathe profile that extends a mill one is the
// same control, and the picker has to show it as one family instead of two entries whose
// relationship the user has to guess.

import { describe, expect, it } from 'vitest';
import { pickerEntries } from './profileSelect';
import type { ProfileInfo } from '$lib/app/types';

/** A `ProfileInfo` with only the members the picker reads. */
function info(id: string, parent: string | null = null): ProfileInfo {
  return {
    id,
    name: `${id} files`,
    shortName: id,
    extensions: ['nc'],
    defaultFileName: 'program.nc',
    newFileEol: 'crlf',
    machineType: 'mill',
    origin: 'builtin',
    parent,
    file: null,
    chain: parent === null ? [id] : [id, parent],
    hasMachineParams: false,
  };
}

/** The names of the built-ins, as `Profile.name` gives them. */
const NAMES: Record<string, string> = {
  'fanuc-gcode': 'Fanuc (ISO) mill',
  'fanuc-lathe': 'Fanuc (ISO) lathe',
  'heidenhain-klartext': 'Heidenhain Klartext',
};

const nameOf = (id: string): string => NAMES[id] ?? id;

describe('the picker entries', () => {
  it('offer a family under the part of the name it shares', () => {
    const entries = pickerEntries(
      [info('fanuc-gcode'), info('fanuc-lathe', 'fanuc-gcode'), info('heidenhain-klartext')],
      nameOf,
    );
    expect(entries).toEqual([
      { id: 'fanuc-gcode', label: 'Fanuc (ISO) · mill' },
      { id: 'fanuc-lathe', label: 'Fanuc (ISO) · lathe' },
      { id: 'heidenhain-klartext', label: 'Heidenhain Klartext' },
    ]);
  });

  it('put a child right after its parent, wherever it was declared', () => {
    const entries = pickerEntries(
      [info('fanuc-gcode'), info('heidenhain-klartext'), info('fanuc-lathe', 'fanuc-gcode')],
      nameOf,
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'fanuc-gcode',
      'fanuc-lathe',
      'heidenhain-klartext',
    ]);
  });

  it('keep a whole line together, a grandchild included (M12 user profiles)', () => {
    const names: Record<string, string> = {
      'fanuc-gcode': 'Fanuc (ISO) mill',
      'fanuc-lathe': 'Fanuc (ISO) lathe',
      mine: 'Fanuc (ISO) lathe 2',
    };
    const entries = pickerEntries(
      [info('fanuc-gcode'), info('heidenhain-klartext'), info('mine', 'fanuc-lathe'), info('fanuc-lathe', 'fanuc-gcode')],
      (id) => names[id] ?? NAMES[id],
    );
    expect(entries).toEqual([
      { id: 'fanuc-gcode', label: 'Fanuc (ISO) · mill' },
      { id: 'fanuc-lathe', label: 'Fanuc (ISO) · lathe' },
      { id: 'mine', label: 'Fanuc (ISO) · lathe 2' },
      { id: 'heidenhain-klartext', label: 'Heidenhain Klartext' },
    ]);
  });

  it('leave a profile with no relatives exactly as it is called', () => {
    expect(pickerEntries([info('heidenhain-klartext')], nameOf)).toEqual([
      { id: 'heidenhain-klartext', label: 'Heidenhain Klartext' },
    ]);
  });

  it('name the family after what every member of it shares', () => {
    const names: Record<string, string> = {
      a: 'Maker 900 mill',
      b: 'Maker 900 lathe',
      c: 'Maker 900 grinder',
    };
    const entries = pickerEntries([info('a'), info('b', 'a'), info('c', 'a')], (id) => names[id]);
    expect(entries.map((entry) => entry.label)).toEqual([
      'Maker 900 · mill',
      'Maker 900 · lathe',
      'Maker 900 · grinder',
    ]);
  });

  it('write both names out when they share nothing, or one is inside the other', () => {
    const names: Record<string, string> = { a: 'Fanuc', b: 'Fanuc lathe', c: 'Something else' };
    // "Fanuc" and "Fanuc lathe": there is no part left to call the parent by.
    expect(pickerEntries([info('a'), info('b', 'a')], (id) => names[id]).map((e) => e.label)).toEqual([
      'Fanuc',
      'Fanuc lathe',
    ]);
    expect(pickerEntries([info('a'), info('c', 'a')], (id) => names[id]).map((e) => e.label)).toEqual([
      'Fanuc',
      'Something else',
    ]);
  });

  it('list a child whose parent this build does not have, and one that names itself', () => {
    const entries = pickerEntries([info('orphan', 'gone'), info('self', 'self')], (id) => id);
    expect(entries.map((entry) => entry.id)).toEqual(['orphan', 'self']);
  });

  it('list a cycle between two user profiles rather than losing them', () => {
    const entries = pickerEntries([info('a', 'b'), info('b', 'a')], (id) => id);
    expect(entries.map((entry) => entry.id).sort()).toEqual(['a', 'b']);
  });

  it('answer nothing when nothing loaded', () => {
    expect(pickerEntries([], nameOf)).toEqual([]);
  });
});
