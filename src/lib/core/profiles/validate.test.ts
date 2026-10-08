// The profile validator (plan §5 WP3.1, §7.4, AD-11): what a profile has to carry, how a
// problem is reported, and the pattern subset that keeps a profile usable from Python.

import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { modalGroupsOf } from '$lib/core/codes/resolve';
import { patternSubsetProblem, validateProfile, type ProfileValidationOptions } from './validate';
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
    expect(pathsOf((p) => (p.grammar = 'conversational'))).toEqual(['grammar']);
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
    // M9 NC review F3: the vetoes are patterns, each named by its index.
    expect(
      pathsOf((p) => {
        (p.detect as Record<string, unknown>).vetoes = ['DIAMON', '(unclosed', 7];
      }),
    ).toEqual(['detect.vetoes[1]', 'detect.vetoes[2]']);
    expect(pathsOf((p) => ((p.detect as Record<string, unknown>).vetoes = 'DIAMON'))).toEqual(['detect.vetoes']);
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

// G8 M8 review: two ways a user profile (M12) could pass validation and still break the
// tokenizers. The built-in profiles pass both checks (`the built-in profiles validate`).
describe('the turning syntax fields', () => {
  const syntaxOf = (p: Record<string, unknown>): Record<string, unknown> => p.syntax as Record<string, unknown>;

  it('want the named group `name` in a label pattern, because both tokenizers read it', () => {
    expect(errorsOf((p) => (syntaxOf(p).labels = '^([A-Z_]+):'))).toEqual([
      'syntax.labels: has to carry the named group (?<name>…)',
    ]);
    expect(errorsOf((p) => (syntaxOf(p).labels = '^\\s*(?<name>[A-Z_][A-Z0-9_]*):(?!=)'))).toEqual([]);
  });

  // M8 (§7.16 #27): Okuma's `$` lines. A marker that could match further into a line would
  // make a `$` in the middle of a block the start of a continuation.
  it('want the leading continuation marker anchored at the start of the line', () => {
    expect(errorsOf((p) => (syntaxOf(p).continuationStart = '\\$(?=[ \\t]|$)'))).toEqual([
      'syntax.continuationStart: has to be anchored at the start of the line (^)',
    ]);
    expect(errorsOf((p) => (syntaxOf(p).continuationStart = '^[ \\t]*\\$(?=[ \\t]|$)'))).toEqual([]);
    // A pattern that needs no marker would make the whole program one block.
    const plain = 'syntax.continuationStart: matches a line without a marker, so every line would join the block above';
    expect(errorsOf((p) => (syntaxOf(p).continuationStart = '^'))).toEqual([plain]);
    expect(errorsOf((p) => (syntaxOf(p).continuationStart = '^\\s*'))).toEqual([plain]);
    expect(errorsOf((p) => (syntaxOf(p).continuationStart = '^[ \\t]*\\$?'))).toEqual([plain]);
  });

  // An empty match used to leave both tokenizers where they were, forever: a script hung,
  // and so did the editor on the first line it tokenized.
  it('refuse a variable pattern that can match an empty string', () => {
    const empty = 'can match an empty string, and a variable has to take at least one character';
    expect(errorsOf((p) => (syntaxOf(p).systemVariables = '\\$?[A-Z_]*'))).toEqual([`syntax.systemVariables: ${empty}`]);
    expect(errorsOf((p) => (syntaxOf(p).variables = 'R?\\d*'))).toEqual([`syntax.variables: ${empty}`]);
    // One that matches nothing only in some places is found there: behind a word boundary.
    expect(pathsOf((p) => (syntaxOf(p).variables = '\\b\\d*'))).toEqual(['syntax.variables']);
    // A pattern that does not compile is reported once, for that.
    expect(errorsOf((p) => (syntaxOf(p).variables = '(')).map((error) => error.includes(empty))).toEqual([false]);
    expect(pathsOf((p) => (syntaxOf(p).variables = '#\\d+'))).toEqual([]);
    expect(pathsOf((p) => (syntaxOf(p).systemVariables = 'V[A-Z][A-Z0-9]{3}'))).toEqual([]);
  });

  // M9 review F4: a main-block prefix of `(` read the comment `(20 NOTE)` as block 20
  // followed by code words, which a scaling script would then change.
  it('refuse a main-block prefix that already starts a comment, a skip, a string or a mark', () => {
    const blockNumber = (p: Record<string, unknown>): Record<string, unknown> =>
      syntaxOf(p).blockNumber as Record<string, unknown>;
    for (const ch of ['(', ';', '/', '"', "'", '%', '$', '+', '-', '.', ',', '=', '[', '#', '*']) {
      expect(pathsOf((p) => (blockNumber(p).mainPrefix = ch)), ch).toEqual(['syntax.blockNumber.mainPrefix']);
    }
    // The profile's own comment start, whatever it is.
    expect(
      pathsOf((p) => {
        syntaxOf(p).comments = [{ start: '!', end: null }];
        blockNumber(p).mainPrefix = '!';
      }),
    ).toEqual(['syntax.blockNumber.mainPrefix']);
    expect(pathsOf((p) => (blockNumber(p).mainPrefix = ':'))).toEqual([]);
    expect(pathsOf((p) => (blockNumber(p).mainPrefix = '!'))).toEqual([]);
  });

  it('refuse a one-letter exponent marker, which is an address of its own', () => {
    for (const marker of ['X', 'G', 'N', 'e']) {
      expect(errorsOf((p) => (syntaxOf(p).exponentMarker = marker)), marker).toEqual([
        'syntax.exponentMarker: has to be at least two letters: a single letter is an address of its own',
      ]);
    }
    expect(pathsOf((p) => (syntaxOf(p).exponentMarker = 'EX'))).toEqual([]);
  });

  // M9-2 (2026-10-08): a mark that addresses the value behind it (Klartext `#5`).
  it('take one non-letter character per symbol address that means nothing else yet', () => {
    expect(pathsOf((p) => (syntaxOf(p).symbolAddresses = ['#']))).toEqual([]);
    expect(pathsOf((p) => (syntaxOf(p).symbolAddresses = '#'))).toEqual(['syntax.symbolAddresses']);
    for (const mark of ['X', '5', ' ', '##', '"', '+', '(', '/']) {
      expect(pathsOf((p) => (syntaxOf(p).symbolAddresses = [mark])), mark).toEqual(['syntax.symbolAddresses[0]']);
    }
  });

  // Phase 2 (§7.16): the Fanuc program name, one token like a variable.
  it('refuse a program-name pattern that can match an empty string, or that does not compile', () => {
    const empty = 'can match an empty string, and a program name has to take at least one character';
    expect(errorsOf((p) => (syntaxOf(p).programNames = '(?:<[A-Z_]+>)?'))).toEqual([`syntax.programNames: ${empty}`]);
    expect(pathsOf((p) => (syntaxOf(p).programNames = '<[A-Z'))).toEqual(['syntax.programNames']);
    expect(pathsOf((p) => (syntaxOf(p).programNames = '<[A-Za-z0-9+\\-_.]+>'))).toEqual([]);
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
  /(\.pattern|\.trigger|\.continuation|\.continuationStart|\.sectionHeading|\.variables|\.commentFilter)$|^program\.(start|end)\[\d+\]$|^toolCall\.tool$/;

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

// ---------------------------------------------------------------------------
// The M6 fields (§7.1, §7.15, AD-31)
// ---------------------------------------------------------------------------

/** The resolved Fanuc lathe: the one built-in that declares variants and a `machineType`. */
function lathe(): Record<string, unknown> {
  const raw = BUILTIN_PROFILE_JSON.find(
    (entry) => (entry as { id?: string }).id === 'fanuc-lathe',
  );
  return structuredClone(raw) as Record<string, unknown>;
}

/** The paths of the problems a patched **lathe** produces, with the databases in hand. */
function lathePaths(patch: (p: Record<string, unknown>) => void, o: ProfileValidationOptions = {}): string[] {
  const profile = lathe();
  patch(profile);
  const result = validateProfile(profile, o);
  return result.ok ? [] : result.errors.map((error) => error.slice(0, error.indexOf(':')));
}

/** `machineParams` of a patched lathe, as the tests reach into it. */
function decl(p: Record<string, unknown>): Record<string, unknown> {
  return p.machineParams as Record<string, unknown>;
}

function presets(p: Record<string, unknown>): Record<string, unknown>[] {
  return (decl(p).numberInput as { presets: Record<string, unknown>[] }).presets;
}

function variants(p: Record<string, unknown>): Record<string, unknown>[] {
  return decl(p).variants as Record<string, unknown>[];
}

function choices(p: Record<string, unknown>): Record<string, unknown>[] {
  return variants(p)[0].choices as Record<string, unknown>[];
}

describe('the M6 profile fields', () => {
  it('take only the two kinds of machine', () => {
    expect(pathsOf((p) => (p.machineType = 'lathe'))).toEqual([]);
    expect(pathsOf((p) => (p.machineType = 'turning'))).toEqual(['machineType']);
  });

  it('want an incremental address to name an axis the profile has', () => {
    expect(lathePaths(() => {})).toEqual([]);
    expect(
      lathePaths((p) => {
        (p.addresses as Record<string, unknown>).incremental = { U: 'Q' };
      }),
    ).toEqual(['addresses.incremental.U']);
    expect(
      lathePaths((p) => {
        (p.addresses as Record<string, unknown>).incremental = { U: 'X', W: 'Z' };
      }),
    ).toEqual([]);
  });

  it('take only the four feed units on a word that sets one', () => {
    expect(
      pathsOf((p) => ((p.addresses as Record<string, unknown>).feedUnitWords = { FU: 'per-rev' })),
    ).toEqual([]);
    expect(
      pathsOf((p) => ((p.addresses as Record<string, unknown>).feedUnitWords = { FU: 'per-revolution' })),
    ).toEqual(['addresses.feedUnitWords.FU']);
  });

  it('check the tool-call exception like any other pattern', () => {
    expect(pathsOf((p) => ((p.toolCall as Record<string, unknown>).ignore = '(?<![A-Z])T0+(?!\\d)'))).toEqual([]);
    expect(pathsOf((p) => ((p.toolCall as Record<string, unknown>).ignore = '('))).toEqual(['toolCall.ignore']);
  });

  it('want `rewrite` to be a flag, not a word', () => {
    expect(
      pathsOf((p) => {
        (p.numbering as { references: Record<string, unknown>[] }).references[0].rewrite = false;
      }),
    ).toEqual([]);
    expect(
      pathsOf((p) => {
        (p.numbering as { references: Record<string, unknown>[] }).references[0].rewrite = 'no';
      }),
    ).toEqual(['numbering.references[0].rewrite']);
  });

  it('want a power-on code in the form the database stores it', () => {
    expect(pathsOf((p) => (p.modal = { initial: { feedmode: 'G94' } }))).toEqual([]);
    expect(pathsOf((p) => (p.modal = { initial: { feedmode: 'G094' } }))).toEqual(['modal.initial.feedmode']);
    expect(errorsOf((p) => (p.modal = { initial: { feedmode: 'g94' } }))).toEqual([
      'modal.initial.feedmode: has to be written as "G94"',
    ]);
  });

  // AD-31: which units a control comes up in is a fact about one machine, not about the
  // dialect. `applyMachine` writes these three, and a profile file that states them would
  // be making a machine setting look like a property of every Fanuc control there is.
  it('refuse the computed modal fields in a profile file and accept them once applied', () => {
    const computed = { initial: { feedmode: 'G94' }, units: 'inch', diameter: 'on', sources: { units: 'machine' } };
    expect(pathsOf((p) => (p.modal = computed))).toEqual(['modal.units', 'modal.diameter', 'modal.sources']);
    expect(
      validateProfile({ ...fanuc(), modal: computed }, { applied: true }).ok,
      'the applied profile is the same object with the machine written into it',
    ).toBe(true);
    // Their values are still checked, in both roles.
    expect(
      pathsOf((p) => (p.modal = { units: 'metric', sources: { units: 'guessed' } })),
    ).toEqual(['modal.units', 'modal.sources.units', 'modal.units', 'modal.sources']);
  });
});

describe('the machine-parameter declaration', () => {
  it('wants every preset id once', () => {
    expect(lathePaths((p) => (presets(p)[1].id = 'is-b'))).toEqual([
      'machineParams.numberInput.presets[1].id',
    ]);
  });

  it('wants the default to name a preset that is there', () => {
    expect(lathePaths((p) => ((decl(p).numberInput as Record<string, unknown>).default = 'is-d'))).toEqual([
      'machineParams.numberInput.default',
    ]);
  });

  it('takes only the three readings and a decimal increment', () => {
    expect(lathePaths((p) => ((presets(p)[0].value as Record<string, unknown>).mode = 'rounded'))).toEqual([
      'machineParams.numberInput.presets[0].value.mode',
    ]);
    for (const bad of ['0.002', '0.0015', '10', '1e-3', 0.001]) {
      expect(
        lathePaths((p) => ((presets(p)[0].value as Record<string, unknown>).incrementMm = bad)),
        String(bad),
      ).toEqual(['machineParams.numberInput.presets[0].value.incrementMm']);
    }
    for (const good of ['1', '0.1', '0.001', '0.00001']) {
      expect(
        lathePaths((p) => ((presets(p)[0].value as Record<string, unknown>).incrementSec = good)),
        good,
      ).toEqual([]);
    }
    expect(lathePaths((p) => delete (presets(p)[0].value as Record<string, unknown>).incrementMm)).toEqual([
      'machineParams.numberInput.presets[0].value.incrementMm',
    ]);
  });

  it('knows the number classes, and which of them follow the units', () => {
    expect(
      lathePaths((p) => {
        (presets(p)[0].value as Record<string, unknown>).classes = { feedrate: { mode: 'calculator' } };
      }),
    ).toEqual(['machineParams.numberInput.presets[0].value.classes.feedrate']);
    // Degrees are degrees in an inch program too (§7.15).
    expect(
      lathePaths((p) => {
        (presets(p)[0].value as Record<string, unknown>).classes = { angle: { incrementInch: '0.0001' } };
      }),
    ).toEqual(['machineParams.numberInput.presets[0].value.classes.angle.incrementInch']);
    expect(
      lathePaths((p) => {
        (presets(p)[0].value as Record<string, unknown>).classes = { dwell: { incrementInch: '0.0001' } };
      }),
    ).toEqual(['machineParams.numberInput.presets[0].value.classes.dwell.incrementInch']);
    expect(
      lathePaths((p) => {
        (presets(p)[0].value as Record<string, unknown>).classes = {
          feedPerRev: { mode: 'calculator', increment: '0.001', incrementInch: '0.0001' },
        };
      }),
    ).toEqual([]);
  });

  it('wants a variant default that is one of its choices', () => {
    expect(lathePaths((p) => (variants(p)[0].default = 'C'))).toEqual(['machineParams.variants[0].default']);
  });

  it('wants every variant id and every choice value once', () => {
    // The lathe declares three variants since M9 (gcodeSystem and the two R6 ones), so a
    // copy of the first lands at index 3.
    expect(lathePaths((p) => variants(p).push(structuredClone(variants(p)[0])))).toEqual([
      'machineParams.variants[3].id',
    ]);
    expect(lathePaths((p) => (choices(p)[1].value = 'A'))).toEqual(['machineParams.variants[0].choices[1].value']);
  });

  it('wants a choice to name a code database that resolves', () => {
    const files = { fanuc: {}, 'fanuc-lathe': {}, 'fanuc-lathe-b': {} };
    const codeDbs = Object.keys(files);
    expect(lathePaths(() => {}, { codeDbs })).toEqual([]);
    expect(lathePaths((p) => (choices(p)[1].codes = 'fanuc-lathe-c'), { codeDbs })).toEqual([
      'machineParams.variants[0].choices[1].codes',
    ]);
    // Without the databases in hand the check is skipped, not guessed at.
    expect(lathePaths((p) => (choices(p)[1].codes = 'fanuc-lathe-c'))).toEqual([]);
  });

  it('lets an overlay set four members and nothing else', () => {
    expect(lathePaths((p) => (choices(p)[1].overlay = { numbering: { step: 10 } }))).toEqual([]);
    expect(lathePaths((p) => (choices(p)[1].overlay = { syntax: { decimalPointSignificant: true } }))).toEqual([
      'machineParams.variants[0].choices[1].overlay.syntax',
    ]);
    expect(lathePaths((p) => (choices(p)[1].overlay = { codes: 'fanuc' }))).toEqual([
      'machineParams.variants[0].choices[1].overlay.codes',
    ]);
    expect(lathePaths((p) => (choices(p)[1].overlay = { modal: { initial: { feedmode: 'G095' } } }))).toEqual([
      'machineParams.variants[0].choices[1].overlay.modal.initial.feedmode',
    ]);
    expect(lathePaths((p) => (choices(p)[1].overlay = { toolCall: { ignore: '(' } }))).toEqual([
      'machineParams.variants[0].choices[1].overlay.toolCall.ignore',
    ]);
  });

  it('checks a variant detection rule like every other pattern', () => {
    expect(lathePaths((p) => (choices(p)[1].detect = [{ pattern: '(?<![A-Z])G92(?!\\d)', weight: 6 }]))).toEqual([]);
    expect(lathePaths((p) => (choices(p)[1].detect = [{ pattern: '(?<=A+)B', weight: 6 }]))).toEqual([
      'machineParams.variants[0].choices[1].detect[0].pattern',
    ]);
    expect(lathePaths((p) => (choices(p)[1].detect = [{ pattern: 'G92' }]))).toEqual([
      'machineParams.variants[0].choices[1].detect[0].weight',
    ]);
  });

  it('wants an offered modal group to be one the codes know', () => {
    const modalGroups = ['feedmode', 'spindlemode', 'plane'];
    expect(lathePaths(() => {}, { modalGroups })).toEqual([]);
    expect(lathePaths((p) => (decl(p).modalGroups = ['feedmode', 'feedMode']), { modalGroups })).toEqual([
      'machineParams.modalGroups[1]',
    ]);
    expect(lathePaths((p) => (decl(p).modalGroups = ['feedmode', 'feedMode']))).toEqual([]);
  });

  // X10: with no machine, a number has to be read exactly as the profile's own JSON says.
  it('wants the decimal point to mean what the default preset says it means', () => {
    expect(
      lathePaths((p) => ((p.syntax as Record<string, unknown>).decimalPointSignificant = true)),
    ).toEqual(['syntax.decimalPointSignificant']);
    expect(
      pathsOf((p) => ((p.syntax as Record<string, unknown>).decimalPointSignificant = false)),
    ).toEqual(['syntax.decimalPointSignificant']);
    // Once a machine has been applied the reading is the machine's, not the preset's.
    const mill = fanuc();
    (mill.syntax as Record<string, unknown>).decimalPointSignificant = false;
    expect(validateProfile(mill, { applied: true }).ok).toBe(true);
  });

  it('is checked on every built-in, with the databases the app ships', () => {
    const codeDbs = Object.keys(BUILTIN_CODE_DB_JSON);
    for (const raw of BUILTIN_PROFILE_JSON) {
      const dialect = (raw as { codes: string }).codes;
      const result = validateProfile(raw, {
        codeDbs,
        modalGroups: modalGroupsOf(BUILTIN_CODE_DB_JSON as Record<string, unknown>, dialect),
      });
      expect(result.ok ? [] : result.errors, (raw as { id: string }).id).toEqual([]);
    }
  });
});

describe('M10 review: the plain skip level and the closing record', () => {
  const skipOf = (p: Record<string, unknown>) => (p.syntax as Record<string, Record<string, unknown>>).blockSkip;
  const programOf = (p: Record<string, unknown>) => p.program as Record<string, unknown>;

  it('takes a digit as the plain level and refuses anything else', () => {
    expect(errorsOf((p) => (skipOf(p).plainLevel = '1'))).toEqual([]);
    expect(pathsOf((p) => (skipOf(p).plainLevel = '/'))).toEqual(['syntax.blockSkip.plainLevel']);
    expect(pathsOf((p) => (skipOf(p).plainLevel = 1))).toEqual(['syntax.blockSkip.plainLevel']);
  });

  it('takes true or false as program.endRecord', () => {
    expect(errorsOf((p) => (programOf(p).endRecord = true))).toEqual([]);
    expect(pathsOf((p) => (programOf(p).endRecord = 'yes'))).toEqual(['program.endRecord']);
  });
});

describe('M12 (P12): channel rows and channel presets', () => {
  it('refuses channel and sync rows in a profile’s own outline rules', () => {
    for (const kind of ['channel', 'sync']) {
      const errors = errorsOf((p) => {
        (p.outline as { kind: string; pattern: string }[])[1].kind = kind;
      });
      expect(errors, kind).toEqual([`outline[1].kind: "${kind}" rows are made by the channel service, not by a profile's outline rules`]);
    }
  });

  it('checks the shape of machineParams.channels', () => {
    const paths = lathePaths((p) => {
      decl(p).channels = {
        waitLetters: ['m'],
        presets: [
          {
            id: 'a',
            label: 'A',
            value: {
              layout: 'single-file',
              list: [{ id: '1', name: 'One' }, { id: '2', name: 'Two' }],
              sectionStart: '(?<channel>G1[34])',
              syncMarks: [],
            },
          },
          { id: 'a', label: 3, value: 'x' },
        ],
      };
    });
    expect(paths).toEqual([
      'machineParams.channels.waitLetters[0]',
      'machineParams.channels.presets[1].id',
      'machineParams.channels.presets[1].label',
      'machineParams.channels.presets[1].value',
    ]);
  });

  it('runs every preset through validateChannels (WP12.3), so a preset the Machines page would refuse is refused here', () => {
    const paths = lathePaths((p) => {
      decl(p).channels = {
        waitLetters: ['M'],
        presets: [{ id: 'a', label: 'A', value: { layout: 'single-file', list: [], syncMarks: [] } }],
      };
    });
    expect(paths).toEqual(['machineParams.channels.presets[0].value.list', 'machineParams.channels.presets[0].value.sectionStart']);
  });
});
