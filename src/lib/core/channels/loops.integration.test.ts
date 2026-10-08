// NC-04 across both review batches: the loop lines (`computeJumpLines`, code batch) and the
// `count-not-checked` finding (check, NC batch) through the path `channels.check` takes.
// Removing either half makes these fail: without the loop lines the check reports a
// `count-mismatch` warning; without the new finding the loop is silently judged.

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { computeJumpLines } from '$lib/app/outlineService';
import { checkSyncMarksReport } from './check';
import { findMarks } from './marks';
import type { ChannelParams, SyncHit } from './types';

function preset(profile: string, id: string): ChannelParams {
  const raw = (BUILTIN_PROFILE_JSON as { id: string }[]).find((p) => p.id === profile) as unknown as { machineParams: { channels: { presets: { id: string; value: ChannelParams }[] } } };
  return JSON.parse(JSON.stringify(raw.machineParams.channels.presets.find((p) => p.id === id)!.value)) as ChannelParams;
}

function run(profile: string, presetId: string, files: Record<string, string[]>) {
  const cp = cpOf(profile);
  const p = preset(profile, presetId);
  const per: Record<string, SyncHit[]> = {};
  const jumpLines: Record<string, number[]> = {};
  for (const [ch, lines] of Object.entries(files)) {
    per[ch] = findMarks(lines, cp, p, { channelOf: () => ch }).marks;
    const found = computeJumpLines(lines, cp, () => ch)[ch];
    if (found) jumpLines[ch] = found;
  }
  const findings = checkSyncMarksReport(per, p, { jumpLines }).findings;
  return { jumpLines, kinds: findings.map((f) => f.kind) };
}

describe('loops around a wait are not counted (NC-04)', () => {
  it('Fanuc WHILE/DO/END against two written waits', () => {
    const r = run('fanuc-lathe', 'fanuc-2path', { '1': ['#1=0', 'WHILE[#1LT2]DO1', 'M901', '#1=#1+1', 'END1', 'M30'], '2': ['M901', 'M901', 'M30'] });
    expect(r.jumpLines['1']?.length).toBeGreaterThan(0);
    expect(r.kinds).toEqual(['count-not-checked']);
  });
  it('Fanuc IF..GOTO loop', () => {
    const r = run('fanuc-lathe', 'fanuc-2path', { '1': ['#1=0', 'N10 M901', '#1=#1+1', 'IF[#1LT2]GOTO10', 'M30'], '2': ['M901', 'M901', 'M30'] });
    expect(r.kinds).toEqual(['count-not-checked']);
  });
  it('Siemens REPEAT/UNTIL', () => {
    const r = run('sinumerik', 'sinumerik-2channel', { '1': ['N10 REPEAT', 'WAITM(1,1,2)', 'R1=R1+1', 'UNTIL R1>=2', 'M30'], '2': ['WAITM(1,1,2)', 'WAITM(1,1,2)', 'M30'] });
    expect(r.kinds).toEqual(['count-not-checked']);
  });
  it('a plain count difference without a loop is still a mismatch', () => {
    const r = run('fanuc-lathe', 'fanuc-2path', { '1': ['M901', 'M30'], '2': ['M901', 'M901', 'M30'] });
    expect(r.kinds).toContain('count-mismatch');
  });
});
