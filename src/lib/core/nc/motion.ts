// Motion colours: a mark beside every line that moves, coloured by how it moves (Phase 3
// plan §6.6, AD-34; P3.7). The contract is the prelude's (P3a); P3.7 wrote the rules. Pure
// and Monaco-free: `monaco/motionColors.ts` turns the answers into decorations.
//
// Which kind a line gets (binding; read from the code database, the profile and the modal
// state, never from a dialect name):
//
//   1. Only a line whose block **moves** gets a mark: it writes an axis word with a value
//      (`addresses.axes`, an incremental address of `addresses.incremental`, a Klartext
//      `I`-prefixed axis) that no code of the block makes data (`axisWords: 'data'`: `G10`,
//      a coordinate setting, `CYCL DEF 7.1 X+5`); or it carries a non-modal entry of group
//      `motion` (a Klartext path function such as `LP PR+10 PA+30`); or a cycle runs in it
//      (`after.block.cycle`). Everything else — comments, `M8`, `T0101`, a `G0` alone — gets
//      none.
//   2. `cycle` when a cycle runs in the block: `after.block.cycle`, or the block moves while
//      `after.activeCycle` holds a cycle without a pitch feed (`X10. Y10.` under `G81`, a
//      positioning block under `M89` or after `MCALL CYCLE81(…)`). The line that writes
//      `MCALL CYCLE81(…)` runs nothing (the interpreter's rule 11b) and gets no mark.
//   3. `thread` when the block's feed is a lead: `after.block.pitchFeed`, a called cycle
//      whose definition has a pitch feed, or an active cycle with a pitch feed (`G32`,
//      `G76` of a lathe, a tapping cycle and the blocks that position under it); and when
//      the cycle that runs or is in force is a tapping cycle (`tapping`, Sinumerik
//      `CYCLE84`, whose lead is one of its own arguments and so has no pitch feed). **Asked
//      before rule 2**: the interpreter makes a threading pass the block's cycle too
//      (`after.block.cycle` is `G32`), so a lead has to win over "a cycle runs here".
//      A tail line of a multi-line block (no move of its own)
//      gets no mark, whatever flags the block above left in the state.
//   4. Otherwise the motion code of the block itself (a non-modal one first: `G28`, `G30`
//      and `G53` move at rapid whatever the motion in force, and `G01 G28 X0.` is a rapid),
//      else the motion group in force after the block (`after.groups.motion`, only when it
//      is **not** assumed): `rapid` for `sets.motion: 'rapid'` or a block that carries the
//      profile's rapid marker (`addresses.rapid`, Klartext `FMAX`, also written apart as the
//      feed address with no value and the rest of the marker, `F MAX`); `arc` for
//      `sets.path: 'arc'`; `cycle` for `sets.path: 'cycle'` (a lathe single-pass turning
//      cycle, `G90`, whose every block is a whole pass); `linear` for any other
//      `sets.motion: 'feed'`.
//   5. Nothing known (no motion code yet, an assumed one, a code without `sets.motion`):
//      no mark. A guess is never painted as if the program had said it.
//
// The colours are theme roles of their own (`MOTION_COLORS`, one set per theme), applied as
// CSS custom properties `--gedit-motion-<kind>`; the decoration carries the class
// `MOTION_CLASS_PREFIX + kind` on the line-decorations margin (a bar between the line
// numbers and the text), so the syntax colours of the words stay as they are.

import { axisWordsOf, isAssignmentWord, lookupCode, normalizeCode } from '$lib/core/codes/lookup';
import type { CodeDb, CodeEntry } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { ModalState, NcToken } from './types';

/** How a line moves. */
export type MotionKind = 'rapid' | 'linear' | 'arc' | 'thread' | 'cycle';

/** Every kind, in the order the legend lists them. */
export const MOTION_KINDS: readonly MotionKind[] = ['rapid', 'linear', 'arc', 'thread', 'cycle'];

/** The CSS class of a kind's mark: `gedit-motion-rapid`, … (Phase 3 plan §6.8: the harness reads it). */
export const MOTION_CLASS_PREFIX = 'gedit-motion-';

/**
 * The colour of each kind, per theme. Every value is distinct within its theme and clears
 * 3:1 against the editor background (`EDITOR_COLORS`), the WCAG contrast for a mark that is
 * no text; `core/nc/motion.test.ts` is the gate.
 */
export const MOTION_COLORS: Readonly<Record<'light' | 'dark', Readonly<Record<MotionKind, string>>>> = {
  dark: {
    rapid: '#e5534b',
    linear: '#3fb950',
    arc: '#58a6ff',
    thread: '#d2a8ff',
    cycle: '#e3b341',
  },
  light: {
    rapid: '#cf222e',
    linear: '#1a7f37',
    arc: '#0969da',
    thread: '#8250df',
    cycle: '#9a6700',
  },
};

/**
 * The budgets P3.7 is held to (Phase 3 plan §6.6). At 300k lines: one update of the marks
 * (scroll, edit, a state that became known) costs at most `updateMs` once the states are
 * there; marks exist for the visible lines plus `marginLines` above and below and never for
 * the whole document; the typing budget of Phase 1 holds with the marks on.
 */
