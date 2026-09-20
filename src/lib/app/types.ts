// Shared contracts for the whole app (plan §7.1 and §7.2). Written by the milestone
// preludes and binding for every work package: an implementation may change, a signature
// here may not (a deviation needs a hand-off note and integration approval).
//
// This file holds *types only*, so it is erased at build time and may be imported from
// anywhere, including `core/` (AD-1 allows type-only imports there). The comment above
// each group names the module that exports the matching value; a type has exactly one
// home and is imported only from it.
//
// Types that arrive in a later milestone live in their own home file and are imported
// here: `Profile`/`CompiledProfile` (core/profiles/types.ts, P3), `FieldSpec`
// (core/forms/types.ts, P2), `Settings` (core/settings/schema.ts, P2), `NcToken`
// (core/nc/types.ts, P3), the code database types (core/codes/types.ts, P3),
// `OutlineItem` (core/profiles/outline.ts, P3), `TransformDef`/`TransformResult`
// (core/transforms/types.ts, P4) and the wire types of the Rust commands
// (platform/commands.ts). The §7.3 service contracts for M5 (scripts) are added to this
// file by the P5 prelude, together with `AppContext`'s fields.

import type { Component } from 'svelte';
import type { Readable } from 'svelte/store';
import type { CodeDb, CodeEntry, CodeLookup } from '$lib/core/codes/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { NcToken } from '$lib/core/nc/types';
import type { Settings } from '$lib/core/settings/schema';
import type { OutlineItem } from '$lib/core/profiles/outline';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { TransformDef, TransformResult } from '$lib/core/transforms/types';
import type { ConfigPaths, RecentEntry } from '$lib/platform/commands';

// ---------------------------------------------------------------------------
// §7.1 Registries and contributions
// ---------------------------------------------------------------------------

/** Undoes a registration. Calling it twice must be harmless. */
export type Disposable = () => void;

/** A translatable message: an i18n key plus its placeholder values. */
export interface Msg {
  key: string;
  params?: Record<string, string | number>;
}

/** A message tied to a line of a document (transform skips, script findings, ...). */
export interface Located {
  line: number;
  message: string;
  severity?: 'info' | 'warning' | 'error';
  document?: string;
}

/** `t()` from `$lib/i18n`, as a dependency. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The state a command's `enabled` and `run` see. Rebuilt by the context provider on every read. */
export interface CommandContext {
  activeDocId: string | null;
  profileId: string | null;
  hasSelection: boolean;
  editorFocused: boolean;
  compareOpen: boolean;
  modalOpen: boolean;
  scriptRunning: boolean;
}

/**
 * A shortcut, e.g. 'Mod+S', 'Ctrl+G', 'F7', 'Shift+F7', 'Mod+Alt+S', 'Mod+,'.
 * `Mod` is Cmd on macOS and Ctrl elsewhere; `Ctrl` is always the literal Control key.
 */
export type KeySpec = string;

export interface CommandDef {
  /** Stable dotted id, e.g. 'file.save'. The palette action id is `'gedit.' + id`. */
  id: string;
  /** i18n key. */
  title: string;
  /** i18n key; the palette label is `${t(category)}: ${t(title)}`. */
  category?: string;
  icon?: Component;
  keys?: KeySpec | { mac?: KeySpec; other?: KeySpec };
  /** Also dispatched by the window handler when focus is outside Monaco. */
  global?: boolean;
  /** Registered as a Monaco editor action; default true. */
  palette?: boolean;
  /** Default: always enabled. */
  enabled?: (c: CommandContext) => boolean;
  run: (c: CommandContext, arg?: unknown) => unknown | Promise<unknown>;
}

export type RibbonTab = 'home' | 'insert' | 'nc' | 'tools' | 'view';

export interface RibbonItemDef {
  tab: RibbonTab;
  /** i18n key of the group caption. */
  group: string;
  /** Command id. */
  command: string;
  order: number;
  size?: 'large' | 'small';
}

