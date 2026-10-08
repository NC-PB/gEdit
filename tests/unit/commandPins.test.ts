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
//     (a command that is deleted or re-keyed fails here, not only in a hosted run). A row
//     marked `pending` is pinned by a prelude before its work package registers it: it may
//     be missing, but once declared it must match, and the work package that registers it
//     deletes the mark (and adds its key to `tests/runtime/lib/shortcuts.js`);
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

/**
 * Plan §7.13: the rows of WP10.1 (M10, pinned by P10), of WP11.1 and WP11.3 (M11, pinned by
 * P11) and of WP12.5 (M12, pinned by P12), with the i18n keys of their titles.
 */
const PINNED: { id: string; keys?: Keys; title: string; owner: string; pending?: true }[] = [
  { id: 'nc.blockSkip.add', title: 'ncBlockSkip.add', owner: 'ncBlockSkip.ts' },
  { id: 'nc.blockSkip.remove', title: 'ncBlockSkip.remove', owner: 'ncBlockSkip.ts' },
  { id: 'nav.selectToolSegment', keys: 'Mod+F7', title: 'segments.selectToolSegment', owner: 'segments.ts' },
  // M11, WP11.1 (Home tab, group `search.group`)
  { id: 'search.findAll', keys: 'Mod+Shift+F', title: 'search.findAll', owner: 'search.ts' },
  { id: 'search.replace', title: 'search.replace', owner: 'search.ts' },
  { id: 'search.wholeAddressInFind', title: 'search.wholeAddressInFind', owner: 'search.ts' },
  // M11, WP11.3 (the two copy keys only while a comparison is open: `enabled` reads
  // `compareOpen`; `compare.files` on the Tools tab, group `compare.group`)
  { id: 'compare.copyToModified', keys: 'Mod+Alt+Right', title: 'compare.copyToModified', owner: 'compare.ts' },
  { id: 'compare.copyToOriginal', keys: 'Mod+Alt+Left', title: 'compare.copyToOriginal', owner: 'compare.ts' },
  { id: 'compare.exportDiff', title: 'compare.exportDiff', owner: 'compare.ts' },
  { id: 'compare.files', title: 'compare.files', owner: 'compare.ts' },
  { id: 'compare.toggleReview', title: 'compare.toggleReview', owner: 'compare.ts' },
  // M12, WP12.5 (P12; registered by WP12.5). Navigation on the NC tab, group
  // `channels.group`; the check on the Tools tab, group `channels.toolsGroup`. `Mod+Alt+P`
  // collides with Monaco's own "toggle preserve case" on macOS (Cmd+Option+P, editor focus,
  // no precondition), so WP12.5 also declares the keybinding removal
  // `{ keys: 'Mod+Alt+P', command: 'togglePreserveCase' }` (§7.16 #153).
  { id: 'channels.nextSyncPoint', keys: 'Alt+F7', title: 'channels.nextSyncPoint', owner: 'channels.ts' },
  { id: 'channels.prevSyncPoint', keys: 'Shift+Alt+F7', title: 'channels.prevSyncPoint', owner: 'channels.ts' },
  { id: 'channels.gotoPartner', keys: 'Mod+Alt+P', title: 'channels.gotoPartner', owner: 'channels.ts' },
  { id: 'channels.select', title: 'channels.select', owner: 'channels.ts' },
  { id: 'channels.assign', title: 'channels.assign', owner: 'channels.ts' },
  { id: 'channels.checkSync', title: 'channels.checkSync', owner: 'channels.ts' },
  { id: 'channels.splitToDocuments', title: 'channels.splitToDocuments', owner: 'channels.ts' },
  { id: 'channels.testOnDocument', title: 'channels.testOnDocument', owner: 'channels.ts' },
];
/** The ribbon groups of those entries: NC tab (M10, M12 navigation), Home tab (search), Tools tab (compare, M12 check). */
const PINNED_GROUPS = ['ncBlockSkip.group', 'segments.group', 'search.group', 'compare.group', 'channels.group', 'channels.toolsGroup'];
/** The palette categories of those entries. */
const PINNED_CATEGORIES = ['ncBlockSkip.category', 'segments.category', 'search.category', 'compare.category', 'channels.category'];

const asDefs = (rows: { id: string; keys?: Keys }[]): CommandDef[] =>
  rows.map((row): CommandDef => ({ id: row.id, keys: row.keys, title: row.id, run: () => {} }));

describe('the commands M10, M11 and M12 pin (plan §7.13; P10 item 2, P11 item 4, P12 item 8)', () => {
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
      if (pin.pending && found.length === 0) continue;
      expect(found, `${pin.id} is declared once, by ${pin.owner}`).toHaveLength(1);
      for (const d of found) {
        expect(d.file, pin.id).toBe(pin.owner);
        expect(d.keys, pin.id).toEqual(pin.keys);
        expect(d.title, pin.id).toBe(pin.title);
      }
    }
  });

  it('has a message for every pinned title and ribbon group', () => {
    for (const key of [...PINNED.map((p) => p.title), ...PINNED_GROUPS, ...PINNED_CATEGORIES]) {
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
    // and every pinned key whose command is registered is in it
    for (const pin of PINNED) {
      if (pin.keys === undefined || (pin.pending && !SHIPPED.some((d) => d.id === pin.id))) continue;
      expect(table, pin.id).toContainEqual([pin.id, pin.keys]);
    }
  });

  it('has a row in the contributions README for every contribution file', () => {
    const readme = readFileSync(join(CONTRIB, 'README.md'), 'utf8');
    const files = readdirSync(CONTRIB).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.filter((f) => !readme.includes(`\`${f}\``))).toEqual([]);
  });
});
