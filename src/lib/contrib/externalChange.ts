// Files that change under the editor (plan §5 WP2.3, AD-10).
// One feature per file (plan AD-3); see ./README.md.
//
// Two lines of wiring: the banner is a `banner` panel, so `AppShell` renders it above the
// editor whenever the active document carries an external change, and `activate()` starts
// the poll. Everything else is `app/external.ts`.
//
// No commands: the banner's three buttons are the whole surface. Reload and Keep mine go
// straight to the service, and Compare runs WP2.5's `compare.withSaved`.

import ExternalChangeBanner from '$lib/components/editor/ExternalChangeBanner.svelte';
import { external } from '$lib/app/external';
import type { Contribution, Disposable } from '$lib/app/types';

export default {
  id: 'externalChange',
  panels: [
    {
      id: 'externalChange',
      region: 'banner',
      title: 'external.panelTitle',
      component: ExternalChangeBanner,
      order: 10,
    },
  ],
  activate(): Disposable {
    return external.start();
  },
} satisfies Contribution;
