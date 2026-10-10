// The owner's own programs, from a folder that is never committed (plan §9.2, D45, gate
// G11). Owned by FX; M9 (WP9.6) made it
// the real, manifest-driven G11 run of `tests/real/README.md`.
//
// Why it is here at all: every committed fixture is synthetic, written from the syntax
// notes, or one of the few programs the owner published. Synthetic files prove the rules
// gEdit was told about; only a real posted program proves the ones it was not. So the
// check exists, and the programs stay on the owner's machine.
//
// Three rules this file may not break (standing rule 12):
//
//  1. **No snapshot helper** (the `toMatch…Snapshot` family). A snapshot writes its
//     argument into a committed `__snapshots__/*.snap` or into this very file. One run
//     against a real program would publish it.
//  2. **No file name, no program text in a message.** A failure says which manifest entry
//     and which line number, and nothing else. The folder itself is never printed either —
//     it is a path on the owner's disk.
//  3. **Skips are loud and are two different things.** "No local folder" and "a folder
//     with no manifest" are recorded separately, so a green run never quietly means
//     nothing ran.
//
// The folder: `GEDIT_REAL_FIXTURES`, else `tests/real` **of the main working tree**. The
// indirection matters — this test also runs inside a `wt/<wp>` git worktree, where an
// ignored `tests/real/` does not exist, and a plain relative path would report "no
// programs" while the programs sit in the main checkout.
//
// What a run does (`helpers/g11.ts`): every check of the README over every program, under
// the machine its entry names, then one printed line per check. By default the test fails
// only on a crash — the report is the gate's result, and it goes into the commit body.
// With `GEDIT_G11=strict` every failure and every "no longer a gap" fails it too, which is
// how the owner checks a manifest they have finished. The logic itself is tested below on
// a synthetic manifest in a temporary folder, so it runs in CI without a real program.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from './helpers/fixtures';
import { CHECKS, type G11Report, type RealProgram, type Source, allowed, formatReport, programsOf, runG11 } from './helpers/g11';
import { findPython } from './helpers/realPrograms';

export type { RealProgram } from './helpers/g11';

/** Where the manifest and the programs are, or why there is none. */
export type RealFolder =
  | { kind: 'folder'; path: string; source: 'env' | 'worktree' }
  | { kind: 'not-found' };

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository this test file is in: a worktree, or the main checkout. */
const REPO = resolve(HERE, '..', '..');

/**
 * The main working tree, even from inside a linked worktree.
 *
 * `git rev-parse --git-common-dir` answers the **shared** `.git` directory, which is the
 * main checkout's; its parent is the main working tree.
 */
function mainWorkingTree(): string | null {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: HERE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (common === '') return null;
    const root = isAbsolute(common) ? common : resolve(HERE, common);
    return dirname(root);
  } catch {
    return null;
  }
}

/** The folder to read, without ever revealing it in a message. */
export function realFolder(env: NodeJS.ProcessEnv = process.env): RealFolder {
  const named = env.GEDIT_REAL_FIXTURES;
  if (typeof named === 'string' && named.trim() !== '') {
    const path = resolve(named.trim());
    if (existsSync(path) && statSync(path).isDirectory()) return { kind: 'folder', path, source: 'env' };
    return { kind: 'not-found' };
  }
  const tree = mainWorkingTree();
  const fallback = tree === null ? null : join(tree, 'tests', 'real');
  if (fallback !== null && existsSync(fallback) && statSync(fallback).isDirectory()) {
    return { kind: 'folder', path: fallback, source: 'worktree' };
  }
  return { kind: 'not-found' };
}

/** The manifest of a folder, or null when there is none (which is "no programs"). */
export function readManifest(folder: string): RealProgram[] | null {
  const path = join(folder, 'manifest.json');
  if (!existsSync(path)) return null;
  return programsOf(JSON.parse(readFileSync(path, 'utf8')));
}

/** The source as the report names it: which of the two folders, never its path. */
function sourceOf(folder: Extract<RealFolder, { kind: 'folder' }>): Source {
  return folder.source === 'env' ? 'GEDIT_REAL_FIXTURES' : 'main working tree';
}

/** What a run found, for the line the commit body records (counts only, never a path). */
export function summary(folder: RealFolder, programs: RealProgram[] | null): string {
  if (folder.kind === 'not-found') return 'G11 skipped: no local folder found';
  if (programs === null || programs.length === 0) {
    return `G11 skipped: no programs in the local folder (${sourceOf(folder)})`;
  }
  return `G11: ${programs.length} local programs (${sourceOf(folder)})`;
}

/**
 * Whether `GEDIT_G11_REPORT` may be written to `path`: inside the local folder or outside
 * the repository, never under its `tests/` (a report there could end up committed, and
 * its counts are the owner's). The main working tree's `tests/real/` is the local folder
 * and gitignored, so it is allowed.
 */
