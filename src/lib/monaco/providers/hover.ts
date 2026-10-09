// Hover help for the word under the pointer (plan §5 WP3.6). Owner: WP3.6.
//
// A thin shell around `core/codes/hoverText.ts`: this file reads the line out of the
// model and turns the markdown into a Monaco hover. Every rule about *what* is said lives
// in the core module, where node tests can reach it.
//
// Security (plan §3, rule 3): the contents are built with `isTrusted: false` and
// `supportHtml: false`, and the markdown is escaped in `hoverText`, because a profile, a
// code database and the open file are data, not app code.
//
// `assist.hover` is read on every call, not at registration: the setting can change while
// the app runs, and Monaco caches nothing here. Monaco's own `hover.enabled` option is
// switched by `monaco/editorOptions.ts` from the same setting, so the hover is off on
// both sides.
//
// P3.3 (Phase 3 plan §6.5): for a document, the hover also gets its modal context — the
// block around the line (`blockRange`), the states after the line before it and after its
// last line (`modal.stateAfter`, AD-35), and the document's effective profile and machine.
// The modal service never blocks: while its index has not reached the block it answers
// null, and the hover is the Phase 2 hover until the idle build passes. Nothing is cached
// here, so a hover never shows a state from before an edit. The context is built only once
// the pointer is on a word the hover has something to say about, and not at all for a line
// longer than `MAX_INSPECT_LINE` (the inspector's rule): a minified post or a program saved
// as one line would otherwise cost the whole line's tokens on every pause of the mouse.

import { hoverAt, type HoverContext, type HoverInfo, type WaitCodeLookup } from '$lib/core/codes/hoverText';
import { blockRange } from '$lib/core/codes/inspect';
import { MAX_INSPECT_LINE } from '$lib/app/inspectorService';
import { modal } from '$lib/app/modalService';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { t } from '$lib/i18n';
import { docIdOf } from '$lib/monaco/editorService';
import { channels } from '$lib/stores/channels';
import { codes } from '$lib/stores/codes';
import { machines } from '$lib/stores/machines';
import { profiles } from '$lib/stores/profiles';
import { settings } from '$lib/stores/settings';
import type { Monaco } from '$lib/monaco/setup';
import type { Disposable, DocId, ModalService } from '$lib/app/types';
import type { EffectiveMachine } from '$lib/core/machines/types';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { LineState } from '$lib/core/nc/types';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';

/**
 * What the line above leaves behind, which is all the tokenizer needs from it: a Klartext
 * line that ends in `~` makes the next one its tail, with no block number of its own.
 */
export { viewOf };

export function stateBefore(
  model: MonacoApi.editor.ITextModel,
  lineNumber: number,
  cp: CompiledProfile,
): LineState | undefined {
  if (lineNumber <= 1) return undefined;
  return tokenizeLine(model.getLineContent(lineNumber - 1), cp).state;
}

/**
 * What a model is read with (AD-31): the effective profile and database of the **document**
 * behind it, or the profile's own when the model is not a document — a diff side, a
 * scratch model. Monaco hands a provider a model, not a document, so the way back is
 * `docIdOf`.
 */
function viewOf(
  model: MonacoApi.editor.ITextModel,
  profileId: string,
): { cp: CompiledProfile; db: CodeDb; waitCode?: WaitCodeLookup; docId: DocId | null; profile?: Profile; machine?: EffectiveMachine } {
  const docId = docIdOf(model);
  if (docId !== null) {
    const effective = machines.effective(docId);
    // M12.5 (§7.16 #178): the document's machine's wait codes win over the database.
    const waitCode: WaitCodeLookup = (letter, value) => channels.waitCodeRule(docId, letter, value);
    return { cp: effective.cp, db: effective.codes, waitCode, docId, profile: effective.profile, machine: effective.machine };
  }
  return { cp: profiles.compiled(profileId), db: codes.forProfile(profileId), docId: null };
}

/**
 * The modal context of the hovered line in document `docId` (P3.3): the block around it, the
 * state before and after it. `after` is null while the modal index has not reached the block;
 * the hover then says only what it said in Phase 2. `undefined` for a line longer than
 * `MAX_INSPECT_LINE`; a neighbour that long is read as empty (it cannot continue the block),
 * as in the inspector.
 */
export function contextOf(
  model: MonacoApi.editor.ITextModel,
  lineNumber: number,
  docId: DocId,
  view: { cp: CompiledProfile; profile: Profile; machine: EffectiveMachine },
  states: Pick<ModalService, 'stateAfter'> = modal,
): HoverContext | undefined {
  const lineCount = model.getLineCount();
  if (lineNumber >= 1 && lineNumber <= lineCount && model.getLineContent(lineNumber).length > MAX_INSPECT_LINE) return undefined;
  const getLine = (n: number): string => {
    if (n < 1 || n > lineCount) return '';
    const text = model.getLineContent(n);
    return text.length > MAX_INSPECT_LINE ? '' : text;
  };
  const { first, last } = blockRange({ line: lineNumber, lineCount, getLine }, view.cp);
  const before = states.stateAfter(docId, first - 1);
  const after = before === null ? null : states.stateAfter(docId, last);
  return {
    before,
    after,
    profile: view.profile,
    machine: view.machine,
    blockLines: { first, last, line: lineNumber, lineCount, getLine },
  };
}

/** What `viewOf` hands the hover. */
export type HoverView = ReturnType<typeof viewOf>;

/**
 * The hover at `position`: the Phase 2 hover, plus the modal context once the pointer is on a
 * word that has a hover (the context reads the block around the line and asks the index twice,
 * which a pause on a blank, a comment or a space does not need).
 */
export function hoverInfoAtPosition(
  model: MonacoApi.editor.ITextModel,
  position: { lineNumber: number; column: number },
  view: HoverView,
  states: Pick<ModalService, 'stateAfter'> = modal,
): HoverInfo | null {
  const { cp, db, waitCode, docId, profile, machine } = view;
  const line = model.getLineContent(position.lineNumber);
  const prev = stateBefore(model, position.lineNumber, cp);
  const offset = position.column - 1;
  const plain = hoverAt(line, offset, cp, db, t, prev, { waitCode });
  if (plain === null || docId === null || !profile || !machine) return plain;
  const context = contextOf(model, position.lineNumber, docId, { cp, profile, machine }, states);
  if (context === undefined) return plain;
  return hoverAt(line, offset, cp, db, t, prev, { waitCode, context });
}

/** Registers the hover provider for one profile (Monaco language id = profile id). */
export function registerHover(monaco: Monaco, profileId: string): Disposable {
  const registration = monaco.languages.registerHoverProvider(profileId, {
    provideHover(model, position) {
      if (!settings.get('assist.hover')) return null;

      const info = hoverInfoAtPosition(model, position, viewOf(model, profileId));
      if (!info) return null;

      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: info.start + 1,
          endLineNumber: position.lineNumber,
          endColumn: info.end + 1,
        },
        contents: [{ value: info.markdown, isTrusted: false, supportHtml: false }],
      };
    },
  });
  return () => registration.dispose();
}
