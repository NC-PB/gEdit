// The saved UI state (`stores/uiState.ts`: panel layout and last-used form values).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// One string: the notice AD-8 asks for ("invalid JSON never blocks startup: the defaults
// are used and a notice is shown"). The English detail from Rust is shown as the status
// item's tooltip (AD-14), so it is not translated here.
//
// A *write* that fails is said **once** per run and not every time, because it runs a
// second after every splitter drag; a `config_load` that fails outright is an environment
// problem, not a file the user can fix, and only reaches the console. The write notice
// names everything that stops being remembered rather than the file, because "state.json
// could not be written" tells a programmer nothing about what they have just lost. The
// English detail from Rust — which names the 1 MiB limit when that is the reason — is the
// status item's tooltip (AD-14). See `stores/uiState.ts`.

import type { Messages } from '../types';

export default {
  loadFailed: 'The saved window layout could not be read. The defaults are in use.',
  saveFailed:
    'gEdit cannot save what it remembers between runs — open tabs, recent files, bookmarks and the window layout. Your programs are not affected.',
} as const satisfies Messages;
