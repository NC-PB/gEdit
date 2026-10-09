// Typing options: upper case while typing and no accidental join of two blocks (plan AD-30,
// §6 M13 WP13.4, §7.13). One feature per file (plan AD-3); see ./README.md.
//
// The decisions are `core/nc/typing.ts`; this file reads the keyboard and the editor.
//
//   - A plain lower-case letter key becomes `editor.trigger('keyboard', 'type', { text })`
//     with the capital, so auto-closing, the suggest widget and the undo grouping stay the
//     editor's: the capital is one undo step with the keystroke, exactly like a typed letter.
//     Paste, IME composition, modifier chords and the harness's `insertText` are not keys
//     and are not touched. Cursors that disagree (one in a comment, another in code) get
//     their own text through one `executeEdits`.
//   - Backspace in column 1 and Delete at the end of a line, with an empty selection, that
//     would join two lines which both hold text are swallowed and the status bar says why;
//     removing an empty or blank line still works.
//   - Both are for NC programs only (M13 review fix CODE-3): a document whose file is a `.json`
//     or `.py` one — a profile, a code file, the settings, a script — is left to the editor, so
//     `"extends"` stays `"extends"`. The switch says so instead of doing nothing.
//   - A key press reads the least it can (CODE-7): the length of a line before its text, and
//     the neighbouring lines only at the edge where a join could happen, so a program saved as
//     one 10 MB line costs nothing per key.
//
// The compare overlay recreates the editor instance. `ensureHook` hooks the instance the
// service has at activation and again on every `editor.onDidAttach` (the service fires it
// when an `attach()` has built and bound a new instance), so a new instance is hooked before
// anyone can type into it; an instance it already hooked costs one comparison.
//
// `edit.toggleForceUppercase` is a session switch: it overrides the profile's flag for every
// document until the app closes and is never saved (§7.11). `preventLineJoin` has no switch.

import CaseUpper from 'lucide-svelte/icons/case-upper';
import { asIcon } from '$lib/app/icons';
import { status } from '$lib/app/status';
import { decideUppercase, isBlankLine, wouldJoinBlocks } from '$lib/core/nc/typing';
import type { JoinSelection, KeyInput, TypingSite } from '$lib/core/nc/typing';
import { editor } from '$lib/monaco/editorService';
import { getMonaco } from '$lib/monaco/setup';
import { isNcDocumentPath } from '$lib/core/profiles/ncDocument';
import { machines } from '$lib/stores/machines';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { Contribution, DocId } from '$lib/app/types';

/** The session switch: `null` follows each profile, a boolean overrides every profile. */
let override: boolean | null = null;

/** Whether `docId` is an NC program (not a `.json` or `.py` file): the typing options act only in one. */
export function isNcDocument(docId: DocId): boolean {
  return isNcDocumentPath(docs.get(docId)?.path);
}

/** Whether typing in `docId` is upper-cased now: the session switch, else the profile's flag. NC programs only. */
export function uppercaseOn(docId: DocId): boolean {
  if (!isNcDocument(docId)) return false;
  return override ?? machines.effective(docId).profile.editing?.forceUppercase === true;
}

/** Forgets the session switch (tests, and a fresh app state). */
export function resetUppercaseOverride(): void {
  override = null;
}

function toggle(docId: DocId | null): void {
  if (docId === null) return;
  if (!isNcDocument(docId)) {
    status.show(t('typing.notHere'));
    return;
  }
  override = !uppercaseOn(docId);
  status.show(t(override ? 'typing.upperOn' : 'typing.upperOff'));
}

// -- the editor side ------------------------------------------------------------------------

/**
 * The part of a Monaco code editor the hook uses. Spelled out so the test can supply a small
 * fake, and so a change of Monaco shows here and not in the middle of the handler.
 */
export interface TypingEditor {
  onKeyDown(listener: (e: TypingKeyEvent) => void): { dispose(): void };
  onDidCompositionStart?(listener: () => void): { dispose(): void };
  onDidCompositionEnd?(listener: () => void): { dispose(): void };
  getModel(): TypingModel | null;
  getSelections(): TypingSelection[] | null;
  trigger(source: string, handlerId: string, payload: unknown): void;
  executeEdits(
    source: string,
    edits: { range: TypingSelection; text: string; forceMoveMarkers?: boolean }[],
    cursorState?: (inverse: { range: TypingSelection }[]) => unknown[] | null,
  ): boolean;
}

