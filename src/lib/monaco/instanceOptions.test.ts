// The options every gEdit editor shares, and the places that have to honour them (B1 A9).
//
// Monaco never loads here (it needs a DOM), so the creation sites are held by the tests in
// `editorService.test.ts` and `diff.test.ts` (what `create` / `createDiffEditor` were called
// with); this file pins the values themselves, that no colour provider exists, and the two
// pieces of CSS that Monaco's own tooltips depend on.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHARED_EDITOR_OPTIONS } from './instanceOptions';
import { editorOptionsFor } from './editorOptions';
import { DEFAULTS } from '$lib/core/settings/schema';

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function read(path: string): string {
  return readFileSync(join(SRC, path), 'utf8');
}

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourcesUnder(path));
    else if (/\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('SHARED_EDITOR_OPTIONS', () => {
  it('switches off every colour box, the built-in detector included', () => {
    expect(SHARED_EDITOR_OPTIONS.colorDecorators).toBe(false);
    expect(SHARED_EDITOR_OPTIONS.defaultColorDecorators).toBe('never');
  });

  it('draws hovers and tips in the fixed layer', () => {
    expect(SHARED_EDITOR_OPTIONS.fixedOverflowWidgets).toBe(true);
  });

  it('leaves the hover placement to Monaco (above, below when there is no room), owner decision 2026-10-10', () => {
    expect('hover' in SHARED_EDITOR_OPTIONS).toBe(false);
    expect(editorOptionsFor(DEFAULTS).hover).toEqual({ enabled: true });
    expect(editorOptionsFor(DEFAULTS).hover).not.toHaveProperty('above');
  });
});

describe('colour providers', () => {
  it('registers none: no NC language has colours (`#101` is a parameter)', () => {
    const offenders = sourcesUnder(join(SRC, 'lib'))
      .filter((file) => /registerColorProvider|DocumentColorProvider/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length));
    expect(offenders).toEqual([]);
  });

  it('is not undone by an option anywhere in the editor code', () => {
    const offenders = sourcesUnder(join(SRC, 'lib'))
      .filter((file) => /colorDecorators\s*:\s*true|defaultColorDecorators\s*:\s*'(always|auto)'/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length));
    expect(offenders).toEqual([]);
  });
});

describe('the editor box does not clip Monaco\'s tips', () => {
  it('lets the editor wrapper overflow, because the find widget\'s tips sit in its container', () => {
    const css = read('lib/components/editor/EditorHost.svelte').split('<style>')[1] ?? '';
    const wrapper = /\.editor-wrapper\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(wrapper).toMatch(/overflow:\s*visible/);
    expect(wrapper).not.toMatch(/overflow:\s*hidden/);
  });
});
