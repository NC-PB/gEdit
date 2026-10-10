// The template manager and "New Template from Selection" (Phase 3 plan §5 P3.9, §6.7, §6.11, AD-40;
// `docs/planning/code-assistant.md` "Template files and management"). Owner: P3.9. One feature per
// file (plan AD-3); see ./README.md.
//
//   templates.manage         the manager, for the code set of the active program's profile
//   templates.fromSelection  the selected blocks become the draft of a new template, in the manager
//
// No default keys (§6.7): both are rare. Both are buttons of the Insert tab, group
// `templateManager.group`, after the templates, and palette commands. The model is
// `app/templateManager.ts` (no Tauri, no Monaco); this file wires it to the real services:
//
//   - the user's code files:  `user_files_list`, `user_file_create`, `user_file_path` (no new command);
//   - an existing file:       its document, through `files.open` and `files.save`, so the backup, the
//                             external-change check and the reload on save all apply (AD-40);
//   - the built-in templates: the loaded set of raw files (`codes.files()`), without the user's layer;
//   - the preview:            the effective profile of the active document (`machines.effective`).
//
// The selection's whole lines go through `templateFromSelection` (P3.8) with the document's effective
// profile and database, so the block numbers, the candidates and the labels are what the document's
// own machine reads.

import FilePen from 'lucide-svelte/icons/file-pen';
import LayoutTemplate from 'lucide-svelte/icons/layout-template';
import TemplateManager from '$lib/components/dialogs/TemplateManager.svelte';
import { asIcon } from '$lib/app/icons';
import { dialogs } from '$lib/app/dialogs';
import { files } from '$lib/app/fileOps';
import { lockRefusal } from '$lib/app/readOnlyLock';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { templateEnv, templates } from '$lib/app/templateService';
import {
  baseTemplatesFrom,
  createTemplateManager,
  variantsFrom,
  type TemplateManager as TemplateManagerModel,
  type TemplateManagerDeps,
} from '$lib/app/templateManager';
import { userConfig } from '$lib/app/userConfig';
import { TEMPLATE_LIMITS, templateFromSelection, type TemplateEnv } from '$lib/core/templates';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { editor } from '$lib/monaco/editorService';
import { userFileCreate, userFilePath, userFilesList } from '$lib/platform/commands';
import { codes } from '$lib/stores/codes';
import { docs } from '$lib/stores/documents';
import { machines } from '$lib/stores/machines';
import { profiles } from '$lib/stores/profiles';
import { t } from '$lib/i18n';
import { get } from 'svelte/store';
import type { CommandContext, Contribution, ModalOptions } from '$lib/app/types';

const hasDocument = (c: CommandContext): boolean => c.activeDocId !== null;

/** English detail for anything thrown across the IPC boundary. */
function detailOf(err: unknown): string {
  if (typeof err === 'string') return err;
  return err instanceof Error ? err.message : String(err);
}

/**
 * The environment the preview renders in: the one the Insert tab's insert builds (`templateEnv`,
 * `app/templateService.ts`) for the active document's effective profile, the cursor's line, and the
 * date, time and file name as the insert would write them. Null for a document with no model.
 */
export function documentEnv(id: string, now: Date = new Date()): TemplateEnv | null {
  if (docs.get(id) === undefined || !editor.hasModel(id)) return null;
  return templateEnv({ editor, docs, now: () => now }, id, machines.effective(id).cp, editor.cursor()?.line ?? 1);
}

/** The databases a manager can open: every built-in one and every code file of the user's. */
export function manageableDialects(userFiles: readonly { kind: string; name: string }[]): string[] {
  const ids = new Set(Object.keys(BUILTIN_CODE_DB_JSON));
  for (const f of userFiles) if (f.kind === 'codes') ids.add(f.name.replace(/\.json$/i, ''));
  return [...ids].sort();
}

