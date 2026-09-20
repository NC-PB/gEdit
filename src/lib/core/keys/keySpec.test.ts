// Shortcut specs (plan §5 WP1.1 "Tests": macOS and other labels, F-keys, Ctrl vs Mod,
// Monaco numbers), plus event matching and conflict detection.
//
// `standaloneEnums.js` is Monaco's generated enum file: plain numbers, no DOM, so the
// real `KeyCode` values can be asserted in a node test. `KeyMod` lives in
// `editorBaseApi.js`, which pulls in the editor, so its four constants are restated here
// (monaco-editor 0.55: `editorBaseApi.js:16-19`) and cross-checked in the first test.

// @ts-expect-error - monaco-editor ships no declaration for this generated deep path
import { KeyCode as MonacoKeyCode } from 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js';
import { describe, expect, it } from 'vitest';
import {
  findConflicts,
  formatKey,
  isValidKeySpec,
  matchesKey,
  parseKey,
  resolveKeys,
  toMonacoKeybinding,
  type KeyEventLike,
} from './keySpec';
import type { CommandDef } from '$lib/app/types';

class KeyMod {
  static readonly CtrlCmd = 2048;
  static readonly Shift = 1024;
  static readonly Alt = 512;
  static readonly WinCtrl = 256;
  static chord(first: number, second: number): number {
    return (first << 16) | second;
  }
}

const KeyCode = MonacoKeyCode as unknown as Parameters<typeof toMonacoKeybinding>[3];

function keyEvent(over: Partial<KeyEventLike>): KeyEventLike {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  };
}

function command(id: string, keys: CommandDef['keys']): CommandDef {
  return { id, title: `t.${id}`, keys, run: () => {} };
}

describe('parseKey', () => {
  it('reads modifiers in any order and normalizes the key', () => {
    expect(parseKey('Mod+S')).toEqual({ key: 'S', mod: true, ctrl: false, alt: false, shift: false });
    expect(parseKey('shift+mod+s')).toEqual({
      key: 'S',
      mod: true,
      ctrl: false,
      alt: false,
      shift: true,
    });
    expect(parseKey('Mod+Alt+S')).toEqual({
      key: 'S',
      mod: true,
      ctrl: false,
      alt: true,
      shift: false,
    });
  });

  it('keeps Ctrl separate from Mod', () => {
    expect(parseKey('Ctrl+G')).toEqual({ key: 'G', mod: false, ctrl: true, alt: false, shift: false });
    expect(parseKey('Mod+Ctrl+G')).toEqual({
      key: 'G',
      mod: true,
      ctrl: true,
      alt: false,
      shift: false,
    });
  });

  it('accepts F-keys, digits, punctuation and named keys', () => {
    expect(parseKey('F7').key).toBe('F7');
    expect(parseKey('Shift+F7')).toEqual({
      key: 'F7',
      mod: false,
      ctrl: false,
      alt: false,
      shift: true,
    });
    expect(parseKey('Mod+1').key).toBe('1');
    expect(parseKey('Mod+,').key).toBe(',');
    expect(parseKey('Mod+Plus').key).toBe('+');
    expect(parseKey('Ctrl+Tab').key).toBe('Tab');
    expect(parseKey('mod+pagedown').key).toBe('PageDown');
    expect(parseKey('Alt+Left').key).toBe('Left');
    expect(parseKey('esc').key).toBe('Escape');
  });

  it('throws on a malformed spec', () => {
    expect(() => parseKey('')).toThrow(/invalid key spec/);
    expect(() => parseKey('Mod+')).toThrow(/invalid key spec/);
    expect(() => parseKey('Mod++S')).toThrow(/invalid key spec/);
    expect(() => parseKey('Super+S')).toThrow(/unknown modifier/);
    expect(() => parseKey('Mod+Shift')).toThrow(/unknown key/);
    expect(() => parseKey('Mod+F25')).toThrow(/unknown key/);
    expect(() => parseKey('Mod+Ctrl+Ctrl+S')).toThrow(/duplicate modifier/);
    expect(isValidKeySpec('Mod+S')).toBe(true);
    expect(isValidKeySpec('Mod+F25')).toBe(false);
  });
});

