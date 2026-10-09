// The profile registry (plan §7.2, §7.4, AD-7, AD-11): what the status bar, the save
// dialog and `files.open` read off a profile, which filters reach a picker on which
// platform, and what happens to a profile that does not load.

import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createProfileRegistry } from './profiles';
import { createCodeDbService } from './codes';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { t } from '$lib/i18n';
import type { EffectiveMachine, MachineConfig } from '$lib/core/machines/types';
import { expectWithin, fastest } from '../../../tests/unit/helpers/budget';

const withFilters = createProfileRegistry({ filtersSupported: true });
const noFilters = createProfileRegistry({ filtersSupported: false });

// M8: `min` moved to the Okuma profile (F22).
const FANUC_EXTENSIONS = ['nc', 'tap', 'cnc', 'eia', 'iso', 'ncc', 'ptp', 'txt'];
const OKUMA_EXTENSIONS = ['min', 'sub', 'ssb'];
const SINUMERIK_EXTENSIONS = ['mpf', 'spf'];

/** A registry over hand-written sources, with the problems it reported. */
function registryOver(sources: readonly unknown[], defaultProfileId?: () => string) {
  const problems: string[] = [];
  const registry = createProfileRegistry({
    filtersSupported: true,
    sources,
    defaultProfileId,
    onProblem: (message) => problems.push(message),
  });
  return { registry, problems };
}

/** The built-in Fanuc profile, with one field changed. */
function fanucWith(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...(structuredClone(fanucJson) as unknown as Record<string, unknown>), ...patch };
}

describe('the profile list', () => {
  it('holds every built-in dialect with the default one first', () => {
    expect(withFilters.list().map((p) => p.id)).toEqual([
      'fanuc-gcode',
      'fanuc-lathe',
      'heidenhain-klartext',
      'okuma-osp',
      'sinumerik',
      'sinumerik-mill',
    ]);
    expect(withFilters.defaultId()).toBe('fanuc-gcode');
    expect(get(withFilters.all)).toEqual(withFilters.list());
  });

  it('describes a profile the way the status bar and Save As need it', () => {
    expect(withFilters.get('fanuc-gcode')).toEqual({
      id: 'fanuc-gcode',
      // The dialog-filter name, not the display name `Fanuc (ISO) mill`.
      name: 'Fanuc G-Code',
      shortName: 'Fanuc',
      extensions: FANUC_EXTENSIONS,
      defaultFileName: 'program.nc',
      newFileEol: 'crlf',
      // M6 (§7.3): what the machine item and the profile picker need.
      machineType: 'mill',
      origin: 'builtin',
      parent: null,
      file: null,
      chain: ['fanuc-gcode'],
      hasMachineParams: true,
    });
    expect(withFilters.get('heidenhain-klartext')).toEqual({
      id: 'heidenhain-klartext',
      name: 'Heidenhain Klartext',
      shortName: 'Heidenhain',
      extensions: ['h'],
      defaultFileName: 'program.h',
      newFileEol: 'crlf',
      machineType: 'mill',
      origin: 'builtin',
      parent: null,
      file: null,
      chain: ['heidenhain-klartext'],
      // Klartext declares no machine parameters, so it has no machine item at all (§8.8).
      hasMachineParams: false,
    });
  });

  it('answers undefined for an unknown id', () => {
    expect(withFilters.get('siemens')).toBeUndefined();
  });

  it('hands out the profile and its compiled patterns', () => {
    expect(withFilters.profile('fanuc-gcode').name).toBe('Fanuc (ISO) mill');
    expect(withFilters.compiled('fanuc-gcode').profile).toBe(withFilters.profile('fanuc-gcode'));
    expect(withFilters.compiled('fanuc-gcode').re.toolTrigger.test('N10T1M6')).toBe(true);
    // The same objects every time: no profile is compiled twice.
    expect(withFilters.compiled('heidenhain-klartext')).toBe(withFilters.compiled('heidenhain-klartext'));
    expect(() => withFilters.profile('siemens')).toThrow('Unknown profile: siemens');
    expect(() => withFilters.compiled('siemens')).toThrow('Unknown profile: siemens');
  });
});

