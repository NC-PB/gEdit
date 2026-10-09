// "Test Profile on Document": what every rule of a profile finds in a program, line by line
// (plan §6 M13 WP13.3, AD-29, §7.12). Owner: WP13.3.
//
// A user who writes a profile of their own needs to see **why** a program is read the way it
// is: which detection rule scored a line, what the tool-change rule captured, where the
// program starts and ends, what the program map made of a line, which words are block-number
// references, which lines a renumber would leave alone, and which setting (for example the
// G-code system) the program's own markers point at. This module answers that, once, as plain
// data; `contrib/userConfig.ts` turns it into the Results panel.
//
// It reads the **same rules the application reads**, with the same primitives — the compiled
// patterns of the profile, `maskComments`, `tokenizeLine` + `referencesOn`, the renumber
// transform for the skips, and the variant rules of `detect.ts` — and never a second
// interpretation of a pattern, so what it prints is what the editor does.
//
// Time. Every rule is timed where it runs (`now` is injected so a test can make one slow). A
// rule that needs more than [`SLOW_MS`] on one line is reported in `slow`: such a pattern
// stalls opening a large program, and the user who wrote it should hear about it here and not
// from a frozen window (standing rule 15: patterns are bounded, and this is the measurement).
//
// Bounds. At most [`MAX_REPORT_LINES`] lines are read, as the report is meant for a program
// the user is looking at while they edit a rule, and `detect` itself only ever reads the first
// 400 non-empty lines. Rows are not capped here; the caller caps what it shows and says how
// many were left out. The rules together may use [`BUDGET_MS`]: past it the report stops at the
// line it has reached and ends with a `stopped` row (M13 review fix CODE-8). `testReportAsync`
// hands the thread back every [`CHUNK_LINES`] lines, so a slow pattern on a big program does not
// freeze the window for the whole run; one rule that never ends cannot be interrupted, which is
// why the patterns themselves are bounded when a profile is loaded.
//
// Pure: no store, no editor, no Tauri. The profile registry's answers (`detection`,
// `variants`) are handed in.

import { maskComments } from '$lib/core/nc/mask';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { renumber } from '$lib/core/transforms/renumber';
import { labelsOf, referenceAddresses, referencesOn } from '$lib/core/transforms/references';
import { MAX_SNIFF_LINES, VARIANT_MARGIN } from '$lib/core/profiles/detect';
import type { DetectResult } from '$lib/core/profiles/detect';
import type { CodeDb } from '$lib/core/codes/types';
import type { EffectiveMachine } from '$lib/core/machines/types';
import type { LineState } from '$lib/core/nc/types';
import type { CompiledProfile, OutlineKind, VariantDecl } from '$lib/core/profiles/types';

/** A single rule that needs longer than this on one line is reported (milliseconds). */
export const SLOW_MS = 50;

/** Lines read at most. A longer program is tested on its first lines and the report says so. */
export const MAX_REPORT_LINES = 20_000;

/** The time all rules together may use, in milliseconds, before the report stops (CODE-8). */
export const BUDGET_MS = 5000;

/** How many lines `testReportAsync` reads before it hands the thread back. */
export const CHUNK_LINES = 200;

export type TestRowKind =
  | 'detect'
  | 'veto'
  | 'toolCall'
  | 'programStart'
  | 'programEnd'
  | 'outline'
  | 'reference'
  | 'numbering'
  | 'variant'
  | 'variantResult'
  | 'stopped';

/** One finding. `line` is 1-based; 0 for a finding about the whole program. */
export interface TestRow {
  line: number;
  kind: TestRowKind;
  /** The pattern (or the variant) that produced it, as written in the profile. */
  rule: string;
  /** The text the rule captured; empty where the finding has none (a renumber skip). */
  captured: string;
  /** Milliseconds the rule needed on this line, or null where nothing was timed. */
  ms: number | null;
  /** True when `ms` is above [`SLOW_MS`]. */
  slow: boolean;

  /** `detect`, `variant`: the rule's weight. */
  weight?: number;
  /** `detect`: false when a veto on `vetoLine` rules the profile out, so this line did not count. */
  counted?: boolean;
  vetoLine?: number;
  /** `stopped`: how many lines were read. */
  lines?: number;
  /** `toolCall`: what the rule decided. `tool-word` is a tool written without a change (`T2` preselecting). */
  outcome?: 'tool-change' | 'ignored' | 'tool-word';
  /** `toolCall`: the tool the `tool` pattern captured. */
  tool?: string | null;
  /** `toolCall`, `ignored`: the `toolCall.ignore` text that cancelled the change. */
  ignoredBy?: string;
  /** `outline`: what the program map shows the line as. */
  outlineKind?: OutlineKind;
  /** `reference`: the block number the word names, or null where it is not a plain number. */
  target?: number | null;
  /** `reference`: whether a renumber is allowed to rewrite it. */
  rewrite?: boolean;
  /** `numbering`: the reason, already translated by the renumber transform. */
  message?: string;
  /** `variant`, `variantResult`: which variant and which of its choices. */
  variant?: string;
  variantLabel?: string;
  choice?: string;
  /** `variantResult`: how far ahead of the runner-up the winner is, and whether that is enough to act on. */
  margin?: number;
  acts?: boolean;
  /** `variantResult`: the variant's default, which is kept while the margin is too small. */
  default?: string;
}

