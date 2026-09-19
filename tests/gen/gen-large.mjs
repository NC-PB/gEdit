// Builds large NC programs for performance tests from the fixture programs.
//
// Usage: node tests/gen/gen-large.mjs --lines N --dialect fanuc|heidenhain
//          [--mb M] [--eol crlf|lf] [--out .perf/<name>]
//
// The output keeps the header and footer of a fixture and repeats its tool segments.
// Each copy gets new tool numbers and a run of generated cutting moves (a raster over
// a gently curved surface, or hole positions for drilling segments), until the program
// has at least N lines and, with --mb, at least M MiB. The same arguments always give
// the same bytes. Output goes to .perf/ (gitignored) by default.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** @typedef {'fanuc' | 'heidenhain'} Dialect */
/** @typedef {{ lines: string[], anchor: number, kind: 'feed' | 'cycle' }} Segment */

// Most moves of a segment go into one run; longer programs get more segment copies.
const MAX_RUN = 2000;

/**
 * Per-dialect rules for splitting the source fixture and writing moves.
 * @type {Record<Dialect, {
 *   source: string, ext: string,
 *   toolChange: RegExp, lead: RegExp, end: RegExp, feed: RegExp, cycle: RegExp,
 * }>}
 */
const DIALECTS = {
  fanuc: {
    source: '../fixtures/nc/fanuc/f01-mill-3tools.nc',
    ext: 'nc',
    toolChange: /(?<![A-Z])(?:T\d+\s*M0*6|M0*6\s*T\d+)(?!\d)/i,
    lead: /^\s*\(.*\)\s*$/, // operation comments right above a tool change belong to it
    end: /^\s*(?:N\d+\s*)?M0*(?:30|2)(?!\d)/i,
    feed: /^\s*(?:N\d+\s*)?(?:G\d+\s+)*G0*1(?!\d)/i,
    cycle: /(?<![A-Z])G8[1-9](?!\d)/i,
  },
  heidenhain: {
    source: '../fixtures/nc/heidenhain/h01-3tools.h',
    ext: 'h',
    toolChange: /^\s*\d+\s+TOOL\s+CALL\s+(?:\d|"|QS\d)/i,
    lead: /^\s*\d+\s+[*;]/, // section headings and comment blocks
    end: /^\s*\d+\s+M0*(?:30|2)\b/i,
    feed: /^\s*\d+\s+L\s.*\bF\d/i,
    cycle: /\bM99\b/i,
  },
};

/** @param {string} path */
function readLines(path) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
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
 * with Z on a smooth surface, or a hole grid for drilling segments.
 */
function createMoves() {
  let x = 0;
  let y = 0;
  let dir = 1;
  let step = 0;
  let hole = 0;
  return {
    /** @param {Dialect} dialect @returns {Move} */
    feed(dialect) {
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
  const { header, segments, footer } = splitProgram(readLines(rules.source), rules);
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
  'usage: node tests/gen/gen-large.mjs --lines N --dialect fanuc|heidenhain [--mb M] [--eol crlf|lf] [--out FILE]';

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
  if (!Object.hasOwn(DIALECTS, dialect ?? '')) fail('--dialect must be fanuc or heidenhain');
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
