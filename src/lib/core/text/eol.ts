// Line-ending detection (plan §7.2, AD-7). Pure: no Svelte, no Monaco, no Tauri.

import type { Eol } from '$lib/app/types';

const CR = 0x0d;
const LF = 0x0a;

/** The character sequence of a line ending. */
export const EOL_TEXT: Record<Eol, string> = { crlf: '\r\n', lf: '\n', cr: '\r' };

/** The character a line of this ending ends with, which is what a 1-based line number counts. */
export const EOL_BREAK_CHAR: Record<Eol, string> = { crlf: '\n', lf: '\n', cr: '\r' };

/**
 * How `text` breaks its lines. `eol` is the ending to write the document with: the
 * majority one, and CRLF when the majority is shared with CRLF. `mixed` says that more
 * than one kind occurs; `eol` is null only when the text has no line break at all.
 */
export function detectEol(text: string): {
  eol: Eol | null;
  mixed: boolean;
  counts: { crlf: number; lf: number; cr: number };
} {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === CR) {
      if (text.charCodeAt(i + 1) === LF) {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (code === LF) {
      lf++;
    }
  }

  const counts = { crlf, lf, cr };
  const kinds = [crlf, lf, cr].filter((n) => n > 0).length;
  if (kinds === 0) return { eol: null, mixed: false, counts };

  // Preference order on a tie: CRLF first, so a tie that CRLF takes part in goes to CRLF.
  const best = Math.max(crlf, lf, cr);
  const eol: Eol = crlf === best ? 'crlf' : lf === best ? 'lf' : 'cr';
  return { eol, mixed: kinds > 1, counts };
}

/** `textLF` with every LF replaced by the line ending of `eol`. */
export function joinEol(textLF: string, eol: Eol): string {
  return eol === 'lf' ? textLF : textLF.split('\n').join(EOL_TEXT[eol]);
}

/** `text` with CRLF and lone CR turned into LF, which is how a document is held in memory. */
export function toLf(text: string, counts?: { crlf: number; cr: number }): string {
  if (counts && counts.crlf === 0 && counts.cr === 0) return text;
  if (counts && counts.cr === 0) return text.split('\r\n').join('\n');
  return text.replace(/\r\n?/g, '\n');
}