describe('the default profile', () => {
  it('follows the `files.defaultProfile` setting', () => {
    const both = createProfileRegistry({ filtersSupported: true, defaultProfileId: () => 'heidenhain-klartext' });
    expect(both.defaultId()).toBe('heidenhain-klartext');

    // A setting that names a profile this registry did not load falls back to the first.
    const { registry } = registryOver([fanucJson], () => 'heidenhain-klartext');
    expect(registry.defaultId()).toBe('fanuc-gcode');
  });

  it('ignores a setting that names a profile this build does not have', () => {
    const registry = createProfileRegistry({ filtersSupported: true, defaultProfileId: () => 'siemens-840d' });
    expect(registry.defaultId()).toBe('fanuc-gcode');
  });
});

describe('loading', () => {
  it('skips a profile that does not validate and says which field is wrong', () => {
    const { registry, problems } = registryOver([fanucWith({ id: 'broken', grammar: 'conversational' }), fanucJson]);
    expect(registry.list().map((p) => p.id)).toEqual(['fanuc-gcode']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('broken was not loaded');
    expect(problems[0]).toContain('grammar');
  });

  it('skips a profile whose pattern does not compile, with the JSON path', () => {
    const { registry, problems } = registryOver([fanucWith({ id: 'bad-pattern', program: { start: ['('], end: [] } })]);
    expect(registry.list()).toEqual([]);
    expect(problems[0]).toContain('program.start[0]');
  });

  it('keeps the first of two profiles with the same id', () => {
    const { registry, problems } = registryOver([fanucJson, fanucWith({ name: 'A copy' })]);
    expect(registry.list()).toHaveLength(1);
    expect(registry.profile('fanuc-gcode').name).toBe('Fanuc (ISO) mill');
    expect(problems[0]).toContain('the id is already taken');
  });

  it('names a profile that has no usable id at all', () => {
    const { problems } = registryOver([{ nothing: true }]);
    expect(problems[0]).toContain('profile #1 was not loaded');
  });

  it('still answers when every profile was skipped', () => {
    const { registry } = registryOver([{}]);
    expect(registry.list()).toEqual([]);
    expect(registry.defaultId()).toBe('fanuc-gcode');
    expect(registry.detect('/nc/a.h', '0 BEGIN PGM A MM', 'fanuc-gcode')).toBe('fanuc-gcode');
    expect(registry.openFilters()[0].extensions).toEqual([]);
  });
});

describe('detect', () => {
  const klartext = '0 BEGIN PGM TEST MM\n1 TOOL CALL 5 Z S2000\n2 END PGM TEST MM\n';
  const fanuc = '%\nO1234\nN10 G0 X0\nM30\n%\n';

  it('scores the extension together with the content (AD-11)', () => {
    expect(withFilters.detect('/nc/a.h', klartext, 'fanuc-gcode')).toBe('heidenhain-klartext');
    expect(withFilters.detect('/nc/a.nc', fanuc, 'heidenhain-klartext')).toBe('fanuc-gcode');
    // M8: `.min` is the Okuma main-program extension (F22).
    expect(withFilters.detect('/nc/a.min', '', 'heidenhain-klartext')).toBe('okuma-osp');
  });

  // The M1 behaviour change: the extension is a weight, not a verdict. The full list of
  // results that moved is in `core/profiles/detect.test.ts`.
  it('lets clear content outvote the extension', () => {
    expect(withFilters.detect('/nc/a.nc', klartext, 'fanuc-gcode')).toBe('heidenhain-klartext');
    expect(withFilters.detect('/nc/a.h', fanuc, 'heidenhain-klartext')).toBe('fanuc-gcode');
  });

  it('sniffs the content for .txt and for a document with no path', () => {
    expect(withFilters.detect('/nc/a.txt', klartext, 'fanuc-gcode')).toBe('heidenhain-klartext');
    expect(withFilters.detect(null, klartext, 'fanuc-gcode')).toBe('heidenhain-klartext');
    expect(withFilters.detect(null, fanuc, 'heidenhain-klartext')).toBe('fanuc-gcode');
  });

  it('keeps the fallback when the content says nothing', () => {
    expect(withFilters.detect('/nc/a.txt', '', 'heidenhain-klartext')).toBe('heidenhain-klartext');
    expect(withFilters.detect(null, '\n\n', 'fanuc-gcode')).toBe('fanuc-gcode');
  });

  it('falls back to the default profile when the fallback is not a known id', () => {
    expect(withFilters.detect('/nc/a.txt', '', 'siemens')).toBe('fanuc-gcode');
  });
});

describe('dialog filters', () => {
  it('gives macOS none at all, so extension-less programs stay visible (F7)', () => {
    expect(noFilters.openFilters()).toEqual([]);
    expect(noFilters.saveFilters('fanuc-gcode')).toEqual([]);
  });

  it('offers one NC filter over every extension, plus All files', () => {
    expect(withFilters.openFilters()).toEqual([
      {
        name: t('profiles.filterNc'),
        extensions: [...FANUC_EXTENSIONS, 'h', ...OKUMA_EXTENSIONS, ...SINUMERIK_EXTENSIONS],
      },
      { name: t('profiles.filterAll'), extensions: ['*'] },
    ]);
  });

  it('puts the document profile first when saving', () => {
    expect(withFilters.saveFilters('heidenhain-klartext')).toEqual([
      { name: 'Heidenhain Klartext', extensions: ['h'] },
      { name: 'Fanuc G-Code', extensions: FANUC_EXTENSIONS },
      { name: 'Fanuc lathe G-Code', extensions: FANUC_EXTENSIONS },
      { name: 'Okuma OSP', extensions: OKUMA_EXTENSIONS },
      { name: 'Sinumerik', extensions: SINUMERIK_EXTENSIONS },
      { name: 'Sinumerik milling', extensions: SINUMERIK_EXTENSIONS },
      { name: t('profiles.filterAll'), extensions: ['*'] },
    ]);
  });

  it('still lists every profile for an unknown id', () => {
    expect(withFilters.saveFilters('siemens').map((f) => f.name)).toEqual([
      'Fanuc G-Code',
      'Fanuc lathe G-Code',
      'Heidenhain Klartext',
      'Okuma OSP',
      'Sinumerik',
      'Sinumerik milling',
      t('profiles.filterAll'),
    ]);
  });
});

// ---------------------------------------------------------------------------
// M6: the effective view, the variants and what the databases add to validation
// ---------------------------------------------------------------------------

/** The Fanuc lathe as the registry resolved it: the one built-in with variants. */
const LATHE = withFilters.profile('fanuc-lathe');

/** An effective machine for the lathe, with the parameters a machine would set. */
function machine(params: MachineConfig['params']): EffectiveMachine {
  return effectiveMachine(LATHE, { id: 'lathe-2', name: 'Lathe 2', profile: 'fanuc-lathe', params }, 'document', {});
}

describe('the effective profile', () => {
  it('answers the profile itself when no machine and no variant change anything', () => {
    const none = withFilters.effective('fanuc-gcode', noMachine(withFilters.profile('fanuc-gcode')));
    expect(none.machine.choice).toBe('none');
    expect(none.profile.syntax.decimalPointSignificant).toBe(true);
    expect(none.cp.re.toolTrigger.source).toBe(withFilters.compiled('fanuc-gcode').re.toolTrigger.source);
    expect(none.codes.dialect).toBe('fanuc');
  });

  it('is cached by the machine key, and compiled again for a new one', () => {
    const a = withFilters.effective('fanuc-lathe', machine({ variants: { gcodeSystem: 'A' } }));
    const again = withFilters.effective('fanuc-lathe', machine({ variants: { gcodeSystem: 'A' } }));
    // The same parameters give the same key, and the key is the whole cache.
    expect(again).toBe(a);

    const b = withFilters.effective('fanuc-lathe', machine({ variants: { gcodeSystem: 'B' } }));
    expect(b).not.toBe(a);
    expect(b.cp).not.toBe(a.cp);
    // The B overlay is what the variant declares, and its own database comes with it.
    expect(b.profile.modal?.initial?.feedmode).toBe('G95');
    expect(a.profile.modal?.initial?.feedmode).toBe('G99');
    expect(b.codes.dialect).toBe('fanuc-lathe-b');
    expect(a.codes.dialect).toBe('fanuc-lathe');
    // A machine that is named differently but set up the same shares the compile.
    expect(withFilters.effective('fanuc-lathe', machine({ variants: { gcodeSystem: 'B' } }))).toBe(b);
  });

  it('does not hand a detected variant the profile of a machine that states the same thing', () => {
    // G8 M6. The compiled profile carries `modal.sources` — where every value gEdit has
    // to assume came from — and that comes out of `EffectiveMachine.source`. Two
    // documents can agree on every parameter and disagree about the story: one where the
    // program was read and looked like system B, one where a machine says so. Sharing one
    // compile between them told the second one the first one's sources, so a document
    // with no machine at all was told "machine 'Lathe 2'", or one the user had set up was
    // told "detected".
    const detected = effectiveMachine(LATHE, null, 'none', { gcodeSystem: { value: 'B', margin: 4 } });
    const stated = machine({ variants: { gcodeSystem: 'B' } });
    expect(stated.params).toEqual(detected.params);

    const fromText = withFilters.effective('fanuc-lathe', detected);
    const fromMachine = withFilters.effective('fanuc-lathe', stated);
    expect(fromText).not.toBe(fromMachine);
    expect(fromText.profile.modal?.sources?.feedmode).toBe('detected');
    expect(fromMachine.profile.modal?.sources?.feedmode).toBe('machine');
    // Both still read the program as system B; only the story about it differs.
    expect(fromText.codes.dialect).toBe('fanuc-lathe-b');
    expect(fromMachine.codes.dialect).toBe('fanuc-lathe-b');
    // …and each of the two is still cached.
    expect(withFilters.effective('fanuc-lathe', detected)).toBe(fromText);
  });

  it('follows the machine for the decimal point, whatever the profile writes (AD-31)', () => {
    const calculator = machine({ numberInput: { mode: 'calculator', incrementMm: '1' } });
    const increments = machine({ numberInput: { mode: 'increment', incrementMm: '0.001' } });
    expect(withFilters.effective('fanuc-lathe', calculator).profile.syntax.decimalPointSignificant).toBe(false);
    expect(withFilters.effective('fanuc-lathe', increments).profile.syntax.decimalPointSignificant).toBe(true);
  });

  // An overlay is data: its patterns are checked when the profile loads, but whether the
  // merged profile still holds together only shows when the variant is chosen. `tool`
  // without its named group is exactly that case — it compiles, and the program map could
  // not read a tool number out of it.
  it('falls back to the profile when a variant overlay does not validate, and says so once', () => {
    const broken = structuredClone(fanucJson) as unknown as Record<string, unknown>;
    broken.id = 'broken-overlay';
    broken.machineParams = {
      variants: [
        {
          id: 'gcodeSystem',
          label: 'G-code system',
          default: 'A',
          choices: [
            { value: 'A', label: 'A' },
            { value: 'B', label: 'B', overlay: { toolCall: { tool: 'T(\\d+)' } } },
          ],
        },
      ],
    };
    const { registry, problems } = registryOver([broken]);
    expect(problems).toEqual([]);

    const chosen = effectiveMachine(
      registry.profile('broken-overlay'),
      { id: 'x', name: 'X', profile: 'broken-overlay', params: { variants: { gcodeSystem: 'B' } } },
      'document',
      {},
    );
    const first = registry.effective('broken-overlay', chosen);
    expect(first.cp).toBe(registry.compiled('broken-overlay'));
    expect(first.profile).toBe(registry.profile('broken-overlay'));
    expect(first.codes.dialect).toBe('fanuc');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('the machine settings could not be applied');
    expect(problems[0]).toContain('toolCall.tool');
    // Reported once: the answer is cached like any other.
    expect(registry.effective('broken-overlay', chosen)).toBe(first);
    expect(problems).toHaveLength(1);
  });

  it('throws for a profile nobody loaded, like `profile()` and `compiled()`', () => {
    expect(() => withFilters.effective('siemens', noMachine(LATHE))).toThrow('Unknown profile: siemens');
  });
});

describe('variant detection through the registry', () => {
  it('answers what the profile declares, and nothing for a profile that declares none', () => {
    expect(withFilters.detectVariants('fanuc-gcode', 'N10 G0 X0\n')).toEqual({});
    expect(withFilters.detectVariants('siemens', 'N10 G0 X0\n')).toEqual({});
    // The lathe declares `gcodeSystem` (and, from M9, the two R6 variants with no rules); WP6.2 writes its rules, so until then every
    // program keeps the declared default with a margin of 0.
    expect(Object.keys(withFilters.detectVariants('fanuc-lathe', 'N10 G0 X0\n'))).toEqual(['gcodeSystem', 'incrementalAddresses', 'toolWord']);
  });
});

describe('validation against the code databases', () => {
  const lathe = () => structuredClone(withFilters.profile('fanuc-lathe')) as unknown as Record<string, unknown>;

  it('reports a variant that names a database this build does not have', () => {
    const broken = lathe();
    ((broken.machineParams as { variants: { choices: { codes?: string }[] }[] }).variants[0].choices[1]).codes =
      'fanuc-lathe-c';
    const { registry, problems } = registryOver([fanucJson, broken]);
    expect(registry.list().map((p) => p.id)).toEqual(['fanuc-gcode']);
    expect(problems[0]).toContain('fanuc-lathe-c');
  });

  it('reports a power-on group the profile\'s codes do not have', () => {
    const broken = lathe();
    (broken.machineParams as { modalGroups: string[] }).modalGroups = ['feedmode', 'feedrate'];
    const { problems } = registryOver([fanucJson, broken]);
    expect(problems[0]).toContain('machineParams.modalGroups[1]');
    expect(problems[0]).toContain('feedrate');
  });
});

// The registry is built while the app starts, and an effective compile happens on every
// document whose machine changes. Both are on a path a person waits for (§5 acceptance).
describe('what it costs', () => {
  it('resolves every built-in in 20 ms and compiles one effective profile in 5', () => {
    // `fastest` warms up and takes the best of five: one run on a loaded machine says nothing.
    expectWithin(fastest(5, () => resolveProfiles(BUILTIN_PROFILE_SOURCES)), 20, 'resolve of every built-in');

    let n = 0;
    expectWithin(
      fastest(5, () => {
        // A fresh key every time, so nothing is answered from the cache.
        const registry = createProfileRegistry({ filtersSupported: true });
        const profile = registry.profile('fanuc-lathe');
        registry.effective(
          'fanuc-lathe',
          effectiveMachine(
            profile,
            { id: `m${n}`, name: 'M', profile: 'fanuc-lathe', params: { modalInitial: { plane: `G1${(n++ % 3) + 7}` } } },
            'document',
            {},
          ),
        );
      }),
      // The registry construction is in here too, which is the pessimistic way round.
      5 + 20,
      'registry and one effective compile',
    );
  });

  // I6/G7: opening a file scores it against every shipped profile and, for the winner,
  // against that profile's variants. Both run before the first line is drawn, and M6 added
  // a third profile and a second pass, so the milestone states a budget for the pair.
  it('detects the dialect and the variant of a 400-line program in 5 ms (G7)', () => {
    const block = [
      'O2001 (PIN D30)',
      'G21 G40 G99',
      'G28 U0 W0',
      'T0101 (OD ROUGH)',
      'G50 S2500',
      'G96 S220 M03',
      'G71 U1.5 R0.5',
      'G71 P100 Q200 U0.4 W0.1 F0.25',
      'N100 G00 X20. Z2.',
      'N200 G01 X30. Z-40. F0.2',
    ];
    // 400 lines is what detection reads; more would only prove the cut-off again.
    const text = Array.from({ length: 40 }, () => block.join('\n')).join('\n');
    // Every shipped dialect is scored, not a hand-picked pair.
    expect(withFilters.list().length).toBeGreaterThanOrEqual(3);
    expect(withFilters.detect('l01-turning-a.nc', text, 'fanuc-gcode')).toBe('fanuc-lathe');

    expectWithin(
      fastest(5, () => {
        const winner = withFilters.detect('l01-turning-a.nc', text, 'fanuc-gcode');
        withFilters.detectVariants(winner, text);
      }),
      5,
      'detect and detectVariants of 400 lines',
    );
  });
});

// ---------------------------------------------------------------------------
// M13 (WP13.2, AD-29): the registry reloads
// ---------------------------------------------------------------------------

/** A user profile file: a child of the Fanuc lathe, as a user would write one. */
function userProfile(id: string, patch: Record<string, unknown> = {}): { name: string; text: string } {
  return {
    name: `${id}.json`,
    text: JSON.stringify({ id, name: `${id} lathe`, shortName: id.toUpperCase().slice(0, 8), extends: 'fanuc-lathe', ...patch }),
  };
}

/** A registry wired to a code service the way the application wires its singletons. */
function wired() {
  const codes = createCodeDbService({
    dialectOf: (dialect) => dialect,
    source: (dialect) => BUILTIN_CODE_DB_JSON[dialect],
    sources: () => BUILTIN_CODE_DB_JSON,
    warn: () => {},
  });
  const problems: string[] = [];
  const registry = createProfileRegistry({
    filtersSupported: true,
    codeDbFiles: () => codes.files(),
    codeDb: (dialect, own) => codes.over(own, dialect),
    onProblem: (message) => problems.push(message),
  });
  return { codes, registry, problems };
}

describe('reload', () => {
  it('loads a user profile after the built-ins, with its origin and file, and bumps the revision once', () => {
    const { registry } = wired();
    const seen: number[] = [];
    const stop = registry.revision.subscribe((n) => seen.push(n));
    const lists: string[][] = [];
    const stopAll = registry.all.subscribe((all) => lists.push(all.map((p) => p.id)));

    expect(registry.reload([userProfile('shop-lathe')])).toEqual([]);

    expect(seen).toEqual([0, 1]);
    expect(registry.list().map((p) => p.id).slice(-1)).toEqual(['shop-lathe']);
    expect(lists.at(-1)).toContain('shop-lathe');
    expect(registry.get('shop-lathe')).toMatchObject({
      origin: 'user',
      file: 'shop-lathe.json',
      parent: 'fanuc-lathe',
      chain: ['shop-lathe', 'fanuc-lathe', 'fanuc-gcode'],
    });
    expect(registry.compiled('shop-lathe').profile.id).toBe('shop-lathe');
    expect(registry.get('fanuc-gcode')?.origin).toBe('builtin');
    stop();
    stopAll();
  });

  it('bumps on every reload, also one that changes nothing', () => {
    const { registry } = wired();
    let n = 0;
    registry.revision.subscribe((value) => (n = value));
    registry.reload([]);
    registry.reload([]);
    expect(n).toBe(2);
  });

  it('refuses a user id equal to a built-in id and keeps the built-in', () => {
    const { registry } = wired();
    const problems = registry.reload([userProfile('fanuc-gcode', { name: 'Mine', shortName: 'Mine' })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ origin: 'user', file: 'fanuc-gcode.json', profileId: 'fanuc-gcode', path: 'id' });
    expect(registry.problems()).toEqual(problems);
    expect(registry.get('fanuc-gcode')).toMatchObject({ origin: 'builtin', file: null });
    expect(registry.profile('fanuc-gcode').name).not.toBe('Mine');
  });

  it('loads the first of two files with one id, by file name, and reports the second', () => {
    const { registry } = wired();
    const a = userProfile('twin', { name: 'First', shortName: 'One' });
    const b = { ...userProfile('twin', { name: 'Second', shortName: 'Two' }), name: 'zz-twin.json' };
    const problems = registry.reload([b, a]);
    expect(registry.profile('twin').name).toBe('First');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file: 'zz-twin.json', path: 'id' });
  });

  it('reports a broken file with its file and the JSON path, and every built-in still works', () => {
    const { registry, problems: messages } = wired();
    const before = registry.list().map((p) => p.id);
    const problems = registry.reload([
      { name: 'not-json.json', text: '{ nope' },
      userProfile('bad-step', { numbering: { step: 'ten' } }),
      userProfile('no-parent', { extends: 'nowhere' }),
      userProfile('good'),
    ]);
    expect(registry.list().map((p) => p.id)).toEqual([...before, 'good']);
    const byFile = Object.fromEntries(problems.map((p) => [p.file, p]));
    expect(byFile['not-json.json']).toMatchObject({ origin: 'user', path: '' });
    expect(byFile['not-json.json'].message).toMatch(/not valid JSON/);
    expect(byFile['bad-step.json']).toMatchObject({ profileId: 'bad-step', path: 'numbering.step' });
    expect(byFile['no-parent.json']).toMatchObject({ profileId: 'no-parent', path: 'extends' });
    expect(messages.some((m) => m.startsWith('bad-step was not loaded'))).toBe(true);
    expect(registry.detect('x.mpf', 'G1 X1', 'fanuc-gcode')).toBe('sinumerik');
  });

  it('names a byte order mark', () => {
    const { registry } = wired();
    const problems = registry.reload([{ name: 'bom.json', text: '﻿{}' }]);
    expect(problems[0].message).toMatch(/byte order mark/);
  });

  it('lets a user profile extend another user profile, whatever the file order', () => {
    const { registry } = wired();
    const parent = userProfile('zz-parent', { numbering: { step: 5 } });
    const child = userProfile('aa-child', { extends: 'zz-parent', name: 'Child', shortName: 'Child' });
    expect(registry.reload([child, parent])).toEqual([]);
    expect(registry.profile('aa-child').numbering?.step).toBe(5);
  });

  it('recompiles the effective profile of a reloaded parent, and of its child', () => {
    const { registry } = wired();
    registry.reload([
      userProfile('shop-base', { numbering: { step: 5 } }),
      userProfile('shop-child', { extends: 'shop-base', name: 'Child', shortName: 'Child' }),
    ]);
    const none = (id: string) => noMachine(registry.profile(id));
    const before = registry.effective('shop-child', none('shop-child'));
    expect(before.profile.numbering?.step).toBe(5);
    expect(registry.effective('shop-child', none('shop-child'))).toBe(before);

    registry.reload([
      userProfile('shop-base', { numbering: { step: 2 } }),
      userProfile('shop-child', { extends: 'shop-base', name: 'Child', shortName: 'Child' }),
    ]);
    const after = registry.effective('shop-child', none('shop-child'));
    expect(after).not.toBe(before);
    expect(after.profile.numbering?.step).toBe(2);
    expect(after.cp.profile.numbering?.step).toBe(2);
  });

  it('forgets a user profile that is no longer in the files', () => {
    const { registry } = wired();
    registry.reload([userProfile('short-lived')]);
    expect(registry.get('short-lived')).toBeDefined();
    registry.reload([]);
    expect(registry.get('short-lived')).toBeUndefined();
    expect(() => registry.profile('short-lived')).toThrow(/Unknown profile/);
    expect(registry.problems()).toEqual([]);
  });

  it('detects a user profile by its own extension', () => {
    const { registry } = wired();
    registry.reload([
      userProfile('shop-lathe', {
        files: { extensions: ['shp'], defaultExtension: 'shp', filterName: 'Shop', newFileLineEnding: 'lf' },
        detect: { extensions: { shp: 20 } },
      }),
    ]);
    expect(registry.detect('cut.shp', 'G1 X1', 'fanuc-gcode')).toBe('shop-lathe');
  });
});

