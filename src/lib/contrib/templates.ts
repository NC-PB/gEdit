// The Insert tab's templates (Phase 3 plan §5 P3.5, §6.7; Phase 2 plan AD-28). One feature per
// file (plan AD-3); see ./README.md. Owner: P3.5; it replaces `blocks.ts`.
//
// One `insert.template:<id>` command per template id of the union of all loaded databases
// (`templateCommandId`; never spelled out here, so a command cannot outlive its template). It is
// enabled where the active document's list (`ctx.templates.list`, the document's effective
// database and machine type) has the id, and registered again whenever the lists may have
// changed (`templates.changed`: a code reload, a machine, a profile switch, a favourite).
//
//   - The Insert tab shows `TemplatesGroup`: one block of buttons per template group (the
//     `toolbar` templates), the others in the group's "More templates…" list, a "Favorites"
//     group first when the database has starred templates.
//   - "Program start" (`insert.template:program-start`, a form per database) is one of those
//     buttons and the only place it is offered: the old one-button "Program" group of the Home
//     tab is gone with the Home tab (B1 A9).
//   - `templates.insert` (palette, no key) is a quick pick of the active program's templates,
//     favourites first, then by group.
//
// A command's title is the template's label: data, shown as text and never translated (AD-14).
// `t()` returns a key it does not know unchanged, which is how a block's name worked before.

import FilePlus from 'lucide-svelte/icons/file-plus';
import { asIcon } from '$lib/app/icons';
import { commands } from '$lib/app/registry/commands';
import { templates } from '$lib/app/templateService';
import { codes } from '$lib/stores/codes';
import TemplatesGroup from '$lib/components/shell/TemplatesGroup.svelte';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { t } from '$lib/i18n';
import { templateCommandId } from '$lib/core/templates';
import type { TemplateDef } from '$lib/core/templates';
import type { CommandContext, CommandDef, Contribution, Disposable, QuickPickItem, TemplateService } from '$lib/app/types';

const icon = asIcon(FilePlus);

/** The template ids of every loaded database with the label of the first database that has one. */
export function loadedTemplateIds(): Map<string, string> {
  const ids = new Map<string, string>();
  for (const dialect of Object.keys(codes.files())) {
    if (dialect.includes('@')) continue; // an overlay's untouched built-in (stores/codes.ts)
    for (const tpl of codes.byId(dialect).templates ?? []) if (!ids.has(tpl.id)) ids.set(tpl.id, tpl.label);
  }
  return ids;
}

/** The quick pick of `templates.insert`: favourites first, then the groups in order, then the templates. */
export function pickItems(service: Pick<TemplateService, 'list' | 'dialectOf' | 'favorites'>, docId: string): QuickPickItem<string>[] {
  const list = service.list(docId);
  const dialect = service.dialectOf(docId);
  const stars = dialect === null ? [] : service.favorites(dialect);
  const starred = stars.map((id) => list.find((x) => x.id === id)).filter((x): x is TemplateDef => x !== undefined);
  const rest = list.filter((x) => !starred.includes(x));
  const groups = [...new Set(rest.map((x) => x.group))];
  const ordered = [...starred, ...groups.flatMap((g) => rest.filter((x) => x.group === g))];
  return ordered.map((tpl) => ({
    label: tpl.label,
    description: starred.includes(tpl) ? `${t('templates.favorites')} · ${tpl.group}` : tpl.group,
    detail: [tpl.description, tpl.review === 'pending' ? t('templates.reviewPendingShort') : undefined].filter(Boolean).join(' · ') || undefined,
    value: tpl.id,
  }));
}

/** `templates.insert`: asks which template, then inserts it (its form opens as for a button). */
export async function pickAndInsert(docId: string | null): Promise<void> {
  if (docId === null) {
    status.show(t('templates.noDocument'), { error: true });
    return;
  }
  const items = pickItems(templates, docId);
  if (items.length === 0) {
    status.show(t('templates.none'), { error: true });
    return;
  }
  const chosen = await modals.quickPick(items, { placeholder: t('templates.pickPlaceholder') });
  if (chosen !== undefined) await templates.insert(chosen);
}

function commandFor(id: string, label: string): CommandDef {
  return {
    id: templateCommandId(id),
    title: label,
    category: 'templates.category',
    icon,
    enabled: (c: CommandContext) => c.activeDocId !== null && templates.list(c.activeDocId).some((x) => x.id === id),
    run: () => templates.insert(id),
  };
}

/** Keeps the registry in step with the ids of the loaded databases. Returns the disposer of everything it registered. */
export function keepCommandsInStep(source: Pick<TemplateService, 'changed'>, ids: () => Map<string, string> = loadedTemplateIds): Disposable {
  const registered = new Map<string, { label: string; dispose: Disposable }>();
  const sync = (): void => {
    const wanted = ids();
    for (const [id, entry] of registered) {
      const label = wanted.get(id);
      if (label === entry.label) continue;
      entry.dispose();
      registered.delete(id);
    }
    for (const [id, label] of wanted) {
      if (registered.has(id)) continue;
      registered.set(id, { label, dispose: commands.register(commandFor(id, label)) });
    }
  };
  const stop = source.changed.subscribe(sync);
  return () => {
    stop();
    for (const entry of registered.values()) entry.dispose();
    registered.clear();
  };
}

export default {
  id: 'templates',
  commands: [
    {
      id: 'templates.insert',
      title: 'templates.insert',
      category: 'templates.category',
      icon,
      enabled: (c) => c.activeDocId !== null,
      run: (c) => pickAndInsert(c.activeDocId),
    },
  ],
  ribbonGroups: [{ tab: 'insert', group: 'templates.groupTemplates', order: 10, component: TemplatesGroup }],
  activate: () => keepCommandsInStep(templates),
} satisfies Contribution;
