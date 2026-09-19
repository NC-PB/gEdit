import { describe, expect, it, vi } from 'vitest';
import { createTranslator, hasKey, namespaces, t } from './index';

const sample = {
  demo: {
    greeting: 'Hello, {name}!',
    plain: 'No placeholders',
    twice: '{a} and {a}',
    items_one: '{count} item',
    items_other: '{count} items',
    onlyOther_other: '{count} things',
    group: { nested: { leaf: 'Deep' } },
  },
};

describe('createTranslator', () => {
  const { t: tr, hasKey: has } = createTranslator(sample);

  it('looks up nested keys', () => {
    expect(tr('demo.plain')).toBe('No placeholders');
    expect(tr('demo.group.nested.leaf')).toBe('Deep');
  });

  it('fills placeholders and keeps unknown ones', () => {
    expect(tr('demo.greeting', { name: 'gEdit' })).toBe('Hello, gEdit!');
    expect(tr('demo.twice', { a: 7 })).toBe('7 and 7');
    expect(tr('demo.greeting')).toBe('Hello, {name}!');
    expect(tr('demo.greeting', { other: 'x' })).toBe('Hello, {name}!');
  });

  it('does not read placeholder values from the prototype', () => {
    const { t: tr2 } = createTranslator({ demo: { proto: '{constructor}' } });
    expect(tr2('demo.proto', {})).toBe('{constructor}');
  });

  it('selects plural forms from a numeric count', () => {
    expect(tr('demo.items', { count: 1 })).toBe('1 item');
    expect(tr('demo.items', { count: 0 })).toBe('0 items');
    expect(tr('demo.items', { count: 2 })).toBe('2 items');
    expect(tr('demo.items', { count: 1.5 })).toBe('1.5 items');
  });

  it('falls back to _other, then to the plain key', () => {
    expect(tr('demo.onlyOther', { count: 1 })).toBe('1 things');
    expect(tr('demo.items')).toBe('{count} items');
    expect(tr('demo.plain', { count: 3 })).toBe('No placeholders');
  });

  it('ignores a count that is not a number when choosing the form', () => {
    expect(tr('demo.items', { count: '1' })).toBe('1 items');
  });

  it('returns the key and reports it when there is no message', () => {
    const onMissing = vi.fn();
    const { t: tr2 } = createTranslator(sample, 'en', { onMissing });
    expect(tr2('demo.missing')).toBe('demo.missing');
    expect(tr2('demo.group')).toBe('demo.group');
    expect(tr2('nope')).toBe('nope');
    expect(onMissing.mock.calls).toEqual([['demo.missing'], ['demo.group'], ['nope']]);
  });

  it('hasKey agrees with t()', () => {
    expect(has('demo.plain')).toBe(true);
    expect(has('demo.group.nested.leaf')).toBe(true);
    expect(has('demo.items')).toBe(true);
    expect(has('demo.items_one')).toBe(true);
    expect(has('demo.onlyOther')).toBe(true);
    expect(has('demo.group')).toBe(false);
    expect(has('demo')).toBe(false);
    expect(has('demo.missing')).toBe(false);
    expect(has('other.plain')).toBe(false);
  });
});

describe('default translator', () => {
  it('loads the namespace files from en/', () => {
    expect(Object.keys(namespaces)).toContain('common');
  });

  it('translates common keys', () => {
    expect(t('common.cancel')).toBe('Cancel');
    expect(t('common.lineNumber', { line: 42 })).toBe('Line 42');
    expect(t('common.lines', { count: 1 })).toBe('1 line');
    expect(t('common.lines', { count: 12 })).toBe('12 lines');
    expect(hasKey('common.files')).toBe(true);
    expect(hasKey('common.nothingHere')).toBe(false);
  });
});
