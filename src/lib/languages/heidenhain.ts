import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

export const heidenhainLanguageDef: Monaco.languages.IMonarchLanguage = {
  defaultToken: 'invalid',
  ignoreCase: true,

  keywords: [
    'BEGIN', 'PGM', 'END', 'L', 'CC', 'C', 'CR', 'CT', 'CHF', 'RND', 
    'CALL', 'CYCL', 'DEF', 'TOOL', 'M', 'STOP', 'APPR', 'DEP', 'FN'
  ],

  tokenizer: {
    root: [
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@keywords': 'keyword.directive',
          '@default': 'variable.name'
        }
      }],
      [/[XYZABCUVWR][+-]?\d*\.?\d+/, 'number.float'], // Coordinates
      [/[FSMT]\d+/, 'number.hex'], // Feed, Speed, M-Code, Tool
      [/[+-]?\d*\.?\d+/, 'number.float'],
      [/;.*$/, 'comment'], // Comments
    ]
  }
};

export function getHeidenhainCompletions(monaco: typeof Monaco): Monaco.languages.CompletionItemProvider {
  return {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const suggestions = [
        {
          label: 'CYCL DEF 200',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'CYCL DEF 200 BOHREN ~\nQ200=$1 ;SICHERHEITS-ABST. ~\nQ201=$2 ;TIEFE',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Bohrzyklus (Dummy)',
          detail: 'CYCL DEF 200 BOHREN'
        },
        {
          label: 'CYCL DEF 240',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'CYCL DEF 240 ZENTRIEREN ~\nQ200=$1 ;SICHERHEITS-ABST. ~\nQ343=$2 ;AUSWAHL DURCHM/TIEFE ~\nQ201=$3 ;TIEFE',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Zentrieren (Dummy)',
          detail: 'CYCL DEF 240 ZENTRIEREN'
        },
        {
          label: 'L',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'L X$1 Y$2 Z$3 R0 FMAX M3',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Linearbewegung (Dummy)',
          detail: 'L X.. Y.. Z..'
        }
      ];
      return { suggestions: suggestions.map((s) => ({ ...s, range })) };
    }
  };
}
