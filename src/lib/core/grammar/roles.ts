// What a token means, and the colour it gets (plan §7.4, §5 WP3.4). Owner: WP3.4.
//
// The grammar emits **roles**, never dialect-specific token names, so one theme colours
// every profile and a new dialect needs no theme work. Monarch appends the language id to
// each token (`feed` becomes `feed.fanuc-gcode`), and Monaco matches a theme rule by
// dot-separated prefix, so a rule on `feed` covers every profile while a rule on
// `feed.fanuc-gcode` overrides just one (see `themes.ts`).
//
// The palette is checked, not chosen by eye: `roles.test.ts` asserts that every colour
// reaches the WCAG AA ratio of 4.5:1 against the editor background of its theme, and that
// no two roles in a theme share a value. Changing a colour without re-running that test is
// how an unreadable token gets shipped.
//
// `tool` and `comment` are the two values `src/app.css` already uses for the program map
// (`--nc-tool`, `--nc-comment`); they are kept in step on purpose, so the same code reads
// the same colour in the editor and in the panel.

/** What a token means. The theme colours roles, not dialect-specific token names. */
export type Role =
  | 'blockNumber'
  | 'skip'
  | 'gcode'
  | 'mcode'
  | 'axis'
  | 'arcCenter'
  | 'feed'
  | 'spindle'
  | 'tool'
  | 'variable'
  | 'keyword'
  | 'comment'
  | 'section'
  | 'programMarker'
  | 'number'
  | 'string'
  | 'operator'
  | 'invalid';

/** Every role, in the order they are documented. Handy for a loop over the palette. */
export const ROLES: readonly Role[] = [
  'blockNumber',
  'skip',
  'gcode',
  'mcode',
  'axis',
  'arcCenter',
  'feed',
  'spindle',
  'tool',
  'variable',
  'keyword',
  'comment',
  'section',
  'programMarker',
  'number',
  'string',
  'operator',
  'invalid',
];

/** The Monaco theme ids the app generates and `monaco/theme.ts` switches between. */
export const THEME_IDS: Readonly<Record<'light' | 'dark', string>> = {
  light: 'gedit-light',
  dark: 'gedit-dark',
};

/** The base Monaco theme each generated theme inherits from. */
export const THEME_BASE: Readonly<Record<'light' | 'dark', 'vs' | 'vs-dark'>> = {
  light: 'vs',
  dark: 'vs-dark',
};

/**
 * The editor surface, kept equal to `--bg-app` / `--text-main` in `src/app.css` so the
 * editor and the chrome around it are one surface. These are also the backgrounds the
 * contrast test measures every role against.
 */
export const EDITOR_COLORS: Readonly<Record<'light' | 'dark', { background: string; foreground: string }>> = {
  dark: { background: '#1e1e1e', foreground: '#cccccc' },
  light: { background: '#ffffff', foreground: '#1f1f1f' },
};

/**
 * The role palette. Every value clears WCAG AA (4.5:1) against `EDITOR_COLORS[..].background`
 * and is unique within its theme; `roles.test.ts` is the gate.
 *
 * The nine roles a CAM block shows at once — blockNumber, gcode, mcode, axis, arcCenter,
 * feed, spindle, tool, comment — are spread over the hue circle so a block can be read at
 * a glance. The rarer structural roles (skip, section, programMarker) lean on a weight of
 * their own as well; see `ROLE_FONT_STYLE`.
 *
 * `invalid` is here for the linter (M4). The generated grammar never emits it: marking an
 * error is not the highlighter's job, which is why `defaultToken` is `''`.
 */
export const ROLE_COLORS: { dark: Record<Role, string>; light: Record<Role, string> } = {
  dark: {
    blockNumber: '#9a9a9a',
    skip: '#ff7eb6',
    gcode: '#6ab0f3',
    mcode: '#4ec9b0',
    axis: '#9cdcfe',
    arcCenter: '#56cfe1',
    feed: '#f0a071',
    spindle: '#dcdcaa',
    tool: '#dcb67a', // --nc-tool
    variable: '#b3a0ff',
    keyword: '#d69bdb',
    comment: '#10b981', // --nc-comment
    section: '#dfc7f5',
    programMarker: '#e06c75',
    number: '#b5cea8',
    string: '#d9a0bd',
    operator: '#cccccc',
    invalid: '#f14c4c',
  },
  light: {
    blockNumber: '#5f6368',
    skip: '#a3005c',
    gcode: '#0b5cad',
    mcode: '#0e6b5c',
    axis: '#0a5f8f',
    arcCenter: '#0a6a75',
    feed: '#a04100',
    spindle: '#6b6100',
    tool: '#8a5300', // --nc-tool
    variable: '#5b3fd3',
    keyword: '#8b2fa8',
    comment: '#0e7a43', // --nc-comment
    section: '#4a4a8f',
    programMarker: '#a01b2b',
    number: '#2b6a17',
    string: '#8c3f5f',
    operator: '#1f1f1f',
    invalid: '#c21807',
  },
};

/**
 * Weight and slant per role, the same in both themes. A structure block and a comment
 * carry prose, so they are set apart from code by more than a hue; the tape marker and the
 * program number are the frame of the file and are given weight.
 *
 * The values are Monaco's `fontStyle` strings (`bold`, `italic`, `bold italic`).
 */
export const ROLE_FONT_STYLE: Partial<Record<Role, string>> = {
  comment: 'italic',
  section: 'bold',
  programMarker: 'bold',
};