describe('resolveKeys', () => {
  it('picks the platform spec', () => {
    expect(resolveKeys('Mod+S', true)).toBe('Mod+S');
    expect(resolveKeys({ mac: 'Mod+S', other: 'Ctrl+S' }, true)).toBe('Mod+S');
    expect(resolveKeys({ mac: 'Mod+S', other: 'Ctrl+S' }, false)).toBe('Ctrl+S');
    expect(resolveKeys({ mac: 'Mod+S' }, false)).toBeUndefined();
    expect(resolveKeys(undefined, true)).toBeUndefined();
  });
});

describe('formatKey', () => {
  it('uses the macOS symbols in Apple order', () => {
    expect(formatKey('Mod+Shift+S', true)).toBe('⇧⌘S');
    expect(formatKey('Mod+S', true)).toBe('⌘S');
    expect(formatKey('Mod+Alt+S', true)).toBe('⌥⌘S');
    expect(formatKey('Ctrl+G', true)).toBe('⌃G');
    expect(formatKey('Ctrl+Shift+Tab', true)).toBe('⌃⇧⇥');
    expect(formatKey('Mod+,', true)).toBe('⌘,');
    expect(formatKey('Mod+Left', true)).toBe('⌘←');
  });

  it('spells the modifiers out elsewhere, with Mod as Ctrl', () => {
    expect(formatKey('Mod+Shift+S', false)).toBe('Ctrl+Shift+S');
    expect(formatKey('Mod+S', false)).toBe('Ctrl+S');
    expect(formatKey('Mod+Alt+S', false)).toBe('Ctrl+Alt+S');
    expect(formatKey('Ctrl+G', false)).toBe('Ctrl+G');
    expect(formatKey('Ctrl+Shift+Tab', false)).toBe('Ctrl+Shift+Tab');
    expect(formatKey('Mod+,', false)).toBe('Ctrl+,');
    expect(formatKey('Mod+Left', false)).toBe('Ctrl+Left');
  });

  it('leaves a bare F-key alone on both platforms', () => {
    expect(formatKey('F7', true)).toBe('F7');
    expect(formatKey('F7', false)).toBe('F7');
    expect(formatKey('Shift+F7', true)).toBe('⇧F7');
    expect(formatKey('Shift+F7', false)).toBe('Shift+F7');
  });
});

describe('toMonacoKeybinding', () => {
  it('restates the KeyMod constants monaco-editor 0.55 ships', () => {
    expect([KeyMod.CtrlCmd, KeyMod.Shift, KeyMod.Alt, KeyMod.WinCtrl]).toEqual([
      2048, 1024, 512, 256,
    ]);
    expect(KeyCode.KeyS).toBe(49);
    expect(KeyCode.F7).toBe(65);
    expect(KeyCode.Comma).toBe(87);
  });

  it('maps Mod to CtrlCmd on both platforms', () => {
    expect(toMonacoKeybinding('Mod+S', true, KeyMod, KeyCode)).toBe(2048 | 49);
    expect(toMonacoKeybinding('Mod+S', false, KeyMod, KeyCode)).toBe(2048 | 49);
  });

  it('maps a literal Ctrl to WinCtrl on macOS and to CtrlCmd elsewhere', () => {
    expect(toMonacoKeybinding('Ctrl+G', true, KeyMod, KeyCode)).toBe(256 | KeyCode.KeyG);
    expect(toMonacoKeybinding('Ctrl+G', false, KeyMod, KeyCode)).toBe(2048 | KeyCode.KeyG);
  });

  it('combines Shift and Alt, and maps F-keys and punctuation', () => {
    expect(toMonacoKeybinding('Mod+Shift+S', true, KeyMod, KeyCode)).toBe(2048 | 1024 | 49);
    expect(toMonacoKeybinding('Mod+Alt+S', true, KeyMod, KeyCode)).toBe(2048 | 512 | 49);
    expect(toMonacoKeybinding('Shift+F7', true, KeyMod, KeyCode)).toBe(1024 | 65);
    expect(toMonacoKeybinding('F1', true, KeyMod, KeyCode)).toBe(KeyCode.F1);
    expect(toMonacoKeybinding('Mod+,', true, KeyMod, KeyCode)).toBe(2048 | 87);
    expect(toMonacoKeybinding('Ctrl+Tab', false, KeyMod, KeyCode)).toBe(2048 | KeyCode.Tab);
    expect(toMonacoKeybinding('Mod+Alt+O', true, KeyMod, KeyCode)).toBe(2048 | 512 | KeyCode.KeyO);
  });
});

