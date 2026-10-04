// The commands and default keys the plan pins (plan §7.13), checked against every shortcut
// the shipped contributions declare.
//
// The command registry reports a key conflict as a `console.error`, which the runtime
// harness turns into a failed scenario (`app/registry/commands.ts`). This test runs that
// check without the app: it reads the shortcuts out of the contribution sources (the
// modules themselves reach for Tauri at load time and cannot be imported here) and runs the
// registry's own `findConflicts` over them, on both platforms. It also holds the pinned
// i18n keys to their catalog.
//
// Two ties keep the plan and the code from drifting:
//   - each pinned row must be declared by its owner, once, with the pinned key and title
//     (a command that is deleted or re-keyed fails here, not only in a hosted run);
//   - the table the runtime scenario `m1-keys` compares the registry with
//     (`tests/runtime/lib/shortcuts.js`) must be exactly the keys the sources declare, so
//     a new default binding that is not in the table fails `npm test` and not a run that
//     only the hosted runner makes.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { findConflicts } from '$lib/core/keys/keySpec';
import { hasKey } from '$lib/i18n';
import type { CommandDef, KeySpec } from '$lib/app/types';
import { SHORTCUTS } from '../runtime/lib/shortcuts.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CONTRIB = join(ROOT, 'src', 'lib', 'contrib');

type Keys = CommandDef['keys'];

interface Declared {
  id: string;
  keys?: Keys;
  title?: string;
  file: string;
}

/** `{ id: '…', keys: '…' | { mac, other }, title: '…' }` object literals in one source file. */
function declaredIn(file: string): Declared[] {
  const source = readFileSync(join(CONTRIB, file), 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Declared[] = [];
  const text = (node: ts.Expression | undefined): string | undefined =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map<string, ts.Expression>();
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) props.set(p.name.text, p.initializer);
      }
      const id = text(props.get('id'));
      // A command definition has a `run`; a keybinding removal has `command`, not `id`.
      if (id !== undefined && props.has('run')) {
        const keysNode = props.get('keys');
        let keys: Keys = text(keysNode);
        if (keysNode && ts.isObjectLiteralExpression(keysNode)) {
          const pair: Record<string, string> = {};
          for (const p of keysNode.properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
              const v = text(p.initializer);
              if (v !== undefined) pair[p.name.text] = v;
            }
          }
          keys = pair;
        }
        out.push({ id, keys, title: text(props.get('title')), file });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const SHIPPED: Declared[] = readdirSync(CONTRIB)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort()
  .flatMap(declaredIn);

/** Plan §7.13, the rows of WP10.1 (M10), with the i18n keys P10 pinned for their titles. */
const PINNED: { id: string; keys?: Keys; title: string; owner: string }[] = [
  { id: 'nc.blockSkip.add', title: 'ncBlockSkip.add', owner: 'ncBlockSkip.ts' },
  { id: 'nc.blockSkip.remove', title: 'ncBlockSkip.remove', owner: 'ncBlockSkip.ts' },
  { id: 'nav.selectToolSegment', keys: 'Mod+F7', title: 'segments.selectToolSegment', owner: 'segments.ts' },
];
/** The ribbon groups of those entries, on the NC tab. */
const PINNED_GROUPS = ['ncBlockSkip.group', 'segments.group'];

const asDefs = (rows: { id: string; keys?: Keys }[]): CommandDef[] =>
  rows.map((row): CommandDef => ({ id: row.id, keys: row.keys, title: row.id, run: () => {} }));

describe('the commands M10 pins (plan §7.13, P10 item 2)', () => {
  it('reads the shipped shortcuts it checks against', () => {
    // A sanity floor: F7 and Shift+F7 (navigation), Mod+S (files), F9 (scripts) are there.
    const keys = SHIPPED.map((d) => d.keys).filter((k): k is KeySpec => typeof k === 'string');
    for (const key of ['F7', 'Shift+F7', 'Mod+S', 'F9', 'Mod+F2']) expect(keys, key).toContain(key);
    expect(SHIPPED.length).toBeGreaterThan(40);
  });

  it.each([true, false])('adds no key conflict to the shipped commands (macOS %s)', (isMac) => {
    const shipped = SHIPPED.filter((d) => !PINNED.some((p) => p.id === d.id));
    expect(findConflicts(asDefs(shipped), isMac)).toEqual([]);
    expect(findConflicts(asDefs([...shipped, ...PINNED]), isMac)).toEqual([]);
  });

  it('is declared by its owner, once, with the pinned key and title', () => {
    for (const pin of PINNED) {
      const found = SHIPPED.filter((d) => d.id === pin.id);
      expect(found, `${pin.id} is declared once, by ${pin.owner}`).toHaveLength(1);
      for (const d of found) {
        expect(d.file, pin.id).toBe(pin.owner);
        expect(d.keys, pin.id).toEqual(pin.keys);
        expect(d.title, pin.id).toBe(pin.title);
      }
    }
  });

  it('has a message for every pinned title and ribbon group', () => {
    for (const key of [...PINNED.map((p) => p.title), ...PINNED_GROUPS, 'ncBlockSkip.category', 'segments.category']) {
      expect(hasKey(key), key).toBe(true);
    }
  });

  it('has a shortcut table (tests/runtime/lib/shortcuts.js) that is every default key the sources declare', () => {
    const declared = SHIPPED.filter((d) => d.keys !== undefined)
      .map((d): [string, string] => [d.id, typeof d.keys === 'string' ? d.keys : JSON.stringify(d.keys)])
      .sort((a, b) => a[0].localeCompare(b[0]));
    const table = [...(SHORTCUTS as ReadonlyArray<readonly [string, string]>)]
      .map((row): [string, string] => [row[0], row[1]])
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(declared).toEqual(table);
    // and every pinned key is in it
    for (const pin of PINNED) if (pin.keys !== undefined) expect(table, pin.id).toContainEqual([pin.id, pin.keys]);
  });

  it('has a row in the contributions README for every contribution file', () => {
    const readme = readFileSync(join(CONTRIB, 'README.md'), 'utf8');
    const files = readdirSync(CONTRIB).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.filter((f) => !readme.includes(`\`${f}\``))).toEqual([]);
  });
});