describe('reload with the code files of the same load', () => {
  const codeFile = {
    name: 'lathe-shop.json',
    text: JSON.stringify({ dialect: 'lathe-shop', extends: 'fanuc-lathe', codes: [{ code: 'M13', label: 'Chuck clamp (shop)' }] }),
  };
  const systemB = (profile: string, id: string, registry: ReturnType<typeof wired>['registry']) =>
    effectiveMachine(
      registry.profile(profile),
      { id, name: id, profile, params: { variants: { gcodeSystem: 'B' } } },
      'document',
      {},
    );

  it('uses the database a user profile names, once the code files are loaded', () => {
    const { codes, registry } = wired();
    codes.reload([codeFile]);
    expect(registry.reload([userProfile('shop-lathe', { codes: 'lathe-shop' })])).toEqual([]);
    const eff = registry.effective('shop-lathe', noMachine(registry.profile('shop-lathe')));
    expect(eff.codes.dialect).toBe('lathe-shop');
    expect(eff.codes.codes.find((c) => c.code === 'M13')?.label).toBe('Chuck clamp (shop)');
  });

  it('keeps the user M-code under G-code system B (the variant rule)', () => {
    const { codes, registry } = wired();
    codes.reload([codeFile]);
    registry.reload([userProfile('shop-lathe', { codes: 'lathe-shop' })]);
    const eff = registry.effective('shop-lathe', systemB('shop-lathe', 'm1', registry));
    expect(eff.profile.modal?.initial?.feedmode).toBe('G95');
    expect(eff.codes.codes.find((c) => c.code === 'M13')?.label).toBe('Chuck clamp (shop)');
    // ... and the system-B meaning of the codes the user did not write.
    expect(eff.codes.codes.find((c) => c.code === 'G95')?.group).toBe('feedmode');
    // A profile on the built-in database gets the built-in B database, as before.
    const builtinB = registry.effective('fanuc-lathe', systemB('fanuc-lathe', 'm2', registry));
    expect(builtinB.codes.dialect).toBe('fanuc-lathe-b');
  });

  it('accepts a variant that names a user database, which exists only after the code reload', () => {
    const { codes, registry } = wired();
    const variants = structuredClone((LATHE.machineParams as unknown as { variants: unknown[] }).variants) as {
      choices: { value: string; codes?: string }[];
    }[];
    variants[0].choices[1].codes = 'lathe-shop';
    const patch = { machineParams: { ...LATHE.machineParams, variants } };
    // Without the database the profile is refused ...
    expect(registry.reload([userProfile('shop-lathe', patch)])[0]).toMatchObject({ file: 'shop-lathe.json' });
    // ... and with it, loaded first, accepted.
    codes.reload([codeFile]);
    expect(registry.reload([userProfile('shop-lathe', patch)])).toEqual([]);
  });
});

