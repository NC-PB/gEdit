// The outline service (plan §7.3, AD-12). Owner: WP3.5.
//
// One `OutlineIndex` (core/profiles/outline.ts) per open document. The first build runs
// after the first render, in slices of at most `BUILD_BUDGET_MS` (8 ms, the budget of the
// modal index) that start when the app is idle (`runWhenIdle`), so opening a 10 MB program
// never blocks a frame: a slice reads a few hundred lines at a time and looks at the clock
// between two of them (B1 B2; it was 20,000 lines a slice, which is 150 ms and more on a
// slow engine). A machine switch rebuilds the same way. Every content change is fed into
// `applyChange`, and only the *published* items are debounced by 150 ms. `toolLines()` and `itemAt()` answer from the index directly,
// because F7 pressed right after a keystroke must not step to a stale line.
//
// A document is indexed once, not once per tab switch: the M1 program map re-parsed on
// every switch and paid ~36 ms on a 10 MB program (G7). Here the panel only swaps which
// store it subscribes to.
//
// Why the slice loop re-reads the line count instead of trusting the change events: while
// the first build is running, an edit *below* the built prefix needs no work at all (the
// build has not read those lines yet), and an edit *inside* it is a normal `applyChange`
// plus a shift of the build cursor. Only a change that straddles the boundary, or a flush
// (`setValue`, reload, compare), restarts the build.
//
// `createOutlineService(deps)` plus the singleton wired to the real modules (AD-2), so a
// unit test drives it with a fake editor and a fake clock.

import { writable, type Readable, type Writable } from 'svelte/store';
import { OutlineIndex, type OutlineItem } from '$lib/core/profiles/outline';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { machines as appMachines } from '$lib/stores/machines';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { channels as appChannels } from '$lib/stores/channels';
import { STOPS_AND_ENDS_RULE } from '$lib/core/channels/types';
import { shownMark } from '$lib/core/channels/marks';
import type { ChannelParams, ChannelSet, SyncRule } from '$lib/core/channels/types';
import { labelsOf, referenceAddresses, referencesOn, blockKeyOf, comparesByText, maskedOf } from '$lib/core/transforms/references';
import type { BlockKey } from '$lib/core/transforms/references';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { IDLE_BUDGET_MS, runWhenIdle } from '$lib/app/modalService';
import { t } from '$lib/i18n';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { Disposable, DocId, DocumentStore, EditorService, OutlineService } from '$lib/app/types';

/**
 * Lines the first build reads between two looks at the clock (AD-12). A slice runs at least
 * one such run and stops at the first look that finds `BUILD_BUDGET_MS` spent, so the longest
 * a slice holds the main thread is the budget plus one run.
 */
export const CHUNK_LINES = 250;
/** The most one slice of the first build spends, the modal index's budget (B1 B2). */
export const BUILD_BUDGET_MS = IDLE_BUDGET_MS;
/** How long the published items wait after the last change (AD-12). */
export const AGGREGATE_DELAY_MS = 150;

