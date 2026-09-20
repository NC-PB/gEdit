// Remove comments (plan §5 WP4.3). Owner: WP4.3.
//
// The one transform whose job *is* the comments — and it still finds them with the
// tokenizer, because a `(` inside a string, or an unclosed `(` at the end of a file, is
// exactly where a regex gets it wrong.
//
// Options:
//  - drop lines that end up empty (on by default)
//  - keep the program-name comment (`O1001 (BRACKET)`)
//  - keep the first N lines (the header block a shop stamps on every program)
//  - keep Klartext section comments (`* - ROUGH`), offered only where the profile has them
//
// A trailing `~` is **not** an option: on Klartext the continuation marker may sit behind
// a comment, and dropping it would fuse two blocks into one. The tokenizer reads the
// marker as its own token outside the comment, and the cut below never reaches past the
// comment, so `12 ; SETUP ~` becomes `12 ~` and the block stays a block. An option to
// turn that off would only be an option to corrupt the program (hand-off note, WP4.3).
//
// **What "empty" means, and why it is not the same on every dialect.**
//  - Nothing but whitespace left → the line goes (with `dropEmptied`).
//  - Only a block number left → it depends. `N100 (LOOP TOP)` on Fanuc becomes `N100`,
//    and the line stays: block numbers there are jump targets, and deleting the target of
//    a `GOTO 100` is exactly the kind of damage this milestone exists to avoid. Where the
//    profile numbers blocks consecutively (Klartext), the numbers are positional, jumps
//    go to labels and a bare number is not a block the control accepts, so the line goes
//    and the run warns that the program needs renumbering.
//  - A block number plus the continuation marker is code, and stays.

import type { Located, Msg } from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { t } from '$lib/i18n';
import { stateBefore } from './fragment';
import type { TransformContext, TransformDef, TransformResult } from './types';

/** A half-open span of the line to drop. */
interface Cut {
  start: number;
  end: number;
}

/** `line` without the given spans, which are ascending and do not overlap. */
function cut(line: string, cuts: Cut[]): string {
  let out = '';
  let at = 0;
  for (const span of cuts) {
    out += line.slice(at, span.start);
    at = span.end;
  }
  return out + line.slice(at);
}

/** Why a comment was left in place, or null when it goes. */
type KeepReason = 'header' | 'programName' | 'section' | null;

const KEEP_MESSAGE: Readonly<Record<Exclude<KeepReason, null>, string>> = {
  header: 'ncCleanup.removeComments.keptHeader',
  programName: 'ncCleanup.removeComments.keptProgramName',
  section: 'ncCleanup.removeComments.keptSection',
};

/** True when the profile describes a section heading and this comment token is one. */
function isSectionHeading(line: string, token: NcToken, cp: CompiledProfile): boolean {
  const re = cp.re.sectionHeading;
  return re !== undefined && token.text.startsWith('*') && re.test(line);
}

/** The first token that is not whitespace, or null on a blank line. */
function firstCode(tokens: NcToken[]): NcToken | null {
  for (const token of tokens) if (token.kind !== 'whitespace') return token;
  return null;
}

