// Initial form values (plan §7.5). Owner: WP2.2.
//
// `remembered` is the last-used parameter set for this form, kept in `state.json`
// under `ui.lastParams['<formKey>']` (WP2.3). A remembered value is used only when the
// form still has a field with that id; anything else falls back to `FieldSpec.default`,
// so a changed script header or profile cannot resurrect a stale value.
//
// "Still has a field with that id" is read strictly: the remembered value also has to
// suit the field it lands in. A field that changed from `text` to `integer`, or a
// `choice` whose options no longer contain the remembered one, falls back to the default
// as well. That is not the "never correct silently" rule of `validateFields` — nothing
// the user typed in *this* form is touched; it only keeps stale persisted state from
// opening a form that is already invalid.
//
// Every returned value is fresh: `DEFAULTS` in `core/settings/schema.ts` is frozen, and
// arrays are copied so the form can edit them.

import type { FieldSpec } from './types';

/** Copies the container of an array value; entries are primitives in every field type. */
function detach(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value;
}

/** The value a field starts at when nothing is remembered and it has no `default`. */
function emptyFor(field: FieldSpec): unknown {
  switch (field.type) {
    case 'text':
    case 'file':
    case 'folder':
      return '';
    case 'bool':
      return false;
    case 'address-list':
      return [];
    // A blank numeric control and an unset choice are genuinely "no value": picking the
    // first option here would submit something the user never chose.
    default:
      return undefined;
  }
}

/** True while `value` is a value this field could have produced itself. */
function suits(field: FieldSpec, value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const known = (field.choices ?? []).map((c) => c.value);
  switch (field.type) {
    case 'text':
    case 'file':
    case 'folder':
      return typeof value === 'string';
    case 'bool':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'choice':
      return known.length === 0 || known.some((candidate) => Object.is(candidate, value));
    case 'address-list':
      return (
        Array.isArray(value) &&
        (known.length === 0 ||
          value.every((entry) => known.some((candidate) => Object.is(candidate, entry))))
      );
    default:
      return false;
  }
}

/** The starting values for `fields`, one entry per field id. */
export function initialValues(
  fields: FieldSpec[],
  remembered?: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const has =
      remembered !== undefined &&
      Object.prototype.hasOwnProperty.call(remembered, field.id);
    const value = has ? remembered[field.id] : undefined;
    if (has && suits(field, value)) {
      values[field.id] = detach(value);
    } else {
      values[field.id] = field.default === undefined ? emptyFor(field) : detach(field.default);
    }
  }
  return values;
}