/** A rule that was too slow. */
export interface SlowRule {
  line: number;
  rule: string;
  ms: number;
  /** Which part of the profile the rule belongs to. */
  kind: TestRowKind;
}

export interface TestReport {
  rows: TestRow[];
  /** How many lines were read. */
  linesRead: number;
  /** The program has more lines than were read (too long, or the report ran out of time). */
  truncated: boolean;
  /** The line the report stopped at because the rules used up [`BUDGET_MS`]; null when it did not. */
  stoppedAt: number | null;
  /** Everything above [`SLOW_MS`], slowest first. */
  slow: SlowRule[];
  /** What detection decided for the whole text, as handed in; null where the caller did not ask. */
  detection: DetectResult | null;
  /** Total time of the timed rules, in milliseconds. */
  totalMs: number;
}

/** What the report needs; everything but `cp` and `lines` is optional. */
export interface TestReportInput {
  cp: CompiledProfile;
  /** The program's lines, LF semantics (no line endings in them). */
  lines: readonly string[];
  /** The code database, for the renumber transform's context. */
  codes: CodeDb;
  machine: EffectiveMachine;
  /** What the registry's detection answered for this text, shown beside the rules. */
  detection?: DetectResult | null;
  /** `profiles.detectVariants(id, text)`: the choice and the margin per declared variant. */
  variants?: Record<string, { value: string; margin: number }>;
  /** A clock in milliseconds. Defaults to `performance.now`. */
  now?: () => number;
}

interface Timer {
  now: () => number;
  total: number;
  slow: SlowRule[];
}

/** Runs `run`, adds its time to the total and records it as slow when it is. Answers the result and the milliseconds. */
function timed<T>(timer: Timer, line: number, rule: string, kind: TestRowKind, run: () => T): [T, number] {
  const start = timer.now();
  const value = run();
  const ms = Math.max(0, timer.now() - start);
  timer.total += ms;
  if (ms > SLOW_MS) timer.slow.push({ line, rule, ms, kind });
  return [value, ms];
}

/** The text a match captured: its `text` group when it has one, else the whole match. */
function capturedOf(match: RegExpExecArray): string {
  const named = match.groups?.text;
  return (typeof named === 'string' && named.trim() !== '' ? named : match[0]).trim();
}

interface VariantRule {
  variant: VariantDecl;
  choice: string;
  re: RegExp;
  weight: number;
  source: string;
}

/** The detection rules of every declared variant choice, compiled like `detect.ts` does. */
function variantRulesOf(cp: CompiledProfile): { decls: VariantDecl[]; rules: VariantRule[] } {
  const declared = (cp.profile.machineParams as { variants?: unknown } | undefined)?.variants;
  const decls = (Array.isArray(declared) ? declared : []).filter(
    (entry): entry is VariantDecl => typeof entry?.id === 'string' && entry.id !== '',
  );
  const rules: VariantRule[] = [];
  for (const variant of decls) {
    for (const choice of Array.isArray(variant.choices) ? variant.choices : []) {
      if (typeof choice?.value !== 'string') continue;
      for (const rule of Array.isArray(choice.detect) ? choice.detect : []) {
        if (typeof rule?.pattern !== 'string' || typeof rule.weight !== 'number') continue;
        try {
          rules.push({
            variant,
            choice: choice.value,
            re: new RegExp(rule.pattern, cp.flags),
            weight: rule.weight,
            source: rule.pattern,
          });
        } catch {
          // The validator has reported it; a rule that cannot run scores nothing.
        }
      }
    }
  }
  return { decls, rules };
}

/** The renumber transform's skipped lines under the profile's defaults, or none where it cannot run. */
function numberingSkips(input: TestReportInput, lines: readonly string[]): { line: number; message: string }[] {
  try {
    if (renumber.available(input.cp) !== true) return [];
    const result = renumber.run(lines.slice(), {
      cp: input.cp,
      codes: input.codes,
      machine: input.machine,
      options: {},
      firstLine: 1,
      document: lines,
    });
    // Only the lines left alone: the references a renumber keeps are listed as references.
    return result.skipped.filter((row) => row.severity === 'info').map((row) => ({ line: row.line, message: row.message }));
  } catch {
    return [];
  }
}

