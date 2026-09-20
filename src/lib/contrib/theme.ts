// The color theme and the editor settings (plan §5 WP2.6). Owner: WP2.6.
// One feature per file (plan AD-3); see ./README.md.
//
// Two jobs, one file, because both are "the effective settings reaching the UI":
//   - `appearance.theme` → `applyTheme()` (document, Monaco, native window)
//   - every other appearance, editor and assistance key → `installEditorSettings()`
//
// The theme is applied from the settings *store*, never from the command: the command
// writes `appearance.theme` and the subscription below is the one place that applies it,
// so the settings dialog, the file on disk and this button can never disagree.
//
// No shortcut: §7.11 lists every default binding, and anything else would log a key
// conflict that fails the runtime harness.

import SunMoon from 'lucide-svelte/icons/sun-moon';
import { asIcon } from '$lib/app/icons';
import { applyTheme, themeMode, type ThemeMode } from '$lib/app/theme';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { installEditorSettings } from '$lib/monaco/editorOptions';
import { settings } from '$lib/stores/settings';
import { t } from '$lib/i18n';
import type { Contribution, Disposable, QuickPickItem } from '$lib/app/types';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];

/** Literal `t()` keys, so `i18n/keys.test.ts` can scan them. */
function modeLabel(mode: ThemeMode): string {
  return mode === 'light' ? t('theme.light') : mode === 'dark' ? t('theme.dark') : t('theme.system');
}

function modeDetail(mode: ThemeMode): string {
  return mode === 'light'
    ? t('theme.lightDetail')
    : mode === 'dark'
      ? t('theme.darkDetail')
      : t('theme.systemDetail');
}

function isMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (MODES as string[]).includes(value);
}

/** Remembers the choice; the subscription in `activate()` applies it. */
async function setTheme(mode: ThemeMode): Promise<void> {
  if (mode === settings.get('appearance.theme')) return;
  await settings.save({ 'appearance.theme': mode });
  status.show(t('theme.changed', { name: modeLabel(mode) }));
}

/** The ribbon button has no argument, so it asks. */
async function pickTheme(): Promise<void> {
  const current = themeMode();
  const items: QuickPickItem<ThemeMode>[] = MODES.map((mode) => ({
    label: modeLabel(mode),
    description: mode === current ? '✓' : undefined,
    detail: modeDetail(mode),
    value: mode,
  }));
  const picked = await modals.quickPick(items, {
    placeholder: t('theme.placeholder'),
    initialIndex: Math.max(0, MODES.indexOf(current)),
  });
  if (picked) await setTheme(picked);
}

export default {
  id: 'theme',
  commands: [
    {
      id: 'view.setTheme',
      title: 'theme.setTheme',
      category: 'theme.category',
      icon: asIcon(SunMoon),
      global: true,
      run: (_c, arg) => (isMode(arg) ? setTheme(arg) : pickTheme()),
    },
  ],
  // A group's place in the tab is the smallest `order` its items carry, so 90 puts
  // Appearance after WP1.5's Panels group (10-30) whatever order the contributions load in.
  ribbon: [{ tab: 'view', group: 'theme.group', command: 'view.setTheme', order: 90 }],
  activate(): Disposable {
    // `settings.load()` has already run (bootstrap step 2), so the first subscriber call
    // carries the effective values and the app never flashes the wrong theme.
    let applied: ThemeMode | undefined;
    const stopTheme = settings.values.subscribe((values) => {
      const mode = values['appearance.theme'];
      if (mode === applied) return;
      applied = mode;
      applyTheme(mode);
    });
    const stopEditor = installEditorSettings();
    return () => {
      stopEditor();
      stopTheme();
    };
  },
} satisfies Contribution;
