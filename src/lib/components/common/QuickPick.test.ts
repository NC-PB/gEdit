// The QuickPick markup contract (plan §7.9): `quick-pick`, `quick-pick-input` and
// `quick-pick-item` with `data-index` and `aria-selected`. Renaming one of these breaks
// the runtime scenarios in `tests/runtime/`, so they are pinned here too.
//
// Rendered with `svelte/server`, which needs no DOM: it covers the markup and the initial
// highlight. Filtering, arrow keys and the mouse are covered by the M1 runtime scenarios.

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import QuickPick from './QuickPick.svelte';
import type { QuickPickItem } from '$lib/app/types';

const items: QuickPickItem<string>[] = [
  { label: 'CRLF', description: 'Windows', value: 'crlf' },
  { label: 'LF', description: 'Unix', detail: 'recommended', value: 'lf' },
  { label: 'CR', value: 'cr' },
];

/** The component is generic; rendered outside a typed caller its `T` is `unknown`. */
interface Props {
  items: QuickPickItem<unknown>[];
  placeholder?: string;
  initialIndex?: number;
  close: (value?: unknown) => void;
}

function markup(over: Partial<Props> = {}): string {
  return render(QuickPick, { props: { items, close: () => {}, ...over } }).body;
}

describe('QuickPick markup', () => {
  it('carries the test ids and one item per entry', () => {
    const html = markup({});
    expect(html).toContain('data-testid="quick-pick"');
    expect(html).toContain('data-testid="quick-pick-input"');
    expect(html.match(/data-testid="quick-pick-item"/g)).toHaveLength(3);
    expect(html).toContain('data-index="0"');
    expect(html).toContain('data-index="2"');
    expect(html).toContain('CRLF');
    expect(html).toContain('recommended');
  });

  it('marks the initial index as selected and points the combobox at it', () => {
    expect(markup({})).toMatch(/data-index="0"[^>]*aria-selected="true"/);
    const second = markup({ initialIndex: 1 });
    expect(second).toMatch(/data-index="1"[^>]*aria-selected="true"/);
    expect(second).toMatch(/data-index="0"[^>]*aria-selected="false"/);
    expect(second).toContain('aria-activedescendant="quick-pick-item-1"');
  });

  it('shows the placeholder it was given, and the default otherwise', () => {
    expect(markup({ placeholder: 'Switch to' })).toContain('placeholder="Switch to"');
    expect(markup({})).toContain('placeholder="Type to filter…"');
  });

  it('shows the empty notice when there is nothing to pick', () => {
    const html = markup({ items: [] });
    expect(html).not.toContain('data-testid="quick-pick-item"');
    expect(html).toContain('No matching items');
  });
});
