// The contradiction guard (R1): certain evidence that a program is written in another
// dialect than the one it is read with, and the refusal of every rewrite that depends on
// the dialect's comment, string or block-number syntax.
//
// Three things are proved here: that each kind of evidence is found (headers, markers,
// the spared grammars); that the guard never refuses a program read with its own dialect
// — every fixture under tests/fixtures/nc, under the profile its expectation names; and
// that the transform and script runners refuse before they ask or compute anything.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writable } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { createScriptService } from '$lib/app/scripts';
import { createTransformService } from '$lib/app/transforms';
import { noMachine } from '$lib/core/machines/effective';
import { convertCase } from '$lib/core/transforms/convertCase';
import { insertSpaces } from '$lib/core/transforms/insertSpaces';
import { removeBlockNumbers } from '$lib/core/transforms/removeBlockNumbers';
import { removeComments } from '$lib/core/transforms/removeComments';
import { removeEmptyLines } from '$lib/core/transforms/removeEmptyLines';
import { removeSpaces } from '$lib/core/transforms/removeSpaces';
import { renumber } from '$lib/core/transforms/renumber';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { hasKey, namespaces, t } from '$lib/i18n';
import { createDocumentStore } from '$lib/stores/documents';
import { profiles } from '$lib/stores/profiles';
import { results } from '$lib/stores/results';
import { pythonStatus, resetScriptsForTest } from '$lib/stores/scripts';
import { FIXTURES_DIR, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import { compileProfile } from './compile';
import {
  CONTRADICTION_KEYS,
  EVIDENCE_CHARS,
  GUARD_LINES,
  GUARDED_TRANSFORMS,
  HEADER_LINES,
  contradictionRefusal,
  findContradiction,
  guardsScriptOutput,
  leadingLines,
} from './contradiction';
import { validateProfile } from './validate';
import type { NewDocMeta, UiState } from '$lib/app/types';
import type { Messages } from '$lib/i18n/types';
import type { ScriptEntry } from '$lib/platform/commands';
import type { CompiledProfile } from './types';

const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return compileProfile(checked.profile);
});