export interface OutlineServiceDeps {
  docs: Pick<DocumentStore, 'get' | 'list'>;
  editor: Pick<EditorService, 'hasModel' | 'getLineCount' | 'getLines' | 'onDidChangeContent' | 'onDidCreateModel'>;
  /**
   * The document's **effective** compiled profile and the key it was built from (AD-31),
   * or null while the document is unknown.
   *
   * The key, not the profile id, is what an index is rebuilt on. A machine decides which
   * G-code system a lathe program is read in, and with it which lines are tool changes —
   * so switching the machine has to rebuild the map exactly as switching the profile does.
   */
  effective(id: DocId): { cp: CompiledProfile; key: string } | null;
  /** Bumps whenever a machine or a document's choice changed, so the keys are re-read. */
  machineRevision?: Readable<number>;
  /**
   * M13 (AD-29): `profiles.revision`. A reload compiles every profile again, so a document's
   * effective profile can be a different object under the same key; the index is rebuilt for
   * those whose profile is different in content, and kept for the others.
   */
  profileRevision?: Readable<number>;
  /**
   * M12 (WP12.5): the channels of a document. With a `single-file` layout the published
   * items are grouped per channel; without it (or without this member) they are the P1 tree.
   */
  channels?: {
    forDoc(id: DocId): ChannelSet;
    revision: Readable<number>;
    ruleLabel(id: DocId, ruleId: string): string;
    /** The machine's channel block (M13 review NC-10: a `prefix` rule's marks are shown with
     *  their prefix, `M130` and not `30`). Absent = the ids as they are keyed. */
    params?(id: DocId): ChannelParams | null;
  };
  /** `setTimeout`, as a canceller; `ms` of 0 means "after this frame". */
  schedule(fn: () => void, ms: number): Disposable;
  /**
   * Runs `fn` when the app is idle (`runWhenIdle`): the scheduler of the first build's slices
   * (B1 B2). Absent, they are `schedule(fn, 0)`.
   */
  idle?(fn: () => void): Disposable;
  /** The clock of the slice budget (`performance.now`). Absent, `performance.now`. */
  now?(): number;
  /** The most one slice spends, in ms; `BUILD_BUDGET_MS` when absent. */
  budgetMs?: number;
  /** Lines between two looks at the clock (`CHUNK_LINES`). */
  chunkLines: number;
  delayMs: number;
}

interface Entry {
  /** `EffectiveMachine.key`: the profile **and** the machine the index was built with. */
  key: string;
  /** The compiled profile the index was built with (a reload replaces the object, not always the content). */
  cp: CompiledProfile;
  index: OutlineIndex;
  store: Writable<OutlineItem[]>;
  /** The chunked first build, or null once it has finished. */
  build: { next: number; cancel: Disposable } | null;
  ready: Promise<void>;
  markReady: () => void;
  /** The pending aggregation. */
  publish: Disposable | null;
  id: DocId;
  /** What the grouped map was last published from, and the rows (M12 performance fix F1). */
  grouped: { items: OutlineItem[]; set: ChannelSet; rows: GroupedItem[] } | null;
}

/** A row of the grouped tree: `channelId` is set on a channel group's row (`OutlineItem.channelId`). */
export type GroupedItem = OutlineItem;

/**
 * The most waits of one channel the map lists one by one (M12 performance fix F1). Past it the
 * channel's waits are one `sync` row with their `count`, on the first wait's line, and
 * Next/Previous Sync Point (`Alt+F7`) reaches each of them. A 300k-line program with 20,000
 * waits drew 20,000 rows, and every edit rebuilt them for 7 to 14 s.
 */
export const SYNC_ROWS_MAX = 250;

/** The `sync` rows of each channel, built once per channel set (`groupByChannel`). */
const syncRowCache = new WeakMap<ChannelSet, Map<string, GroupedItem[]>>();

function syncRowsOf(set: ChannelSet, markText: (hit: ChannelSet['marks'][number]) => string): Map<string, GroupedItem[]> {
  const cached = syncRowCache.get(set);
  if (cached !== undefined) return cached;
  const perChannel = new Map<string, ChannelSet['marks']>();
  for (const hit of set.marks) {
    if (!hit.blocking || hit.ruleId === STOPS_AND_ENDS_RULE) continue;
    const list = perChannel.get(hit.channel);
    if (list) list.push(hit);
    else perChannel.set(hit.channel, [hit]);
  }
  const rows = new Map<string, GroupedItem[]>();
  for (const [channel, hits] of perChannel) {
    rows.set(
      channel,
      hits.length > SYNC_ROWS_MAX
        ? [{ kind: 'sync', line: hits[0].line, text: t('channels.map.waits', { count: hits.length }), count: hits.length }]
        : hits.map((hit) => ({ kind: 'sync', line: hit.line, text: markText(hit) })),
    );
  }
  syncRowCache.set(set, rows);
  return rows;
}

/** Same row, field by field, with the same children objects (`reuseRows`). */
function sameRow(a: GroupedItem, b: GroupedItem): boolean {
  if (a.kind !== b.kind || a.line !== b.line || a.endLine !== b.endLine || a.text !== b.text || a.tool !== b.tool || a.channelId !== b.channelId || a.count !== b.count) return false;
  const ac = a.children;
  const bc = b.children;
  if (ac === bc) return true;
  if (ac === undefined || bc === undefined || ac.length !== bc.length) return false;
  for (let i = 0; i < ac.length; i++) if (ac[i] !== bc[i]) return false;
  return true;
}