/** A ribbon group that renders its own component instead of command buttons. */
export interface RibbonGroupDef {
  tab: RibbonTab;
  group: string;
  order: number;
  component: Component;
}

export type PanelRegion = 'left' | 'bottom' | 'overlay' | 'banner';

export interface PanelDef {
  id: string;
  region: PanelRegion;
  /** i18n key. */
  title: string;
  icon?: Component;
  component: Component;
  order: number;
}

export interface StatusItemDef {
  id: string;
  side: 'left' | 'right';
  order: number;
  component: Component;
}

/**
 * One feature, in `src/lib/contrib/<name>.ts`:
 * `export default { id: '<name>', ... } satisfies Contribution;`
 * See `src/lib/contrib/README.md`.
 */
export interface Contribution {
  id: string;
  commands?: CommandDef[];
  ribbon?: RibbonItemDef[];
  ribbonGroups?: RibbonGroupDef[];
  panels?: PanelDef[];
  statusItems?: StatusItemDef[];
  /** Default Monaco bindings to drop, e.g. `{ keys: 'F2', command: 'editor.action.rename' }`. */
  keybindingRemovals?: { keys: KeySpec; command: string }[];
  activate?(): void | Disposable | Promise<void | Disposable>;
}

export interface CommandRegistry {
  /** Duplicate id throws; a key conflict logs `console.error`. */
  register(defs: CommandDef | CommandDef[]): Disposable;
  has(id: string): boolean;
  get(id: string): CommandDef | undefined;
  list(): CommandDef[];
  isEnabled(id: string): boolean;
  /** False when the id is unknown or the command is disabled (a status message is shown); an error becomes a status error plus `console.error`. */
  run(id: string, arg?: unknown): Promise<boolean>;
  context(): CommandContext;
  /** Bumps on (un)register and on context changes. */
  readonly changed: Readable<number>;
}

export interface RibbonRegistry {
  add(items: RibbonItemDef[]): Disposable;
  addGroup(g: RibbonGroupDef): Disposable;
  readonly entries: Readable<(RibbonItemDef | RibbonGroupDef)[]>;
}

export interface PanelRegistry {
  add(p: PanelDef): Disposable;
  readonly panels: Readable<PanelDef[]>;
}

export interface StatusItemRegistry {
  add(s: StatusItemDef): Disposable;
  readonly items: Readable<StatusItemDef[]>;
}

// ---------------------------------------------------------------------------
// §7.2 Documents, editor, files, dialogs, status, layout
// ---------------------------------------------------------------------------

/** 'd1', 'd2', ... never reused within a session. */
export type DocId = string;
export type Eol = 'crlf' | 'lf' | 'cr';
export type EncodingName = 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be';

/** For `utf-16le` and `utf-16be`, `hasBom` is always true. */
export interface FileEncoding {
  encoding: EncodingName;
  hasBom: boolean;
}

/** Tape leader and trailer (NUL runs kept outside the editor text) and NULs stripped from inside it. */
export interface NulInfo {
  leader: number;
  trailer: number;
  stripped: number;
}

/** What the file on disk looked like when it was last read or written. `hash` is `fnv1a32(bytes)`. */
export interface DiskStamp {
  mtimeMs: number | null;
  size: number;
  hash: number;
}

export interface CursorInfo {
  line: number;
  column: number;
  /** Characters selected across all selections (0 when nothing is selected). */
  selectedChars: number;
  /** Number of cursors / selections (1 unless multi-cursor is in use). */
  selections: number;
}