// M13 review fixes CODE-1, CODE-2, CODE-13.
describe('user patterns are bounded (CODE-1)', () => {
  const sinumerikTool = (BUILTIN_PROFILE_SOURCES.find((s) => (s.raw as { id?: string }).id === 'sinumerik')!.raw as {
    toolCall: { tool: string };
  }).toolCall.tool;
  const child = (patch: Record<string, unknown>) => userProfile('shop-turn', { extends: 'sinumerik', codes: 'sinumerik', ...patch });

  it('refuses a repeated group that repeats inside, loads the profile never, and detects fast', () => {
    const { registry } = wired();
    const problems = registry.reload([
      userProfile('slow', { detect: { content: [{ pattern: '^(\\w+\\s?)*$', weight: 5 }] } }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ origin: 'user', file: 'slow.json', profileId: 'slow', path: 'detect.content[0].pattern' });
    expect(problems[0].message).toContain('can take very long');
    expect(registry.get('slow')).toBeUndefined();
    const start = performance.now();
    registry.detect(null, 'ABCDEFGHIJKLMNOPQRSTUVWXYZA!', 'fanuc-gcode');
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('loads a child that only inherits a built-in pattern the check would flag', () => {
    const { registry } = wired();
    expect(registry.reload([child({})])).toEqual([]);
    expect(registry.get('shop-turn')).toBeDefined();
  });

  it('loads a user pattern copied verbatim from a built-in one, and refuses it with one character changed', () => {
    const { registry } = wired();
    expect(registry.reload([child({ toolCall: { tool: sinumerikTool } })])).toEqual([]);
    const changed = registry.reload([child({ toolCall: { tool: `${sinumerikTool}x` } })]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ file: 'shop-turn.json', path: 'toolCall.tool' });
    expect(changed[0].message).toContain('can take very long');
    expect(registry.get('shop-turn')).toBeUndefined();
  });

  it('refuses a very long pattern and a long list with their paths', () => {
    const { registry } = wired();
    const long = registry.reload([userProfile('long', { detect: { content: [{ pattern: 'A'.repeat(700_000), weight: 1 }] } })]);
    expect(long).toHaveLength(1);
    expect(long[0].message).toBe('is longer than 1000 characters');
    const many = registry.reload([
      userProfile('many', { outline: Array.from({ length: 5000 }, (_, i) => ({ kind: 'comment', pattern: `^X${i}$` })) }),
    ]);
    expect(many).toHaveLength(1);
    expect(many[0]).toMatchObject({ path: 'outline', message: 'lists more than 200 entries' });
  });

  it('does not print thousands of lines for a file with thousands of problems', () => {
    const { registry, problems: logged } = wired();
    registry.reload([
      userProfile('noisy', { outline: Array.from({ length: 5000 }, () => ({ kind: 'nonsense', pattern: '(' })) }),
    ]);
    expect(logged.length).toBeLessThanOrEqual(25);
  });
});

describe('one broken user file costs the others nothing (CODE-2)', () => {
  const deep = (levels: number): string => `${'['.repeat(levels)}${']'.repeat(levels)}`;

  it('reports a file that nests absurdly deep with its name, and loads the good ones', () => {
    const { registry } = wired();
    const problems = registry.reload([
      userProfile('a-good'),
      { name: 'b-deep.json', text: `{"id":"b-deep","name":"b","shortName":"B","extends":"fanuc-lathe","zzz":${deep(8000)}}` },
      userProfile('c-good'),
    ]);
    expect(problems.map((p) => p.file)).toEqual(['b-deep.json']);
    expect(problems[0].message).toMatch(/nested too deeply/);
    expect(registry.get('a-good')).toBeDefined();
    expect(registry.get('c-good')).toBeDefined();
    expect(registry.get('b-deep')).toBeUndefined();
  });

  it('survives a deep member in a profile with no parent too', () => {
    const { registry } = wired();
    const problems = registry.reload([
      { name: 'x.json', text: `{"id":"x","zzz":${deep(8000)}}` },
      userProfile('fine'),
    ]);
    expect(problems.map((p) => p.file)).toEqual(['x.json']);
    expect(registry.get('fine')).toBeDefined();
  });
});

describe('a name that is only inherited (CODE-13)', () => {
  it('refuses codes: "constructor" because there is no such database, not for a modal group', () => {
    const { registry } = wired();
    const problems = registry.reload([userProfile('proto', { codes: 'constructor' })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file: 'proto.json', path: 'codes', message: 'the code database "constructor" was not found' });
    expect(registry.get('proto')).toBeUndefined();
  });

  it('does not take "constructor" for a database of a variant either', () => {
    const { registry } = wired();
    const variants = structuredClone((LATHE.machineParams as unknown as { variants: unknown[] }).variants) as {
      choices: { value: string; codes?: string }[];
    }[];
    variants[0].choices[1].codes = 'constructor';
    const problems = registry.reload([userProfile('proto', { machineParams: { ...LATHE.machineParams, variants } })]);
    expect(problems.some((p) => p.message.includes('"constructor" was not found'))).toBe(true);
  });
});
