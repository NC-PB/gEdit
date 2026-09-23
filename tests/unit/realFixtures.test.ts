// The owner's own programs, from a folder that is never committed (plan §9.2, D45, gate
// G11). Written by the M6 prelude (P6); **FX owns it afterwards**.
//
// Why it is here at all: every committed fixture is synthetic, written from the syntax
// notes. Synthetic files prove the rules gEdit was told about; only a real posted program
// proves the ones it was not. So the check exists, and the programs stay on the owner's
// machine.
//
// Three rules this file may not break (standing rule 12):
//
//  1. **No snapshot helper.** `toMatchSnapshot` and friends write their argument into a
//     committed `__snapshots__/*.snap` or into this very file. One run against a real
//     program would publish it.
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

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Where the manifest and the programs are, or why there is none. */
export type RealFolder =
  | { kind: 'folder'; path: string; source: 'env' | 'worktree' }
  | { kind: 'not-found' };

/** One program the owner wants checked. Everything but `file` and `profile` is optional. */
export interface RealProgram {
  file: string;
  profile: string;
  variant?: Record<string, string>;
  machine?: Record<string, unknown>;
  tools?: string[];
  allowUnknown?: string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The main working tree's `tests/real`, even from inside a linked worktree.
 *
 * `git rev-parse --git-common-dir` answers the **shared** `.git` directory, which is the
 * main checkout's; its parent is the main working tree.
 */
function worktreeFolder(): string | null {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: HERE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (common === '') return null;
    const root = isAbsolute(common) ? common : resolve(HERE, common);
    return join(dirname(root), 'tests', 'real');
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
  const fallback = worktreeFolder();
  if (fallback !== null && existsSync(fallback) && statSync(fallback).isDirectory()) {
    return { kind: 'folder', path: fallback, source: 'worktree' };
  }
  return { kind: 'not-found' };
}

/** The manifest of a folder, or null when there is none (which is "no programs"). */
export function readManifest(folder: string): RealProgram[] | null {
  const path = join(folder, 'manifest.json');
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { programs?: unknown };
  const programs = Array.isArray(raw.programs) ? raw.programs : [];
  return programs.filter((entry): entry is RealProgram => {
    const program = entry as Partial<RealProgram>;
    return typeof program?.file === 'string' && typeof program?.profile === 'string';
  });
}

/** What a run found, for the line the commit body records (counts only, never a path). */
export function summary(folder: RealFolder, programs: RealProgram[] | null): string {
  if (folder.kind === 'not-found') return 'G11 skipped: no local folder found';
  if (programs === null || programs.length === 0) {
    return `G11 skipped: no programs in the local folder (${folder.source})`;
  }
  return `G11: ${programs.length} local programs (${folder.source})`;
}

describe('the local programs', () => {
  const folder = realFolder();
  const programs = folder.kind === 'folder' ? readManifest(folder.path) : null;

  it('says which of the two skips this run is, and never where it looked', () => {
    const line = summary(folder, programs);
    expect(line).toMatch(/^G11[ :]/);
    // The whole point of the indirection: a path on the owner's disk is not a test result.
    if (folder.kind === 'folder') expect(line).not.toContain(folder.path);
  });

  it.skipIf(folder.kind !== 'folder' || programs === null || programs.length === 0)(
    'reads every program the manifest names',
    () => {
      // FX fills this in: detection = the manifest, no unknown token outside comments
      // except the allow-list, the outline's stations = the manifest, `tool_list` = the
      // outline, and a byte-exact round trip — each reported by manifest index only.
      expect(programs ?? []).not.toHaveLength(0);
      (programs ?? []).forEach((program, index) => {
        expect(existsSync(join((folder as { path: string }).path, program.file)), `manifest entry ${index}`).toBe(
          true,
        );
      });
    },
  );
});
