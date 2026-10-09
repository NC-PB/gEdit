// The modal state of every open document (Phase 3 plan P3.1, AD-33; §7 #211). One feature per
// file (plan AD-3); see ./README.md.
//
// It declares nothing a user sees: it starts `app/modalService.ts`, which keeps one modal
// index per open document, fed by the editor's content changes and built in idle slices of at
// most 16 ms, and drops them all when the contributions are torn down. The inspector, the
// hover and the motion colours read the service (`ctx.modal`) and need it running whether or
// not a panel is open, which is why it starts here and not in a panel, as `programMap.ts`
// starts the outline.

import { modal } from '$lib/app/modalService';
import type { Contribution, Disposable } from '$lib/app/types';

export default {
  id: 'modal',
  activate(): Disposable {
    return modal.start();
  },
} satisfies Contribution;
