// The program map, in the left panel, and the two Monaco providers that read the same
// index (plan §5 WP1.5, WP3.5). One feature per file (plan AD-3); see ./README.md.
//
// `activate()` does three things and each of them is cheap:
//   - it starts `app/outlineService.ts`, which only installs listeners; no document is
//     indexed until something asks for one
//   - it registers the document-symbol provider (quick outline, sticky scroll) and the
//     folding-range provider, per profile, once Monaco is there
//   - the panel itself is registered declaratively, as before
//
// The providers need the Monaco instance, which is why `getMonaco()` appears in a
// contribution at all (README rule 10). It is the promise `EditorService` already holds:
// awaiting it here registers nothing early and loads nothing twice. A Monaco that cannot
// load leaves the app without providers, which is exactly what it leaves it without an
// editor — `EditorHost` reports that failure, so nothing is logged here.

import ProgramMapPanel from '$lib/components/panels/ProgramMapPanel.svelte';
import { outline } from '$lib/app/outlineService';
import { registerFolding } from '$lib/monaco/providers/folding';
import { registerSymbols } from '$lib/monaco/providers/symbols';
import { getMonaco } from '$lib/monaco/setup';
import { profiles } from '$lib/stores/profiles';
import type { Contribution, Disposable } from '$lib/app/types';

export default {
  id: 'programMap',
  panels: [
    {
      id: 'programMap',
      region: 'left',
      title: 'programMap.title',
      component: ProgramMapPanel,
      order: 10,
    },
  ],
  activate(): Disposable {
    let disposed = false;
    const stops: Disposable[] = [outline.start()];

    void getMonaco().then(
      (monaco) => {
        if (disposed) return;
        for (const info of profiles.list()) {
          stops.push(registerSymbols(monaco, info.id), registerFolding(monaco, info.id));
        }
      },
      () => {
        // EditorHost already shows the load error; there is nothing to add here.
      },
    );

    return () => {
      disposed = true;
      for (const stop of stops.reverse()) stop();
      stops.length = 0;
    };
  },
} satisfies Contribution;
