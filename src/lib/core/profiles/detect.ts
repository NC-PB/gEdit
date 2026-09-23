// Profile detection (plan §7.4, AD-11) and variant detection (§7.1, AD-31).
// Owner: WP3.1, and WP6.1 for the variants.
//
// It replaces the extension `switch` of the M0/M1 `utils/detectLanguage.ts`. The rules,
// in order:
//   1. A profile that lists a folder containing the file wins outright. This is what a
//      per-machine user profile (P2) is for: everything under `D:/CAM/mill3` is read with
//      that machine's profile, whatever the extension says.
//   2. Otherwise a profile scores its extension weight plus the content weights over the
//      first 400 non-empty lines. A line counts only for its **strongest** matching
//      pattern, so a file does not win on the same line twice.
//   3. The highest score wins; a tie goes to the higher `detect.priority`, then to a user
//      profile over a built-in (M6: a user who writes a profile for his own posts means
//      it to win over the one we shipped), then to `fallback`, then to the first profile
//      in registry order.
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

import { maskComments } from '$lib/core/nc/mask';
import type { CompiledProfile, MachineParamsDecl, Pattern, VariantDecl } from './types';

/** How many non-empty lines of a file are scored (the M0 limit, kept). */
export const MAX_SNIFF_LINES = 400;

/** Where a profile came from, for the tie-break (M6; the registry knows, a profile does not). */
export type ProfileOrigin = 'builtin' | 'user';

