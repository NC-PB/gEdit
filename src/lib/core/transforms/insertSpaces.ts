// Insert spaces between words (plan §5 WP4.3, `docs/planning/nc-transformations.md`).
// Owner: WP4.3.
//
// Unpacks CAM output: `N10G0G90X0Y0` becomes `N10 G0 G90 X0 Y0`. It only ever inserts
// between two tokens the tokenizer found, which is what keeps these intact:
//
//  - comments and strings — their inner text is never touched
//  - expressions (`[#1+2.]`) and variables (`#101`, `Q1`) — one token, no spaces inside
//  - keywords (`TOOL CALL`, `CYCL DEF`) — the space *inside* a keyword is part of it
//  - `,R` and `,C` on a lathe — the comma belongs to the address, not to the number
//  - signs — `X-10` is one word; the `-` never becomes `X - 10`
//
// **How it writes the line.** It never rebuilds the line out of token texts, because a
// bug in the token walk would then silently drop characters. It collects offsets and
// splices single spaces into the *original* string, so the output is the input plus
// spaces — nothing else can happen to it.
//
// **What it refuses to touch.** A space next to a block-skip mark, an operator or an
// `unknown` token is not inserted: `/N100` keeps its mark on the block, `#101=[#1+2.]`
// stays one assignment (the spec calls that "variable expressions stay intact"), and a
// chunk the profile does not describe is left exactly as written. A `,R1.` keeps the
// comma attached to the value in front of it for the same reason.
//
// **The guard.** Every rewritten line is tokenized again and its code tokens (everything
// but whitespace) must come back identical, kind and text. A line that fails is kept as
// it was and listed in the results panel. Inserting a space is about as safe as an NC
// edit gets, but "about as safe" is not a thing a transform may rely on.
//
// **A dialect that already separates its words inserts nothing at all.** The guard above
// cannot catch that case, because the extra space is *legal* — the line reads back with
// the same tokens. Klartext `3 LBL0` came back as `3 LBL 0` and `REP5` as `REP 5`: the
// keyword and the value it belongs to, pushed apart on a control that writes them
// together (G8 M4). Unpacking is a thing you do to packed ISO code; where
// `syntax.wordSeparatorRequired` is set there is nothing packed to unpack, and this
// transform says so instead.

import type { Located, Msg } from '$lib/app/types';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, NcToken, TokenKind } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { t } from '$lib/i18n';
import { stateBefore } from './fragment';
import type { TransformContext, TransformDef, TransformResult } from './types';

/** Kinds a new space may stand behind. */
const CAN_PRECEDE: ReadonlySet<TokenKind> = new Set<TokenKind>([
  'blockNumber',
  'word',
  'keyword',
  'comment',
  'string',
  'variable',
  'expression',
  'programMarker',
]);

/** Kinds a new space may stand in front of. A block number never gets one: it is the head. */
const CAN_FOLLOW: ReadonlySet<TokenKind> = new Set<TokenKind>([
  'word',
  'keyword',
  'comment',
  'string',
  'variable',
  'expression',
  'programMarker',
]);

/**
 * The code tokens of a line as one string, the fingerprint a rewrite must reproduce.
 * Whitespace is left out — that is the one thing this transform is allowed to change.
 */
function codeFingerprint(tokens: NcToken[]): string {
  let out = '';
  for (const token of tokens) {
    // Length-prefixed, so two tokens can never run into one another.
    if (token.kind !== 'whitespace') out += `${token.kind} ${token.text.length} ${token.text}`;
  }
  return out;
}

/** True when a single space may go between `before` and `after`, which touch. */
function allowed(before: NcToken, after: NcToken): boolean {
  if (!CAN_PRECEDE.has(before.kind) || !CAN_FOLLOW.has(after.kind)) return false;
  // `X10.,R1.`: the comma-prefixed word belongs to the value in front of it (lathe corner
  // radius and chamfer), so no space is pushed between them.
  if (after.address !== undefined && after.address.startsWith(',')) return false;
  return true;
}

/** `line` with a space spliced in at every offset, which must be ascending. */
function splice(line: string, offsets: number[]): string {
  let out = '';
  let at = 0;
  for (const offset of offsets) {
    out += `${line.slice(at, offset)} `;
    at = offset;
  }
  return out + line.slice(at);
}

export const insertSpaces: TransformDef = {
  id: 'insert-spaces',
  title: 'ncCleanup.insertSpaces.title',
  available(cp: CompiledProfile): true | Msg {
    void cp;
    // Runs everywhere. On a dialect that already separates its words it simply reports
    // that there was nothing to do, which is a better answer than a greyed-out button.
    return true;
  },
  run(lines: string[], ctx: TransformContext): TransformResult {
    // A dialect whose words are separated by definition has nothing to unpack, and a
    // space pushed between a keyword and its value is a change, not a cleanup.
    if (ctx.cp.profile.syntax.wordSeparatorRequired === true) {
      return { lines: lines.slice(), summary: { key: 'ncCleanup.insertSpaces.summaryNone' }, skipped: [], warnings: [] };
    }

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

      const offsets: number[] = [];
      for (let k = 1; k < tokens.length; k++) {
        const before = tokens[k - 1];
        const after = tokens[k];
        if (before.end === after.start && allowed(before, after)) offsets.push(after.start);
      }
      if (offsets.length === 0) {
        out[i] = line;
        continue;
      }

      const rewritten = splice(line, offsets);
      // The guard: the same code tokens, in the same order, with the same text.
      if (codeFingerprint(tokenizeLine(rewritten, ctx.cp, prev).tokens) !== codeFingerprint(tokens)) {
        out[i] = line;
        skipped.push({ line: ctx.firstLine + i, message: t('ncCleanup.insertSpaces.skipped'), severity: 'warning' });
        continue;
      }
      out[i] = rewritten;
      changed++;
    }

    return {
      lines: out,
      summary:
        changed === 0
          ? { key: 'ncCleanup.insertSpaces.summaryNone' }
          : { key: 'ncCleanup.insertSpaces.summary', params: { count: changed } },
      skipped,
      warnings: [],
    };
  },
};
