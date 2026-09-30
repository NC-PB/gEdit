// The refusal a locked document gives a writer that is not typing (AD-23, TODO Next up 6).

import { describe, expect, it } from 'vitest';
import { LOCK_REFUSAL_KEYS, lockRefusal } from './readOnlyLock';
import { hasKey, t } from '$lib/i18n';

describe('lockRefusal', () => {
  it('lets an editable document through', () => {
    expect(lockRefusal({ readOnly: false, readOnlyReason: null, title: 'a.nc' }, 'Renumber')).toBeNull();
  });

  it('names the tab lock, the document and the action', () => {
    expect(lockRefusal({ readOnly: true, readOnlyReason: 'user', title: 'a.nc' }, 'Renumber')).toEqual({
      key: 'readOnly.refusedUser',
      params: { name: 'a.nc', action: 'Renumber' },
    });
  });

  it('uses the on-disk wording for a file that is read-only itself', () => {
    expect(lockRefusal({ readOnly: true, readOnlyReason: 'attribute', title: 'a.nc' }, 'Renumber')?.key).toBe(
      'readOnly.refusedAttribute',
    );
  });

  it('has a message for both, each saying how to lift the lock', () => {
    for (const key of LOCK_REFUSAL_KEYS) {
      expect(hasKey(key)).toBe(true);
      const text = t(key, { name: 'a.nc', action: 'Renumber' });
      expect(text).toContain('a.nc');
      expect(text).toContain('Renumber');
      expect(text).toContain(t('readOnly.item'));
      expect(text).toContain(t('readOnly.toggle'));
    }
  });
});
