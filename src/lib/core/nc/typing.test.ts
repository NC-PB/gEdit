// The typing decisions of AD-30 (plan §6 M13 WP13.4): which typed letters become capitals,
// and which Backspace / Delete would join two blocks.
//
// Every program line is synthetic. A line is written with `|` where the cursor is; the
// letter is typed there, and the tokenizer reads the line with the letter in it, so a
// comment or a string opened earlier on the line counts. The five built-in dialects are
// compiled from their shipped JSON, which is also what pins "upper case on every control".

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { decideUppercase, isBlankLine, keepsCase, uppercaseOf, wouldJoinBlocks } from './typing';
import type { JoinSelection, KeyInput, TypingSite } from './typing';

const raw = (id: string): Profile => BUILTIN_PROFILE_JSON.find((p) => (p as Profile).id === id) as Profile;
const profile = (id: string): CompiledProfile => compileProfile(raw(id));

const fanuc = profile('fanuc-gcode');
const lathe = profile('fanuc-lathe');
const okuma = profile('okuma-osp');
const sinumerik = profile('sinumerik');
const mill = profile('sinumerik-mill');
const klartext = profile('heidenhain-klartext');

/** A site from `before|after` and the optional line above. */
function site(marked: string, previousLine: string | null = null): TypingSite {
  const at = marked.indexOf('|');
  return { before: marked.slice(0, at), after: marked.slice(at + 1), previousLine };
}

const key = (k: string, rest: Partial<KeyInput> = {}): KeyInput => ({ key: k, ...rest });

/** What typing `ch` at the marked place gives: the capital, or the letter as typed. */
function typed(cp: CompiledProfile, marked: string, ch = 'x', previousLine: string | null = null): string {
  const d = decideUppercase(key(ch), [site(marked, previousLine)], cp, true);
  return d.kind === 'type' ? d.text : ch;
}

/** Types `text` left to right at `|`, one key at a time, as a user writes a new block. */
function typeLtr(cp: CompiledProfile, marked: string, text: string): string {
  const at = marked.indexOf('|');
  let before = marked.slice(0, at);
  const after = marked.slice(at + 1);
  for (const ch of text) before += /[a-z]/.test(ch) ? typed(cp, `${before}|${after}`, ch) : ch;
  return before + after;
}

describe('uppercaseOf: which keys are letters', () => {
  it('turns a plain lower-case letter into its capital', () => {
    expect(uppercaseOf(key('g'))).toBe('G');
    expect(uppercaseOf(key('x', { shiftKey: false }))).toBe('X');
    expect(uppercaseOf(key('ä'))).toBe('Ä');
  });

  it.each([
    ['an upper-case letter', key('G')],
    ['a digit', key('1')],
    ['a symbol', key('.')],
    ['a named key', key('Enter')],
    ['a dead key', key('Dead')],
    ['a letter whose capital is two letters', key('ß')],
    ['Ctrl+letter', key('c', { ctrlKey: true })],
    ['Cmd+letter', key('c', { metaKey: true })],
    ['Alt+letter (macOS Option)', key('m', { altKey: true })],
    ['AltGr (Ctrl+Alt on Windows)', key('µ', { ctrlKey: true, altKey: true })],
    ['a key the browser says is composing', key('a', { isComposing: true })],
    ['key code 229 (an IME has the key)', key('a', { keyCode: 229 })],
    ['key "Process"', key('Process')],
  ])('leaves %s alone', (_name, k) => {
    expect(uppercaseOf(k)).toBeNull();
  });

  it('leaves every key alone while the editor says a composition is running', () => {
    expect(uppercaseOf(key('a'), true)).toBeNull();
    expect(decideUppercase(key('a'), [site('G1 |')], fanuc, true, true)).toEqual({ kind: 'pass' });
  });
});