export interface TypingKeyEvent {
  browserEvent: KeyInput;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface TypingModel {
  getLineContent(line: number): string;
  /** The length of a line, which Monaco answers without copying the line. */
  getLineLength(line: number): number;
  getLineCount(): number;
}

/** A normalized selection (`start` is never after `end`) with its active end. */
export interface TypingSelection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}

/** Lines longer than this are not tokenized per keystroke; the letter is left as typed. */
export const MAX_TYPING_LINE = 20000;

function isEmpty(s: TypingSelection): boolean {
  return s.startLineNumber === s.endLineNumber && s.startColumn === s.endColumn;
}

/** The text around a selection, or null when one of the lines it reads is too long to tokenize per key. */
function siteOf(model: TypingModel, s: TypingSelection): TypingSite | null {
  const above = s.startLineNumber - 1;
  if (
    model.getLineLength(s.startLineNumber) > MAX_TYPING_LINE ||
    model.getLineLength(s.endLineNumber) > MAX_TYPING_LINE ||
    (above >= 1 && model.getLineLength(above) > MAX_TYPING_LINE)
  ) {
    return null;
  }
  return {
    before: model.getLineContent(s.startLineNumber).slice(0, s.startColumn - 1),
    after: model.getLineContent(s.endLineNumber).slice(s.endColumn - 1),
    previousLine: above >= 1 ? model.getLineContent(above) : null,
  };
}

/** A line this long holds text; it is never read just to find out whether it is blank. */
function blankOf(model: TypingModel, line: number): boolean {
  return model.getLineLength(line) <= MAX_TYPING_LINE && isBlankLine(model.getLineContent(line));
}

function isLetterKey(key: string): boolean {
  return key.length === 1 && key.toUpperCase() !== key;
}

/** Everything `handleKey` needs from the app, injectable for the test. */
export interface TypingDeps {
  activeDocId(): DocId | null;
  readOnly(id: DocId): boolean;
  effective(id: DocId): { cp: Parameters<typeof decideUppercase>[2]; editing: { forceUppercase?: boolean; preventLineJoin?: boolean } };
  uppercaseOn(id: DocId): boolean;
  /** False for a document that is not an NC program (`.json`, `.py`): no typing option acts there. */
  applies(id: DocId): boolean;
  hint(text: string): void;
  /** The `Selection` class for the end state of `executeEdits`; `null` until Monaco has loaded. */
  makeSelection(line: number, column: number): unknown | null;
}

/**
 * One key press. Returns true when it was taken over (the default is prevented). The cheap
 * tests come first: this runs for every key the user presses.
 */
