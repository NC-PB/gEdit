// The transform runner (plan §7.3, §5 WP4.1). Owner: **WP4.1**.
//
// `TransformService.run` is the whole sequence a transform goes through, in one place, so
// that every one of them behaves the same and no `contrib/` file repeats it. The steps
// are listed on `TransformService` in `app/types.ts`:
//
//  1. `available(cp)` — the reason goes to the status bar and nothing else happens.
//  2. the options form, pre-filled from `uiState.lastParams['transform:'+id]`.
//  3. `preflight(lines, ctx)` — a `Msg` becomes a confirmation the user may decline.
//  4. `run(lines, ctx)` on the scope.
//  5. the output: the scope replaced as one undo step, or a new untitled document.
//  6. `summary` in the status bar.
//  7. `skipped` and `warnings` in the Results panel.
//
// Two decisions worth stating, because both are about not lying to the user:
//
//  - The **scope is taken before the form opens**, not after. It is the selection the
//    user had when they picked the command; a modal takes the focus and a click in it
//    must not quietly widen a run to the whole program.
//  - The context carries the **whole document** next to the scope, read only. A
//    transform still rewrites nothing but `lines`; it reads the rest to know what the
//    selection hides — a jump into the selection from above it, or a Klartext block that
//    the selection starts in the middle of. Both were silent corruptions before (G8 M4).
//  - A run that has nothing to report **clears its own previous report** and nothing
//    else. Leaving the last run's twelve skipped lines on screen after the user fixed
//    them reads as "still twelve"; clearing somebody else's report (a script's, a
//    find-all's) would be worse. The service remembers the object it published and only
//    retracts that one.
//
// Written as `createTransformService(deps)` plus the singleton below (AD-2), so a unit
// test can drive the sequence with fake editor, modal and status services and no Monaco.

import { get } from 'svelte/store';
import { dialogs as appDialogs } from '$lib/app/dialogs';
import { files as appFiles } from '$lib/app/fileOps';
import { modals as appModals } from '$lib/app/modals';
import { status as appStatus } from '$lib/app/status';
import { initialValues } from '$lib/core/forms/values';
import { transformScope } from '$lib/core/transforms/scope';
import { applyLines as applyLinesToModel } from '$lib/monaco/applyLines';
import { editor as appEditor } from '$lib/monaco/editorService';
import { codes as appCodes } from '$lib/stores/codes';
import { docs as appDocs } from '$lib/stores/documents';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { results as appResults } from '$lib/stores/results';
import { uiState as appUiState } from '$lib/stores/uiState';
import { t as translate } from '$lib/i18n';
import type {
  CodeDbService,
  DocId,
  DocumentStore,
  EditorService,
  FileOps,
  Modals,
  Msg,
  NativeDialogs,
  ProfileRegistry,
  ReportData,
  ResultsService,
  StatusService,
  Translate,
  TransformService,
  UiStateStore,
} from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext, TransformDef, TransformResult } from '$lib/core/transforms/types';

/** The `uiState.lastParams` key a transform's form values are remembered under. */
export function formKey(id: string): string {
  return `transform:${id}`;
}

export interface TransformDeps {
  docs: Pick<DocumentStore, 'getActiveId' | 'get'>;
  editor: Pick<EditorService, 'getLineCount' | 'getLines' | 'selectionLines'>;
  profiles: Pick<ProfileRegistry, 'compiled'>;
  codes: Pick<CodeDbService, 'forProfile'>;
  modals: Pick<Modals, 'form'>;
  dialogs: Pick<NativeDialogs, 'confirm'>;
  status: Pick<StatusService, 'show'>;
  uiState: Pick<UiStateStore, 'getLastParams' | 'setLastParams'>;
  results: ResultsService;
  files: Pick<FileOps, 'newUntitled'>;
  /** `monaco/applyLines.ts`; a fake in the tests. */
  applyLines(
    id: DocId,
    startLine: number,
    endLine: number,
    newLines: string[],
    lineMap?: Int32Array,
  ): { changedLines: number };
  t: Translate;
}

