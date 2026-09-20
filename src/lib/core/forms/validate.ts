// Form validation (plan §7.5). Owner: WP2.2.
//
// The rule that makes this worth its own pure module: a value is **never corrected
// silently**. A number outside `min`/`max`, a fraction in an `integer` field or too many
// decimals produce a message for that field; they do not snap the value. The user sees
// what they typed and what is wrong with it, which matters when the field is a feed rate.
//
// A numeric control hands back a `number` while what the user typed parses, and the raw
// string while it does not (`FormRenderer`), so `1e` reaches this module as `'1e'` and
// comes back as `forms.errors.notANumber` instead of disappearing.
//
// Order of the checks for one field, first hit wins:
//   1. empty      → `required` only; an empty optional field is fine and stops here
//   2. shape      → the value is not of the field's kind at all (`forms.errors.invalid`)
//   3. number     → parses, is whole when `integer`, fits `decimals`
//   4. bounds     → `min` / `max` (both → one `range` message)
// A `choice` or `address-list` whose `choices` are still empty cannot be checked against
// anything, so any non-empty value passes; the caller fills the choices before it matters
// (`files.defaultProfile` in WP2.7).

import type { Msg } from '$lib/app/types';
import type { FieldSpec } from './types';

const REQUIRED: Msg = { key: 'forms.errors.required' };
const INVALID: Msg = { key: 'forms.errors.invalid' };
const NOT_A_NUMBER: Msg = { key: 'forms.errors.notANumber' };
const NOT_AN_INTEGER: Msg = { key: 'forms.errors.notAnInteger' };
const NOT_IN_CHOICES: Msg = { key: 'forms.errors.notInChoices' };

/** Numeric text, so `'12'` and `12` are the same value; anything else is `NaN`. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Number('') is 0, and an empty string never reaches here as a number.
    return trimmed === '' ? Number.NaN : Number(trimmed);
  }
  return Number.NaN;
}

/**
 * Decimal places of the *value*, not of the text: `'1.500'` is 1.5 and so carries one,
 * which keeps a harmless trailing zero from being reported as an error.
 */
export function decimalPlaces(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const match = /^-?\d+(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(n));
  if (!match) return 0;
  const fraction = match[1]?.length ?? 0;
  const exponent = match[2] ? Number(match[2]) : 0;
  return Math.max(0, fraction - exponent);
}

/** The options a `choice` or `address-list` may carry; empty when the caller has none yet. */
function choiceValues(field: FieldSpec): unknown[] {
  return (field.choices ?? []).map((c) => c.value);
}

function isOneOf(field: FieldSpec, value: unknown): boolean {
  const values = choiceValues(field);
  return values.length === 0 || values.some((candidate) => Object.is(candidate, value));
}

/**
 * True for "the user has not filled this in". `false` and `0` are answers, not blanks;
 * a blank numeric control reaches here as `undefined` (see `FormRenderer`).
 */
export function isEmptyValue(field: FieldSpec, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function numberProblem(field: FieldSpec, value: unknown): Msg | null {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return NOT_A_NUMBER;
  if (field.type === 'integer' && !Number.isInteger(n)) return NOT_AN_INTEGER;
  if (field.type === 'number' && field.decimals !== undefined) {
    if (field.decimals <= 0) {
      if (!Number.isInteger(n)) return NOT_AN_INTEGER;
    } else if (decimalPlaces(n) > field.decimals) {
      return { key: 'forms.errors.decimals', params: { count: field.decimals } };
    }
  }
  const { min, max } = field;
  if (min !== undefined && max !== undefined && (n < min || n > max)) {
    return { key: 'forms.errors.range', params: { min, max } };
  }
  if (min !== undefined && n < min) return { key: 'forms.errors.min', params: { min } };
  if (max !== undefined && n > max) return { key: 'forms.errors.max', params: { max } };
  return null;
}

/** The message for one field, or null while its value may be submitted. */
function fieldProblem(field: FieldSpec, value: unknown): Msg | null {
  if (isEmptyValue(field, value)) return field.required ? REQUIRED : null;
  switch (field.type) {
    case 'text':
    case 'file':
    case 'folder':
      return typeof value === 'string' ? null : INVALID;
    case 'bool':
      return typeof value === 'boolean' ? null : INVALID;
    case 'number':
    case 'integer':
      return numberProblem(field, value);
    case 'choice':
      return isOneOf(field, value) ? null : NOT_IN_CHOICES;
    case 'address-list':
      if (!Array.isArray(value)) return INVALID;
      return value.every((entry) => isOneOf(field, entry)) ? null : NOT_IN_CHOICES;
    default:
      return INVALID;
  }
}

/**
 * One message per field that fails, keyed by `FieldSpec.id`. An empty record means the
 * form may be submitted. Values without a field are ignored, so a remembered parameter
 * set from an older script header cannot block the form.
 */
export function validateFields(
  fields: FieldSpec[],
  values: Record<string, unknown>,
): Record<string, Msg> {
  const errors: Record<string, Msg> = {};
  for (const field of fields) {
    const problem = fieldProblem(field, values[field.id]);
    if (problem) errors[field.id] = problem;
  }
  return errors;
}