describe('forced upper case in code and what it leaves alone', () => {
  it('upper-cases a letter in code in every built-in dialect', () => {
    for (const cp of [fanuc, lathe, okuma, sinumerik, mill, klartext]) {
      expect(typed(cp, 'N10 |', 'g'), cp.profile.id).toBe('G');
      expect(typed(cp, 'N10 G1 |', 'x'), cp.profile.id).toBe('X');
    }
  });

  it('does nothing when the option is off or there is no cursor', () => {
    expect(decideUppercase(key('g'), [site('N10 |')], fanuc, false)).toEqual({ kind: 'pass' });
    expect(decideUppercase(key('g'), [], fanuc, true)).toEqual({ kind: 'pass' });
  });

  describe('Fanuc, Fanuc lathe and Okuma: parenthesis comments', () => {
    it.each([
      ['inside an open comment', 'G1 X1 (check |', 'x'],
      ['inside an open comment, text after the cursor', 'G1 X1 (check |) Z5', 'x'],
      ['in the middle of a closed comment', 'G1 (rough| cut) Z5', 'x'],
      ['right after the opening parenthesis', 'G1 (|', 'x'],
      ['in a comment of its own line', '(|)', 'x'],
      ['in a comment that runs to the end of the line', 'G1 X1 (unfinished note |', 'x'],
    ])('keeps a letter typed %s', (_name, marked, ch) => {
      for (const cp of [fanuc, lathe, okuma]) expect(typed(cp, marked, ch), cp.profile.id).toBe(ch);
    });

    it.each([
      ['after a closed comment', 'G1 (note) |'],
      ['before a comment', 'G1 | (note)'],
      ['touching the closing parenthesis', 'G1 (note)|'],
      ['before a comment that follows', 'G1 X1 |(note)'],
    ])('capitalises a letter typed %s', (_name, marked) => {
      for (const cp of [fanuc, lathe, okuma]) expect(typed(cp, marked), cp.profile.id).toBe('X');
    });

    it('reads a comment that is opened earlier in the same line, not in the line above', () => {
      expect(typed(fanuc, 'G1 |', 'x', '(a note that never closes')).toBe('X');
    });
  });

  describe('Okuma: the $ header line and its comments', () => {
    it('capitalises the program name of a $ header line', () => {
      expect(typed(okuma, '$FLA|NGE.MIN%', 'n')).toBe('N');
      expect(typed(okuma, '$|', 'f')).toBe('F');
    });

    it('keeps a comment that follows a $ line', () => {
      expect(typed(okuma, '$ X10 (chuck |)', 'j')).toBe('j');
      expect(typed(okuma, '$ X10 (chuck) |', 'j')).toBe('J');
    });
  });

  describe('Sinumerik: semicolon comments and strings', () => {
    it.each([
      ['a semicolon comment', 'G1 X1 ; finish |'],
      ['right after the semicolon', 'G1 X1 ;|'],
      ['a semicolon comment on a line of its own', '; roug|h'],
      ['a message string', 'MSG("check |")'],
      ['an unclosed string', 'MSG("check |'],
      ['a tool name string', 'T="drill |"'],
      ['right after the opening quote', 'T="|"'],
    ])('keeps a letter typed in %s', (_name, marked) => {
      expect(typed(sinumerik, marked, 'q')).toBe('q');
      expect(typed(mill, marked, 'q')).toBe('q');
    });

    it.each([
      ['outside the message after its closing quote', 'MSG("hello") |'],
      ['after the closing quote of a tool name', 'T="drill" |'],
      ['in front of a comment', 'G1 | ; note'],
    ])('capitalises a letter typed %s', (_name, marked) => {
      expect(typed(sinumerik, marked, 'q')).toBe('Q');
    });

    it('counts quotes inside a call or a word, a doubled quote included, and only where the profile has strings', () => {
      expect(typed(sinumerik, 'MSG("say ""hi|"" now")')).toBe('x');
      expect(typed(sinumerik, 'MSG("say ""hi"" now") |')).toBe('X');
      expect(typed(sinumerik, 'CYCLE82(10,|)')).toBe('X');
      // Fanuc has no strings: a stray quote is only a character.
      expect(typed(fanuc, 'G1 "|')).toBe('X');
    });

    it('lets a quote opened just before count', () => {
      // The quote is already in the text; the letter is its first character.
      expect(typed(sinumerik, 'MSG("|', 'h')).toBe('h');
    });
  });

  describe('Klartext: semicolon comments, strings and kept text', () => {
    it.each([
      ['a comment', '10 L X+5 ; mill |'],
      ['a string in a tool call', '4 TOOL CALL "drill|" Z S2000'],
      ['an unclosed string', '4 TOOL CALL "dril|'],
      ['the program name of BEGIN PGM', '0 BEGIN PGM par|t MM'],
      ['the program name of END PGM', '9 END PGM par|t MM'],
      ['a cycle name of CYCL DEF', '12 CYCL DEF 1.0 DRIL|L'],
      ['an FN 16 path', '14 FN 16: F-PRINT TNC:\\out\\ch|eck.A'],
      ['the program of CALL PGM', '15 CALL PGM part|2'],
    ])('keeps a letter typed in %s', (_name, marked) => {
      expect(typed(klartext, marked, 'q')).toBe('q');
    });

    it.each([
      ['an axis word', '10 L X+5 |'],
      ['a keyword position', '11 |'],
      ['after the program name, at its unit', '0 BEGIN PGM part |'],
      ['after a closed string', '4 TOOL CALL "drill" |'],
    ])('capitalises a letter typed in %s', (_name, marked) => {
      expect(typed(klartext, marked, 'q')).toBe('Q');
    });

    // M13 review NC-7 (owner, 2026-10-09: names untouched). A name typed left to right,
    // before its unit, is text too; the unit after it is code again.
    it('keeps a program name typed left to right, before the unit is there', () => {
      expect(typed(klartext, '0 BEGIN PGM pa|', 'q')).toBe('q');
      expect(typed(klartext, '9 END PGM pa|', 'q')).toBe('q');
      expect(typed(klartext, '0 BEGIN PGM pa| MM', 'q')).toBe('q');
      expect(typeLtr(klartext, '0 BEGIN PGM |', 'part1 mm')).toBe('0 BEGIN PGM part1 MM');
      expect(typeLtr(klartext, '9 END PGM |', 'part1 inch')).toBe('9 END PGM part1 INCH');
    });

    it('keeps the program of a cycle 12 call, and the code around it upper case', () => {
      expect(typed(klartext, '6 CYCL DEF 12.1 PGM |', 'p')).toBe('p');
      expect(typeLtr(klartext, '6 CYCL DEF 12.1 PGM |', 'part2')).toBe('6 CYCL DEF 12.1 PGM part2');
      expect(typeLtr(klartext, '5 |', 'l x+0')).toBe('5 L X+0');
    });

    it('reads the tail of a continued line like any other line', () => {
      // The previous line ends with the continuation marker, so this line is its tail; the
      // tokenizer is given that state, and for these lines it changes no answer.
      expect(typed(klartext, '  |', 'x', '10 L X+5 ~')).toBe('X');
      expect(typed(klartext, '  FN 16: F-PRINT x|', 'q', '10 L X+5 ~')).toBe('q');
    });
  });

  // M13 review NC-7, owner decision of 2026-10-09 (d): a Fanuc program name keeps its case.
  describe('a Fanuc program name in place of a number', () => {
    it('keeps the name typed left to right, closed or not, and the code around it upper case', () => {
      expect(typeLtr(fanuc, 'M98 <|', 'sub_a')).toBe('M98 <sub_a');
      expect(typeLtr(fanuc, 'M98 <|>', 'sub_a')).toBe('M98 <sub_a>');
      expect(typeLtr(fanuc, '|', 'm98 <sub_a> (call)')).toBe('M98 <sub_a> (call)');
      expect(typeLtr(lathe, '|', '<shaft_t12>')).toBe('<shaft_t12>');
      expect(typeLtr(fanuc, 'N10 M98 <ab> |', 'x1.')).toBe('N10 M98 <ab> X1.');
    });

    it('keeps editing an existing name', () => {
      expect(typed(fanuc, '<SHA|FT>', 'x')).toBe('x');
      expect(typed(fanuc, 'G65 <ab|> A1.', 'c')).toBe('c');
    });

    it('does not reach the headers other controls write in upper case', () => {
      expect(typed(okuma, '$NAM|.MIN%', 'e')).toBe('E');
      expect(typed(sinumerik, '%_N_PAR|_MPF', 't')).toBe('T');
    });
  });

  describe('keepsCase', () => {
    it('answers for the character as typed, not for the text without it', () => {
      // Without the letter `MSG("|` has an empty string; with it the string covers the letter.
      expect(keepsCase(site('MSG("|'), 'h', sinumerik)).toBe(true);
      expect(keepsCase(site('MSG(|'), 'h', sinumerik)).toBe(false);
    });
  });
});

