// What the Results panel shows (plan §7.3). Owner: **WP4.1** — written by P4.
//
// One report at a time, held in a plain `svelte/store` (AD-2). A transform's skipped
// lines, a script's `report` output and, later, find-all all end up here, which is why
// `ReportData` is a display shape (already-translated strings) and not a transform type.
//
// The store is deliberately dumb: it does not reveal the panel, and it does not clear
// itself when a document closes. `contrib/results.ts` owns those policies, because
// "show the panel" is a UI decision and this module is imported by services that must
// not make one.

import { derived, writable } from 'svelte/store';
import type { ReportData, ResultsService } from '$lib/app/types';

const current = writable<ReportData | null>(null);

export const results: ResultsService = {
  // `derived` rather than the writable itself, so `set` does not leak out (as in stores/layout.ts).
  current: derived(current, (r) => r),
  show(r: ReportData) {
    current.set(r);
  },
  clear() {
    current.set(null);
  },
};
