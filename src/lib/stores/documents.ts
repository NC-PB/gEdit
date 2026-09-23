// The open documents (plan §7.2, AD-2/D12): tab order, the active document and the
// per-document metadata the tab bar, the status bar and the file operations read.
//
// A plain `svelte/store` module, never a `.svelte.ts` class: it can be imported from
// anywhere, tested in node without the Svelte compiler, and it never deep-proxies a
// Monaco object. Monaco models live in `monaco/editorService.ts` and are keyed by the
// `DocId` handed out here.
//
// Derived fields are owned by the store: `title` (basename or `Untitled-<n>`) and
// `dirty` (`textDirty || metaDirty`). `textDirty` is written by the editor service on
// flips only; everything else is written by the file operations.

import { derived, writable, type Readable } from 'svelte/store';
import { baseName, isMacPlatform, isWindowsPlatform } from '$lib/utils/platform';
import type { DocId, DocMeta, DocumentStore, NewDocMeta } from '$lib/app/types';

/** Prefix of a document that has never been saved; the store appends `-<index>`. */
const UNTITLED = 'Untitled';

export interface DocumentStoreDeps {
  /**
   * True when two paths that differ only in case are the same file (macOS, Windows).
   * Injected so a test can pin the rule instead of depending on the host platform.
   */
  caseInsensitivePaths: boolean;
  /** True where `\` separates path segments (Windows); elsewhere it is a legal file name character. */
  backslashSeparator?: boolean;
}

/**
 * The comparison key of a path: separators collapsed, `.` segments and a trailing
 * separator removed. Two spellings of one file would otherwise open two tabs that each
 * believe they own it, and the second save would silently discard the first (G8).
 *
 * Purely lexical, and deliberately so. `..` is left alone: resolving it without asking
 * the file system is wrong across a symlinked directory, and a wrong *merge* is worse
 * than a missed one — it would hand two different files to a single tab. Full identity
 * needs a canonical path from Rust, which is M2 work.
 */
export function pathKey(path: string, o: { backslashSeparator?: boolean } = {}): string {
  let value = o.backslashSeparator ? path.replace(/\\/g, '/') : path;
  value = value.replace(/^\.\//, ''); // `./prog.nc` is `prog.nc`
  // A leading `//` is a UNC share root and stays; everything else collapses.
  const unc = value.startsWith('//') && !value.startsWith('///');
  value = value.replace(/\/{2,}/g, '/');
  value = value.replace(/\/\.(?=\/)/g, '').replace(/(^|\/)\.$/, '$1');
  value = value.replace(/\/{2,}/g, '/');
  if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
  return unc ? `/${value}` : value;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * `basename(path)`, or `Untitled-<n>` for a document that has no path yet.
 *
 * `proposedPath` sits between the two (M7, AD-21): a restored crash snapshot that could
 * not be bound to its file is untitled, but it is not nameless — the tab has to read
 * `Welle.nc`, or the one thing that says which program the recovered text belongs to is
 * gone. It is deliberately **only** a name here; nothing in the app treats it as a path,
 * because `path` is still null.
 */
function titleOf(meta: Pick<NewDocMeta, 'path' | 'untitledIndex' | 'proposedPath'>): string {
  if (meta.path) return baseName(meta.path);
  if (meta.proposedPath) return baseName(meta.proposedPath);
  return meta.untitledIndex === null ? UNTITLED : `${UNTITLED}-${meta.untitledIndex}`;
}

export function createDocumentStore(deps: DocumentStoreDeps): DocumentStore {
  const key = (p: string): string => {
    const normalized = pathKey(p, { backslashSeparator: deps.backslashSeparator });
    return deps.caseInsensitivePaths ? normalized.toLowerCase() : normalized;
  };

  // `items` and `current` mirror the stores so that the synchronous readers (`all`,
  // `get`, `byPath`, `getActiveId`) never have to subscribe. Every mutation replaces
  // `items` with a new array and pushes it, so subscribers see immutable snapshots.
  let items: DocMeta[] = [];
  let current: DocId | null = null;
  let nextId = 1;

  const list = writable<DocMeta[]>(items);
  const activeId = writable<DocId | null>(current);
  const active: Readable<DocMeta | null> = derived([list, activeId], ([$list, $activeId]) =>
    $activeId === null ? null : ($list.find((d) => d.id === $activeId) ?? null),
  );

  function publish(next: DocMeta[]): void {
    items = next;
    list.set(items);
  }

  function setActive(id: DocId | null): void {
    if (current === id) return;
    current = id;
    activeId.set(id);
  }

  function indexOf(id: DocId): number {
    return items.findIndex((d) => d.id === id);
  }

  return {
    list: { subscribe: list.subscribe },
    activeId: { subscribe: activeId.subscribe },
    active,

    all(): DocMeta[] {
      return items;
    },

    get(id: DocId): DocMeta | undefined {
      return items.find((d) => d.id === id);
    },

    getActiveId(): DocId | null {
      return current;
    },

    add(meta: NewDocMeta, o?: { activate?: boolean; index?: number }): DocId {
      const id = `d${nextId++}`;
      const doc: DocMeta = {
        ...meta,
        id,
        title: titleOf(meta),
        dirty: meta.textDirty || meta.metaDirty,
      };
      const at = clamp(o?.index ?? items.length, 0, items.length);
      publish([...items.slice(0, at), doc, ...items.slice(at)]);
      if (o?.activate !== false) setActive(id);
      return id;
    },

    /** Unknown ids and patches that change nothing are ignored (no store notification). */
    update(id: DocId, patch: Partial<NewDocMeta>): void {
      const at = indexOf(id);
      if (at < 0) return;
      const previous = items[at];
      const before = previous as unknown as Record<string, unknown>;
      const changes: Record<string, unknown> = {};
      let changed = false;
      for (const [key, value] of Object.entries(patch)) {
        // An explicit `undefined` means "not part of this patch", never "clear the field".
        if (value === undefined || Object.is(before[key], value)) continue;
        changes[key] = value;
        changed = true;
      }
      if (!changed) return;
      const doc = { ...previous, ...changes } as DocMeta;
      doc.title = titleOf(doc);
      doc.dirty = doc.textDirty || doc.metaDirty;
      publish(items.map((d, i) => (i === at ? doc : d)));
    },

    /** Activates the right neighbour, else the left one, else nothing. */
    remove(id: DocId): void {
      const at = indexOf(id);
      if (at < 0) return;
      const wasActive = current === id;
      publish(items.filter((d) => d.id !== id));
      if (wasActive) setActive((items[at] ?? items[at - 1])?.id ?? null);
    },

    activate(id: DocId): void {
      if (indexOf(id) < 0) return;
      setActive(id);
    },

    move(id: DocId, toIndex: number): void {
      const from = indexOf(id);
      if (from < 0) return;
      const to = clamp(toIndex, 0, items.length - 1);
      if (to === from) return;
      const next = items.slice();
      const [doc] = next.splice(from, 1);
      next.splice(to, 0, doc);
      publish(next);
    },

    byPath(path: string): DocMeta | undefined {
      const wanted = key(path);
      return items.find((d) => d.path !== null && key(d.path) === wanted);
    },

    nextUntitledIndex(): number {
      const used = new Set(items.map((d) => d.untitledIndex));
      let index = 1;
      while (used.has(index)) index++;
      return index;
    },
  };
}

/** The application-wide document store. */
export const docs: DocumentStore = createDocumentStore({
  caseInsensitivePaths: isMacPlatform() || isWindowsPlatform(),
  backslashSeparator: isWindowsPlatform(),
});
