// Builds large NC programs for performance tests from the fixture programs.
//
// Usage: node tests/gen/gen-large.mjs --lines N --dialect fanuc|heidenhain|okuma|sinumerik
//          [--mb M] [--eol crlf|lf] [--out .perf/<name>]
//
// The output keeps the header and footer of a source program and repeats its tool
// segments. Each copy gets new tool numbers and a run of generated cutting moves (a
// raster over a gently curved surface for a mill, a facing pass over a shaft for a lathe,
// or hole positions for drilling segments), until the program has at least N lines and,
// with --mb, at least M MiB. The same arguments always give the same bytes. Output goes
// to .perf/ (gitignored) by default.
//
// M8 (P8): the source of the two turning dialects is written out below rather than read
// from `tests/fixtures/nc/`, because the prelude registers the profiles before the
// content work packages write their fixtures. Both seeds carry the `WRITTEN FOR GEDIT`
// marker of every other program here. When WP8.3 and WP8.5 have their fixtures in, the
// `program` member of a dialect can be swapped for a `source` path like the two older
// dialects use, and nothing else changes.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** @typedef {'fanuc' | 'heidenhain' | 'okuma' | 'sinumerik'} Dialect */
/** @typedef {{ lines: string[], anchor: number, kind: 'feed' | 'cycle' }} Segment */

// Most moves of a segment go into one run; longer programs get more segment copies.
const MAX_RUN = 2000;

/** A turning program for the Okuma seed, written for gEdit (P8). */
const OKUMA_PROGRAM = [
  '(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)',
  'O0001',
  '(SHAFT - SYNTHETIC TURNING SOURCE)',
  '(T01 OD ROUGH)',
  '(T02 OD FINISH)',
  '(T03 GROOVE)',
  'G50 S2200',
  'G00 X400 Z300',
  '(OD ROUGH)',
  'T0101',
  'G96 S180 M03 M42',
  'G00 X62 Z3 M08',
  'G95 G01 Z0 F0.3',
  'G01 X-1.6',
  'G00 Z3.',
  'G00 X400 Z300 M09',
  '(OD FINISH)',
  'T0202',
  'G96 S240 M03',
  'G00 X56 Z3 M08',
  'G01 Z-40. F0.15',
  'G00 X400 Z300 M09',
  '(GROOVE)',
  'T0303',
  'G97 S900 M03',
  'G00 X58 Z-30. M08',
  'G01 X52. F0.08',
  'G00 X58.',
  'G00 X400 Z300 M09',
  'M05',
  'M02',
  '%',
];

/** A turning program for the Sinumerik seed, written for gEdit (P8). */
const SINUMERIK_PROGRAM = [
  '; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE',
  '; SHAFT - SYNTHETIC TURNING SOURCE',
  '; T1 OD ROUGH',
  '; T2 OD FINISH',
  '; T3 GROOVE',
  'G18 G90 G95 G40 DIAMON',
  'G500',
  'G0 X200 Z200',
  '; OD ROUGH',
  'T1 D1',
  'G96 S220 LIMS=2500 M4',
  'G0 X62 Z3 M8',
  'G1 Z0 F0.3',
  'G1 X-1.6',
  'G0 Z3',
  'G0 X200 Z200 M9',
  '; OD FINISH',
  'T2 D1',
  'G96 S240 M4',
  'G0 X56 Z3 M8',
  'G1 Z-40 F0.15',
  'G0 X200 Z200 M9',
  '; GROOVE',
  'T3 D1',
  'G97 S900 M4',
  'G0 X58 Z-30 M8',
  'G1 X52 F0.08',
  'G0 X58',
  'G0 X200 Z200 M9',
  'M5',
  'M30',
];

