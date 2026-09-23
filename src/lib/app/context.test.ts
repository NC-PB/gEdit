// `ctx` is what the runtime harness drives the app through (plan §7.9), so it has to keep
// every service the milestone promises. Importing it here also runs the whole singleton
// graph in node, which is the guard that keeps Monaco and the Tauri runtime out of module
// scope: `monaco/editorService.ts` must load `$lib/monaco/core` dynamically, or this test
// fails as soon as WP1.2 lands.

import { describe, expect, it } from 'vitest';
import { ctx } from './context';

/** Every field of `AppContext` at M1 (plan §7.2). Later preludes extend this list. */
const M1_SERVICES = [
  'commands',
  'ribbon',
  'panels',
  'statusItems',
  'docs',
  'editor',
  'files',
  'dialogs',
  'modals',
  'status',
  'layout',
  'profiles',
  't',
] as const;

/** What P2 adds (plan §7.3). The singletons are stubs on `m2/base`; the keys are not. */
const M2_SERVICES = ['settings', 'uiState', 'recent', 'external', 'compare'] as const;

/** What P3 adds (plan §7.3). The singletons are stubs on `m3/base`; the keys are not. */
const M3_SERVICES = ['codes', 'outline'] as const;

/** What P4 adds (plan §7.3). The singletons are stubs on `m4/base`; the keys are not. */
const M4_SERVICES = ['transforms', 'results', 'bookmarks'] as const;

/** What P5 adds (plan §7.3). The singleton is a stub on `m5/base`; the key is not. */
const M5_SERVICES = ['scripts'] as const;

/** What P6 adds (plan §7.15). The singleton is a stub on `m6/base`; the key is not. */
const M6_SERVICES = ['machines'] as const;

/** What P7 adds (plan §7.9). The singletons are stubs on `m7/base`; the keys are not. */
const M7_SERVICES = ['fileMemory', 'session', 'recovery'] as const;

const SERVICES = [
  ...M1_SERVICES,
  ...M2_SERVICES,
  ...M3_SERVICES,
  ...M4_SERVICES,
  ...M5_SERVICES,
  ...M6_SERVICES,
  ...M7_SERVICES,
];

describe('app context', () => {
  it('exposes every M1 to M7 service', () => {
    expect(Object.keys(ctx).sort()).toEqual([...SERVICES].sort());
  });

  it('holds real singletons, not placeholders', () => {
    for (const name of SERVICES) {
      expect(ctx[name], name).toBeTruthy();
    }
    expect(typeof ctx.t).toBe('function');
    expect(ctx.t('common.cancel')).toBe('Cancel');
  });
});
