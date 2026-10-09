// Your own profiles and code files, and the machines file's import and export (plan §6 M13
// WP13.3, AD-29, §7.13). One feature per file (plan AD-3); see ./README.md.
//
// A user profile is a JSON file in `<config>/profiles/`, a code file one in `<config>/codes/`
// (WP13.1 reads and writes them, WP13.2 loads them into the two registries). This file is the
// user's way in:
//
//   profile.newFrom        a new file that extends a profile (or code set) you pick, opened
//   profile.open           one of your files, opened as a document
//   profile.import         a file you pick, copied into the folder
//   profile.export         one of your files, saved where you choose
//   profile.reload         both folders read again
//   profile.testOnDocument what every rule of a profile finds in the open program, in Results
//   machines.import        the machines of a file you pick, added to yours
//   machines.export        your machines file, saved where you choose
//
// and the save hook: saving a document that lives in either folder reloads, so an edit takes
// effect when the file is saved (AD-29).
//
// The first four take `{ kind?: 'profiles' | 'codes' }` (and `newFrom` also `parent` and
// `name`, `open`/`export` also `name`); from the palette they ask for what is missing. The
// Profiles page (Settings ▸ Profiles) runs the same commands with everything filled in,
// because a modal cannot open over the Settings dialog.
//
// No command here has a default shortcut: each is rare, and a key on New or Import would
// make files in the config folder by accident (§7.13, P13).
//
// Everything a file or a machine is called is the user's data and is never translated.

import { get } from 'svelte/store';
import { dialogs } from '$lib/app/dialogs';
import { files } from '$lib/app/fileOps';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { userConfig } from '$lib/app/userConfig';
import { asIcon } from '$lib/app/icons';
import { testReportAsync, BUDGET_MS, MAX_REPORT_LINES, SLOW_MS } from '$lib/core/profiles/testReport';
import type { TestReport, TestRow } from '$lib/core/profiles/testReport';
import { effectiveMachine } from '$lib/core/machines/effective';
import { VARIANT_MARGIN } from '$lib/core/profiles/detect';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { editor } from '$lib/monaco/editorService';
import { filesStat, machinesOpenFile, userFileCreate, userFileImport, userFilePath } from '$lib/platform/commands';
import type { UserFileKind } from '$lib/platform/commands';
import { docs } from '$lib/stores/documents';
import { machines } from '$lib/stores/machines';
import { profiles } from '$lib/stores/profiles';
import { results } from '$lib/stores/results';
import { uiState } from '$lib/stores/uiState';
import { t } from '$lib/i18n';
import { baseName } from '$lib/utils/platform';
import FlaskConical from 'lucide-svelte/icons/flask-conical';
import type { Contribution, Disposable, Msg, QuickPickItem, ReportData } from '$lib/app/types';

/** The `ui.lastParams` key of "New Profile From…". */
export const NEW_FROM_KEY = 'userConfig:newFrom';

/** A machines file or a profile is at most this large (the Rust side refuses more). */
const MAX_BYTES = 1024 * 1024;

/** The most rows the test report lists; the panel says how many were left out. */
export const MAX_REPORT_ROWS = 2000;

/** English detail for anything thrown across the IPC boundary. */
function detailOf(err: unknown): string {
  if (typeof err === 'string') return err;
  return err instanceof Error ? err.message : String(err);
}

function isKind(value: unknown): value is UserFileKind {
  return value === 'profiles' || value === 'codes';
}

function recordOf(arg: unknown): Record<string, unknown> {
  return typeof arg === 'object' && arg !== null ? (arg as Record<string, unknown>) : {};
}

// --- file reading and writing ----------------------------------------------------------

/** Loaded on demand: the fs plugin only exists inside the webview. */
async function readBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  return readFile(path);
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  await writeFile(path, bytes);
}

// --- names -----------------------------------------------------------------------------

