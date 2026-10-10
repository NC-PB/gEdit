// `monarchSim.ts` against Monaco's own Monarch lexer (B1-G).
//
// The grammar tests run the rules through `monarchSim.ts`, a small copy of Monarch's loop,
// because it is quick and says which rule broke which invariant. A copy can drift from the
// original, and the states the Sinumerik `DEF` rules use (`switchTo`, `@rematch`, `@popall`)
// are the part of Monarch the generated grammars used least. So this test runs the real
// `MonarchTokenizer` of the installed Monaco, headless (it needs only a few services, faked
// below), over the corpus of every dialect — line after line, with the state it hands on —
// and requires the same role for every character as the copy gives.

import { describe, expect, it } from 'vitest';
// @ts-expect-error — Monaco ships no type declarations for its ESM internals
import { compile } from 'monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js';
// @ts-expect-error — Monaco ships no type declarations for its ESM internals
import { MonarchTokenizer } from 'monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js';
import { rolePerChar } from './monarchSim';
import { DIALECTS, corpus } from './testCorpus';

interface Token {
  offset: number;
  type: string;
}

/** The real tokenizer of Monaco for one grammar, with the services it asks for faked. */
function realTokenizer(id: string, grammar: unknown) {
  const languages = {
    getLanguageIdByLanguageName: () => null,
    getLanguageIdByMimeType: () => null,
    requestBasicLanguageFeatures() {},
    isRegisteredLanguageId: () => false,
  };
  const configuration = { getValue: () => 20000, onDidChangeConfiguration: () => ({ dispose() {} }) };
  return new MonarchTokenizer(languages, {}, id, compile(id, grammar), configuration);
}

/** The role of every character of `line` as Monaco's tokenizer gives it (`''` for none). */
function roles(tokens: Token[], id: string, length: number): string[] {
  const out: string[] = [];
  tokens.forEach((token, i) => {
    const end = i + 1 < tokens.length ? tokens[i + 1].offset : length;
    const role = token.type.endsWith(`.${id}`) ? token.type.slice(0, -id.length - 1) : token.type;
    for (let at = token.offset; at < end; at++) out.push(role);
  });
  return out;
}

describe("the copy of Monarch's loop agrees with Monaco's own", () => {
  it.each(DIALECTS.map((dialect) => dialect.id))('%s: the same role for every character, line after line', (id) => {
    const dialect = DIALECTS.find((entry) => entry.id === id)!;
    const real = realTokenizer(id, dialect.grammar);
    let state = real.getInitialState();
    let lines = 0;
    for (const { line } of corpus(dialect)) {
      const result = real.tokenize(line, true, state);
      state = result.endState;
      expect(roles(result.tokens as Token[], id, line.length), JSON.stringify(line)).toEqual(rolePerChar(dialect.grammar, line));
      lines += 1;
    }
    expect(lines).toBeGreaterThan(60);
  });

  it('leaves the state of the next line alone: the end of a DEF line is the base state', () => {
    const dialect = DIALECTS.find((entry) => entry.id === 'sinumerik')!;
    const real = realTokenizer('sinumerik', dialect.grammar);
    let state = real.getInitialState();
    const seen: string[][] = [];
    for (const line of ['DEF INT A, B', 'N10 G1 X10', 'GOTOF:20', 'DEF REAL C[2,', 'X5']) {
      const result = real.tokenize(line, true, state);
      state = result.endState;
      seen.push((result.tokens as Token[]).map((token) => token.type));
    }
    expect(seen[1]).toEqual(['blockNumber.sinumerik', '', 'gcode.sinumerik', '', 'axis.sinumerik']);
    expect(seen[2]).toEqual(['keyword.sinumerik', 'operator.sinumerik', 'number.sinumerik']);
    expect(seen[4]).toEqual(['axis.sinumerik']);
  });
});
