// The strings of the one form engine (plan §5 WP2.2, §7.5): the controls `FormRenderer`
// draws and the messages `validateFields` returns. Owner: WP2.2.
//
// `errors.*` are the keys of the `Msg`s `validateFields` produces, so a scenario can
// assert a stable key (`data-error` on a `form-field` carries it) instead of English text.
// A field's own label and help text are display text supplied by the caller (AD-14), and
// never live here.

import type { Messages } from '../types';

export default {
  /** Title of the native picker opened by a `file` field's Browse button. */
  pickFile: 'Choose a file for {label}',
  /** Title of the native picker opened by a `folder` field's Browse button. */
  pickFolder: 'Choose a folder for {label}',
  /** Accessible name of that button, which shows only the shared "Browse…" label. */
  browseFor: 'Browse for {label}',
  /** Shown as the selected option while the value matches none of the choices. */
  choosePlaceholder: 'Select…',
  /** A `choice` or `address-list` field whose choices are still empty. */
  noChoices: 'Nothing to choose from',
  /** A generated form that happens to have no fields at all. */
  noFields: 'There is nothing to set here.',
  /** Accessible name of the single input of `modals.prompt()`. */
  promptValue: 'Value',

  errors: {
    required: 'This field is required.',
    notANumber: 'Enter a number.',
    notAnInteger: 'Enter a whole number.',
    decimals_one: 'Use at most {count} decimal place.',
    decimals_other: 'Use at most {count} decimal places.',
    min: 'Enter {min} or more.',
    max: 'Enter {max} or less.',
    range: 'Enter a value between {min} and {max}.',
    notInChoices: 'Choose one of the offered values.',
    invalid: 'This value cannot be used here.',
  },
} as const satisfies Messages;
