// A cheap "cannot match" test for a pattern with a lookbehind (M12 performance fix F2/F3).
//
// WebKit's regex engine (the app's JavaScript engine on macOS) runs a pattern that holds a
// lookbehind (`(?<!…)`, `(?<=…)`) in its interpreter, not its compiler: on a 300,000-line
// program the wait-code pattern `(?<![A-Za-z_])([M])[ \t]*(\d+)…` took 168 ms against 4 ms for
// the same pattern without the lookbehind, and the resolution of one document took 240 ms
// against 55 ms in node. Most lines of a CAM program are motion lines that no channel pattern
// matches, so the answer is a prefilter: the pattern with its lookbehinds taken out.
//
// Taking out an assertion only drops a condition, so the prefilter matches every line the
// pattern matches (and maybe more): a line the prefilter rejects is a line the pattern
// rejects, and the pattern itself still decides every line the prefilter lets through. The
// result is therefore exactly the pattern's, only faster. That holds while the lookbehind
// is not inside a negative assertion (`(?!…(?<=x)…)`: dropping it there would make the
// negation reject more) and while no back reference can point into what was taken out; in
// those cases, and for anything this small parser does not follow, there is no prefilter.

const cache = new WeakMap<RegExp, RegExp | null>();

type Group = 'capture' | 'plain' | 'ahead' | 'notAhead' | 'behind' | 'notBehind';

/**
 * The source with every lookbehind replaced by an empty group `(?:)`, or null when there is none to take out or it
 * is not safe to (see the file comment).
 */
export function withoutLookbehind(source: string): string | null {
  if (/\\[1-9]|\\k</.test(source)) return null; // a back reference: group numbers would move
  const stack: { kind: Group; start: number }[] = [];
  const cuts: [number, number][] = [];
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '(') {
      let kind: Group = 'capture';
      if (source.startsWith('(?<!', i)) kind = 'notBehind';
      else if (source.startsWith('(?<=', i)) kind = 'behind';
      else if (source.startsWith('(?!', i)) kind = 'notAhead';
      else if (source.startsWith('(?=', i)) kind = 'ahead';
      else if (source.startsWith('(?:', i)) kind = 'plain';
      else if (source[i + 1] === '?' && source[i + 2] !== '<') return null; // a modifier group or anything unknown
      if ((kind === 'behind' || kind === 'notBehind') && stack.some((g) => g.kind === 'notAhead' || g.kind === 'notBehind')) return null;
      stack.push({ kind, start: i });
      continue;
    }
    if (c === ')') {
      const group = stack.pop();
      if (group === undefined) return null;
      const outer = stack.some((g) => g.kind === 'behind' || g.kind === 'notBehind');
      if ((group.kind === 'behind' || group.kind === 'notBehind') && !outer) {
        if (/[*+?{]/.test(source[i + 1] ?? '')) return null; // a quantified assertion: not followed
        cuts.push([group.start, i + 1]);
      }
    }
  }
  if (inClass || stack.length > 0 || cuts.length === 0) return null;
  // Each lookbehind becomes an empty group, never nothing (M12 perf review PERF-1): taken out
  // outright, the pieces on either side can join into another token. In a pattern without
  // the `u` flag `a{(?<=\{)2}` reads the text `a{2}`, but `a{2}` is "two a"; `\x4(?<=4)1`
  // reads `x41`, but `\x41` is `A` (the same with `\u`, `\c` and `\0`). `(?:)` matches the
  // empty text as the assertion would when it holds, keeps the pieces apart, and costs
  // nothing in WebKit's compiled engine.
  let out = '';
  let from = 0;
  for (const [start, end] of cuts) {
    out += `${source.slice(from, start)}(?:)`;
    from = end;
  }
  return out + source.slice(from);
}

/**
 * The prefilter of `re` (same flags, never global or sticky), or null when `re` holds no
 * lookbehind or none can be taken out. `prefilter.test(line) === false` means `re` does not
 * match `line` either.
 */
export function lookbehindPrefilter(re: RegExp): RegExp | null {
  if (cache.has(re)) return cache.get(re) ?? null;
  let out: RegExp | null = null;
  // The `v` flag's nested classes are more than this parser follows.
  const source = re.flags.includes('v') ? null : withoutLookbehind(re.source);
  if (source !== null) {
    try {
      out = new RegExp(source, re.flags.replace(/[gyd]/g, ''));
    } catch {
      out = null;
    }
  }
  cache.set(re, out);
  return out;
}

/** `re.test(text)`, through the prefilter when there is one; `lastIndex` is reset first. */
export function quickTest(re: RegExp, text: string): boolean {
  const pre = lookbehindPrefilter(re);
  if (pre !== null && !pre.test(text)) return false;
  re.lastIndex = 0;
  return re.test(text);
}

/** `re.exec(text)`, through the prefilter when there is one; `lastIndex` is reset first. */
export function quickExec(re: RegExp, text: string): RegExpExecArray | null {
  const pre = lookbehindPrefilter(re);
  if (pre !== null && !pre.test(text)) return null;
  re.lastIndex = 0;
  return re.exec(text);
}

/** The guard gEdit's own word patterns start with: not after a letter or `_`. */
const WORD_GUARD = '(?<![A-Za-z_])';

/**
 * A global pattern that starts with `(?<![A-Za-z_])` (a code word, a partner word) without
 * that guard, for `execAfterNonWord`; null when `re` is not of that form. The guard is checked
 * by hand there, which WebKit runs compiled, so a wait line costs what a motion line costs.
 */
export function unguardedWordRe(re: RegExp): RegExp | null {
  if (!re.source.startsWith(WORD_GUARD)) return null;
  const rest = re.source.slice(WORD_GUARD.length);
  if (rest.includes('(?<!') || rest.includes('(?<=')) return null;
  return new RegExp(rest, re.flags.includes('g') ? re.flags : `${re.flags}g`);
}

/**
 * The next match of `bare` (from `unguardedWordRe`) at or after its `lastIndex` that is not
 * right after a letter or `_` — exactly the next match of the guarded pattern: a candidate
 * after a letter is skipped and the search goes on one character later, as the guarded
 * pattern's own search does.
 */
export function execAfterNonWord(bare: RegExp, text: string): RegExpExecArray | null {
  for (let m = bare.exec(text); m !== null; m = bare.exec(text)) {
    const c = m.index > 0 ? text.charCodeAt(m.index - 1) : -1;
    if (!(c === 95 || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return m;
    bare.lastIndex = m.index + 1;
  }
  return null;
}
