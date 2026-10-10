// A faithful, small copy of the inner loop of Monaco's Monarch lexer, for the tests of the
// generated grammars (`monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js`).
// Monaco itself is never imported by `core/` (AD-1): it pulls in a DOM and half a megabyte of
// contributions. Not used by the app; only the `*.test.ts` files of this folder import it.
//
// What it reproduces, because a generated grammar can go wrong exactly there:
//   - a rule is compiled as `'^(?:' + source + ')'`; a leading `^` makes it line-start-only and
//     is stripped; the rule is matched against the rest of the line only (so: no lookbehind)
//   - the first rule that matches wins; an `include` pulls in the rules of another state
//   - a group action needs one capture group per action, and the groups must cover the match
//   - `switchTo`, `next` (a state name, `@pop`, `@popall`) and the token `@rematch`
//   - the invariants Monarch throws on: a rule that makes no progress, groups that do not add
//     up, a pop from the base state, an undefined state

export interface MonarchLike {
  defaultToken: string;
  ignoreCase: boolean;
  tokenizer: Record<string, unknown[]>;
}

/** What one stretch of the line was given. `role` is the token of the action, `''` for none. */
export interface Emitted {
  text: string;
  role: string;
}

interface Step {
  token: string;
  next?: string;
  switchTo?: string;
}

interface Compiled {
  source: string;
  lineStart: boolean;
  re: RegExp;
  action: Step | Step[];
}

const CACHE = new WeakMap<object, Map<string, Compiled[]>>();

function step(action: unknown): Step {
  return typeof action === 'string' ? { token: action } : (action as Step);
}

function rulesOf(grammar: MonarchLike, state: string, seen: string[] = []): Compiled[] {
  let byState = CACHE.get(grammar);
  if (!byState) CACHE.set(grammar, (byState = new Map()));
  const cached = byState.get(state);
  if (cached) return cached;
  const entries = grammar.tokenizer[state];
  if (!entries) throw new Error(`tokenizer state is not defined: ${state}`);
  if (seen.includes(state)) throw new Error(`include loop: ${[...seen, state].join(' > ')}`);
  const out: Compiled[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry)) {
      out.push(...rulesOf(grammar, (entry as { include: string }).include, [...seen, state]));
      continue;
    }
    const [source, action] = entry as [string, unknown];
    const lineStart = source.startsWith('^');
    out.push({
      source,
      lineStart,
      re: new RegExp(`^(?:${lineStart ? source.slice(1) : source})`, grammar.ignoreCase ? 'i' : ''),
      action: Array.isArray(action) ? action.map(step) : step(action),
    });
  }
  byState.set(state, out);
  return out;
}

interface Frame {
  state: string;
  parent: Frame | null;
  depth: number;
}

function frames(stack: readonly string[]): Frame {
  let top: Frame = { state: stack[0] ?? 'root', parent: null, depth: 1 };
  for (const state of stack.slice(1)) top = { state, parent: top, depth: top.depth + 1 };
  return top;
}

function names(top: Frame): string[] {
  const out: string[] = [];
  for (let at: Frame | null = top; at; at = at.parent) out.unshift(at.state);
  return out;
}

/** Monarch's tokenizer loop for one line, from the state stack `stack` (default: the base state). */
export function monarchRun(grammar: MonarchLike, line: string, stack: readonly string[] = ['root']): { tokens: Emitted[]; stack: string[] } {
  const out: Emitted[] = [];
  let top = frames(stack);
  let pos = 0;
  let evaluate = true; // an empty line is evaluated once, as Monaco does
  let steps = 0;

  while (evaluate || pos < line.length) {
    evaluate = false;
    if (++steps > 4 * line.length + 64) throw new Error(`tokenizer does not terminate on ${JSON.stringify(line)}`);
    const rest = line.slice(pos);
    const hit = rulesOf(grammar, top.state).find((rule) => (rule.lineStart ? pos === 0 : true) && rule.re.test(rest));
    if (!hit) {
      // Monarch advances one character with `defaultToken` when nothing matches.
      if (pos < line.length) out.push({ text: line[pos], role: grammar.defaultToken });
      pos += 1;
      continue;
    }
    const matches = rest.match(hit.re) as RegExpMatchArray;
    const matched = matches[0];
    const actions = Array.isArray(hit.action) ? hit.action : [hit.action];
    if (Array.isArray(hit.action)) {
      if (matches.length !== actions.length + 1) throw new Error(`group count of ${hit.source}: ${matches.length - 1} groups, ${actions.length} actions`);
      let covered = 0;
      for (let i = 1; i < matches.length; i++) {
        if (matches[i] === undefined) throw new Error(`a group did not take part in ${hit.source}`);
        covered += matches[i].length;
      }
      if (covered !== matched.length) throw new Error(`groups must cover the whole match of ${hit.source}`);
    }

    let rematch = false;
    let changed = false;
    actions.forEach((action, i) => {
      const text = Array.isArray(hit.action) ? matches[i + 1] : matched;
      const before = top;
      if (action.token === '@rematch') rematch = true;
      else if (text !== '') out.push({ text, role: action.token });
      if (action.switchTo) {
        if (!grammar.tokenizer[action.switchTo]) throw new Error(`trying to switch to an undefined state '${action.switchTo}' in ${hit.source}`);
        top = { state: action.switchTo, parent: top.parent, depth: top.depth };
      } else if (action.next === '@pop') {
        if (top.parent === null) throw new Error(`trying to pop an empty stack in ${hit.source}`);
        top = top.parent;
      } else if (action.next === '@popall') {
        while (top.parent !== null) top = top.parent;
      } else if (action.next) {
        if (!grammar.tokenizer[action.next]) throw new Error(`the next state '${action.next}' is not defined in ${hit.source}`);
        top = { state: action.next, parent: top, depth: top.depth + 1 };
      }
      if (before !== top) changed = true;
    });

    if (rematch) {
      if (!changed) throw new Error(`no progress in tokenizer: @rematch without a state change in ${hit.source}`);
      continue;
    }
    if (matched.length === 0 && !changed) throw new Error(`no progress in tokenizer in ${hit.source}`);
    pos += matched.length;
  }
  return { tokens: out, stack: names(top) };
}

/** The pieces of one line, from the base state. */
export function monarchTokens(grammar: MonarchLike, line: string): Emitted[] {
  return monarchRun(grammar, line).tokens;
}

/** The role of every character of `line` (`''` for none). */
export function rolePerChar(grammar: MonarchLike, line: string, stack?: readonly string[]): string[] {
  const roles: string[] = [];
  for (const token of monarchRun(grammar, line, stack).tokens) for (let i = 0; i < token.text.length; i++) roles.push(token.role);
  return roles;
}

/** Every `[source, action]` rule of every state of `grammar` (the `include` entries left out). */
export function allRules(grammar: MonarchLike): [string, unknown][] {
  return Object.values(grammar.tokenizer).flatMap((entries) => entries.filter((entry): entry is [string, unknown] => Array.isArray(entry)));
}

/** Every role the rules of every state can emit, `''` and `@rematch` left out, in declaration order. */
export function emittedRoles(grammar: MonarchLike): string[] {
  const roles = allRules(grammar).flatMap(([, action]) => (Array.isArray(action) ? action : [action]).map((entry) => step(entry).token));
  return [...new Set(roles)].filter((role) => role !== '' && role !== '@rematch');
}
