// Shortcut specs (plan AD-4, §7.1 "Module exports"). Owner: WP1.1.
//
// A KeySpec is modifiers and one main key joined by '+', e.g. 'Mod+S', 'Ctrl+G', 'F7',
// 'Shift+F7', 'Mod+Alt+S' or 'Mod+,'. `Mod` is Cmd on macOS and Ctrl elsewhere; `Ctrl` is
// always the literal Control key. Modifier order does not matter, matching is
// case-insensitive, and the main key is the last part.
//
// This module is pure (`core/`): no Svelte, no Monaco runtime, no Tauri. `KeyMod` and
// `KeyCode` are injected into `toMonacoKeybinding`, so Monaco stays out of `core/`.

import type { CommandDef, KeySpec } from '$lib/app/types';

type MonacoKeyMod = typeof import('monaco-editor/esm/vs/editor/editor.api.js').KeyMod;
type MonacoKeyCode = typeof import('monaco-editor/esm/vs/editor/editor.api.js').KeyCode;

/**
 * A parsed shortcut. `key` is the normalized main key ('S', 'F7', ','); `mod` is the
 * platform modifier (Cmd on macOS, Ctrl elsewhere) and `ctrl` the literal Control key.
 */
export interface ParsedKey {
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/** Keyboard-event fields the matcher reads (a subset of KeyboardEvent, so tests can fake it). */
export interface KeyEventLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Normalized names of the keys that are not a letter, a digit or an F-key. */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  escape: 'Escape',
  esc: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  /** '+' cannot be written literally, because '+' separates the parts. */
  plus: '+',
};

/** The punctuation keys a spec may name directly, with their `KeyboardEvent.code`. */
const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
  '+': 'Equal',
};

/** Normalized key name → `KeyboardEvent.code`, for the keys whose code is not the name itself. */
const NAMED_CODES: Readonly<Record<string, string>> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};

/** Normalized key name → `KeyboardEvent.key`, for the keys whose `key` is not the name itself. */
const NAMED_EVENT_KEYS: Readonly<Record<string, string>> = {
  Space: ' ',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};

/** Normalized key name → the symbol macOS menus use for it. */
const MAC_KEY_SYMBOLS: Readonly<Record<string, string>> = {
  Enter: '↩',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: '⎋',
  PageUp: '⇞',
  PageDown: '⇟',
  Home: '↖',
  End: '↘',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

const LETTER = /^[A-Z]$/;
const DIGIT = /^[0-9]$/;
const FUNCTION_KEY = /^F([1-9]|1[0-9])$/;

/** Normalizes one main-key token, or returns undefined when it names no key. */
function normalizeKey(raw: string): string | undefined {
  const upper = raw.toUpperCase();
  if (LETTER.test(upper) || DIGIT.test(upper)) return upper;
  if (FUNCTION_KEY.test(upper)) return upper;
  const named = NAMED_KEYS[raw.toLowerCase()];
  if (named) return named;
  if (Object.prototype.hasOwnProperty.call(PUNCTUATION_CODES, raw)) return raw;
  return undefined;
}

/** Throws on a malformed spec (unknown modifier, unknown key, duplicate modifier, empty part). */
export function parseKey(spec: KeySpec): ParsedKey {
  const parts = spec.split('+');
  const parsed: ParsedKey = { key: '', mod: false, ctrl: false, alt: false, shift: false };
  const bad: (why: string) => never = (why) => {
    throw new Error(`invalid key spec "${spec}": ${why}`);
  };

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i].trim();
    if (!part) bad("empty part (write '+' as 'Plus')");
    if (i === parts.length - 1) {
      const key = normalizeKey(part);
      if (!key) bad(`unknown key "${part}"`);
      parsed.key = key;
      break;
    }
    switch (part.toLowerCase()) {
      case 'mod':
        if (parsed.mod) bad('duplicate modifier "Mod"');
        parsed.mod = true;
        break;
      case 'ctrl':
        if (parsed.ctrl) bad('duplicate modifier "Ctrl"');
        parsed.ctrl = true;
        break;
      case 'alt':
        if (parsed.alt) bad('duplicate modifier "Alt"');
        parsed.alt = true;
        break;
      case 'shift':
        if (parsed.shift) bad('duplicate modifier "Shift"');
        parsed.shift = true;
        break;
      default:
        bad(`unknown modifier "${part}" (use Mod, Ctrl, Alt or Shift)`);
    }
  }
  return parsed;
}

