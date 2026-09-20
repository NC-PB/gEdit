// The two generated Monaco themes (plan §5 WP3.4, §7.4). Owner: WP3.4.
//
// `gedit-dark` and `gedit-light` are built from `ROLE_COLORS`, so a role has one colour
// across every profile and a new dialect needs no theme work at all. Both inherit from
// Monaco's own `vs-dark` / `vs`, which keeps the hundreds of workbench colours (selection,
// find match, ruler, minimap) that a hand-written theme would have to restate; only the
// editor surface and the token rules are ours.
//
// Monarch appends the language id to every token, so `feed` is emitted as
// `feed.fanuc-gcode`, and Monaco matches a theme rule by dot-separated prefix: a rule on
// `feed` covers every profile, and a rule on `feed.fanuc-gcode` overrides that one profile.
// That is how a profile may carry its own palette — a P2 field, unused by the built-ins —
// without the generator knowing anything about it.

import type { Profile } from '$lib/core/profiles/types';
import { EDITOR_COLORS, ROLES, ROLE_COLORS, ROLE_FONT_STYLE, THEME_BASE, type Role } from './roles';

/** One entry of `IStandaloneThemeData.rules`. */
export interface ThemeRule {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

/** `IStandaloneThemeData`, typed here so `core/` stays free of Monaco (AD-1). */
export interface GeneratedTheme {
  base: 'vs' | 'vs-dark';
  inherit: true;
  rules: ThemeRule[];
  colors: Record<string, string>;
}

/** `#rrggbb`, the only colour spelling the generator accepts. */
function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * The per-profile palette, if the profile carries one: `colors.dark` / `colors.light`,
 * a role to a `#rrggbb` value. Anything else in the field is ignored rather than fatal —
 * it is a P2 field, and a profile that does not validate here still has to open files.
 */
export function profileOverrides(p: Profile, mode: 'light' | 'dark'): Partial<Record<Role, string>> {
  const colors = (p as { colors?: unknown }).colors;
  if (typeof colors !== 'object' || colors === null) return {};
  const forMode = (colors as Record<string, unknown>)[mode];
  if (typeof forMode !== 'object' || forMode === null) return {};
  const out: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const value = (forMode as Record<string, unknown>)[role];
    if (isHexColor(value)) out[role] = value;
  }
  return out;
}

/** One theme: the role rules, then whatever a profile overrides for itself. */
function themeFor(mode: 'light' | 'dark', profiles: readonly Profile[]): GeneratedTheme {
  const rules: ThemeRule[] = [];
  for (const role of ROLES) {
    rules.push({ token: role, foreground: ROLE_COLORS[mode][role], ...styleOf(role) });
  }
  for (const profile of profiles) {
    if (typeof profile?.id !== 'string' || profile.id === '') continue;
    const overrides = profileOverrides(profile, mode);
    for (const role of ROLES) {
      const foreground = overrides[role];
      if (foreground !== undefined) rules.push({ token: `${role}.${profile.id}`, foreground, ...styleOf(role) });
    }
  }
  return {
    base: THEME_BASE[mode],
    inherit: true,
    rules,
    colors: {
      'editor.background': EDITOR_COLORS[mode].background,
      'editor.foreground': EDITOR_COLORS[mode].foreground,
    },
  };
}

function styleOf(role: Role): { fontStyle?: string } {
  const fontStyle = ROLE_FONT_STYLE[role];
  return fontStyle === undefined ? {} : { fontStyle };
}

/**
 * Builds `gedit-dark` and `gedit-light` from the role palette plus the per-profile
 * overrides. The return type is deliberately loose: it is `IStandaloneThemeData`, and
 * `monaco/languages.ts` is where it meets Monaco.
 */
export function generateThemes(profiles: Profile[]): { dark: unknown; light: unknown } {
  const list = Array.isArray(profiles) ? profiles : [];
  return { dark: themeFor('dark', list), light: themeFor('light', list) };
}
