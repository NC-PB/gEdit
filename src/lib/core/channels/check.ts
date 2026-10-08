// The wait-code check, pure (plan §7.17 "The check's algorithm, binding", WP12.2, AD-32).
//
// It compares SEQUENCES, not sets: an id that repeats in both channels is normal (a real
// Siemens two-channel program waits on the same mark three times per channel), so the id set
// of a channel says nothing on its own. Per sync rule and per channel pair:
//
//   step 0  one pass over every mark: a blocking mark outside every section (`''` key) is
//           `outside-channels`; a partner the machine does not declare is `unknown-channel`.
//           Non-blocking marks (`blocking: false`, D60) are never checked.
//   count   (an id-less rule; the Okuma `M100`, `STOPS_AND_ENDS_RULE`) the two channels
//           carry the same number of marks naming each other, else ONE `count-mismatch`.
//   ordered (the Okuma `P` codes) per channel, an id smaller than the previous one is
//           `not-increasing`; the channels are never compared, so a number on one side only
//           is legal (the manual's own P10/P20/P40 against P10/P30/P40).
//   rendezvous (default; Fanuc wait M-codes, Siemens `WAITM`) the k-th mark of an id in A
//           pairs with the k-th of that id in B. An id B lacks entirely gives `missing` on
//           every mark of A that has it; an id both carry in different numbers gives ONE
//           `count-mismatch` (on the first unpaired mark). The order of the paired marks is
//           judged by one longest-increasing-subsequence pass (the LCS of the two id
//           sequences under the ordinal pairing, O(n log n)); at most one `out-of-order` per
//           pair, with the count of the rest. An inversion whose two marks are separated by
//           a line of `o.jumpLines` (a jump target or a backward jump, in either channel)
//           is `order-not-checked` instead — once per pair, with the count of the rest.
//   last    `unmatched`: a blocking rendezvous mark whose partners name no declared channel
//           but its own (an empty set included: R5 `whenAbsent: none`), unless that mark
//           already produced a finding (one defect, one finding).
//
// The M12 review fixes (§7.16 #167):
//   NC-01   a `samePartners` rule (the Fanuc wait M-code) compares the WHOLE partner set of
//           two paired marks, each with its own channel, and whether each was written with
//           the partner word: a difference is `partners-differ` (alarm 0160 cases 3 to 5),
//           once per mark of the earlier declared channel.
//   NC-02   a non-blocking mark of an `answers` rule (the Siemens `SETM`) answers a wait for
//           its id in another channel: that id gives no `missing` and no count finding from
//           the waiting side, and its order is not judged. The answering mark itself is
//           never reported.
//   NC-04   a count difference of an id (or of a `count` rule) with a mark that has a jump
//           line before AND after it in its channel (it sits in a loop or a `GOTO` loop) is
//           the info `count-not-checked`, not `count-mismatch`. `missing` stays.
//   NC-12   the partner tokens a mark names that the machine does not declare are ONE
//           `unknown-channel` per mark, listing them all.
//
// Two ids are the same when their text is the same or, when both are digits after the same
// letters, when the values are (`M0101` = `M101`, `0101` = `101`). Findings quote the ids as
// written. A pair is only compared when both channels are keys of `perChannel`: a channel the
// caller could not read (its file is not open) is left out, never reported as missing.

import { budgetClock } from './resolve';
import {
  CHANNEL_CAPS,
  STOPS_AND_ENDS_RULE,
  type ChannelBudget,
  type ChannelParams,
  type SyncFinding,
  type SyncFindingKind,
  type SyncHit,
  type SyncSemantics,
} from './types';

export interface CheckSyncOptions extends ChannelBudget {
  /** Per channel, the lines the written order may not be carried across: a label that is a
   *  jump TARGET and the line of a BACKWARD jump (WP12.5 computes them). A label merely
   *  written on a line is not one, and a jump line equal to a mark's own line separates
   *  nothing (the bounds are exclusive). */
  jumpLines?: Readonly<Record<string, number[]>>;
  /** Per channel, the `Located.document` its findings carry (F58); absent = no `document`. */
  documents?: Readonly<Record<string, string>>;
}

