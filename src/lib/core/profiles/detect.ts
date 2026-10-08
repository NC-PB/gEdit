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
//      profile over a built-in (M6: a user who writes a profile for their own posts means
//      it to win over the one we shipped), then to `fallback`, then to the first profile
//      in registry order.
//   4. Nothing scored at all (an empty file, an unknown extension, no marker) keeps
//      `fallback` — the current or default profile.
//   5. A profile one of whose `detect.vetoes` matches a scanned line scores nothing for
//      that file (M9 NC review F3): the Siemens milling profile is out as soon as a program
//      writes a turning word, so a mill-turn program stays a turning program however many
//      of its operations mill (R2). Folders (rule 1) are not vetoed: they are the user's
//      own choice.
//
// The behaviour change this brings over M1 is deliberate and is the answer to the open
// question in the P3 hand-off: the extension is a **weight**, not a verdict, so a
// Klartext program called `a.nc` is now read as Klartext. See `detect.test.ts` for the
// list of results that moved.
//
// R1 (the source review of 2026-09) made detection unable to wreck a program on its own:
// a header is decisive (`DECISIVE_WEIGHT`), certain syntax outweighs a page of shared lines
// (`CERTAIN_WEIGHT`), and an extension is a tie-breaker, not a verdict (Okuma's `.MIN`
// weighs 20 now, so a Fanuc mill program saved as `.MIN` stays a mill). What detection
// still gets wrong, or what the user chooses by hand against the text, is caught before a
// rewrite by `contradiction.ts`.
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

/**
 * The weight of a **decisive** header (R1): the Okuma `$NAME.MIN%` line, the Sinumerik
 * `%_N_…_MPF` and `;$PATH=` lines, a Klartext `BEGIN PGM` block. A header is written by
 * one control only, so it decides the way a folder does — unless the content contradicts
 * it **hard**, which in this scoring means: another dialect's header, or so many lines of
 * another dialect's certain syntax (rules of [`CERTAIN_WEIGHT`] or more) that they add up
 * past this weight on their own — 250 lines at 20, 50 at 100, 13 Okuma machining-centre
 * offsets at 400. A page of ordinary lines never does: every rule below
 * `CERTAIN_WEIGHT` scores at most 8 a line, and 400 lines of that stay under 5000
 * (`detect.test.ts` holds the built-ins to it).
 */
export const DECISIVE_WEIGHT = 5000;

/**
 * From this weight on a content rule is **certain** (R1): it matches syntax that only its
 * own control writes (an Okuma `SB=`, a LAP call by name, a `G15 H` work offset). Every
 * rule below it may also match another dialect's line, and none of them can outvote a
 * decisive header whatever the number of lines.
 */
export const CERTAIN_WEIGHT = 20;

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

/** What one pass over the sniffed lines found: every profile's score, and what the result reads. */
interface ScoreSheet {
  scores: number[];
  /** Per profile: a rule of [`CERTAIN_WEIGHT`] or more was a line's strongest match. */
  certain: boolean[];
  /** How many non-empty lines were read (at most [`MAX_SNIFF_LINES`]). */
  lines: number;
}

function scoreSheet(profiles: CompiledProfile[], path: string | null, text: string): ScoreSheet {
  const ext = path === null ? '' : extensionOf(path);
  const scores = profiles.map((cp) => extensionWeight(cp, ext));
  const vetoed = profiles.map(() => false);
  const certain = profiles.map(() => false);

  // Strongest pattern per line: the rules are tried in descending weight, and the first
  // one that matches ends the line for that profile.
  const rules = profiles.map((cp) => [...cp.re.detectContent].sort((a, b) => b.weight - a.weight));
  const vetoes = profiles.map((cp) => cp.re.detectVetoes ?? []);
  const sniffed = firstLines(text, MAX_SNIFF_LINES);
  for (const line of sniffed) {
    for (let i = 0; i < profiles.length; i++) {
      if (vetoed[i]) continue;
      if (vetoes[i].length > 0 && vetoes[i].some((veto) => veto.test(line))) {
        vetoed[i] = true;
        continue;
      }
      for (const rule of rules[i]) {
        if (rule.re.test(line)) {
          scores[i] += rule.weight;
          if (rule.weight >= CERTAIN_WEIGHT) certain[i] = true;
          break;
        }
      }
    }
  }
  return {
    scores: scores.map((score, i) => (vetoed[i] ? 0 : score)),
    certain: certain.map((hit, i) => hit && !vetoed[i]),
    lines: sniffed.length,
  };
}

/**
 * Every profile's score for a file, in the order of `profiles`: the extension weight plus
 * the strongest content rule per line over the first [`MAX_SNIFF_LINES`] non-empty lines,
 * or 0 for a profile one of whose `detect.vetoes` matches one of those lines (rule 5).
 * Exported for the tests that print the margins (gate G10), so they read what detection
 * reads.
 */
export function detectScores(profiles: CompiledProfile[], path: string | null, text: string): number[] {
  return scoreSheet(profiles, path, text).scores;
}