describe('forced upper case with several cursors and a selection', () => {
  it('types one capital when every cursor is in code', () => {
    expect(decideUppercase(key('x'), [site('G1 |'), site('G2 |')], fanuc, true)).toEqual({ kind: 'type', text: 'X' });
  });

  it('leaves the key to the editor when every cursor is in a comment', () => {
    expect(decideUppercase(key('x'), [site('(a |)'), site('(b |)')], fanuc, true)).toEqual({ kind: 'pass' });
  });

  it('gives each cursor its own text when they disagree', () => {
    expect(decideUppercase(key('x'), [site('G1 |'), site('(note |)'), site('G3 |')], fanuc, true)).toEqual({
      kind: 'perCursor',
      texts: ['X', 'x', 'X'],
    });
  });

  it('reads a selection as replaced by the letter: the text after it is the tail of the end line', () => {
    // The selection `ote` of `(note) G1` is replaced: `(n|) G1`, so the letter is in the comment.
    expect(typed(fanuc, '(n|) G1')).toBe('x');
    // A selection that spans lines starts in the comment of its first line and ends in code:
    // the merged line is `(open |G1 X5`, still a comment, and the letter stays as typed.
    expect(typed(fanuc, '(open |G1 X5')).toBe('x');
    // The mirror image: the selection starts in code and ends in a comment's tail.
    expect(typed(fanuc, 'G1 |note) Z5')).toBe('X');
  });

  it('does not tokenize a very long line', () => {
    // The contrib refuses such a line before it asks; the decision itself still answers.
    const long = `G1 ${'X1 '.repeat(5000)}|`;
    expect(typed(fanuc, long)).toBe('X');
  });
});

