// Bookmarks: toggle, next, previous and clear (plan §5 WP4.4, §7.11: Mod+F2, F2,
// Shift+F2). One feature per file (plan AD-3); see ./README.md.
//
// The three shortcuts are Monaco's own: F2 is Rename Symbol and Mod+F2 is Change All
// Occurrences, neither of which means anything in an NC program. The removals below drop
// them, so the keys are free for the bookmarks — and they are removals rather than a
// silent overlap, because two commands on one key are a conflict the registry reports as
// a `console.error` and the runtime harness fails on. Select All Occurrences keeps
// Mod+Shift+L (§7.11).
//
// The arithmetic is in `core/nav/bookmarks.ts` and the decorations in
// `monaco/bookmarks.ts`; this file is the keyboard, the palette and the status messages.
// `activate()` is also where the decoration service is handed the Monaco enums it needs:
// `getMonaco()` after `editor.ready` loads nothing early (the editor already has it) and
// nothing twice (it is the same memoized promise) — the same shape `contrib/assistant.ts`
// uses, and the reason README rule 10 allows it.
//
// No ribbon entries, on purpose: bookmarks are a keyboard feature and F1 lists all four
// commands, exactly as `contrib/navigation.ts` (Ctrl+G, F7) does for the other half of
// navigation.

import { status } from '$lib/app/status';
import { bookmarks } from '$lib/monaco/bookmarks';
import { editor } from '$lib/monaco/editorService';
import { getMonaco } from '$lib/monaco/setup';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { CommandContext, Contribution, Disposable } from '$lib/app/types';

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

/** The bookmarks of the active document, or null when there is no document. */
function linesOfActive(): number[] | null {
  const id = docs.getActiveId();
  return id === null ? null : bookmarks.lines(id);
}

function step(dir: 1 | -1): void {
  const lines = linesOfActive();
  if (lines === null) return;
  if (lines.length === 0) {
    status.show(t('bookmarks.none'));
    return;
  }
  if (dir === 1) bookmarks.next();
  else bookmarks.prev();
  // The cursor is the feedback. What must not stay on screen is the *previous* command's
  // message — "Bookmark set." after a jump, or a red "The program ends at line 38." — which
  // for its whole timeout reads as the answer to the jump just made (G8 M5).
  status.clear();
}

function toggle(): void {
  const id = docs.getActiveId();
  if (id === null) return;
  const before = bookmarks.lines(id).length;
  bookmarks.toggle();
  const after = bookmarks.lines(id).length;
  // The glyph in the margin is the real feedback; the message is for the case where the
  // margin is off screen, and it says which way the toggle went.
  if (after > before) status.show(t('bookmarks.set'));
  else if (after < before) status.show(t('bookmarks.removed'));
}

function clear(): void {
  const id = docs.getActiveId();
  if (id === null) return;
  const count = bookmarks.lines(id).length;
  if (count === 0) {
    status.show(t('bookmarks.none'));
    return;
  }
  bookmarks.clear(id);
  status.show(t('bookmarks.cleared', { count }));
}

export default {
  id: 'bookmarks',
  commands: [
    {
      id: 'bookmark.toggle',
      title: 'bookmarks.toggle',
      category: 'bookmarks.category',
      keys: 'Mod+F2',
      global: true,
      enabled: hasDocument,
      run: () => toggle(),
    },
    {
      id: 'bookmark.next',
      title: 'bookmarks.next',
      category: 'bookmarks.category',
      keys: 'F2',
      global: true,
      enabled: hasDocument,
      run: () => step(1),
    },
    {
      id: 'bookmark.prev',
      title: 'bookmarks.prev',
      category: 'bookmarks.category',
      keys: 'Shift+F2',
      global: true,
      enabled: hasDocument,
      run: () => step(-1),
    },
    {
      id: 'bookmark.clear',
      title: 'bookmarks.clear',
      category: 'bookmarks.category',
      global: true,
      enabled: hasDocument,
      run: () => clear(),
    },
  ],
  keybindingRemovals: [
    { keys: 'F2', command: 'editor.action.rename' },
    { keys: 'Mod+F2', command: 'editor.action.changeAll' },
  ],
  activate(): Disposable {
    let uninstall: Disposable | undefined;
    let stopped = false;

    void (async () => {
      await editor.ready;
      const monaco = await getMonaco();
      if (stopped) return;
      uninstall = bookmarks.install(monaco);
    })().catch(() => {
      // `editor.ready` never rejects, and a Monaco that cannot be loaded is already
      // reported by EditorHost. A second message here would only be noise — and a console
      // error fails the runtime harness.
    });

    return () => {
      stopped = true;
      uninstall?.();
      uninstall = undefined;
    };
  },
} satisfies Contribution;
