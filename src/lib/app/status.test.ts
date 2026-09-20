// The status service (plan §7.2): one message at a time, 4 s for a message and 8 s for an
// error, `sticky` never clears itself.

import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_TIMEOUT_MS, MESSAGE_TIMEOUT_MS, status } from './status';

beforeEach(() => {
  vi.useFakeTimers();
  status.clear();
});

afterEach(() => {
  status.clear();
  vi.useRealTimers();
});

describe('status.show', () => {
  it('publishes the text and clears it after four seconds', () => {
    status.show('Saved a.nc');
    expect(get(status.current)).toEqual({ text: 'Saved a.nc', error: false });
    vi.advanceTimersByTime(MESSAGE_TIMEOUT_MS - 1);
    expect(get(status.current)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(get(status.current)).toBeNull();
  });

  it('keeps an error twice as long', () => {
    status.show('Could not save a.nc', { error: true });
    expect(get(status.current)).toEqual({ text: 'Could not save a.nc', error: true });
    vi.advanceTimersByTime(MESSAGE_TIMEOUT_MS);
    expect(get(status.current)?.error).toBe(true);
    vi.advanceTimersByTime(ERROR_TIMEOUT_MS - MESSAGE_TIMEOUT_MS);
    expect(get(status.current)).toBeNull();
  });

  it('carries the untranslated detail text', () => {
    status.show('Could not list the scripts', { error: true, detail: 'No such file (os error 2)' });
    expect(get(status.current)?.detail).toBe('No such file (os error 2)');
  });

  it('leaves a sticky message until it is replaced', () => {
    status.show('Running a_echo.py…', { sticky: true });
    vi.advanceTimersByTime(60_000);
    expect(get(status.current)?.text).toBe('Running a_echo.py…');
    status.show('a_echo.py finished');
    expect(get(status.current)?.text).toBe('a_echo.py finished');
    vi.advanceTimersByTime(MESSAGE_TIMEOUT_MS);
    expect(get(status.current)).toBeNull();
  });

  it('restarts the timer of the message it replaces', () => {
    status.show('first');
    vi.advanceTimersByTime(MESSAGE_TIMEOUT_MS - 100);
    status.show('second');
    vi.advanceTimersByTime(MESSAGE_TIMEOUT_MS - 100);
    expect(get(status.current)?.text).toBe('second');
    vi.advanceTimersByTime(100);
    expect(get(status.current)).toBeNull();
  });
});

describe('status.clear', () => {
  it('drops the message and its pending timer', () => {
    status.show('gone');
    status.clear();
    expect(get(status.current)).toBeNull();
    // A stale timer would have to fire into an already empty store; nothing may throw.
    vi.advanceTimersByTime(ERROR_TIMEOUT_MS);
    expect(get(status.current)).toBeNull();
  });
});