/** True when `spec` parses; use it to validate without catching. */
export function isValidKeySpec(spec: KeySpec): boolean {
  try {
    parseKey(spec);
    return true;
  } catch {
    return false;
  }
}

/**
 * The spec that applies on this platform, or undefined when the command has no shortcut
 * there. `keys` is either one spec for both platforms or `{ mac, other }`.
 */
export function resolveKeys(
  keys: CommandDef['keys'],
  isMac: boolean,
): KeySpec | undefined {
  if (!keys) return undefined;
  if (typeof keys === 'string') return keys;
  return isMac ? keys.mac : keys.other;
}

/** Display label: '⇧⌘S' on macOS, 'Ctrl+Shift+S' elsewhere. */
export function formatKey(spec: KeySpec, isMac: boolean): string {
  const p = parseKey(spec);
  if (isMac) {
    // Apple's order: Control, Option, Shift, Command, then the key, with no separators.
    return (
      (p.ctrl ? '⌃' : '') +
      (p.alt ? '⌥' : '') +
      (p.shift ? '⇧' : '') +
      (p.mod ? '⌘' : '') +
      (MAC_KEY_SYMBOLS[p.key] ?? p.key)
    );
  }
  const parts: string[] = [];
  // Off macOS both `Mod` and `Ctrl` are the Control key, so they collapse into one label.
  if (p.mod || p.ctrl) parts.push('Ctrl');
  if (p.alt) parts.push('Alt');
  if (p.shift) parts.push('Shift');
  parts.push(p.key);
  return parts.join('+');
}

/** The number Monaco's `addEditorAction({ keybindings })` and `addKeybindingRules` expect. */
export function toMonacoKeybinding(
  spec: KeySpec,
  isMac: boolean,
  KeyMod: MonacoKeyMod,
  KeyCode: MonacoKeyCode,
): number {
  const p = parseKey(spec);
  let value = 0;
  // KeyMod.CtrlCmd is Cmd on macOS and Ctrl elsewhere, which is exactly `Mod`.
  if (p.mod) value |= KeyMod.CtrlCmd;
  // KeyMod.WinCtrl is the literal Control key on macOS; elsewhere Control is CtrlCmd.
  if (p.ctrl) value |= isMac ? KeyMod.WinCtrl : KeyMod.CtrlCmd;
  if (p.alt) value |= KeyMod.Alt;
  if (p.shift) value |= KeyMod.Shift;
  return value | monacoKeyCode(p.key, KeyCode);
}