export const MOTION_BUDGETS = {
  /** The length of the large program the budgets are measured on. */
  lines: 300_000,
  /** One update of the visible marks, the states known, in node (×5 on CI). */
  updateMs: 4,
  /** Lines above and below the viewport that carry marks, so a short scroll needs no update. */
  marginLines: 100,
  /** The most marks that exist at once. */
  maxMarks: 1_000,
} as const;

/** What `motionOfLine` needs from a profile and a database, worked out once for the pair. */
interface Spec {
  /** `addresses.axes` and the keys of `addresses.incremental`, upper case. */
  axes: ReadonlySet<string>;
  /** `addresses.rapid` (`FMAX`), upper case, or null. */
  rapid: string | null;
  /** The rest of `rapid` behind the feed address (`MAX` of `FMAX`), for `F MAX` written apart; null when `rapid` does not start with it. */
  rapidTail: string | null;
  /** `addresses.feed`, upper case: a feed word alone moves nothing. */
  feed: string;
  /** The first letters (normalized) a code of the database starts with. */
  heads: ReadonlySet<string>;
  /** Written code → entry, for the codes `heads` lets through (bounded). */
  memo: Map<string, CodeEntry | null>;
  db: CodeDb;
}

const MEMO_MAX = 4096;
const SPECS = new WeakMap<CompiledProfile, WeakMap<CodeDb, Spec>>();
const DIGITS = /^\d+$/;

function upperList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '').map((v) => v.toUpperCase()) : [];
}

function specOf(cp: CompiledProfile, db: CodeDb): Spec {
  let byDb = SPECS.get(cp);
  if (byDb === undefined) SPECS.set(cp, (byDb = new WeakMap()));
  let spec = byDb.get(db);
  if (spec === undefined) {
    const addresses = (cp.profile.addresses ?? {}) as unknown as Record<string, unknown>;
    const axes = new Set(upperList(addresses.axes));
    const incremental = addresses.incremental;
    if (incremental !== null && typeof incremental === 'object') for (const word of Object.keys(incremental)) axes.add(word.toUpperCase());
    const rapid = typeof addresses.rapid === 'string' && addresses.rapid.trim() !== '' ? addresses.rapid.trim().toUpperCase() : null;
    const feed = typeof addresses.feed === 'string' && addresses.feed !== '' ? addresses.feed.toUpperCase() : 'F';
    const heads = new Set<string>();
    for (const entry of Array.isArray(db.codes) ? db.codes : []) {
      for (const code of [entry.code, ...(entry.aliases ?? [])]) {
        if (typeof code !== 'string' || code === '') continue;
        const key = normalizeCode(code);
        if (key !== '') heads.add(key[0]);
      }
    }
    const rapidTail = rapid !== null && rapid.length > feed.length && rapid.startsWith(feed) ? rapid.slice(feed.length) : null;
    spec = { axes, rapid, rapidTail, feed, heads, memo: new Map(), db };
    byDb.set(db, spec);
  }
  return spec;
}

function entryOf(spec: Spec, written: string): CodeEntry | null {
  if (written === '' || !spec.heads.has(written.trimStart().charAt(0).toUpperCase())) return null;
  const known = spec.memo.get(written);
  if (known !== undefined) return known;
  const entry = lookupCode(spec.db, written);
  if (spec.memo.size >= MEMO_MAX) spec.memo.clear();
  spec.memo.set(written, entry);
  return entry;
}

/** A keyword and the number behind it as one code (`CYCL DEF 200`), when the database knows the pair; else the keyword. */
function keywordEntry(spec: Spec, tokens: readonly NcToken[], i: number): CodeEntry | null {
  const token = tokens[i];
  const name = token.address || token.text;
  let number = token.valueText;
  if (number === undefined) {
    for (let j = i + 1; j < tokens.length; j++) {
      const next = tokens[j];
      if (next.kind === 'whitespace') continue;
      if (next.address === undefined && next.valueText !== undefined) number = next.valueText;
      break;
    }
  }
  if (number !== undefined) {
    const joined = entryOf(spec, `${name} ${number}`);
    if (joined !== null) return joined;
    const dot = number.indexOf('.');
    if (dot >= 0 && DIGITS.test(number.slice(0, dot)) && DIGITS.test(number.slice(dot + 1))) {
      const shorter = entryOf(spec, `${name} ${number.slice(0, dot)}`);
      if (shorter !== null) return shorter;
    }
  }
  return entryOf(spec, name);
}

/** The kind a motion code gives, or null when it says nothing (`CC`, a code without `sets.motion`). */
function kindOfEntry(entry: CodeEntry | null): MotionKind | null {
  const sets = entry?.sets;
  if (sets === undefined) return null;
  if (sets.motion === 'rapid') return 'rapid';
  if (sets.motion !== 'feed') return null;
  return sets.path === 'arc' ? 'arc' : sets.path === 'cycle' ? 'cycle' : 'linear';
}

