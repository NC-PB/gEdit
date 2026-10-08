// The channel goldens of `tests/fixtures/channels/resolve/` (plan §7.17, §9.1 M12 rows,
// WP12.1): every case resolved through `resolveDocument`, the one composition the service
// and the script context use, and compared on the keys its `expect` lists. Also the
// fixture rules of `tests/fixtures/README.md` for the channel programs, which live under
// `tests/fixtures/channels/nc/` (see `tests/fixtures/channels/README.md` for why): the
// marker, LF endings, a final newline, a README line, the detected profile, and a golden
// for every program.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectProfile } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { decodeFile } from '$lib/core/text';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { resolveDocument, type ResolvedDocument } from './marks';
import { siblingNames } from './siblings';
import type { ChannelParams } from './types';

const ROOT = fileURLToPath(new URL('../../../../tests/fixtures/channels/', import.meta.url));
const GOLDENS = join(ROOT, 'resolve');
const NC = join(ROOT, 'nc');

const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return compileProfile(checked.profile);
});
const compiled = (id: string): CompiledProfile => {
  const cp = BUILTINS.find((c) => c.profile.id === id);
  if (!cp) throw new Error(`no profile ${id}`);
  return cp;
};

interface Golden {
  input: string;
  profile: string;
  machine?: { channels: ChannelParams };
  /** `<profile id>/<preset id>`: the profile's own preset as the machine's channel block. */
  preset?: string;
  /** The user's assignment (`channels.assign`), for a `multi-file` case. */
  assigned?: string;
  expect: Record<string, unknown>;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

function paramsOf(g: Golden): ChannelParams {
  if (g.machine) return g.machine.channels;
  const [profileId, presetId] = (g.preset ?? '').split('/');
  const decl = compiled(profileId).profile.machineParams?.channels;
  const preset = decl?.presets.find((p) => p.id === presetId);
  if (!preset) throw new Error(`no preset ${g.preset}`);
  return preset.value;
}

function textOf(file: string): string {
  const decoded = decodeFile(new Uint8Array(readFileSync(file)));
  if (!decoded.ok) throw new Error(`${file} does not open`);
  return decoded.text;
}

/** What a golden's `expect` keys are compared against. */
function actualOf(g: Golden, file: string): Record<string, unknown> {
  const cp = compiled(g.profile);
  const p = paramsOf(g);
  const lines = textOf(file).split('\n');
  const r: ResolvedDocument = resolveDocument(basename(file), lines, cp, p, { assigned: g.assigned });
  return {
    layout: r.layout,
    self: r.self?.id ?? null,
    by: r.by,
    stem: r.stem,
    sections: r.sections.map((s) => ({ channel: s.channel.id, ranges: s.ranges })),
    outside: r.outside,
    marks: r.marks,
    dropped: r.dropped,
    problems: r.problems.map((x) => ({ path: x.path, key: x.message.key, params: x.message.params ?? {} })),
    siblings: p.layout === 'multi-file' ? (siblingNames(basename(file), p, r.self?.id)?.map((s) => ({ channel: s.channel.id, name: s.name })) ?? null) : undefined,
  };
}

const goldenFiles = walk(GOLDENS).filter((f) => f.endsWith('.json'));
const goldens = goldenFiles.map((file) => {
  const g = JSON.parse(readFileSync(file, 'utf8')) as Golden;
  return { name: relative(GOLDENS, file), g, input: join(dirname(file), g.input) };
});

describe('channel goldens', () => {
  it('there are goldens', () => {
    expect(goldens.length).toBeGreaterThan(20);
  });

  for (const { name, g, input } of goldens) {
    it(name, () => {
      const actual = actualOf(g, input);
      const keys = Object.keys(g.expect);
      expect(keys.length, 'a golden checks something').toBeGreaterThan(0);
      for (const key of keys) {
        if (key === 'marks') {
          // A mark entry lists the fields it checks; the order and the count are exact.
          const marks = actual.marks as Record<string, unknown>[];
          const want = g.expect.marks as Record<string, unknown>[];
          expect(marks.map((m, i) => Object.fromEntries(Object.keys(want[i] ?? m).map((k) => [k, m[k]]))), 'marks').toEqual(want);
        } else {
          expect(actual[key], key).toEqual(g.expect[key]);
        }
      }
    });
  }
});

describe('channel fixture programs', () => {
  const programs = walk(NC);
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

  it('are all read by a golden', () => {
    const read = new Set(goldens.map((x) => x.input));
    expect(programs.filter((f) => !read.has(f)).map((f) => relative(ROOT, f))).toEqual([]);
  });

  it.each(programs.map((f) => relative(ROOT, f)))('%s is written for gEdit, LF, listed, and detected as its golden says', (rel) => {
    const file = join(ROOT, rel);
    const bytes = readFileSync(file);
    const text = bytes.toString('latin1');
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n', 2).some((line) => /^(?:; |\()WRITTEN FOR GEDIT\b/.test(line))).toBe(true);
    expect(readme).toContain(`\`${basename(file)}\``);
    const profiles = new Set(goldens.filter((x) => x.input === file).map((x) => x.g.profile));
    expect(profiles.size).toBe(1);
    expect(detectProfile(BUILTINS, `/work/${basename(file)}`, textOf(file), 'fanuc-gcode')).toBe([...profiles][0]);
  });
});
