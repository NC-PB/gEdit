// Test hook for the runtime harness (plan §7.9). `app/bootstrap.ts` registers it.
// Only harness builds (`VITE_GEDIT_TEST=1`) expose it. Vite inlines the flag, so in a
// normal build the assignment below is dead code and the bundle never names the hook.

import type { AppContext } from './types';

export interface GeditTestHook {
  /** Resolves once the editor and the initial document are ready. */
  ready: Promise<void>;
  /** App version (`__APP_VERSION__`). */
  version: string;
  /** Text of the active document, LF line endings. */
  text(): string;
  /** 1-based cursor position in the active document. */
  cursor(): { line: number; column: number };
  /** Id of the active dialect profile. */
  activeProfile(): string;
  /** Switches the active profile, like the profile selector does; throws on an unknown id. */
  setProfile(id: string): void;
  /**
   * The service aggregate (`$lib/app/context`), so a scenario can drive documents,
   * commands and file operations without going through the DOM. Present from M1 on;
   * optional so that an M0 scenario still type-checks.
   */
  ctx?: AppContext;
}

/** Exposes `h` as `window.__gedit`, only when `import.meta.env.VITE_GEDIT_TEST === '1'`. */
export function installTestHook(h: GeditTestHook): void {
  if (import.meta.env.VITE_GEDIT_TEST !== '1') return;
  window.__gedit = h;
}
