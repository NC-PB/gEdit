// B1 intB (glue item 19): does the program map's pump tax typing? While the first build of a large
// program runs in chained slices (outlineService.ts: next-turn messages, 8 ms slices, a timer turn
// every 24 ms of chained work), a keystroke must still be served at once. This runs the real
// service with real timers and the real `nextTurn` on a generated program, and types into it while
// it builds: the keystroke is a timer that fires every few milliseconds and feeds an edit into
// the service (what Monaco's content event does). What the user feels is
//   - how late a keystroke runs, and
//   - what its handler costs on the main thread.
// A keystroke comes from outside the loop in the browser (the input event); here it is a message
// from a worker thread. Node has no `isInputPending`, which is the WebKit case; node serves the
// message after the chained slices of the pump, the browser between two of them, so this is the
// worse case. Each
// measure is the best of a few builds (a stall of the machine is not the code's); a real tax is
// in every round. The scheduling itself is pinned with a fake clock in outlineService.test.ts;
// this is the real-time check. For scale: with the 8 ms slices that each waited for idle time
// (B2, before B1 fixperf) the keystroke was at most 9 ms late and the map ready after 970 ms;
// with the pump 20 to 25 ms late (node's worst case, see above), ready after 450 to 520 ms.

import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '$lib/stores/documents';
import { cpOf } from '../../../tests/unit/helpers/profiles';
import { expectWithin } from '../../../tests/unit/helpers/budget';
import { CHUNK_LINES, MAX_CHUNK_LINES, createOutlineService, nextTurn } from './outlineService';
import type { ContentChange, Disposable, DocId, Eol, FileEncoding, NewDocMeta } from '$lib/app/types';

const META: NewDocMeta = {
  path: null,
  untitledIndex: 1,
  profileId: 'fanuc-gcode',
  encoding: { encoding: 'utf-8', hasBom: false } satisfies FileEncoding,
  eol: 'lf' satisfies Eol,
  eolMixedOnLoad: false,
  nul: { leader: 0, trailer: 0, stripped: 0 },
  textDirty: false,
  metaDirty: false,
  disk: null,
  external: 'none',
  readOnly: false,
  readOnlyReason: null,
};

const LINES = 800_000;
const ROUNDS = 5;
/** One keystroke every this many ms (a fast typist is about 80 ms apart; this is ten times as dense). */
const KEY_EVERY_MS = 8;

function program(): string[] {
  const pool = ['G1 X10. Y5. F100.', 'T2 M6', 'S1200 M3', 'G81 X5. Z-3. R1.', 'G80', 'G2 X20. Y5. I5. J0.', '(NEXT)', 'M98 P1000', 'G0 X0. Y0.'];
  const out: string[] = ['%', 'O1000 (TEST)'];
  for (let i = 0; out.length < LINES; i++) out.push(i % 5000 === 0 ? `O${2000 + i / 5000}` : `N${i * 10} ${pool[i % pool.length]}`);
  return out;
}


async function typeWhileItBuilds(lines: string[]): Promise<{ late: number; handler: number; keys: number; readyMs: number }> {
  const cp = cpOf('fanuc-gcode');
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const id: DocId = docs.add({ ...META }, { activate: true });
  const own = lines.slice();
  let onContent: (id: DocId, change: ContentChange) => void = () => {};
  let version = 1;
  const outline = createOutlineService({
    docs,
    editor: {
      hasModel: () => true,
      getLineCount: () => own.length,
      getLines: (_id, from, to) => own.slice(Math.max(1, from) - 1, to),
      onDidChangeContent: (cb) => {
        onContent = cb;
        return () => {};
      },
      onDidCreateModel: () => () => {},
    },
    effective: () => ({ cp, key: 'fanuc-gcode' }),
    schedule: (fn, ms): Disposable => {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    },
    // The macOS webview has no requestIdleCallback: the idle scheduler is a timer 16 ms away.
    idle: (fn): Disposable => {
      const handle = setTimeout(fn, 16);
      return () => clearTimeout(handle);
    },
    nextTurn,
    inputPending: () => false,
    now: () => performance.now(),
    chunkLines: CHUNK_LINES,
    maxChunkLines: MAX_CHUNK_LINES,
    delayMs: 150,
  });
  const stop = outline.start();
  let late = 0;
  let handler = 0;
  let keys = 0;
  const stamp = (): number => performance.timeOrigin + performance.now();
  const keystroke = (sentAt: number): void => {
    late = Math.max(late, stamp() - sentAt);
    const line = 40 + (keys % 20);
    own[line - 1] = `N${line} G1 X${keys % 90}.5 Y2. F100.`;
    const started = performance.now();
    onContent(id, { startLine: line, endLineOld: line, endLineNew: line, flush: false, versionId: ++version });
    handler = Math.max(handler, performance.now() - started);
    keys++;
  };
  const worker = new Worker(
    `const { parentPort } = require('node:worker_threads');
     setInterval(() => parentPort.postMessage(performance.timeOrigin + performance.now()), ${KEY_EVERY_MS});`,
    { eval: true },
  );
  worker.on('message', (sentAt: number) => keystroke(sentAt));
  const started = performance.now();
  outline.items(id);
  await outline.whenReady(id);
  const readyMs = performance.now() - started;
  await worker.terminate();
  stop();
  return { late, handler, keys, readyMs };
}

describe('typing while the program map builds (B1 intB, item 19)', () => {
  const measure = async () => {
    const lines = program();
    await typeWhileItBuilds(lines.slice(0, 20_000)); // warm-up: regexes, JIT
    let late = Infinity;
    let handler = Infinity;
    let ready = Infinity;
    let keys = 0;
    for (let round = 0; round < ROUNDS; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const r = await typeWhileItBuilds(lines);
      late = Math.min(late, r.late);
      handler = Math.min(handler, r.handler);
      ready = Math.min(ready, r.readyMs);
      keys = Math.max(keys, r.keys);
    }
    return { late, handler, ready, keys };
  };

  it('a keystroke is served within two typing frames while the map builds, and its edit costs next to nothing', async () => {
    const { late, handler, ready, keys } = await measure();
    // The build is long enough to be typed through (the point of the test), and it finishes.
    expect(keys).toBeGreaterThan(10);
    // The pump serves the outside world at the latest after CHAIN_MS (24 ms) of chained slices
    // plus the slice that is running: about 35 ms. A pump that never gave the loop back, or a
    // slice that is not bounded, is far above.
    expectWithin(late, 60, `a keystroke ran late while the map built (${keys} keystrokes, ready after ${ready.toFixed(0)} ms)`);
    expectWithin(handler, 5, 'the edit handler of one keystroke while the map builds');
  }, 120_000);
});
