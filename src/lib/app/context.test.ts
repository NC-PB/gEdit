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

describe('app context', () => {
  it('exposes every M1 service', () => {
    expect(Object.keys(ctx).sort()).toEqual([...M1_SERVICES].sort());
  });

  it('holds real singletons, not placeholders', () => {
    for (const name of M1_SERVICES) {
      expect(ctx[name], name).toBeTruthy();
    }
    expect(typeof ctx.t).toBe('function');
    expect(ctx.t('common.cancel')).toBe('Cancel');
  });
});
