// The one status message shown in the status bar (plan §7.2, §7.9). Owner: WP1.5.
//
// `text` arrives already translated: the command registry, the file operations and the
// contributions all call `t()` themselves, so this service never looks a key up. `detail`
// carries untranslated backend text (a Rust error string), which the status bar shows as
// the element's tooltip.
//
// A plain message clears after 4 s and an error after 8 s; `sticky` keeps it until the
// next `show()` or `clear()`. There is only ever one message, so a second `show()`
// replaces the first and restarts its timer.

import { derived, writable } from 'svelte/store';
import type { StatusService } from '$lib/app/types';

export interface StatusMessage {
  text: string;
  error: boolean;
  detail?: string;
}

/** How long a plain message stays on screen. */
export const MESSAGE_TIMEOUT_MS = 4000;
/** How long an error stays on screen: long enough to read a path or a backend message. */
export const ERROR_TIMEOUT_MS = 8000;

const message = writable<StatusMessage | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

function stopTimer(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

export const status: StatusService = {
  current: derived(message, (m) => m),

  show(text: string, o: { error?: boolean; sticky?: boolean; detail?: string } = {}): void {
    const error = o.error === true;
    stopTimer();
    message.set({ text, error, ...(o.detail === undefined ? {} : { detail: o.detail }) });
    if (o.sticky === true) return;
    timer = setTimeout(() => {
      timer = undefined;
      message.set(null);
    }, error ? ERROR_TIMEOUT_MS : MESSAGE_TIMEOUT_MS);
  },

  clear(): void {
    stopTimer();
    message.set(null);
  },
};