/**
 * The incremental half of the grouped map (M12 performance fix F1): every row of `next` that
 * equals a row of `previous` (same key, same fields, same children) is replaced by the
 * previous object, and so is a children list whose rows all were. The panel's keyed lists then
 * touch only the rows an edit changed, instead of redrawing the whole map.
 */
export function reuseRows(previous: readonly GroupedItem[], next: GroupedItem[]): GroupedItem[] {
  const old = new Map<string, GroupedItem>();
  const index = (rows: readonly GroupedItem[]): void => {
    for (const row of rows) {
      old.set(`${row.kind}:${row.line}:${row.channelId ?? ''}`, row);
      if (row.children) index(row.children);
    }
  };
  index(previous);
  if (old.size === 0) return next;
  const visit = (rows: GroupedItem[], before: readonly GroupedItem[] | undefined): GroupedItem[] => {
    let same = before !== undefined && before.length === rows.length;
    const out = rows.map((row, i) => {
      if (row.children) {
        const prev = old.get(`${row.kind}:${row.line}:${row.channelId ?? ''}`);
        row.children = visit(row.children, prev?.children);
      }
      const prev = old.get(`${row.kind}:${row.line}:${row.channelId ?? ''}`);
      const kept = prev !== undefined && sameRow(prev, row) ? prev : row;
      if (same && before?.[i] !== kept) same = false;
      return kept;
    });
    return same && before !== undefined ? (before as GroupedItem[]) : out;
  };
  return visit(next, previous);
}

/** Display text of the group that holds the lines no channel owns. */
function outsideText(): string {
  return t('channels.map.outside');
}

/**
 * The program map of a `single-file` document with channels: one `channel` row per channel
 * with the items of **every one of its ranges**, in document order, and its blocking marks
 * as `sync` rows; the lines no channel owns are the group "Outside the channels".
 *
 * A tool segment's children stay under it while they are in the same channel; one that
 * lies in another channel's range becomes a row of that channel.
 */
export function groupByChannel(
  items: readonly OutlineItem[],
  set: ChannelSet,
  markText: (hit: ChannelSet['marks'][number]) => string,
): GroupedItem[] {
  // Every channel that holds a line (a shared section holds it for each of its channels).
  const ownersOf = (line: number): string[] => {
    const ids: string[] = [];
    for (const m of set.members) {
      if (m.kind === 'section' && m.ranges.some((r) => line >= r.startLine && line <= r.endLine)) ids.push(m.channel.id);
    }
    return ids.length === 0 ? [''] : ids;
  };
  const groups = new Map<string, GroupedItem[]>();
  const push = (key: string, item: GroupedItem): void => {
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  };
  for (const item of items) {
    const owners = ownersOf(item.line);
    const same = (line: number): boolean => ownersOf(line).join('\t') === owners.join('\t');
    const parent: GroupedItem = { ...item };
    delete parent.children;
    const kept: OutlineItem[] = [];
    for (const child of item.children ?? []) {
      if (same(child.line)) kept.push(child);
      else for (const key of ownersOf(child.line)) push(key, child);
    }
    if (kept.length > 0) parent.children = kept;
    for (const key of owners) push(key, parent);
  }
  for (const [channel, rows] of syncRowsOf(set, markText)) for (const row of rows) push(channel, row);
  const rows: GroupedItem[] = [];
  for (const m of set.members) {
    if (m.kind !== 'section') continue;
    const children = (groups.get(m.channel.id) ?? []).sort((a, b) => a.line - b.line);
    rows.push({
      kind: 'channel',
      line: m.ranges[0].startLine,
      endLine: m.ranges[m.ranges.length - 1].endLine,
      text: m.channel.name,
      channelId: m.channel.id,
      children,
    });
  }
  const outside = groups.get('');
  if (outside !== undefined && outside.length > 0) {
    outside.sort((a, b) => a.line - b.line);
    rows.push({ kind: 'channel', line: outside[0].line, text: outsideText(), channelId: '', children: outside });
  }
  return rows;
}