export interface DocMeta {
  id: DocId;
  path: string | null;
  untitledIndex: number | null;
  /** Derived by the store: basename(path) or `Untitled-${n}`. */
  title: string;
  /** Also the Monaco language id. */
  profileId: string;
  encoding: FileEncoding;
  eol: Eol;
  eolMixedOnLoad: boolean;
  nul: NulInfo;
  /** Written by EditorService, on flips only. */
  textDirty: boolean;
  /** Encoding or EOL change, NUL strip, keep-mine, deleted on disk. */
  metaDirty: boolean;
  /** Derived by the store: `textDirty || metaDirty`. */
  dirty: boolean;
  disk: DiskStamp | null;
  external: 'none' | 'changed' | 'deleted';
}

export type NewDocMeta = Omit<DocMeta, 'id' | 'title' | 'dirty'>;

/** stores/documents.ts → `export const docs: DocumentStore` */
export interface DocumentStore {
  /** Tab order. */
  readonly list: Readable<DocMeta[]>;
  readonly activeId: Readable<DocId | null>;
  readonly active: Readable<DocMeta | null>;
  all(): DocMeta[];
  get(id: DocId): DocMeta | undefined;
  getActiveId(): DocId | null;
  add(meta: NewDocMeta, o?: { activate?: boolean; index?: number }): DocId;
  update(id: DocId, patch: Partial<NewDocMeta>): void;
  /** Activates the right neighbour, else the left, else null. */
  remove(id: DocId): void;
  activate(id: DocId): void;
  move(id: DocId, toIndex: number): void;
  /** Case-insensitive on macOS and Windows. */
  byPath(path: string): DocMeta | undefined;
  /** Lowest free index >= 1. */
  nextUntitledIndex(): number;
}

/**
 * One spanning range per Monaco content event, 1-based inclusive, in old and new
 * coordinates. `flush` is true for setValue-like events.
 */
export interface ContentChange {
  startLine: number;
  endLineOld: number;
  endLineNew: number;
  flush: boolean;
  versionId: number;
}

/** monaco/editorService.ts → `export const editor: EditorService` */
export interface EditorService {
  attach(container: HTMLElement): Promise<void>;
  readonly ready: Promise<void>;
  createModel(id: DocId, textLF: string, languageId: string, eol: Eol): void;
  disposeModel(id: DocId): void;
  hasModel(id: DocId): boolean;
  /** LF-joined. */
  getText(id: DocId): string;
  getLineCount(id: DocId): number;
  /** 1-based inclusive. */
  getLines(id: DocId, startLine: number, endLine: number): string[];
  /** `alternativeVersionId`. */
  versionId(id: DocId): number;
  markClean(id: DocId): void;
  setLanguage(id: DocId, languageId: string): void;
  /** `pushEOL` (undoable) between crlf and lf; 'cr' keeps an LF model. */
  setModelEol(id: DocId, eol: Eol): void;
  /** One undo step. */
  replaceAll(id: DocId, textLF: string, o?: { keepCursorLine?: boolean }): void;
  /** Active document, at the selections, one undo step. */
  insertText(text: string): void;
  focus(): void;
  hasFocus(): boolean;
  /** Activates the document if needed, sets the cursor, centers and focuses. */
  reveal(id: DocId, line: number, column?: number): void;
  cursor(): CursorInfo | null;
  selectionLines(): { startLine: number; endLine: number; empty: boolean } | null;
  selectedText(): string;
  triggerAction(actionId: string, payload?: unknown): void;
  updateOptions(o: Record<string, unknown>): void;
  onDidChangeContent(cb: (id: DocId, c: ContentChange) => void): Disposable;
  onDidChangeCursor(cb: (c: CursorInfo) => void): Disposable;
  onDidCreateModel(cb: (id: DocId) => void): Disposable;
  onDidActivate(cb: (id: DocId | null) => void): Disposable;
  /** Escape hatches: only `src/lib/monaco/**` may call these. */
  model(id: DocId): import('$lib/monaco/core').editor.ITextModel | undefined;
  editorInstance(): import('$lib/monaco/core').editor.IStandaloneCodeEditor | undefined;
}