describe('matchesKey', () => {
  it('matches Mod against Cmd on macOS and Ctrl elsewhere', () => {
    const cmdS = keyEvent({ key: 's', code: 'KeyS', metaKey: true });
    const ctrlS = keyEvent({ key: 's', code: 'KeyS', ctrlKey: true });
    expect(matchesKey('Mod+S', cmdS, true)).toBe(true);
    expect(matchesKey('Mod+S', ctrlS, true)).toBe(false);
    expect(matchesKey('Mod+S', ctrlS, false)).toBe(true);
    expect(matchesKey('Mod+S', cmdS, false)).toBe(false);
  });

  it('matches a literal Ctrl against the Control key on macOS', () => {
    const ctrlG = keyEvent({ key: 'g', code: 'KeyG', ctrlKey: true });
    expect(matchesKey('Ctrl+G', ctrlG, true)).toBe(true);
    expect(matchesKey('Ctrl+G', ctrlG, false)).toBe(true);
    expect(matchesKey('Mod+G', ctrlG, true)).toBe(false);
  });

  it('rejects an extra modifier', () => {
    const e = keyEvent({ key: 's', code: 'KeyS', metaKey: true, shiftKey: true });
    expect(matchesKey('Mod+S', e, true)).toBe(false);
    expect(matchesKey('Mod+Shift+S', e, true)).toBe(true);
  });

  it('matches F-keys, Tab and punctuation by code', () => {
    expect(matchesKey('F7', keyEvent({ key: 'F7', code: 'F7' }), true)).toBe(true);
    expect(
      matchesKey('Ctrl+Shift+Tab', keyEvent({ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true }), true),
    ).toBe(true);
    expect(matchesKey('Mod+,', keyEvent({ key: ',', code: 'Comma', metaKey: true }), true)).toBe(true);
  });

  it('falls back to event.key when the code is missing or foreign', () => {
    expect(matchesKey('Mod+S', keyEvent({ key: 'S', code: '', metaKey: true }), true)).toBe(true);
    // A Dvorak layout reports code 'KeyO' for the physical key that types 's'.
    expect(matchesKey('Mod+S', keyEvent({ key: 's', code: 'KeyO', metaKey: true }), true)).toBe(true);
    expect(matchesKey('Mod+Left', keyEvent({ key: 'ArrowLeft', code: '', metaKey: true }), true)).toBe(
      true,
    );
  });
});

describe('findConflicts', () => {
  it('pairs the newcomer with the command that claimed the shortcut first', () => {
    const defs = [command('a.one', 'Mod+K'), command('b.two', 'Mod+K'), command('c.three', 'Mod+J')];
    expect(findConflicts(defs, true)).toEqual([['a.one', 'b.two']]);
    expect(findConflicts(defs, false)).toEqual([['a.one', 'b.two']]);
  });

  it('treats Mod and Ctrl as the same key off macOS only', () => {
    const defs = [command('a.mod', 'Mod+G'), command('b.ctrl', 'Ctrl+G')];
    expect(findConflicts(defs, true)).toEqual([]);
    expect(findConflicts(defs, false)).toEqual([['a.mod', 'b.ctrl']]);
  });

  it('only compares the spec that applies on the platform', () => {
    const defs = [
      command('a.split', { mac: 'Mod+K', other: 'Mod+L' }),
      command('b.plain', 'Mod+K'),
    ];
    expect(findConflicts(defs, true)).toEqual([['a.split', 'b.plain']]);
    expect(findConflicts(defs, false)).toEqual([]);
  });

  it('skips commands without a shortcut and malformed specs', () => {
    const defs = [command('a.none', undefined), command('b.bad', 'Nope+K'), command('c.bad', 'Nope+K')];
    expect(findConflicts(defs, true)).toEqual([]);
  });
});
