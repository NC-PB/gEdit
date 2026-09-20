// Compare with an open document, a file or the saved version (plan §5 WP2.5, §7.11).
// One feature per file (plan AD-3); see ./README.md.
//
// Only `compare.with` has a shortcut (Mod+Alt+C, §7.11). The navigation commands
// deliberately have none: F7 and Shift+F7 belong to `nav.nextTool`/`nav.prevTool` from M3
// on, and a key conflict is a `console.error` the runtime harness fails on. Esc is not a
// binding either — `CompareView` handles it itself, so Monaco's find widget still gets
// the first Esc.
//
// `compare.withSaved` takes `{ docId }`, which is how the external-change banner (WP2.3)
// reaches it for the document the banner belongs to.

import FileDiff from 'lucide-svelte/icons/file-diff';
import { asIcon } from '$lib/app/icons';
import { compareController, autoTarget, availableSources, documentTargets } from '$lib/app/compare';
import CompareView from '$lib/components/editor/CompareView.svelte';
import { currentDiff } from '$lib/monaco/diff';
import { dialogs } from '$lib/app/dialogs';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type {
  CommandContext,
  Contribution,
  DocId,
  QuickPickItem,
} from '$lib/app/types';
import type { CompareSourceKind } from '$lib/app/compare';

/** The id of the overlay panel; `app/compare.ts` opens the region by this name. */
const PANEL_ID = 'compare';

/** The document a compare command works on: the argument's, else the active one. */
function targetDoc(context: CommandContext, arg?: unknown): DocId | null {
  if (arg && typeof arg === 'object' && typeof (arg as { docId?: unknown }).docId === 'string') {
    return (arg as { docId: string }).docId;
  }
  if (typeof arg === 'string') return arg;
  return context.activeDocId;
}

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

function hasOtherDocument(context: CommandContext): boolean {
  return context.activeDocId !== null && docs.all().length > 1;
}

function activeHasPath(context: CommandContext): boolean {
  const id = context.activeDocId;
  return id !== null && (docs.get(id)?.path ?? null) !== null;
}

/** One entry of the `compare.with` picker. Written out, so `i18n/keys.test.ts` sees the keys. */
function sourceItem(kind: CompareSourceKind): QuickPickItem<CompareSourceKind> {
  if (kind === 'saved') {
    return { label: t('compare.sourceSaved'), detail: t('compare.sourceSavedDetail'), value: kind };
  }
  if (kind === 'document') {
    return { label: t('compare.sourceDocument'), detail: t('compare.sourceDocumentDetail'), value: kind };
  }
  return { label: t('compare.sourceFile'), detail: t('compare.sourceFileDetail'), value: kind };
}

async function withDocument(docId: DocId): Promise<void> {
  const all = docs.all();
  const auto = autoTarget(all, docId);
  if (auto !== null) {
    await compareController.open(docId, { kind: 'document', docId: auto });
    return;
  }
  const targets = documentTargets(all, docId);
  if (targets.length === 0) {
    status.show(t('compare.noOtherDocument'), { error: true });
    return;
  }
  const items: QuickPickItem<DocId>[] = targets.map((doc) => ({
    label: doc.title,
    description: doc.path ?? undefined,
    value: doc.id,
  }));
  const picked = await modals.quickPick(items, { placeholder: t('compare.pickDocument') });
  if (picked === undefined) return;
  await compareController.open(docId, { kind: 'document', docId: picked });
}

async function withFile(docId: DocId): Promise<void> {
  // `dialogs.pickFile` grants the chosen path in the fs scope, the same way `open` does
  // (F3), so `files.readDisk` may read it afterwards.
  const path = await dialogs.exclusive(() => dialogs.pickFile({ title: t('compare.pickFileTitle') }));
  if (!path) return;
  await compareController.open(docId, { kind: 'file', path });
}

async function withSaved(docId: DocId): Promise<void> {
  await compareController.open(docId, { kind: 'saved' });
}

async function withAny(docId: DocId): Promise<void> {
  const kinds = availableSources(docs.get(docId), docs.all().length);
  if (kinds.length === 0) {
    status.show(t('compare.noDocument'), { error: true });
    return;
  }
  const picked = await modals.quickPick(kinds.map(sourceItem), {
    placeholder: t('compare.pickSource'),
  });
  if (picked === undefined) return;
  if (picked === 'saved') await withSaved(docId);
  else if (picked === 'document') await withDocument(docId);
  else await withFile(docId);
}

export default {
  id: 'compare',
  panels: [
    {
      id: PANEL_ID,
      region: 'overlay',
      title: 'compare.title',
      component: CompareView,
      order: 10,
    },
  ],
  commands: [
    {
      id: 'compare.with',
      title: 'compare.with',
      category: 'compare.category',
      icon: asIcon(FileDiff),
      keys: 'Mod+Alt+C',
      global: true,
      enabled: hasDocument,
      run: (context, arg) => {
        const id = targetDoc(context, arg);
        return id === null ? undefined : withAny(id);
      },
    },
    {
      id: 'compare.withDocument',
      title: 'compare.withDocument',
      category: 'compare.category',
      global: true,
      enabled: hasOtherDocument,
      run: (context, arg) => {
        const id = targetDoc(context, arg);
        return id === null ? undefined : withDocument(id);
      },
    },
    {
      id: 'compare.withFile',
      title: 'compare.withFile',
      category: 'compare.category',
      global: true,
      enabled: hasDocument,
      run: (context, arg) => {
        const id = targetDoc(context, arg);
        return id === null ? undefined : withFile(id);
      },
    },
    {
      id: 'compare.withSaved',
      title: 'compare.withSaved',
      category: 'compare.category',
      global: true,
      // The argument may name another document, but the enablement can only see the
      // active one; `open()` refuses an untitled document again, with its own message.
      enabled: activeHasPath,
      run: (context, arg) => {
        const id = targetDoc(context, arg);
        return id === null ? undefined : withSaved(id);
      },
    },
    {
      id: 'compare.close',
      title: 'compare.close',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => compareController.close(),
    },
    {
      id: 'compare.nextDiff',
      title: 'compare.nextDiff',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => currentDiff()?.goToDiff('next'),
    },
    {
      id: 'compare.prevDiff',
      title: 'compare.prevDiff',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => currentDiff()?.goToDiff('previous'),
    },
    {
      id: 'compare.toggleInline',
      title: 'compare.toggleInline',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => compareController.toggleInline(),
    },
  ],
  ribbon: [{ tab: 'tools', group: 'compare.group', command: 'compare.with', order: 10 }],
} satisfies Contribution;