/** The index of the winner by the rules 2 to 4 of the header, or -1 when nothing scored. */
function winnerOf(profiles: CompiledProfile[], scores: number[], fallback: string, rank: Rank): number {
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
  return bestIndex;
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

  const bestIndex = winnerOf(profiles, detectScores(profiles, path, text), fallback, rank);
  return bestIndex === -1 ? fallback : profiles[bestIndex].profile.id;
}

// ---------------------------------------------------------------------------
// "No profile fits well" (M12.5, owner decision of 2026-10-08; plan §7.16 #177)
// ---------------------------------------------------------------------------

/**
 * Below this **family margin** — the winner's score minus the best score of a profile of
 * another `grammar` — a detection without a certain hit is uncertain. Measured against
 * another grammar on purpose: a Fanuc mill against the Fanuc lathe, or the two Siemens
 * profiles, is a question of the machine type, which the weights settle (M12.5), not of
 * the dialect.
 *
 * **Calibrated once in M12.5, an absolute margin of 5** (the evidence is in the plan,
 * §7.16 #177). Okuma scores one point per numbered block as both Fanuc profiles do, so the
 * family margin of an ISO program is the sum of the markers only one of the two writes —
 * which is exactly the question "does this program fit Fanuc or Okuma at all". A program of
 * a dialect gEdit has no profile for writes none of them and ties; a Fanuc or Okuma program
 * writes at least a few. A margin relative to the winner's score was tried and does not
 * separate better: a 400-line program carries as few markers as a 40-line one. The
 * committed fixtures hold the value from both sides: `nc/uncertain/` stays below it, and
 * the lowest family margin outside `nc/ambiguous/` and `nc/uncertain/` is 9 (the owner's
 * five-axis program).
 */
export const UNCERTAIN_FAMILY_MARGIN = 5;

/**
 * A text with fewer non-empty lines than this is never called uncertain: an empty or nearly
 * empty buffer has nothing to be wrong about yet.
 */
export const UNCERTAIN_MIN_LINES = 5;

/** What detection decided, and how sure it is (M12.5). */
export interface DetectResult {
  /** The profile id, exactly what `detectProfile` answers. */
  id: string;
  /** How the answer was reached: a folder of the profile, the content (with the extension), or nothing scored. */
  by: 'folder' | 'content' | 'fallback';
  /** The winner's score (0 for `folder` and `fallback`). */
  score: number;
  /** The best profile of another grammar, or `null` when no other grammar scored. */
  rival: string | null;
  /** `score` minus the rival's score. */
  familyMargin: number;
  /**
   * A decisive (`DECISIVE_WEIGHT`) or certain (`CERTAIN_WEIGHT`) rule of the winner was the
   * strongest match of at least one line it read. Always `false` for `folder` and `fallback`.
   */
  certain: boolean;
  /**
   * No profile fits well: the answer came from the content, no certain rule of the winner
   * matched, at least `UNCERTAIN_MIN_LINES` non-empty lines were read and the family margin
   * is below `UNCERTAIN_FAMILY_MARGIN`. The status item and the dialect picker say so;
   * nothing else changes (the guess is still applied).
   */
  uncertain: boolean;
}

/**
 * `detectProfile` with the confidence of its answer (M12.5, §7.16 #177).
 *
 * `id` is `detectProfile`'s answer for every input (one scoring pass serves both, and a
 * test holds the two together on every fixture). A folder match and a file nothing scored
 * on are never uncertain: the first is the user's own choice, the second keeps the
 * document's profile and says nothing about the text.
 */
export function detectResult(
  profiles: CompiledProfile[],
  path: string | null,
  text: string,
  fallback: string,
  o?: DetectOptions,
): DetectResult {
  const none: DetectResult = {
    id: fallback,
    by: 'fallback',
    score: 0,
    rival: null,
    familyMargin: 0,
    certain: false,
    uncertain: false,
  };
  if (profiles.length === 0) return none;
  const rank = rankWith(o);
  if (path !== null) {
    const folderMatch = byFolder(profiles, path, rank);
    if (folderMatch) return { ...none, id: folderMatch.profile.id, by: 'folder' };
  }

  const sheet = scoreSheet(profiles, path, text);
  const index = winnerOf(profiles, sheet.scores, fallback, rank);
  if (index === -1) return none;

  const grammar = profiles[index].profile.grammar;
  let rival = -1;
  profiles.forEach((cp, i) => {
    if (i === index || cp.profile.grammar === grammar || sheet.scores[i] <= 0) return;
    if (rival === -1 || sheet.scores[i] > sheet.scores[rival]) rival = i;
  });
  const score = sheet.scores[index];
  const familyMargin = score - (rival === -1 ? 0 : sheet.scores[rival]);
  const certain = sheet.certain[index];
  return {
    id: profiles[index].profile.id,
    by: 'content',
    score,
    rival: rival === -1 ? null : profiles[rival].profile.id,
    familyMargin,
    certain,
    uncertain: !certain && sheet.lines >= UNCERTAIN_MIN_LINES && familyMargin < UNCERTAIN_FAMILY_MARGIN,
  };
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
