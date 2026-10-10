// The editor's own text model, headless (B1 fixperf). For tests only.
//
// `TextModel` and `UndoRedoService` are the classes the app's editor runs on. Both load in
// node; the services they ask for (language, tokenization, dialogs) are replaced by objects
// that answer every question with nothing. That is enough for what the tests here need —
// edits, undo/redo, decorations — and it means a test can state what Monaco really does
// instead of what a fake of it is told to do.
//
// Not imported by the app. Keep it out of anything under `$lib` that ships.

// @ts-expect-error — Monaco ships no type declarations for its ESM internals
import { TextModel } from 'monaco-editor/esm/vs/editor/common/model/textModel.js';
// @ts-expect-error — Monaco ships no type declarations for its ESM internals
import { UndoRedoService } from 'monaco-editor/esm/vs/platform/undoRedo/common/undoRedoService.js';

/** The slice of `ITextModel` the tests use; the real model satisfies `EditableModel` too. */
export interface RealModel {
  getLineCount(): number;
  getLineContent(line: number): string;
  getLineMaxColumn(line: number): number;
  getValue(): string;
  pushStackElement(): void;
  pushEditOperations(
    before: null,
    ops: { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; text: string }[],
    cursor: () => null,
    group?: unknown,
  ): unknown;
  deltaDecorations(old: string[], news: { range: unknown; options: Record<string, unknown> }[]): string[];
  getDecorationRange(id: string): { startLineNumber: number; endLineNumber: number } | null;
  undo(): void;
  redo(): void;
  getAlternativeVersionId(): number;
}

const nothing = () => ({ dispose() {} });
/** Answers every `on…` with a disposable and every other call with `undefined`. */
function silent(): object {
  return new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'then') return undefined;
        return typeof name === 'string' && name.startsWith('on') ? nothing : () => undefined;
      },
    },
  );
}

/** A real model holding `text` (LF), with a real undo stack of its own. */
export function realModel(text: string): RealModel {
  const options = {
    isForSimpleWidget: false,
    defaultEOL: 1,
    tabSize: 4,
    indentSize: 4,
    insertSpaces: false,
    detectIndentation: false,
    trimAutoWhitespace: false,
    largeFileOptimizations: true,
    bracketPairColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false },
  };
  const undo = new UndoRedoService({}, {});
  const instantiation = { createInstance: () => silent() };
  return new TextModel(text, 'plaintext', options, null, undo, silent(), silent(), instantiation) as RealModel;
}
