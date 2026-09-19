// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  /** package.json version, injected by `define` in vite.config.js and vitest.config.ts. */
  const __APP_VERSION__: string;

  interface ImportMetaEnv {
    /** '1' in harness builds only; enables `window.__gedit`. */
    readonly VITE_GEDIT_TEST?: string;
  }

  interface Window {
    /** Test hook for the runtime harness; absent in normal builds. */
    __gedit?: import('$lib/app/testHook').GeditTestHook;
  }
}

export {};