export function handleKey(
  instance: TypingEditor,
  e: TypingKeyEvent,
  composing: boolean,
  deps: TypingDeps,
): boolean {
  const k = e.browserEvent;
  const isDeletion = k.key === 'Backspace' || k.key === 'Delete';
  if (!isDeletion && !isLetterKey(k.key)) return false;
  const id = deps.activeDocId();
  if (id === null || deps.readOnly(id) || !deps.applies(id)) return false;
  const model = instance.getModel();
  const selections = instance.getSelections();
  if (!model || !selections || selections.length === 0) return false;

  if (isDeletion) {
    const effective = deps.effective(id);
    if (effective.editing.preventLineJoin !== true) return false;
    const backspace = k.key === 'Backspace';
    const lineCount = model.getLineCount();
    const joins: JoinSelection[] = selections.map((s) => {
      const line = s.positionLineNumber;
      const lineLength = model.getLineLength(line);
      const empty = isEmpty(s);
      // Only a cursor at the edge where a join could happen needs the text of its line and of
      // the neighbour; every other selection is answered from the lengths alone.
      const atEdge = empty && (backspace ? s.positionColumn === 1 && line > 1 : s.positionColumn === lineLength + 1 && line < lineCount);
      if (!atEdge) {
        return { empty, line, column: s.positionColumn, lineLength, lineBlank: false, neighbourBlank: false };
      }
      const neighbour = backspace ? line - 1 : line + 1;
      return {
        empty,
        line,
        column: s.positionColumn,
        lineLength,
        lineBlank: blankOf(model, line),
        neighbourBlank: neighbour < 1 || neighbour > lineCount || blankOf(model, neighbour),
      };
    });
    if (!wouldJoinBlocks(k, joins, model.getLineCount(), composing)) return false;
    e.preventDefault();
    e.stopPropagation();
    deps.hint(t('typing.noJoin'));
    return true;
  }

  if (!deps.uppercaseOn(id)) return false;
  const sites: TypingSite[] = [];
  for (const s of selections) {
    const site = siteOf(model, s);
    if (site === null) return false;
    sites.push(site);
  }
  const decision = decideUppercase(k, sites, deps.effective(id).cp, true, composing);
  if (decision.kind === 'pass') return false;
  if (decision.kind === 'type') {
    e.preventDefault();
    e.stopPropagation();
    instance.trigger('keyboard', 'type', { text: decision.text });
    return true;
  }
  // The cursors disagree. Without the Selection class (Monaco still loading) the key goes
  // through as typed; in practice the class is there long before the first key.
  if (deps.makeSelection(1, 1) === null) return false;
  e.preventDefault();
  e.stopPropagation();
  instance.executeEdits(
    'keyboard',
    selections.map((s, i) => ({ range: s, text: decision.texts[i] ?? k.key, forceMoveMarkers: true })),
    (inverse) =>
      inverse.map((op) => deps.makeSelection(op.range.endLineNumber, op.range.endColumn)).filter((s) => s !== null),
  );
  return true;
}

// -- wiring ---------------------------------------------------------------------------------

let hookedInstance: unknown;
let hookDisposables: { dispose(): void }[] = [];
let selectionCtor: (new (a: number, b: number, c: number, d: number) => unknown) | null = null;

function realDeps(): TypingDeps {
  return {
    activeDocId: () => docs.getActiveId(),
    readOnly: (id) => docs.get(id)?.readOnly === true,
    effective: (id) => {
      const eff = machines.effective(id);
      return { cp: eff.cp, editing: eff.profile.editing ?? {} };
    },
    uppercaseOn,
    applies: isNcDocument,
    hint: (text) => status.show(text),
    makeSelection: (line, column) => (selectionCtor ? new selectionCtor(line, column, line, column) : null),
  };
}

function hook(instance: TypingEditor, deps: TypingDeps): { dispose(): void }[] {
  let composing = false;
  const out: { dispose(): void }[] = [];
  out.push(instance.onKeyDown((e) => void handleKey(instance, e, composing, deps)));
  const start = instance.onDidCompositionStart?.(() => (composing = true));
  const end = instance.onDidCompositionEnd?.(() => (composing = false));
  if (start) out.push(start);
  if (end) out.push(end);
  return out;
}

function ensureHook(): void {
  const instance = editor.editorInstance();
  if (!instance || instance === hookedInstance) return;
  hookedInstance = instance;
  for (const d of hookDisposables.splice(0)) d.dispose();
  hookDisposables = hook(instance as unknown as TypingEditor, realDeps());
  void getMonaco().then((monaco) => {
    selectionCtor = monaco.Selection as unknown as typeof selectionCtor;
  });
}

export default {
  id: 'typing',
  commands: [
    {
      id: 'edit.toggleForceUppercase',
      title: 'typing.toggleForceUppercase',
      category: 'typing.category',
      icon: asIcon(CaseUpper),
      enabled: (c) => c.activeDocId !== null && isNcDocument(c.activeDocId),
      run: (c) => toggle(c.activeDocId),
    },
  ],
  ribbon: [{ tab: 'home', group: 'typing.group', command: 'edit.toggleForceUppercase', order: 125 }],
  activate() {
    const attached = editor.onDidAttach(ensureHook);
    // An editor that was attached before this activation.
    ensureHook();
    return () => {
      attached();
      for (const d of hookDisposables.splice(0)) d.dispose();
      hookedInstance = undefined;
    };
  },
} satisfies Contribution;
