// Templates (Phase 2 plan §7.8, AD-28; Phase 3 plan §6.11).
//
// The one import for everything else: the Insert tab, completion and the palette (P3.5), the
// cycle forms (P3.8 engine, P3.5 command), the template manager (P3.9) and the code database
// loader (`core/codes/load.ts`, which reads the `templates` member through `loadTemplates`).
//
// Built by: `types.ts`, `load.ts`, `engine.ts` — P3.4; `formula.ts`,
// `cycleForm.ts`, `fromSelection.ts` — P3.8.

export * from './types';
export {
  loadTemplates,
  placeholdersOf,
  templateCommandId,
  templateIdOfCommand,
  templateMemoKey,
  templatesForMachine,
  templatesForMachines,
  offeredToMachine,
  PROGRAM_START_TEMPLATE_ID,
  SYS_PLACEHOLDERS,
  TEMPLATE_COMMAND_PREFIX,
  TEMPLATE_ID,
  TEMPLATE_LIMITS,
  TEMPLATE_PARAM_ID,
} from './load';
export { renderTemplate, templateFields, validateTemplateValues } from './engine';
export {
  checkFormula,
  evaluateFormulas,
  formulaRefs,
  parseFormula,
  FORMULA_CONSTANTS,
  FORMULA_FUNCTIONS,
  FORMULA_LIMITS,
  FORMULA_READABLE,
  type ParsedFormula,
} from './formula';
export { applyCycleForm, cycleEntries, cycleFormAt, cycleFormFor, CYCLE_FORM_REFUSALS, CYCLE_FORM_WHOLE } from './cycleForm';
export { draftToTemplate, templateFromSelection } from './fromSelection';

/**
 * The test ids of P3b (Phase 3 plan §6.8). `cmd-button` (P1) keeps carrying the Insert tab's
 * buttons with `data-command="insert.template:<id>"`; the forms keep `form-field` (P1) with
 * `data-field="<param id>"` (a cycle form: the address).
 */
export const TEMPLATE_TEST_IDS = {
  /** The Insert tab's "More templates…" list of a group: `data-group`. */
  more: 'template-more',
  /** The live preview under a template form and in the manager: `data-error` (the message key while the values are refused). */
  preview: 'template-preview',
  /** The cycle form's note of the words it keeps: `data-cycle` (the code), `data-mode` (`edit` | `insert`). */
  cycleForm: 'cycle-form',
  /** The template manager: `data-dialect` (the database it edits), `data-file` (the user file's name, empty before one exists). */
  manager: 'template-manager',
  /** A template of the manager's list: `data-template-id`, `data-origin` (`builtin` | `user` | `override`), `data-group`, `data-review`, `data-favorite`, `data-problems`. */
  row: 'template-row',
  /** A manager button: `data-action` = add | duplicate | delete | up | down | favorite | save | revert | open-file, `data-disabled`. */
  action: 'template-action',
  /** The body editor (a text area) of the selected template. */
  body: 'template-body',
  /** A button that inserts a placeholder into the body: `data-placeholder` (`N`, `sys.date`, a parameter id). */
  placeholder: 'template-placeholder',
  /** A parameter of the selected template: `data-param-id`, `data-type`. */
  param: 'template-param',
  /** A number of the selection that can become a parameter ("New Template from Selection"): `data-address`, `data-line`, `data-checked`. */
  candidate: 'template-candidate',
} as const;