/**
 * The file name stem for what the user typed: lower case, blanks to `-`, a `.json` the user
 * typed anyway taken off. The rule itself is Rust's (`^[a-z0-9][a-z0-9._-]{0,63}\.json$`).
 */
export function stemOf(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/\.json$/, '');
}

const STEM_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** The names Windows reserves, with or without an extension (`con.json`). */
const DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/;

/** The ids of the built-in code databases. */
export function builtinCodeIds(): string[] {
  return Object.keys(BUILTIN_CODE_DB_JSON);
}

/**
 * The stems of the files already in the folder, lower case: on a volume that does not tell
 * `Lathe.json` from `lathe.json`, the file whose name breaks the rule still holds the name
 * (CODE-4), and the page has to say so.
 */
function userStems(kind: UserFileKind): string[] {
  return get(userConfig.files)
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.name.replace(/\.json$/i, '').toLowerCase());
}

/**
 * Why `stem` cannot be the name of a new file extending `parent`, or null.
 *
 * A profile's id is its file's stem, and an id of a profile that exists (built in or yours)
 * is taken. A code file is an *overlay* of a built-in database when its name is that
 * database's id and it extends nothing, and a database of its own under any other name; so
 * the name of a built-in set is allowed only for the set the file is made from.
 */
export function nameProblem(kind: UserFileKind, parent: string, stem: string): Msg | null {
  if (!STEM_RE.test(stem) || stem.endsWith('.')) return { key: 'userConfig.name.invalid' };
  if (DEVICE_RE.test(stem)) return { key: 'userConfig.name.device' };
  if (userStems(kind).includes(stem)) return { key: 'userConfig.name.taken', params: { name: `${stem}.json` } };
  if (kind === 'profiles') {
    if (profiles.get(stem) !== undefined) return { key: 'userConfig.name.profileExists' };
    return null;
  }
  if (builtinCodeIds().includes(stem) && stem !== parent) return { key: 'userConfig.name.codesBuiltin', params: { name: stem } };
  return null;
}

/** The status-bar name of a new profile: its file name in capitals, short enough to fit. */
function shortNameOf(stem: string): string {
  return stem.replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 8).toUpperCase() || 'USER';
}

/**
 * The text of a new file.
 *
 * A profile extends `parent` and says nothing else but its identity; its `detect.content` is
 * empty so it does not outscore its parent on every program (a user profile wins a *tie*,
 * and the point of a profile of your own is usually a folder: add `detect.folders`). A code
 * file named like the set it is made from is an overlay and extends nothing; under another
 * name it is a database of its own and has to say what it extends.
 */