/** The keywords that open (`WHILE`, `DO`, `FOR`, `LOOP`, `REPEAT`) or close (`END`, `ENDWHILE`, `ENDFOR`, `ENDLOOP`, `UNTIL`) a loop. */
const LOOP_KEYWORDS = new Set(['WHILE', 'DO', 'FOR', 'LOOP', 'REPEAT', 'END', 'ENDWHILE', 'ENDFOR', 'ENDLOOP', 'UNTIL']);

/** Does the line start or end a structured loop? (Read from the keyword tokens, so a comment or a string never counts.) */
function isLoopLine(tokens: readonly { kind: string; address?: string }[]): boolean {
  return tokens.some((tok) => tok.kind === 'keyword' && tok.address !== undefined && LOOP_KEYWORDS.has(tok.address.toUpperCase()));
}

/**
 * The lines the written order of a channel may not be carried across (§7.17 "Order not
 * checked"): a line that a jump of the SAME channel names (`GOTO`/`GOTOB`/`GOTOF`,
 * `M99 P`, `M98 Q`, through `numbering.references`; a block number or a label), and the line
 * of a backward jump. A label that nothing jumps to is not one: in a Siemens program every
 * wait line carries its own label. A jump whose target cannot be named (a variable, a
 * computed string) or is not in the channel is left out.
 *
 * The first and the last line of a structured loop (Fanuc `WHILE`/`DO n`/`END n`, Siemens
 * `WHILE`/`FOR`/`LOOP`/`REPEAT` and `ENDWHILE`/`ENDFOR`/`ENDLOOP`/`UNTIL`) are in the list too: the
 * end is a backward jump, the start is where it lands.
 */
export function computeJumpLines(
  lines: readonly string[],
  cp: CompiledProfile,
  channelOf: (line: number) => string | readonly string[],
): Record<string, number[]> {
  const out: Record<string, Set<number>> = {};
  const put = (channel: string, line: number): void => {
    (out[channel] ??= new Set()).add(line);
  };
  const finish = (): Record<string, number[]> => {
    const result: Record<string, number[]> = {};
    for (const [channel, set] of Object.entries(out)) result[channel] = [...set].sort((a, b) => a - b);
    return result;
  };
  const channelsOf = (line: number): readonly string[] => {
    const owner = channelOf(line);
    return typeof owner === 'string' ? [owner] : owner.length === 0 ? [''] : owner;
  };
  if (cp.re.references.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      if (isLoopLine(tokenizeLine(lines[i], cp).tokens)) for (const channel of channelsOf(i + 1)) put(channel, i + 1);
    }
    return finish();
  }
  const addresses = referenceAddresses(cp);
  const labels = labelsOf(lines, cp);
  const byText = comparesByText(cp);
  const numbers = new Map<string, number[]>(); // `${channel}	${key}` -> lines
  const names = new Map<string, number[]>();
  const jumps: { line: number; channel: string; key: BlockKey | null; name: string | null }[] = [];
  const add = (map: Map<string, number[]>, k: string, line: number): void => {
    const list = map.get(k);
    if (list) list.push(line);
    else map.set(k, [line]);
  };
  const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tokens = tokenizeLine(line, cp).tokens;
    // A line of a shared section is in each of its channels; outside every section it is in ''.
    const channelsHere = channelsOf(i + 1);
    const loopLine = isLoopLine(tokens);
    for (const channel of channelsHere) {
      if (loopLine) put(channel, i + 1);
      for (const tok of tokens) {
        if (tok.kind === 'blockNumber' && tok.valueText !== undefined) {
          const key = blockKeyOf(tok.valueText, byText);
          if (key !== null) add(numbers, `${channel}\t${String(key)}`, i + 1);
        } else if (tok.kind === 'label' && tok.address !== undefined) {
          add(names, `${channel}\t${tok.address.toUpperCase()}`, i + 1);
        }
      }
      for (const w of referencesOn(tokens, line, cp, addresses, labels)) jumps.push({ line: i + 1, channel, key: w.key, name: null });
      // A jump to a label of the file: `referencesOn` leaves those out on purpose.
      const masked = maskedOf(line, tokens);
      for (let k = 0; k < tokens.length; k++) {
        const tok = tokens[k];
        if ((tok.kind !== 'keyword' && tok.kind !== 'word') || tok.address === undefined || !addresses.has(tok.address)) continue;
        const next = tokens[k + 1]?.kind === 'whitespace' ? tokens[k + 2] : tokens[k + 1];
        if (next === undefined || next.kind !== 'unknown' || !IDENT.test(next.text) || !labels.has(next.text.toUpperCase())) continue;
        if (!cp.re.references.some((r) => r.addresses.includes(tok.address as string) && r.trigger.test(masked))) continue;
        jumps.push({ line: i + 1, channel, key: null, name: next.text.toUpperCase() });
      }
    }
  }
  for (const j of jumps) {
    const targets = j.key !== null ? numbers.get(`${j.channel}\t${String(j.key)}`) : j.name !== null ? names.get(`${j.channel}\t${j.name}`) : undefined;
    if (targets === undefined) continue;
    for (const target of targets) {
      put(j.channel, target);
      if (target <= j.line) put(j.channel, j.line);
    }
  }
  return finish();
}

