// The service aggregate the runtime harness sees as `window.__gedit.ctx` (plan §7.9, AD-3).
// Written by the preludes; each one adds the singletons its milestone introduces.
//
// This is NOT a service locator: features import the modules they need directly, so that
// the dependency graph stays readable and tree-shakeable. `ctx` exists so that a scenario
// can drive the app without going through the DOM, and so that `+page` has one thing to
// hand to `installTestHook`.
//
// Because it imports every singleton, anything imported here is evaluated as soon as the
// app boots. `monaco/editorService.ts` must therefore keep `$lib/monaco/core` behind a
// dynamic import (see `monaco/core.ts`), or Monaco would land in the initial bundle and
// run during prerender.

import { commands } from '$lib/app/registry/commands';
import { panels } from '$lib/app/registry/panels';
import { ribbon } from '$lib/app/registry/ribbon';
import { statusItems } from '$lib/app/registry/statusItems';
import { compare } from '$lib/app/compare';
import { dialogs } from '$lib/app/dialogs';
import { external } from '$lib/app/external';
import { files } from '$lib/app/fileOps';
import { modals } from '$lib/app/modals';
import { outline } from '$lib/app/outlineService';
import { recovery } from '$lib/app/recovery';
import { scripts } from '$lib/app/scripts';
import { session } from '$lib/app/session';
import { status } from '$lib/app/status';
import { transforms } from '$lib/app/transforms';
import { bookmarks } from '$lib/monaco/bookmarks';
import { editor } from '$lib/monaco/editorService';
import { codes } from '$lib/stores/codes';
import { docs } from '$lib/stores/documents';
import { fileMemory } from '$lib/stores/fileMemory';
import { layout } from '$lib/stores/layout';
import { machines } from '$lib/stores/machines';
import { profiles } from '$lib/stores/profiles';
import { recent } from '$lib/stores/recent';
import { results } from '$lib/stores/results';
import { settings } from '$lib/stores/settings';
import { uiState } from '$lib/stores/uiState';
import { t } from '$lib/i18n';
import type { AppContext } from '$lib/app/types';

export const ctx: AppContext = {
  commands,
  ribbon,
  panels,
  statusItems,
  docs,
  editor,
  files,
  dialogs,
  modals,
  status,
  layout,
  profiles,
  t,
  settings,
  uiState,
  recent,
  external,
  compare,
  codes,
  outline,
  transforms,
  results,
  bookmarks,
  scripts,
  machines,
  fileMemory,
  session,
  recovery,
};
