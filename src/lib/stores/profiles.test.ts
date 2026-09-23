// The profile registry (plan §7.2, §7.4, AD-7, AD-11): what the status bar, the save
// dialog and `files.open` read off a profile, which filters reach a picker on which
// platform, and what happens to a profile that does not load.

import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createProfileRegistry } from './profiles';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { t } from '$lib/i18n';
import type { EffectiveMachine, MachineConfig } from '$lib/core/machines/types';

const withFilters = createProfileRegistry({ filtersSupported: true });
const noFilters = createProfileRegistry({ filtersSupported: false });

const FANUC_EXTENSIONS = ['nc', 'tap', 'cnc', 'eia', 'iso', 'min', 'ncc', 'ptp', 'txt'];

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
    const { registry, problems } = registryOver([fanucWith({ id: 'broken', grammar: 'sinumerik' }), fanucJson]);
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
    expect(withFilters.detect('/nc/a.min', '', 'heidenhain-klartext')).toBe('fanuc-gcode');
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
      { name: t('profiles.filterNc'), extensions: [...FANUC_EXTENSIONS, 'h'] },
      { name: t('profiles.filterAll'), extensions: ['*'] },
    ]);
  });

  it('puts the document profile first when saving', () => {
    expect(withFilters.saveFilters('heidenhain-klartext')).toEqual([
      { name: 'Heidenhain Klartext', extensions: ['h'] },
      { name: 'Fanuc G-Code', extensions: FANUC_EXTENSIONS },
      { name: 'Fanuc lathe G-Code', extensions: FANUC_EXTENSIONS },
      { name: t('profiles.filterAll'), extensions: ['*'] },
    ]);
  });

  it('still lists every profile for an unknown id', () => {
    expect(withFilters.saveFilters('siemens').map((f) => f.name)).toEqual([
      'Fanuc G-Code',
      'Fanuc lathe G-Code',
      'Heidenhain Klartext',
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
    // The lathe declares `gcodeSystem`; WP6.2 writes its rules, so until then every
    // program keeps the declared default with a margin of 0.
    expect(Object.keys(withFilters.detectVariants('fanuc-lathe', 'N10 G0 X0\n'))).toEqual(['gcodeSystem']);
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
  /** The best of a few runs: a single one on a loaded machine says nothing. */
  function fastest(runs: number, work: () => void): number {
    let best = Infinity;
    for (let i = 0; i < runs; i++) {
      const started = performance.now();
      work();
      best = Math.min(best, performance.now() - started);
    }
    return best;
  }

  it('resolves every built-in in 20 ms and compiles one effective profile in 5', () => {
    expect(fastest(5, () => resolveProfiles(BUILTIN_PROFILE_SOURCES))).toBeLessThan(20);

    let n = 0;
    expect(
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
    ).toBeLessThan(5 + 20);
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

    expect(
      fastest(5, () => {
        const winner = withFilters.detect('l01-turning-a.nc', text, 'fanuc-gcode');
        withFilters.detectVariants(winner, text);
      }),
    ).toBeLessThan(5);
  });
});