/** What `detectProfile` cannot read off a compiled profile. */
export interface DetectOptions {
  /** The origin of a profile; everything is a built-in when this is not given. */
  origin?: (cp: CompiledProfile) => ProfileOrigin;
}

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
function byFolder(profiles: CompiledProfile[], path: string, rank: Rank): CompiledProfile | null {
  const file = normalizePath(path);
  let best: CompiledProfile | null = null;
  let bestLength = -1;

  for (const cp of profiles) {
    for (const folder of cp.profile.detect?.folders ?? []) {
      const prefix = normalizePath(folder);
      if (prefix === '' || !file.startsWith(`${prefix}/`)) continue;
      if (prefix.length > bestLength || (prefix.length === bestLength && best !== null && beats(cp, best, rank))) {
        best = cp;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/** How a profile ranks in a tie: its `detect.priority` first, then user over built-in. */
type Rank = (cp: CompiledProfile) => [number, number];

function rankWith(o: DetectOptions | undefined): Rank {
  return (cp) => [cp.profile.detect?.priority ?? 0, o?.origin?.(cp) === 'user' ? 1 : 0];
}

/**
 * Tie-break between two equally scoring profiles: the higher `detect.priority` wins, then
 * a user profile over a built-in one. `fallback` and the registry order follow at the call
 * site, where they are known.
 */
function beats(candidate: CompiledProfile, current: CompiledProfile, rank: Rank): boolean {
  const [priority, origin] = rank(candidate);
  const [theirPriority, theirOrigin] = rank(current);
  if (priority !== theirPriority) return priority > theirPriority;
  return origin > theirOrigin;
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
  o?: DetectOptions,
): string {
  if (profiles.length === 0) return fallback;
  const rank = rankWith(o);

  if (path !== null) {
    const folderMatch = byFolder(profiles, path, rank);
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
    // Equal scores: the higher priority wins, then a user profile, then the fallback
    // profile, then the registry order (which leaves `bestIndex` where it is).
    if (beats(profiles[i], profiles[bestIndex], rank)) bestIndex = i;
    else if (
      !beats(profiles[bestIndex], profiles[i], rank) &&
      profiles[i].profile.id === fallback &&
      profiles[bestIndex].profile.id !== fallback
    ) {
      bestIndex = i;
    }
  }

  return bestIndex === -1 ? fallback : profiles[bestIndex].profile.id;
}

// ---------------------------------------------------------------------------
// Variant detection (M6, §7.1, AD-31)
// ---------------------------------------------------------------------------

/**
 * How sure a variant has to be before anything acts on it: the winning choice has to
 * score this much more than the runner-up (§7.15, AD-31).
 *
 * It is a **margin**, not a score, because both choices of a variant describe the same
 * control: a program that carries markers of both is a program we cannot read, and the
 * honest answer there is the variant's documented default, not the one that was ahead by
 * a point.
 */
export const VARIANT_MARGIN = 3;

/** One choice's rules, compiled once per profile. */
interface ChoiceRules {
  value: string;
  rules: { re: RegExp; weight: number }[];
}

interface VariantRules {
  id: string;
  fallback: string;
  choices: ChoiceRules[];
}

/** Built once per compiled profile: detection runs on every open, on files of 10 MB. */
const VARIANTS = new WeakMap<CompiledProfile, VariantRules[]>();

function declOf(cp: CompiledProfile): MachineParamsDecl | undefined {
  const decl = cp.profile.machineParams;
  return typeof decl === 'object' && decl !== null ? (decl as MachineParamsDecl) : undefined;
}

/**
 * The declared variants with their patterns compiled.
 *
 * A pattern that does not compile is left out instead of throwing: the validator has
 * already reported it with its JSON path, and detection is not the place to find out
 * about it a second time — with a broken rule the variant simply keeps its default.
 */
function variantRules(cp: CompiledProfile): VariantRules[] {
  const ready = VARIANTS.get(cp);
  if (ready) return ready;

  const out: VariantRules[] = [];
  const declared = declOf(cp)?.variants;
  for (const variant of Array.isArray(declared) ? (declared as VariantDecl[]) : []) {
    if (typeof variant?.id !== 'string' || variant.id === '') continue;
    const fallback = typeof variant.default === 'string' ? variant.default : '';
    const choices: ChoiceRules[] = [];
    for (const choice of Array.isArray(variant.choices) ? variant.choices : []) {
      if (typeof choice?.value !== 'string' || choice.value === '') continue;
      const rules: { re: RegExp; weight: number }[] = [];
      for (const rule of Array.isArray(choice.detect) ? choice.detect : []) {
        const source: Pattern | undefined = rule?.pattern;
        const weight = rule?.weight;
        if (typeof source !== 'string' || typeof weight !== 'number' || !Number.isFinite(weight)) continue;
        try {
          rules.push({ re: new RegExp(source, cp.flags), weight });
        } catch {
          // Reported by `validateProfile`; a rule that cannot run scores nothing.
        }
      }
      choices.push({ value: choice.value, rules });
    }
    if (choices.length > 0) out.push({ id: variant.id, fallback, choices });
  }

  VARIANTS.set(cp, out);
  return out;
}

/**
 * The choice each declared variant's rules make for this text, with the margin over the
 * runner-up (§7.1, §7.15). An empty answer for a profile that declares no variant.
 *
 * `value` is the choice that scored highest, and `margin` is how far ahead of the next one
 * it is; the caller acts on it only from [`VARIANT_MARGIN`] on and otherwise keeps the
 * variant's default (`effectiveMachine`, AD-31). Where nothing scored at all, the answer
 * is the variant's default with a margin of 0.
 *
 * **Each pattern scores its weight once, for the whole file** — this is the one place where
 * the rule differs from profile detection (P1 rule 2, per line). A post writes its cycle
 * return mode into every drilling block, so a G-code system B program can carry sixty
 * lines that also match a system-A rule; counting them per line would let a formatting
 * habit outvote the single `G92 S` clamp that actually says which system this is. Presence
 * makes one decisive marker worth more than sixty incidental ones, which is how a person
 * reads the program too.
 *
 * Comments are masked first: `(G99 PER REV)` in a header is a note, not a marker.
 */
export function detectVariants(
  cp: CompiledProfile,
  text: string,
): Record<string, { value: string; margin: number }> {
  const variants = variantRules(cp);
  const out: Record<string, { value: string; margin: number }> = {};
  if (variants.length === 0) return out;

  /** variant → choice → score so far. */
  const scores = variants.map((variant) => variant.choices.map(() => 0));
  /** Every rule that has not matched yet; when none is left, no further line can change anything. */
  let open = variants.reduce((sum, variant) => sum + variant.choices.reduce((n, c) => n + c.rules.length, 0), 0);
  const matched = variants.map((variant) => variant.choices.map((choice) => choice.rules.map(() => false)));

  if (open > 0) {
    for (const line of firstLines(text, MAX_SNIFF_LINES)) {
      const masked = maskComments(line, cp).trim();
      if (masked === '') continue;
      for (let v = 0; v < variants.length; v++) {
        const choices = variants[v].choices;
        for (let c = 0; c < choices.length; c++) {
          const rules = choices[c].rules;
          for (let r = 0; r < rules.length; r++) {
            if (matched[v][c][r] || !rules[r].re.test(masked)) continue;
            matched[v][c][r] = true;
            scores[v][c] += rules[r].weight;
            open--;
          }
        }
      }
      if (open === 0) break;
    }
  }

  variants.forEach((variant, v) => {
    let best = -1;
    let runnerUp = 0;
    variant.choices.forEach((choice, c) => {
      const score = scores[v][c];
      // A tie keeps the choice that is ahead already, and the variant's default wins one
      // against a choice that scored the same: "not sure" is not a reason to move.
      const ahead = best === -1 || score > scores[v][best] || (score === scores[v][best] && choice.value === variant.fallback);
      if (ahead) {
        if (best !== -1) runnerUp = Math.max(runnerUp, scores[v][best]);
        best = c;
      } else {
        runnerUp = Math.max(runnerUp, score);
      }
    });
    const top = best === -1 ? 0 : scores[v][best];
    const winner = best === -1 || top === 0 ? variant.fallback : variant.choices[best].value;
    out[variant.id] = { value: winner, margin: top === 0 ? 0 : top - runnerUp };
  });

  return out;
}
