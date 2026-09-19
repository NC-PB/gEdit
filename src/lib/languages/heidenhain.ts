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

// A control writes cycle names and ";" labels in its dialog language; the snippets below use German.
const GERMAN_LABELS = '\nThe cycle name and the ";" labels are inserted in German, the way a control set to German writes them.';

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
          documentation:
            'Drilling cycle 200, short form: inserts only Q200 (safety clearance) and Q201 (depth). Add the other cycle parameters as needed.' +
            GERMAN_LABELS,
          detail: 'CYCL DEF 200 Q200=.. Q201=..'
        },
        {
          label: 'CYCL DEF 240',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'CYCL DEF 240 ZENTRIEREN ~\nQ200=$1 ;SICHERHEITS-ABST. ~\nQ343=$2 ;AUSWAHL DURCHM/TIEFE ~\nQ201=$3 ;TIEFE',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation:
            'Centering cycle 240, short form: inserts only Q200 (safety clearance), Q343 (0 = to depth, 1 = to diameter) and Q201 (depth). Add the other cycle parameters as needed.' +
            GERMAN_LABELS,
          detail: 'CYCL DEF 240 Q200=.. Q343=.. Q201=..'
        },
        {
          label: 'L',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'L X$1 Y$2 Z$3 R0 FMAX M3',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Straight move to X, Y, Z at rapid traverse (FMAX), without radius compensation (R0), spindle on clockwise (M3).',
          detail: 'L X.. Y.. Z.. R0 FMAX M3'
        }
      ];
      return { suggestions: suggestions.map((s) => ({ ...s, range })) };
    }
  };
}
