// The channel presets of the built-in profiles (plan §8.9, the G10 table; AD-32; the owner's
// decisions of 2026-10-07, §10.1). Written by the M12 prelude (P12). A preset is a starting
// point a user picks on the machine page, never applied without a machine; every one is a
// documented default with its source and `verify: true` until the owner confirms it (D64).
// A change here is a change of §8.9 first.

import { describe, expect, it } from 'vitest';
import { findMarks } from '$lib/core/channels/marks';
import { findSections } from '$lib/core/channels/resolve';
import { siblingNames } from '$lib/core/channels/siblings';
import { parseWaitCodes } from '$lib/core/channels/codes';
import type { ChannelParams } from '$lib/core/channels/types';
import { channelBlock, validateChannels } from '$lib/core/machines/validate';
import { patternSubsetProblem } from '$lib/core/profiles/validate';
import { compileProfile } from '$lib/core/profiles/compile';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';
import { BUILTIN_PROFILE_JSON } from './index';

/** §8.9: profile → its preset ids, in order; every other profile declares none. */
const GOLDEN: Record<string, string[]> = {
  'fanuc-lathe': ['fanuc-2path', 'fanuc-2path-digits', 'fanuc-3path-digits', 'fanuc-3path-bitmask'],
  'okuma-osp': ['okuma-2turret'],
  sinumerik: ['sinumerik-2channel'],
  'sinumerik-mill': ['sinumerik-2channel'], // inherited through `extends`
};

const ids = BUILTIN_PROFILE_JSON.map((p) => (p as { id: string }).id);