describe('wouldJoinBlocks', () => {
  const sel = (
    line: number,
    column: number,
    lineLength: number,
    empty = true,
    blank: { line?: boolean; neighbour?: boolean } = {},
  ): JoinSelection => ({
    empty,
    line,
    column,
    lineLength,
    lineBlank: blank.line ?? false,
    neighbourBlank: blank.neighbour ?? false,
  });

  it('refuses Backspace at column 1 with an empty selection', () => {
    expect(wouldJoinBlocks(key('Backspace'), [sel(5, 1, 10)], 20)).toBe(true);
    expect(wouldJoinBlocks(key('Backspace', { shiftKey: true }), [sel(5, 1, 10)], 20)).toBe(true);
  });

  it('lets Backspace through everywhere else', () => {
    expect(wouldJoinBlocks(key('Backspace'), [sel(5, 2, 10)], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Backspace'), [sel(1, 1, 10)], 20)).toBe(false); // nothing above to join
  });

  it('refuses Delete at the end of a line, but not in the middle and not on the last line', () => {
    expect(wouldJoinBlocks(key('Delete'), [sel(5, 11, 10)], 20)).toBe(true);
    expect(wouldJoinBlocks(key('Delete'), [sel(5, 10, 10)], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Delete'), [sel(20, 11, 10)], 20)).toBe(false);
  });

  it('lets an empty or blank line be removed: only two lines that both hold text are refused', () => {
    // Backspace in column 1 of an empty line, and of a text line under an empty one.
    expect(wouldJoinBlocks(key('Backspace'), [sel(5, 1, 0, true, { line: true })], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Backspace'), [sel(5, 1, 10, true, { neighbour: true })], 20)).toBe(false);
    // Delete at the end of an empty line, and of a text line above an empty one.
    expect(wouldJoinBlocks(key('Delete'), [sel(5, 1, 0, true, { line: true })], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Delete'), [sel(5, 11, 10, true, { neighbour: true })], 20)).toBe(false);
    // The same two text lines are still refused.
    expect(wouldJoinBlocks(key('Backspace'), [sel(5, 1, 10)], 20)).toBe(true);
    expect(wouldJoinBlocks(key('Delete'), [sel(5, 11, 10)], 20)).toBe(true);
  });

  it('refuses the key press with several cursors only when one would join two text lines', () => {
    const blank = sel(3, 1, 0, true, { line: true });
    expect(wouldJoinBlocks(key('Backspace'), [blank, sel(7, 1, 4, true, { neighbour: true })], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Backspace'), [blank, sel(9, 1, 6)], 20)).toBe(true);
  });

  it('knows a blank line', () => {
    expect([isBlankLine(''), isBlankLine('  \t'), isBlankLine(' G1'), isBlankLine('(note)')]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('never refuses a selection, also one that spans a line break', () => {
    // Backspace over a selection that starts in column 1 and one whose end is a line end.
    expect(wouldJoinBlocks(key('Backspace'), [sel(5, 1, 10, false)], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Delete'), [sel(5, 11, 10, false)], 20)).toBe(false);
  });

  it('refuses when any of several cursors would join, and not when only selections are there', () => {
    expect(wouldJoinBlocks(key('Backspace'), [sel(3, 4, 9), sel(5, 1, 10)], 20)).toBe(true);
    expect(wouldJoinBlocks(key('Backspace'), [sel(3, 1, 9, false), sel(5, 1, 10, false)], 20)).toBe(false);
  });

  it('looks at no deletion during a composition', () => {
    expect(wouldJoinBlocks(key('Backspace', { isComposing: true }), [sel(5, 1, 10)], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Delete', { isComposing: true }), [sel(5, 11, 10)], 20)).toBe(false);
  });

  // M13 review CODE-12 (owner, 2026-10-09): a word or line deletion in column 1 or at the line
  // end takes the line break too.
  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Cmd', { metaKey: true }],
  ])('refuses the word-delete chord %s with Backspace and Delete at a join of two text lines', (_name, rest) => {
    expect(wouldJoinBlocks(key('Backspace', rest), [sel(5, 1, 10)], 20)).toBe(true);
    expect(wouldJoinBlocks(key('Delete', rest), [sel(5, 11, 10)], 20)).toBe(true);
    // Inside the line, at an empty line and over a selection the chord works as always.
    expect(wouldJoinBlocks(key('Backspace', rest), [sel(5, 4, 10)], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Delete', rest), [sel(5, 4, 10)], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Backspace', rest), [sel(5, 1, 10, true, { neighbour: true })], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Backspace', rest), [sel(5, 1, 10, false)], 20)).toBe(false);
  });

  it('leaves Shift+Delete (Cut) and every other key alone', () => {
    expect(wouldJoinBlocks(key('Delete', { shiftKey: true }), [sel(5, 11, 10)], 20)).toBe(false);
    expect(wouldJoinBlocks(key('a'), [sel(5, 1, 10)], 20)).toBe(false);
    expect(wouldJoinBlocks(key('Enter'), [sel(5, 1, 10)], 20)).toBe(false);
  });

  it('refuses nothing while the editor says a composition is running', () => {
    expect(wouldJoinBlocks(key('Backspace'), [sel(5, 1, 10)], 20, true)).toBe(false);
  });
});

describe('the built-in profiles', () => {
  it('ask for both options on every control', () => {
    for (const id of ['fanuc-gcode', 'fanuc-lathe', 'okuma-osp', 'sinumerik', 'sinumerik-mill', 'heidenhain-klartext']) {
      expect(raw(id).editing, id).toMatchObject({ forceUppercase: true, preventLineJoin: true });
    }
  });
});

describe('cost of a keystroke', () => {
  it('decides a letter in well under a millisecond', () => {
    // The P1 typing budget is the 95th percentile of a keystroke < 50 ms in the whole
    // editor; this decision is the part this package adds to every letter.
    const sites = [site('N0010 G01 X-12.345 Y67.89 Z-1. F250. (rough pass, check the clamp) M08 |')];
    const ms = fastest(5, () => {
      for (let i = 0; i < 100; i++) decideUppercase(key('x'), sites, fanuc, true);
    });
    expectWithin(ms / 100, 1, 'one letter decision');
    const sink = [site('MSG("a message that runs on and on") ; and a trailing comment |')];
    expectWithin(
      fastest(5, () => {
        for (let i = 0; i < 100; i++) decideUppercase(key('x'), sink, sinumerik, true);
      }) / 100,
      1,
      'one letter decision, Sinumerik',
    );
  });
});
