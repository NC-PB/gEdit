// Machine configurations and the effective view of a document (plan §7.15, AD-31).
// Owner: WP6.8 (the M6 prelude wrote the stub this replaces).
//
// The service owns two things that look like one:
//
//   the **set** — `machines.json`, read tolerantly, written whole, and the actions the
//   Machines page drives (add, edit, duplicate, remove, default, open the file);
//   the **effective view** — `effective(docId)`, the one entry point every NC feature uses
//   instead of reaching for a profile id.
//
// Four rules run through the file, and none of them may be bent:
//
//  1. **`effective(docId)` always answers.** The document profile's own defaults are the
//     worst case. No consumer ever has to handle "no view", so no consumer is tempted to
//     guess.
//  2. **An explicit machine wins over detection** (AD-31). Detection still runs — with a
//     machine it only produces the mismatch warning, which is shown once and acted on
//     never. gEdit does not change a machine setting because a program looks unusual.
//  3. **A write is refused while the file could not be read** (`blocked()`). Only
//     `openFile` and `replaceWithEmpty` are offered then, so a broken hand edit is never
//     overwritten behind the user's back.
//  4. **A hand edit wins.** Saving the machines document runs `reloadFromDisk()`, so the
//     next page action writes over fresh data and never over a stale in-memory copy.
//
// What is *not* here: how a number is read (`core/machines/numbers.ts`, WP6.9), the status
// item and the page (WP6.10), and the per-file memory of a choice (M7, WP7.5). The choice
// itself lives in this service and is mirrored into `DocMeta.machineId`, which is what
// WP7.5 persists.

import { writable } from 'svelte/store';
import { applyMachine, compatible, effectiveMachine } from '$lib/core/machines/effective';
import {
  emptyMachinesFile,
  keepPosition,
  parseMachinesFile,
  positionOf,
  serializeMachinesFile,
} from '$lib/core/machines/file';
import { MACHINES_VERSION } from '$lib/core/machines/types';
import { MAX_ID_LENGTH, MAX_MACHINES, validateMachine } from '$lib/core/machines/validate';
import { codes as appCodes } from '$lib/stores/codes';
import { docs as appDocs } from '$lib/stores/documents';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { status as appStatus } from '$lib/app/status';
import { configLoad, machinesOpenFile, machinesSave, type ConfigLoad } from '$lib/platform/commands';
import { editor as appEditor } from '$lib/monaco/editorService';
import { t } from '$lib/i18n';
import { isTauriRuntime } from '$lib/utils/platform';
import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';
import type { DocId, MachineService } from '$lib/app/types';
import type {
  EffectiveMachine,
  EffectiveProfile,
  MachineConfig,
  MachineProblem,
  ParsedMachinesFile,
} from '$lib/core/machines/types';

/** Everything the service reaches for, so a unit test never needs Tauri (AD-2). */
export interface MachineServiceDeps {
  docs: {
    get(id: DocId): { profileId: string; machineId?: string | null } | undefined;
    byPath(path: string): { id: DocId } | undefined;
    all(): { id: DocId; profileId: string }[];
    update(id: DocId, patch: { machineId?: string | null }): void;
  };
  profiles: {
    defaultId(): string;
    get(id: string): { chain: string[] } | undefined;
    profile(id: string): Profile;
    effective(id: string, eff: EffectiveMachine): EffectiveProfile;
    detectVariants(id: string, text: string): Record<string, { value: string; margin: number }>;
  };
  /** The resolved database of a dialect id, for the `modalInitial` check. */
  codeDb(dialect: string): CodeDb;
  /**
   * The document's text, for variant detection. Empty for a document with no model yet.
   *
   * The head of it is enough and is what the application hands over: detection reads the
   * first [`MAX_SNIFF_LINES`] non-empty lines and stops, and this is asked again whenever
   * the text changes, so materializing ten megabytes for it would be paid on every edit.
   */
  text(id: DocId): string;
  /**
   * A fingerprint of the document's text: the same number means the same program.
   *
   * It is what makes the detection below follow the text. Monaco's *alternative* version
   * goes back on undo, which is right here — undoing back to the program that was there
   * is the program that was there.
   */
  version(id: DocId): number;
  /** `machines_save`: the whole file, every time. */
  save(file: Record<string, unknown>): Promise<void>;
  /** A fresh `config_load`, for `reloadFromDisk`. */
  reload(): Promise<ConfigLoad>;
  /** `machines_open_file`, then the editor opens the path it answers. */
  openFile(): Promise<string>;
  open(paths: string[]): Promise<unknown>;
  notify(text: string, o?: { error?: boolean; detail?: string }): void;
  /** False in a plain browser build, where there is no file to read or write. */
  isTauri(): boolean;
}