/** The databases a profile's variants switch to besides the default one, with the label of the choice ("G-code system B"). */
function variantLabels(): Map<string, string> {
  const out = new Map<string, string>();
  for (const info of profiles.list()) {
    const decl = profiles.profile(info.id).machineParams;
    if (typeof decl !== 'object' || decl === null || !Array.isArray(decl.variants)) continue;
    for (const variant of decl.variants) {
      for (const choice of Array.isArray(variant.choices) ? variant.choices : []) {
        if (typeof choice.codes === 'string' && choice.codes !== '' && choice.value !== variant.default && !out.has(choice.codes)) {
          out.set(choice.codes, typeof choice.label === 'string' ? choice.label : choice.value);
        }
      }
    }
  }
  return out;
}

/** The machine type of every profile that uses code set `dialect`, as its own or as the set of one of its variants (`undefined`: a profile without one). */
export function machineTypesOf(dialect: string): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  for (const info of profiles.list()) {
    const profile = profiles.profile(info.id);
    const sets = new Set<string>();
    if (typeof profile.codes === 'string') sets.add(profile.codes);
    const decl = profile.machineParams;
    if (typeof decl === 'object' && decl !== null && Array.isArray(decl.variants)) {
      for (const variant of decl.variants) {
        for (const choice of Array.isArray(variant.choices) ? variant.choices : []) if (typeof choice.codes === 'string' && choice.codes !== '') sets.add(choice.codes);
      }
    }
    if (sets.has(dialect) && !out.includes(profile.machineType)) out.push(profile.machineType);
  }
  return out;
}

/**
 * The key a star is kept under. The Insert tab reads the stars of the document's **effective**
 * database (`templates.dialectOf`: `fanuc-lathe-b` under G-code system B), while the manager edits the
 * code set the profile names (`fanuc-lathe`). For that code set the star goes under the effective key,
 * so a star in the manager and one on the Insert tab are the same star; for any other code set picked in
 * the manager it stays under that set's own id.
 */
export function starKey(docId: string, dialect: string): string {
  return starKeyOf(docId)(dialect);
}

/**
 * `starKey` for one document, read **once**: the manager keeps working with the code set the program had
 * when it was opened, whatever happens to the program's tab meanwhile.
 */
function starKeyOf(docId: string): (dialect: string) => string {
  const doc = docs.get(docId);
  const known = doc !== undefined && profiles.get(doc.profileId) !== undefined;
  const own = known ? profiles.profile(doc.profileId).codes : null;
  const effective = known ? templates.dialectOf(docId) : null;
  return (dialect) => (own !== dialect ? dialect : (effective ?? dialect));
}

/** The manager wired to the real services, previewing against document `docId`. */
export function realDeps(docId: string): TemplateManagerDeps {
  const builtinIds = Object.keys(BUILTIN_CODE_DB_JSON);
  const star = starKeyOf(docId);
  return {
    dialects: () => manageableDialects(get(userConfig.files)),
    baseTemplates: (dialect) => baseTemplatesFrom(codes.files(), builtinIds, dialect),
    machineTypes: (dialect) => machineTypesOf(dialect),
    variants: (dialect) => variantsFrom(codes.files(), dialect, variantLabels()),
    userFiles: {
      list: () => userFilesList('codes'),
      path: (name) => userFilePath('codes', name),
      create: (name, text) => userFileCreate('codes', name, text),
    },
    reloadUserFiles: () => userConfig.load(),
    docs: {
      find: (path) => {
        const doc = docs.byPath(path);
        return doc === undefined ? undefined : { id: doc.id, dirty: doc.dirty, title: doc.title };
      },
      // The program the user works in (maybe an untouched new document) stays where it is.
      open: async (path) => (await files.open([path], { keepScratch: true }))[0] ?? null,
      text: (id) => editor.getText(id),
      replace: (id, text) => editor.replaceAll(id, text),
      refusal: (id, action) => {
        const doc = docs.get(id);
        return doc === undefined ? null : lockRefusal(doc, action);
      },
      markClean: (id) => editor.markClean(id),
      save: (id) => files.save(id),
      activeId: () => docs.getActiveId(),
      activate: (id) => docs.activate(id),
    },
    confirm: (o) => dialogs.confirm({ title: o.title, message: o.message, ok: o.ok, kind: 'warning' }),
    favorites: {
      get: (dialect) => templates.favorites(star(dialect)),
      set: (dialect, id, on) => templates.setFavorite(star(dialect), id, on),
    },
    env: () => documentEnv(docId),
  };
}

