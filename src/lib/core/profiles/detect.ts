// Profile detection (plan §7.4, AD-11). Owner: WP3.1.
//
// It replaces the extension `switch` of the M0/M1 `utils/detectLanguage.ts`. The rules,
// in order:
//   1. A profile that lists a folder containing the file wins outright. This is what a
//      per-machine user profile (P2) is for: everything under `D:/CAM/mill3` is read with
//      that machine's profile, whatever the extension says.
//   2. Otherwise a profile scores its extension weight plus the content weights over the
//      first 400 non-empty lines. A line counts only for its **strongest** matching
//      pattern, so a file does not win on the same line twice.
//   3. The highest score wins; a tie goes to the higher `detect.priority`, then to
//      `fallback`, then to the first profile in registry order.
//   4. Nothing scored at all (an empty file, an unknown extension, no marker) keeps
//      `fallback` — the current or default profile.
//
// The behaviour change this brings over M1 is deliberate and is the answer to the open
// question in the P3 hand-off: the extension is a **weight**, not a verdict, so a
// Klartext program called `a.nc` is now read as Klartext. See `detect.test.ts` for the
// list of results that moved.
//
// A content pattern sees the line trimmed, which is what the M0 sniffer did and what the
// profiles are written for (`^\s*` in front of a rule is therefore redundant, not wrong).
//
// Cost: detection runs on every open, on files that can be 10 MB. It therefore never
// splits the whole text — it walks the first 400 non-empty lines and stops.

import type { CompiledProfile } from './types';

/** How many non-empty lines of a file are scored (the M0 limit, kept). */
export const MAX_SNIFF_LINES = 400;

/** The lower-case extension of `path`, without the dot; `''` when it has none. */
export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** A path with `\` turned into `/`, without a trailing separator, lower case. */
function normalizePath(path: string): string {
  const slashed = path.split('\\').join('/');
  const trimmed = slashed.length > 1 && slashed.endsWith('/') ? slashed.slice(0, -1) : slashed;
  return trimmed.toLowerCase();
}

/**
 * The first `max` non-empty lines of `text`, trimmed. It never splits the whole text:
 * detection runs on open, and a 10 MB program would otherwise be cut into a million
 * strings to look at 400 of them. Any of LF, CRLF and CR ends a line, because a caller
 * may hand over bytes that `decodeFile` has not normalized yet.
 */
function firstLines(text: string, max: number): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i <= text.length && lines.length < max; i++) {
    const c = text[i];
    if (i < text.length && c !== '\n' && c !== '\r') continue;
    const line = text.slice(start, i).trim();
    if (line !== '') lines.push(line);
    if (c === '\r' && text[i + 1] === '\n') i++;
    start = i + 1;
  }
  return lines;
}

/**
 * The profile whose `detect.folders` contains `path`, or `null`. The deepest folder wins,
 * so a machine folder inside a CAM root beats the root; the usual tie-break follows.
 */
function byFolder(profiles: CompiledProfile[], path: string): CompiledProfile | null {
  const file = normalizePath(path);
  let best: CompiledProfile | null = null;
  let bestLength = -1;

  for (const cp of profiles) {
    for (const folder of cp.profile.detect?.folders ?? []) {
      const prefix = normalizePath(folder);
      if (prefix === '' || !file.startsWith(`${prefix}/`)) continue;
      if (prefix.length > bestLength || (prefix.length === bestLength && best !== null && beats(cp, best))) {
        best = cp;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/** Tie-break between two equally scoring profiles: the higher `detect.priority` wins. */
function beats(candidate: CompiledProfile, current: CompiledProfile): boolean {
  return (candidate.profile.detect?.priority ?? 0) > (current.profile.detect?.priority ?? 0);
}

/** `detect.extensions[ext]`, or 0 when the profile does not claim that extension. */
function extensionWeight(cp: CompiledProfile, ext: string): number {
  if (ext === '') return 0;
  const weight = cp.profile.detect?.extensions?.[ext];
  return typeof weight === 'number' && Number.isFinite(weight) ? weight : 0;
}

/**
 * Picks the profile id for a file, or returns `fallback` when nothing scores.
 *
 * `profiles` is in registry order, which is the last tie-break. `path` is `null` for an
 * untitled buffer, which is then scored on its content alone. `fallback` is the document's
 * current profile, or the default one; it is returned as given, even when no profile in
 * the list carries that id (the registry normalizes it beforehand).
 */
export function detectProfile(
  profiles: CompiledProfile[],
  path: string | null,
  text: string,
  fallback: string,
): string {
  if (profiles.length === 0) return fallback;

  if (path !== null) {
    const folderMatch = byFolder(profiles, path);
    if (folderMatch) return folderMatch.profile.id;
  }

  const ext = path === null ? '' : extensionOf(path);
  const scores = profiles.map((cp) => extensionWeight(cp, ext));

  // Strongest pattern per line: the rules are tried in descending weight, and the first
  // one that matches ends the line for that profile.
  const rules = profiles.map((cp) => [...cp.re.detectContent].sort((a, b) => b.weight - a.weight));
  for (const line of firstLines(text, MAX_SNIFF_LINES)) {
    for (let i = 0; i < profiles.length; i++) {
      for (const rule of rules[i]) {
        if (rule.re.test(line)) {
          scores[i] += rule.weight;
          break;
        }
      }
    }
  }

  let bestIndex = -1;
  for (let i = 0; i < profiles.length; i++) {
    if (scores[i] <= 0) continue;
    if (bestIndex === -1 || scores[i] > scores[bestIndex]) {
      bestIndex = i;
      continue;
    }
    if (scores[i] < scores[bestIndex]) continue;
    // Equal scores: the higher priority wins, then the fallback profile, then the
    // registry order (which leaves `bestIndex` where it is).
    if (beats(profiles[i], profiles[bestIndex])) bestIndex = i;
    else if (
      !beats(profiles[bestIndex], profiles[i]) &&
      profiles[i].profile.id === fallback &&
      profiles[bestIndex].profile.id !== fallback
    ) {
      bestIndex = i;
    }
  }

  return bestIndex === -1 ? fallback : profiles[bestIndex].profile.id;
}
