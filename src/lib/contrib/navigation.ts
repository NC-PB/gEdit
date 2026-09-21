// Go to line or block, and stepping through the tool changes (plan §5 WP3.5, §7.11:
// Ctrl+G, F7, Shift+F7). One feature per file (plan AD-3); see ./README.md.
//
// `nav.goto` replaces Monaco's `editor.action.gotoLine`: the binding removal below drops
// the built-in one, so Ctrl+G opens the gEdit prompt instead, which also understands a
// block number. The rules live in `core/nav`; this file only moves the cursor and reports
// what it could not find.
//
// F7 and Shift+F7 read the tool lines from `app/outlineService.ts`, the same index the
// program map draws, so navigation and the map can never disagree. They await the first
// build, because the index is only started by whoever asks for it first and that may be
// F7 itself (the program map is not mounted while the left region is hidden).

import { outline } from '$lib/app/outlineService';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { findBlock, nextInList, parseGotoInput } from '$lib/core/nav';
import { editor } from '$lib/monaco/editorService';
import { docs } from '$lib/stores/documents';
import { profiles } from '$lib/stores/profiles';
import { t } from '$lib/i18n';
import type { CommandContext, Contribution, DocId } from '$lib/app/types';

/** Lines read per call while searching for a block number. */
const READ_AHEAD = 4096;

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

/**
 * A 1-based line reader that fetches a window at a time.
 *
 * `findBlock` walks the document from the cursor and wraps, so one `getLines` call per
 * line would allocate an array per line of a 300k-line program.
 */
function lineReader(id: DocId): (line: number) => string {
  let from = 0;
  let window: string[] = [];
  return (line) => {
    if (line < from || line >= from + window.length) {
      from = line;
      window = editor.getLines(id, line, line + READ_AHEAD - 1);
    }
    return window[line - from] ?? '';
  };
}

async function goto(context: CommandContext): Promise<void> {
  const id = context.activeDocId;
  if (id === null) return;
  const answer = await modals.prompt({
    title: t('navigation.gotoTitle'),
    placeholder: t('navigation.gotoPlaceholder'),
    validate: (value) => (parseGotoInput(value) === null ? { key: 'navigation.gotoInvalid' } : null),
  });
  if (answer === undefined) return;
  const target = parseGotoInput(answer);
  if (target === null) return;

  const lineCount = editor.getLineCount(id);
  if (target.kind === 'line') {
    if (target.line > lineCount) {
      status.show(t('navigation.noLine', { last: lineCount }), { error: true });
      return;
    }
    editor.reveal(id, target.line);
    // A jump that worked says nothing — but it must not leave the *previous* command's
    // red error standing either, because for eight seconds that message reads as the
    // answer to this jump while the cursor says the opposite (G8 M5). Clearing is honest;
    // a confirmation for every jump would be noise.
    status.clear();
    return;
  }

  const profileId = docs.get(id)?.profileId ?? '';
  const cp = profiles.get(profileId) ? profiles.compiled(profileId) : null;
  // The cursor line is where the search starts, so a repeated Ctrl+G walks the
  // duplicates of a block number instead of finding the same one again.
  const from = editor.cursor()?.line ?? 0;
  const line = cp === null ? null : findBlock(lineReader(id), lineCount, target.number, from, cp);
  if (line === null) {
    status.show(t('navigation.noBlock', { number: target.number }), { error: true });
    return;
  }
  editor.reveal(id, line);
  status.clear();
}

async function stepTool(dir: 1 | -1): Promise<void> {
  const id = docs.getActiveId();
  if (id === null) return;
  // The index is built lazily and in chunks, and the program map is what usually starts
  // it. With the left region hidden nothing else asks, so the first F7 would read an
  // empty index and report "no tool changes" on a program full of them. Waiting for the
  // build costs a turn on a small file and one chunked build on a huge one; answering
  // from a half-built index would be wrong every time.
  await outline.whenReady(id);
  const lines = outline.toolLines(id);
  if (lines.length === 0) {
    status.show(t('navigation.noTools'));
    return;
  }
  const next = nextInList(lines, editor.cursor()?.line ?? 0, dir);
  if (next === null) return;
  editor.reveal(id, next.line);
  // The wrap is the only thing worth saying; otherwise clear, so an older error is not
  // left standing over a jump that worked. Same rule as `goto` above.
  if (next.wrapped) status.show(t(dir === 1 ? 'navigation.wrappedToFirst' : 'navigation.wrappedToLast'));
  else status.clear();
}

export default {
  id: 'navigation',
  commands: [
    {
      id: 'nav.goto',
      title: 'navigation.goto',
      category: 'navigation.category',
      keys: 'Ctrl+G',
      global: true,
      enabled: hasDocument,
      run: (context) => goto(context),
    },
    {
      id: 'nav.nextTool',
      title: 'navigation.nextTool',
      category: 'navigation.category',
      keys: 'F7',
      global: true,
      enabled: hasDocument,
      run: () => stepTool(1),
    },
    {
      id: 'nav.prevTool',
      title: 'navigation.prevTool',
      category: 'navigation.category',
      keys: 'Shift+F7',
      global: true,
      enabled: hasDocument,
      run: () => stepTool(-1),
    },
  ],
  keybindingRemovals: [{ keys: 'Ctrl+G', command: 'editor.action.gotoLine' }],
} satisfies Contribution;
