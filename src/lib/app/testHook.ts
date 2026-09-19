// Test hook for the runtime harness (plan §7.9). +page registers it; M1 adds `ctx`.
// Only harness builds (`VITE_GEDIT_TEST=1`) expose it. Vite inlines the flag, so in a
// normal build the assignment below is dead code and the bundle never names the hook.

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
}

/** Exposes `h` as `window.__gedit`, only when `import.meta.env.VITE_GEDIT_TEST === '1'`. */
export function installTestHook(h: GeditTestHook): void {
  if (import.meta.env.VITE_GEDIT_TEST !== '1') return;
  window.__gedit = h;
}
