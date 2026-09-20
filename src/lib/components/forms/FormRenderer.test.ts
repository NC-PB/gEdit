// The form engine's markup contract (plan §7.5, §7.9): one control per `FieldType`, the
// `form-field` wrapper with `data-field` and `data-error`, help text and the error text.
// Renaming one of these breaks the M2 runtime scenarios, so they are pinned here.
//
// Rendered with `svelte/server`, which needs no DOM: it covers the markup and the value
// each control starts at. Typing, the native pickers and the checkbox toggles need a real
// window and are covered by the M2 runtime scenarios.

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import FormRenderer from './FormRenderer.svelte';
import type { FieldSpec } from '$lib/core/forms/types';
import type { Msg } from '$lib/app/types';

interface Props {
  fields: FieldSpec[];
  values: Record<string, unknown>;
  errors?: Record<string, Msg>;
  context?: { addresses?: string[] };
  onChange: (id: string, value: unknown) => void;
}

function markup(over: Partial<Props> & Pick<Props, 'fields' | 'values'>): string {
  return render(FormRenderer, { props: { onChange: () => {}, ...over } }).body;
}

/** The one `form-field` block of a single-field form. */
function field(fields: FieldSpec[], values: Record<string, unknown>, over: Partial<Props> = {}): string {
  return markup({ fields, values, ...over });
}

describe('the wrapper', () => {
  const spec: FieldSpec = { id: 'feed', type: 'number', label: 'Feed rate', help: 'mm/min' };

  it('carries the test id, the field id and the label and help text', () => {
    const html = field([spec], { feed: 100 });
    expect(html).toContain('data-testid="form-field"');
    expect(html).toContain('data-field="feed"');
    expect(html).toContain('Feed rate');
    expect(html).toContain('mm/min');
    expect(html).not.toContain('data-error=');
  });

  it('carries the message key in data-error and shows the translated message', () => {
    const html = field([spec], { feed: 5 }, {
      errors: { feed: { key: 'forms.errors.min', params: { min: 10 } } },
    });
    expect(html).toContain('data-error="forms.errors.min"');
    expect(html).toContain('Enter 10 or more.');
    expect(html).toContain('aria-invalid="true"');
  });

  it('renders one block per field, in order', () => {
    const html = markup({
      fields: [
        { id: 'a', type: 'text', label: 'A' },
        { id: 'b', type: 'text', label: 'B' },
      ],
      values: { a: '', b: '' },
    });
    expect(html.match(/data-testid="form-field"/g)).toHaveLength(2);
    expect(html.indexOf('data-field="a"')).toBeLessThan(html.indexOf('data-field="b"'));
  });

  it('renders nothing for a form without fields', () => {
    expect(markup({ fields: [], values: {} })).not.toContain('data-testid="form-field"');
  });
});

describe('text', () => {
  it('is a text input holding the value', () => {
    const html = field([{ id: 'name', type: 'text', label: 'Name' }], { name: 'shaft' });
    expect(html).toContain('type="text"');
    expect(html).toContain('value="shaft"');
    expect(html).toContain('id="field-name"');
    expect(html).toContain('for="field-name"');
  });

  it('shows an empty control for a missing value', () => {
    const html = field([{ id: 'name', type: 'text', label: 'Name' }], {});
    expect(html).toContain('value=""');
  });

  it('marks a required field for assistive tech', () => {
    const html = field([{ id: 'name', type: 'text', label: 'Name', required: true }], {});
    expect(html).toContain('aria-required="true"');
  });
});