/** The service, plus the hooks that are not part of the §7.3 contract. */
export type OutlineServiceInternals = OutlineService & {
  /** Installs the listeners; the returned disposer drops them and every index. */
  start(): Disposable;
  /**
   * The items as they are right now, debounce and all bypassed. The Monaco providers use
   * this: Monaco asks for symbols and folding ranges with its own delay already, and
   * answering with a 150 ms old tree would fold the wrong lines.
   */
  snapshot(id: DocId): OutlineItem[];
};

export function createOutlineService(deps: OutlineServiceDeps): OutlineServiceInternals {
  const entries = new Map<DocId, Entry>();
  let stops: Disposable[] = [];
  let installed = false;
  const now = deps.now ?? (() => performance.now());
  const budget = deps.budgetMs ?? BUILD_BUDGET_MS;
  /** The scheduler of the build's slices: idle time, or the next turn where the deps give no idle clock. */
  const later = (fn: () => void): Disposable => (deps.idle !== undefined ? deps.idle(fn) : deps.schedule(fn, 0));

  function install(): void {
    if (installed) return;
    installed = true;
    stops = [
      deps.editor.onDidChangeContent((id, change) => {
        const entry = entries.get(id);
        if (!entry) return;
        if (change.flush) {
          rebuild(id, entry);
          return;
        }
        if (entry.build !== null) {
          const built = entry.build.next; // the first line the build has not read yet
          if (change.startLine >= built) return; // below the prefix: the build reads it
          if (change.endLineOld >= built) {
            rebuild(id, entry); // straddles the boundary
            return;
          }
          entry.build.next += change.endLineNew - change.endLineOld;
        }
        entry.index.applyChange(change.startLine, change.endLineOld, deps.editor.getLines(id, change.startLine, change.endLineNew));
        schedulePublish(entry);
      }),
      // A fresh Monaco model replaces the text the index was built from.
      deps.editor.onDidCreateModel((id) => {
        const entry = entries.get(id);
        if (entry) rebuild(id, entry);
      }),
      // Closed documents lose their index; a profile or machine change rebuilds it.
      deps.docs.list.subscribe((list) => {
        const open = new Set(list.map((doc) => doc.id));
        for (const [id, entry] of [...entries]) {
          if (!open.has(id)) drop(id, entry);
          else reindexIfChanged(id, entry);
        }
      }),
      ...(deps.channels === undefined
        ? []
        : [
            deps.channels.revision.subscribe(() => {
              // A publish that is already waiting reads the new channels when it runs; pushing it
              // back by another 150 ms would hold an edit's map back twice as long (M12 fix F1:
              // the channels re-resolve on the same 150 ms after an edit, just before the map).
              for (const entry of entries.values()) if (entry.build === null && entry.publish === null) schedulePublish(entry);
            }),
          ]),
      ...(deps.machineRevision === undefined
        ? []
        : [
            deps.machineRevision.subscribe(() => {
              for (const [id, entry] of [...entries]) reindexIfChanged(id, entry);
            }),
          ]),
      ...(deps.profileRevision === undefined
        ? []
        : [
            deps.profileRevision.subscribe(() => {
              for (const [id, entry] of [...entries]) reindexIfChanged(id, entry);
            }),
          ]),
    ];
  }

  /** Rebuilds when the document's effective view is not the one the index was built with. */
  function reindexIfChanged(id: DocId, entry: Entry): void {
    const view = deps.effective(id);
    if (view === null) return;
    if (view.key === entry.key) {
      if (view.cp === entry.cp) return;
      // A reload made a new object. Only a profile that reads differently needs a new index.
      const same = JSON.stringify(view.cp.profile) === JSON.stringify(entry.cp.profile);
      entry.cp = view.cp;
      if (same) return;
    }
    entry.key = view.key;
    entry.cp = view.cp;
    entry.index = new OutlineIndex(view.cp);
    rebuild(id, entry);
  }

  /** The effective compiled profile, or an empty one that classifies nothing. */
  function profileOf(id: DocId): CompiledProfile {
    return deps.effective(id)?.cp ?? EMPTY_PROFILE;
  }

  function drop(id: DocId, entry: Entry): void {
    entry.build?.cancel();
    entry.publish?.();
    // Nothing is going to build this document any more, so a waiter must not hang.
    entry.markReady();
    entries.delete(id);
  }

  /** The items as published: the P1 tree, or grouped by channel (M12). */
  function publishNow(entry: Entry): void {
    const items = entry.index.items();
    const set = deps.channels?.forDoc(entry.id);
    if (deps.channels === undefined || set === undefined || set.layout !== 'single-file' || set.members.length === 0) {
      entry.grouped = null;
      entry.store.set(items);
      return;
    }
    // Nothing changed since the last publish (a channel revision of another document, say).
    if (entry.grouped !== null && entry.grouped.items === items && entry.grouped.set === set) return;
    const channels = deps.channels;
    const rules = new Map<string, SyncRule>();
    for (const rule of channels.params?.(entry.id)?.syncMarks ?? []) if (!rules.has(rule.id)) rules.set(rule.id, rule);
    const fresh = groupByChannel(items, set, (hit) =>
      hit.mark !== '' ? shownMark(hit.mark, rules.get(hit.ruleId)) : channels.ruleLabel(entry.id, hit.ruleId) || hit.ruleId,
    );
    const rows = entry.grouped === null ? fresh : reuseRows(entry.grouped.rows, fresh);
    entry.grouped = { items, set, rows };
    entry.store.set(rows);
  }

  /** Publishes the aggregated items after the debounce. */
  function schedulePublish(entry: Entry): void {
    entry.publish?.();
    entry.publish = deps.schedule(() => {
      entry.publish = null;
      publishNow(entry);
    }, deps.delayMs);
  }

  /**
   * One slice of the first build: reads `chunkLines` lines at a time until the budget is spent
   * (it always reads one run, so the build moves on), then hands the main thread back and
   * continues when the app is idle again. The slice that reads the last line finishes the
   * build and publishes at once.
   */
  function step(id: DocId, entry: Entry): void {
    const build = entry.build;
    if (build === null) return;
    const started = now();
    for (;;) {
      const total = deps.editor.getLineCount(id);
      const end = Math.min(total, build.next + deps.chunkLines - 1);
      if (end >= build.next) {
        entry.index.applyChange(build.next, build.next - 1, deps.editor.getLines(id, build.next, end));
        build.next = end + 1;
      }
      if (build.next > total) {
        entry.build = null;
        entry.publish?.();
        entry.publish = null;
        publishNow(entry);
        entry.markReady();
        return;
      }
      if (now() - started >= budget) break;
    }
    build.cancel = later(() => step(id, entry));
  }

  function rebuild(id: DocId, entry: Entry): void {
    // A flush (`setValue`, reload from disk, compare) or a profile change empties the
    // index and starts over, so a `whenReady` that the *previous* build resolved must not
    // keep answering: the Monaco providers await it and would then read an empty tree and
    // drop every fold arrow. A rebuild that interrupts an unfinished build keeps the
    // promise that is still pending — re-arming it there would strand its waiters.
    if (entry.build === null) arm(entry);
    entry.build?.cancel();
    entry.index.reset([]);
    // The first chunk waits for the next turn as well, so opening a document never
    // classifies 20k lines inside the event that created it.
    entry.build = { next: 1, cancel: later(() => step(id, entry)) };
    schedulePublish(entry);
  }

  /** Gives the entry a fresh, unresolved readiness promise. */
  function arm(entry: { ready: Promise<void>; markReady: () => void }): void {
    entry.ready = new Promise<void>((resolve) => {
      entry.markReady = resolve;
    });
  }

  function ensure(id: DocId): Entry {
    install();
    const found = entries.get(id);
    if (found) return found;

    const view = deps.effective(id);
    const entry: Entry = {
      key: view?.key ?? '',
      cp: view?.cp ?? profileOf(id),
      index: new OutlineIndex(view?.cp ?? profileOf(id)),
      store: writable<OutlineItem[]>([]),
      build: null,
      ready: Promise.resolve(),
      markReady: () => {},
      publish: null,
      id,
      grouped: null,
    };
    arm(entry);
    entries.set(id, entry);
    if (deps.editor.hasModel(id)) rebuild(id, entry);
    return entry;
  }

  return {
    items(id: DocId): Readable<OutlineItem[]> {
      // Asking for the store is what starts the index: the program map asks as soon as a
      // document becomes the active one, which is the "after the first render" of AD-12.
      return ensure(id).store;
    },

    snapshot(id: DocId): OutlineItem[] {
      return ensure(id).index.items();
    },

    toolLines(id: DocId, channelId?: string): number[] {
      const lines = ensure(id).index.toolLines();
      if (channelId === undefined) return lines;
      // M12: only the lines inside that channel's ranges ("next tool change in this channel").
      const ranges = (deps.channels?.forDoc(id).members ?? []).flatMap((m) =>
        m.kind === 'section' && m.channel.id === channelId ? m.ranges : [],
      );
      return lines.filter((line) => ranges.some((r) => line >= r.startLine && line <= r.endLine));
    },

    itemAt(id: DocId, line: number): OutlineItem | null {
      return ensure(id).index.itemAt(line);
    },

    whenReady(id: DocId): Promise<void> {
      const entry = ensure(id);
      // A document whose model has not been created yet has nothing to build from; the
      // `onDidCreateModel` listener starts the build and resolves this promise.
      return entry.ready;
    },

    start(): Disposable {
      install();
      return () => {
        if (!installed) return;
        installed = false;
        for (const stop of stops.reverse()) stop();
        stops = [];
        for (const [id, entry] of [...entries]) drop(id, entry);
      };
    },
  };
}

