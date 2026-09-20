// Placeholder (plan §7 preamble). The real form contract is §7.5 (`FieldType`, `FieldSpec`,
// `validateFields`, `initialValues`) and is written into this same file by the M2 prelude (P2).
//
// M1 only needs the type so that `Modals.form()` in `app/types.ts` resolves; `modals.form()`
// itself throws until M2.

/** One field of a generated form, §7.5. Placeholder until P2. */
export interface FieldSpec {
  id: string;
  /** Display text (not an i18n key: script and profile labels are data). */
  label: string;
  [field: string]: unknown;
}