function compiled(id: string): CompiledProfile {
  const found = BUILTINS.find((cp) => cp.profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

const FANUC = compiled('fanuc-gcode');
const LATHE = compiled('fanuc-lathe');
const KLARTEXT = compiled('heidenhain-klartext');
const OKUMA = compiled('okuma-osp');
const SINUMERIK = compiled('sinumerik');
const SINUMERIK_MILL = compiled('sinumerik-mill');

function textOf(rel: string): string {
  const opened = openFixture(rel);
  if (opened.refused !== null) throw new Error(`${rel} was refused`);
  return opened.text;
}

const guard = (cp: CompiledProfile, text: string) => findContradiction(cp, text.split('\n'));

/** Every fixture's expected profile, from the detection tables. */
const EXPECTED: Record<string, string> = Object.assign(
  {},
  ...readdirSync(join(FIXTURES_DIR, 'expected/detect'))
    .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
    .map((name) => (JSON.parse(readFileSync(join(FIXTURES_DIR, 'expected/detect', name), 'utf8')) as { fixtures: Record<string, string> }).fixtures),
);

const G183 = readFileSync(join(FIXTURES_DIR, 'expected/detect/programs/l08-g183-macro.nc'), 'utf8');

// ---------------------------------------------------------------------------
// The evidence
// ---------------------------------------------------------------------------

describe('the evidence', () => {
  it('finds the header of the program the source review saw wrecked, read as Fanuc', () => {
    const cases: [string, string, string][] = [
      ['nc/owner-public/sinumerik-mill/2.5D_Milling.mpf', 'sinumerik-mill', '%_N_1_MPF'],
      ['nc/owner-public/heidenhain-klartext/5X_MILLING_VECTOR.H', 'heidenhain-klartext', '0 BEGIN PGM 5X_MILLING MM'],
      ['nc/okuma/o01-flange.MIN', 'okuma-osp', '$O01-FLANGE.MIN%'],
    ];
    for (const [rel, likely, text] of cases) {
      for (const cp of [FANUC, LATHE]) {
        expect(guard(cp, textOf(rel)), `${rel} as ${cp.profile.id}`).toMatchObject({ likely, line: 1, text, kind: 'header' });
      }
    }
  });

  it('finds the Siemens call that Remove Comments would empty, in a program without the header', () => {
    // Demo_1.mpf has no %_N_ line. Under the Fanuc profile `( … )` is a comment, so the
    // arguments of WORKPIECE(…) and CYCLE800(…) would be deleted.
    const found = guard(FANUC, textOf('nc/owner-public/sinumerik-mill/Demo_1.mpf'));
    expect(found).toMatchObject({ likely: 'sinumerik-mill', dialect: 'Sinumerik', kind: 'marker', line: 12 });
    expect(found?.text.startsWith('WORKPIECE(')).toBe(true);
    for (const line of [
      'N220 MCALL CYCLE83 (52,50,2,-4.887,,,2,-1,0,0,1,0,,2,1,0,0)',
      'N240 X=AC(100) Y20',
      'N50 MSG("FACE THE TOP")',
      'N30 T="FACEMILL_D50" D1',
      'N320 TRAORI',
      'N110 G2 X130 Y40 CR=15',
    ]) {
      expect(guard(FANUC, `%\nO1000\n${line}\n`), line).toMatchObject({ likely: 'sinumerik', line: 3, kind: 'marker' });
    }
  });

  it('finds Klartext blocks, Okuma syntax and the Fanuc lathe cycle a renumber would break', () => {
    expect(guard(FANUC, '5 L X+10 Y+5 R0 FMAX\n6 LN X+1 Y+2 NX0 NY0 NZ1\n')).toMatchObject({ likely: 'heidenhain-klartext', line: 1 });
    expect(guard(FANUC, 'O1001\nNLAP1 G81\nG85 NLAP1 D2 F0.3\n')).toMatchObject({ likely: 'okuma-osp', line: 2 });
    expect(guard(LATHE, 'G71 X27.55 Z-24 B60 D0.6 U0.1\n$H2.45 L2 F2\n')).toMatchObject({ likely: 'okuma-osp', line: 2 });
    expect(guard(LATHE, 'G71 X27.55 Z-30 B60 D0.7 U0.1 H2.45 L2 F2 M23\n')).toMatchObject({ likely: 'okuma-osp', line: 1 });
    expect(guard(FANUC, 'O1001\nCALL O2345 Q2\n')).toMatchObject({ likely: 'okuma-osp', line: 2 });
    // The M8 re-review: a Fanuc lathe program read as Okuma, whose G70/G71 P/Q a renumber
    // would leave pointing at old numbers.
    expect(guard(OKUMA, G183)).toMatchObject({ likely: 'fanuc-lathe', dialect: 'Fanuc', kind: 'marker' });
    expect(guard(OKUMA, 'N10 #100=5\n')).toMatchObject({ likely: 'fanuc-gcode' });
    // A Fanuc tape read as Klartext or Sinumerik.
    for (const cp of [KLARTEXT, SINUMERIK]) {
      expect(guard(cp, '%\nO1234 (PART)\nN10 G0 X0\n'), cp.profile.id).toMatchObject({ likely: 'fanuc-gcode', line: 2, kind: 'header' });
    }
  });

  it('names the Sinumerik milling profile for a Siemens milling program, and turning otherwise (M9)', () => {
    // Both Siemens profiles share one grammar, so the evidence says "Sinumerik" either way;
    // which of the two the user wants is read off the lines, as detection reads it.
    const siemens = Object.keys(EXPECTED).filter((rel) => EXPECTED[rel] === 'sinumerik' || EXPECTED[rel] === 'sinumerik-mill');
    expect(siemens.filter((rel) => EXPECTED[rel] === 'sinumerik-mill').length).toBeGreaterThanOrEqual(8);
    expect(siemens.filter((rel) => EXPECTED[rel] === 'sinumerik').length).toBeGreaterThanOrEqual(8);
    for (const rel of siemens) {
      for (const cp of [FANUC, LATHE, OKUMA, KLARTEXT]) {
        const found = guard(cp, textOf(rel));
        // A Siemens subprogram with no header and no Siemens-only line says nothing at all.
        if (found === null) continue;
        expect(found, `${rel} as ${cp.profile.id}`).toMatchObject({ grammar: 'sinumerik', likely: EXPECTED[rel], dialect: 'Sinumerik' });
      }
    }
    // The tool change makes it milling; any turning evidence makes it turning again (a
    // mill-turn program is a turning program, R2), and so does no evidence at all.
    expect(guard(FANUC, '%_N_A_MPF\nN10 T="DRILL_D8"\nN20 M6\n')).toMatchObject({ likely: 'sinumerik-mill' });
    expect(guard(FANUC, '%_N_A_MPF\nN10 CYCLE800()\n')).toMatchObject({ likely: 'sinumerik-mill' });
    expect(guard(FANUC, '%_N_A_MPF\nN10 T="DRILL_D8"\nN20 M6\nN30 G96 S200 LIMS=3000\n')).toMatchObject({ likely: 'sinumerik' });
    expect(guard(FANUC, '%_N_A_MPF\nN10 DIAMON\nN20 T1 D1 M6\n')).toMatchObject({ likely: 'sinumerik' });
    expect(guard(FANUC, '%_N_A_MPF\nN10 G0 X10 Z2\n')).toMatchObject({ likely: 'sinumerik' });
    // A comment or a string that mentions the tool change is not one.
    expect(guard(FANUC, '%_N_A_MPF\nN10 G0 X10 ; M6 BY HAND\nN20 MSG("NEXT: M6")\n')).toMatchObject({ likely: 'sinumerik' });
    expect(guard(FANUC, '%_N_A_MPF\nN10 M61\nN20 M6=3\n')).toMatchObject({ likely: 'sinumerik' });
    // The guard is about the grammar: either Siemens profile reads the other's program
    // with the right comment, string and number rules, so neither refuses it.
    expect(guard(SINUMERIK_MILL, textOf('nc/owner-public/sinumerik/TURN_1.mpf'))).toBeNull();
    expect(guard(SINUMERIK, textOf('nc/owner-public/sinumerik-mill/DRILLING.mpf'))).toBeNull();
  });

  it('finds the Okuma work coordinate system, the machining-centre length offset and the live-tool speed', () => {
    // The certain Okuma syntax of the notes (syntax-okuma §3, §6): `G15 H2`/`G16 H3` select
    // a work coordinate system (Fanuc's G15/G16 are polar coordinates and take no H), a
    // machining-centre `G56 H` is a tool length offset (Fanuc's G56 is a work offset, its H
    // belongs to a G43 or G44), and `SB=` is a two-letter Okuma word.
    for (const cp of [FANUC, LATHE]) {
      expect(guard(cp, 'N10 G15 H2\n'), cp.profile.id).toMatchObject({ likely: 'okuma-osp', kind: 'marker', line: 1 });
      expect(guard(cp, 'N10 G0 X0 Y0\nN20 G16 H3\n'), cp.profile.id).toMatchObject({ likely: 'okuma-osp', line: 2 });
      expect(guard(cp, 'N10 G56 H1 Z50.\n'), cp.profile.id).toMatchObject({ likely: 'okuma-osp' });
      expect(guard(cp, 'N10 M110\nN20 SB=1200 M13\n'), cp.profile.id).toMatchObject({ likely: 'okuma-osp', line: 2 });
    }
    // A Fanuc work offset with its length offset in the same block, polar coordinates
    // without H, and the same words inside a comment are not Okuma evidence.
    expect(guard(FANUC, 'N10 G56 G43 H1 Z50.\nN20 G16 X50. Y30.\nN30 G15\nN40 (G15 H2 SB=500)\n')).toBeNull();
    // A Siemens program may name a variable SB; the Okuma program itself is never refused.
    expect(guard(SINUMERIK, 'N10 SB=5\n')).toBeNull();
    expect(guard(OKUMA, 'N10 G15 H2\nN20 G56 H1\nN30 SB=1200 M13\n')).toBeNull();
  });

  it('still cannot tell a Fanuc mill program read as Okuma from an Okuma one, except by # variables', () => {
    // The gap the notes leave (TODO, WP9.6; written into docs/user/dialects.md by WP9.7):
    // without a manual of the Okuma machining-centre control there is no certain Fanuc mill
    // syntax against it — `T1 M6`, `G43 H1`, `G54` and the drilling cycles may all be written
    // by both. Only Fanuc's macro variables and the Fanuc lathe's P/Q cycles are certain.
    expect(guard(OKUMA, '%\nO1000\nT1 M6\nG54 G90 G0 X0 Y0\nG43 H1 Z50.\nG81 X10. Y10. Z-5. R2. F100.\nM30\n')).toBeNull();
    expect(guard(OKUMA, '%\nO1000\n#101=5\n')).toMatchObject({ likely: 'fanuc-gcode' });
  });

  it('spares the grammar where the same text is valid too', () => {
    // A Sinumerik line may start with a `$` system variable; `O1234` starts an Okuma
    // program as well as a Fanuc one; `CR=` is a word of Okuma's G303.
    expect(guard(SINUMERIK, 'N10 G0 X0\n$TC_DP1[1,1]=0.4\n$P_UIFR[1]=CTRANS(X,10)\n')).toBeNull();
    expect(guard(SINUMERIK, 'N10 G1 X0 F100\nNORM\nCALL O100\n')).toBeNull();
    expect(guard(FANUC, 'N10 G1 X0 F100\nNORM\n')).toMatchObject({ likely: 'okuma-osp' });
    expect(guard(OKUMA, 'O1234\nG50 S2000\n')).toBeNull();
    expect(guard(OKUMA, 'G303 X30 Y30 Z30 CR=45\n')).toBeNull();
    expect(guard(FANUC, 'G303 X30 Y30 Z30 CR=45\n')).toMatchObject({ likely: 'sinumerik' });
  });

  it('reads nothing inside a comment of the dialect the program is read with', () => {
    expect(guard(FANUC, 'N10 G0 X0 (MCALL CYCLE83 (1,2))\nN20 (T="DRILL")\n')).toBeNull();
    expect(guard(FANUC, '(0 BEGIN PGM A MM)\n(%_N_A_MPF)\n')).toBeNull();
    expect(guard(SINUMERIK, 'N10 G0 X0 ; NLAP1 G85 NLAP1\n; 5 L X+0\n')).toBeNull();
  });

  it('lets a certain header of the own dialect overrule a stray marker further down', () => {
    expect(guard(SINUMERIK, '%_N_A_MPF\n;$PATH=/_N_WKS_DIR/_N_A_WPD\nN10 G0 X0\nNLAP1 G81\n')).toBeNull();
    expect(guard(KLARTEXT, '0 BEGIN PGM A MM\n1 L X+0 R0 FMAX\n2 #100=5\n3 END PGM A MM\n')).toBeNull();
    // `O1234` is written by two dialects, so it states neither and shields nothing.
    expect(guard(FANUC, 'O1234\nNLAP1 G81\n')).toMatchObject({ likely: 'okuma-osp', line: 2 });
  });

  it('reads a Sinumerik main block as a block, not as a Fanuc program number (M9 integration)', () => {
    // `:7 G1 X10 F100` opens with the main-block prefix; only a `:1234` alone on its line
    // is a Fanuc tape start. Renumber and Remove Comments must not refuse the program.
    expect(guard(SINUMERIK, '%_N_A_MPF\nN5 G0 X0\n:7 G1 X10 F100\nN20 G1 X20\n')).toBeNull();
    expect(guard(OKUMA, ':7 G1 X10 F100\n')).toBeNull();
    expect(guard(FANUC, ':7 G1 X10 F100\nN20 G1 X20\n')).toBeNull();
    // The older `:1234` program number, alone on its line, still states Fanuc.
    expect(guard(SINUMERIK, ':1234\nN10 G0 X0\n')).toBeNull();
    expect(guard(KLARTEXT, ':1234 (PART)\nN10 G0 X0\n')).toMatchObject({ likely: 'fanuc-gcode', line: 1, kind: 'header' });
    expect(guard(KLARTEXT, ':7 G1 X10 F100\n')).toBeNull();
  });

  it('looks for a header in the first lines only, and for a marker in the first 400 non-empty ones', () => {
    const padding = Array.from({ length: HEADER_LINES }, (_, i) => `N${i + 1}0 G0 X${i}`);
    expect(guard(FANUC, [...padding, '%_N_A_MPF'].join('\n'))).toBeNull();
    expect(guard(FANUC, [...padding.slice(1), '', '', '%_N_A_MPF'].join('\n'))).toMatchObject({ line: HEADER_LINES + 2 });
    const page = Array.from({ length: GUARD_LINES }, (_, i) => `N${i + 1} G1 X${i}`);
    expect(guard(FANUC, [...page, 'MCALL CYCLE81(5,0,2,-12,)'].join('\n'))).toBeNull();
    expect(guard(FANUC, [...page.slice(1), 'MCALL CYCLE81(5,0,2,-12,)'].join('\n'))).toMatchObject({ line: GUARD_LINES });
  });

  it('quotes the evidence, cut to a length a status message can carry', () => {
    const long = `N10 MCALL CYCLE83 (${'1,'.repeat(40)}2)`;
    const found = guard(FANUC, long);
    expect(found?.text.length).toBe(EVIDENCE_CHARS);
    expect(found?.text.endsWith('…')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Never a refusal where the dialect is right
// ---------------------------------------------------------------------------

describe('a program read with its own dialect', () => {
  const decided = listFixtures('nc').filter((rel) => {
    const expected = EXPECTED[rel];
    return expected !== undefined && expected !== 'fallback' && expected !== 'refused';
  });

  it('covers every fixture that one dialect is expected for', () => {
    expect(decided.length).toBeGreaterThanOrEqual(60);
  });

  it.each(decided)('%s is never refused', (rel) => {
    const text = textOf(rel);
    expect(guard(compiled(EXPECTED[rel]), text), rel).toBeNull();
    // A user profile of the same dialect family reads the same syntax.
    const family = BUILTINS.filter((cp) => cp.profile.grammar === compiled(EXPECTED[rel]).profile.grammar);
    for (const cp of family) expect(guard(cp, text), `${rel} as ${cp.profile.id}`).toBeNull();
  });

  it('refuses nothing that detection leaves to the fallback, whichever profile that is', () => {
    for (const rel of listFixtures('nc').filter((r) => EXPECTED[r] === 'fallback')) {
      const opened = openFixture(rel);
      if (opened.refused !== null) continue;
      for (const cp of BUILTINS) expect(guard(cp, opened.text), `${rel} as ${cp.profile.id}`).toBeNull();
    }
  });

  it('never refuses the Fanuc lathe program that calls a builder macro', () => {
    expect(guard(LATHE, G183)).toBeNull();
    expect(guard(FANUC, G183)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bounded reading and the refusal message
// ---------------------------------------------------------------------------

describe('reading the document', () => {
  it('reads the leading lines in chunks and stops once it has enough', () => {
    const total = 1_000_000;
    const reads: [number, number][] = [];
    const read = (first: number, last: number): string[] => {
      reads.push([first, last]);
      return Array.from({ length: last - first + 1 }, (_, i) => `N${first + i} G1 X1`);
    };
    const lines = leadingLines(read, total);
    expect(lines.length).toBe(GUARD_LINES * 2);
    expect(reads).toEqual([[1, GUARD_LINES * 2]]);
  });

  it('reads past empty lines, but not to the end of a file of nothing', () => {
    let read = 0;
    const lines = leadingLines((first, last) => {
      read += last - first + 1;
      return Array.from({ length: last - first + 1 }, () => '');
    }, 5_000_000);
    expect(read).toBeLessThanOrEqual(20_000 + GUARD_LINES * 2);
    expect(lines.every((line) => line === '')).toBe(true);
  });

  it('builds the refusal with the action, both dialects, the line and the evidence', () => {
    const text = textOf('nc/owner-public/sinumerik-mill/2.5D_Milling.mpf').split('\n');
    const msg = contradictionRefusal(FANUC, (a, b) => text.slice(a - 1, b), text.length, 'Remove Comments', 'transforms');
    expect(msg).toEqual({
      key: 'transforms.contradiction',
      params: { action: 'Remove Comments', profile: 'Fanuc (ISO) mill', likely: 'Sinumerik', line: 1, evidence: '%_N_1_MPF' },
    });
    expect(contradictionRefusal(SINUMERIK, (a, b) => text.slice(a - 1, b), text.length, 'x', 'scripts')).toBeNull();
  });

  it('has a message in both namespaces that uses exactly the parameters it is given', () => {
    const params = ['action', 'evidence', 'likely', 'line', 'profile'];
    for (const key of Object.values(CONTRADICTION_KEYS)) {
      expect(hasKey(key), key).toBe(true);
      const [ns, leaf] = key.split('.');
      const message = (namespaces[ns] as Messages)[leaf] as string;
      expect([...new Set([...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort(), key).toEqual(params);
      // The way out, for a user who chose the dialect by hand as for a wrong guess.
      expect(message).toContain(namespaces.profiles.setProfile as string);
    }
  });

  it('names a built-in profile of the evidence grammar as the likely dialect', () => {
    const cases = ['%_N_A_MPF', '%_N_A_MPF\nT="A" M6', '0 BEGIN PGM A MM', '$A.MIN%', 'O1234', 'G71 P10 Q20 U0.4 W0.1 F0.2', 'NLAP1 G81', 'G15 H2'];
    for (const line of cases) {
      for (const cp of BUILTINS) {
        const found = guard(cp, line);
        if (found === null) continue;
        const likely = compiled(found.likely);
        expect(likely.profile.grammar, line).toBe(found.grammar);
        expect(likely.profile.shortName.startsWith(found.dialect), line).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Which rewrites are guarded
// ---------------------------------------------------------------------------

describe('the guarded rewrites', () => {
  it('decides every NC transform: the ones that read comment, string or number syntax refuse', () => {
    const all = [removeComments, renumber, removeBlockNumbers, insertSpaces, removeSpaces, convertCase, removeEmptyLines];
    expect(all.filter((def) => GUARDED_TRANSFORMS.has(def.id)).map((def) => def.id).sort()).toEqual([...GUARDED_TRANSFORMS].sort());
    expect(all.filter((def) => !GUARDED_TRANSFORMS.has(def.id)).map((def) => def.id)).toEqual(['remove-empty-lines']);
  });

  it('guards a script whose result replaces the program or becomes one, and no other', () => {
    expect(guardsScriptOutput('replace')).toBe(true);
    expect(guardsScriptOutput('new-document')).toBe(true);
    expect(guardsScriptOutput('panel')).toBe(false);
    expect(guardsScriptOutput('report')).toBe(false);
    expect(guardsScriptOutput(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The runners
// ---------------------------------------------------------------------------

function newDoc(profileId: string): NewDocMeta {
  return {
    path: '/jobs/plate.mpf',
    untitledIndex: null,
    profileId,
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'crlf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
  };
}

const SIEMENS = textOf('nc/owner-public/sinumerik-mill/2.5D_Milling.mpf').split('\n');

function effectiveOf(docs: ReturnType<typeof createDocumentStore>) {
  return (id: string) => {
    const profileId = docs.get(id)?.profileId ?? 'fanuc-gcode';
    const profile = profiles.profile(profileId);
    return {
      profile,
      cp: profiles.compiled(profileId),
      codes: { dialect: 'x', version: 1, addresses: {}, codes: [] },
      machine: noMachine(profile),
    };
  };
}

describe('the transform runner', () => {
  function run(profileId: string, lines: string[], def = removeComments) {
    const docs = createDocumentStore({ caseInsensitivePaths: false });
    const docId = docs.add(newDoc(profileId));
    const seen = { forms: 0, applied: 0, status: [] as { text: string; error: boolean }[], created: 0 };
    const service = createTransformService({
      docs,
      editor: {
        getLineCount: () => lines.length,
        getLines: (_id, a, b) => lines.slice(a - 1, b),
        selectionLines: () => null,
      },
      machines: { effective: effectiveOf(docs) },
      modals: {
        form: (request) => {
          seen.forms++;
          return Promise.resolve(request.values);
        },
      },
      dialogs: { confirm: () => Promise.resolve(true) },
      status: { show: (text, o) => seen.status.push({ text, error: o?.error === true }) },
      uiState: { getLastParams: () => undefined, setLastParams: () => undefined },
      results,
      files: {
        newUntitled: () => {
          seen.created++;
          return 'd-new';
        },
      },
      applyLines: (_id, _a, _b, out) => {
        seen.applied++;
        return { changedLines: out.length };
      },
      t,
    });
    return { service, seen, docId };
  }

  beforeEach(() => results.clear());

  it('refuses Remove Comments and Renumber on a Siemens program read as Fanuc, before the form opens', async () => {
    for (const def of [removeComments, renumber]) {
      const { service, seen } = run('fanuc-gcode', SIEMENS, def);
      expect(await service.run(def), def.id).toBeNull();
      expect(seen.forms, def.id).toBe(0);
      expect(seen.applied, def.id).toBe(0);
      const last = seen.status[seen.status.length - 1];
      expect(last.error).toBe(true);
      expect(last.text).toContain('Sinumerik');
      expect(last.text).toContain('Fanuc (ISO) mill');
      expect(last.text).toContain('Change Dialect');
    }
  });

  it('refuses a target in a new tab too: the result would be the wrecked program', async () => {
    const { service, seen } = run('fanuc-gcode', SIEMENS);
    expect(await service.run(removeComments, { target: 'new-document', skipForm: true })).toBeNull();
    expect(seen.created).toBe(0);
  });

  it('runs on the same program read as Sinumerik, and runs Remove Empty Lines under any dialect', async () => {
    const own = run('sinumerik', SIEMENS);
    expect(await own.service.run(removeComments, { skipForm: true })).not.toBeNull();
    expect(own.seen.applied).toBe(1);
    const empty = run('fanuc-gcode', SIEMENS, removeEmptyLines);
    expect(await empty.service.run(removeEmptyLines, { skipForm: true })).not.toBeNull();
  });
});

describe('the script runner', () => {
  const META = {
    name: 'Scale feed rates',
    description: '',
    profiles: null,
    input: 'selection-or-document' as const,
    output: 'replace' as const,
    timeout: null,
    envelope: false,
    documents: 'active' as const,
    params: [],
    warnings: [],
  };

  function harness(profileId: string, output: 'replace' | 'panel' | 'new-document') {
    const docs = createDocumentStore({ caseInsensitivePaths: false });
    const docId = docs.add(newDoc(profileId));
    const entry: ScriptEntry = {
      id: 'bundled:scale_feed.py',
      root: 'bundled',
      group: null,
      fileName: 'scale_feed.py',
      meta: { ...META, output },
      headerError: null,
      shadowed: false,
      editable: false,
    };
    const seen = { runs: 0, status: [] as { text: string; error: boolean }[] };
    const ui = writable<UiState>({ layout: {}, lastParams: {}, lastScript: null, files: {} });
    const service = createScriptService({
      docs,
      editor: {
        getLineCount: () => SIEMENS.length,
        getLines: (_id, a, b) => SIEMENS.slice(a - 1, b),
        selectionLines: () => null,
        cursor: () => ({ line: 1, column: 1, selectedChars: 0, selections: 1 }),
        versionId: () => 1,
      },
      machines: { effective: effectiveOf(docs) },
      modals: { form: (request) => Promise.resolve(request.values) },
      dialogs: { confirm: () => Promise.resolve(false) },
      status: { show: (text, o) => seen.status.push({ text, error: o?.error === true }) },
      uiState: {
        state: ui,
        getLastParams: () => undefined,
        setLastParams: () => undefined,
        update: (fn) => ui.update(fn),
      },
      results,
      files: { newUntitled: () => 'd-new' },
      layout: { show: () => undefined },
      applyLines: (_id, _a, _b, out) => ({ changedLines: out.length }),
      backend: {
        list: () => Promise.resolve({ scripts: [entry], folders: [] }),
        run: () => {
          seen.runs++;
          return Promise.resolve({
            exitCode: 0,
            success: true,
            stdout: SIEMENS.join('\n'),
            stderr: '',
            timedOut: false,
            cancelled: false,
            stdoutTruncated: false,
            durationMs: 1,
            interpreter: 'python3',
          });
        },
        cancel: () => Promise.resolve(true),
        check: () => Promise.resolve({ ok: true, interpreter: 'python3', version: '3.12.1', message: null }),
      },
      isDesktop: () => true,
      newRunId: () => 'run-1',
      now: () => 1,
      t,
    });
    return { service, seen, entry, docId };
  }

  beforeEach(() => {
    resetScriptsForTest();
    results.clear();
  });

  it('refuses a replacing script on a Siemens program read as Fanuc, before Python is asked', async () => {
    for (const output of ['replace', 'new-document'] as const) {
      const h = harness('fanuc-gcode', output);
      await h.service.rescan();
      pythonStatus.set({ ok: true, interpreter: 'python3', version: '3.12.1', message: null });
      await h.service.run(h.entry.id);
      expect(h.seen.runs, output).toBe(0);
      const last = h.seen.status[h.seen.status.length - 1];
      expect(last.error, output).toBe(true);
      expect(last.text, output).toContain('Sinumerik');
    }
  });

  it('runs a panel script on the same document, and a replacing one read as Sinumerik', async () => {
    const panel = harness('fanuc-gcode', 'panel');
    await panel.service.rescan();
    pythonStatus.set({ ok: true, interpreter: 'python3', version: '3.12.1', message: null });
    await panel.service.run(panel.entry.id);
    expect(panel.seen.runs).toBe(1);

    resetScriptsForTest();
    const own = harness('sinumerik', 'replace');
    await own.service.rescan();
    pythonStatus.set({ ok: true, interpreter: 'python3', version: '3.12.1', message: null });
    await own.service.run(own.entry.id);
    expect(own.seen.runs).toBe(1);
  });
});