export function createTransformService(deps: TransformDeps): TransformService {
  const { t } = deps;

  /** The report this service last published, so it can retract that one and no other. */
  let ownReport: ReportData | null = null;

  const say = (msg: Msg, error = false): void => {
    deps.status.show(t(msg.key, msg.params), error ? { error: true } : undefined);
  };

  /** The values a run starts from when the form is skipped, or the form is pre-filled with. */
  function startingValues(
    fields: FieldSpec[],
    id: string,
    o: { options?: Record<string, unknown>; skipForm?: boolean } | undefined,
  ): Record<string, unknown> {
    // `skipForm` also skips what was remembered: a headless run (the harness, a test, a
    // command that carries its own options) has to be reproducible.
    const remembered = o?.skipForm === true ? undefined : deps.uiState.getLastParams(formKey(id));
    return { ...initialValues(fields, remembered), ...(o?.options ?? {}) };
  }

  /** Steps 7: what the Results panel shows for this run. */
  function publish(def: TransformDef, result: TransformResult, docId: DocId): void {
    const parts = [t(result.summary.key, result.summary.params)];
    for (const warning of result.warnings) parts.push(t(warning.key, warning.params));
    if (result.skipped.length > 0) {
      parts.push(t('transforms.skipped', { count: result.skipped.length }));
    }

    if (result.skipped.length === 0 && result.warnings.length === 0) {
      if (ownReport !== null && get(deps.results.current) === ownReport) deps.results.clear();
      ownReport = null;
      return;
    }

    const report: ReportData = {
      title: t(def.title),
      message: parts.join(' '),
      columns: [],
      rows: [],
      findings: result.skipped,
      docId,
    };
    ownReport = report;
    deps.results.show(report);
  }

  return {
    async run(def, o): Promise<TransformResult | null> {
      const docId = deps.docs.getActiveId();
      const doc = docId === null ? undefined : deps.docs.get(docId);
      if (docId === null || !doc) {
        deps.status.show(t('transforms.noDocument'), { error: true });
        return null;
      }

      let cp: CompiledProfile;
      try {
        cp = deps.profiles.compiled(doc.profileId);
      } catch {
        deps.status.show(t('transforms.noProfile', { profile: doc.profileId }), { error: true });
        return null;
      }

      // 1. Availability.
      const availability = def.available(cp);
      if (availability !== true) {
        say(availability, true);
        return null;
      }

      // The scope belongs to the moment the command was invoked (see the header).
      const lineCount = deps.editor.getLineCount(docId);
      const scope = transformScope(lineCount, deps.editor.selectionLines());

      // 2. The options form.
      const fields = def.options?.(cp) ?? [];
      let options = startingValues(fields, def.id, o);
      if (fields.length > 0 && o?.skipForm !== true) {
        const answered = await deps.modals.form({
          title: t(def.title),
          fields,
          values: options,
        });
        if (answered === undefined) return null;
        options = answered;
        deps.uiState.setLastParams(formKey(def.id), answered);
      }

      const lines = deps.editor.getLines(docId, scope.startLine, scope.endLine);
      // The whole program as well as the scope, so a transform can tell what a selection
      // hides: a `GOTO 100` above it that points into it, or a Klartext `~` block whose
      // tail the selection starts in (`core/transforms/{references,fragment}.ts`). A
      // whole-document run hands over the array it already has, so nothing is read twice.
      const partial = scope.startLine > 1 || scope.endLine < lineCount;
      const document = partial ? deps.editor.getLines(docId, 1, lineCount) : lines;
      const ctx: TransformContext = {
        cp,
        codes: deps.codes.forProfile(doc.profileId),
        options,
        firstLine: scope.startLine,
        document,
      };

      // 3. The preflight confirmation.
      const warning = def.preflight?.(lines, ctx) ?? null;
      if (warning !== null) {
        const go = await deps.dialogs.confirm({
          title: t(def.title),
          message: t(warning.key, warning.params),
          ok: t('transforms.continue'),
          cancel: t('common.cancel'),
          kind: 'warning',
        });
        if (!go) return null;
      }

      // 4. The run. An exception out of a transform is a bug, not a refusal.
      let result: TransformResult;
      try {
        result = def.run(lines, ctx);
      } catch (err) {
        console.error(`transform ${def.id} failed`, err);
        deps.status.show(t('transforms.failed', { title: t(def.title) }), {
          error: true,
          detail: err instanceof Error ? err.message : String(err),
        });
        return null;
      }

      // 5. The output.
      if (o?.target === 'new-document') {
        deps.files.newUntitled({
          profileId: doc.profileId,
          text: result.lines.join('\n'),
          activate: true,
        });
      } else {
        deps.applyLines(docId, scope.startLine, scope.endLine, result.lines, result.lineMap);
      }

      // 6. The summary.
      const summary = t(result.summary.key, result.summary.params);
      deps.status.show(scope.fromSelection ? t('transforms.inSelection', { summary }) : summary);

      // 7. What was skipped. The lines are the *input*'s, so the report points at the
      // document the transform read, even when the output went somewhere else.
      publish(def, result, docId);
      return result;
    },
  };
}

/** The application-wide transform service. */
export const transforms: TransformService = createTransformService({
  docs: appDocs,
  editor: appEditor,
  profiles: appProfiles,
  codes: appCodes,
  modals: appModals,
  dialogs: appDialogs,
  status: appStatus,
  uiState: appUiState,
  results: appResults,
  files: appFiles,
  applyLines: applyLinesToModel,
  t: translate,
});
