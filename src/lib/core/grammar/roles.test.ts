// The role palette and the two generated themes (plan §5 WP3.4).
//
// The acceptance the plan asks for is here: **every role colour passes WCAG AA against the
// editor background, in both themes**. The contrast ratio below is the WCAG 2.x formula —
// linearise each sRGB channel, weight them into a relative luminance, then
// `(lighter + 0.05) / (darker + 0.05)` — and 4.5:1 is the AA threshold for body text.
//
// Two more checks keep the palette usable rather than merely legible: no two roles share a
// colour inside a theme, and every pair stays far enough apart to be told apart at a
// glance — with `tool`, `feed` and `axis` held to more, because the `m3-profiles` scenario
// asserts those three are distinct on screen.
//
// "Far apart" is not the contrast ratio: that measures lightness only, and a tan and an
// orange of the same lightness answer 1.1 while looking nothing alike. The distance here is
// CIE76 ΔE in CIELAB, where about 2.3 is the smallest difference an eye can see at all.

import { describe, expect, it } from 'vitest';
import {
  EDITOR_COLORS,
  ROLES,
  ROLE_COLORS,
  ROLE_FONT_STYLE,
  THEME_BASE,
  THEME_IDS,
  generateThemes,
  profileOverrides,
  type GeneratedTheme,
  type Role,
} from './index';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import type { Profile } from '$lib/core/profiles/types';

const MODES = ['dark', 'light'] as const;

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `#rrggbb` as CIELAB, D65 white. */
function lab(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 colour difference; about 2.3 is the smallest difference the eye resolves. */
function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

const profiles: Profile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return checked.profile;
});

