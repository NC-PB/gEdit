// The detection margin table (gate G10 for every change to a `detect` block; plan §6 M12.5).
//
// For each committed NC fixture: the profile detection picks, its score, the runner-up and
// the margin over it, and the **family margin** — the margin over the best profile of
// another grammar (`Profile.grammar`: iso, klartext, okuma, sinumerik). The family margin is
// what the "dialect uncertain" signal reads (§7.18); the plain margin is what tells a mill
// from a lathe of the same control. A detection work package prints the table before and
// after its change (`GEDIT_MARGIN_TABLE=<file> npx vitest run tests/unit/detectMargins.test.ts`)
// and the reviewer reads the two side by side.
//
// Only synthetic fixtures and the owner-public set are read; the owner's local programs
// (`tests/real/`) are G11's and never printed here.

import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectProfile, detectScores } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { listFixtures, openFixture } from './fixtures';

/** The folders the table covers, relative to `tests/fixtures`. */
export const MARGIN_FOLDERS = ['nc', 'channels/nc'] as const;

export interface MarginRow {
  /** Relative to `tests/fixtures`. */
  file: string;
  detected: string;
  score: number;
  runnerUp: string;
  runnerUpScore: number;
  margin: number;
  /** The best profile of another grammar, and the margin over it. */
  rival: string;
  rivalScore: number;
  familyMargin: number;
}

/** The built-ins, through the same gate the registry uses. */
export function builtinProfiles(): CompiledProfile[] {
  return BUILTIN_PROFILE_JSON.map((raw) => {
    const checked = validateProfile(raw);
    if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
    return compileProfile(checked.profile);
  });
}

/** One row per fixture that opens (refused files and files no profile scores are left out). */
export function marginRows(profiles: CompiledProfile[] = builtinProfiles()): MarginRow[] {
  const rows: MarginRow[] = [];
  for (const folder of MARGIN_FOLDERS) {
    for (const file of listFixtures(folder)) {
      if (file.endsWith('.json') || file.endsWith('.md')) continue;
      const opened = openFixture(file);
      if (opened.refused !== null) continue;
      const path = `/work/${file.split('/').pop() ?? file}`;
      const scores = detectScores(profiles, path, opened.text);
      const detected = detectProfile(profiles, path, opened.text, profiles[0].profile.id);
      const index = profiles.findIndex((cp) => cp.profile.id === detected);
      if (index === -1 || scores[index] <= 0) continue;
      const grammar = profiles[index].profile.grammar;
      let runnerUp = -1;
      let rival = -1;
      profiles.forEach((cp, i) => {
        if (i === index) return;
        if (runnerUp === -1 || scores[i] > scores[runnerUp]) runnerUp = i;
        if (cp.profile.grammar !== grammar && (rival === -1 || scores[i] > scores[rival])) rival = i;
      });
      rows.push({
        file,
        detected,
        score: scores[index],
        runnerUp: runnerUp === -1 ? '' : profiles[runnerUp].profile.id,
        runnerUpScore: runnerUp === -1 ? 0 : scores[runnerUp],
        margin: scores[index] - (runnerUp === -1 ? 0 : scores[runnerUp]),
        rival: rival === -1 ? '' : profiles[rival].profile.id,
        rivalScore: rival === -1 ? 0 : scores[rival],
        familyMargin: scores[index] - (rival === -1 ? 0 : scores[rival]),
      });
    }
  }
  return rows;
}

/** The table as Markdown, one row per fixture, then the minimum and median per profile. */
export function marginTable(rows: MarginRow[]): string {
  const out = [
    '| Fixture | Detected | Score | Runner-up | Margin | Other-grammar rival | Family margin |',
    '|---|---|---:|---|---:|---|---:|',
  ];
  for (const r of rows) {
    out.push(
      `| ${r.file} | ${r.detected} | ${r.score} | ${r.runnerUp} (${r.runnerUpScore}) | ${r.margin} | ${r.rival} (${r.rivalScore}) | ${r.familyMargin} |`,
    );
  }
  out.push('', '| Detected | Files | Margin min | Margin median | Family margin min | Family margin median |', '|---|---:|---:|---:|---:|---:|');
  const by = new Map<string, MarginRow[]>();
  for (const r of rows) by.set(r.detected, [...(by.get(r.detected) ?? []), r]);
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length === 0 ? 0 : s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  for (const [id, list] of [...by.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const m = list.map((r) => r.margin);
    const f = list.map((r) => r.familyMargin);
    out.push(`| ${id} | ${list.length} | ${Math.min(...m)} | ${median(m)} | ${Math.min(...f)} | ${median(f)} |`);
  }
  return out.join('\n') + '\n';
}