/** `text` is LF-joined; `eol` is null when the file has no line break. */
export type DecodeResult =
  | {
      ok: true;
      text: string;
      encoding: FileEncoding;
      eol: Eol | null;
      eolMixed: boolean;
      nul: NulInfo;
    }
  | { ok: false; reason: 'binary'; message: Msg };

/** `line` and `column` are 1-based (UTF-16 columns, as in Monaco). */
export type EncodeResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; badChar: string; line: number; column: number };

export interface DialogFilter {
  name: string;
  extensions: string[];
}

/** app/dialogs.ts → `export const dialogs: NativeDialogs` */
export interface NativeDialogs {
  ask3(o: {
    title: string;
    message: string;
    yes: string;
    no: string;
    cancel: string;
    kind?: 'warning' | 'info';
  }): Promise<'yes' | 'no' | 'cancel'>;
  confirm(o: {
    title: string;
    message: string;
    ok: string;
    cancel?: string;
    kind?: 'warning' | 'info';
  }): Promise<boolean>;
  error(summary: string, detail: unknown): Promise<void>;
  /** Filters per AD-7: none on macOS. */
  openFiles(o?: { multiple?: boolean }): Promise<string[]>;
  saveFile(o: { defaultPath: string; profileId?: string }): Promise<string | null>;
  pickFolder(o?: { title?: string }): Promise<string | null>;
  pickFile(o?: { title?: string }): Promise<string | null>;
  /** One chain at a time; a re-entrant call resolves `undefined`. */
  exclusive<T>(op: () => Promise<T>): Promise<T | undefined>;
}

export interface QuickPickItem<T> {
  label: string;
  description?: string;
  detail?: string;
  value: T;
}

/** app/modals.ts → `export const modals: Modals` (quickPick in M1; prompt and form in M2) */
export interface Modals {
  quickPick<T>(
    items: QuickPickItem<T>[],
    o?: { placeholder?: string; initialIndex?: number },
  ): Promise<T | undefined>;
  prompt(o: {
    title: string;
    placeholder?: string;
    initial?: string;
    /**
     * A `Msg` while the value is not acceptable, else null. A **key**, not display text:
     * `PromptInput` puts `msg.key` in `data-error`, which is what §7.9 says that attribute
     * carries everywhere else (`FormRenderer` does the same), so one runtime check works
     * against both (G8 M2).
     */
    validate?: (v: string) => Msg | null;
  }): Promise<string | undefined>;
  form(o: {
    title: string;
    fields: FieldSpec[];
    values?: Record<string, unknown>;
    okLabel?: string;
    context?: { addresses?: string[] };
  }): Promise<Record<string, unknown> | undefined>;
  open<P extends Record<string, unknown>, R>(
    c: Component<P & { close: (r?: R) => void }>,
    props: P,
  ): Promise<R | undefined>;
  readonly isOpen: Readable<boolean>;
}

/** app/fileOps.ts → `createFileOps(deps)` plus `export const files: FileOps` */
export interface FileOps {
  newUntitled(o?: { profileId?: string; text?: string; activate?: boolean }): DocId;
  /** No paths: multi-select dialog. Already-open documents are focused instead of reopened. */
  open(paths?: string[]): Promise<DocId[]>;
  save(id?: DocId): Promise<boolean>;
  saveAs(id?: DocId): Promise<boolean>;
  saveAll(): Promise<boolean>;
  close(id?: DocId): Promise<boolean>;
  closeAll(): Promise<boolean>;
  confirmQuit(): Promise<boolean>;
  setEncoding(id: DocId, e: FileEncoding): void;
  setEol(id: DocId, eol: Eol): void;
  setProfile(id: DocId, profileId: string): void;
  /** One undo step, keeps the cursor line, marks clean and restamps. */
  reloadFromDisk(id: DocId): Promise<void>;
  readDisk(path: string): Promise<DecodeResult | null>;
  onDidOpen(cb: (id: DocId, path: string) => void): Disposable;
  onDidSave(cb: (id: DocId, path: string) => void): Disposable;
  onWillQuit(cb: () => Promise<void> | void): Disposable;
}