describe('the role palette', () => {
  it('knows the contrast formula it is checked with', () => {
    // Anchors from WCAG's own examples, so a broken helper cannot silently pass the palette.
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it.each(MODES)('%s: gives every role a colour, and nothing else', (mode) => {
    expect(Object.keys(ROLE_COLORS[mode]).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) expect(ROLE_COLORS[mode][role], role).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(MODES)('%s: every role reaches WCAG AA against the editor background', (mode) => {
    const background = EDITOR_COLORS[mode].background;
    const failures = ROLES.map((role) => ({ role, ratio: contrast(ROLE_COLORS[mode][role], background) })).filter(
      (entry) => entry.ratio < 4.5,
    );
    expect(failures, `${mode}: under 4.5:1 on ${background}`).toEqual([]);
  });

  it.each(MODES)('%s: the editor foreground reaches AA as well', (mode) => {
    expect(contrast(EDITOR_COLORS[mode].foreground, EDITOR_COLORS[mode].background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MODES)('%s: no two roles share a colour', (mode) => {
    const byColor = new Map<string, Role[]>();
    for (const role of ROLES) {
      const color = ROLE_COLORS[mode][role];
      byColor.set(color, [...(byColor.get(color) ?? []), role]);
    }
    expect([...byColor].filter(([, roles]) => roles.length > 1)).toEqual([]);
  });

  it.each(MODES)('%s: no two roles look alike', (mode) => {
    const close: string[] = [];
    for (let i = 0; i < ROLES.length; i++) {
      for (let j = i + 1; j < ROLES.length; j++) {
        const distance = deltaE(ROLE_COLORS[mode][ROLES[i]], ROLE_COLORS[mode][ROLES[j]]);
        if (distance < 10) close.push(`${ROLES[i]}/${ROLES[j]} ${distance.toFixed(1)}`);
      }
    }
    expect(close, `${mode}: pairs under ΔE 10`).toEqual([]);
  });

  it.each(MODES)('%s: tool, feed and axis are told apart', (mode) => {
    const pairs: [Role, Role][] = [
      ['tool', 'feed'],
      ['tool', 'axis'],
      ['feed', 'axis'],
    ];
    for (const [a, b] of pairs) {
      expect(deltaE(ROLE_COLORS[mode][a], ROLE_COLORS[mode][b]), `${mode}: ${a} vs ${b}`).toBeGreaterThan(15);
    }
  });

  it('matches the program-map colours of app.css', () => {
    // `--nc-tool` and `--nc-comment` are the same two values; the panel and the editor have
    // to say the same thing about the same code.
    expect(ROLE_COLORS.dark.tool).toBe('#dcb67a');
    expect(ROLE_COLORS.light.tool).toBe('#8a5300');
    expect(ROLE_COLORS.dark.comment).toBe('#10b981');
    expect(ROLE_COLORS.light.comment).toBe('#0e7a43');
  });

  it('only styles roles it has a colour for', () => {
    for (const role of Object.keys(ROLE_FONT_STYLE)) expect(ROLES).toContain(role as Role);
    for (const style of Object.values(ROLE_FONT_STYLE)) expect(style).toMatch(/^(bold|italic|bold italic)$/);
  });
});

describe('generateThemes', () => {
  const themes = generateThemes(profiles) as { dark: GeneratedTheme; light: GeneratedTheme };

  it.each(MODES)('%s: inherits the built-in base and paints the editor surface', (mode) => {
    const theme = themes[mode];
    expect(theme.base).toBe(THEME_BASE[mode]);
    // Inheriting keeps the hundreds of workbench colours we do not want to restate, and it
    // is what keeps `.monaco-editor` carrying the `vs` / `vs-dark` class of its mode.
    expect(theme.inherit).toBe(true);
    expect(theme.colors['editor.background']).toBe(EDITOR_COLORS[mode].background);
    expect(theme.colors['editor.foreground']).toBe(EDITOR_COLORS[mode].foreground);
  });

  it.each(MODES)('%s: carries one rule per role, with its colour and weight', (mode) => {
    const theme = themes[mode];
    for (const role of ROLES) {
      const rule = theme.rules.find((entry) => entry.token === role);
      expect(rule, `no rule for ${role}`).toBeDefined();
      expect(rule?.foreground).toBe(ROLE_COLORS[mode][role]);
      expect(rule?.fontStyle).toBe(ROLE_FONT_STYLE[role]);
    }
    expect(theme.rules).toHaveLength(ROLES.length);
  });

  it('spells the colours the way Monaco parses them', () => {
    // `ColorMap.getId` accepts `#rrggbb` or `rrggbb` and throws on anything else.
    for (const mode of MODES) {
      for (const rule of themes[mode].rules) expect(rule.foreground).toMatch(/^#?[0-9a-fA-F]{6}$/);
      for (const value of Object.values(themes[mode].colors)) expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('names the themes the app asks Monaco for', () => {
    expect(THEME_IDS).toEqual({ light: 'gedit-light', dark: 'gedit-dark' });
    // A theme id has to survive Monaco's `defineTheme` check, `/^[a-z0-9\-]+$/i`.
    for (const id of Object.values(THEME_IDS)) expect(id).toMatch(/^[a-z0-9-]+$/i);
  });

  it('lets a profile override a role for itself', () => {
    // Monarch emits `feed.<profile id>`, and Monaco matches a theme rule by prefix, so the
    // longer token wins for that one profile and `feed` still covers every other.
    const painted = { ...profiles[0], colors: { dark: { feed: '#ff00ff' }, light: { feed: '#004400' } } } as Profile;
    const own = generateThemes([painted]) as { dark: GeneratedTheme; light: GeneratedTheme };
    const rule = own.dark.rules.find((entry) => entry.token === `feed.${painted.id}`);
    expect(rule?.foreground).toBe('#ff00ff');
    expect(own.dark.rules.findIndex((entry) => entry.token === 'feed')).toBeLessThan(
      own.dark.rules.findIndex((entry) => entry.token === `feed.${painted.id}`),
    );
    expect(own.light.rules.find((entry) => entry.token === `feed.${painted.id}`)?.foreground).toBe('#004400');
  });

  it('ignores an override that is not a colour, rather than failing to start', () => {
    const odd = { ...profiles[0], colors: { dark: { feed: 'red', nonsense: '#ffffff' }, light: 7 } } as unknown as Profile;
    expect(profileOverrides(odd, 'dark')).toEqual({});
    expect(profileOverrides(odd, 'light')).toEqual({});
    expect(profileOverrides(profiles[0], 'dark')).toEqual({});
    const generated = generateThemes([odd]) as { dark: GeneratedTheme };
    expect(generated.dark.rules).toHaveLength(ROLES.length);
  });

  it('survives an empty registry', () => {
    const empty = generateThemes([]) as { dark: GeneratedTheme; light: GeneratedTheme };
    expect(empty.dark.rules).toHaveLength(ROLES.length);
    expect(empty.light.rules).toHaveLength(ROLES.length);
  });
});
