// Remembering the panel layout across restarts (plan §5 WP2.3, §7.7 `ui.layout`).
// One feature per file (plan AD-3); see ./README.md.
//
// No commands, no ribbon, no strings: this contribution only connects two things that
// already exist — `stores/layout.ts`, which owns the live layout, and `stores/uiState.ts`,
// which owns the `ui` member of `state.json`.
//
// Order matters twice:
//   - `bootstrap` awaits `uiState.load()` before the contributions run, so the saved
//     layout is already in memory here (P2 §5);
//   - the subscription is installed *after* `restore()`, and its first emission — the
//     value that was just restored — compares equal to what was read, so reading the file
//     never writes it straight back.
//
// The debounce lives in the store: dragging a splitter emits on every pointer move and
// still writes once, a second after the pointer stops. `files.onWillQuit` flushes what is
// left, which is the only reason a quit ever waits for this feature.

import { files } from '$lib/app/fileOps';
import { layout } from '$lib/stores/layout';
import { uiState } from '$lib/stores/uiState';
import { get } from 'svelte/store';
import type { Contribution, Disposable, LayoutState } from '$lib/app/types';

/**
 * What is worth remembering: the two docked regions. `overlay` is deliberately left out —
 * it names a mode (a comparison, WP2.5), not a layout, and restoring it would open an
 * overlay panel at startup for a session that no longer exists.
 */
export function persistable(state: LayoutState): Partial<LayoutState> {
  return { left: state.left, bottom: state.bottom };
}

export default {
  id: 'layoutPersist',
  activate(): Disposable {
    const saved = get(uiState.state).layout;
    // `restore` keeps the current value for every member it is not given, and clamps the
    // sizes it is, so a hand-edited file cannot produce a panel that covers the editor.
    if (Object.keys(saved).length > 0) layout.restore({ left: saved.left, bottom: saved.bottom });

    // Taken after `restore()`, so the subscription's first emission — the value that was
    // just read from the file — is recognised as "nothing changed" and never written back.
    // It also swallows the emissions that only open or close the overlay.
    let last = JSON.stringify(persistable(get(layout.state)));
    const stop = layout.state.subscribe((state) => {
      const next = persistable(state);
      const encoded = JSON.stringify(next);
      if (encoded === last) return;
      last = encoded;
      uiState.update((s) => ({ ...s, layout: next }));
    });
    const offQuit = files.onWillQuit(() => uiState.flush());

    return () => {
      offQuit();
      stop();
    };
  },
} satisfies Contribution;
