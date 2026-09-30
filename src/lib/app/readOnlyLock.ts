// The read-only lock for writers that are not typing (M7, AD-23; TODO Next up 6).
//
// Monaco's `readOnly` option stops the keyboard, a paste, a completion accept and every
// editor action, because they all go through the editor. The NC transforms and a script's
// `replace` result do not: they write the model directly (`monaco/applyLines.ts`), so the
// editor option never sees them. Each of those writers asks here first, **before** it runs,
// so a locked program is refused without computing a result that then has nowhere to go —
// and a result bound for a new tab, a report or the Output panel is not a change and is
// never refused.
//
// Reload from disk is deliberately not a writer this covers: the lock keeps a hand off a
// proven program, and the file on disk is that program (docs/user/guide.md, Read-only).

import type { DocMeta, Msg } from '$lib/app/types';

/** The two refusals, one per reason for the lock; the i18n test checks both exist. */
export const LOCK_REFUSAL_KEYS = ['readOnly.refusedUser', 'readOnly.refusedAttribute'] as const;

/**
 * The refusal `action` gets on `doc`, or null when the document can be changed.
 *
 * `action` is display text (a transform's translated title, a script's label). The message
 * names the lock and how to lift it; the wording follows the reason, because unlocking a
 * file that is read-only on disk frees the buffer and nothing else (AD-23).
 */
export function lockRefusal(doc: Pick<DocMeta, 'readOnly' | 'readOnlyReason' | 'title'>, action: string): Msg | null {
  if (!doc.readOnly) return null;
  const key = doc.readOnlyReason === 'attribute' ? LOCK_REFUSAL_KEYS[1] : LOCK_REFUSAL_KEYS[0];
  return { key, params: { name: doc.title, action } };
}
