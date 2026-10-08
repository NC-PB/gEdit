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
const SIEMENS = ['sinumerik-2channel', 'sinumerik-2channel-archive', 'sinumerik-2channel-c', 'sinumerik-tagged'];
const GOLDEN: Record<string, string[]> = {
  'fanuc-lathe': [
    'fanuc-2path',
    'fanuc-2path-digits',
    'fanuc-3path-digits',
    'fanuc-3path-bitmask',
    // M12.5 (decision 3, §8.9): builders' variants seen in practice and the two-head guide.
    'fanuc-2path-nop',
    'fanuc-3path-digits-nop12',
    'fanuc-2head-m100',
  ],
  'okuma-osp': ['okuma-2turret'],
  sinumerik: SIEMENS,
  'sinumerik-mill': SIEMENS, // inherited through `extends`
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
    for (const id of SIEMENS) {
      expect(preset('sinumerik', id).syncMarks.map((r) => r.samePartners ?? false), id).toEqual([false, false, false]);
    }
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

  // --- M12.5 (decision 3; §8.9 corrected and extended; §7.16 #183) -------------------------

  it('M12.5: every M900-M999 preset says it is one builder’s range and where the machine’s range is set', () => {
    const fanuc = profileOf('fanuc-lathe').machineParams?.channels?.presets ?? [];
    const ranged = fanuc.filter((p) => p.value.syncMarks.some((r) => r.match.kind === 'codes' && /M900-M999/.test(r.match.codes)));
    expect(ranged.map((p) => p.id)).toEqual(['fanuc-2path', 'fanuc-2path-digits', 'fanuc-3path-digits', 'fanuc-3path-bitmask', 'fanuc-2path-nop']);
    for (const p of ranged) expect(p.label, p.id).toMatch(/M900-M999[^(]*\(one builder's range; your machine's range is parameters 8110\/8111\)/);
    // The builder variant M190-M199 says the same of its range.
    expect(fanuc.find((p) => p.id === 'fanuc-3path-digits-nop12')?.label).toMatch(/M190-M199 \(one builder's range/);
  });

  it('M12.5: fanuc-2path-nop — no file-name rule, waits without P are paths 1 and 2, a P names path numbers', () => {
    const p = preset('fanuc-lathe', 'fanuc-2path-nop');
    expect(p.layout).toBe('multi-file');
    expect(p.fileName).toBeUndefined();
    expect(siblingNames('O1000', p, '1')).toBeNull();
    const marks = findMarks(['M999', 'N80 M990', 'M993 P12', 'M30'], cpOf('fanuc-lathe'), p, { channelOf: () => '1' }).marks;
    expect(marks.map((m) => [m.mark, m.partners, m.absent ?? false])).toEqual([
      ['M999', ['1', '2'], true],
      ['M990', ['1', '2'], true],
      ['M993', ['1', '2'], false],
    ]);
  });

  it('M12.5: fanuc-3path-digits-nop12 — a P-less wait pairs paths 1 and 2 where the shipped three-path preset finds no partner', () => {
    const p = preset('fanuc-lathe', 'fanuc-3path-digits-nop12');
    const cp = cpOf('fanuc-lathe');
    expect(p.list.map((c) => c.id)).toEqual(['1', '2', '3']);
    const lines = ['M198', 'M191 P123', 'M192 P13', 'M199', 'M920'];
    expect(findMarks(lines, cp, p, { channelOf: () => '1' }).marks.map((m) => [m.mark, m.partners])).toEqual([
      ['M198', ['1', '2']],
      ['M191', ['1', '2', '3']],
      ['M192', ['1', '3']],
      ['M199', ['1', '2']],
    ]);
    // The reason for the variant: the shipped three-path rule with the same codes reads M198 with no partner (unmatched).
    const shipped = preset('fanuc-lathe', 'fanuc-3path-digits');
    const asShipped = { ...shipped, syncMarks: shipped.syncMarks.map((r) => ({ ...r, match: { kind: 'codes' as const, codes: 'M190-M199' } })) };
    expect(findMarks(['M198'], cp, asShipped, { channelOf: () => '1' }).marks.map((m) => m.partners)).toEqual([[]]);
    // The file names: `<stem>_<n>.<ext>`; the label warns that a version file is caught the same way.
    expect(siblingNames('PART_2.ISO', p)?.map((s) => s.name)).toEqual(['PART_1.ISO', 'PART_3.ISO']);
    expect(siblingNames('SHAFT_2.NC', p)?.map((s) => s.channel.id)).toEqual(['1', '3']);
    expect(siblingNames('PART.ISO', p)).toBeNull();
    expect(profileOf('fanuc-lathe').machineParams?.channels?.presets.find((x) => x.id === 'fanuc-3path-digits-nop12')?.label).toMatch(/version file/);
  });

  it('M12.5: fanuc-2head-m100 — M100 to M197 are waits for both heads, M198 is not one, and the label says why', () => {
    const p = preset('fanuc-lathe', 'fanuc-2head-m100');
    expect(p.fileName).toBeUndefined();
    const marks = findMarks(['M100', 'N20 M150', 'M197', 'M198 P1234', 'M199', 'M99'], cpOf('fanuc-lathe'), p, { channelOf: () => '2' }).marks;
    expect(marks.map((m) => [m.mark, m.partners])).toEqual([
      ['M100', ['1', '2']],
      ['M150', ['1', '2']],
      ['M197', ['1', '2']],
    ]);
    expect(profileOf('fanuc-lathe').machineParams?.channels?.presets.find((x) => x.id === 'fanuc-2head-m100')?.label).toMatch(
      /M198 calls a program on an external device and is no wait/,
    );
  });

  it('M12.5: the three Siemens layouts carry exactly the rules of sinumerik-2channel', () => {
    const base = preset('sinumerik', 'sinumerik-2channel');
    for (const id of ['sinumerik-2channel-archive', 'sinumerik-2channel-c', 'sinumerik-tagged']) {
      const p = preset('sinumerik', id);
      expect(p.syncMarks, id).toEqual(base.syncMarks);
      expect(p.list, id).toEqual(base.list);
      expect(p.stopsAndEndsWait, id).toBe(false);
    }
  });

  it('M12.5: sinumerik-2channel-archive — the %_N_<n>_0_MPF sections are the channels, the other archive sections none', () => {
    const p = preset('sinumerik', 'sinumerik-2channel-archive');
    const lines = ['%_N_1_0_MPF', 'WAITM(1,1,2)', 'M30', '%_N_1_7_MPF', '$TC_DP3[1,1]=150', '%_N_2_0_MPF', 'WAITM(1,1,2)', 'M30', '%_N_2_7_MPF', '$TC_DP3[1,1]=90'];
    const found = findSections(lines, compileProfile(profileOf('sinumerik')), p);
    expect(found.sections.map((s) => [s.channel.id, s.ranges.map((r) => [r.startLine, r.endLine])])).toEqual([
      ['1', [[1, 4]]],
      ['2', [[6, 9]]],
    ]);
    expect(found.problems).toEqual([]);
    // A longer name is no section start.
    expect(findSections(['%_N_1_0_MPFX', 'M30'], compileProfile(profileOf('sinumerik')), p).sections).toEqual([]);
  });

  it('M12.5: sinumerik-2channel-c — <stem>_C<n>.MPF ties a file to its channel and names its sibling', () => {
    const p = preset('sinumerik', 'sinumerik-2channel-c');
    expect(siblingNames('PART_C1.MPF', p)?.map((s) => [s.channel.id, s.name])).toEqual([['2', 'PART_C2.MPF']]);
    expect(siblingNames('PART_1.MPF', p)).toBeNull();
  });

  it('M12.5: sinumerik-tagged — <PROG_BEGIN_C<n>> starts a channel, <PROG_END_ ends it, other tags are no channel', () => {
    const p = preset('sinumerik', 'sinumerik-tagged');
    const lines = ['<PROG_BEGIN_C1>', 'WAITM(1,1,2)', 'M30', '<PROG_END_C1>', '<PROG_BEGIN_REZ>', 'R1=1', '<PROG_END_REZ>', '<PROG_BEGIN_C2>', 'WAITM(1,1,2)', '<PROG_END_C2>'];
    const found = findSections(lines, compileProfile(profileOf('sinumerik')), p);
    expect(found.sections.map((s) => [s.channel.id, s.ranges.map((r) => [r.startLine, r.endLine])])).toEqual([
      ['1', [[1, 4]]],
      ['2', [[8, 10]]],
    ]);
  });
});