export interface CheckSyncResult {
  /** Sorted by channel (declared order, `''` first), then line. */
  findings: SyncFinding[];
  /** The deadline (`o.deadline`, the caller's `CHANNEL_CAPS.checkMs`) passed: the findings are
   *  those found so far, and the report must say it was truncated. */
  truncated: boolean;
}

/** One mark as the check sees it. */
interface Item {
  hit: SyncHit;
  channel: string;
  /** Comparison key of the id. */
  key: string;
  /** Declared partners other than the own channel, one bit per declared index (≤ 32 channels). */
  names: number;
  flagged: boolean;
  /** It names a token the machine does not declare (`unknown-channel` was reported). */
  unknown: boolean;
}

interface RuleInfo {
  id: string;
  label: string;
  semantics: SyncSemantics;
  answers: boolean;
  samePartners: boolean;
}

const KIND_ORDER: readonly SyncFindingKind[] = [
  'outside-channels',
  'unknown-channel',
  'missing',
  'count-mismatch',
  'count-not-checked',
  'partners-differ',
  'out-of-order',
  'order-not-checked',
  'not-increasing',
  'unmatched',
];

/** `M0101` → `M\u0000101`; anything that is not letters + digits stays as written. */
export function markKey(mark: string): string {
  const m = /^([A-Za-z]*)(\d+)$/.exec(mark);
  if (!m) return mark;
  const digits = m[2].replace(/^0+(?=\d)/, '');
  return `${m[1]}\u0000${digits}`;
}

/** The numeric value of an id for `ordered`, with its letters; null when it has none. */
function orderValue(mark: string): { letters: string; value: number } | null {
  const m = /^([A-Za-z]*)(\d+)$/.exec(mark);
  if (!m) return null;
  return { letters: m[1].toUpperCase(), value: Number(m[2]) };
}

/** Any of the sorted `lines` strictly between `a` and `b`. */
function between(lines: readonly number[] | undefined, a: number, b: number): boolean {
  if (!lines || lines.length === 0) return false;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let left = 0;
  let right = lines.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (lines[mid] <= lo) left = mid + 1;
    else right = mid;
  }
  return left < lines.length && lines[left] < hi;
}

