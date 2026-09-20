// Turns a validated `Profile` into the `CompiledProfile` every NC feature reads
// (plan §7.4, AD-11). Written by the M3 prelude (P3); owner from Wave A on: WP3.1.
//
// Every pattern is compiled exactly once, here. Detection runs over 400 lines, the
// tokenizer and the outline index run over whole documents, and building a `RegExp` per
// line is what made the legacy parser slow.
//
// Flags: `i` for every pattern, unless the profile sets `syntax.caseSensitive`. The `g`
// and `y` flags are never used, so a compiled regex carries no `lastIndex` between calls
// and can be shared freely.
//
// A bad pattern is a data error, not a crash site: `ProfileError` carries the JSON path
// of the field (`outline[2].pattern`), so the validator, the settings UI and the log all
// point at the profile file.

import type { CompiledProfile, OutlineKind, Pattern, Profile, ProfileErrorInfo } from './types';

/** A profile field the app could not use, with the JSON path that points at it. */
export class ProfileError extends Error implements ProfileErrorInfo {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ProfileError';
    this.path = path;
  }
}

/** Compiles one pattern, or throws a `ProfileError` naming `path`. */
function compilePattern(pattern: Pattern | undefined, path: string, flags: string): RegExp {
  if (typeof pattern !== 'string') throw new ProfileError(path, 'a pattern is required');
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new ProfileError(path, error instanceof Error ? error.message : String(error));
  }
}

/** Same, for a field that may be absent. */
function compileOptional(pattern: Pattern | undefined, path: string, flags: string): RegExp | undefined {
  return pattern === undefined || pattern === null ? undefined : compilePattern(pattern, path, flags);
}

function compileList(patterns: Pattern[] | undefined, path: string, flags: string): RegExp[] {
  return (patterns ?? []).map((pattern, i) => compilePattern(pattern, `${path}[${i}]`, flags));
}

/**
 * Upper-cases the keywords and sorts them longest first, so a tokenizer that tries them
 * in order matches `TOOL CALL` before `TOOL` and `LBL` before `L`. Equal lengths keep a
 * stable alphabetical order, so a generated grammar does not change between runs.
 */
function compileKeywords(keywords: string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const keyword of keywords ?? []) {
    if (typeof keyword === 'string' && keyword.trim() !== '') seen.add(keyword.trim().toUpperCase());
  }
  return [...seen].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Compiles `p`. The profile must have been through `validateProfile` (WP3.1); this
 * function only reports what it cannot compile.
 *
 * @throws ProfileError when a pattern is missing or is not a valid regular expression.
 */
export function compileProfile(p: Profile): CompiledProfile {
  const flags: 'i' | '' = p.syntax?.caseSensitive ? '' : 'i';
  const syntax = p.syntax ?? ({} as Profile['syntax']);
  const detect = p.detect ?? ({ extensions: {}, content: [] } as Profile['detect']);
  const toolCall = p.toolCall ?? ({} as Profile['toolCall']);
  const program = p.program ?? ({ start: [], end: [] } as Profile['program']);
  const outline: { kind: OutlineKind; pattern: Pattern }[] = p.outline ?? [];
  const references = p.numbering?.references ?? [];

  return {
    profile: p,
    flags,
    re: {
      detectContent: (detect.content ?? []).map((rule, i) => ({
        re: compilePattern(rule?.pattern, `detect.content[${i}].pattern`, flags),
        weight: rule?.weight ?? 0,
      })),
      sectionHeading: compileOptional(syntax.sectionHeading, 'syntax.sectionHeading', flags),
      continuation: compileOptional(syntax.continuation, 'syntax.continuation', flags),
      variables: compileOptional(syntax.variables, 'syntax.variables', flags),
      toolTrigger: compilePattern(toolCall.trigger, 'toolCall.trigger', flags),
      tool: compilePattern(toolCall.tool, 'toolCall.tool', flags),
      programStart: compileList(program.start, 'program.start', flags),
      programEnd: compileList(program.end, 'program.end', flags),
      outline: outline.map((rule, i) => ({
        kind: rule.kind,
        re: compilePattern(rule?.pattern, `outline[${i}].pattern`, flags),
      })),
      references: references.map((rule, i) => ({
        trigger: compilePattern(rule?.trigger, `numbering.references[${i}].trigger`, flags),
        addresses: [...(rule?.addresses ?? [])],
      })),
      commentFilter: compileOptional(p.toolList?.commentFilter, 'toolList.commentFilter', flags),
    },
    keywords: compileKeywords(syntax.keywords),
  };
}
