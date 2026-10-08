// Wait codes as an NC programmer writes them (the owner's decision of 2026-10-07, §10.1):
// `M100-M199, M300 M350`, `P1-9999`. Implemented by the M12 prelude (P12) because the
// resolution (`marks.ts`), the machine page's live preview and its validation (WP12.3) all
// read the same list; owned by WP12.1 from Wave A on.
//
// The grammar, in full:
//   - items are separated by commas, semicolons or blanks;
//   - an item is an address letter and a whole number (`M300`), or a range `from-to`,
//     inclusive, whose second letter may be left out (`M100-199`) and may have blanks
//     around the dash (`M100 - M199`); an en or em dash, which a text field on macOS may
//     put in for `-`, is read as the dash;
//   - leading zeros are read the way the control reads a code word: `M0100` is `M100`;
//   - blanks between the letter and its digits are allowed, as in a program (`M 900` is
//     `M900`; M12 review fix NC-10);
//   - letters are case-insensitive and stored upper case.
// A word without digits between two codes (`M900 to M999`) is answered with how to write a
// range (`rangeWord`), not with "not a number".
// Anything else is an error that quotes the item, in plain words. A list with an error is
// not used (the channels are, without that rule); the rest of the machine is unaffected.

import type { Msg } from '$lib/app/types';
import type { ParsedWaitCodes, SyncRule, WaitCodeRange } from './types';

/** The largest value a code word may carry (Fanuc: eight digits, parameter 8110/8111). */
export const MAX_WAIT_CODE = 99_999_999;

/** How many items one list may hold. */
export const MAX_WAIT_CODE_ITEMS = 64;

const ITEM = /^([A-Za-z])(\S*?)(?:-([A-Za-z])?(\S*))?$/;
const DIGITS = /^\d+$/;

function err(key: string, params: Record<string, string | number>): Msg {
  return { key: `channels.codes.${key}`, params };
}

/**
 * Parses the machine page's text. `letters` are the address letters this control's waits
 * may use (`MachineParamsDecl.channels.waitLetters`, upper case); absent = any letter.
 */
export function parseWaitCodes(text: string, o: { letters?: readonly string[] } = {}): ParsedWaitCodes {
  const ranges: WaitCodeRange[] = [];
  const errors: Msg[] = [];
  const allowed = o.letters?.map((l) => l.toUpperCase());
  const items = text
    .replace(/\s*[-\u2013\u2014]\s*/g, '-')
    // `M 900` is the code M900, as the program reader reads it; only a lone letter joins.
    .replace(/(^|[\s,;-])([A-Za-z])[ \t]+(?=\d)/g, '$1$2')
    .split(/[\s,;]+/)
    .filter((item) => item !== '');

  if (items.length === 0) return { ranges, errors: [err('empty', {})] };
  if (items.length > MAX_WAIT_CODE_ITEMS) {
    return { ranges, errors: [err('tooMany', { max: MAX_WAIT_CODE_ITEMS })] };
  }

  const code = /^[A-Za-z]\d+$/;
  for (const [index, item] of items.entries()) {
    if (!/\d/.test(item) && index > 0 && index < items.length - 1 && code.test(items[index - 1]) && code.test(items[index + 1])) {
      errors.push(err('rangeWord', { item, example: `${items[index - 1]}-${items[index + 1]}` }));
      continue;
    }
    const m = ITEM.exec(item);
    if (!m) {
      errors.push(err('noLetter', { item }));
      continue;
    }
    const letter = m[1].toUpperCase();
    const fromText = m[2];
    const isRange = item.includes('-');
    const toLetter = m[3]?.toUpperCase();
    const toText = isRange ? (m[4] ?? '') : fromText;

    if (!DIGITS.test(fromText) || !DIGITS.test(toText)) {
      errors.push(err('notNumber', { item }));
      continue;
    }
    if (toLetter !== undefined && toLetter !== letter) {
      errors.push(err('letterMismatch', { item }));
      continue;
    }
    if (allowed !== undefined && !allowed.includes(letter)) {
      errors.push(err('letter', { item, letters: allowed.join(', ') }));
      continue;
    }
    const from = Number(fromText);
    const to = Number(toText);
    if (from > MAX_WAIT_CODE || to > MAX_WAIT_CODE) {
      errors.push(err('tooLarge', { item, max: MAX_WAIT_CODE }));
      continue;
    }
    if (from > to) {
      errors.push(err('backwards', { item }));
      continue;
    }
    ranges.push({ letter, from, to });
  }
  return { ranges: errors.length > 0 ? [] : mergeRanges(ranges), errors };
}