function monacoKeyCode(key: string, KeyCode: MonacoKeyCode): number {
  if (LETTER.test(key)) return KeyCode[`Key${key}` as 'KeyA'];
  if (DIGIT.test(key)) return KeyCode[`Digit${key}` as 'Digit0'];
  if (FUNCTION_KEY.test(key)) return KeyCode[key as 'F1'];
  switch (key) {
    case 'Escape':
      return KeyCode.Escape;
    case 'Enter':
      return KeyCode.Enter;
    case 'Tab':
      return KeyCode.Tab;
    case 'Space':
      return KeyCode.Space;
    case 'Backspace':
      return KeyCode.Backspace;
    case 'Delete':
      return KeyCode.Delete;
    case 'Insert':
      return KeyCode.Insert;
    case 'Home':
      return KeyCode.Home;
    case 'End':
      return KeyCode.End;
    case 'PageUp':
      return KeyCode.PageUp;
    case 'PageDown':
      return KeyCode.PageDown;
    case 'Up':
      return KeyCode.UpArrow;
    case 'Down':
      return KeyCode.DownArrow;
    case 'Left':
      return KeyCode.LeftArrow;
    case 'Right':
      return KeyCode.RightArrow;
    case ',':
      return KeyCode.Comma;
    case '.':
      return KeyCode.Period;
    case '/':
      return KeyCode.Slash;
    case ';':
      return KeyCode.Semicolon;
    case "'":
      return KeyCode.Quote;
    case '[':
      return KeyCode.BracketLeft;
    case ']':
      return KeyCode.BracketRight;
    case '\\':
      return KeyCode.Backslash;
    case '-':
      return KeyCode.Minus;
    case '=':
    case '+':
      return KeyCode.Equal;
    case '`':
      return KeyCode.Backquote;
    default:
      throw new Error(`no Monaco KeyCode for "${key}"`);
  }
}

/** The `KeyboardEvent.code` a normalized key produces on a US layout. */
function eventCodeOf(key: string): string {
  if (LETTER.test(key)) return `Key${key}`;
  if (DIGIT.test(key)) return `Digit${key}`;
  if (FUNCTION_KEY.test(key)) return key;
  return NAMED_CODES[key] ?? PUNCTUATION_CODES[key] ?? key;
}

/**
 * True when `e` is exactly this shortcut: every modifier the spec names is down and no
 * other one is. Matching prefers `KeyboardEvent.code`, which is layout-independent, and
 * falls back to `KeyboardEvent.key` so that a non-US layout still triggers, e.g. 'Mod+,'.
 */
export function matchesKey(spec: KeySpec, e: KeyEventLike, isMac: boolean): boolean {
  const p = parseKey(spec);
  const expectedMeta = isMac ? p.mod : false;
  // Off macOS both `Mod` and `Ctrl` mean the Control key.
  const expectedCtrl = isMac ? p.ctrl : p.mod || p.ctrl;
  if (e.metaKey !== expectedMeta) return false;
  if (e.ctrlKey !== expectedCtrl) return false;
  if (e.altKey !== p.alt) return false;
  if (e.shiftKey !== p.shift) return false;
  if (e.code && e.code === eventCodeOf(p.key)) return true;
  if (!e.key) return false;
  const expectedEventKey = NAMED_EVENT_KEYS[p.key] ?? p.key;
  return e.key.toUpperCase() === expectedEventKey.toUpperCase();
}

/**
 * The parsed spec as a comparable string, e.g. 'mod+shift+S'. Off macOS `Mod` and `Ctrl`
 * are the same physical key, so they collapse: 'Mod+G' and 'Ctrl+G' do conflict there.
 */
function signature(p: ParsedKey, isMac: boolean): string {
  const mod = isMac ? p.mod : p.mod || p.ctrl;
  const ctrl = isMac ? p.ctrl : false;
  return `${mod ? 'mod+' : ''}${ctrl ? 'ctrl+' : ''}${p.alt ? 'alt+' : ''}${p.shift ? 'shift+' : ''}${p.key}`;
}

/**
 * Pairs of command ids that claim the same shortcut on this platform, as
 * `[firstRegistered, conflicting]`. Commands without a shortcut on this platform and
 * malformed specs are skipped: `commands.register` reports those separately.
 */
export function findConflicts(defs: CommandDef[], isMac: boolean): [string, string][] {
  const byKey = new Map<string, string>();
  const conflicts: [string, string][] = [];
  for (const def of defs) {
    const spec = resolveKeys(def.keys, isMac);
    if (!spec) continue;
    let sig: string;
    try {
      sig = signature(parseKey(spec), isMac);
    } catch {
      continue;
    }
    const first = byKey.get(sig);
    if (first === undefined) byKey.set(sig, def.id);
    else if (first !== def.id) conflicts.push([first, def.id]);
  }
  return conflicts;
}
