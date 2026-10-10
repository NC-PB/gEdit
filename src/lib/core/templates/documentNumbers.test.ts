// The fast reading of a program's block numbers (`documentNumbers`, P3b fix H, plan §7 #287,
// known gap 23) gives what the tokenizer gives: `documentNumbersByTokens` is the definition.
// Random lines hard on the head of a block, every built-in profile and variants of them, and the
// committed fixture programs; then the cost, in time and in tokenizer calls (`documentNumbers.calls.test.ts`).

import { describe, expect, it } from 'vitest';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { profilesToRead, random, randomLine, randomLines } from '../../../../tests/unit/helpers/randomNc';
import { documentNumbers, documentNumbersByTokens } from './blockNumbers';

function same(lines: string[], cp: Parameters<typeof documentNumbers>[1], what: string): void {
  const fast = documentNumbers(lines, cp);
  const slow = documentNumbersByTokens(lines, cp);
  // Maps in insertion order: the first line of each number and the word a reference was written as.
  expect([...fast.blocks], what).toEqual([...slow.blocks]);
  expect([...fast.referenced], what).toEqual([...slow.referenced]);
  expect(fast.max, what).toBe(slow.max);
  // Without the block numbers: the referenced numbers are the same, and the block numbers are not read.
  const refs = documentNumbers(lines, cp, false);
  expect([...refs.referenced], what).toEqual([...slow.referenced]);
  if (refs.withBlocks) expect([...refs.blocks], what).toEqual([...slow.blocks]);
  else {
    expect(refs.blocks.size, what).toBe(0);
    expect(refs.max, what).toBeNull();
  }
}

