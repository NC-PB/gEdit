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
          documentation: 'Drilling cycle: feed to depth Z, then rapid out. Stays active until G80.\nR: plane where the rapid approach ends and the feed starts',
          detail: 'G81 X.. Y.. Z.. R.. F..'
        },
        {
          label: 'G82',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'G82 X$1 Y$2 Z$3 R$4 P$5 F$6',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Drilling cycle with a dwell at the bottom, e.g. for spot facing. Stays active until G80.\nP: dwell time in milliseconds',
          detail: 'G82 X.. Y.. Z.. R.. P.. F..'
        },
        {
          label: 'G83',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'G83 X$1 Y$2 Z$3 R$4 Q$5 F$6',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Peck drilling cycle: drills in steps and returns to the R plane after each step to clear the chips. Stays active until G80.\nQ: depth of each peck',
          detail: 'G83 X.. Y.. Z.. R.. Q.. F..'
        },
        {
          label: 'G84',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'G84 X$1 Y$2 Z$3 R$4 P$5 F$6',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Tapping cycle: feed in, reverse the spindle at the bottom, feed back out. Stays active until G80.\nP: dwell at the bottom in milliseconds\nF: feed that matches the thread pitch',
          detail: 'G84 X.. Y.. Z.. R.. P.. F..'
        },
        {
          label: 'G85',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'G85 X$1 Y$2 Z$3 R$4 F$5',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Boring cycle: feed in and feed back out, e.g. for reaming. Stays active until G80.',
          detail: 'G85 X.. Y.. Z.. R.. F..'
        }
      ];
      return { suggestions: suggestions.map((s) => ({ ...s, range })) };
    }
  };
}
