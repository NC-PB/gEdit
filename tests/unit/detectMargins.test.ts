// The detection margin table (G10, plan §6 M12.5). With `GEDIT_MARGIN_TABLE=<file>` set it
// writes the table there; without it, it only checks that the table can be built over the
// committed fixtures. It also pins the M12.5 contract that `detectResult` answers the same
// profile as `detectProfile` (§7.16 #177).

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectProfile, detectResult } from '$lib/core/profiles/detect';
import { builtinProfiles, MARGIN_FOLDERS, marginRows, marginTable } from './helpers/margins';
import { listFixtures, openFixture } from './helpers/fixtures';

describe('the detection margin table', () => {
  it('covers the committed fixtures and, on request, writes the table', () => {
    const rows = marginRows();
    expect(rows.length).toBeGreaterThan(50);
    for (const row of rows) {
      expect(row.margin).toBeGreaterThanOrEqual(0);
      expect(row.familyMargin).toBeGreaterThanOrEqual(row.margin);
    }
    const out = process.env.GEDIT_MARGIN_TABLE;
    if (out) writeFileSync(out, marginTable(rows));
  });

  it('detectResult answers the profile detectProfile answers, on every fixture', () => {
    const profiles = builtinProfiles();
    const fallback = profiles[0].profile.id;
    for (const folder of MARGIN_FOLDERS) {
      for (const file of listFixtures(folder)) {
        const opened = openFixture(file);
        if (opened.refused !== null) continue;
        const path = `/work/${file.split('/').pop() ?? file}`;
        const result = detectResult(profiles, path, opened.text, fallback);
        expect(result.id, file).toBe(detectProfile(profiles, path, opened.text, fallback));
        expect(result.familyMargin, file).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