describe('documentNumbers equals the tokenizer reading', () => {
  for (const [name, cp] of profilesToRead()) {
    it(`${name}: random programs and every random line alone`, () => {
      const next = random(2026);
      let blocks = 0;
      let referenced = 0;
      for (let p = 0; p < 150; p++) {
        const lines = Array.from({ length: 1 + Math.floor(next() * 60) }, () => randomLine(next));
        same(lines, cp, `${name} program ${p}: ${JSON.stringify(lines)}`);
        const found = documentNumbersByTokens(lines, cp);
        blocks += found.blocks.size;
        referenced += found.referenced.size;
      }
      for (const line of randomLines(5, 1500)) same([line], cp, `${name}: ${JSON.stringify(line)}`);
      // The generator reaches what the scan is about (a profile without block numbers finds none).
      if (cp.profile.numbering?.mode !== 'consecutive') expect(blocks).toBeGreaterThan(100);
      if (cp.re.references.length > 0 && cp.profile.numbering?.mode !== 'consecutive') expect(referenced).toBeGreaterThan(5);
    });
  }

  it('the fixture programs, each read with every built-in profile', () => {
    const profiles = profilesToRead().slice(0, 6);
    let read = 0;
    for (const rel of listFixtures('nc')) {
      if (rel.startsWith('nc/owner-public/') || rel.includes('/encoding/')) continue;
      const opened = openFixture(rel.replace(/^nc\//, 'nc/'));
      if (opened.refused !== null) continue;
      const lines = opened.text.split('\n');
      for (const [name, cp] of profiles) same(lines, cp, `${rel} as ${name}`);
      read++;
    }
    expect(read).toBeGreaterThan(20);
  });

  it('the committed owner-public programs, each read with its own profile', () => {
    let lines = 0;
    for (const rel of listFixtures('nc/owner-public')) {
      const folder = rel.split('/')[2];
      if (folder === 'heidenhain-klartext') continue; // consecutive numbering: nothing is scanned
      const opened = openFixture(rel);
      if (opened.refused !== null) continue;
      const all = opened.text.split('\n');
      same(all, cpOf(folder), rel);
      lines += all.length;
    }
    expect(lines).toBeGreaterThan(100_000);
  });
});

describe('what it answers (hand-written program)', () => {
  const fanuc = cpOf('fanuc-lathe');
  it('block numbers by value with the first line, the highest one, and what P and Q name', () => {
    const lines = ['%', 'O1000', 'N10 G50 S2000', 'N0020 G0 X50.', '/N30 G71 P100 Q200 U0.4', 'N100 G0 X16.', 'N200 G1 Z-10.', 'N020 M30', 'GOTO 70'];
    const doc = documentNumbers(lines, fanuc);
    expect([...doc.blocks].map(([k, v]) => `${k}@${v.line}`)).toEqual(['10@3', '20@4', '30@5', '100@6', '200@7']);
    expect(doc.max).toBe(200);
    expect(doc.referenced.get('100')).toEqual({ line: 5, word: 'P100' });
    expect(doc.referenced.get('200')).toEqual({ line: 5, word: 'Q200' });
  });

  it('an Okuma sequence name and the G85 that names it, as text', () => {
    const lines = ['$O1.MIN%', 'N0010 G50 S2500', 'NLAP1 G81', 'G0 X16', 'G80', 'N20 G85 NLAP1 D3 F0.3', '(NEXT NOTE)'];
    const doc = documentNumbers(lines, cpOf('okuma-osp'));
    expect([...doc.blocks].map(([k, v]) => `${k}@${v.line}`)).toEqual(['N0010@2', 'NLAP1@3', 'N20@6']);
    expect(doc.max).toBe(20);
  });

  it('a consecutive profile (Klartext) has no numbers to avoid', () => {
    const doc = documentNumbers(['0 BEGIN PGM T1 MM', '1 L X+0', '2 END PGM T1 MM'], cpOf('heidenhain-klartext'));
    expect(doc.blocks.size).toBe(0);
    expect(doc.max).toBeNull();
  });
});

describe('the cost at 300,000 lines', () => {
  const sizes = 300_000;
  // Each measurement holds the worker for seconds on a slow runner; a macrotask between them lets
  // the worker answer the runner's messages (a worker that never yields fails the whole run with
  // "Timeout calling onTaskUpdate", every test passed).
  const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const program = (cp: string): string[] => {
    const lines: string[] = ['%', 'O1000 (SHOP)'];
    for (let i = 0; lines.length < sizes; i++) {
      lines.push(`N${(i + 1) * 10} G1 X${(i % 100) + 0.123} Y${i % 50}.5 F1200.`);
      // Some of the lines a real program has that the fast reading hands to the tokenizer.
      if (i % 40 === 0) lines.push(cp === 'okuma-osp' ? 'G85 NLAP1 D3 F0.3' : 'M98 P1000 (SUB)');
      if (i % 25 === 0) lines.push('(OPERATION 2: FINISH)');
    }
    return lines;
  };

  for (const id of ['fanuc-gcode', 'okuma-osp', 'sinumerik']) {
    // That the fast reading leaves most lines out of the tokenizer is pinned by count in
    // documentNumbers.calls.test.ts; here only the time, against the frame budget. A ratio to the
    // tokenizer (3x) is noise on a shared runner: 2.98x failed a CI run while the count held.
    it(`${id}: well inside a frame budget`, async () => {
      const cp = cpOf(id);
      const lines = program(id);
      documentNumbers(lines, cp);
      let fast = Infinity;
      for (let round = 0; round < 3; round++) {
        await breathe();
        const started = performance.now();
        documentNumbers(lines, cp);
        fast = Math.min(fast, performance.now() - started);
      }
      expectWithin(fast, 300, `documentNumbers on ${lines.length} ${id} lines`);
      await breathe();
      same(lines, cp, `${id} 300k`);
    });
  }

  // FZ-02: a letter the gate looks for (a P, a GOTO, an N) in a comment on every line must not send every line to the tokenizer.
  const commented: Record<string, string> = {
    'fanuc-gcode': 'N10 G1 X1.5 Z-2. F0.2 (SPINDLE STOP)',
    'okuma-osp': 'N10 G1 X1.5 Z-2. (CONTOUR)',
    sinumerik: 'N10 G1 X1.5 Z-2. ; contour',
  };
  for (const [id, line] of Object.entries(commented)) {
    it(`${id}: a gate letter in a comment on every line costs no tokenizer pass`, async () => {
      const cp = cpOf(id);
      const lines = Array.from({ length: sizes }, (_, i) => `${line.replace('N10', `N${(i + 1) * 10}`)}`);
      // Alternating runs, the best of each: a load that comes and goes (a full test run) hits both sides.
      documentNumbers(lines.slice(0, 2000), cp);
      let fast = Infinity;
      let slow = Infinity;
      for (let round = 0; round < 3; round++) {
        await breathe();
        fast = Math.min(fast, fastest(1, () => void documentNumbers(lines, cp)));
        await breathe();
        slow = Math.min(slow, fastest(1, () => void documentNumbersByTokens(lines, cp)));
      }
      // That no line goes to the tokenizer is pinned by count in documentNumbers.calls.test.ts; here the
      // time, against the frame budget. A ratio to the tokenizer (2x) is noise on a shared runner: 1.9x
      // there failed the release run of v1.0.0 while the call count stayed 0.
      expectWithin(fast, 300, `documentNumbers on ${lines.length} commented ${id} lines (tokenizer ${slow.toFixed(0)} ms)`);
      same(lines.slice(0, 5000), cp, `${id} commented`);
    });
  }
});
