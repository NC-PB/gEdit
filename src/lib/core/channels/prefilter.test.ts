// The lookbehind prefilter (M12 performance fix F2/F3). WebKit runs a pattern with a
// lookbehind in its slow interpreter; the prefilter is the pattern without it, which must
// match every line the pattern matches (it only lets lines through to the pattern).

import { describe, expect, it } from 'vitest';
import { waitCodeWordRe } from './codes';
import { execAfterNonWord, lookbehindPrefilter, quickExec, quickTest, unguardedWordRe, withoutLookbehind } from './prefilter';

describe('withoutLookbehind', () => {
  it('puts an empty group where each lookbehind was and keeps the rest', () => {
    expect(withoutLookbehind('(?<![A-Za-z_])([M])[ \\t]*(\\d+)(?![\\d.]|[ \\t]*=)')).toBe('(?:)([M])[ \\t]*(\\d+)(?![\\d.]|[ \\t]*=)');
    expect(withoutLookbehind('(?<![A-Z0-9.])(?<channel>G0?1[34])(?![\\d.])')).toBe('(?:)(?<channel>G0?1[34])(?![\\d.])');
    expect(withoutLookbehind('(?<=N\\d+ )M(?<mark>\\d+)')).toBe('(?:)M(?<mark>\\d+)');
    // A lookbehind inside another is taken out with it.
    expect(withoutLookbehind('(?<=a(?<!b)c)x')).toBe('(?:)x');
  });

  it('reads escapes and character classes, not just parentheses', () => {
    expect(withoutLookbehind('\\((?<!x)y[(?<!]z')).toBe('\\((?:)y[(?<!]z');
    expect(withoutLookbehind('[\\]](?<!q)r')).toBe('[\\]](?:)r');
  });

  it('keeps the pieces around a lookbehind apart, so they cannot join into another token (PERF-1)', () => {
    // Taken out outright, `{` and `2}` became the quantifier `{2}`, `\x4` and `1` the escape
    // `\x41` (`A`): the prefilter rejected the very text the pattern accepts.
    const cases: [string, string][] = [
      ['a{(?<=\\{)2}', 'a{2}'],
      ['\\x4(?<=4)1', 'x41'],
      ['\\u00(?<=0)41', 'u0041'],
      ['\\c(?<=c)A', '\\cA'],
      ['\\0(?<=\\0)1', '\u00001'],
      ['M{1(?<=1),2}', 'M{1,2}'],
    ];
    for (const [source, line] of cases) {
      for (const flags of ['', 'i']) {
        const re = new RegExp(source, flags);
        expect(re.test(line), `${source} on ${line}`).toBe(true);
        expect(lookbehindPrefilter(re)?.test(line), `${source} on ${line}`).toBe(true);
        expect(quickTest(re, line), `${source} on ${line}`).toBe(true);
      }
    }
  });

  it('has nothing to take out, or declines where taking it out would not keep every match', () => {
    expect(withoutLookbehind('^O21\\d\\d(?![\\d.])')).toBeNull(); // no lookbehind: the pattern is fast as it is
    expect(withoutLookbehind('a(?!b(?<=xb))')).toBeNull(); // inside a negative assertion
    expect(withoutLookbehind('(a)(?<!b)\\1')).toBeNull(); // a back reference
    expect(withoutLookbehind('(?<n>a)(?<!b)\\k<n>')).toBeNull();
    expect(withoutLookbehind('(?<!a')).toBeNull(); // not closed
  });
});

describe('lookbehindPrefilter', () => {
  const samples = ['M901 P12', 'XM901', 'M 902', 'm903', 'G01 X1. M9001', 'M2=3', '(M901)', 'N10M904', 'M901.5', '', 'G13', 'G013 X1', 'AG13', 'G130'];

  it('matches every line the pattern matches, for the built-in and preset patterns', () => {
    const patterns = [
      waitCodeWordRe([{ letter: 'M', from: 900, to: 999 }]) as RegExp,
      /(?<![A-Z0-9.])(?<channel>G0?1[34])(?![\d.])/i,
      /(?<![A-Za-z_])M1(\d{2,2})(?![\d.]|[ \t]*=)/i,
    ];
    for (const re of patterns) {
      const pre = lookbehindPrefilter(re);
      expect(pre, re.source).not.toBeNull();
      expect(pre?.flags).not.toContain('g');
      for (const line of samples) {
        re.lastIndex = 0;
        if (re.test(line)) expect(pre?.test(line), `${re.source} on ${line}`).toBe(true);
        expect(quickTest(re, line), `${re.source} on ${line}`).toBe((re.lastIndex = 0, re.test(line)));
        expect(quickExec(re, line)?.[0] ?? null).toBe((re.lastIndex = 0, re.exec(line)?.[0] ?? null));
      }
    }
  });

  it('has none for a pattern without a lookbehind, or with the v flag', () => {
    expect(lookbehindPrefilter(/^O21\d\d/)).toBeNull();
    expect(lookbehindPrefilter(new RegExp('(?<!a)b', 'v'))).toBeNull();
  });
});

describe('execAfterNonWord', () => {
  it('finds exactly the matches of the guarded pattern', () => {
    const guarded = waitCodeWordRe([{ letter: 'M', from: 1, to: 999 }]) as RegExp;
    const bare = unguardedWordRe(guarded) as RegExp;
    expect(bare.source.startsWith('(?<!')).toBe(false);
    const all = (re: RegExp, text: string, next: (re: RegExp, text: string) => RegExpExecArray | null) => {
      const out: string[] = [];
      re.lastIndex = 0;
      for (let m = next(re, text); m !== null; m = next(re, text)) out.push(`${m.index}:${m[0]}`);
      return out;
    };
    for (const text of ['M901 P12', 'XM901 M902', 'AM1M2', 'M1M2 _M3 m4', 'N10M904', 'MM5', 'M2=3 M7', '']) {
      expect(all(bare, text, execAfterNonWord), text).toEqual(all(guarded, text, (re, t) => re.exec(t)));
    }
  });

  it('is only for a pattern that starts with the word guard and has no other lookbehind', () => {
    expect(unguardedWordRe(/M\d+/g)).toBeNull();
    expect(unguardedWordRe(/(?<![A-Za-z_])M(?<=M)\d/g)).toBeNull();
    expect(unguardedWordRe(/(?<![A-Za-z_])P/i)?.flags).toBe('gi');
  });
});