describe('number and integer', () => {
  it('are text inputs, so the browser cannot round or swallow what is typed', () => {
    const html = field([{ id: 'feed', type: 'number', label: 'Feed' }], { feed: 12.5 });
    expect(html).toContain('type="text"');
    expect(html).not.toContain('type="number"');
    expect(html).toContain('inputmode="decimal"');
    expect(html).toContain('value="12.5"');
  });

  it('use a numeric keypad hint for integers', () => {
    const html = field([{ id: 'size', type: 'integer', label: 'Size' }], { size: 4 });
    expect(html).toContain('inputmode="numeric"');
    expect(html).toContain('value="4"');
  });

  it('shows the raw text of a value that is not a number', () => {
    const html = field([{ id: 'feed', type: 'number', label: 'Feed' }], { feed: '1e' });
    expect(html).toContain('value="1e"');
  });

  it('shows an empty control while the field has no value', () => {
    expect(field([{ id: 'feed', type: 'number', label: 'Feed' }], { feed: undefined })).toContain(
      'value=""',
    );
  });
});

describe('bool', () => {
  it('is a checkbox inside its label', () => {
    const on = field([{ id: 'wrap', type: 'bool', label: 'Word wrap' }], { wrap: true });
    expect(on).toContain('type="checkbox"');
    expect(on).toContain('checked');
    expect(on).toContain('Word wrap');
    const off = field([{ id: 'wrap', type: 'bool', label: 'Word wrap' }], { wrap: false });
    expect(off).not.toContain('checked');
  });
});

describe('choice', () => {
  const spec: FieldSpec = {
    id: 'theme',
    type: 'choice',
    label: 'Theme',
    choices: [
      { label: 'Light', value: 'light' },
      { label: 'Dark', value: 'dark' },
    ],
  };

  it('is a select with one option per choice, the current one selected', () => {
    const html = field([spec], { theme: 'dark' });
    expect(html).toContain('<select');
    expect(html.match(/<option/g)).toHaveLength(2);
    expect(html).toContain('Light');
    expect(html).toMatch(/<option[^>]*value="1"[^>]*selected/);
    expect(html).not.toContain('Select…');
  });

  it('offers a placeholder while the value matches no choice', () => {
    const html = field([spec], { theme: 'solarized' });
    expect(html).toContain('Select…');
    expect(html).toMatch(/<option[^>]*value=""[^>]*disabled/);
  });

  it('says so while there is nothing to choose from', () => {
    const html = field([{ id: 'p', type: 'choice', label: 'Profile', choices: [] }], {});
    expect(html).toContain('Nothing to choose from');
  });
});

describe('file and folder', () => {
  it('pair the path with a Browse button', () => {
    const html = field([{ id: 'python', type: 'file', label: 'Python' }], {
      python: '/usr/bin/python3',
    });
    expect(html).toContain('value="/usr/bin/python3"');
    expect(html).toContain('Browse…');
    expect(html).toContain('aria-label="Browse for Python"');
  });

  it('do the same for a folder', () => {
    const html = field([{ id: 'dir', type: 'folder', label: 'Scripts folder' }], { dir: '/nc' });
    expect(html).toContain('value="/nc"');
    expect(html).toContain('aria-label="Browse for Scripts folder"');
  });
});

describe('address-list', () => {
  const spec: FieldSpec = {
    id: 'keep',
    type: 'address-list',
    label: 'Keep addresses',
    choices: [
      { label: 'X', value: 'X' },
      { label: 'Y', value: 'Y' },
    ],
  };

  it('is a checkbox per choice, the picked ones checked', () => {
    const html = field([spec], { keep: ['Y'] });
    expect(html).toContain('data-field="keep"');
    expect(html).toContain('Keep addresses');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/checked/g)).toHaveLength(1);
  });

  it('falls back to the addresses in the context when the field has no choices', () => {
    const html = field([{ id: 'keep', type: 'address-list', label: 'Keep' }], { keep: [] }, {
      context: { addresses: ['F', 'S', 'T'] },
    });
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html).not.toContain('checked');
  });

  it('says so when there is nothing to tick', () => {
    const html = field([{ id: 'keep', type: 'address-list', label: 'Keep' }], { keep: [] });
    expect(html).toContain('Nothing to choose from');
  });
});
