// The Results panel, in the bottom region (plan §5 WP4.1). Owner: WP4.1.
// One feature per file (plan AD-3); see ./README.md.
//
// `stores/results.ts` is deliberately dumb — it holds one report and nothing else — so
// the two policies around it live here, where a UI decision belongs:
//
//   1. **A new report reveals the panel.** A transform that skipped eleven lines, or a
//      script that produced a report, has something the user has to see; leaving it
//      behind a collapsed panel is the same as not reporting it. The panel shares the
//      bottom region with Output, so revealing it is `layout.show`, not a new region.
//   2. **A report dies with its document.** The lines of a report point into one
//      document; once that tab is closed they point nowhere, and a click would reveal a
//      line of whatever took its place.
//
// Both are subscriptions, not commands: nothing has to be registered for them, and the
// disposer tears them down again. `view.toggleBottomPanel` and the panel's own tab strip
// are how the user opens the panel by hand — this file adds no command of its own, and
// §7.11 stays as it is.

import ResultsPanel from '$lib/components/panels/ResultsPanel.svelte';
import { docs } from '$lib/stores/documents';
import { layout } from '$lib/stores/layout';
import { results } from '$lib/stores/results';
import type { Contribution, Disposable, ReportData } from '$lib/app/types';

/** The id the panel registers under; `layout.show` takes it. */
export const RESULTS_PANEL_ID = 'results';

export default {
  id: 'results',
  panels: [
    {
      id: RESULTS_PANEL_ID,
      region: 'bottom',
      title: 'results.title',
      component: ResultsPanel,
      order: 20,
    },
  ],
  activate(): Disposable {
    /** The report the reveal below has already acted on, so a re-render reveals nothing. */
    let shown: ReportData | null = null;

    const stopReports = results.current.subscribe((report) => {
      if (report === null || report === shown) {
        shown = report;
        return;
      }
      shown = report;
      layout.show(RESULTS_PANEL_ID);
    });

    const stopDocs = docs.list.subscribe((list) => {
      const docId = shown?.docId;
      if (docId === undefined) return;
      if (!list.some((doc) => doc.id === docId)) results.clear();
    });

    return () => {
      stopDocs();
      stopReports();
    };
  },
} satisfies Contribution;