function preset(profile: string, id: string): ChannelParams {
  const found = profileOf(profile).machineParams?.channels?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profile}: no preset ${id}`);
  return found.value;
}

/** Every pattern string of a block, with where it stands. */
function patterns(p: ChannelParams): [string, string][] {
  const out: [string, string][] = [];
  for (const key of ['sectionStart', 'sectionEnd', 'fileName', 'marker'] as const) {
    const v = p[key];
    if (typeof v === 'string') out.push([key, v]);
  }
  p.syncMarks.forEach((r, i) => {
    if (r.match.kind === 'regex') out.push([`syncMarks[${i}].match.pattern`, r.match.pattern]);
    if (r.partners.kind === 'line') out.push([`syncMarks[${i}].partners.pattern`, r.partners.pattern]);
  });
  return out;
}

describe('channel presets (§8.9)', () => {
  it('are declared by exactly the profiles of the table', () => {
    const declared = Object.fromEntries(
      ids.map((id) => [id, profileOf(id).machineParams?.channels?.presets.map((p) => p.id) ?? []]).filter(([, list]) => list.length > 0),
    );
    expect(declared).toEqual(GOLDEN);
  });

  it('are all documented defaults: a source, verify, and no layout none', () => {
    for (const [profile, list] of Object.entries(GOLDEN)) {
      for (const p of profileOf(profile).machineParams?.channels?.presets ?? []) {
        expect(p.verify, `${profile}/${p.id}`).toBe(true);
        expect(p.source, `${profile}/${p.id}`).toMatch(/\S/);
        expect(p.value.layout, `${profile}/${p.id}`).not.toBe('none');
        expect(list).toContain(p.id);
      }
    }
  });

  it('have patterns that compile, stay in the AD-11 subset and are at most 1,000 characters', () => {
    for (const [profile, list] of Object.entries(GOLDEN)) {
      for (const id of list) {
        for (const [where, source] of patterns(preset(profile, id))) {
          expect(() => new RegExp(source, 'i'), `${profile}/${id} ${where}`).not.toThrow();
          expect(patternSubsetProblem(source), `${profile}/${id} ${where}`).toBeNull();
          expect(source.length).toBeLessThanOrEqual(1000);
        }
      }
    }
  });

  it('have wait-code lists the control’s letters accept', () => {
    for (const [profile, list] of Object.entries(GOLDEN)) {
      const letters = profileOf(profile).machineParams?.channels?.waitLetters;
      for (const id of list) {
        for (const rule of preset(profile, id).syncMarks) {
          if (rule.match.kind !== 'codes') continue;
          expect(parseWaitCodes(rule.match.codes, { letters }).errors, `${profile}/${id}/${rule.id}`).toEqual([]);
        }
      }
    }
  });

  it('every preset validates clean (WP12.3), as a block and as a stored machine', () => {
    for (const [profile, list] of Object.entries(GOLDEN)) {
      const letters = profileOf(profile).machineParams?.channels?.waitLetters;
      for (const id of list) {
        const value = preset(profile, id);
        expect(validateChannels(value, 'value', null, { waitLetters: letters }), `${profile}/${id}`).toEqual([]);
        const machine = { id: 'm', name: 'M', profile, params: { channels: value } };
        expect(channelBlock(machine, 'machines[0]', { waitLetters: letters }).state, `${profile}/${id}`).toBe('valid');
      }
    }
  });

  it('Fanuc: a three-path set by the extension, digit P words, and a P-less wait with no partner', () => {
    const p = preset('fanuc-lathe', 'fanuc-3path-digits');
    expect(siblingNames('PART.NC2', p)?.map((s) => s.name)).toEqual(['PART.NC1', 'PART.NC3']);
    const marks = findMarks(['N10 M901 P123', 'N20M902P12', 'M903', 'M130 P12', '(M904 P12)'], cpOf('fanuc-lathe'), p, {
      channelOf: () => '2',
    }).marks;
    expect(marks.map((m) => [m.mark, m.partners])).toEqual([
      ['M901', ['1', '2', '3']],
      ['M902', ['1', '2']],
      ['M903', []],
    ]);
    const two = preset('fanuc-lathe', 'fanuc-2path');
    expect(findMarks(['M901', 'M902 P3'], cpOf('fanuc-lathe'), two, { channelOf: () => '1' }).marks.map((m) => m.partners)).toEqual([
      ['1', '2'],
      ['1', '2'],
    ]);
  });

  it('M12 review fix NC-01: every Fanuc preset compares the whole partner set (alarm 0160); Siemens does not', () => {
    for (const id of GOLDEN['fanuc-lathe']) {
      expect(preset('fanuc-lathe', id).syncMarks.map((r) => r.samePartners), id).toEqual([true]);
    }
    expect(preset('sinumerik', 'sinumerik-2channel').syncMarks.map((r) => r.samePartners ?? false)).toEqual([false, false, false]);
  });

  it('M12 review fix NC-02: SETM answers, CLEARM does not, both non-blocking', () => {
    const p = preset('sinumerik', 'sinumerik-2channel');
    expect(p.syncMarks.map((r) => [r.id, r.blocking ?? true, r.answers ?? false])).toEqual([
      ['waitm', true, false],
      ['setm', false, true],
      ['clearm', false, false],
    ]);
  });

  it('M12 review fix NC-11: the Siemens label says where SETM and CLEARM are reached', () => {
    expect(profileOf('sinumerik').machineParams?.channels?.presets.find((x) => x.id === 'sinumerik-2channel')?.label).toMatch(
      /Next\/Previous Sync Point and not listed in the map/,
    );
  });

  it('M12 review fix NC-13: a two-path preset with digit P words and P-less waits for paths 1 and 2', () => {
    const p = preset('fanuc-lathe', 'fanuc-2path-digits');
    const marks = findMarks(['M901 P12', 'M902', 'M903 P3'], cpOf('fanuc-lathe'), p, { channelOf: () => '1' }).marks;
    expect(marks.map((m) => [m.mark, m.partners, m.absent ?? false])).toEqual([
      ['M901', ['1', '2'], false],
      ['M902', ['1', '2'], true],
      ['M903', ['3'], false],
    ]);
  });

  it('Okuma: alternating G13/G14 sections, ordered P codes and an M100 count', () => {
    const p = preset('okuma-osp', 'okuma-2turret');
    const cp = cpOf('okuma-osp');
    const lines = ['$A.MIN%', 'G13', 'G0 X500 P10', 'M100', 'G14', 'G0 X100 P10', 'M100', 'G13', 'P20', 'G14', 'P30', 'M02'];
    const sections = findSections(lines, cp, p);
    expect(sections.sections.map((s) => [s.channel.id, s.ranges.map((r) => [r.startLine, r.endLine])])).toEqual([
      ['a', [[2, 4], [8, 9]]],
      ['b', [[5, 7], [10, 12]]],
    ]);
    const marks = findMarks(lines, cp, p, { channelOf: () => 'a' }).marks;
    expect(marks.map((m) => [m.ruleId, m.mark, m.line])).toEqual([
      ['p-code', 'P10', 3],
      ['m100', '', 4],
      ['p-code', 'P10', 6],
      ['m100', '', 7],
      ['p-code', 'P20', 9],
      ['p-code', 'P30', 11],
    ]);
  });

  it('Okuma: G013 and G014 start the sections the way G13 and G14 do (the control reads leading zeros)', () => {
    const p = preset('okuma-osp', 'okuma-2turret');
    const cp = compileProfile(profileOf('okuma-osp'));
    const plain = findSections(['G13', 'M100', 'G14', 'M100'], cp, p);
    const zeros = findSections(['G013', 'M100', 'G014', 'M100'], cp, p);
    expect(zeros.sections.map((s) => [s.channel.id, s.ranges])).toEqual(plain.sections.map((s) => [s.channel.id, s.ranges]));
    expect(zeros.problems).toEqual([]);
    // G130 and G13.1 are other codes, not turret selections.
    expect(findSections(['G130', 'G13.1'], cp, p).sections).toEqual([]);
  });

  it('Sinumerik: WAITM with numbered partners; SETM shown, not blocking; WAITE not a mark', () => {
    const p = preset('sinumerik', 'sinumerik-2channel');
    const marks = findMarks(['N10 WAITM(1,1,2)', 'SETM(5)', 'WAITE(2)', 'WAITMC(7, 2)'], compileProfile(profileOf('sinumerik')), p, {
      channelOf: () => '1',
    }).marks;
    expect(marks.map((m) => [m.ruleId, m.mark, m.partners, m.blocking])).toEqual([
      ['waitm', '1', ['1', '2'], true],
      ['setm', '5', ['1', '2'], false],
      ['waitm', '7', ['2'], true],
    ]);
  });
});
