// Select a tool segment (plan §6 M10, WP10.1; editor-core.md "Select or extract a tool
// segment"). One feature per file (plan AD-3); see ./README.md.
//
// `nav.selectToolSegment` (`Mod+F7`) selects the lines from one tool change up to the next,
// so the segment can be copied, moved, deleted or handed to a script as the selection. The
// bounds are the program map's own: a tool item's `line` and `endLine` from
// `app/outlineService.ts`, so the selection and the map cannot disagree about where a
// segment ends (a segment ends before the next tool change or the next program start).
//
// Which segment: the one under the cursor; or, when the cursor is not in any (the header
// above the first tool change), a short question for the tool number; or the number given
// to the command as an argument (`{ tool: 5 }`, for a script or the harness). A tool the
// program calls in several places has several segments; a number given as an argument takes
// the first one after the cursor and the status line says how many there are.
//
// Lines that are only blank at the end of the segment are left out of the selection, so a
// following paste or delete does not take the gap to the next tool along.

import { outline } from '$lib/app/outlineService';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import type { OutlineItem } from '$lib/core/profiles/outline';
import { editor } from '$lib/monaco/editorService';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { CommandContext, Contribution } from '$lib/app/types';

/** The tool items of the outline, in line order. */
export function toolSegments(items: readonly OutlineItem[]): OutlineItem[] {
  return items.filter((item) => item.kind === 'tool');
}

/** First and last line of a tool item's segment. */
export function boundsOf(item: OutlineItem): { first: number; last: number } {
  return { first: item.line, last: Math.max(item.line, item.endLine ?? item.line) };
}

/** The tool segment that covers `line`, or null (the header above the first tool change). */
export function segmentAt(items: readonly OutlineItem[], line: number): OutlineItem | null {
  for (const item of toolSegments(items)) {
    const { first, last } = boundsOf(item);
    if (line >= first && line <= last) return item;
  }
  return null;
}

/** A tool as one key however it is written: `'5'`, `'05'` and `'T5'` are all `'5'`. */
export function toolKey(value: string): string {
  const text = value.trim().toUpperCase().replace(/^T(?=\d)/, '');
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}

/** Whether two tool numbers as written (`'5'`, `'05'`, `'T5'`) name the same tool. */
export function sameTool(a: string, b: string): boolean {
  return toolKey(a) === toolKey(b);
}

/** Every segment of a tool, in line order. */
export function segmentsOf(items: readonly OutlineItem[], tool: string): OutlineItem[] {
  return toolSegments(items).filter((item) => item.tool !== undefined && sameTool(item.tool, tool));
}

/**
 * The segment a number asks for: the first at or after `from`, else the first (wrapping),
 * so a tool used twice is reached from either side of the cursor.
 */
export function pickSegment(found: readonly OutlineItem[], from: number): OutlineItem | null {
  if (found.length === 0) return null;
  return found.find((item) => item.line >= from) ?? found[0];
}

/** `last` without the blank lines at the end of the segment (never above `first`). */
export function trimBlankEnd(first: number, last: number, lineAt: (line: number) => string): number {
  let end = last;
  while (end > first && lineAt(end).trim() === '') end--;
  return end;
}

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

function toolFromArgument(arg: unknown): string | null {
  if (typeof arg === 'number' && Number.isFinite(arg)) return String(arg);
  if (typeof arg === 'string' && arg.trim() !== '') return arg.trim();
  if (typeof arg === 'object' && arg !== null && 'tool' in arg) return toolFromArgument((arg as { tool: unknown }).tool);
  return null;
}

/** Asks which tool, among those the program changes to. Undefined when cancelled. */
async function askTool(items: readonly OutlineItem[]): Promise<string | undefined> {
  const seen = new Set<string>();
  const choices: { label: string; value: unknown }[] = [];
  for (const item of toolSegments(items)) {
    if (item.tool === undefined) continue;
    const key = toolKey(item.tool);
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({ label: t('segments.askChoice', { tool: item.tool, line: item.line }), value: item.tool });
  }
  if (choices.length === 0) return undefined;
  const answer = await modals.form({
    title: t('segments.askTitle'),
    fields: [
      { id: 'tool', type: 'choice', label: t('segments.askLabel'), help: t('segments.askHelp'), default: choices[0].value, choices },
    ],
  });
  const tool = answer?.tool;
  return typeof tool === 'string' ? tool : undefined;
}

async function selectToolSegment(context: CommandContext, arg?: unknown): Promise<void> {
  const id = context.activeDocId ?? docs.getActiveId();
  if (id === null) return;
  // The index starts lazily and builds in chunks; answering from half of it would select
  // a segment that ends too early (the same reasoning as F7, `contrib/navigation.ts`).
  await outline.whenReady(id);
  const items = outline.snapshot(id);
  if (toolSegments(items).length === 0) {
    status.show(t('segments.noTools'));
    return;
  }

  const cursor = editor.cursor()?.line ?? 1;
  let tool = toolFromArgument(arg);
  let item: OutlineItem | null = null;
  let count = 1;
  if (tool === null) {
    item = segmentAt(items, cursor);
    if (item === null) {
      const answered = await askTool(items);
      if (answered === undefined) return;
      tool = answered;
    }
  }
  if (item === null && tool !== null) {
    const found = segmentsOf(items, tool);
    item = pickSegment(found, cursor);
    count = found.length;
    if (item === null) {
      status.show(t('segments.noSuchTool', { tool }), { error: true });
      return;
    }
  }
  if (item === null) return;

  const { first, last: raw } = boundsOf(item);
  const lastLine = Math.min(raw, editor.getLineCount(id));
  const lines = editor.getLines(id, first, lastLine);
  const last = trimBlankEnd(first, lastLine, (line) => lines[line - first] ?? '');
  const instance = editor.editorInstance();
  const model = instance?.getModel();
  if (!instance || !model) return;
  instance.setSelection({
    startLineNumber: first,
    startColumn: 1,
    endLineNumber: last,
    endColumn: model.getLineMaxColumn(last),
  });
  instance.revealLinesInCenterIfOutsideViewport(first, last);
  instance.focus();

  if (tool !== null && count > 1) status.show(t('segments.several', { tool: item.tool ?? tool, count }));
  else if (item.tool !== undefined) status.show(t('segments.selected', { tool: item.tool, first, last }));
  else status.show(t('segments.selectedNoTool', { first, last }));
}

export default {
  id: 'segments',
  commands: [
    {
      id: 'nav.selectToolSegment',
      title: 'segments.selectToolSegment',
      category: 'segments.category',
      keys: 'Mod+F7',
      global: true,
      enabled: hasDocument,
      run: (context, arg) => selectToolSegment(context, arg),
    },
  ],
  ribbon: [{ tab: 'nc', group: 'segments.group', command: 'nav.selectToolSegment', order: 80 }],
} satisfies Contribution;
