import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

export const fanucLanguageDef: Monaco.languages.IMonarchLanguage = {
  defaultToken: 'invalid',
  ignoreCase: true,

  tokenizer: {
    root: [
      [/O\d+/, 'keyword'], // Program number
      [/[N:]\d+/, 'type'], // Line numbers
      [/[GM]\d+/, 'keyword.directive'], // G or M codes
      [/[XYZABCIJKR]\s*[-+]?\d*\.?\d+/, 'number.float'], // Coordinates/Axes
      [/[SFT]\d+/, 'number.hex'], // Spindle, Feed, Tool
      [/#\d+/, 'variable.name'], // Macros / Variables
      [/\(.*\)/, 'comment'], // Comments
      [/%.*/, 'comment.doc'] // Start/End signs
    ]
  }
};

export function getFanucCompletions(monaco: typeof Monaco): Monaco.languages.CompletionItemProvider {
  return {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const suggestions = [
        {
          label: 'G81',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'G81 X$1 Y$2 Z$3 R$4 F$5',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Einfacher Bohrzyklus',
          detail: 'G81 X.. Y.. Z.. R.. F..'
        },
        {
          label: 'G82',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'G82 X$1 Y$2 Z$3 R$4 P$5 F$6',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Bohrzyklus mit Verweilzeit\nP: Verweilzeit (in ms)',
          detail: 'G82 X.. Y.. Z.. R.. P.. F..'
        },
        {
          label: 'G83',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'G83 X$1 Y$2 Z$3 R$4 Q$5 F$6',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Tieflochbohrzyklus (mit Entspanen)\nQ: Zustelltiefe',
          detail: 'G83 X.. Y.. Z.. R.. Q.. F..'
        },
        {
          label: 'G84',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'G84 X$1 Y$2 Z$3 R$4 P$5 F$6',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Gewindebohrzyklus',
          detail: 'G84 X.. Y.. Z.. R.. P.. F..'
        },
        {
          label: 'G85',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'G85 X$1 Y$2 Z$3 R$4 F$5',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Ausbohrzyklus',
          detail: 'G85 X.. Y.. Z.. R.. F..'
        }
      ];
      return { suggestions: suggestions.map((s) => ({ ...s, range })) };
    }
  };
}