export function reportPathAllowed(path: string, roots: readonly string[]): boolean {
  const target = resolve(path);
  for (const root of roots) {
    const tests = join(root, 'tests');
    const inside = (dir: string): boolean => {
      const rel = relative(dir, target);
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    };
    if (inside(tests) && !inside(join(tests, 'real'))) return false;
  }
  return true;
}

describe('the local programs', () => {
  const folder = realFolder();
  const programs = folder.kind === 'folder' ? readManifest(folder.path) : null;

  it('says which of the two skips this run is, and never where it looked', () => {
    const line = summary(folder, programs);
    expect(line).toMatch(/^G11[ :]/);
    // The whole point of the indirection: a path on the owner's disk is not a test result.
    if (folder.kind === 'folder') expect(line).not.toContain(folder.path);
    console.log(line);
  });

  it.skipIf(folder.kind !== 'folder' || programs === null || programs.length === 0)(
    'runs every check over every program the manifest names (G11)',
    () => {
      const local = folder as Extract<RealFolder, { kind: 'folder' }>;
      const python = findPython();
      const report = runG11(local.path, programs ?? [], sourceOf(local), python);
      const lines = formatReport(report);
      if (!python.ok) lines.push(`G11 the script checks skipped: ${python.reason}`);
      for (const line of lines) expect(line).not.toContain(local.path);
      console.log(lines.join('\n'));

      const target = process.env.GEDIT_G11_REPORT?.trim();
      if (target) {
        const roots = [REPO, mainWorkingTree()].filter((root): root is string => root !== null);
        if (reportPathAllowed(target, roots)) writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        else console.log('G11 report not written: GEDIT_G11_REPORT points under tests/ of the repository');
      }

      expect(report.checks.noCrash.fail, 'a check crashed on a local program').toBe(0);
      if (process.env.GEDIT_G11 === 'strict') {
        expect(report.failures, 'G11 failures (strict)').toEqual([]);
        expect(report.noLongerGaps, 'known gaps that pass now (strict)').toEqual([]);
      }
    },
    600_000,
  );
});

// ---------------------------------------------------------------------------
// The logic, on a synthetic manifest (runs everywhere, CI included)
// ---------------------------------------------------------------------------

