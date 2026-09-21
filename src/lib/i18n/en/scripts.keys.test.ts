// The seam between the script runner (`app/scripts.ts`, `core/scripting/apply.ts`) and this
// namespace. Added at I5, because it is the one test neither work package could write: on
// WP5.1's branch the keys did not exist yet, and on WP5.2's the two lists did not.
//
// Why it is needed at all: the runner never writes a literal `t('scripts.…')`. It returns a
// `Msg` ({ key, params }) that the status bar translates, so `keys.test.ts` — which parses
// literal `t()` arguments — cannot see a single one of these keys. `APPLY_ERROR_KEYS` and
// `SCRIPT_STATUS_KEYS` are the contract instead, and this file is what enforces it.
//
// The PARAMS table below is the third thing being pinned. A message may only use a
// placeholder the runner actually fills: an unfilled `{name}` is left verbatim by
// `interpolate`, so a stray one ships to the operator as literal braces. That is not
// hypothetical — `scripts.staleMessage` carried a `{document}` the runner never passed
// until this test was written.

import { describe, expect, it } from 'vitest';
import { APPLY_ERROR_KEYS } from '$lib/core/scripting/apply';
import { SCRIPT_STATUS_KEYS } from '$lib/app/scripts';
import { hasKey, namespaces } from '../index';
import type { Messages } from '../types';

/** The placeholders each key's message is allowed to use — i.e. what the runner passes. */
const PARAMS: Readonly<Record<string, readonly string[]>> = {
  // decideApply reasons (core/scripting/apply.ts). Each is shown with the script's stderr
  // as the status bar's detail, so none of them interpolates the script's own output.
  'scripts.errExitCode': ['code'],
  'scripts.errKilled': [],
  'scripts.errTimeout': ['seconds'],
  'scripts.errCancelled': [],
  'scripts.errEmptyOutput': [],
  'scripts.errTruncated': [],
  'scripts.errEnvelope': [],
  'scripts.errReport': [],

  // The run sequence (app/scripts.ts). `script` is the script's label, `profile` a dialect
  // id — both data, untranslated (AD-14).
  'scripts.desktopOnly': [],
  'scripts.busy': [],
  'scripts.noDocument': [],
  'scripts.notFound': ['script'],
  'scripts.notForProfile': ['script', 'profile'],
  'scripts.noProfile': ['profile'],
  'scripts.pythonMissing': [],
  'scripts.needsSelection': ['script'],
  'scripts.noInputToReplace': ['script'],
  'scripts.noLastScript': [],
  'scripts.running': ['script'],
  'scripts.cancelling': [],
  'scripts.cancelFailed': [],
  'scripts.runFailed': ['script'],
  'scripts.finished': ['script'],
  'scripts.applied': ['script', 'count'],
  'scripts.appliedNone': ['script'],
  'scripts.openedNewTab': ['script'],
  'scripts.reported': ['script'],
  'scripts.staleTitle': [],
  'scripts.staleMessage': ['script'],
  'scripts.staleOpen': [],
  'scripts.staleDiscarded': ['script'],
};

const PLACEHOLDER = /\{(\w+)\}/g;

function messagesFor(key: string): { form: string; message: string }[] {
  const [ns, ...path] = key.split('.');
  let node: unknown = namespaces[ns];
  for (const segment of path.slice(0, -1)) node = (node as Messages | undefined)?.[segment];
  const leaf = path[path.length - 1];
  const parent = node as Record<string, unknown> | undefined;
  if (parent === undefined) return [];
  if (typeof parent[leaf] === 'string') return [{ form: leaf, message: parent[leaf] as string }];
  // A plural key: every `<leaf>_<category>` sibling is one form of the same message.
  return Object.entries(parent)
    .filter(([name, value]) => name.startsWith(`${leaf}_`) && typeof value === 'string')
    .map(([form, value]) => ({ form, message: value as string }));
}

function placeholdersIn(message: string): string[] {
  return [...message.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
}

describe('the script runner’s i18n keys', () => {
  it('APPLY_ERROR_KEYS all resolve', () => {
    expect(APPLY_ERROR_KEYS.filter((key) => !hasKey(key))).toEqual([]);
    expect(APPLY_ERROR_KEYS.length).toBe(8);
  });

  it('SCRIPT_STATUS_KEYS all resolve', () => {
    expect(SCRIPT_STATUS_KEYS.filter((key) => !hasKey(key))).toEqual([]);
  });

  it('scripts.applied is a plural key with both English forms and no plain key', () => {
    const scripts = namespaces.scripts as Record<string, unknown>;
    expect(typeof scripts.applied_one).toBe('string');
    expect(typeof scripts.applied_other).toBe('string');
    expect(Object.prototype.hasOwnProperty.call(scripts, 'applied')).toBe(false);
    expect(hasKey('scripts.applied')).toBe(true);
  });

  it('every key the runner can emit is in the PARAMS table, and the other way round', () => {
    const emitted = [...APPLY_ERROR_KEYS, ...SCRIPT_STATUS_KEYS].sort();
    expect(emitted).toEqual(Object.keys(PARAMS).sort());
  });

  it('no message uses a placeholder the runner does not fill', () => {
    const wrong = Object.entries(PARAMS).flatMap(([key, allowed]) =>
      messagesFor(key)
        .filter(({ message }) => placeholdersIn(message).some((name) => !allowed.includes(name)))
        .map(({ form, message }) => `${key} (${form}): ${message}`),
    );
    expect(wrong).toEqual([]);
  });

  it('finds a message for every form of every key', () => {
    const empty = Object.keys(PARAMS).filter((key) => messagesFor(key).length === 0);
    expect(empty).toEqual([]);
  });
});