/**
 * The fallback for a document whose profile the registry does not know (a stale id in a
 * restored session). It classifies nothing, so the map is empty instead of wrong.
 */
const EMPTY_PROFILE: CompiledProfile = {
  profile: { syntax: { comments: [] }, toolCall: { toolFrom: 'same-line' }, outline: [] } as unknown as CompiledProfile['profile'],
  flags: 'i',
  re: {
    detectContent: [],
    detectVetoes: [],
    toolTrigger: /(?!)/,
    tool: /(?!)/,
    programStart: [],
    programEnd: [],
    outline: [],
    references: [],
  },
  keywords: [],
};

/** The application-wide outline service. */
export const outline: OutlineServiceInternals = createOutlineService({
  docs: appDocs,
  editor: appEditor,
  effective: (id) => {
    const doc = appDocs.get(id);
    // A reload can remove a document's profile for the moment between the registry swap and
    // `userConfig.load` detecting the document again (AD-29): nothing to index then.
    if (doc === undefined || appProfiles.get(doc.profileId) === undefined) return null;
    const view = appMachines.effective(id);
    return { cp: view.cp, key: view.machine.key };
  },
  machineRevision: appMachines.revision,
  profileRevision: appProfiles.revision,
  channels: appChannels,
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
  idle: runWhenIdle,
  now: () => performance.now(),
  chunkLines: CHUNK_LINES,
  delayMs: AGGREGATE_DELAY_MS,
});
