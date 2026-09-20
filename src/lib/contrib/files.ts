// The file feature: the New/Open/Save/Close commands, the Home "File" ribbon group, the
// window title, the close guard and drag and drop (plan §5 WP1.6, §7.11).
// One feature per file (plan AD-3); see ./README.md.
//
// Everything here goes through `app/fileOps.ts`; this file only wires it to the command
// registry, the window and the webview.
//
// Shortcuts are §7.11 verbatim. `Mod+Shift+W` is the webview's half of the macOS menu's
// Close Window item: muda cannot express a Shift accelerator there without stealing Cmd+W
// (WP1.4 D-WP1.4-1), so the menu item carries no accelerator and this command does.

import FilePlus from 'lucide-svelte/icons/file-plus';
import FileX from 'lucide-svelte/icons/file-x';
import Files from 'lucide-svelte/icons/files';
import FolderOpen from 'lucide-svelte/icons/folder-open';
import Save from 'lucide-svelte/icons/save';
import SaveAll from 'lucide-svelte/icons/save-all';
import FileStatus from '$lib/components/status/FileStatus.svelte';
import { asIcon } from '$lib/app/icons';
import { files } from '$lib/app/fileOps';
import { dialogs } from '$lib/app/dialogs';
import { status } from '$lib/app/status';
import { filesStat } from '$lib/platform/commands';
import { docs } from '$lib/stores/documents';
import { isTauriRuntime } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { Contribution, Disposable, DocId } from '$lib/app/types';
import type { FileStat } from '$lib/platform/commands';

/**
 * The program the app has always started with. A brand-new document (`file.new`) is
 * empty; only the buffer the window opens with carries it, which is what the M0 runtime
 * scenarios read.
 */
const STARTER_TEXT = '% \nO1000\nG0 X0 Y0\nM30 \n%';

/** `file.close` takes the document id from the tab bar; anything else means "the active one". */
function docArg(arg: unknown): DocId | undefined {
  return typeof arg === 'string' && arg.length > 0 ? arg : undefined;
}

/**
 * One file operation at a time. Every command below opens a native dialog somewhere along
 * its path, and `dialogs.exclusive` is the same lock the close guard takes: a second
 * Cmd+S while the save dialog is up does nothing, and a quit request while a dialog chain
 * is running keeps the window (it resolves `undefined`, never `true`).
 *
 * The lock is taken here, at the command boundary, and never inside `app/fileOps.ts`,
 * where `close()` calls `save()` and would otherwise block on itself.
 */
function once<T>(op: () => Promise<T>): Promise<T | undefined> {
  return dialogs.exclusive(op);
}

// ---------------------------------------------------------------------------
// The window title
// ---------------------------------------------------------------------------

/**
 * "● program.nc — gEdit". Set on both the document and the window: the document title is
 * what a plain browser shows, the window title what macOS puts in the title bar.
 */
function installTitle(): Disposable {
  let applied = '';
  const apply = (title: string): void => {
    if (title === applied) return;
    applied = title;
    if (typeof document !== 'undefined') document.title = title;
    if (!isTauriRuntime()) return;
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
      .catch((err: unknown) => console.error('Could not set the window title', err));
  };
  return docs.active.subscribe((doc) => {
    if (!doc) return;
    apply(doc.dirty ? t('files.windowTitleDirty', { name: doc.title }) : t('files.windowTitle', { name: doc.title }));
  });
}

// ---------------------------------------------------------------------------
// Quitting
// ---------------------------------------------------------------------------

/**
 * The one path out of the window: ask about unsaved changes, run the `onWillQuit`
 * handlers, then `destroy()`.
 *
 * `destroy()` rather than `close()`: the capability set grants `core:window:allow-destroy`
 * and deliberately not `core:window:allow-close`, and `close()` would re-enter the
 * close-requested guard below.
 */
async function closeWindow(): Promise<void> {
  // `exclusive` resolves undefined when another dialog chain already owns the screen.
  const mayQuit = await dialogs.exclusive(() => files.confirmQuit());
  if (mayQuit !== true) return;
  await files.runWillQuit();
  if (!isTauriRuntime()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().destroy();
}

/**
 * Cmd+Q, the red button and the menu all arrive as `CloseRequested`. The default is
 * prevented first, so that nothing closes while the alert is up; `closeWindow()` then
 * owns the decision.
 */
async function installCloseGuard(): Promise<Disposable> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    await closeWindow();
  });
}

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

/** What the drop handler needs, injected so a unit test needs no webview (G8 F2/F3). */
export interface DropDeps {
  stat(paths: string[]): Promise<FileStat[]>;
  open(paths: string[]): Promise<unknown>;
  error(summary: string, detail: unknown): Promise<void>;
  show(text: string, o?: { error?: boolean }): void;
}

const dropDeps: DropDeps = {
  stat: filesStat,
  open: (paths) => files.open(paths),
  error: (summary, detail) => dialogs.error(summary, detail),
  show: (text, o) => status.show(text, o),
};

/**
 * `tauri-plugin-fs` has already granted every dropped path in its own `on_event`, before
 * this event reaches JS (F2), so the paths can be read straight away. `files_stat` sorts
 * them into three buckets: files to open, folders — ignored with a message rather than
 * opened recursively — and paths this app cannot reach.
 *
 * The third bucket is not empty in practice. The plugin grants a dropped path exactly as
 * it was written, while `Scope::is_allowed` canonicalizes first, so a dropped symlink
 * comes back `allowed: false`; a file deleted between the drop and the stat comes back
 * `exists: false`. Both used to fall out of every filter and the drop did nothing at all.
 */
