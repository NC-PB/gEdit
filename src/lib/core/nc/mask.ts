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
//
// Two spans are stepped over without being blanked, so that nothing inside them can open
// a comment — the same two the tokenizer reads in one piece:
//
//   - A string. `MSG("A;B")` is one Sinumerik call and the `;` in it is text, not the
//     start of a comment (P8, AD-24).
//   - A file header (`syntax.header`: `$PART.MIN%`, `%_N_PART_MPF`). It is one program
//     marker, and detection reads it, so it must survive the mask whole.
//
// A program name (`syntax.programNames`: Fanuc `<SHAFT_T12>`) is neither blanked nor kept.
// The control reads its characters like comment text, so no code pattern may find a word
// in it — `T12` is no tool change and `M30` no end — yet the program-start and call rules
// of the map have to see that a name stands there. Each letter and digit becomes `_` and
// everything else stays, so `<SHAFT-T12>` masks as `<_____-___>`. Not as blanks: a run of
// blanks is how the map finds a comment, and the name would become a tool's description.
// The map reads the name itself off the real line, at the offsets the mask keeps.

import type { CompiledProfile } from '$lib/core/profiles/types';
import { commentAt, commentEndAt, lexSpec, programNameEndAt } from './tokenizer';

const QUOTE = 0x22;

function blanks(count: number): string {
  return count > 0 ? ' '.repeat(count) : '';
}

/** A program name as the mask writes it: every letter and digit `_`, the rest as it is. */
function maskName(name: string): string {
  return name.replace(/[A-Za-z0-9]/g, '_');
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

  if (spec.header && p === 0) {
    const match = spec.header.exec(line);
    if (match && match.index === 0 && match[0].length > 0) p = Math.min(match[0].length, limit);
  }

  // Whole-line fast path (G7): a CAM post writes almost every line with no comment, no
  // string and no program name, so most of the time nothing between `p` and `limit` can
  // start a span the mask changes. `maskLeadPattern` (`tokenizer.ts`) holds every character
  // that could — the loop below can only ever act on one of those — so when none of them
  // appear, the loop would just walk to `limit` doing nothing, and skipping it straight to
  // the same return the loop would reach is one native scan instead of a function call at
  // every character. `null` means the program-name pattern has no literal lead (a regex
  // marker) and the fast path cannot be trusted, so every such profile takes the loop.
  if (p < limit && spec.maskLeadPattern) {
    spec.maskLeadPattern.lastIndex = p;
    const found = spec.maskLeadPattern.exec(line);
    if (found === null || found.index >= limit) {
      return copied === 0 ? line : masked + line.slice(copied);
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
      const nameEnd = programNameEndAt(line, p, limit, spec);
      if (nameEnd > p) {
        masked += line.slice(copied, p) + maskName(line.slice(p, nameEnd));
        copied = nameEnd;
        p = nameEnd;
        continue;
      }
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
