// Motion colors: a colored mark beside every line that moves (Phase 3 plan AD-34, §6.6, §6.7;
// P3.7). One feature per file (plan AD-3); see ./README.md.
//
// The decorations are `monaco/motionColors.ts`, the kinds and the rules `core/nc/motion.ts`,
// the states `app/modalService.ts`. This file wires them to the real services and declares
// the one command: `view.toggleMotionColors` switches the setting `assist.motionColors`
// (Settings, Assistance, on by default). No key: it is a View-tab button and a palette entry,
// and §7.13 lists every default binding.

import Route from 'lucide-svelte/icons/route';
import { derived } from 'svelte/store';
import { modal } from '$lib/app/modalService';
import { asIcon } from '$lib/app/icons';
import { effectiveTheme } from '$lib/app/theme';
import { status } from '$lib/app/status';
import { isNcDocumentPath } from '$lib/core/profiles/ncDocument';
import { editor } from '$lib/monaco/editorService';
import { createMotionColors } from '$lib/monaco/motionColors';
import { docs } from '$lib/stores/documents';
import { machines } from '$lib/stores/machines';
import { profiles } from '$lib/stores/profiles';
import { settings } from '$lib/stores/settings';
import { t } from '$lib/i18n';
import type { Contribution, Disposable } from '$lib/app/types';

/** Switches the setting; the decorations follow the store. */
async function toggle(): Promise<void> {
  const next = !settings.get('assist.motionColors');
  await settings.save({ 'assist.motionColors': next });
  status.show(t(next ? 'motionColors.on' : 'motionColors.off'));
}

export default {
  id: 'motionColors',
  commands: [
    {
      id: 'view.toggleMotionColors',
      title: 'motionColors.toggle',
      category: 'motionColors.category',
      icon: asIcon(Route),
      global: true,
      run: () => toggle(),
    },
  ],
  // After Panels (10-30) and before Appearance (90).
  ribbon: [{ tab: 'view', group: 'motionColors.group', command: 'view.toggleMotionColors', order: 50 }],
  activate(): Disposable {
    const colors = createMotionColors({
      editor,
      docs,
      modal,
      effective: (id) => {
        const doc = docs.get(id);
        // A reload can remove a document's profile for a moment (AD-29): nothing to color then.
        if (doc === undefined || profiles.get(doc.profileId) === undefined) return null;
        const view = machines.effective(id);
        return { cp: view.cp, db: view.codes };
      },
      isNc: (id) => isNcDocumentPath(docs.get(id)?.path),
      enabled: derived(settings.values, (values) => values['assist.motionColors']),
      theme: effectiveTheme,
      machineRevision: machines.revision,
      profileRevision: profiles.revision,
      frame: (fn) => {
        if (typeof requestAnimationFrame !== 'function') {
          const handle = setTimeout(fn, 16);
          return () => clearTimeout(handle);
        }
        const handle = requestAnimationFrame(() => fn());
        return () => cancelAnimationFrame(handle);
      },
      schedule: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      },
      setProperty: (name, value) => {
        if (typeof document !== 'undefined') document.documentElement.style.setProperty(name, value);
      },
    });
    return colors.start();
  },
} satisfies Contribution;