export function newFileText(kind: UserFileKind, parent: string, stem: string): string {
  const body =
    kind === 'profiles'
      ? { id: stem, name: stem, shortName: shortNameOf(stem), version: 1, extends: parent, detect: { content: [] } }
      : stem === parent
        ? { dialect: stem, version: 1, codes: [] }
        : { dialect: stem, version: 1, extends: parent, codes: [] };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * What a profile is called: its own `name` (what the user wrote in the file, and what the
 * dialect picker shows). `ProfileInfo.name` is the file-dialog filter, which a profile that
 * extends another one inherits, so two of your profiles would read alike.
 */
export function displayName(info: { id: string; name: string }): string {
  try {
    return profiles.profile(info.id).name;
  } catch {
    return info.name;
  }
}

/** The sets a new file can be made from. */
export function parentChoices(kind: UserFileKind): QuickPickItem<string>[] {
  if (kind === 'profiles') {
    return profiles.list().map((info) => ({
      label: displayName(info),
      description: info.id,
      detail: t(info.origin === 'user' ? 'userConfig.origin.user' : 'userConfig.origin.builtin'),
      value: info.id,
    }));
  }
  const builtin = builtinCodeIds();
  return [
    ...builtin.map((id) => ({ label: id, detail: t('userConfig.origin.builtin'), value: id })),
    ...userStems('codes')
      .filter((id) => !builtin.includes(id))
      .map((id) => ({ label: id, detail: t('userConfig.origin.user'), value: id })),
  ];
}

// --- asking ----------------------------------------------------------------------------

async function askKind(arg: Record<string, unknown>): Promise<UserFileKind | undefined> {
  if (isKind(arg.kind)) return arg.kind;
  const last = uiState.getLastParams(NEW_FROM_KEY)?.kind;
  const items: QuickPickItem<UserFileKind>[] = [
    { label: t('userConfig.kind.profiles'), detail: t('userConfig.kind.profilesDetail'), value: 'profiles' },
    { label: t('userConfig.kind.codes'), detail: t('userConfig.kind.codesDetail'), value: 'codes' },
  ];
  return modals.quickPick(items, {
    placeholder: t('userConfig.kind.placeholder'),
    initialIndex: Math.max(0, items.findIndex((item) => item.value === last)),
  });
}

/** The files of a folder that could be read, as a pick list. */
function fileItems(kind: UserFileKind): QuickPickItem<string>[] {
  return get(userConfig.files)
    .filter((entry) => entry.kind === kind)
    .map((entry) => ({
      label: entry.name,
      detail: entry.error ?? undefined,
      value: entry.name,
    }));
}

async function askFile(kind: UserFileKind, arg: Record<string, unknown>): Promise<string | undefined> {
  if (typeof arg.name === 'string' && arg.name !== '') return arg.name;
  const items = fileItems(kind);
  if (items.length === 0) {
    status.show(t(kind === 'profiles' ? 'userConfig.noProfileFiles' : 'userConfig.noCodeFiles'));
    return undefined;
  }
  return modals.quickPick(items, {
    placeholder: t(kind === 'profiles' ? 'userConfig.pickProfileFile' : 'userConfig.pickCodeFile'),
  });
}

// --- new -------------------------------------------------------------------------------

/**
 * Makes the file and opens it. True when the file was created (even if it could not be
 * opened), false when nothing was made or the user backed out, so the Profiles page keeps
 * what was typed when it was not.
 */
async function newFrom(argument: unknown): Promise<boolean> {
  const arg = recordOf(argument);
  const kind = await askKind(arg);
  if (kind === undefined) return false;

  const last = uiState.getLastParams(NEW_FROM_KEY);
  const choices = parentChoices(kind);
  let parent = typeof arg.parent === 'string' ? arg.parent : undefined;
  if (parent === undefined) {
    parent = await modals.quickPick(choices, {
      placeholder: t(kind === 'profiles' ? 'userConfig.create.parentProfile' : 'userConfig.create.parentCodes'),
      initialIndex: Math.max(0, choices.findIndex((item) => last?.kind === kind && item.value === last.parent)),
    });
  }
  if (parent === undefined) return false;

  let stem = typeof arg.name === 'string' ? stemOf(arg.name) : undefined;
  if (stem === undefined) {
    const typed = await modals.prompt({
      title: t(kind === 'profiles' ? 'userConfig.create.nameProfile' : 'userConfig.create.nameCodes', { parent }),
      placeholder: t('userConfig.create.namePlaceholder'),
      initial: kind === 'codes' ? parent : `my-${parent}`,
      validate: (value) => nameProblem(kind, parent, stemOf(value)),
    });
    if (typed === undefined) return false;
    stem = stemOf(typed);
  }
  const problem = nameProblem(kind, parent, stem);
  if (problem !== null) {
    status.show(t(problem.key, problem.params), { error: true });
    return false;
  }

  let path: string;
  try {
    path = await userFileCreate(kind, `${stem}.json`, newFileText(kind, parent, stem));
  } catch (err) {
    status.show(t('userConfig.create.failed'), { error: true, detail: detailOf(err) });
    return false;
  }
  // The file exists from here on: whatever happens to opening it, the folders are read again
  // (CODE-9), so the registry and the Profiles page know it.
  uiState.setLastParams(NEW_FROM_KEY, { kind, parent });
  let openError: unknown;
  try {
    await files.open([path]);
  } catch (err) {
    openError = err;
  } finally {
    await userConfig.load();
  }
  if (openError === undefined) status.show(t('userConfig.create.created', { name: `${stem}.json` }));
  else status.show(t('userConfig.create.createdNotOpened', { name: `${stem}.json` }), { error: true, detail: detailOf(openError) });
  return true;
}

// --- open ------------------------------------------------------------------------------

async function openFile(argument: unknown): Promise<void> {
  const arg = recordOf(argument);
  const kind = await askKind(arg);
  if (kind === undefined) return;
  const name = await askFile(kind, arg);
  if (name === undefined) return;
  try {
    await files.open([await userFilePath(kind, name)]);
  } catch (err) {
    status.show(t('userConfig.openFailed', { name }), { error: true, detail: detailOf(err) });
  }
}

// --- import ----------------------------------------------------------------------------

async function importFile(argument: unknown): Promise<void> {
  const arg = recordOf(argument);
  const kind = await askKind(arg);
  if (kind === undefined) return;
  const source = await dialogs.pickFile({ title: t(kind === 'profiles' ? 'userConfig.importer.pickProfile' : 'userConfig.importer.pickCodes') });
  if (source === null) return;
  try {
    const name = await userFileImport(kind, source);
    const problems = await userConfig.load();
    const stem = name.replace(/\.json$/, '');
    // Only the problems of this folder's file: `x.json` in the other folder is another file.
    const own = problems.some(
      (p) => p.severity !== 'info' && p.kind === kind && (p.file === name || (kind === 'codes' && p.profileId === stem)),
    );
    status.show(t(own ? 'userConfig.importer.doneProblems' : 'userConfig.importer.done', { name }), own ? { error: true } : undefined);
  } catch (err) {
    status.show(t('userConfig.importer.failed'), { error: true, detail: detailOf(err) });
  }
}

// --- export ----------------------------------------------------------------------------

async function exportFile(argument: unknown): Promise<void> {
  const arg = recordOf(argument);
  const kind = await askKind(arg);
  if (kind === undefined) return;
  const name = await askFile(kind, arg);
  if (name === undefined) return;
  try {
    const bytes = await readBytes(await userFilePath(kind, name));
    const target = await dialogs.saveFile({ defaultPath: name });
    if (target === null) return;
    await writeBytes(target, bytes);
    status.show(t('userConfig.exporter.done', { name, file: baseName(target) }));
  } catch (err) {
    status.show(t('userConfig.exporter.failed', { name }), { error: true, detail: detailOf(err) });
  }
}

// --- reload ----------------------------------------------------------------------------

async function reload(): Promise<void> {
  const problems = (await userConfig.load()).filter((p) => p.severity !== 'info');
  const list = get(userConfig.files);
  const params = {
    profiles: list.filter((entry) => entry.kind === 'profiles').length,
    codes: list.filter((entry) => entry.kind === 'codes').length,
  };
  if (problems.length > 0) status.show(t('userConfig.reloaded.problems', { ...params, count: problems.length }), { error: true });
  else status.show(t('userConfig.reloaded.done', params));
}

// --- the test --------------------------------------------------------------------------

const hasDocument = (c: { activeDocId: string | null }): boolean => c.activeDocId !== null;

/** `0.4 ms`, `12 ms`; under a hundredth of a millisecond is "< 0.01 ms". */
export function formatMs(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 0.01) return t('userConfig.test.timeTiny');
  return t('userConfig.test.time', { ms: ms < 10 ? ms.toFixed(2) : Math.round(ms) });
}