/**
 * Per-dialect rules for splitting the source program and writing moves.
 *
 * `source` names a fixture to read; `program` carries the source in this file instead.
 * `shape` picks the moves a copy is filled with: a mill raster or a turning pass.
 * @type {Record<Dialect, {
 *   source?: string, program?: string[], ext: string, shape: 'mill' | 'turn',
 *   toolChange: RegExp, lead: RegExp, end: RegExp, feed: RegExp, cycle: RegExp,
 * }>}
 */
const DIALECTS = {
  fanuc: {
    source: '../fixtures/nc/fanuc/f01-mill-3tools.nc',
    ext: 'nc',
    shape: 'mill',
    toolChange: /(?<![A-Z])(?:T\d+\s*M0*6|M0*6\s*T\d+)(?!\d)/i,
    lead: /^\s*\(.*\)\s*$/, // operation comments right above a tool change belong to it
    end: /^\s*(?:N\d+\s*)?M0*(?:30|2)(?!\d)/i,
    feed: /^\s*(?:N\d+\s*)?(?:G\d+\s+)*G0*1(?!\d)/i,
    cycle: /(?<![A-Z])G8[1-9](?!\d)/i,
  },
  heidenhain: {
    source: '../fixtures/nc/heidenhain/h01-3tools.h',
    ext: 'h',
    shape: 'mill',
    toolChange: /^\s*\d+\s+TOOL\s+CALL\s+(?:\d|"|QS\d)/i,
    lead: /^\s*\d+\s+[*;]/, // section headings and comment blocks
    end: /^\s*\d+\s+M0*(?:30|2)\b/i,
    feed: /^\s*\d+\s+L\s.*\bF\d/i,
    cycle: /\bM99\b/i,
  },
  // A turret lathe indexes on the T word alone: there is no M6 to look for, and a T with
  // a station of 00 cancels an offset instead of changing the tool.
  okuma: {
    program: OKUMA_PROGRAM,
    ext: 'min',
    shape: 'turn',
    toolChange: /(?<![A-Z])T(?!(?:\d{2})?00\d{2}(?!\d))\d{4}(?:\d{2})?(?!\d)/i,
    lead: /^\s*\(.*\)\s*$/, // operation comments right above a tool change belong to it
    end: /^\s*(?:N\w+\s+)?M0*(?:30|2)(?!\d)/i,
    feed: /^\s*(?:N\w+\s+)?(?:G\d+\s+)*G0*1(?![\d.])/i,
    cycle: /(?<![A-Z])G(?:7[1-8]|18[1-9])(?![\d.])/i,
  },
  sinumerik: {
    program: SINUMERIK_PROGRAM,
    ext: 'mpf',
    shape: 'turn',
    // `[^;]*?` keeps the tool list of the header, which names its tools in comments,
    // out of the split: a T behind a semicolon is text, not a turret index.
    toolChange: /^[^;]*?(?<![A-Z_$])T(?:\s*=\s*"[^"]*"|(?!0+(?![\d.]))\d+(?![\d.]))/i,
    lead: /^\s*;/, // comment lines right above a tool change belong to it
    end: /^\s*(?:N\d+\s+)?M0*(?:30|2)(?![\d.])/i,
    feed: /^\s*(?:N\d+\s+)?(?:G\d+\s+)*G0*1(?![\d.])/i,
    cycle: /(?<![A-Z_])CYCLE\d+\s*\(/i,
  },
};

/**
 * The source program of one dialect: the fixture it names, or the seed in this file.
 * @param {(typeof DIALECTS)[Dialect]} rules
 */
function sourceLines(rules) {
  if (rules.program) return [...rules.program];
  const text = readFileSync(new URL(/** @type {string} */ (rules.source), import.meta.url), 'utf8');
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Splits a fixture into header, tool segments and footer. A segment runs from its
 * tool change (plus the comment lines right above it) to the next one; the footer
 * starts at the program end (M30/M2).
 * @param {string[]} lines
 * @param {(typeof DIALECTS)[Dialect]} rules
 */
function splitProgram(lines, rules) {
  const end = lines.findIndex((line) => rules.end.test(line));
  if (end < 0) throw new Error('source fixture has no program end');
  /** @type {number[]} */
  const starts = [];
  for (let i = 0; i < end; i++) {
    if (!rules.toolChange.test(lines[i])) continue;
    let start = i;
    while (start > 0 && rules.lead.test(lines[start - 1])) start--;
    starts.push(start);
  }
  if (starts.length === 0) throw new Error('source fixture has no tool change');

  /** @type {Segment[]} */
  const segments = starts.map((start, i) => {
    const segLines = lines.slice(start, starts[i + 1] ?? end);
    // Moves go after the first cutting line: a feed move or a canned cycle.
    const anchor = segLines.findIndex((line) => rules.feed.test(line) || rules.cycle.test(line));
    if (anchor < 0) throw new Error(`segment at line ${start + 1} has no cutting move`);
    const kind = rules.feed.test(segLines[anchor]) ? 'feed' : 'cycle';
    return { lines: segLines, anchor, kind };
  });
  return { header: lines.slice(0, starts[0]), segments, footer: lines.slice(end) };
}

/**
 * Fixed-point value with 4 decimals, without a negative zero.
 * @param {number} value
 * @param {boolean} signed  Klartext writes an explicit + sign
 */
function coord(value, signed) {
  const text = (Math.abs(value) < 0.00005 ? 0 : value).toFixed(4);
  return signed && !text.startsWith('-') ? '+' + text : text;
}

/**
 * A move as words; the last `optional` words (feed, rotary axes, repeated cycle
 * values) may be left out. They are added only to reach a size target.
 * @typedef {{ words: string[], optional: number }} Move
 */

/**
 * Endless cutting moves: a zigzag raster in 0.5 mm steps over a 100 x 80 mm field
 * with Z on a smooth surface, or a hole grid for drilling segments. A turning dialect
 * gets passes along a shaft instead — a diameter and a length, with a feed per
 * revolution, which is what a lathe post writes.
 */
function createMoves() {
  let x = 0;
  let y = 0;
  let dir = 1;
  let step = 0;
  let hole = 0;
  let dia = 60;
  let along = 0;
  return {
    /** @param {Dialect} dialect @returns {Move} */
    feed(dialect) {
      if (DIALECTS[dialect].shape === 'turn') {
        along -= 0.5;
        if (along < -120) {
          along = 0;
          dia = dia <= 12 ? 60 : dia - 0.5;
        }
        const feedPerRev = (0.08 + (step++ % 7) * 0.02).toFixed(3);
        return { words: [`X${coord(dia, false)}`, `Z${coord(along, false)}`, `F${feedPerRev}`], optional: 1 };
      }
      x += 0.5 * dir;
      if (x > 100 || x < 0) {
        dir = -dir;
        x += 0.5 * dir;
        y = y >= 80 ? 0 : y + 1;
      }
      const z = -2 + Math.sin(x / 7) * Math.cos(y / 5);
      const feed = 800 + (step++ % 7) * 100;
      const tilt = 10 * Math.sin(x / 13);
      const turn = 90 + 45 * Math.cos(y / 11);
      if (dialect === 'fanuc') {
        const words = [`X${coord(x, false)}`, `Y${coord(y, false)}`, `Z${coord(z, false)}`];
        return { words: [...words, `F${feed}.`, `A${coord(tilt, false)}`, `B${coord(turn, false)}`], optional: 3 };
      }
      const words = ['L', `X${coord(x, true)}`, `Y${coord(y, true)}`, `Z${coord(z, true)}`];
      return { words: [...words, `B${coord(tilt, true)}`, `C${coord(turn, true)}`, `F${feed}`], optional: 3 };
    },
    /** @param {Dialect} dialect @returns {Move} */
    cycle(dialect) {
      const hx = 5 + (hole % 19) * 5;
      const hy = 5 + (Math.floor(hole / 19) % 15) * 5;
      hole++;
      if (DIALECTS[dialect].shape === 'turn') {
        // A driven-tool cycle repeats at C angles, not at X and Y positions.
        return { words: [`C${coord((hole * 15) % 360, false)}`, `Z${coord(-2 - (hole % 5), false)}`], optional: 0 };
      }
      if (dialect === 'fanuc') {
        return { words: [`X${coord(hx, false)}`, `Y${coord(hy, false)}`, 'Z-18.', 'R3.', 'F240.'], optional: 3 };
      }
      return { words: ['L', `X${coord(hx, true)}`, `Y${coord(hy, true)}`, 'R0', 'FMAX', 'M99'], optional: 0 };
    },
  };
}

/**
 * Gives the tools of the n-th copy of the segments new numbers (1..99), so tool
 * changes differ along the program. Comments are left alone.
 * @param {string} line
 * @param {Dialect} dialect
 * @param {number} shift
 */
function renumberTools(line, dialect, shift) {
  /** @param {string} n */
  const next = (n) => String(((Number(n) - 1 + shift) % 99) + 1);
  if (dialect === 'heidenhain') {
    return line.replace(/(TOOL\s+CALL\s+)(\d+)/i, (_, call, n) => call + next(n));
  }
  if (dialect === 'sinumerik') {
    const comment = line.indexOf(';');
    const code = comment < 0 ? line : line.slice(0, comment);
    const rest = comment < 0 ? '' : line.slice(comment);
    return code.replace(/(?<![A-Z_$])T(\d+)(?![\d.])/gi, (_, n) => 'T' + next(n)) + rest;
  }
  if (dialect === 'okuma') {
    const comment = line.indexOf('(');
    const code = comment < 0 ? line : line.slice(0, comment);
    const rest = comment < 0 ? '' : line.slice(comment);
    // Every two-digit group of the T word moves together, so the station and its offset
    // stay the pair a turret program writes.
    return (
      code.replace(/(?<![A-Z])T(\d{4}|\d{6})(?!\d)/gi, (_, digits) => {
        const pairs = /** @type {string[]} */ (digits.match(/\d{2}/g) ?? []);
        return 'T' + pairs.map((pair) => next(pair).padStart(2, '0')).join('');
      }) + rest
    );
  }
  const comment = line.indexOf('(');
  const code = comment < 0 ? line : line.slice(0, comment);
  const rest = comment < 0 ? '' : line.slice(comment);
  return code.replace(/(?<![A-Z])([TH])(\d+)/gi, (_, letter, n) => letter + next(n)) + rest;
}

/**
 * Builds the program text.
 * @param {{ lines: number, dialect: Dialect, mb?: number, eol?: 'crlf' | 'lf', name?: string }} options
 * @returns {string}
 */
export function generateLarge({ lines: minLines, dialect, mb = 0, eol = 'crlf', name = 'LARGE' }) {
  if (!Object.hasOwn(DIALECTS, dialect)) throw new Error(`unknown dialect: ${dialect}`);
  const rules = DIALECTS[dialect];
  const { header, segments, footer } = splitProgram(sourceLines(rules), rules);
  const eolText = eol === 'lf' ? '\n' : '\r\n';
  const minBytes = mb * 1024 * 1024;
  const moves = createMoves();

  // Klartext blocks are renumbered from 0 and the program gets `name`; continuation
  // lines (no number) stay as they are. Fanuc lines are copied unchanged.
  /** @param {string} line @param {() => number} nextNumber */
  const render = (line, nextNumber) => {
    const match = dialect === 'heidenhain' ? /^\s*\d+\s+(.*)$/.exec(line) : null;
    if (!match) return line;
    return `${nextNumber()} ${match[1].replace(/\b(BEGIN|END)(\s+PGM\s+)\S+/i, `$1$2${name}`)}`;
  };
  // Lower bound of the rendered size (block numbers only grow), so --mb is always met.
  /** @param {string[]} list */
  const size = (list) => list.reduce((n, line) => n + render(line, () => 0).length + eolText.length, 0);

  /** @type {string[]} */
  const out = [];
  let bytes = 0;
  let block = 0;
  const nextBlock = () => block++;
  /** @param {string} line */
  const push = (line) => {
    out.push(line);
    bytes += line.length + eolText.length;
  };
  /** @param {string} line */
  const emit = (line) => push(render(line, nextBlock));
  /** @param {string} move */
  const emitMove = (move) => push(dialect === 'heidenhain' ? `${nextBlock()} ${move}` : move);
  /** @param {number} moreLines @param {number} moreBytes */
  const enough = (moreLines, moreBytes) => out.length + moreLines >= minLines && bytes + moreBytes >= minBytes;

  header.forEach(emit);
  const footerBytes = size(footer);
  for (let copy = 0, done = false; !done; copy++) {
    for (const segment of segments) {
      const lines = segment.lines.map((line) => renumberTools(line, dialect, copy * segments.length));
      const tail = lines.slice(segment.anchor + 1);
      const restLines = tail.length + footer.length;
      const restBytes = size(tail) + footerBytes;
      lines.slice(0, segment.anchor + 1).forEach(emit);
      for (let run = 0; run < MAX_RUN && !enough(restLines, restBytes); run++) {
        const { words, optional } = moves[segment.kind](dialect);
        // With --mb, lines get their optional words while they are too short to reach
        // the size within the line count; once the line count is reached, all of them.
        const linesLeft = minLines - out.length - restLines;
        const perLine = linesLeft > 0 ? (minBytes - bytes - restBytes) / linesLeft : Infinity;
        const numberBytes = dialect === 'heidenhain' ? String(block).length + 1 : 0;
        let used = words.length - optional;
        while (used < words.length && words.slice(0, used).join(' ').length + numberBytes + eolText.length < perLine) {
          used++;
        }
        emitMove(words.slice(0, used).join(' '));
      }
      tail.forEach(emit);
      if (enough(footer.length, footerBytes)) {
        done = true;
        break;
      }
    }
  }
  footer.forEach(emit);
  return out.join(eolText) + eolText;
}

const USAGE =
  'usage: node tests/gen/gen-large.mjs --lines N --dialect fanuc|heidenhain|okuma|sinumerik' +
  ' [--mb M] [--eol crlf|lf] [--out FILE]';

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

function main() {
  const { values } = parseArgs({
    options: {
      lines: { type: 'string' },
      dialect: { type: 'string' },
      mb: { type: 'string' },
      eol: { type: 'string', default: 'crlf' },
      out: { type: 'string' },
    },
  });
  const lines = Number(values.lines);
  if (!Number.isInteger(lines) || lines <= 0) fail('--lines must be a positive integer');
  const dialect = /** @type {Dialect} */ (values.dialect);
  if (!Object.hasOwn(DIALECTS, dialect ?? '')) fail(`--dialect must be one of ${Object.keys(DIALECTS).join(', ')}`);
  const mb = values.mb === undefined ? 0 : Number(values.mb);
  if (!(mb >= 0)) fail('--mb must be a number of MiB');
  const eol = values.eol === 'lf' ? 'lf' : values.eol === 'crlf' ? 'crlf' : fail('--eol must be crlf or lf');

  const out = resolve(values.out ?? `.perf/${dialect}-${lines}.${DIALECTS[dialect].ext}`);
  const name = basename(out).replace(/\.[^.]*$/, '').toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'LARGE';
  const text = generateLarge({ lines, dialect, mb, eol, name });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  const lineCount = text.split(eol === 'lf' ? '\n' : '\r\n').length - 1;
  console.log(`wrote ${out}: ${lineCount} lines, ${(text.length / 1024 / 1024).toFixed(2)} MiB`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