describe('G11 reads the manifest as it is', () => {
  it('keeps every entry in place, so a failure names the entry it came from', () => {
    const programs = programsOf({ programs: [{ file: 'a' }, { file: 'b', profile: 'x' }, null, 'text', { file: 'c', profile: 'y' }] });
    expect(programs).toHaveLength(5);
    expect(programs[1]).toEqual({ file: 'b', profile: 'x' });
    expect(programs[4]).toEqual({ file: 'c', profile: 'y' });
  });

  it('fails noCrash at the index of an entry without a file or a profile, and counts it', () => {
    const python = findPython();
    const dir = mkdtempSync(join(tmpdir(), 'gedit-g11-test-'));
    try {
      copyFileSync(join(FIXTURES_DIR, 'nc/fanuc/f01-mill-3tools.nc'), join(dir, 'ok.nc'));
      const programs = programsOf({ programs: [{ file: 'ok.nc', profile: 'fanuc-gcode' }, { file: 'ok.nc' }, { profile: 'fanuc-gcode' }, null, { file: 'ok.nc', profile: 'fanuc-gcode' }] });
      const report = runG11(dir, programs, 'GEDIT_REAL_FIXTURES', python);
      expect(report.programs).toBe(5);
      expect(report.failures.filter((f) => f.check === 'noCrash')).toEqual([1, 2, 3].map((index) => ({ check: 'noCrash', index })));
      expect(report.checks.noCrash).toEqual({ pass: 2, fail: 3, known: 0, skipped: 0 });
      // The entry after the malformed ones is still entry 4, and still passes.
      expect(report.failures.some((f) => f.index === 4)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a manifest with no list of programs as no programs', () => {
    expect(programsOf({})).toEqual([]);
    expect(programsOf(null)).toEqual([]);
    expect(programsOf({ programs: 'x' })).toEqual([]);
  });
});

describe('G11 on a synthetic manifest', () => {
  const python = findPython();

  /** A temporary folder with copies of committed synthetic fixtures and a manifest. */
  function folderWith(files: Record<string, string>, extra: Record<string, string> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'gedit-g11-test-'));
    for (const [name, fixture] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      copyFileSync(join(FIXTURES_DIR, fixture), join(dir, name));
    }
    for (const [name, content] of Object.entries(extra)) writeFileSync(join(dir, name), content, 'utf8');
    return dir;
  }

  const PROGRAMS: RealProgram[] = [
    // 0: everything right, the stations given.
    { file: 'fanuc/mill.nc', profile: 'fanuc-gcode', tools: ['1', '2', '3'] },
    // 1: a lathe in CRLF with its G-code system, stations as the post writes them.
    { file: 'fanuc-lathe/a.nc', profile: 'fanuc-lathe', variant: { gcodeSystem: 'A' }, tools: ['01', '03', '05'] },
    // 2: the wrong profile and the wrong stations: two failures, both by index.
    { file: 'fanuc/wrong.nc', profile: 'fanuc-lathe', tools: ['9'] },
    // 3: mixed line endings do not come back byte for byte — a known gap, with a reason.
    { file: 'mixed.nc', profile: 'fanuc-gcode', knownGaps: { roundTrip: 'the post mixes CRLF and LF' } },
    // 4: a known gap that is no gap: reported as "no longer a gap".
    { file: 'fanuc/again.nc', profile: 'fanuc-gcode', knownGaps: { detection: 'was a lathe once' } },
    // 5: a file the manifest names and the folder does not have.
    { file: 'missing.nc', profile: 'fanuc-gcode' },
    // 6: a machine from machines.json next to the manifest, which picks system B.
    { file: 'fanuc-lathe/b.nc', profile: 'fanuc-lathe', machine: { id: 'lathe-b' }, variant: { gcodeSystem: 'B' } },
    // 7: a binary file: refused, so it cannot round-trip, and nothing else runs.
    { file: 'tape.bin', profile: 'fanuc-gcode' },
    // 8: an inline machine and an unknown token on the allow-list.
    { file: 'unknown.nc', profile: 'fanuc-gcode', machine: { units: 'mm' }, allowUnknown: [{ text: '?', why: 'a test character' }] },
    // 9: the same token, not allowed: a failure at its line.
    { file: 'unknown.nc', profile: 'fanuc-gcode' },
  ];

  const FILES = {
    'fanuc/mill.nc': 'nc/fanuc/f01-mill-3tools.nc',
    'fanuc-lathe/a.nc': 'nc/fanuc-lathe/l01-turning-a.nc',
    'fanuc/wrong.nc': 'nc/fanuc/f01-mill-3tools.nc',
    'mixed.nc': 'nc/encoding/mixed-eol.nc',
    'fanuc/again.nc': 'nc/fanuc/f01-mill-3tools.nc',
    'fanuc-lathe/b.nc': 'nc/fanuc-lathe/l01-turning-a.nc',
    'tape.bin': 'nc/encoding/nul-heavy.bin',
  };
  const MACHINES = JSON.stringify({
    $version: 1,
    machines: [{ id: 'lathe-b', name: 'Lathe B', profile: 'fanuc-lathe', params: { variants: { gcodeSystem: 'B' } } }],
    defaults: {},
  });
  const UNKNOWN = '%\nO1000 (WRITTEN FOR GEDIT)\nG0 X0 Y0\n?\nM30\n%\n';

  function run(): { report: G11Report; lines: string[]; dir: string } {
    const dir = folderWith(FILES, { 'machines.json': MACHINES, 'unknown.nc': UNKNOWN });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ $version: 1, programs: PROGRAMS }), 'utf8');
    try {
      const manifest = readManifest(dir) ?? [];
      const report = runG11(dir, manifest, 'GEDIT_REAL_FIXTURES', python);
      return { report, lines: formatReport(report), dir };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const { report, lines, dir } = run();

  it('reads every entry of the manifest', () => {
    expect(report.programs).toBe(PROGRAMS.length);
    expect(report.source).toBe('GEDIT_REAL_FIXTURES');
  });

  it('counts detection: the right profile and variant, the wrong one, a gap that passes', () => {
    // 0, 1, 3, 4, 6, 8, 9 detect right; 2 does not; 5 and 7 never get that far.
    expect(report.checks.detection).toEqual({ pass: 7, fail: 1, known: 0, skipped: 2 });
    expect(report.failures.filter((f) => f.check === 'detection')).toEqual([{ check: 'detection', index: 2 }]);
    expect(report.noLongerGaps).toEqual([{ check: 'detection', index: 4 }]);
  });

  it('counts the unknown tokens against the allow-list, and names the line of the first', () => {
    expect(report.checks.unknownTokens).toEqual({ pass: 7, fail: 1, known: 0, skipped: 2 });
    expect(report.failures.filter((f) => f.check === 'unknownTokens')).toEqual([{ check: 'unknownTokens', index: 9, line: 4 }]);
  });

  it('compares the stations of the map where the manifest gives them', () => {
    expect(report.checks.map).toEqual({ pass: 2, fail: 1, known: 0, skipped: 7 });
    expect(report.failures.filter((f) => f.check === 'map')).toEqual([{ check: 'map', index: 2, line: 11 }]);
  });

  it('round-trips every file it can open, and counts a known gap as known', () => {
    // 7 is refused (binary), 3 mixes line endings: known. 5 is not there.
    expect(report.checks.roundTrip).toEqual({ pass: 7, fail: 1, known: 1, skipped: 1 });
    expect(report.failures.filter((f) => f.check === 'roundTrip')).toEqual([{ check: 'roundTrip', index: 7 }]);
  });

  it('fails noCrash for the entry whose file is missing, and only that one', () => {
    expect(report.checks.noCrash).toEqual({ pass: 9, fail: 1, known: 0, skipped: 0 });
    expect(report.failures.filter((f) => f.check === 'noCrash')).toEqual([{ check: 'noCrash', index: 5 }]);
  });

  it.runIf(python.ok)('runs the tool list, the scaling scripts at 100 % and the M10 scripts on every program that opens', () => {
    for (const check of ['toolList', 'scaleFeed', 'scaleSpeed', 'programChecks', 'extents', 'addressArithmetic'] as const) {
      expect(report.checks[check], check).toEqual({ pass: 8, fail: 0, known: 0, skipped: 2 });
    }
  });

  it.runIf(!python.ok)('reports the script checks as skipped without Python, never as passed', () => {
    for (const check of ['toolList', 'scaleFeed', 'scaleSpeed', 'programChecks', 'extents', 'addressArithmetic'] as const) {
      expect(report.checks[check], check).toEqual({ pass: 0, fail: 0, known: 0, skipped: 10 });
    }
  });

  it('prints one line per check in the README format, then the failures, and no name', () => {
    expect(lines[0]).toBe('G11 source: GEDIT_REAL_FIXTURES; 10 programs');
    expect(lines.slice(1, 1 + CHECKS.length).map((line) => line.split(/\s+/)[1])).toEqual([...CHECKS]);
    expect(lines[1]).toBe('G11 detection       7 pass   1 fail   0 known   2 skipped');
    expect(lines[CHECKS.length]).toBe('G11 noCrash         9 pass   1 fail');
    expect(lines[CHECKS.length + 1]).toBe('G11 failures: detection #2; unknownTokens #9:4; map #2:11; roundTrip #7; noCrash #5');
    expect(lines[CHECKS.length + 2]).toBe('G11 no longer a gap: detection #4');
    const all = [...lines, JSON.stringify(report)].join('\n');
    for (const name of [...Object.keys(FILES), 'unknown.nc', 'missing.nc', 'O1000', dir]) {
      expect(all, name).not.toContain(name);
    }
  });

  it('reads an allow-list entry as a text with case ignored, or as a /pattern/', () => {
    expect(allowed('init.', ['INIT.'])).toBe(true);
    expect(allowed('SPANBRECHEN.', [{ text: 'spanbrechen.', why: 'dialog text' }])).toBe(true);
    expect(allowed('REF.PKT', ['/^[A-Z]+\\.[A-Z]+$/'])).toBe(true);
    expect(allowed('REF', ['/^[A-Z]+\\.[A-Z]+$/'])).toBe(false);
    expect(allowed('X', ['/(/'])).toBe(false);
    expect(allowed('X', undefined)).toBe(false);
  });

  it('keeps the JSON report out of tests/ of the repository, except the local folder', () => {
    expect(reportPathAllowed(join(REPO, 'tests', 'fixtures', 'g11.json'), [REPO])).toBe(false);
    expect(reportPathAllowed(join(REPO, 'tests', 'g11.json'), [REPO])).toBe(false);
    expect(reportPathAllowed(join(REPO, 'tests', 'real', 'g11.json'), [REPO])).toBe(true);
    expect(reportPathAllowed(join(tmpdir(), 'g11.json'), [REPO])).toBe(true);
  });

  it('tells "no local folder" and "no programs" apart, and names the source, not the path', () => {
    expect(summary({ kind: 'not-found' }, null)).toBe('G11 skipped: no local folder found');
    expect(summary({ kind: 'folder', path: '/secret/place', source: 'env' }, null)).toBe(
      'G11 skipped: no programs in the local folder (GEDIT_REAL_FIXTURES)',
    );
    expect(summary({ kind: 'folder', path: '/secret/place', source: 'worktree' }, [])).toBe(
      'G11 skipped: no programs in the local folder (main working tree)',
    );
    expect(summary({ kind: 'folder', path: '/secret/place', source: 'worktree' }, [{ file: 'a', profile: 'b' }])).toBe(
      'G11: 1 local programs (main working tree)',
    );
    expect(realFolder({ GEDIT_REAL_FIXTURES: join(tmpdir(), 'gedit-no-such-folder-g11') })).toEqual({ kind: 'not-found' });
  });
});
