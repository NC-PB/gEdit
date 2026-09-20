// The contribution loader (plan AD-3). Owner: WP1.1.
//
// Every feature is one file in `src/lib/contrib/`. They are loaded eagerly, sorted by file
// name, and what their default export declares is registered before `activate()` runs.
// A contribution that throws is logged and skipped, with its own registrations rolled
// back, so one broken feature cannot take the window down.
//
// `registerContributions` is the testable half: it takes the list instead of globbing, so
// a unit test never has to evaluate every real contribution module.

import { commands } from '$lib/app/registry/commands';
import { keybindingRemovals } from '$lib/app/registry/keybindings';
import { panels } from '$lib/app/registry/panels';
import { ribbon } from '$lib/app/registry/ribbon';
import { statusItems } from '$lib/app/registry/statusItems';
import type { Contribution, Disposable } from '$lib/app/types';

function dispose(disposers: Disposable[]): void {
  for (const d of disposers.reverse()) {
    try {
      d();
    } catch (err) {
      console.error('contribution disposer failed', err);
    }
  }
}

/** Registers one contribution. Returns its disposers, or undefined when it failed. */
async function register(c: Contribution): Promise<Disposable[] | undefined> {
  const local: Disposable[] = [];
  try {
    if (c.commands?.length) local.push(commands.register(c.commands));
    if (c.ribbon?.length) local.push(ribbon.add(c.ribbon));
    for (const g of c.ribbonGroups ?? []) local.push(ribbon.addGroup(g));
    for (const p of c.panels ?? []) local.push(panels.add(p));
    for (const s of c.statusItems ?? []) local.push(statusItems.add(s));
    if (c.keybindingRemovals?.length) local.push(keybindingRemovals.add(c.keybindingRemovals));
    const activated = await c.activate?.();
    if (typeof activated === 'function') local.push(activated);
    return local;
  } catch (err) {
    console.error(`contribution "${c.id}" failed to load`, err);
    dispose(local);
    return undefined;
  }
}

/**
 * Registers `list` in order. The returned disposer undoes every registration in reverse
 * order and is safe to call twice.
 */
export async function registerContributions(list: Contribution[]): Promise<Disposable> {
  const disposers: Disposable[] = [];
  for (const c of list) {
    if (!c || typeof c.id !== 'string' || !c.id) {
      console.error('contribution: the default export has no id', c);
      continue;
    }
    const local = await register(c);
    if (local) disposers.push(...local);
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    dispose(disposers);
    disposers.length = 0;
  };
}

/** The contribution modules, sorted by file name. Colocated tests are excluded (P1 D6). */
export function contributionModules(): Contribution[] {
  const modules = import.meta.glob<{ default: Contribution }>(
    ['../contrib/*.ts', '!../contrib/*.test.ts'],
    { eager: true },
  );
  return Object.keys(modules)
    .sort()
    .map((path) => modules[path]?.default)
    .filter((c): c is Contribution => Boolean(c));
}

/** Loads every `src/lib/contrib/*.ts` and registers it. Called once by `app/bootstrap.ts`. */
export function loadContributions(): Promise<Disposable> {
  return registerContributions(contributionModules());
}
