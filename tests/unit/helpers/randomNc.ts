// Test support: random NC lines that are hard on the head of a block (block numbers, skips,
// labels, sequence names, headers, continuation marks), and the profiles to read them with,
// the built-in ones and variants of them that switch the rarely used rules on. Seeded, so a
// failure can be repeated.

import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { cpOf } from './profiles';

/** A small deterministic generator (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEADS = [
  '', '', '', ' ', '\t', '  ', '/', '/ ', '/1 ', '/2', '/ /', '//', '/1 /3 ', '%', '$PART.MIN%', '$PART', '%_N_X_MPF', ';%_N_X_MPF', ';%', 'O1234', 'O12 (X)', '(C) ',
  ':', ':10 ', ':0020', 'LOOP_A: ', 'N10 LOOP_B: ', '/ N5 LOOP_C:', 'LOOP_D:=1', 'NEXT_PART:', 'N', 'N ', 'NLAP1 ', 'NFED1', 'NLAP12', 'NLAPS ', 'nlap2 ', 'NOEX ', 'NA ', 'N1A ', 'L12 ',
];
const NUMBERS = ['10', '0', '1', '7', '007', '0100', '100', '99999', '123456789', '1234567890', '2147483647', '4', '10', '20', '30', '120', '130'];
const WORDS = [
  'G1', 'G01', 'G0', 'X10.5', 'Y-3.25', 'Z0.', 'F1200.', 'S2500', 'M3', 'M30', 'M98 P1000', 'M99 P10', 'M98 Q20 P5', 'G71 P100 Q200 U0.4', 'G70 P100 Q200', 'G83 Z-10. R2. Q3000. F100.',
  'GOTO 70', 'GOTO N70', 'GOTO N0070', 'GOTOF LOOP_A', 'GOTOB N10', 'GOTOF N130', 'GOTOC LOOP_C', 'GOTOF R10', 'GOTO #100', 'GOTO [#1+1]', 'GOTO "N"<<R10', 'IF R1>1 GOTOF N10',
  'G85 NLAP1 D3', 'G86 NLAP12', 'G87 NLAP1', 'IF [#1 EQ 1] GOTO 60', 'IF A GOTO NEXT', 'GOTO NLAP2', 'GOTO N200', ' NLAP3 G81', 'XNLAP', 'GN', 'PN', 'N', 'N5', 'N 5', 'N5ABC', 'NL1', 'NOEX',
  '(NEXT N5)', '(P10 Q20)', '(unterminated N7', ';N20 note', '; P5 Q6', '"string N9"', '#101=5', 'R1=3', 'R2=R1+1', 'CYCLE81(1,2,3)', 'CYCLE83(110,0,1,-20,0,5,1)', 'MCALL CYCLE81(1)', 'DEF INT COUNTER',
  'P', 'Q', 'PQ', 'p100', 'q5', 'goto 50', 'Goto N60', 'g85 nlap2', 'ñandú', 'é', ' ', ' ', '$1=2', '%', '~', 'X=AC(10)', 'T0101', 'N100 N200', '/ N30', ':60', 'APPR LCT', 'LBL 4', 'CALL LBL 5',
];
const TAILS = ['', '', '', '', ' ~', '~', ' ~  ', ' ;c', ' (c', ' (N5)', '\\', ' \\', ' *', ' %'];

export function randomLine(next: () => number): string {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  let head = pick(HEADS);
  if (head.endsWith('N') || head === 'N ') head += pick(NUMBERS);
  else if (next() < 0.55 && !/[:%$;(]/.test(head) && !/^N[A-Z]/i.test(head) && head !== 'O1234' && !head.startsWith('O12')) {
    const prefix = next() < 0.1 ? pick(['n', 'N ', 'N\t', 'L']) : 'N';
    head += prefix + pick(NUMBERS) + pick(['', ' ', ' ', '  ', '\t']);
  }
  const count = Math.floor(next() * 4);
  const words: string[] = [];
  for (let i = 0; i < count; i++) words.push(pick(WORDS));
  const sep = pick([' ', ' ', '', '\t']);
  return head + words.join(sep) + pick(TAILS);
}

export function randomLines(seed: number, count: number): string[] {
  const next = random(seed);
  return Array.from({ length: count }, () => randomLine(next));
}

function variant(id: string, change: (profile: Record<string, any>) => void): CompiledProfile {
  const raw = structuredClone(BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === id)) as Record<string, any>;
  change(raw);
  const result = validateProfile(raw);
  if (!result.ok) throw new Error(`${id} variant: ${result.errors.join('; ')}`);
  return compileProfile(result.profile);
}

/** Every built-in profile plus variants that switch on what the built-in ones do not use together. */
export function profilesToRead(): [string, CompiledProfile][] {
  const out: [string, CompiledProfile][] = [];
  for (const raw of BUILTIN_PROFILE_JSON) {
    const id = (raw as { id?: string }).id as string;
    out.push([id, cpOf(id)]);
  }
  out.push(['fanuc + continuation ~', variant('fanuc-gcode', (p) => { p.syntax.continuation = '~\\s*$'; p.syntax.continuationMark = '~'; })]);
  out.push(['fanuc case-sensitive', variant('fanuc-gcode', (p) => { p.syntax.caseSensitive = true; })]);
  out.push(['fanuc alt prefix L', variant('fanuc-gcode', (p) => { p.syntax.blockNumber.altPrefixes = ['L']; })]);
  out.push(['fanuc skip after number', variant('fanuc-gcode', (p) => { p.syntax.blockSkip = { chars: '/', position: 'after-number', levels: true, plainLevel: '1' }; })]);
  out.push(['fanuc skip before number, no levels', variant('fanuc-gcode', (p) => { p.syntax.blockSkip = { chars: '/', position: 'before-number', levels: false }; })]);
  out.push(['okuma + jump labels', variant('okuma-osp', (p) => { p.syntax.labelAfter = ['GOTO']; })]);
  out.push(['okuma case-sensitive', variant('okuma-osp', (p) => { p.syntax.caseSensitive = true; })]);
  out.push(['okuma + continuation', variant('okuma-osp', (p) => { p.syntax.continuation = '~\\s*$'; p.syntax.continuationMark = '~'; })]);
  out.push(['sinumerik + continuation', variant('sinumerik', (p) => { p.syntax.continuation = '~\\s*$'; p.syntax.continuationMark = '~'; })]);
  out.push(['okuma without reference rules', variant('okuma-osp', (p) => { p.numbering.references = []; })]);
  out.push(['fanuc without reference rules', variant('fanuc-gcode', (p) => { p.numbering.references = []; })]);
  return out;
}