function whatOf(row: TestRow): string {
  switch (row.kind) {
    case 'detect':
      return t('userConfig.test.what.detect');
    case 'veto':
      return t('userConfig.test.what.veto');
    case 'toolCall':
      return t('userConfig.test.what.toolCall');
    case 'programStart':
      return t('userConfig.test.what.programStart');
    case 'programEnd':
      return t('userConfig.test.what.programEnd');
    case 'outline':
      return t('userConfig.test.what.outline');
    case 'reference':
      return t('userConfig.test.what.reference');
    case 'numbering':
      return t('userConfig.test.what.numbering');
    case 'variant':
      return t('userConfig.test.what.variant');
    case 'stopped':
      return t('userConfig.test.what.stopped');
    default:
      return t('userConfig.test.what.variantResult');
  }
}

/** What the rule found, in plain words. */
function foundOf(row: TestRow): string {
  switch (row.kind) {
    case 'detect':
      if (row.counted === false) {
        return t('userConfig.test.found.detectVetoed', { text: row.captured, weight: row.weight ?? 0, line: row.vetoLine ?? 0 });
      }
      return t('userConfig.test.found.detect', { text: row.captured, weight: row.weight ?? 0 });
    case 'veto':
      return t('userConfig.test.found.veto', { text: row.captured });
    case 'toolCall':
      if (row.outcome === 'ignored') return t('userConfig.test.found.toolIgnored', { text: row.captured, by: row.ignoredBy ?? '' });
      if (row.outcome === 'tool-word') return t('userConfig.test.found.toolWord', { tool: row.tool ?? row.captured });
      return row.tool === null || row.tool === undefined
        ? t('userConfig.test.found.toolChangeNoTool', { text: row.captured })
        : t('userConfig.test.found.toolChange', { text: row.captured, tool: row.tool });
    case 'programStart':
      return t('userConfig.test.found.programStart', { text: row.captured });
    case 'programEnd':
      return t('userConfig.test.found.programEnd', { text: row.captured });
    case 'outline':
      return t('userConfig.test.found.outline', { kind: t(`userConfig.test.outlineKind.${(row.outlineKind ?? 'comment').replace(/-(\w)/g, (_m, c: string) => c.toUpperCase())}`), text: row.captured });
    case 'reference':
      if (row.target === null || row.target === undefined) return t('userConfig.test.found.referenceComputed', { text: row.captured });
      return t(row.rewrite === true ? 'userConfig.test.found.reference' : 'userConfig.test.found.referenceKept', {
        text: row.captured,
        target: row.target,
      });
    case 'numbering':
      return row.message ?? '';
    case 'stopped':
      return t('userConfig.test.found.stopped', { seconds: BUDGET_MS / 1000, count: row.lines ?? 0 });
    case 'variant':
      return t('userConfig.test.found.variant', { label: row.variantLabel ?? row.variant ?? '', choice: row.choice ?? '', text: row.captured, weight: row.weight ?? 0 });
    default:
      return t(row.acts === true ? 'userConfig.test.found.variantActs' : 'userConfig.test.found.variantUnsure', {
        label: row.variantLabel ?? row.variant ?? '',
        choice: row.choice ?? '',
        margin: row.margin ?? 0,
        needed: VARIANT_MARGIN,
        default: row.default ?? '',
      });
  }
}