/** app/status.ts → `export const status: StatusService` */
export interface StatusService {
  readonly current: Readable<{ text: string; error: boolean; detail?: string } | null>;
  /** `text` is already translated. Messages clear after 4 s, errors after 8 s. */
  show(text: string, o?: { error?: boolean; sticky?: boolean; detail?: string }): void;
  clear(): void;
}

export interface LayoutState {
  left: { visible: boolean; width: number; active: string | null };
  bottom: { visible: boolean; height: number; active: string | null };
  overlay: string | null;
}

/** stores/layout.ts → `export const layout: LayoutStore` */
export interface LayoutStore {
  readonly state: Readable<LayoutState>;
  show(panelId: string): void;
  hide(region: 'left' | 'bottom'): void;
  toggle(region: 'left' | 'bottom'): void;
  setSize(region: 'left' | 'bottom', px: number): void;
  openOverlay(panelId: string): void;
  closeOverlay(): void;
  restore(s: Partial<LayoutState>): void;
}

export interface ProfileInfo {
  id: string;
  name: string;
  shortName: string;
  extensions: string[];
  defaultFileName: string;
  newFileEol: Eol;
}

/** stores/profiles.ts → `export const profiles: ProfileRegistry` (M1 adapter, M3 real) */
export interface ProfileRegistry {
  readonly all: Readable<ProfileInfo[]>;
  list(): ProfileInfo[];
  get(id: string): ProfileInfo | undefined;
  defaultId(): string;
  detect(path: string | null, text: string, fallback: string): string;
  /** `[]` on macOS (F7). */
  openFilters(): DialogFilter[];
  saveFilters(id: string): DialogFilter[];
  /** The profile as it was read from JSON. Implemented by WP3.1; throws until then. */
  profile(id: string): Profile;
  /** The compiled profile every NC feature reads. Implemented by WP3.1; throws until then. */
  compiled(id: string): CompiledProfile;
}

// ---------------------------------------------------------------------------
// §7.3 Services added in M2: settings, UI state, recent files, external changes, compare
// ---------------------------------------------------------------------------

/** stores/settings.ts → `export const settings: SettingsStore` (owner: WP2.6) */
export interface SettingsStore {
  /** The effective values: `DEFAULTS` with the user's valid values applied. */
  readonly values: Readable<Settings>;
  get<K extends keyof Settings>(k: K): Settings[K];
  /** Called once by `bootstrap`, before the contributions load. Never throws. */
  load(): Promise<{ error?: string; warnings: string[] }>;
  /** Applies `patch` and writes only the non-default values, with sorted keys and `$version`. */
  save(patch: Partial<Settings>): Promise<void>;
  /** Puts `keys` back to their defaults and writes the file ("Reset category"). */
  reset(keys: (keyof Settings)[]): Promise<void>;
  /** Re-reads the file, for when the user saved `settings.json` as a document (WP2.7). */
  reloadFromDisk(): Promise<void>;
  /** Where the app's files live; null until `load()` has answered. */
  readonly paths: Readable<ConfigPaths | null>;
}

/** The `ui` member of `state.json` (plan §7.7). The webview owns it; Rust merges it in. */
export interface UiState {
  layout: Partial<LayoutState>;
  /** Last-used form values, by form key: `transform:<id>`, `script:<scriptId>`, ... */
  lastParams: Record<string, Record<string, unknown>>;
  lastScript: string | null;
}

/** stores/uiState.ts → `export const uiState: UiStateStore` (owner: WP2.3) */
export interface UiStateStore {
  readonly state: Readable<UiState>;
  /** Called once by `bootstrap`, before the contributions load. Never throws. */
  load(): Promise<void>;
  /** Replaces the state and schedules a save 1 s later, so dragging a splitter writes once. */
  update(fn: (s: UiState) => UiState): void;
  getLastParams(key: string): Record<string, unknown> | undefined;
  setLastParams(key: string, v: Record<string, unknown>): void;
  /** Writes a pending change now; `files.onWillQuit` awaits this. */
  flush(): Promise<void>;
}