export const removeComments: TransformDef = {
  id: 'remove-comments',
  title: 'ncCleanup.removeComments.title',
  available(cp: CompiledProfile): true | Msg {
    if ((cp.profile.syntax?.comments ?? []).length === 0) {
      return { key: 'ncCleanup.removeComments.unavailable', params: { profile: cp.profile.name } };
    }
    return true;
  },
  options(cp: CompiledProfile): FieldSpec[] {
    const fields: FieldSpec[] = [
      {
        id: 'dropEmptied',
        type: 'bool',
        label: t('ncCleanup.removeComments.dropEmptied'),
        help: t('ncCleanup.removeComments.dropEmptiedHelp'),
        default: true,
      },
      {
        id: 'keepProgramName',
        type: 'bool',
        label: t('ncCleanup.removeComments.keepProgramName'),
        help: t('ncCleanup.removeComments.keepProgramNameHelp'),
        default: true,
      },
      {
        id: 'keepFirstLines',
        type: 'integer',
        label: t('ncCleanup.removeComments.keepFirstLines'),
        help: t('ncCleanup.removeComments.keepFirstLinesHelp'),
        default: 0,
        min: 0,
        max: 9999,
      },
    ];
    if (cp.profile.syntax?.sectionHeading !== undefined) {
      fields.push({
        id: 'keepSectionHeadings',
        type: 'bool',
        label: t('ncCleanup.removeComments.keepSectionHeadings'),
        help: t('ncCleanup.removeComments.keepSectionHeadingsHelp'),
        default: true,
      });
    }
    return fields;
  },
  run(lines: string[], ctx: TransformContext): TransformResult {
    const dropEmptied = ctx.options.dropEmptied !== false;
    const keepProgramName = ctx.options.keepProgramName !== false;
    const keepSections = ctx.options.keepSectionHeadings !== false;
    const rawFirst = Number(ctx.options.keepFirstLines ?? 0);
    const keepFirstLines = Number.isFinite(rawFirst) ? Math.max(0, Math.trunc(rawFirst)) : 0;
    // Where the numbers are positional (Klartext), a line left with nothing but its block
    // number is not a block; where they are jump targets (Fanuc), it has to stay.
    const numbersArePositional = ctx.cp.profile.numbering?.mode === 'consecutive';

    const last = lines.length - 1;
    const out: string[] = [];
    const lineMap = new Int32Array(lines.length);
    const skipped: Located[] = [];
    // The state `lines[0]` begins in: a selection that starts inside a Klartext `~`
    // block must not read the block's tail as a block of its own (`fragment.ts`).
    let state: LineState | undefined = stateBefore(ctx);
    let removedComments = 0;
    let droppedLines = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = state;
      const result = tokenizeLine(line, ctx.cp, prev);
      state = result.state;
      const tokens = result.tokens;
      const docLine = ctx.firstLine + i;
      const head = firstCode(tokens);
      let seenComment = false;
      /** Whether anything in front of this token is still going to be on the line. */
      let codeInFront = false;

      const cuts: Cut[] = [];
      for (let k = 0; k < tokens.length; k++) {
        const token = tokens[k];
        if (token.kind === 'whitespace') continue;
        if (token.kind !== 'comment') {
          codeInFront = true;
          continue;
        }
        const isFirstComment = !seenComment;
        seenComment = true;

        let keep: KeepReason = null;
        if (docLine <= keepFirstLines) keep = 'header';
        else if (keepSections && isSectionHeading(line, token, ctx.cp)) keep = 'section';
        else if (keepProgramName && isFirstComment && head?.kind === 'programMarker') keep = 'programName';
        if (keep !== null) {
          skipped.push({ line: docLine, message: t(KEEP_MESSAGE[keep]), severity: 'info' });
          codeInFront = true;
          continue;
        }

        // The whitespace that separated the comment from the code goes with it: behind the
        // code when something in front of it stays (`G0 X0 (SAFE)` → `G0 X0`), otherwise in
        // front of what follows (`  (A) G0` → `  G0`), so indentation and a trailing `~`
        // survive and two comments in a row do not leave a gap behind.
        let start = token.start;
        let end = token.end;
        const before = k > 0 ? tokens[k - 1] : null;
        const after = k + 1 < tokens.length ? tokens[k + 1] : null;
        if (codeInFront) {
          if (before !== null && before.kind === 'whitespace') start = before.start;
        } else if (after !== null && after.kind === 'whitespace') end = after.end;
        // The cuts have to stay disjoint and ascending for `cut()`.
        const previous = cuts[cuts.length - 1];
        if (previous !== undefined && start < previous.end) start = previous.end;
        cuts.push({ start, end });
        removedComments++;
      }

      if (cuts.length === 0) {
        lineMap[i] = out.length;
        out.push(line);
        continue;
      }

      let rewritten = cut(line, cuts);
      // Ask the tokenizer what is left rather than guessing from the string.
      let hasCode = false;
      let hasBody = false;
      for (const token of tokenizeLine(rewritten, ctx.cp, prev).tokens) {
        if (token.kind === 'whitespace') continue;
        hasCode = true;
        if (token.kind !== 'blockNumber' && token.kind !== 'skip') hasBody = true;
      }
      if (!hasCode) rewritten = '';

      const emptied = !hasCode || (!hasBody && numbersArePositional);
      if (dropEmptied && emptied && i !== last) {
        lineMap[i] = -1;
        droppedLines++;
        continue;
      }
      lineMap[i] = out.length;
      out.push(rewritten);
    }

    const warnings: Msg[] = [];
    if (droppedLines > 0 && numbersArePositional) warnings.push({ key: 'ncCleanup.renumberNeeded' });

    return {
      lines: out,
      lineMap,
      summary:
        removedComments === 0
          ? { key: 'ncCleanup.removeComments.summaryNone' }
          : { key: 'ncCleanup.removeComments.summary', params: { count: removedComments } },
      skipped,
      warnings,
    };
  },
};