export async function openDropped(paths: string[], deps: DropDeps = dropDeps): Promise<void> {
  if (paths.length === 0) return;
  let stats;
  try {
    stats = await deps.stat(paths);
  } catch (err) {
    await deps.error(t('files.dropFailed'), err);
    return;
  }
  const wanted = stats.filter((s) => s.allowed && s.exists && !s.isDir).map((s) => s.path);
  const folders = stats.filter((s) => s.allowed && s.isDir).length;
  const refused = stats.filter((s) => !s.allowed || !s.exists).length;
  if (wanted.length > 0) await deps.open(wanted);

  const notices: string[] = [];
  if (folders > 0) notices.push(t('files.folderIgnored', { count: folders }));
  if (refused > 0) notices.push(t('files.dropRefused', { count: refused }));
  // A refusal is a failure whatever else came through; an ignored folder only when it was
  // the whole drop.
  if (notices.length > 0) {
    deps.show(notices.join(' · '), { error: refused > 0 || wanted.length === 0 });
  }
}

/**
 * What a `drop` event does. It takes the same lock every file command takes: a drop must
 * not run a dialog chain, or change the document set, while the close or quit guard owns
 * the screen — "Save All" re-reads `docs.all()` and would write a file the question never
 * named (G8 F2). A drop that arrives while a chain is running is dropped, like a second
 * Cmd+S.
 */
export function dropHandler(deps: DropDeps = dropDeps): (paths: string[]) => void {
  return (paths) => void once(() => openDropped(paths, deps));
}

async function installDrop(): Promise<Disposable> {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const handle = dropHandler();
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') handle(event.payload.paths);
  });
}

/**
 * Installs the two window listeners without holding startup up for two IPC round trips.
 * The disposer works whether or not they have arrived yet.
 */
function installWindowListeners(): Disposable {
  // A plain browser has no window to guard and no native drop to listen for.
  if (!isTauriRuntime()) return () => {};
  let disposed = false;
  const pending: Disposable[] = [];
  const track = (install: () => Promise<Disposable>, failure: string): void => {
    void install().then(
      (off) => {
        if (disposed) off();
        else pending.push(off);
      },
      (err: unknown) => void dialogs.error(failure, err),
    );
  };
  track(installCloseGuard, t('files.guardFailed'));
  track(installDrop, t('files.dropFailed'));
  return () => {
    disposed = true;
    for (const off of pending.splice(0)) off();
  };
}

// ---------------------------------------------------------------------------

/** Every file command needs a document; only Save All is happy with a clean one. */
const hasDoc = (c: { activeDocId: string | null }): boolean => c.activeDocId !== null;

export default {
  id: 'files',
  commands: [
    {
      id: 'file.new',
      title: 'files.new',
      category: 'files.category',
      icon: asIcon(FilePlus),
      keys: 'Mod+N',
      global: true,
      run: () => void files.newUntitled(),
    },
    {
      id: 'file.open',
      title: 'files.open',
      category: 'files.category',
      icon: asIcon(FolderOpen),
      keys: 'Mod+O',
      global: true,
      run: () => once(() => files.open()),
    },
    {
      id: 'file.save',
      title: 'files.save',
      category: 'files.category',
      icon: asIcon(Save),
      keys: 'Mod+S',
      global: true,
      enabled: hasDoc,
      run: (_c, arg) => once(() => files.save(docArg(arg))),
    },
    {
      id: 'file.saveAs',
      title: 'files.saveAs',
      category: 'files.category',
      icon: asIcon(SaveAll),
      keys: 'Mod+Shift+S',
      global: true,
      enabled: hasDoc,
      run: (_c, arg) => once(() => files.saveAs(docArg(arg))),
    },
    {
      id: 'file.saveAll',
      title: 'files.saveAll',
      category: 'files.category',
      icon: asIcon(Files),
      keys: 'Mod+Alt+S',
      global: true,
      enabled: hasDoc,
      run: () => once(() => files.saveAll()),
    },
    {
      id: 'file.close',
      title: 'files.close',
      category: 'files.category',
      icon: asIcon(FileX),
      keys: 'Mod+W',
      global: true,
      enabled: hasDoc,
      run: (_c, arg) => once(() => files.close(docArg(arg))),
    },
    {
      id: 'file.closeAll',
      title: 'files.closeAll',
      category: 'files.category',
      global: true,
      enabled: hasDoc,
      run: () => once(() => files.closeAll()),
    },
    {
      id: 'file.closeWindow',
      title: 'files.closeWindow',
      category: 'files.category',
      keys: 'Mod+Shift+W',
      global: true,
      run: () => closeWindow(),
    },
  ],
  statusItems: [
    // The left side of the status bar. WP1.5's StatusBar renders it; nobody else may
    // register an item with this id (`data-item="file"`, §7.9).
    { id: 'file', side: 'left', order: 10, component: FileStatus },
  ],
  ribbon: [
    { tab: 'home', group: 'files.groupFile', command: 'file.new', order: 10, size: 'large' },
    { tab: 'home', group: 'files.groupFile', command: 'file.open', order: 20, size: 'large' },
    { tab: 'home', group: 'files.groupFile', command: 'file.save', order: 30, size: 'large' },
    { tab: 'home', group: 'files.groupFile', command: 'file.saveAs', order: 40 },
    { tab: 'home', group: 'files.groupFile', command: 'file.saveAll', order: 50 },
    { tab: 'home', group: 'files.groupFile', command: 'file.close', order: 60 },
  ],
  activate(): Disposable {
    // The window always holds a document, so the shell has something to render at once.
    if (docs.all().length === 0) files.newUntitled({ text: STARTER_TEXT });
    const off = [installTitle(), installWindowListeners()];
    return () => {
      for (const dispose of off.reverse()) dispose();
    };
  },
} satisfies Contribution;