/** Sorted by letter and start, overlapping and touching ranges joined. */
export function mergeRanges(ranges: readonly WaitCodeRange[]): WaitCodeRange[] {
  const sorted = [...ranges].sort((a, b) => a.letter.localeCompare(b.letter) || a.from - b.from);
  const out: WaitCodeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.letter === r.letter && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

/**
 * The preview line of the machine page: `M100 … M199, M300` and how many codes that is.
 * The text is data (codes are never translated); the page wraps it in its own sentence.
 */
export function describeWaitCodes(ranges: readonly WaitCodeRange[]): { text: string; count: number } {
  const merged = mergeRanges(ranges);
  const text = merged
    .map((r) => (r.from === r.to ? `${r.letter}${r.from}` : `${r.letter}${r.from} … ${r.letter}${r.to}`))
    .join(', ');
  const count = merged.reduce((sum, r) => sum + (r.to - r.from + 1), 0);
  return { text, count };
}

/** True when the word `letter` + `value` is one of `ranges`. */
export function isWaitCode(ranges: readonly WaitCodeRange[], letter: string, value: number): boolean {
  const upper = letter.toUpperCase();
  return ranges.some((r) => r.letter === upper && value >= r.from && value <= r.to);
}

/**
 * A regex that finds the candidate words of `ranges` on a masked line, read the way the
 * control and gEdit's tokenizer read a code word: one of the letters, not preceded by a
 * letter or `_`, blanks allowed between the letter and the digits (`M 901` is `M901`),
 * then digits that are not followed by a digit or a point (so `M101.5` and the `M1` of
 * `M1001` are not words of `M1-M999`) and that are not assigned to (`M2=3` is the M3 of
 * spindle 2 on Sinumerik, not the code `M2`). Global and case-insensitive; group 1 is the
 * letter, group 2 the digits. `null` for an empty list.
 */
export function waitCodeWordRe(ranges: readonly WaitCodeRange[]): RegExp | null {
  const letters = [...new Set(ranges.map((r) => r.letter))].filter((l) => /^[A-Z]$/.test(l));
  if (letters.length === 0) return null;
  return new RegExp(`(?<![A-Za-z_])([${letters.join('')}])[ \\t]*(\\d+)(?![\\d.]|[ \\t]*=)`, 'gi');
}

/**
 * The id of a code word: its letter upper case and its value without leading zeros, so
 * `m0901`, `M 901` and `M901` are the one code `M901`, as they are at the control.
 */
export function waitCodeId(letter: string, digits: string): string {
  const value = digits.replace(/^0+(?=\d)/, '');
  return `${letter.toUpperCase()}${value}`;
}

/** Parsed lists by their text, so a hover does not parse a machine's list on every call. */
const PARSED = new Map<string, ParsedWaitCodes>();
const PARSED_CAP = 64;

function parsedOf(codes: string): ParsedWaitCodes {
  let parsed = PARSED.get(codes);
  if (parsed === undefined) {
    parsed = parseWaitCodes(codes);
    if (PARSED.size >= PARSED_CAP) PARSED.clear();
    PARSED.set(codes, parsed);
  }
  return parsed;
}

/**
 * M12.5 (§7.16 #178, decision 4): the first rule of `rules` whose plain `codes` list names the
 * code word `letter` + `value` (`M198` in `M190-M199`), or `null`. Only a `codes` rule answers:
 * a `regex` rule (`WAITM(…)`) is a call the code database describes correctly, and a `prefix`
 * rule is the Advanced form. A list with an error answers nothing, as it finds no mark
 * (`findMarks`). `value` is the word's number as the control reads it (`M0198` is 198); a
 * value that is not a whole number (`M198.5`) is no code word of a list.
 */
export function waitCodeRuleOf(rules: readonly SyncRule[], letter: string, value: number): SyncRule | null {
  if (!Number.isInteger(value) || value < 0 || !/^[A-Za-z]$/.test(letter)) return null;
  for (const rule of rules) {
    if (rule.match.kind !== 'codes' || typeof rule.match.codes !== 'string') continue;
    const parsed = parsedOf(rule.match.codes);
    if (parsed.errors.length === 0 && isWaitCode(parsed.ranges, letter, value)) return rule;
  }
  return null;
}
