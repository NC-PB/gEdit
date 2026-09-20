// Looking codes up (plan §7.4). Owner: WP3.3.
//
// Everything here is pure: a `CodeDb` in, an answer out. The index a database needs is
// built on first use and cached against the database object itself, so a hover or a
// completion is a map lookup and not a scan over a few hundred entries.
//
// Normalisation (`normalizeCode`):
//   - case is ignored, `g83` → `G83`
//   - zero padding is dropped, `G01` → `G1`, `M06` → `M6`
//   - a decimal part is kept, `G54.1` stays `G54.1`
//   - whitespace inside a multi-word code collapses to one space, `cycl  def 200` →
//     `CYCL DEF 200`
//   - a single address letter written apart from its digits joins up, `G 83` → `G83`
//     (Fanuc allows the space; `CALL LBL` and `CYCL DEF 200` keep theirs)

import type { NcToken } from '$lib/core/nc/types';
import type { CodeDb, CodeEntry, CodeLookup } from './types';

/** Letters and digits of a code, no separator: `G83`, `M6`, `R0`. */
const LETTER_NUMBER = /^[A-Z]+\d/;

/** A Klartext parameter word as the tokenizer hands it over: `Q200`, `QL5`, `QS3`. */
const Q_PARAMETER = /^(Q[LRS]?)\d+$/;

/**
 * Groups whose entries are words rather than `letter + number` codes but may still stand
 * in the middle of a block, so completion keeps offering them there: the Klartext radius
 * compensation (`R0`, `RL`, `RR`) and the feed words (`FMAX`, `FAUTO`). Everything else
 * that is not shaped like `G83` starts a block.
 */
const MID_BLOCK_GROUPS: ReadonlySet<string> = new Set(['compensation', 'feedmode']);

/** The canonical form of a written code: `G01` → `G1`, `cycl  def 200` → `CYCL DEF 200`. */
export function normalizeCode(code: string): string {
  const packed = code.toUpperCase().trim().replace(/\s+/g, ' ');
  // `G 83` is one word with an optional gap; `CALL LBL` is two words.
  const joined = packed.replace(/^([A-Z]) (?=[-+.]?\d)/, '$1');
  // Zero padding is not significant on a code: `G00` is `G0`, but `G0` stays `G0`.
  return joined.replace(/^([A-Z]+)0+(?=\d)/, '$1');
}

interface CodeIndex {
  /** Normalised code and alias → entry. */
  byCode: Map<string, CodeEntry>;
  /** Every entry once, in display order. */
  ordered: CodeEntry[];
  /** Entry → its normalised code, so display order does not re-normalise. */
  codeOf: Map<CodeEntry, string>;
}

const INDEXES = new WeakMap<CodeDb, CodeIndex>();

/** Splits a code into the parts that decide its display order: `G54.1` → `G`, 54, `.1`. */
function orderKey(code: string): [string, number, string] {
  const m = /^([^0-9]*)(\d+)?(.*)$/.exec(code);
  if (!m) return [code, -1, ''];
  return [m[1], m[2] === undefined ? -1 : Number(m[2]), m[3]];
}

function compareCodes(a: string, b: string): number {
  const [ha, na, ra] = orderKey(a);
  const [hb, nb, rb] = orderKey(b);
  if (ha !== hb) return ha < hb ? -1 : 1;
  if (na !== nb) return na - nb;
  if (ra !== rb) return ra < rb ? -1 : 1;
  return 0;
}

function buildIndex(db: CodeDb): CodeIndex {
  const byCode = new Map<string, CodeEntry>();
  const codeOf = new Map<CodeEntry, string>();

  for (const entry of db.codes) {
    const code = normalizeCode(entry.code);
    codeOf.set(entry, code);
    // A database that `loadCodeDb` produced has no duplicates; a hand-built one might,
    // and then the first entry wins, which is what the loader reports as well.
    if (!byCode.has(code)) byCode.set(code, entry);
    for (const alias of entry.aliases ?? []) {
      const key = normalizeCode(alias);
      if (!byCode.has(key)) byCode.set(key, entry);
    }
  }

  const ordered = [...db.codes].sort((a, b) =>
    compareCodes(codeOf.get(a) ?? a.code, codeOf.get(b) ?? b.code),
  );
  return { byCode, ordered, codeOf };
}

function indexOf(db: CodeDb): CodeIndex {
  let index = INDEXES.get(db);
  if (!index) {
    index = buildIndex(db);
    INDEXES.set(db, index);
  }
  return index;
}

/** The entry for a code, following aliases; null when the database does not have it. */
export function lookupCode(db: CodeDb, code: string): CodeEntry | null {
  if (!code) return null;
  return indexOf(db).byCode.get(normalizeCode(code)) ?? null;
}

/**
 * The address the word starts with. `Q200` and `QL5` answer with their parameter class
 * (`Q`, `QL`), because a Klartext database describes the class and not each number.
 */
function lookupAddress(db: CodeDb, address: string): CodeLookup['address'] {
  const letter = address.toUpperCase();
  const direct = db.addresses[letter];
  if (direct) return { letter, label: direct.label, description: direct.description };

  const q = Q_PARAMETER.exec(letter);
  if (q) {
    const cls = db.addresses[q[1]];
    if (cls) return { letter: q[1], label: cls.label, description: cls.description };
  }
  return undefined;
}

/**
 * What the database knows about one token of a block.
 *
 * `null` means "nothing to say about this kind of token" — a comment, a string, a
 * variable (whose kind the assistant reads off the profile, not off the database) or
 * whitespace. A word the database does not describe comes back as `unknown`, so the
 * assistant can say so instead of staying silent.
 *
 * A multi-word Klartext code (`CYCL DEF 200`) reaches the database as the keyword token
 * `CYCL DEF`; the caller joins it with the number that follows and asks `lookupCode`.
 */
export function lookupWord(db: CodeDb, token: NcToken): CodeLookup | null {
  if (token.kind === 'keyword') {
    const entry = lookupCode(db, token.address ?? token.text);
    return entry ? { entry } : { entry: null, unknown: true };
  }
  if (token.kind !== 'word') return null;

  const address = token.address ?? '';
  const entry = lookupCode(db, address + (token.valueText ?? ''));
  const info = lookupAddress(db, address);
  if (entry) return info ? { entry, address: info } : { entry };
  if (info) return { entry: null, address: info };
  return { entry: null, unknown: true };
}

/** True when the entry may be offered in the middle of a block, not only at its start. */
function isMidBlockCode(entry: CodeEntry, code: string): boolean {
  return LETTER_NUMBER.test(code) || MID_BLOCK_GROUPS.has(entry.group ?? '');
}

/**
 * The entries whose code starts with `prefix`, e.g. `G8` → G80…G89, in display order.
 *
 * The prefix is normalised like a code, so `g8` and `G08` find the same entries. Away
 * from the start of a block, the word-shaped keywords are left out: `L` and `CYCL DEF`
 * can only open a Klartext block, while `FMAX`, `RL` and the M functions cannot.
 */
export function completionsFor(db: CodeDb, prefix: string, atBlockStart: boolean): CodeEntry[] {
  const index = indexOf(db);
  const wanted = normalizeCode(prefix);
  const out: CodeEntry[] = [];
  for (const entry of index.ordered) {
    const code = index.codeOf.get(entry) ?? normalizeCode(entry.code);
    if (wanted && !code.startsWith(wanted)) continue;
    if (!atBlockStart && !isMidBlockCode(entry, code)) continue;
    out.push(entry);
  }
  return out;
}
