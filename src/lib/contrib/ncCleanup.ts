// The NC tab's "Cleanup" group (plan §5 WP4.3). One feature per file (plan AD-3); see
// ./README.md.
//
// Five commands, each of them nothing but `transforms.run(def)`: the sequence — scope,
// options form, preflight, one undo step, summary, results — belongs to
// `app/transforms.ts` (WP4.1), and a contribution that re-implemented any part of it
// would be a second way for a transform to behave.
//
// The one thing that lives here is the Klartext follow-up. Removing lines from a program
// whose block numbers must stay consecutive leaves code the control rejects, and the
// transform says so by carrying `ncCleanup.renumberNeeded` in its warnings. Renumbering
// behind the user's back would be a second edit they did not ask for, so this asks first
// and then runs `nc.renumber` (WP4.2) — and only when that command is registered, so the
// two work packages can land in either order.

import CaseSensitive from 'lucide-svelte/icons/case-sensitive';
import FoldHorizontal from 'lucide-svelte/icons/fold-horizontal';
import ListMinus from 'lucide-svelte/icons/list-minus';
import MessageSquareOff from 'lucide-svelte/icons/message-square-off';
import UnfoldHorizontal from 'lucide-svelte/icons/unfold-horizontal';
import { dialogs } from '$lib/app/dialogs';
import { asIcon } from '$lib/app/icons';
import { commands } from '$lib/app/registry/commands';
import { transforms } from '$lib/app/transforms';
import { convertCase } from '$lib/core/transforms/convertCase';
import { insertSpaces } from '$lib/core/transforms/insertSpaces';
import { removeComments } from '$lib/core/transforms/removeComments';
import { removeEmptyLines } from '$lib/core/transforms/removeEmptyLines';
import { removeSpaces } from '$lib/core/transforms/removeSpaces';
import type { TransformDef } from '$lib/core/transforms/types';
import { t } from '$lib/i18n';
import type { CommandContext, Contribution } from '$lib/app/types';

/** The warning a transform raises when its edit broke consecutive block numbers. */
const RENUMBER_NEEDED = 'ncCleanup.renumberNeeded';

/** The command that puts them back; owned by WP4.2, absent until it lands. */
const RENUMBER_COMMAND = 'nc.renumber';

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

/** Runs a transform and, when it broke the numbering, offers to renumber. */
async function run(def: TransformDef): Promise<void> {
  const result = await transforms.run(def);
  if (result === null) return;
  if (!result.warnings.some((warning) => warning.key === RENUMBER_NEEDED)) return;
  if (!commands.has(RENUMBER_COMMAND)) return;
  const renumber = await dialogs.confirm({
    title: t('ncCleanup.renumberTitle'),
    message: t('ncCleanup.renumberMessage'),
    ok: t('ncCleanup.renumberOk'),
    kind: 'warning',
  });
  if (renumber) await commands.run(RENUMBER_COMMAND);
}

export default {
  id: 'ncCleanup',
  commands: [
    {
      id: 'nc.insertSpaces',
      title: 'ncCleanup.insertSpaces.title',
      category: 'ncCleanup.category',
      icon: asIcon(UnfoldHorizontal),
      enabled: hasDocument,
      run: () => run(insertSpaces),
    },
    {
      id: 'nc.removeSpaces',
      title: 'ncCleanup.removeSpaces.title',
      category: 'ncCleanup.category',
      icon: asIcon(FoldHorizontal),
      enabled: hasDocument,
      run: () => run(removeSpaces),
    },
    {
      id: 'nc.removeEmptyLines',
      title: 'ncCleanup.removeEmptyLines.title',
      category: 'ncCleanup.category',
      icon: asIcon(ListMinus),
      enabled: hasDocument,
      run: () => run(removeEmptyLines),
    },
    {
      id: 'nc.removeComments',
      title: 'ncCleanup.removeComments.title',
      category: 'ncCleanup.category',
      icon: asIcon(MessageSquareOff),
      enabled: hasDocument,
      run: () => run(removeComments),
    },
    {
      id: 'nc.convertCase',
      title: 'ncCleanup.convertCase.title',
      category: 'ncCleanup.category',
      icon: asIcon(CaseSensitive),
      enabled: hasDocument,
      run: () => run(convertCase),
    },
  ],
  ribbon: [
    { tab: 'nc', group: 'ncCleanup.group', command: 'nc.insertSpaces', order: 10 },
    { tab: 'nc', group: 'ncCleanup.group', command: 'nc.removeSpaces', order: 20 },
    { tab: 'nc', group: 'ncCleanup.group', command: 'nc.removeEmptyLines', order: 30 },
    { tab: 'nc', group: 'ncCleanup.group', command: 'nc.removeComments', order: 40 },
    { tab: 'nc', group: 'ncCleanup.group', command: 'nc.convertCase', order: 50 },
  ],
} satisfies Contribution;
