// Key scan (plan AD-14): every literal key passed to t() anywhere in src/ must have a
// message, and every namespace file must be well formed. Sources are parsed, not grepped,
// so keys in comments do not count. Keys built at runtime (command, panel and field titles)
// cannot be scanned; their owners check them with hasKey().

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { hasKey, namespaces } from './index';
import type { Messages } from './types';

interface KeyUse {
  key: string;
  line: number;
}

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SRC = join(ROOT, 'src');

/** Literal first arguments of calls to a plain `t(...)` in TS or JS. Template literals with `${}` are dynamic and skipped. */
function keysInScript(source: string, fileName: string): KeyUse[] {
  const kind = fileName.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found: KeyUse[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        found.push({ key: arg.text, line: file.getLineAndCharacterOfPosition(arg.getStart(file)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The ESTree fields the Svelte walk reads. */
interface EsNode {
  type?: unknown;
  name?: unknown;
  value?: unknown;
  callee?: EsNode;
  arguments?: EsNode[];
  expressions?: unknown[];
  quasis?: { value: { cooked?: string | null } }[];
  loc?: { start: { line: number } };
}

function literalOf(node: EsNode | undefined): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions?.length === 0) return node.quasis?.[0]?.value.cooked ?? undefined;
  return undefined;
}

/** Same as keysInScript for a component: its scripts and every template expression. */
function keysInSvelte(source: string, fileName: string): KeyUse[] {
  const found: KeyUse[] = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as EsNode;
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 't') {
      const arg = node.arguments?.[0];
      const key = literalOf(arg);
      if (key !== undefined) found.push({ key, line: arg?.loc?.start.line ?? 0 });
    }
    Object.values(value).forEach(visit);
  };
  visit(parse(source, { filename: fileName, modern: true }));
  return found;
}

function keysIn(source: string, fileName: string): KeyUse[] {
  return fileName.endsWith('.svelte') ? keysInSvelte(source, fileName) : keysInScript(source, fileName);
}

/** App sources under `dir`: .ts, .js and .svelte files, without tests and declaration files. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|js|svelte)$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe('key extraction', () => {
  it('finds literal keys in TS and ignores comments, dynamic keys and other callees', () => {
    const source = [
      "import { t } from '$lib/i18n';",
      "// t('in.lineComment')",
      "/* t('in.blockComment') */",
      "const a = t('ns.single');",
      'const b = t("ns.double", { count: 2 });',
      'const c = t(`ns.template`);',
      'const d = t(`ns.${a}`);',
      'const e = t(someKey);',
      "const f = obj.t('not.plain'); list.at('x'); set('y');",
      "const g = 'no t(\\'in.string\\') here';",
    ].join('\n');
    expect(keysIn(source, 'sample.ts')).toEqual([
      { key: 'ns.single', line: 4 },
      { key: 'ns.double', line: 5 },
      { key: 'ns.template', line: 6 },
    ]);
  });

  it('finds literal keys in Svelte scripts, attributes and markup', () => {
    const source = [
      '<script lang="ts">',
      "  import { t } from '$lib/i18n';",
      '  let n: number = 2;',
      "  const title = t('ns.script'); // t('in.comment')",
      '</script>',
      "<!-- t('in.htmlComment') -->",
      '<button title={t("ns.attr")}>{t(`ns.markup`)} {t(`ns.${n}`)}</button>',
      "{#if n}<span>{t('ns.block', { count: n })}</span>{/if}",
      "<style>.x::after { content: \"t('in.css')\"; }</style>",
    ].join('\n');
    const keys = keysIn(source, 'Sample.svelte');
    expect(keys.map((k) => k.key).sort()).toEqual(['ns.attr', 'ns.block', 'ns.markup', 'ns.script']);
    expect(keys.find((k) => k.key === 'ns.attr')?.line).toBe(7);
  });
});

describe('key scan', () => {
  it('every literal t() key in src/ has a message', () => {
    const files = sourceFiles(SRC);
    expect(files.some((f) => f.endsWith('.svelte'))).toBe(true);
    const missing = files.flatMap((path) =>
      keysIn(readFileSync(path, 'utf8'), path)
        .filter((use) => !hasKey(use.key))
        .map((use) => `${relative(ROOT, path)}:${use.line} ${use.key}`),
    );
    expect(missing).toEqual([]);
  });
});

// Namespace names are camelCase file names; key segments are identifiers. Plural forms are
// sibling leaves '<key>_one' and '<key>_other' (both required for English) with no plain '<key>'.
const NAMESPACE = /^[a-z][A-Za-z0-9]*$/;
const SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/;
const PLURAL_FORM = /^([A-Za-z][A-Za-z0-9]*)_(zero|one|two|few|many|other)$/;
const ENGLISH_FORMS = ['one', 'other'];

function catalogProblems(ns: string, messages: Messages): string[] {
  const problems: string[] = [];
  if (!NAMESPACE.test(ns)) problems.push(`${ns}: namespace (file name) must be camelCase`);
  const walk = (prefix: string, node: Messages): void => {
    const pluralBases = new Set<string>();
    for (const [name, value] of Object.entries(node) as [string, unknown][]) {
      const key = `${prefix}.${name}`;
      const plural = PLURAL_FORM.exec(name);
      if (plural) pluralBases.add(plural[1]);
      else if (!SEGMENT.test(name)) problems.push(`${key}: key segments must be identifiers`);
      if (typeof value === 'string') {
        if (!value.trim()) problems.push(`${key}: empty message`);
        if (/[{}]/.test(value.replace(/\{\w+\}/g, ''))) problems.push(`${key}: stray brace (placeholders are {name})`);
      } else if (value && typeof value === 'object' && !Array.isArray(value) && !plural) {
        walk(key, value as Messages);
      } else {
        problems.push(`${key}: must be a message string${plural ? '' : ' or a nested object'}`);
      }
    }
    const has = (name: string) => Object.prototype.hasOwnProperty.call(node, name);
    for (const base of pluralBases) {
      for (const form of ENGLISH_FORMS) {
        if (!has(`${base}_${form}`)) problems.push(`${prefix}.${base}: plural form _${form} is missing`);
      }
      if (has(base)) problems.push(`${prefix}.${base}: plain key next to its plural forms`);
    }
  };
  walk(ns, messages);
  return problems;
}

describe('catalog', () => {
  it('loads the common namespace', () => {
    expect(namespaces).toHaveProperty('common');
  });

  it('namespace files are well formed', () => {
    const problems = Object.entries(namespaces).flatMap(([ns, messages]) => catalogProblems(ns, messages));
    expect(problems).toEqual([]);
  });

  it('the checker reports malformed catalogs', () => {
    const bad = {
      'with space': 'x',
      empty: ' ',
      brace: 'Use {name} and {',
      count_one: '{count} item',
      list: ['not', 'a', 'message'],
      nested: { form_other: '{count} forms', form: 'plain' },
    } as unknown as Messages;
    expect(catalogProblems('Bad-ns', bad)).toEqual([
      'Bad-ns: namespace (file name) must be camelCase',
      'Bad-ns.with space: key segments must be identifiers',
      'Bad-ns.empty: empty message',
      'Bad-ns.brace: stray brace (placeholders are {name})',
      'Bad-ns.list: must be a message string or a nested object',
      'Bad-ns.nested.form: plural form _one is missing',
      'Bad-ns.nested.form: plain key next to its plural forms',
      'Bad-ns.count: plural form _other is missing',
    ]);
  });
});
