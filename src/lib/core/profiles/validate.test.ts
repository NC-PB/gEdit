// The profile validator (plan §5 WP3.1, §7.4, AD-11): what a profile has to carry, how a
// problem is reported, and the pattern subset that keeps a profile usable from Python.

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { patternSubsetProblem, validateProfile } from './validate';
import type { Profile } from './types';

/** A fresh, valid profile object that a test can break in one place. */
function fanuc(): Record<string, unknown> {
  return structuredClone(fanucJson) as unknown as Record<string, unknown>;
}

/** The errors of a profile that was broken by `patch`. */
function errorsOf(patch: (p: Record<string, unknown>) => void): string[] {
  const profile = fanuc();
  patch(profile);
  const result = validateProfile(profile);
  return result.ok ? [] : result.errors;
}

/** The paths the errors point at, without the message behind the colon. */
function pathsOf(patch: (p: Record<string, unknown>) => void): string[] {
  return errorsOf(patch).map((error) => error.slice(0, error.indexOf(':')));
}

describe('the built-in profiles', () => {
  it('validate', () => {
    for (const raw of BUILTIN_PROFILE_JSON) {
      const result = validateProfile(raw);
      expect(result.ok ? [] : result.errors).toEqual([]);
    }
  });

  it('come back as the very object that was passed in, later-phase fields included', () => {
    const result = validateProfile(fanucJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toBe(fanucJson);
    // P2 fields are data this build does not read, and does not drop either.
    expect((result.profile as Profile & { editing: { tabWidth: number } }).editing.tabWidth).toBe(4);
    expect(result.profile.compare).toBeTypeOf('object');
  });

  it('keeps a field this build has never seen', () => {
    const result = validateProfile({ ...fanuc(), somethingFromP4: { deep: [1, 2] } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile.somethingFromP4).toEqual({ deep: [1, 2] });
  });
});

describe('a profile that is not a profile', () => {
  it('is reported instead of throwing', () => {
    for (const raw of [null, undefined, 42, 'fanuc', [], () => 1]) {
      const result = validateProfile(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toMatch(/^\(profile\): /);
    }
  });
});

describe('required fields', () => {
  it('are each reported with their path', () => {
    expect(pathsOf((p) => delete p.id)).toEqual(['id']);
    expect(pathsOf((p) => (p.grammar = 'sinumerik'))).toEqual(['grammar']);
    expect(pathsOf((p) => (p.version = 1.5))).toEqual(['version']);
    expect(pathsOf((p) => (p.id = 'Fanuc GCode'))).toEqual(['id']);
    expect(pathsOf((p) => delete p.files)).toEqual(['files']);
    expect(pathsOf((p) => delete p.numbering)).toEqual(['numbering']);
    expect(pathsOf((p) => (p.outline = {}))).toEqual(['outline']);
  });

  it('are collected, not reported one at a time', () => {
    const errors = errorsOf((p) => {
      delete p.id;
      delete p.shortName;
      (p.files as Record<string, unknown>).filterName = 7;
    });
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.split(':')[0])).toEqual(['id', 'shortName', 'files.filterName']);
    expect(errors[0]).toBe('id: is required');
  });

  it('name the exact array entry', () => {
    expect(
      pathsOf((p) => {
        (p.outline as { kind: string; pattern: string }[])[1].kind = 'headline';
      }),
    ).toEqual(['outline[1].kind']);
    expect(
      pathsOf((p) => {
        (p.detect as { content: unknown[] }).content[2] = { pattern: 'N\\d+' };
      }),
    ).toEqual(['detect.content[2].weight']);
  });
});

describe('the file section', () => {
  it('wants extensions without a dot and in lower case', () => {
    expect(pathsOf((p) => ((p.files as Record<string, unknown>).extensions = ['nc', '.tap']))).toEqual([
      'files.extensions[1]',
    ]);
    expect(pathsOf((p) => ((p.files as Record<string, unknown>).extensions = ['nc', 'TAP']))).toEqual([
      'files.extensions[1]',
    ]);
    // An empty list takes the default extension down with it.
    expect(pathsOf((p) => ((p.files as Record<string, unknown>).extensions = []))).toEqual([
      'files.extensions',
      'files.defaultExtension',
    ]);
    expect(pathsOf((p) => ((p.detect as Record<string, unknown>).extensions = { '.nc': 3 }))).toEqual([
      'detect.extensions..nc',
    ]);
  });

  it('wants the default extension to be one the profile claims', () => {
    expect(errorsOf((p) => ((p.files as Record<string, unknown>).defaultExtension = 'ngc'))).toEqual([
      'files.defaultExtension: "ngc" is not in files.extensions',
    ]);
  });

  it('accepts only the P1 values for encoding and line endings', () => {
    expect(pathsOf((p) => ((p.files as Record<string, unknown>).encoding = 'utf8'))).toEqual(['files.encoding']);
    expect(pathsOf((p) => ((p.files as Record<string, unknown>).newFileLineEnding = 'CRLF'))).toEqual([
      'files.newFileLineEnding',
    ]);
  });
});

describe('the syntax section', () => {
  it('wants a block-number prefix when the mode is "prefix"', () => {
    expect(
      pathsOf((p) => ((p.syntax as Record<string, unknown>).blockNumber = { mode: 'prefix', mandatory: false })),
    ).toEqual(['syntax.blockNumber.prefix']);
    // The leading-integer mode (Klartext) needs none.
    expect(
      pathsOf((p) => ((p.syntax as Record<string, unknown>).blockNumber = { mode: 'leading-integer', mandatory: true })),
    ).toEqual([]);
  });

  it('takes a line comment as `end: null`, but not as a missing end', () => {
    expect(pathsOf((p) => ((p.syntax as Record<string, unknown>).comments = [{ start: ';', end: null }]))).toEqual([]);
    expect(pathsOf((p) => ((p.syntax as Record<string, unknown>).comments = [{ start: ';' }]))).toEqual([
      'syntax.comments[0].end',
    ]);
    expect(pathsOf((p) => ((p.syntax as Record<string, unknown>).comments = []))).toEqual(['syntax.comments']);
  });
});

describe('the tool call', () => {
  it('has to name the tool group, because the program map reads it', () => {
    expect(errorsOf((p) => ((p.toolCall as Record<string, unknown>).tool = 'T(\\d+)'))).toEqual([
      'toolCall.tool: has to carry the named group (?<tool>…)',
    ]);
  });
});

describe('patterns', () => {
  it('are reported with their path when they do not compile', () => {
    const errors = errorsOf((p) => {
      (p.outline as { kind: string; pattern: string }[])[2].pattern = '(';
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^outline\[2\]\.pattern: /);
    expect(pathsOf((p) => ((p.toolCall as Record<string, unknown>).trigger = '[a-'))).toEqual(['toolCall.trigger']);
    expect(
      pathsOf((p) => {
        (p.numbering as { references: { trigger: string }[] }).references[0].trigger = '*';
      }),
    ).toEqual(['numbering.references[0].trigger']);
    expect(pathsOf((p) => ((p.program as Record<string, unknown>).end = ['M30', '(?<']))).toEqual(['program.end[1]']);
  });

  it('have to stay in the subset Python can compile too (AD-11)', () => {
    for (const bad of [
      '\\p{L}+',
      '[\\p{Nd}]',
      '(?<year>\\d{4})-\\k<year>',
      '(?<=A+)B',
      '(?<=AB|C)D',
      '(?<=A?)B',
      '(?<=A{1,3})B',
      '(?<![A-Z]*)T\\d',
    ]) {
      expect(patternSubsetProblem(bad), bad).toBeTypeOf('string');
    }
  });

  it('allow what the built-ins need', () => {
    for (const good of [
      '(?<![A-Z])M0*6(?!\\d)',
      '(?<![A-Z])T(?<tool>\\d+)',
      '^\\s*(N\\d+\\s*)?[GM]\\d{1,3}(\\.\\d)?(?![\\d.])',
      '(?<=AB{2})C',
      '(?<=(?:AB))C',
      '(?<=\\[)X',
      'a[?*+|]b',
      '\\\\p',
    ]) {
      expect(patternSubsetProblem(good), good).toBeNull();
    }
  });

  it('is what every pattern in every built-in profile passes', () => {
    const patterns = BUILTIN_PROFILE_JSON.flatMap((raw) => collectPatterns(raw));
    // A guard against a walker that quietly stops finding anything.
    expect(patterns.length).toBeGreaterThan(20);
    for (const { path, pattern } of patterns) {
      expect(patternSubsetProblem(pattern), `${path}: ${pattern}`).toBeNull();
      expect(() => new RegExp(pattern), `${path}: ${pattern}`).not.toThrow();
    }
  });
});

/** Where a profile keeps a pattern, by JSON path (`syntax.comments[0].start` is not one). */
const PATTERN_PATH =
  /(\.pattern|\.trigger|\.continuation|\.sectionHeading|\.variables|\.commentFilter)$|^program\.(start|end)\[\d+\]$|^toolCall\.tool$/;

/** Every pattern in a raw profile, with its JSON path. */
function collectPatterns(value: unknown, path = ''): { path: string; pattern: string }[] {
  if (typeof value === 'string') return PATTERN_PATH.test(path) ? [{ path, pattern: value }] : [];
  if (Array.isArray(value)) return value.flatMap((entry, i) => collectPatterns(entry, `${path}[${i}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) =>
      collectPatterns(entry, path === '' ? key : `${path}.${key}`),
    );
  }
  return [];
}
