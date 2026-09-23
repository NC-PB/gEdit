// `buildContext` (plan §7.5). Owner: **WP5.1**. Stub written by P5 — the signature is
// binding, the body is not.
//
// Pure: it maps what the app already knows onto the JSON the script reads back with
// `gedit_nc.load_context()`. No Monaco, no store, no Tauri, so the shape of the context
// can be pinned by a unit test without an editor (plan §5 WP5.1 "Tests": "Also
// `buildContext`").
//
// Two things it must get right, because a script cannot detect either:
//
//  1. **`input` is the resolved scope.** `selection-or-document` never reaches the script;
//     the caller has already decided, extended the selection to whole lines, and put the
//     1-based inclusive range in `input.startLine`/`endLine`. A `'none'` scope carries
//     `0..0` and empty stdin.
//  2. **The document block describes the *file*, not stdin.** `encoding`, `hasBom` and
//     `lineEnding` say what the bytes on disk look like; stdin and stdout are always UTF-8
//     with LF, and the app puts the document's own line ending back on save (AD-7). A
//     script that "helpfully" writes CRLF would double them.
//
// `modified` is `DocMeta.dirty` (text or metadata), not `textDirty`: a script that refuses
// to run on an unsaved program wants to know about an encoding change too.
//
// ---------------------------------------------------------------------------
// Carry-over (2) from M4: priming the modal state at `startLine`
// ---------------------------------------------------------------------------
//
// `input.precedingLines` is the durable fix for G8's M4 finding 6. A selection run cannot
// see a `G95` or a `G84` set above the selection, so `scale_feed` / `scale_speed` mark the
// run as a fragment and warn instead of scaling a number they cannot justify. The lines
// above the selection let the script's `FeedModeTracker` catch up first.
//
// The two rules the prelude recorded live here, in one place, because they are what makes
// the field safe to add:
//
//  - **Only for a selection that does not start at line 1.** A whole-document run already
//    sees everything, and a selection that starts at the top *is* the program from the
//    top. `primingLines` is the gate, and `buildContext` applies it a second time, so a
//    caller that fills the field by hand cannot widen it.
//  - **Omit rather than truncate.** A half-primed tracker answers a wrong feed mode with
//    no sign that it is wrong; an absent field keeps the loud M4 warning, which is a
//    worse answer but an honest one. So a program with more preceding text than the caps
//    below simply does not get the field, and behaves exactly as it did in M4.
//
// The caps bound what the *Python* side has to chew through before the first line it may
// edit: every preceding line is tokenised in pure Python. 50k lines is roughly a second
// of that on a normal machine, which is a tolerable share of the 60 s default deadline;
// past it the warning is the better trade. They are TS-side caps and may be raised once a
// measurement says so — see the WP5.1 hand-off.

import type { BuildContextInput, ScriptContextInput, ScriptContextV2 } from '$lib/core/scripting/types';

/** At most this many lines above the selection are sent to prime the modal state. */
export const MAX_PRECEDING_LINES = 50_000;

/** And at most this many characters of them, so a few very long lines cannot slip past. */
export const MAX_PRECEDING_CHARS = 4 * 1024 * 1024;

/** `value` as a whole number that is at least `min`; anything unusable becomes `min`. */
function whole(value: number, min: number): number {
  return Number.isFinite(value) ? Math.max(Math.trunc(value), min) : min;
}

/**
 * The lines to send as `input.precedingLines`, or `undefined` for "keep the M4 behaviour".
 *
 * `above` is the document's lines `1..startLine - 1`, which the caller has read anyway for
 * a whole-document run. Nothing is truncated: the caps decide between all of it and none
 * of it.
 */
export function primingLines(
  input: { scope: ScriptContextInput['scope']; startLine: number },
  above: readonly string[],
): string[] | undefined {
  if (input.scope !== 'selection' || input.startLine <= 1) return undefined;
  if (above.length === 0 || above.length > MAX_PRECEDING_LINES) return undefined;

  let chars = 0;
  for (const line of above) {
    chars += line.length + 1;
    if (chars > MAX_PRECEDING_CHARS) return undefined;
  }
  return [...above];
}

/** The input range, normalised: whole numbers, `start <= end`, and `none` pinned to 0..0. */
function inputOf(input: ScriptContextInput): ScriptContextInput {
  if (input.scope === 'none') return { scope: 'none', startLine: 0, endLine: 0 };

  const startLine = whole(input.startLine, 1);
  const endLine = Math.max(whole(input.endLine, 1), startLine);
  const out: ScriptContextInput = { scope: input.scope, startLine, endLine };

  const preceding = primingLines({ scope: input.scope, startLine }, input.precedingLines ?? []);
  if (preceding !== undefined) out.precedingLines = preceding;
  return out;
}

/**
 * The `GEDIT_CONTEXT` payload for one run (plan §7.5).
 *
 * Everything it cannot derive from `doc` is passed in: the resolved profile, the code
 * database slice (`codes.forScripts(profileId)`), the input range, the caret and the
 * validated parameter values.
 *
 * `params` and `codes` are copied, so the object that goes to `JSON.stringify` cannot be
 * changed underneath the run by whatever else holds those arrays.
 */
export function buildContext(i: BuildContextInput): ScriptContextV2 {
  return {
    contract: 2,
    document: {
      path: i.doc.path,
      name: i.doc.title,
      profile: i.doc.profileId,
      encoding: i.doc.encoding.encoding,
      hasBom: i.doc.encoding.hasBom,
      lineEnding: i.doc.eol,
      modified: i.doc.dirty,
    },
    input: inputOf(i.input),
    cursor: { line: whole(i.cursor.line, 1), column: whole(i.cursor.column, 1) },
    params: { ...i.params },
    profile: i.profile,
    codes: [...i.codes],
    // M6, AD-31: what the document's machine decides, and where each value came from.
    // `id`/`name` are null for "none", and the script then reads every `source` as
    // `profile` — which is what `gedit_nc.machine_params` answers for an older context.
    machine: {
      id: i.machine.id,
      name: i.machine.name,
      choice: i.machine.choice,
      params: i.machine.params,
      source: i.machine.source,
    },
  };
}
