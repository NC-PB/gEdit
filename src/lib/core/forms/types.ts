// The one form contract (plan §7.5). Written by the M2 prelude (P2); binding.
//
// A `FieldSpec[]` is all three of the app's generated forms: the settings dialog
// (WP2.7, from `SETTING_FIELDS`), transform options (M4, from the profile) and script
// parameters (M5, from the script's TOML header). `modals.form()` renders them and
// `FormRenderer.svelte` (WP2.2) knows how to draw each type — a feature never writes a
// form component of its own.
//
// `label` and `help` are **display text, not i18n keys**: script and profile labels are
// data and are not translated (AD-14). A caller whose labels *are* translatable — the
// settings dialog is the only one — resolves them through `t()` before building the spec.
//
// The functions of §7.5 live next door, where WP2.2 owns them:
// `validateFields` in `./validate.ts` and `initialValues` in `./values.ts`.

/**
 * What a field collects.
 * - `number` / `integer`: numeric input, bounded by `min`/`max`; `integer` rejects a fraction.
 * - `text`: a single line.
 * - `bool`: a checkbox.
 * - `choice`: one of `choices`.
 * - `file` / `folder`: a path, picked with the native dialog (`dialogs.pickFile` / `pickFolder`).
 * - `address-list`: a set of NC addresses, shown as checkboxes over `choices`.
 */
export type FieldType =
  | 'number'
  | 'integer'
  | 'text'
  | 'bool'
  | 'choice'
  | 'file'
  | 'folder'
  | 'address-list';

/** One option of a `choice` or `address-list` field. `label` is display text. */
export interface FieldChoice {
  label: string;
  value: unknown;
}

/** One field of a generated form (plan §7.5). */
export interface FieldSpec {
  /** Unique within the form; also the key in the values record. */
  id: string;
  type: FieldType;
  /** Display text. */
  label: string;
  /** Display text, shown under or next to the control. */
  help?: string;
  /** Used by `initialValues` when nothing is remembered. */
  default?: unknown;
  /** An empty value is rejected by `validateFields`. */
  required?: boolean;
  /** Inclusive bounds for `number` and `integer`. */
  min?: number;
  max?: number;
  /** Decimal places a `number` may carry. */
  decimals?: number;
  /** The options of a `choice` or `address-list` field. */
  choices?: FieldChoice[];
}