/**
 * The Results panel for a test report. Rows past [`MAX_REPORT_ROWS`] are counted in
 * `dropped`, never silently cut.
 */
export function reportOf(report: TestReport, o: { document: string; profile: string; docId: string | undefined; detected: string | null }): ReportData {
  const rows = report.rows.slice(0, MAX_REPORT_ROWS).map((row) => ({
    line: row.line >= 1 ? row.line : null,
    what: whatOf(row),
    rule: row.rule,
    found: foundOf(row),
    time: formatMs(row.ms),
    slow: row.slow,
  }));
  const parts: string[] = [];
  if (o.detected !== null) parts.push(o.detected);
  if (report.truncated && report.stoppedAt === null) parts.push(t('userConfig.test.truncated', { max: MAX_REPORT_LINES }));
  if (report.slow.length > 0) {
    const worst = report.slow[0];
    parts.unshift(
      t('userConfig.test.slow', { count: report.slow.length, limit: SLOW_MS, ms: Math.round(worst.ms), line: worst.line, rule: worst.rule }),
    );
  }
  parts.push(t('userConfig.test.total', { ms: report.totalMs < 10 ? report.totalMs.toFixed(2) : Math.round(report.totalMs) }));
  return {
    title: t(report.rows.length === 0 ? 'userConfig.test.titleNone' : 'userConfig.test.title', { profile: o.profile, document: o.document }),
    message: parts.join(' '),
    columns: [
      { key: 'line', label: t('userConfig.test.columnLine') },
      { key: 'what', label: t('userConfig.test.columnWhat') },
      { key: 'rule', label: t('userConfig.test.columnRule') },
      { key: 'found', label: t('userConfig.test.columnFound') },
      { key: 'time', label: t('userConfig.test.columnTime') },
    ],
    rows,
    ...(o.docId === undefined ? {} : { docId: o.docId }),
    ...(report.rows.length > MAX_REPORT_ROWS ? { dropped: report.rows.length - MAX_REPORT_ROWS } : {}),
  };
}

