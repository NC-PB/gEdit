// The built-in dialects of the grammar tests, and the lines they are held to (B1-G). Not used by
// the app; the `*.test.ts` files of this folder import it, as they import `monarchSim.ts`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateGrammar } from './index';
import type { MonarchLike } from './monarchSim';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { emptyCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import { unionCodeDb, variantDialects } from '$lib/monaco/languages';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { LineState } from '$lib/core/nc/types';

const RESOLVED = resolveCodeDbs(BUILTIN_CODE_DB_JSON);

export interface Dialect {
  id: string;
  profile: Profile;
  db: CodeDb;
  cp: CompiledProfile;
  grammar: MonarchLike;
  fixtures: string[];
  /** Lines written for the M12.5 shapes and the B1 additions, beside the goldens and fixtures. */
  extra: string[];
}

export const DIALECTS: Dialect[] = (
  [
    [
      'fanuc-gcode',
      ['nc/fanuc', 'nc/owner-public/fanuc-gcode'],
      [
        'M797 SPINDLE ONE DONE',
        'M797 SPINDLE ONE X10. DONE',
        'N10 CHECK INSERT G1 X5.',
        'SPINDLE',
        'G1 X10. (SPINDLE ONE) F100.',
        'IF [#1 GT 5] GOTO 10',
      ],
    ],
    ['fanuc-lathe', ['nc/fanuc-lathe', 'nc/owner-public/fanuc-lathe'], ['M797 SPINDLE ONE DONE', 'G96 S180 M3', 'T0101']],
    [
      'heidenhain-klartext',
      ['nc/heidenhain', 'nc/owner-public/heidenhain-klartext'],
      [
        '12 CYCL DEF 207 TAP.-RIGID NEW ~',
        '19 CYCL DEF 200 DRILLING ;CENTRE HOLES',
        '9 CYCL DEF 9.1 DWELL 1.5',
        '12 CYCL DEF 12.1 PGM SUBPGM1',
        '0 BEGIN PGM 7-AXLE PART MM',
        '0 BEGIN PGM 2.5D_MILLING MM',
        '99 END PGM 7-AXLE PART MM',
        '1 CALL PGM TNC:\\PARTS\\SUB1.H',
        '4 FN 16: F-PRINT TNC:\\FORMS\\REPORT.A / TNC:\\LOGS\\RUN.TXT',
        '13 CYCL DEF 32.2 HSC-MODE:1 TA0.5',
        '14 FUNCTION TURNDATA SPIN VCONST:ON VC:120 SMAX3000',
        '15 FUNCTION TURNDATA SPIN VCONST:OFF VC:Q5 SMAX3000',
        '20 PLANE POINTS P1X+0 P1Y+0 P1Z+0 P2X+10 P2Y+0 P2Z+0 P3X+0 P3Y+10 P3Z+0',
        '21 FK FPOL X+10 FC DR- R+5 CCX+0 P1X+3',
        '63 L X241,781 Y-5,5 FMAX',
        '64 CYCL DEF 7.1 #5',
        '65 CYCL DEF 7.1 #Q5',
        '22 PLANE POINTS P1X P1XY+1 P2Z+32.5',
      ],
    ],
    [
      'okuma-osp',
      ['nc/okuma', 'nc/owner-public/okuma-osp'],
      [
        'CALL OABCD',
        'CALL OABCDEFGHIJKLMNO1 X10',
        'N100 CALL O1234 A1=2',
        'MODIN O12',
        'NOEX',
        'N10 NOEX',
        'NOEX /',
        '/NOEX',
        'NOT',
        'N100G0X5',
        'N10000 G0 X1',
        'NLAP1 /G0',
        'NLAP1',
        'GOTO NLAP1',
        'IF [V1 EQ 5] NLAP1',
        'CALRG',
        'DIA1=50',
      ],
    ],
    [
      'sinumerik',
      ['nc/sinumerik', 'nc/owner-public/sinumerik'],
      [
        'GOTOF SKIPSIM',
        'GOTOF:20',
        'GOTOF :20',
        'GOTOB LOOP_A',
        'GOTO "STEP_"<<N',
        'GOTOF N100',
        'GOTOB R10',
        'GOTO FOO(1)',
        'GOTO FOO=1',
        'IF R1>2 GOTOB LOOP_A ; BACK',
        'N10 DEF INT COUNTER',
        'DEF REAL WIDTH, DEPTH=2.5, AREA[3]',
        'DEF STRING[16] STEPNAME="AB"',
        'DEF INT A,B',
        '/1 DEF REAL B',
        'N10 LOOP_A: DEF INT A',
        'DEF REAL A=SIN(1,2), B',
        'DEF INT A ; B, C',
        'N20 R1=2',
        '   def int a, b',
        '/1 /3 DEF INT A',
        'DEF INT',
        'DEF',
      ],
    ],
    ['sinumerik-mill', ['nc/sinumerik-mill', 'nc/owner-public/sinumerik-mill'], ['GOTOF SKIPSIM', 'DEF INT A,B', 'TRAORI']],
  ] as [string, string[], string[]][]
).map(([id, fixtures, extra]) => {
  const raw = BUILTIN_PROFILE_JSON.find((entry) => (entry as { id?: string }).id === id);
  if (!raw) throw new Error(`no built-in profile ${id}`);
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`${id} does not validate: ${checked.errors.join('; ')}`);
  const profile = checked.profile;
  const db = unionCodeDb(variantDialects(profile).map((dialect) => RESOLVED[dialect] ?? emptyCodeDb(dialect)));
  return {
    id,
    profile,
    db,
    cp: compileProfile(profile),
    grammar: generateGrammar(profile, db) as unknown as MonarchLike,
    fixtures,
    extra,
  };
});

export function corpus(dialect: Dialect): { line: string; prev?: LineState }[] {
  const golden = JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/tokens/${dialect.id}.json`, import.meta.url)), 'utf8'),
  ) as { line: string; prev?: LineState }[];
  const lines: { line: string; prev?: LineState }[] = [];
  const seen = new Set<string>();
  const add = (line: string, prev: LineState | undefined, shape: boolean): void => {
    if (line.length > 400) return;
    // The lines of the fixtures are many (a CAM program repeats its blocks with other numbers):
    // one line per shape, the digits of a run counting as one.
    const key = `${prev?.continuation === true ? '~' : ''}${shape ? line.replace(/\d+/g, '0') : line}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push({ line, prev });
  };
  for (const entry of golden) add(entry.line, entry.prev, false);
  for (const line of dialect.extra) add(line, undefined, false);
  for (const dir of dialect.fixtures) {
    for (const rel of listFixtures(dir)) {
      const opened = openFixture(rel);
      if (opened.refused !== null) continue;
      let state: LineState | undefined;
      for (const line of opened.text.split('\n')) {
        add(line, state, true);
        state = tokenizeLine(line, dialect.cp, state).state;
      }
    }
  }
  return lines;
}