/** Indexes of one longest strictly increasing subsequence of `values` (deterministic). */
function lisIndexes(values: readonly number[]): Set<number> {
  const tails: number[] = []; // indexes into values
  const prev = new Int32Array(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < values[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const kept = new Set<number>();
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) kept.add(i);
  return kept;
}

class Deadline extends Error {}

/** `checkSyncMarks` with the truncation flag (§7.17 budget). */
export function checkSyncMarksReport(
  // The key '' holds the hits no section owned (`outside-channels`).
  perChannel: Readonly<Record<string, SyncHit[]>>,
  p: ChannelParams,
  o: CheckSyncOptions = {},
): CheckSyncResult {
  // §7.17 caps a machine at 32 channels; the partner sets are 32-bit masks over them.
  const list = (Array.isArray(p.list) ? p.list : []).slice(0, CHANNEL_CAPS.channels);
  const rank = new Map<string, number>();
  const nameOf = new Map<string, string>();
  list.forEach((c, i) => {
    if (!rank.has(c.id)) rank.set(c.id, i);
    nameOf.set(c.id, c.name);
  });
  const display = (id: string): string => nameOf.get(id) ?? id;
  const bit = (id: string): number => 1 << rank.get(id)!;

  const rules = new Map<string, RuleInfo>();
  for (const r of Array.isArray(p.syncMarks) ? p.syncMarks : []) {
    if (r && typeof r.id === 'string' && !rules.has(r.id)) {
      rules.set(r.id, {
        id: r.id,
        label: typeof r.label === 'string' ? r.label : r.id,
        semantics: r.semantics ?? 'rendezvous',
        answers: r.answers === true,
        samePartners: r.samePartners === true,
      });
    }
  }
  rules.set(STOPS_AND_ENDS_RULE, {
    id: STOPS_AND_ENDS_RULE,
    label: STOPS_AND_ENDS_RULE,
    semantics: 'count',
    answers: false,
    samePartners: false,
  });

  const jumps = new Map<string, number[]>();
  for (const [ch, lines] of Object.entries(o.jumpLines ?? {})) {
    jumps.set(
      ch,
      [...new Set(lines.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b),
    );
  }

  const findings: SyncFinding[] = [];
  const late = budgetClock(o);
  let ticks = 0;
  const tick = (): void => {
    if ((++ticks & 255) === 0 && late()) throw new Deadline();
  };

  const add = (f: Omit<SyncFinding, 'document'>): void => {
    const document = o.documents?.[f.channel];
    findings.push(document === undefined ? f : { ...f, document });
  };

  // The channels compared: the declared ones the caller passed, in declared order.
  const present = list
    .map((c) => c.id)
    .filter((id, i, all) => all.indexOf(id) === i && Object.prototype.hasOwnProperty.call(perChannel, id));
  /** NC-02: per channel, the ids its answering (`answers`, non-blocking) marks set. */
  const answered = new Map<string, Set<string>>();
  /** NC-01: marks already reported as `partners-differ`. */
  const differs = new Set<Item>();

  let truncated = false;
  try {
    // Step 0, and the items per rule and channel.
    const byRule = new Map<string, Map<string, Item[]>>();
    for (const hit of perChannel[''] ?? []) {
      tick();
      // A stop or end outside every section (a shared subprogram's `M99`) waits for no channel.
      if (hit.blocking === false || !rules.has(hit.ruleId) || hit.ruleId === STOPS_AND_ENDS_RULE) continue;
      add({
        kind: 'outside-channels',
        mark: hit.mark,
        ruleId: hit.ruleId,
        channel: '',
        line: hit.line,
        message: {
          key: 'channels.findings.outside',
          params: { mark: markText(hit, rules), line: hit.line },
        },
      });
    }
    for (const channel of present) {
      for (const hit of perChannel[channel] ?? []) {
        tick();
        const rule = rules.get(hit.ruleId);
        if (!rule) continue;
        if (hit.blocking === false) {
          if (rule.answers && rule.semantics === 'rendezvous') {
            let keys = answered.get(channel);
            if (!keys) answered.set(channel, (keys = new Set()));
            keys.add(markKey(hit.mark));
          }
          continue;
        }
        let names = 0;
        const unknown: string[] = [];
        for (const partner of Array.isArray(hit.partners) ? hit.partners : []) {
          if (rank.has(partner)) {
            if (partner !== channel) names |= bit(partner);
          } else if (!unknown.includes(partner)) unknown.push(partner);
        }
        const item: Item = {
          hit,
          channel,
          key: rule.semantics === 'count' ? '' : markKey(hit.mark),
          names,
          flagged: false,
          unknown: unknown.length > 0,
        };
        if (unknown.length > 0) {
          item.flagged = true;
          add({
            kind: 'unknown-channel',
            mark: hit.mark,
            ruleId: rule.id,
            channel,
            line: hit.line,
            message:
              unknown.length === 1
                ? {
                    key: 'channels.findings.unknownChannel',
                    params: { mark: markText(hit, rules), token: unknown[0], channel: display(channel) },
                  }
                : {
                    key: 'channels.findings.unknownChannels',
                    params: { mark: markText(hit, rules), tokens: unknown.join(', '), channel: display(channel) },
                  },
          });
        }
        let perCh = byRule.get(rule.id);
        if (!perCh) byRule.set(rule.id, (perCh = new Map()));
        let items = perCh.get(channel);
        if (!items) perCh.set(channel, (items = []));
        items.push(item);
      }
    }
    for (const items of [...byRule.values()].flatMap((m) => [...m.values()])) items.sort((a, b) => a.hit.line - b.hit.line);

    for (const [ruleId, perCh] of [...byRule.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const rule = rules.get(ruleId)!;
      if (rule.semantics === 'ordered') {
        for (const channel of present) checkOrdered(rule, channel, perCh.get(channel) ?? []);
        continue;
      }
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const a = present[i];
          const b = present[j];
          const bitA = bit(a);
          const bitB = bit(b);
          const la = (perCh.get(a) ?? []).filter((it) => (it.names & bitB) !== 0);
          const lb = (perCh.get(b) ?? []).filter((it) => (it.names & bitA) !== 0);
          if (la.length === 0 && lb.length === 0) continue;
          tick();
          if (rule.semantics === 'count') checkCount(rule, a, b, la, lb);
          else checkRendezvous(rule, a, b, la, lb);
        }
      }
      if (rule.semantics === 'rendezvous') {
        for (const channel of present) {
          for (const it of perCh.get(channel) ?? []) {
            tick();
            if (it.flagged || it.names !== 0) continue;
            add({
              kind: 'unmatched',
              mark: it.hit.mark,
              ruleId,
              channel,
              line: it.hit.line,
              message: {
                key: 'channels.findings.unmatched',
                params: { mark: it.hit.mark, channel: display(channel) },
              },
            });
          }
        }
      }
    }
  } catch (e) {
    if (!(e instanceof Deadline)) throw e;
    truncated = true;
  }

  const chRank = (id: string | undefined): number => (id === undefined ? -2 : id === '' ? -1 : (rank.get(id) ?? list.length));
  findings.sort(
    (x, y) =>
      chRank(x.channel) - chRank(y.channel) ||
      (x.channel < y.channel ? -1 : x.channel > y.channel ? 1 : 0) ||
      x.line - y.line ||
      KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) ||
      (x.ruleId < y.ruleId ? -1 : x.ruleId > y.ruleId ? 1 : 0) ||
      chRank(x.other) - chRank(y.other) ||
      (x.otherLine ?? 0) - (y.otherLine ?? 0) ||
      (x.mark < y.mark ? -1 : x.mark > y.mark ? 1 : 0) ||
      String(x.message.params?.token ?? x.message.params?.tokens ?? '').localeCompare(String(y.message.params?.token ?? y.message.params?.tokens ?? '')),
  );
  return { findings, truncated };

  // --- the per-semantics steps (closures over `add`, `display`, `jumps`, `tick`) ---------

  /** NC-01: two paired marks of a `samePartners` rule must name the same channels, each with
   *  its own, and be written alike (both with the partner word or both without). */
  function comparePartners(rule: RuleInfo, a: string, b: string, x: Item, y: Item): void {
    if (x.unknown || y.unknown || differs.has(x)) return;
    const setX = x.names | bit(a);
    const setY = y.names | bit(b);
    const absentX = x.hit.absent === true;
    const absentY = y.hit.absent === true;
    if (setX === setY && absentX === absentY) return;
    differs.add(x);
    x.flagged = true;
    y.flagged = true;
    const names = (set: number): string =>
      list
        .filter((c, i) => rank.get(c.id) === i && (set & (1 << i)) !== 0)
        .map((c) => c.name)
        .join(', ');
    add({
      kind: 'partners-differ',
      mark: x.hit.mark,
      ruleId: rule.id,
      channel: a,
      other: b,
      line: x.hit.line,
      otherLine: y.hit.line,
      message:
        absentX !== absentY
          ? {
              key: 'channels.findings.partnersDifferAbsent',
              params: {
                mark: x.hit.mark,
                channel: display(a),
                other: display(b),
                line: x.hit.line,
                otherLine: y.hit.line,
                without: display(absentX ? a : b),
              },
            }
          : {
              key: 'channels.findings.partnersDiffer',
              params: {
                mark: x.hit.mark,
                channel: display(a),
                other: display(b),
                otherLine: y.hit.line,
                names: names(setX),
                otherNames: names(setY),
              },
            },
    });
  }

  /** NC-04: a mark with a jump line before and after it in its channel (in a loop); a label on the
   *  mark's own line (`N10 M901` ... `GOTO10`) counts as before. */
  function looped(it: Item): boolean {
    const lines = jumps.get(it.channel);
    return lines !== undefined && lines.length > 1 && lines[0] !== lines[lines.length - 1] && lines[0] <= it.hit.line && lines[lines.length - 1] >= it.hit.line;
  }

  function checkCount(rule: RuleInfo, a: string, b: string, la: Item[], lb: Item[]): void {
    if (la.length === lb.length) return;
    const [more, fewer, chMore, chFewer] = la.length > lb.length ? [la, lb, a, b] : [lb, la, b, a];
    const first = more[fewer.length];
    first.flagged = true;
    if (la.some(looped) || lb.some(looped)) {
      add({
        kind: 'count-not-checked',
        mark: '',
        ruleId: rule.id,
        channel: chMore,
        other: chFewer,
        counts: { channel: more.length, other: fewer.length },
        line: first.hit.line,
        ...(fewer.length > 0 ? { otherLine: fewer[fewer.length - 1].hit.line } : {}),
        message: {
          key: rule.id === STOPS_AND_ENDS_RULE ? 'channels.findings.countNotCheckedStops' : 'channels.findings.countNotCheckedRule',
          params: {
            rule: rule.label,
            channel: display(chMore),
            other: display(chFewer),
            count: more.length,
            otherCount: fewer.length,
          },
        },
      });
      return;
    }
    add({
      kind: 'count-mismatch',
      mark: '',
      ruleId: rule.id,
      channel: chMore,
      other: chFewer,
      counts: { channel: more.length, other: fewer.length },
      line: first.hit.line,
      ...(fewer.length > 0 ? { otherLine: fewer[fewer.length - 1].hit.line } : {}),
      message: {
        key: rule.id === STOPS_AND_ENDS_RULE ? 'channels.findings.countMismatchStops' : 'channels.findings.countMismatchRule',
        params: {
          rule: rule.label,
          channel: display(chMore),
          other: display(chFewer),
          count: more.length,
          otherCount: fewer.length,
        },
      },
    });
  }

  function checkOrdered(rule: RuleInfo, channel: string, items: Item[]): void {
    const lines = jumps.get(channel);
    let previous: Item | null = null;
    for (const it of items) {
      tick();
      const v = orderValue(it.hit.mark);
      if (v === null) continue;
      if (previous !== null) {
        const pv = orderValue(previous.hit.mark)!;
        if (pv.letters === v.letters && v.value < pv.value) {
          const excused = between(lines, previous.hit.line, it.hit.line);
          add({
            kind: excused ? 'order-not-checked' : 'not-increasing',
            mark: it.hit.mark,
            ruleId: rule.id,
            channel,
            line: it.hit.line,
            message: {
              key: excused ? 'channels.findings.orderNotCheckedOrdered' : 'channels.findings.notIncreasing',
              params: {
                mark: it.hit.mark,
                previous: previous.hit.mark,
                previousLine: previous.hit.line,
                channel: display(channel),
              },
            },
          });
        }
      }
      previous = it;
    }
  }

  function checkRendezvous(rule: RuleInfo, a: string, b: string, la: Item[], lb: Item[]): void {
    // Ordinal pairing: one pass over each list into id → positions.
    const posA = new Map<string, number[]>();
    const posB = new Map<string, number[]>();
    la.forEach((it, i) => (posA.get(it.key) ?? posA.set(it.key, []).get(it.key)!).push(i));
    lb.forEach((it, i) => (posB.get(it.key) ?? posB.set(it.key, []).get(it.key)!).push(i));
    const partnerOfA = new Int32Array(la.length).fill(-1);
    const answeredA = answered.get(a);
    const answeredB = answered.get(b);

    const keys = [...new Set([...posA.keys(), ...posB.keys()])];
    for (const key of keys) {
      const pa = posA.get(key) ?? [];
      const pb = posB.get(key) ?? [];
      // NC-02: a `SETM` of this id in either channel answers the waits: neither the count nor
      // the order of this id says anything, and nothing is missing.
      if (answeredA?.has(key) === true || answeredB?.has(key) === true) continue;
      const n = Math.min(pa.length, pb.length);
      for (let k = 0; k < n; k++) partnerOfA[pa[k]] = pb[k];
      if (rule.samePartners) for (let k = 0; k < n; k++) comparePartners(rule, a, b, la[pa[k]], lb[pb[k]]);
      if (pa.length === pb.length) continue;
      const [more, fewer, lMore, lFewer, chMore, chFewer] = pa.length > pb.length ? [pa, pb, la, lb, a, b] : [pb, pa, lb, la, b, a];
      if (fewer.length > 0 && (pa.some((idx) => looped(la[idx])) || pb.some((idx) => looped(lb[idx])))) {
        // NC-04: a mark of this id sits in a loop, so the written counts say nothing.
        const first = lMore[more[fewer.length]];
        for (let k = fewer.length; k < more.length; k++) lMore[more[k]].flagged = true;
        add({
          kind: 'count-not-checked',
          mark: first.hit.mark,
          ruleId: rule.id,
          channel: chMore,
          other: chFewer,
          counts: { channel: more.length, other: fewer.length },
          line: first.hit.line,
          otherLine: lFewer[fewer[fewer.length - 1]].hit.line,
          message: {
            key: 'channels.findings.countNotChecked',
            params: {
              mark: first.hit.mark,
              channel: display(chMore),
              other: display(chFewer),
              count: more.length,
              otherCount: fewer.length,
            },
          },
        });
        continue;
      }
      if (fewer.length === 0) {
        for (const idx of more) {
          const it = lMore[idx];
          it.flagged = true;
          add({
            kind: 'missing',
            mark: it.hit.mark,
            ruleId: rule.id,
            channel: chMore,
            other: chFewer,
            line: it.hit.line,
            message: {
              key: 'channels.findings.missing',
              params: {
                mark: it.hit.mark,
                channel: display(chMore),
                other: display(chFewer),
              },
            },
          });
        }
      } else {
        const first = lMore[more[fewer.length]];
        for (let k = fewer.length; k < more.length; k++) lMore[more[k]].flagged = true;
        add({
          kind: 'count-mismatch',
          mark: first.hit.mark,
          ruleId: rule.id,
          channel: chMore,
          other: chFewer,
          counts: { channel: more.length, other: fewer.length },
          line: first.hit.line,
          otherLine: lFewer[fewer[fewer.length - 1]].hit.line,
          message: {
            key: 'channels.findings.countMismatch',
            params: {
              mark: first.hit.mark,
              channel: display(chMore),
              other: display(chFewer),
              count: more.length,
              otherCount: fewer.length,
            },
          },
        });
      }
    }

    // Order: the paired marks of A in A's order, valued by their partner's position in B.
    const paired: number[] = [];
    for (let i = 0; i < la.length; i++) if (partnerOfA[i] >= 0) paired.push(i);
    const kept = lisIndexes(paired.map((i) => partnerOfA[i]));
    if (kept.size === paired.length) return;
    // For each paired position, the nearest kept neighbours before and after (in A order).
    const prevKept = new Int32Array(paired.length).fill(-1);
    const nextKept = new Int32Array(paired.length).fill(-1);
    for (let i = 0, last = -1; i < paired.length; i++) {
      prevKept[i] = last;
      if (kept.has(i)) last = i;
    }
    for (let i = paired.length - 1, last = -1; i >= 0; i--) {
      nextKept[i] = last;
      if (kept.has(i)) last = i;
    }
    const jA = jumps.get(a);
    const jB = jumps.get(b);
    const separated = (x: number, y: number): boolean => {
      const ax = la[paired[x]].hit.line;
      const ay = la[paired[y]].hit.line;
      const bx = lb[partnerOfA[paired[x]]].hit.line;
      const by = lb[partnerOfA[paired[y]]].hit.line;
      return between(jA, ax, ay) || between(jB, bx, by);
    };
    let real: { at: number; crossed: number } | null = null;
    let realCount = 0;
    let excused: { at: number; crossed: number } | null = null;
    let excusedCount = 0;
    for (let i = 0; i < paired.length; i++) {
      if (kept.has(i)) continue;
      tick();
      const bi = partnerOfA[paired[i]];
      const crossing: number[] = [];
      if (prevKept[i] >= 0 && partnerOfA[paired[prevKept[i]]] > bi) crossing.push(prevKept[i]);
      if (nextKept[i] >= 0 && partnerOfA[paired[nextKept[i]]] < bi) crossing.push(nextKept[i]);
      const open = crossing.find((c) => !separated(i, c));
      if (open !== undefined) {
        realCount++;
        real ??= { at: i, crossed: open };
      } else if (crossing.length > 0) {
        excusedCount++;
        excused ??= { at: i, crossed: crossing[0] };
      }
    }
    const report = (found: { at: number; crossed: number }, count: number, kind: 'out-of-order' | 'order-not-checked'): void => {
      const m = la[paired[found.at]];
      const c = la[paired[found.crossed]];
      const mb = lb[partnerOfA[paired[found.at]]];
      const cb = lb[partnerOfA[paired[found.crossed]]];
      add({
        kind,
        mark: m.hit.mark,
        ruleId: rule.id,
        channel: a,
        other: b,
        line: m.hit.line,
        otherLine: mb.hit.line,
        message: {
          // M12 fix F5: the "n more" sentence only when there are more.
          key:
            kind === 'out-of-order'
              ? count > 1
                ? 'channels.findings.outOfOrderMore'
                : 'channels.findings.outOfOrder'
              : count > 1
                ? 'channels.findings.orderNotCheckedMore'
                : 'channels.findings.orderNotChecked',
          params: {
            mark: m.hit.mark,
            crossed: c.hit.mark,
            channel: display(a),
            other: display(b),
            line: m.hit.line,
            crossedLine: c.hit.line,
            otherLine: mb.hit.line,
            otherCrossedLine: cb.hit.line,
            ...(count > 1 ? { rest: count - 1 } : {}),
          },
        },
      });
    };
    if (real) report(real, realCount, 'out-of-order');
    if (excused) report(excused, excusedCount, 'order-not-checked');
  }
}

/** The mark as a message names it: its id, or the rule label for an id-less mark. */
function markText(hit: SyncHit, rules: Map<string, RuleInfo>): string {
  return hit.mark !== '' ? hit.mark : (rules.get(hit.ruleId)?.label ?? hit.ruleId);
}

/**
 * The wait-code check (plan §7.17, WP12.2): pure, deterministic, sorted by channel (declared
 * order, `''` first) then line. The contract signature; `checkSyncMarksReport` also says
 * whether the deadline truncated the report.
 */
export function checkSyncMarks(
  // The key '' holds the hits no section owned (`outside-channels`).
  perChannel: Readonly<Record<string, SyncHit[]>>,
  p: ChannelParams,
  o: CheckSyncOptions = {},
): SyncFinding[] {
  return checkSyncMarksReport(perChannel, p, o).findings;
}