/** The code set the active document keeps its templates in, and its machine type; null with no document. */
function target(): { docId: string; dialect: string; machineType: 'mill' | 'lathe' | undefined } | null {
  const docId = docs.getActiveId();
  const doc = docId === null ? undefined : docs.get(docId);
  if (docId === null || doc === undefined || profiles.get(doc.profileId) === undefined) {
    status.show(t('templateManager.noDocument'), { error: true });
    return null;
  }
  const profile = profiles.profile(doc.profileId);
  if (typeof profile.codes !== 'string' || profile.codes === '') {
    status.show(t('templateManager.noCodeSet'), { error: true });
    return null;
  }
  return { docId, dialect: profile.codes, machineType: profile.machineType };
}

/** The panel is wide, and a press outside it or an Esc with unsaved edits asks first (`ModalHost`). */
function managerOptions(model: TemplateManagerModel): ModalOptions {
  return { wide: true, mayClose: () => model.leave() };
}

/** Opens the manager on the model: reads the files, then the dialog. */
async function open(model: TemplateManagerModel, dialect: string, machineType: 'mill' | 'lathe' | undefined): Promise<void> {
  try {
    await model.load(dialect, machineType === undefined ? undefined : { machineType });
    await modals.open(TemplateManager, { model }, managerOptions(model));
  } catch (err) {
    status.show(t('templateManager.failed', { detail: detailOf(err) }), { error: true });
  }
}

async function manage(): Promise<void> {
  const at = target();
  if (at === null) return;
  await open(createTemplateManager(realDeps(at.docId)), at.dialect, at.machineType);
}

async function fromSelection(): Promise<void> {
  const at = target();
  if (at === null) return;
  const selection = editor.selectionLines();
  if (selection === null || selection.empty) {
    status.show(t('templateManager.selectFirst'), { error: true });
    return;
  }
  const count = selection.endLine - selection.startLine + 1;
  if (count > TEMPLATE_LIMITS.bodyLines) {
    status.show(t('templateManager.tooManyLines', { max: TEMPLATE_LIMITS.bodyLines }), { error: true });
    return;
  }
  const view = machines.effective(at.docId);
  const draft = templateFromSelection(editor.getLines(at.docId, selection.startLine, selection.endLine), view.cp, view.codes);
  const model = createTemplateManager(realDeps(at.docId));
  try {
    await model.load(at.dialect, at.machineType === undefined ? undefined : { machineType: at.machineType });
  } catch (err) {
    status.show(t('templateManager.failed', { detail: detailOf(err) }), { error: true });
    return;
  }
  model.startDraft(draft, {});
  try {
    await modals.open(TemplateManager, { model }, managerOptions(model));
  } catch (err) {
    status.show(t('templateManager.failed', { detail: detailOf(err) }), { error: true });
  }
}

export default {
  id: 'templateManager',
  commands: [
    {
      id: 'templates.manage',
      title: 'templateManager.manage',
      category: 'templateManager.category',
      icon: asIcon(FilePen),
      global: true,
      enabled: hasDocument,
      run: () => manage(),
    },
    {
      id: 'templates.fromSelection',
      title: 'templateManager.fromSelection',
      category: 'templateManager.category',
      icon: asIcon(LayoutTemplate),
      global: true,
      enabled: hasDocument,
      run: () => fromSelection(),
    },
  ],
  // The group follows the templates and the cycle form (P3.5, orders 10 to 30 on this tab).
  ribbon: [
    { tab: 'insert', group: 'templateManager.group', command: 'templates.fromSelection', order: 300 },
    { tab: 'insert', group: 'templateManager.group', command: 'templates.manage', order: 310 },
  ],
} satisfies Contribution;