/** stores/recent.ts → `export const recent: RecentService` (owner: WP2.3) */
export interface RecentService {
  readonly list: Readable<RecentEntry[]>;
  refresh(): Promise<void>;
  /** Only for a path the fs scope already allows; Rust refuses anything else (AD-9). */
  touch(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  clear(): Promise<void>;
}

/** app/external.ts → `export const external: ExternalChangeService` (owner: WP2.3) */
export interface ExternalChangeService {
  /** Starts the poll (2 s while the window has focus, plus focus and visibility events). */
  start(): Disposable;
  checkNow(): Promise<void>;
  /** Re-reads the file as one undo step, keeping the cursor line. */
  reload(id: DocId): Promise<void>;
  /** Keeps the buffer, sets `metaDirty` and restamps, so the banner does not come back. */
  keepMine(id: DocId): void;
}

/** What the modified side of a comparison is held against. */
export type CompareSource =
  | { kind: 'document'; docId: DocId }
  | { kind: 'file'; path: string }
  | { kind: 'saved' };

/** app/compare.ts → `export const compare: CompareService` (owner: WP2.5) */
export interface CompareService {
  /** The open comparison, or null. `title` is already translated. */
  readonly session: Readable<{ docId: DocId; source: CompareSource; title: string } | null>;
  /** False when the comparison cannot be built: over 50 MB (F8), missing file, ... */
  open(docId: DocId, source: CompareSource): Promise<boolean>;
  /** Disposes any temporary model and restores the editor's view state. */
  close(): void;
}

// ---------------------------------------------------------------------------
// §7.3 Services added in M3: the code database and the outline
// ---------------------------------------------------------------------------

/**
 * stores/codes.ts → `export const codes: CodeDbService` (owner: WP3.3)
 *
 * One database per dialect, shared by every profile that names it in `profile.codes`.
 * Files are loaded once and cached, so a hover is a map lookup.
 */
export interface CodeDbService {
  /** The database the profile points at; it is always there, if only empty. */
  forProfile(profileId: string): CodeDb;
  /** What the database knows about one token of a block (hover, inspector). */
  lookupWord(profileId: string, token: NcToken): CodeLookup | null;
  /** Entries whose code starts with `prefix`; `atBlockStart` gates Klartext keywords. */
  completions(profileId: string, prefix: string, atBlockStart: boolean): CodeEntry[];
  /** The flat list handed to a script's context (M4). */
  forScripts(profileId: string): CodeEntry[];
}

/**
 * app/outlineService.ts → `export const outline: OutlineService` (owner: WP3.5)
 *
 * Holds one `OutlineIndex` per open document. The first build runs after the first
 * render, in 20k-line chunks; `applyChange` runs on every content change and the
 * aggregation is debounced by 150 ms, so typing never waits for the map.
 */
export interface OutlineService {
  /** The program map's rows for a document; empty until the first build finishes. */
  items(id: DocId): Readable<OutlineItem[]>;
  /** The tool-change lines, ascending (F7 / Shift+F7). */
  toolLines(id: DocId): number[];
  /** The item that covers `line`, for the row the map highlights. */
  itemAt(id: DocId, line: number): OutlineItem | null;
  /** Resolves once the first full build for `id` is done (tests and the harness). */
  whenReady(id: DocId): Promise<void>;
}

// ---------------------------------------------------------------------------
// §7.3 Services added in M4: transforms, results and bookmarks
// ---------------------------------------------------------------------------

/**
 * app/transforms.ts → `export const transforms: TransformService` (owner: WP4.1)
 *
 * The whole of "run a transform", in one place, so that every transform behaves the same
 * and no `contrib/` file re-implements the sequence:
 *
 *  1. `def.available(cp)` — a `Msg` goes to the status bar and nothing else happens.
 *  2. `def.options(cp)` — the form, pre-filled from `uiState.lastParams['transform:'+id]`;
 *     cancel means cancel. Skipped when there are no options or `skipForm` is set.
 *  3. `def.preflight(lines, ctx)` — a `Msg` becomes a confirmation dialog.
 *  4. `def.run(lines, ctx)` on the scope (the selection extended to whole lines, or the
 *     whole document).
 *  5. The output: replace the scope as **one undo step** (`applyLines`), or open a new
 *     untitled document with the same profile holding only the transformed lines.
 *  6. `result.summary` in the status bar.
 *  7. `result.skipped` and `result.warnings` in the Results panel.
 *
 * It answers `null` when nothing ran: unavailable, the form was cancelled, or the
 * preflight was declined.
 */
export interface TransformService {
  run(
    def: TransformDef,
    o?: {
      /** Default `replace`. */
      target?: 'replace' | 'new-document';
      /** Skips the remembered values as well as the form when `skipForm` is set. */
      options?: Record<string, unknown>;
      skipForm?: boolean;
    },
  ): Promise<TransformResult | null>;
}

/**
 * A table plus findings, shown in the Results panel. It is what a transform's skipped
 * lines, a script's `report` output and (later) find-all all turn into.
 *
 * A row or finding that carries `line` is clickable: the panel reveals it, switching
 * document by `docId`, or by matching `Located.document` against the open documents'
 * names when the report came from a script that named them.
 */
export interface ReportData {
  /** Already-translated display text; script reports bring their own (AD-14). */
  title: string;
  message?: string;
  /** Display order; `key` indexes into each row. */
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  findings?: Located[];
  /** The document the lines refer to; the active one when it is missing. */
  docId?: DocId;
}

/** stores/results.ts → `export const results: ResultsService` (owner: WP4.1) */
export interface ResultsService {
  /** The report on show, or null when the panel is empty. */
  readonly current: Readable<ReportData | null>;
  /** Replaces what the panel shows; the caller decides whether to reveal the panel. */
  show(r: ReportData): void;
  clear(): void;
}

/**
 * monaco/bookmarks.ts → `export const bookmarks: BookmarkService` (owner: WP4.4)
 *
 * Whole-line decorations, one set per model, session only (nothing is written to disk).
 * They are `NeverGrowsWhenTypingAtEdges`, and because transforms apply minimal edits
 * (AD-12), a bookmark on a line a transform did not touch survives the run.
 *
 * Every argument defaults to "the active document" and "the cursor's line". `next` and
 * `prev` wrap around the ends.
 */
export interface BookmarkService {
  toggle(id?: DocId, line?: number): void;
  next(): void;
  prev(): void;
  clear(id?: DocId): void;
  /** Ascending, 1-based. Empty for a document with no bookmarks or no model. */
  lines(id: DocId): number[];
}

/**
 * app/context.ts → `export const ctx: AppContext`
 *
 * The aggregate the test hook exposes (§7.9). It only collects the singletons; features
 * import the service modules they need directly. The P5 prelude adds `scripts`.
 */
export interface AppContext {
  commands: CommandRegistry;
  ribbon: RibbonRegistry;
  panels: PanelRegistry;
  statusItems: StatusItemRegistry;
  docs: DocumentStore;
  editor: EditorService;
  files: FileOps;
  dialogs: NativeDialogs;
  modals: Modals;
  status: StatusService;
  layout: LayoutStore;
  profiles: ProfileRegistry;
  t: Translate;
  // P2
  settings: SettingsStore;
  uiState: UiStateStore;
  recent: RecentService;
  external: ExternalChangeService;
  compare: CompareService;
  // P3
  codes: CodeDbService;
  outline: OutlineService;
  // P4
  transforms: TransformService;
  results: ResultsService;
  bookmarks: BookmarkService;
}
