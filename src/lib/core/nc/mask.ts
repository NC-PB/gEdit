// Comment masking (plan §7.4, AD-11). Owner: WP3.2.
//
// Every code pattern of a profile (tool call, program start and end, the `outline` rules
// that are not `comment` or `section`, the numbering triggers) runs against the masked
// line, so `(T1 M6)` inside a comment is never a tool change.
//
// The mask keeps the line's length and its character offsets, so a match position on the
// masked line is a position in the real line. Comment characters are replaced by spaces;
// strings stay as they are, because tool names are strings — and because a comment
// marker inside a string (`TOOL CALL "D;10"`) does not start a comment.
//
// Two spans are blanked besides a plain comment, both of them the same decision the
// tokenizer makes:
//
//   - A comment that runs to the end of the line gives back the continuation marker that
//     follows it (Klartext `; TEXT ~`), so the marker survives on the masked line.
//   - A structure block (`12 * - TOOL CALL 5`) is a heading, not code. Its text is
//     blanked from the `*` on, so a code pattern cannot match a caption. The block number
//     stays, and the `section` outline rule reads the raw line anyway (WP3.5).

import type { CompiledProfile } from '$lib/core/profiles/types';
import { commentAt, commentEndAt, lexSpec } from './tokenizer';

const QUOTE = 0x22;

function blanks(count: number): string {
  return count > 0 ? ' '.repeat(count) : '';
}

/** Returns `line` with every comment blanked out, same length. */
export function maskComments(line: string, cp: CompiledProfile): string {
  const spec = lexSpec(cp);

  let limit = line.length;
  if (spec.continuation) {
    const match = spec.continuation.exec(line);
    if (match) limit = match.index;
  }

  let masked = '';
  let copied = 0;
  let p = 0;

  if (spec.sectionHeading) {
    const star = line.indexOf('*');
    if (star >= 0 && star < limit && spec.sectionHeading.test(line)) {
      masked = line.slice(0, star) + blanks(limit - star);
      copied = limit;
      p = limit;
    }
  }

  while (p < limit) {
    const code = line.charCodeAt(p);
    // Only in a dialect that has strings. Fanuc has none (`syntax-fanuc` §3.7), so a
    // stray `"` there is just a character, and reading it as a string opener would stop
    // the mask at that point: `G0 X1. " (T2 M6)` would keep its comment unmasked and
    // report a tool change that is commented out.
    if (spec.strings && code === QUOTE) {
      // A string is code, not text: skip it whole so its content cannot open a comment.
      let end = p + 1;
      while (end < limit && line.charCodeAt(end) !== QUOTE) end++;
      p = end < limit ? end + 1 : limit;
      continue;
    }
    const marker = spec.comments.length > 0 ? commentAt(line, p, spec) : null;
    if (!marker) {
      p++;
      continue;
    }
    const end = Math.max(commentEndAt(line, p, limit, marker, spec), p + 1);
    masked += line.slice(copied, p) + blanks(end - p);
    copied = end;
    p = end;
  }

  if (copied === 0) return line;
  return masked + line.slice(copied);
}