/**
 * Tests a profile on the open program. With no argument it is the document's own profile
 * as the document reads it (its machine applied); `{ profileId }` tests another one — the
 * Profiles page's "Test" on a row — without changing the document's dialect.
 */
async function testOnDocument(argument: unknown): Promise<void> {
  const id = docs.getActiveId();
  const doc = id === null ? undefined : docs.get(id);
  if (id === null || doc === undefined) return;
  const wanted = recordOf(argument).profileId;
  const own = typeof wanted !== 'string' || wanted === doc.profileId;
  const profileId = own ? doc.profileId : (wanted as string);
  if (profiles.get(profileId) === undefined) {
    status.show(t('userConfig.test.unknownProfile', { id: profileId }), { error: true });
    return;
  }
  if (testing) {
    status.show(t('userConfig.test.running'));
    return;
  }

  const count = editor.getLineCount(id);
  const lines = count < 1 ? [] : editor.getLines(id, 1, count);
  const text = lines.slice(0, 4000).join('\n');
  // The document's own view carries its machine (the G-code system a machine chose). Another
  // profile is read as choosing it would start from: no machine, and the settings the program's
  // own markers point at (NC-11), exactly what `machines.effective` does for a document with
  // no machine.
  const view =
    own
      ? machines.effective(id)
      : (() => {
          const other = profiles.profile(profileId);
          const machine = effectiveMachine(other, null, 'none', profiles.detectVariants(profileId, text));
          const applied = profiles.effective(profileId, machine);
          return { cp: applied.cp, codes: applied.codes, machine };
        })();
  const detection = profiles.detectResult(doc.path, text, doc.profileId);
  testing = true;
  let report: TestReport;
  try {
    report = await testReportAsync({
      cp: view.cp,
      lines,
      codes: view.codes,
      machine: view.machine,
      detection,
      variants: profiles.detectVariants(profileId, text),
    });
  } finally {
    testing = false;
  }
  const detectedInfo = profiles.get(detection.id);
  const detected = detectedInfo === undefined ? detection.id : displayName(detectedInfo);
  results.show(
    reportOf(report, {
      document: doc.title,
      profile: displayName({ id: profileId, name: profileId }),
      docId: id,
      detected: t(detection.uncertain ? 'userConfig.test.detectedUncertain' : 'userConfig.test.detected', { profile: detected }),
    }),
  );
  status.show(t('userConfig.test.shown', { count: report.rows.length }));
}

/** A test is running; a second one waits for the user to ask again. */
let testing = false;