/** The token after `i` that is not whitespace, or undefined. */
function nextContent(tokens: readonly NcToken[], i: number): NcToken | undefined {
  for (let j = i + 1; j < tokens.length; j++) if (tokens[j].kind !== 'whitespace') return tokens[j];
  return undefined;
}

/**
 * The kind of one line, or null for no mark (rules 1–5 above). `tokens` are the line's
 * tokens; `before` the state the block runs in (after the line before), `after` the state
 * after the line. The rules read what is in force **after** the block (AD-35); `before` is
 * part of the contract and not needed by them.
 */
export function motionOfLine(
  tokens: readonly NcToken[],
  before: ModalState,
  after: ModalState,
  cp: CompiledProfile,
  db: CodeDb,
): MotionKind | null {
  void before;
  const spec = specOf(cp, db);

  let axisWord = false; // an axis word with a value
  let dataBlock = false; // a code of the block makes the axis words data (`G10`, `G92`, `CYCL DEF 7.1`)
  let cycleCode = false; // a code that starts or calls a cycle
  let pathCode = false; // a non-modal motion code (a Klartext path function)
  let valueWord = false; // a word with a value that is not the feed
  let motion: CodeEntry | null = null; // the block's own modal motion code (the last one)
  let oneShot: CodeEntry | null = null; // the block's own non-modal motion code (`G28`, a path function)
  let rapidMarker = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let entry: CodeEntry | null = null;
    if (token.kind === 'word') {
      const address = token.address ?? '';
      if (address === '') continue;
      if (spec.axes.has(address) && (token.valueText ?? '') !== '') {
        axisWord = true;
        continue;
      }
      if (spec.rapid === address) rapidMarker = true;
      // The rapid marker written apart (`F MAX`): the feed address with no value, then the rest.
      if (spec.rapidTail !== null && address === spec.feed && (token.valueText ?? '') === '') {
        const next = nextContent(tokens, i);
        if (next !== undefined && (next.address || next.text).toUpperCase() === spec.rapidTail) rapidMarker = true;
      }
      if (address !== spec.feed && (token.valueText ?? '') !== '') valueWord = true;
      if (isAssignmentWord(token)) continue;
      entry = entryOf(spec, address + (token.valueText ?? ''));
    } else if (token.kind === 'keyword') {
      if (spec.rapid !== null && (token.address || token.text).toUpperCase() === spec.rapid) rapidMarker = true;
      entry = keywordEntry(spec, tokens, i);
    } else if (token.kind === 'call') {
      entry = entryOf(spec, token.address ?? '');
    }
    if (entry === null) continue;
    if (axisWordsOf(entry) === 'data') dataBlock = true;
    const sets = entry.sets;
    if (sets === undefined) continue;
    if (sets.cycle === 'start' || sets.cycle === 'call' || sets.cycle === 'call-modal') cycleCode = true;
    if (sets.motion === 'rapid' || sets.motion === 'feed') {
      if (entry.modal === true) motion = entry;
      else oneShot = entry;
      if (entry.modal !== true && entry.group === 'motion') pathCode = true;
    }
  }

  // Rule 1: only a moving block gets a mark. A cycle that runs in it counts only when this
  // line itself starts it, calls it or positions (the tail of a block continued over several
  // lines carries the flag of the line above, and has no move of its own).
  // A dwell (`G4 X1.`) writes its time in an axis letter: no move.
  const positions = axisWord && !dataBlock && !after.block.fNotFeed;
  const running = after.block.cycle !== null && (cycleCode || positions);
  if (!positions && !(pathCode && valueWord) && !running) return null;

  // Rule 3 before rule 2: a lead beats a cycle. The interpreter makes a threading pass
  // (`G32`) the block's cycle too, and a threading or tapping cycle is a cycle whose feed is
  // a lead, so "the block's feed is a lead" has to be asked first. A cycle that was defined
  // and is called (`CYCL CALL`, `M99`) carries its lead on the definition.
  // A tapping cycle is a thread whether or not its feed is the lead (Sinumerik `CYCLE84`
  // takes its lead from an argument), and so are the positions that run it.
  const ran = after.block.cycle;
  const active = after.activeCycle;
  const defined = after.definedCycle;
  if (after.block.pitchFeed) return 'thread';
  if (ran !== null && defined !== null && defined.code === ran && defined.pitchFeed) return 'thread';
  if (ran !== null && active !== null && active.code === ran && active.pitchFeed) return 'thread';
  if (running && ran !== null && entryOf(spec, ran)?.tapping === true) return 'thread';
  if (!running && active !== null && (active.pitchFeed || entryOf(spec, active.code)?.tapping === true)) return 'thread';

  // Rule 2: a cycle runs in the block, or the block moves under one.
  if (running || (active !== null && !active.pitchFeed)) return 'cycle';

  // Rule 4: the block's own motion, else the motion in force when it is not assumed.
  if (rapidMarker) return 'rapid';
  if (oneShot !== null) return kindOfEntry(oneShot);
  if (motion !== null) return kindOfEntry(motion);
  const group = after.groups.motion;
  if (group === undefined || group.assumed) return null; // rule 5
  return kindOfEntry(entryOf(spec, group.code));
}
