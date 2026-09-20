// The saved UI state (`stores/uiState.ts`: panel layout and last-used form values).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// One string: the notice AD-8 asks for ("invalid JSON never blocks startup: the defaults
// are used and a notice is shown"). The English detail from Rust is shown as the status
// item's tooltip (AD-14), so it is not translated here.
//
// A *write* that fails gets no notice — it would run a second after every splitter drag —
// and a `config_load` that fails outright is an environment problem, not a file the user
// can fix; both only reach the console. See `stores/uiState.ts`.

import type { Messages } from '../types';

export default {
  loadFailed: 'The saved window layout could not be read. The defaults are in use.',
} as const satisfies Messages;