// --- the machines file -----------------------------------------------------------------

async function importMachines(): Promise<void> {
  const source = await dialogs.pickFile({ title: t('machines.transfer.pickTitle') });
  if (source === null) return;
  let parsed: unknown;
  try {
    // The size first (CODE-10): a file picked by mistake must not be read into the window.
    try {
      const [stat] = await filesStat([source], { partial: true });
      if (stat?.size != null && stat.size > MAX_BYTES) {
        status.show(t('machines.transfer.tooBig'), { error: true });
        return;
      }
    } catch {
      // No answer to the stat: the read below still checks the size it got.
    }
    const bytes = await readBytes(source);
    if (bytes.length > MAX_BYTES) {
      status.show(t('machines.transfer.tooBig'), { error: true });
      return;
    }
    // A byte-order mark is not part of the JSON.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^﻿/, '');
    parsed = JSON.parse(text);
  } catch (err) {
    status.show(t('machines.transfer.notJson'), { error: true, detail: detailOf(err) });
    return;
  }
  try {
    // The service says what happened in one line, and says why when it refuses.
    await machines.importMachines(parsed);
  } catch {
    // Reported by the service.
  }
}

async function exportMachines(): Promise<void> {
  try {
    // `machines_open_file` makes sure the file exists and grants this one file: what is
    // saved is the whole file as it is on disk (§4), unknown members and all.
    const bytes = await readBytes(await machinesOpenFile());
    const target = await dialogs.saveFile({ defaultPath: 'machines.json' });
    if (target === null) return;
    await writeBytes(target, bytes);
    status.show(t('machines.transfer.exported', { file: baseName(target) }));
  } catch (err) {
    status.show(t('machines.transfer.exportFailed'), { error: true, detail: detailOf(err) });
  }
}

export default {
  id: 'userConfig',
  commands: [
    {
      id: 'profile.newFrom',
      title: 'userConfig.newFrom',
      category: 'userConfig.category',
      global: true,
      run: (_c, arg) => dialogs.exclusive(() => newFrom(arg)),
    },
    {
      id: 'profile.open',
      title: 'userConfig.open',
      category: 'userConfig.category',
      global: true,
      run: (_c, arg) => dialogs.exclusive(() => openFile(arg)),
    },
    {
      id: 'profile.import',
      title: 'userConfig.import',
      category: 'userConfig.category',
      global: true,
      run: (_c, arg) => dialogs.exclusive(() => importFile(arg)),
    },
    {
      id: 'profile.export',
      title: 'userConfig.export',
      category: 'userConfig.category',
      global: true,
      run: (_c, arg) => dialogs.exclusive(() => exportFile(arg)),
    },
    {
      id: 'profile.reload',
      title: 'userConfig.reload',
      category: 'userConfig.category',
      global: true,
      run: () => reload(),
    },
    {
      id: 'profile.testOnDocument',
      title: 'userConfig.testOnDocument',
      category: 'userConfig.category',
      icon: asIcon(FlaskConical),
      global: true,
      enabled: hasDocument,
      run: (_c, arg) => testOnDocument(arg),
    },
    {
      id: 'machines.import',
      title: 'machines.import',
      category: 'machines.category',
      global: true,
      run: () => dialogs.exclusive(() => importMachines()),
    },
    {
      id: 'machines.export',
      title: 'machines.export',
      category: 'machines.category',
      global: true,
      run: () => dialogs.exclusive(() => exportMachines()),
    },
  ],
  // After the Channels group (order 60).
  ribbon: [{ tab: 'tools', group: 'userConfig.toolsGroup', command: 'profile.testOnDocument', order: 70 }],
  activate(): Disposable {
    // A save of a file in either folder reloads (AD-29): an edit takes effect at once.
    return files.onDidSave((_id, path) => {
      if (userConfig.kindOf(path) !== null) void userConfig.load();
    });
  },
} satisfies Contribution;
