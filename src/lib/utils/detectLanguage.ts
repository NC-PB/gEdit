import type { Dialect } from './dialects';

/** How many lines of a file are inspected when sniffing its content. */
const MAX_SNIFF_LINES = 400;

// Optional Heidenhain block number ("12 TOOL CALL ...").
const HH_BLOCK = String.raw`^\s*(?:\d+\s+)?`;

/** Unambiguous Heidenhain Klartext markers. */
const HEIDENHAIN_STRONG = [
  new RegExp(HH_BLOCK + String.raw`BEGIN\s+PGM\b`, 'i'),
  new RegExp(HH_BLOCK + String.raw`END\s+PGM\b`, 'i'),
  new RegExp(HH_BLOCK + String.raw`TOOL\s+CALL\b`, 'i'),
  new RegExp(HH_BLOCK + String.raw`CYCL\s+DEF\b`, 'i'),
];

/** Typical Klartext blocks: "5 L X+10 Y-5 R0 FMAX", "7 LBL 1", "9 CC X+0 Y+0", "3 FN 0: Q1 = +5". */
const HEIDENHAIN_WEAK = [
  /^\s*\d+\s+(?:L|LP|C|CP|CC|CR|CT|RND|CHF|APPR|DEP|LBL|CALL\s+LBL|FN\s*\d+)\b/i,
  /\bFMAX\b/i,
];

/** Unambiguous Fanuc-style markers. */
const FANUC_STRONG = [
  /^\s*%\s*$/, // tape start / end
  /^\s*[O:]\d{1,5}\b/i, // program number (O1234 or :1234)
];

/** Fanuc blocks usually start with an N number or a G/M word ("N10 G0 X0", "G90 G54", "M30"). */
const FANUC_WEAK = [
  /^\s*N\d+\b/i,
  /^\s*(?:N\d+\s*)?[GM]\d{1,3}(?:\.\d)?(?![\d.])/i,
  /^\s*\([^)]*\)\s*$/, // whole-line comment
];

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function sniff(content: string): Dialect | null {
  let heidenhain = 0;
  let fanuc = 0;
  let inspected = 0;

  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (++inspected > MAX_SNIFF_LINES) break;

    if (HEIDENHAIN_STRONG.some((re) => re.test(line))) heidenhain += 5;
    else if (HEIDENHAIN_WEAK.some((re) => re.test(line))) heidenhain += 1;

    if (FANUC_STRONG.some((re) => re.test(line))) fanuc += 5;
    else if (FANUC_WEAK.some((re) => re.test(line))) fanuc += 1;
  }

  if (heidenhain === fanuc) return null;
  return heidenhain > fanuc ? 'heidenhain-klartext' : 'fanuc-gcode';
}

/**
 * Picks the dialect for a file. The extension decides when it is specific
 * (.h -> Heidenhain, .nc/.min -> Fanuc); for anything else (.txt, unknown) the
 * content is sniffed. If that is inconclusive, `fallback` (usually the current
 * dialect) is returned.
 */
export function detectLanguage(path: string, content: string, fallback: Dialect): Dialect {
  switch (extensionOf(path)) {
    case 'h':
      return 'heidenhain-klartext';
    case 'nc':
    case 'min':
      return 'fanuc-gcode';
    default:
      return sniff(content) ?? fallback;
  }
}