/**
 * How many lines of a document are handed to variant detection.
 *
 * Detection scores the first `MAX_SNIFF_LINES` (400) **non-empty** lines, so this is that
 * window with room for blank lines and a header, and not a second limit of its own. It
 * keeps the read bounded: the text is asked for again whenever the document changes, and
 * a turning program can be ten megabytes.
 */
const DETECT_LINES = 4000;

/** English detail for anything thrown across the IPC boundary. */
function detailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `Lathe 2 (IS-B)` → `lathe-2-is-b`; empty or all-punctuation names fall back to `machine`. */
export function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    // The combining marks NFKD just split off, so "Drehmaschine Ö" gives `drehmaschine-o`.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? 'machine' : slug;
}

/**
 * The first free id built from `name`: `lathe-2`, then `lathe-2-2`, `lathe-2-3`, …
 *
 * The slug is cut so that the suffix still fits inside [`MAX_ID_LENGTH`]: a fixed cut of
 * 61 characters left room for two suffix digits and produced a 65-character id from the
 * hundredth collision, which `validateMachine` then refused with a message about the file
 * rather than about the name the user had typed (G8 M6).
 */
function freeId(name: string, taken: ReadonlySet<string>): string {
  const base = slugOf(name);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = String(n);
    const candidate = `${base.slice(0, MAX_ID_LENGTH - 1 - suffix.length)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`no free id for "${name}"`);
}

/**
 * `setForDoc(docId, undefined)`: this document follows its profile's default machine.
 *
 * It is recorded rather than deleted, because the mirror in `DocMeta.machineId` outlives
 * the deletion. `docs.update` reads an `undefined` member as "not part of this patch"
 * (P1 store rule), so the mirror cannot be cleared through it; the service therefore
 * keeps the authority, and `choiceOf` maps this back to `undefined` for every reader.
 *
 * **M7/WP7.5**, which persists `DocMeta.machineId`, has to clear the mirror when it
 * writes a reset, or the choice comes back with the next start of the application.
 */
const FOLLOW_DEFAULT = Symbol('follow the profile default');

function byName(a: MachineConfig, b: MachineConfig): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

export function createMachineService(deps: MachineServiceDeps): MachineService {
  const list = writable<MachineConfig[]>([]);
  const revision = writable(0);
  /** The published revision, kept next to the store so a read costs no subscription. */
  let rev = 0;

  /** The last `config_load`, for `paths.machinesFile` and the file it carried. */
  let config: ConfigLoad | null = null;
  /** `machines.json` as it was last read. */
  let file: ParsedMachinesFile = emptyMachinesFile();
  /** The file as a whole could not be used; every write is refused (rule 3). */
  let fileError: string | null = null;
  /** The file carries a newer `$version`: it is read and never written (AD-31 Storage). */
  let readOnly = false;
  /** Per record id, what its base profile made of it. Empty problems = selectable. */
  let checks = new Map<string, MachineProblem[]>();

  /**
   * The explicit choice per document; `null` is an explicit "none" and [`FOLLOW_DEFAULT`]
   * is "no choice of my own, follow the profile's default machine" (§7.15).
   *
   * The third state needs a value of its own: deleting the entry only falls back to
   * `DocMeta.machineId`, which still carries the id that was chosen, so resetting a
   * document to the profile default did nothing at all (G8 M6).
   */
  const choices = new Map<DocId, string | null | typeof FOLLOW_DEFAULT>();
  /** One effective view per document, dropped when anything it was built from changed. */
  const views = new Map<DocId, { profileId: string; signature: string; view: EffectiveProfile }>();
  /** What the variant rules made of a document's text, per profile and text version. */
  const detected = new Map<
    DocId,
    { profileId: string; version: number; result: Record<string, { value: string; margin: number }> }
  >();
  /** Documents whose mismatch warning has been shown, so it is shown once per open. */
  const warned = new Set<DocId>();
  /** Documents already told that their machine went away or stopped fitting. */
  const toldAboutFallback = new Set<DocId>();

  // ---------------------------------------------------------------------
  // The set
  // ---------------------------------------------------------------------

  /** The profile of a document, falling back to the default one for an id nobody knows. */
  function profileIdOf(docId: DocId): string {
    const wanted = deps.docs.get(docId)?.profileId;
    return wanted !== undefined && deps.profiles.get(wanted) !== undefined ? wanted : deps.profiles.defaultId();
  }

  function chainOf(profileId: string): string[] {
    return deps.profiles.get(profileId)?.chain ?? [profileId];
  }

  /** The code database a record's own variants resolve to, or undefined when it has no profile. */
  function codesFor(m: MachineConfig, profile: Profile): CodeDb | undefined {
    try {
      return deps.codeDb(applyMachine(profile, effectiveMachine(profile, m, 'document', {})).codes);
    } catch {
      return undefined;
    }
  }

  /** The JSON path of a record **in the file**, which is what a problem has to point at. */
  function pathOf(machine: MachineConfig, fallback: number): string {
    return `machines[${positionOf(machine) ?? fallback}]`;
  }

  /** Re-runs the profile-level rules over every record and republishes `list`. */
  function revalidate(): void {
    checks = new Map();
    file.machines.forEach((machine, index) => {
      const known = deps.profiles.get(machine.profile) !== undefined;
      const profile = known ? deps.profiles.profile(machine.profile) : undefined;
      checks.set(
        machine.id,
        validateMachine(machine, {
          path: pathOf(machine, index),
          profile,
          codes: profile === undefined ? undefined : codesFor(machine, profile),
        }),
      );
    });
    list.set([...file.machines].sort(byName));
  }

  /** True when this record may be chosen: the file gave it and its profile understood it. */
  function usable(m: MachineConfig | undefined): m is MachineConfig {
    return m !== undefined && (checks.get(m.id)?.length ?? 0) === 0;
  }

  function record(id: string): MachineConfig | undefined {
    return file.machines.find((machine) => machine.id === id);
  }

  /** Every cached view is stale: a machine, the set or the file changed. */
  function invalidate(): void {
    views.clear();
    forget();
    bump();
  }

  /** One step of `revision`, which is what every consumer watches for a machine change. */
  function bump(): void {
    rev += 1;
    revision.set(rev);
  }

  /** Drops what is remembered about documents that are no longer open. */
  function forget(): void {
    let open: Set<DocId>;
    try {
      open = new Set(deps.docs.all().map((doc) => doc.id));
    } catch {
      return;
    }
    for (const map of [views, detected]) {
      for (const id of [...map.keys()]) if (!open.has(id)) map.delete(id);
    }
    for (const set of [warned, toldAboutFallback]) {
      for (const id of [...set]) if (!open.has(id)) set.delete(id);
    }
    for (const id of [...choices.keys()]) if (!open.has(id)) choices.delete(id);
  }

  /** Applies what a `config_load` said about `machines.json`. Never throws. */
  function apply(loaded: ConfigLoad): void {
    config = loaded;
    let parsed: ParsedMachinesFile;
    try {
      parsed = parseMachinesFile(loaded.machines);
    } catch (err) {
      parsed = { ...emptyMachinesFile(), error: detailOf(err) };
    }
    readOnly = parsed.version > MACHINES_VERSION;
    // Rust reports a newer `$version` as an error **and** hands over the contents: the
    // records are usable, only the file may not be written (AD-31 Storage). Anything else
    // it reports means the file itself is unusable and nothing in it is active.
    fileError = parsed.error ?? (readOnly ? null : (loaded.machinesError ?? null));
    file = fileError === null ? parsed : emptyMachinesFile();
    revalidate();
    invalidate();
  }

  /**
   * A message raised from a **read** rather than from a command.
   *
   * `effective(docId)` is called from places that are only looking: the status item reads it
   * inside a `$derived`, and so will the inspector and per-file memory. Svelte 5 forbids
   * writing to state from inside a derivation (`state_unsafe_mutation`), and the status bar
   * subscribes to the message store — so a warning said straight from a read throws, the
   * caller gets nothing back, and the item it came from stays on the previous document.
   *
   * These messages carry no answer, so they go out after the current task instead. They are
   * still said once, still per document, and a microtask lands long before anything the user
   * or a scenario can observe.
   */
  function notifyFromRead(text: string): void {
    queueMicrotask(() => deps.notify(text));
  }

  /**
   * Writes `next` and adopts it only when the write went through, so a failed save leaves
   * the app showing exactly what is still on disk.
   */
  async function persist(next: ParsedMachinesFile): Promise<void> {
    if (blocked()) {
      const message = t('machines.fileBlocked');
      deps.notify(message, { error: true, detail: fileError ?? t('machines.fileReadOnly') });
      throw new Error(fileError ?? message);
    }
    if (deps.isTauri()) {
      try {
        await deps.save(serializeMachinesFile(next));
      } catch (err) {
        deps.notify(t('machines.saveFailed'), { error: true, detail: detailOf(err) });
        throw err instanceof Error ? err : new Error(detailOf(err));
      }
    }
    file = next;
    revalidate();
    invalidate();
  }

  /** `file` with `machines` replaced; the invalid records and unknown members ride along. */
  function withMachines(machines: MachineConfig[], defaults = file.defaults): ParsedMachinesFile {
    return { ...file, machines, defaults };
  }

  /**
   * Room for one more record.
   *
   * `parseMachinesFile` enforces the cap of §7.15 when the file is **read**, so a record
   * written past it is listed as invalid the next time the file comes back from disk —
   * it disappears from the list without the action having said no (G8 M6). Every path
   * that adds a record asks here first: `add`, `duplicate`, and M12's import.
   */
  function assertRoom(): void {
    if (file.machines.length >= MAX_MACHINES) {
      throw new Error(`a machines file holds at most ${MAX_MACHINES} machines`);
    }
  }

  /**
   * A record that is about to be written has to be one the profile understands: writing an
   * invalid machine would put a record in the file that is listed as broken the moment it
   * is read back.
   */
  function checkBeforeWrite(machine: MachineConfig, at: number): void {
    const known = deps.profiles.get(machine.profile) !== undefined;
    const profile = known ? deps.profiles.profile(machine.profile) : undefined;
    const problems = validateMachine(machine, {
      path: pathOf(machine, at),
      profile,
      codes: profile === undefined ? undefined : codesFor(machine, profile),
    });
    if (problems.length > 0) {
      throw new Error(problems.map((problem) => `${problem.path}: ${problem.message}`).join('; '));
    }
  }

  function blocked(): boolean {
    return fileError !== null || readOnly;
  }

  // ---------------------------------------------------------------------
  // The effective view
  // ---------------------------------------------------------------------

  /** The text version, or 0 where there is no model to ask. */
  function versionOf(docId: DocId): number {
    try {
      return deps.version(docId);
    } catch {
      return 0;
    }
  }

  /**
   * What the variant rules make of this document's text; computed once per profile and
   * per version of the text.
   *
   * Two things used to keep the first answer for the life of the document (G8 M6):
   *
   *  - a program that was **replaced** — pasted over, reverted, rewritten by a script —
   *    was still read in the G-code system of the program that stood there before;
   *  - the first caller decided, and a caller that arrives before the model has any
   *    content at all (`deps.text` answers `''`) pinned the variant to the profile's
   *    default for good.
   *
   * So the version is part of the key, and an answer computed from no text is used once
   * and not remembered.
   */
  function detectionFor(docId: DocId, profileId: string): Record<string, { value: string; margin: number }> {
    const version = versionOf(docId);
    const cached = detected.get(docId);
    if (cached && cached.profileId === profileId && cached.version === version) return cached.result;

    let text = '';
    try {
      text = deps.text(docId);
    } catch {
      text = '';
    }
    let result: Record<string, { value: string; margin: number }> = {};
    try {
      result = deps.profiles.detectVariants(profileId, text);
    } catch {
      result = {};
    }
    if (text !== '') detected.set(docId, { profileId, version, result });
    return result;
  }

  /** The explicit choice of a document: the service's own, else what `DocMeta` carries (M7). */
  function choiceOf(docId: DocId): string | null | undefined {
    if (choices.has(docId)) {
      const own = choices.get(docId);
      return own === FOLLOW_DEFAULT ? undefined : own;
    }
    return deps.docs.get(docId)?.machineId;
  }

  /**
   * Which machine a document uses, in the AD-31 order: an explicit choice (an id, or an
   * explicit "none"), then the base profile's default machine, then none.
   *
   * A chosen id that no longer exists, is not understood, or does not fit the document's
   * profile any more falls through to the default — with one message, because a silent
   * fallback is exactly the case where a program would be read differently than the user
   * thinks.
   */
  function resolveChoice(
    docId: DocId,
    profileId: string,
  ): { machine: MachineConfig | null; choice: EffectiveMachine['choice'] } {
    const chain = chainOf(profileId);
    const wanted = choiceOf(docId);
    if (wanted === null) return { machine: null, choice: 'document' };
    if (typeof wanted === 'string') {
      const chosen = record(wanted);
      if (usable(chosen) && compatible(chosen, chain)) return { machine: chosen, choice: 'document' };
      if (!toldAboutFallback.has(docId)) {
        toldAboutFallback.add(docId);
        // Three different reasons, three different sentences: "gone", "not for this
        // profile" and "the file says something I cannot use" send the user to three
        // different places, and a wrong one wastes the search.
        notifyFromRead(
          chosen === undefined
            ? t('machines.gone')
            : compatible(chosen, chain)
              ? t('machines.unusable', { name: chosen.name })
              : t('machines.incompatible', { name: chosen.name }),
        );
      }
    }

    const fallback = defaultFor(profileId);
    const byDefault = fallback === null ? undefined : record(fallback);
    if (usable(byDefault) && compatible(byDefault, chain)) return { machine: byDefault, choice: 'default' };
    return { machine: null, choice: 'none' };
  }

  function defaultFor(profileId: string): string | null {
    // The chain, not just the id: a user profile that extends `fanuc-lathe` (M12) uses the
    // Fanuc-lathe default without having to repeat it.
    const chain = chainOf(profileId);
    for (const step of chain) {
      const wanted = file.defaults[step];
      if (typeof wanted !== 'string') continue;
      const machine = record(wanted);
      if (usable(machine) && compatible(machine, chain)) return machine.id;
    }
    return null;
  }

  /** The mismatch warning of AD-31: said once per document, and nothing is changed by it. */
  function warnAboutMismatch(docId: DocId, eff: EffectiveMachine, profile: Profile): void {
    if (eff.mismatch === null || warned.has(docId)) return;
    warned.add(docId);
    const declared = (profile.machineParams?.variants ?? []).find(
      (variant) => variant.id === eff.mismatch?.variant,
    );
    notifyFromRead(
      t('machines.mismatch', {
        label: declared?.label ?? eff.mismatch.variant,
        detected: eff.mismatch.detected,
        chosen: eff.mismatch.chosen,
        name: eff.name ?? '',
      }),
    );
  }

  return {
    list: { subscribe: list.subscribe },
    revision: { subscribe: revision.subscribe },

    load(c: ConfigLoad): void {
      try {
        apply(c);
      } catch {
        // Startup never fails over this file: the defaults apply and `problems()` says why.
        config = c;
        file = emptyMachinesFile();
        readOnly = false;
        fileError = c.machinesError ?? 'machines.json could not be read';
        revalidate();
        invalidate();
      }
      if (fileError !== null) {
        deps.notify(t('machines.fileUnreadable'), { error: true, detail: fileError });
      } else if (readOnly) {
        deps.notify(t('machines.fileReadOnly'), {
          error: true,
          ...(c.machinesError === null ? {} : { detail: c.machinesError }),
        });
      }
    },

    async reloadFromDisk(): Promise<void> {
      if (!deps.isTauri()) return;
      let loaded: ConfigLoad;
      try {
        loaded = await deps.reload();
      } catch (err) {
        deps.notify(t('machines.reloadFailed'), { error: true, detail: detailOf(err) });
        return;
      }
      apply(loaded);
      if (fileError !== null) {
        deps.notify(t('machines.fileUnreadable'), { error: true, detail: fileError });
      }
    },

    isMachinesDocument(id: DocId): boolean {
      const path = config?.paths.machinesFile;
      if (path === undefined || path === '') return false;
      return deps.docs.byPath(path)?.id === id;
    },

    problems(): MachineProblem[] {
      const out: MachineProblem[] = [];
      if (fileError !== null) out.push({ machineId: null, path: '', message: fileError });
      if (readOnly) out.push({ machineId: null, path: '$version', message: t('machines.fileReadOnly') });
      for (const entry of file.invalid) out.push(...entry.problems);
      for (const machine of file.machines) out.push(...(checks.get(machine.id) ?? []));
      return out;
    },

    blocked,

    async replaceWithEmpty(): Promise<void> {
      // The one write that is allowed while the file is unusable: Rust rescues what is
      // there as `machines.json.bak` and puts an empty file in its place.
      if (deps.isTauri()) {
        try {
          await deps.save(serializeMachinesFile(emptyMachinesFile()));
        } catch (err) {
          deps.notify(t('machines.saveFailed'), { error: true, detail: detailOf(err) });
          throw err instanceof Error ? err : new Error(detailOf(err));
        }
      }
      file = emptyMachinesFile();
      fileError = null;
      readOnly = false;
      revalidate();
      invalidate();
    },

    get(id: string): MachineConfig | undefined {
      return record(id);
    },

    compatibleWith(profileId: string): MachineConfig[] {
      const chain = chainOf(profileId);
      return file.machines.filter((m) => usable(m) && compatible(m, chain)).sort(byName);
    },

    defaultFor,

    async add(m: Omit<MachineConfig, 'id'>): Promise<string> {
      assertRoom();
      const taken = new Set(file.machines.map((machine) => machine.id));
      const machine: MachineConfig = { ...m, id: freeId(m.name, taken), params: { ...m.params } };
      checkBeforeWrite(machine, file.machines.length);
      await persist(withMachines([...file.machines, machine]));
      return machine.id;
    },

    async update(id: string, patch: Partial<Omit<MachineConfig, 'id'>>): Promise<void> {
      const at = file.machines.findIndex((machine) => machine.id === id);
      if (at < 0) throw new Error(`no machine "${id}"`);
      const previous = file.machines[at];
      // Spread the stored record, so every member this build does not know survives the
      // edit; `params` is replaced whole, because a machine keeps the full value of the
      // preset it was given (§7.15) and a field merge would blend two presets.
      const machine = keepPosition(
        { ...previous, ...patch, id, params: { ...(patch.params ?? previous.params) } },
        previous,
      );
      checkBeforeWrite(machine, at);
      await persist(withMachines(file.machines.map((entry, index) => (index === at ? machine : entry))));
    },

    async duplicate(id: string, name: string): Promise<string> {
      const source = record(id);
      if (source === undefined) throw new Error(`no machine "${id}"`);
      assertRoom();
      const taken = new Set(file.machines.map((machine) => machine.id));
      const copy: MachineConfig = {
        ...source,
        id: freeId(name, taken),
        name,
        params: structuredClone(source.params),
      };
      checkBeforeWrite(copy, file.machines.length);
      await persist(withMachines([...file.machines, copy]));
      return copy.id;
    },

    async remove(id: string): Promise<void> {
      const machine = record(id);
      if (machine === undefined) throw new Error(`no machine "${id}"`);
      const defaults = { ...file.defaults };
      for (const [profileId, wanted] of Object.entries(defaults)) {
        if (wanted === id) delete defaults[profileId];
      }
      const affected = deps.docs.all().filter((doc) => choiceOf(doc.id) === id);
      await persist(withMachines(file.machines.filter((entry) => entry.id !== id), defaults));
      for (const doc of affected) {
        // The choice is dropped, not rewritten: the document falls back to its profile's
        // default machine, or to none, which is what AD-31 asks for. `DocMeta.machineId`
        // keeps the vanished id, and a vanished id is ignored everywhere (AD-31, M7).
        choices.delete(doc.id);
        views.delete(doc.id);
        toldAboutFallback.add(doc.id);
      }
      // One message, whatever the count (AD-31): the documents were re-evaluated, and the
      // user is told which machine went away rather than once per document.
      deps.notify(
        affected.length === 0
          ? t('machines.removedNone', { name: machine.name })
          : t('machines.removed', { name: machine.name, count: affected.length }),
      );
    },

    async setDefault(profileId: string, id: string | null): Promise<void> {
      const defaults = { ...file.defaults };
      if (id === null) delete defaults[profileId];
      else {
        const machine = record(id);
        if (!usable(machine)) throw new Error(`no machine "${id}"`);
        if (!compatible(machine, chainOf(profileId))) {
          throw new Error(`machine "${id}" is not for the profile "${profileId}"`);
        }
        defaults[profileId] = id;
      }
      await persist(withMachines(file.machines, defaults));
    },

    async openFile(): Promise<void> {
      let path: string;
      try {
        path = await deps.openFile();
      } catch (err) {
        deps.notify(t('machines.openFileFailed'), { error: true, detail: detailOf(err) });
        throw err instanceof Error ? err : new Error(detailOf(err));
      }
      await deps.open([path]);
    },

    effective(docId: DocId): EffectiveProfile {
      const profileId = profileIdOf(docId);
      const wanted = choiceOf(docId);
      // The text version is part of it: without a machine the variant comes out of the
      // program, so a document whose program was replaced has to be looked at again.
      const signature = `${wanted === undefined ? '' : (wanted ?? 'none')}|${rev}|${versionOf(docId)}`;
      const cached = views.get(docId);
      if (cached && cached.profileId === profileId && cached.signature === signature) return cached.view;

      const profile = deps.profiles.profile(profileId);
      const { machine, choice } = resolveChoice(docId, profileId);
      // Detection runs whether or not a machine is chosen: without one it decides the
      // variant, with one it can only disagree out loud (AD-31).
      const eff = effectiveMachine(profile, machine, choice, detectionFor(docId, profileId));
      // The registry caches a compiled profile by `eff.key`, which holds the **parameters**
      // and nothing else — two documents with the same settings share one compile, exactly
      // as AD-31 asks. But the machine itself is not shared: its name, why it was chosen
      // and its mismatch belong to this document, and the status item shows them. So the
      // compile is reused and the machine is this document's own.
      const compiled = deps.profiles.effective(profileId, eff);
      const view: EffectiveProfile = compiled.machine === eff ? compiled : { ...compiled, machine: eff };
      views.set(docId, { profileId, signature, view });
      warnAboutMismatch(docId, eff, profile);
      return view;
    },

    setForDoc(docId: DocId, id: string | null | undefined): void {
      choices.set(docId, id === undefined ? FOLLOW_DEFAULT : id);
      // `DocMeta.machineId` is the mirror WP7.5 persists; the service keeps the authority,
      // because `docs.update` cannot put a member back to `undefined` (P1 store rule).
      if (id !== undefined) deps.docs.update(docId, { machineId: id });
      views.delete(docId);
      warned.delete(docId);
      toldAboutFallback.delete(docId);
      bump();
    },
  };
}

/** The application-wide machine service. */
export const machines: MachineService = createMachineService({
  docs: {
    get: (id) => appDocs.get(id),
    byPath: (path) => appDocs.byPath(path),
    all: () => appDocs.all(),
    update: (id, patch) => appDocs.update(id, patch),
  },
  profiles: appProfiles,
  codeDb: (dialect) => appCodes.byId(dialect),
  // The head of the document, not the whole of it: `detectVariants` stops after 400
  // non-empty lines, and this is read again on every change of the text.
  text: (id) => appEditor.getLines(id, 1, DETECT_LINES).join('\n'),
  version: (id) => appEditor.versionId(id),
  save: machinesSave,
  reload: configLoad,
  openFile: machinesOpenFile,
  // Imported lazily: `app/fileOps` pulls in the whole file pipeline, and only this one
  // action needs it. Nothing else in the service touches a document's content.
  open: async (paths) => (await import('$lib/app/fileOps')).files.open(paths),
  notify: (text, o) => appStatus.show(text, o),
  isTauri: isTauriRuntime,
});
