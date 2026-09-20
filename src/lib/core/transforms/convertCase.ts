// Convert case (plan §5 WP4.3). Owner: WP4.3.
//
// Upper or lower case over the code, chosen in the options form. Comments are excluded by
// default — a shop's `(Roughing pass, D25 endmill)` is prose, and shouting it back at the
// operator is not a cleanup.
//
// Only token text the profile describes as code is converted; a tool name in a string
// (`TOOL CALL "MILL_D10"`) is data and is left exactly as written, because the control
// matches it literally against the tool table. That one is **not** an option: there is no
// reading of "convert case" under which renaming the tools of a program is what the user
// asked for (hand-off note, WP4.3). The option covers the comments.
//
// Three more rules that keep this from being a `line.toUpperCase()`:
//
//  - A dialect that reads `X` and `x` as different things (`syntax.caseSensitive`) is
//    refused outright by `available()`. Converting case there changes the program.
//  - A token whose conversion changes its length (`ß` → `SS`, `ﬁ` → `FI`) is left as
//    written, and **said so**: the offsets a control counts must not move because of a
//    ligature, and a line that quietly did not convert is a line the user has to be told
//    about (G8 M4).
//  - Every rewritten line is tokenized again: same kinds, same spans, or the line is kept
//    and listed in the results panel.
//
// **Lower case on a control that only reads upper case.** Where the profile sets
// `editing.forceUppercase`, the editor itself upper-cases what the user types, and the
// control refuses a program written any other way — `o1002`, `n10 g0` and `m30` are not
// a cosmetic change, they are a file that alarms on load. The choice is still offered,
// because the document may be on its way somewhere else, but the run asks first (G8 M4).

import type { Located, Msg } from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { t } from '$lib/i18n';
import { stateBefore } from './fragment';
import type { TransformContext, TransformDef, TransformResult } from './types';

/** One in-place replacement of the same length. */
interface Patch {
  start: number;
  end: number;
  text: string;
}

function apply(line: string, patches: Patch[]): string {
  let out = '';
  let at = 0;
  for (const patch of patches) {
    out += line.slice(at, patch.start) + patch.text;
    at = patch.end;
  }
  return out + line.slice(at);
}

/**
 * True when the control this profile describes only accepts upper case.
 *
 * `editing` is a P2 profile field that P1 carries but does not otherwise read
 * (`Profile[p2Field]`), so it is picked apart defensively rather than typed.
 */
function forcesUppercase(cp: CompiledProfile): boolean {
  const editing: unknown = (cp.profile as Record<string, unknown>).editing;
  if (typeof editing !== 'object' || editing === null) return false;
  return (editing as Record<string, unknown>).forceUppercase === true;
}

/** True when the two token lists agree on kind and span, which is all case may leave alone. */
function sameShape(a: NcToken[], b: NcToken[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind !== b[i].kind || a[i].start !== b[i].start || a[i].end !== b[i].end) return false;
  }
  return true;
}

export const convertCase: TransformDef = {
  id: 'convert-case',
  title: 'ncCleanup.convertCase.title',
  available(cp: CompiledProfile): true | Msg {
    if (cp.profile.syntax?.caseSensitive === true) {
      return { key: 'ncCleanup.convertCase.unavailable', params: { profile: cp.profile.name } };
    }
    return true;
  },
  options(cp: CompiledProfile): FieldSpec[] {
    void cp;
    return [
      {
        id: 'case',
        type: 'choice',
        label: t('ncCleanup.convertCase.case'),
        default: 'upper',
        choices: [
          { label: t('ncCleanup.convertCase.upper'), value: 'upper' },
          { label: t('ncCleanup.convertCase.lower'), value: 'lower' },
        ],
      },
      {
        id: 'excludeComments',
        type: 'bool',
        label: t('ncCleanup.convertCase.excludeComments'),
        help: t('ncCleanup.convertCase.excludeCommentsHelp'),
        default: true,
      },
    ];
  },
  preflight(lines: string[], ctx: TransformContext): Msg | null {
    void lines;
    if (ctx.options.case !== 'lower' || !forcesUppercase(ctx.cp)) return null;
    return { key: 'ncCleanup.convertCase.lowerOnUppercaseControl', params: { profile: ctx.cp.profile.name } };
  },
  run(lines: string[], ctx: TransformContext): TransformResult {
    const toLower = ctx.options.case === 'lower';
    const excludeComments = ctx.options.excludeComments !== false;
    const unconverted = t('ncCleanup.convertCase.lengthChanged');
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

      const patches: Patch[] = [];
      let lengthChanged = false;
      for (const token of tokens) {
        if (token.kind === 'whitespace' || token.kind === 'string') continue;
        if (token.kind === 'comment' && excludeComments) continue;
        const text = toLower ? token.text.toLowerCase() : token.text.toUpperCase();
        if (text === token.text) continue;
        // `ß` → `SS` is two characters where there was one. The block would still read
        // back correctly, but every offset behind it moves and a control counts them, so
        // the token is left as written — and reported, which it used to not be.
        if (text.length !== token.text.length) {
          lengthChanged = true;
          continue;
        }
        patches.push({ start: token.start, end: token.end, text });
      }
      if (lengthChanged) skipped.push({ line: ctx.firstLine + i, message: unconverted, severity: 'info' });
      if (patches.length === 0) {
        out[i] = line;
        continue;
      }

      const rewritten = apply(line, patches);
      if (!sameShape(tokenizeLine(rewritten, ctx.cp, prev).tokens, tokens)) {
        out[i] = line;
        skipped.push({ line: ctx.firstLine + i, message: t('ncCleanup.convertCase.skipped'), severity: 'warning' });
        continue;
      }
      out[i] = rewritten;
      changed++;
    }

    const key = toLower ? 'ncCleanup.convertCase.summaryLower' : 'ncCleanup.convertCase.summaryUpper';
    return {
      lines: out,
      summary: changed === 0 ? { key: 'ncCleanup.convertCase.summaryNone' } : { key, params: { count: changed } },
      skipped,
      warnings: [],
    };
  },
};
