// Remove spaces between words (plan §5 WP4.3). Owner: WP4.3.
//
// The inverse of `insertSpaces`, and the more dangerous direction, because a space that
// carries meaning cannot come back:
//
//  - **not available** when the profile sets `syntax.wordSeparatorRequired` (Klartext
//    needs its spaces); `available()` answers with the reason
//  - a keyword's own space is never removed (`TOOL CALL` stays `TOOL CALL`)
//  - text inside comments and strings keeps every space it had
//  - the space between two things that would merge into one token if joined is kept
//
// **How the last rule is enforced.** Not by a list of cases that looked dangerous while
// this was written, but by doing the join and asking the tokenizer again: the code tokens
// of the shorter line have to come back identical, kind and text. `X10 5` would join into
// the single word `X105`, the fingerprint changes, and the line is kept as it was and
// listed in the results panel. On top of that only whitespace *between* two tokens of a
// safe kind is even considered, so the decision never rests on the guard alone.
//
// Whitespace inside one token is not this transform's: `X 50` is a single word token in a
// packed dialect (the control reads the space as part of the word), and joining it would
// be an edit inside a token, which no transform does.
//
// Leading indentation and trailing blanks are removed as well. Neither separates two
// words, and "make the code compact" is the whole point of the command.

import type { Located, Msg } from '$lib/app/types';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, NcToken, TokenKind } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { t } from '$lib/i18n';
import { stateBefore } from './fragment';
import type { TransformContext, TransformDef, TransformResult } from './types';

/** Kinds that may lose the space behind them. */
const CAN_JOIN_LEFT: ReadonlySet<TokenKind> = new Set<TokenKind>([
  'blockNumber',
  'word',
  'comment',
  'programMarker',
]);

/** Kinds that may lose the space in front of them. */
const CAN_JOIN_RIGHT: ReadonlySet<TokenKind> = new Set<TokenKind>(['word', 'comment']);

/** The code tokens of a line as one string; whitespace is what this transform may change. */
function codeFingerprint(tokens: NcToken[]): string {
  let out = '';
  for (const token of tokens) {
    // Length-prefixed, so two tokens can never run into one another.
    if (token.kind !== 'whitespace') out += `${token.kind} ${token.text.length} ${token.text}`;
  }
  return out;
}

/** A half-open span of the line to drop. */
interface Cut {
  start: number;
  end: number;
}

/** `line` without the given spans, which must be ascending and must not overlap. */
function cut(line: string, cuts: Cut[]): string {
  let out = '';
  let at = 0;
  for (const span of cuts) {
    out += line.slice(at, span.start);
    at = span.end;
  }
  return out + line.slice(at);
}

export const removeSpaces: TransformDef = {
  id: 'remove-spaces',
  title: 'ncCleanup.removeSpaces.title',
  available(cp: CompiledProfile): true | Msg {
    if (cp.profile.syntax?.wordSeparatorRequired === true) {
      return { key: 'ncCleanup.removeSpaces.unavailable', params: { profile: cp.profile.name } };
    }
    return true;
  },
  run(lines: string[], ctx: TransformContext): TransformResult {
    const out: string[] = new Array<string>(lines.length);
    const skipped: Located[] = [];
    // The state `lines[0]` begins in: a selection that starts inside a Klartext `~`
    // block must not read the block's tail as a block of its own (`fragment.ts`).
    let state: LineState | undefined = stateBefore(ctx);
    let changed = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = state;
      const result = tokenizeLine(line, ctx.cp, prev);
      state = result.state;
      const tokens = result.tokens;

      const cuts: Cut[] = [];
      for (let k = 0; k < tokens.length; k++) {
        const token = tokens[k];
        if (token.kind !== 'whitespace') continue;
        const before = k > 0 ? tokens[k - 1] : null;
        const after = k + 1 < tokens.length ? tokens[k + 1] : null;
        // Indentation and trailing blanks stand between a token and the line edge, so they
        // separate nothing and always go. Everything else needs a safe kind on both sides.
        const joinable =
          before === null || after === null ? true : CAN_JOIN_LEFT.has(before.kind) && CAN_JOIN_RIGHT.has(after.kind);
        if (joinable) cuts.push({ start: token.start, end: token.end });
      }
      if (cuts.length === 0) {
        out[i] = line;
        continue;
      }

      const rewritten = cut(line, cuts);
      if (codeFingerprint(tokenizeLine(rewritten, ctx.cp, prev).tokens) !== codeFingerprint(tokens)) {
        out[i] = line;
        skipped.push({ line: ctx.firstLine + i, message: t('ncCleanup.removeSpaces.skipped'), severity: 'warning' });
        continue;
      }
      out[i] = rewritten;
      changed++;
    }

    return {
      lines: out,
      summary:
        changed === 0
          ? { key: 'ncCleanup.removeSpaces.summaryNone' }
          : { key: 'ncCleanup.removeSpaces.summary', params: { count: changed } },
      skipped,
      warnings: [],
    };
  },
};
