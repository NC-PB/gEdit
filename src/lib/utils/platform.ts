/** True when running inside the Tauri webview (false in a plain browser, e.g. `npm run dev`). */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** True on macOS, where the primary shortcut modifier is Cmd instead of Ctrl. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** Human-readable shortcut, e.g. shortcutLabel('S', true) -> "⇧⌘S" on macOS, "Ctrl+Shift+S" elsewhere. */
export function shortcutLabel(key: string, shift = false): string {
  if (isMacPlatform()) return `${shift ? '⇧' : ''}⌘${key}`;
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

/** Last path segment ("C:\\nc\\a.h" and "/nc/a.h" both give "a.h"). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