const KIND_ORDER: Record<TestRowKind, number> = {
  variantResult: 0,
  detect: 1,
  veto: 2,
  variant: 3,
  toolCall: 4,
  programStart: 5,
  programEnd: 6,
  outline: 7,
  reference: 8,
  numbering: 9,
  stopped: 10,
};

/**
 * Runs every rule of `cp` over `lines` and lists what each one found.
 *
 * A line that no rule has anything to say about has no row. Rows come in line order, the
 * whole-program findings first, and within a line in the order of [`KIND_ORDER`].
 */
export function testReport(input: TestReportInput): TestReport {
  const steps = reportSteps(input);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/**
 * [`testReport`] that gives the thread back between chunks of [`CHUNK_LINES`] lines (`pause`,
 * by default the next macrotask), so the window stays alive while a long program is tested.
 */
export async function testReportAsync(
  input: TestReportInput,
  pause: () => Promise<void> = () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
): Promise<TestReport> {
  const steps = reportSteps(input);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await pause();
  }
}

function* reportSteps(input: TestReportInput): Generator<void, TestReport> {
  const { cp } = input;
  const timer: Timer = { now: input.now ?? (() => performance.now()), total: 0, slow: [] };
  const truncated = input.lines.length > MAX_REPORT_LINES;
  let lines = truncated ? input.lines.slice(0, MAX_REPORT_LINES) : input.lines;
  let stoppedAt: number | null = null;
  const rows: TestRow[] = [];
  const push = (row: Omit<TestRow, 'slow'> & { slow?: boolean }): void => {
    rows.push({ ...row, slow: row.slow ?? (row.ms !== null && row.ms > SLOW_MS) });
  };

  // Detection reads the strongest rule per line, in descending weight, over the first 400
  // non-empty lines, trimmed (`detect.ts`); a veto ends the file for this profile.
  const rules = [...cp.re.detectContent].sort((a, b) => b.weight - a.weight);
  const vetoes = cp.re.detectVetoes ?? [];
  let sniffed = 0;
  let vetoed = false;

  // Variant rules score once per file; the first line a rule matches on is the one listed.
  const variantRules = variantRulesOf(cp);
  const variantSeen = new Set<VariantRule>();

  const references = cp.re.references.length > 0;
  const addresses = references ? referenceAddresses(cp) : null;
  const labels = references ? labelsOf(lines, cp) : undefined;
  let state: LineState | undefined;

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % CHUNK_LINES === 0) yield;
    if (timer.total > BUDGET_MS) {
      stoppedAt = i;
      lines = lines.slice(0, i);
      break;
    }
    const lineNo = i + 1;
    const line = lines[i];
    const blank = line.trim() === '';

    // Tokens carry the continuation state of the next line, so every line is read when the
    // profile has reference rules.
    const tokens = references ? tokenizeLine(line, cp, state) : null;
    if (tokens) state = tokens.state;
    if (blank) continue;

    const masked = maskComments(line, cp);

    // --- detection --------------------------------------------------------------------
    if (sniffed < MAX_SNIFF_LINES) {
      sniffed += 1;
      const trimmed = line.trim();
      if (!vetoed) {
        for (const veto of vetoes) {
          const [match, ms] = timed(timer, lineNo, veto.source, 'veto', () => veto.exec(trimmed));
          if (match !== null) {
            vetoed = true;
            push({ line: lineNo, kind: 'veto', rule: veto.source, captured: match[0].trim(), ms });
            break;
          }
        }
      }
      if (!vetoed) {
        for (const rule of rules) {
          const [match, ms] = timed(timer, lineNo, rule.re.source, 'detect', () => rule.re.exec(trimmed));
          if (match !== null) {
            push({
              line: lineNo,
              kind: 'detect',
              rule: rule.re.source,
              captured: capturedOf(match),
              ms,
              weight: rule.weight,
            });
            break;
          }
        }
      }

      // The variant rules read the masked line of the same first 400 lines.
      const maskedTrim = masked.trim();
      if (maskedTrim !== '') {
        for (const rule of variantRules.rules) {
          if (variantSeen.has(rule)) continue;
          const [match, ms] = timed(timer, lineNo, rule.source, 'variant', () => rule.re.exec(maskedTrim));
          if (match === null) continue;
          variantSeen.add(rule);
          push({
            line: lineNo,
            kind: 'variant',
            rule: rule.source,
            captured: match[0].trim(),
            ms,
            weight: rule.weight,
            variant: rule.variant.id,
            variantLabel: rule.variant.label,
            choice: rule.choice,
          });
        }
      }
    }

    // --- tool change ------------------------------------------------------------------
    {
      const [trigger, triggerMs] = timed(timer, lineNo, cp.re.toolTrigger.source, 'toolCall', () => cp.re.toolTrigger.exec(masked));
      let ignoredBy: RegExpExecArray | null = null;
      let ignoreMs = 0;
      const ignore = cp.re.toolIgnore;
      if (trigger !== null && ignore) {
        [ignoredBy, ignoreMs] = timed(timer, lineNo, ignore.source, 'toolCall', () => ignore.exec(masked));
      }
      const isTool = trigger !== null && ignoredBy === null;
      const fromLast = cp.profile.toolCall?.toolFrom === 'same-line-or-last';
      let toolMatch: RegExpExecArray | null = null;
      let toolMs = 0;
      if (isTool || fromLast) {
        [toolMatch, toolMs] = timed(timer, lineNo, cp.re.tool.source, 'toolCall', () => cp.re.tool.exec(masked));
      }
      const group = toolMatch?.groups?.tool;
      const tool = typeof group === 'string' && group.trim() !== '' ? group.trim() : null;
      if (trigger !== null) {
        push({
          line: lineNo,
          kind: 'toolCall',
          rule: cp.re.toolTrigger.source,
          captured: trigger[0].trim(),
          ms: triggerMs + ignoreMs + toolMs,
          outcome: ignoredBy === null ? 'tool-change' : 'ignored',
          tool,
          ...(ignoredBy === null ? {} : { ignoredBy: ignoredBy[0].trim() }),
        });
      } else if (toolMatch !== null && tool !== null) {
        push({
          line: lineNo,
          kind: 'toolCall',
          rule: cp.re.tool.source,
          captured: toolMatch[0].trim(),
          ms: triggerMs + toolMs,
          outcome: 'tool-word',
          tool,
        });
      }
    }

    // --- program start and end --------------------------------------------------------
    for (const [list, kind] of [
      [cp.re.programStart, 'programStart'],
      [cp.re.programEnd, 'programEnd'],
    ] as const) {
      for (const re of list) {
        const [match, ms] = timed(timer, lineNo, re.source, kind, () => re.exec(masked));
        if (match !== null) {
          push({ line: lineNo, kind, rule: re.source, captured: match[0].trim(), ms });
          break;
        }
      }
    }

    // --- the program map --------------------------------------------------------------
    for (const rule of cp.re.outline) {
      const raw = rule.kind === 'comment' || rule.kind === 'section';
      const [match, ms] = timed(timer, lineNo, rule.re.source, 'outline', () => rule.re.exec(raw ? line : masked));
      if (match !== null) {
        push({
          line: lineNo,
          kind: 'outline',
          rule: rule.re.source,
          captured: capturedOf(match),
          ms,
          outlineKind: rule.kind,
        });
        break;
      }
    }

    // --- block-number references ------------------------------------------------------
    if (tokens && addresses) {
      for (const word of referencesOn(tokens.tokens, line, cp, addresses, labels)) {
        const fired = cp.re.references.find((rule) => rule.addresses.includes(word.address) && rule.trigger.test(masked));
        push({
          line: lineNo,
          kind: 'reference',
          rule: fired?.trigger.source ?? '',
          captured: `${word.address}${word.text}`,
          ms: null,
          target: word.target,
          rewrite: word.rewrite && !word.ambiguous,
        });
      }
    }
  }

  // --- a veto: detection scores the profile 0 for the whole file, whatever was found before it --
  const veto = rows.find((row) => row.kind === 'veto');
  if (veto !== undefined) {
    for (const row of rows) {
      if (row.kind === 'detect' && row.line < veto.line) {
        row.counted = false;
        row.vetoLine = veto.line;
      }
    }
  }

  // --- renumbering: the lines it would leave alone --------------------------------------
  if (stoppedAt === null) {
    for (const skip of numberingSkips(input, lines)) {
      push({ line: skip.line, kind: 'numbering', rule: '', captured: '', ms: null, message: skip.message });
    }
  } else {
    push({ line: stoppedAt, kind: 'stopped', rule: '', captured: '', ms: null, lines: stoppedAt });
  }

  // --- the variants: what the markers decided -------------------------------------------
  for (const variant of variantRules.decls) {
    const result = input.variants?.[variant.id];
    if (result === undefined) continue;
    push({
      line: 0,
      kind: 'variantResult',
      rule: variant.id,
      captured: result.value,
      ms: null,
      variant: variant.id,
      variantLabel: variant.label,
      choice: result.value,
      margin: result.margin,
      acts: result.margin >= VARIANT_MARGIN,
      default: variant.default,
    });
  }

  rows.sort((a, b) => a.line - b.line || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return {
    rows,
    linesRead: lines.length,
    truncated: truncated || stoppedAt !== null,
    stoppedAt,
    slow: [...timer.slow].sort((a, b) => b.ms - a.ms),
    detection: input.detection ?? null,
    totalMs: timer.total,
  };
}
