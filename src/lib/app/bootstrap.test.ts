// Startup (plan §5 WP1.5, P2): the fixed order of the seven steps, the disposer, and the
// two pieces that can be checked against the real singletons in node - the command
// context and the test hook - before any document or editor exists.

import { describe, expect, it, vi } from 'vitest';
import {
  buildTestHook,
  commandContext,
  createStartApp,
  type BootstrapDeps,
} from './bootstrap';
import type { CommandContext, Disposable } from '$lib/app/types';

const CONTEXT: CommandContext = {
  activeDocId: 'd1',
  profileId: 'fanuc-gcode',
  hasSelection: false,
  editorFocused: true,
  compareOpen: false,
  modalOpen: false,
  scriptRunning: false,
};

const MONACO = { editor: {} } as never;

interface Harness {
  log: string[];
  deps: BootstrapDeps;
  resolveMonaco: (value?: unknown) => void;
  rejectMonaco: (err: unknown) => void;
}

function harness(over: Partial<BootstrapDeps> = {}): Harness {
  const log: string[] = [];
  let resolveMonaco!: (value?: unknown) => void;
  let rejectMonaco!: (err: unknown) => void;
  const monaco = new Promise<typeof MONACO>((resolve, reject) => {
    resolveMonaco = () => resolve(MONACO);
    rejectMonaco = reject;
  });
  const step = (name: string): Disposable => {
    log.push(name);
    return () => log.push(`dispose ${name}`);
  };

  const deps: BootstrapDeps = {
    setContextProvider: () => log.push('setContextProvider'),
    commandContext: () => CONTEXT,
    loadSettings: async () => log.push('loadSettings'),
    loadUiState: async () => log.push('loadUiState'),
    loadMachines: async () => log.push('loadMachines'),
    loadContributions: async () => step('loadContributions'),
    installDispatcher: () => step('installDispatcher'),
    watchContext: () => step('watchContext'),
    notifyContextChanged: () => log.push('notifyContextChanged'),
    monacoReady: () => monaco,
    installMonacoBridge: () => step('installMonacoBridge'),
    installTestHook: () => log.push('installTestHook'),
    buildTestHook: (ready) => ({
      ready,
      version: '0.0.0-test',
      text: () => '',
      cursor: () => ({ line: 1, column: 1 }),
      activeProfile: () => '',
      setProfile: () => {},
    }),
    checkPython: async () => log.push('checkPython'),
    setReady: (value) => log.push(`ready=${value}`),
    ...over,
  };
  return { log, deps, resolveMonaco, rejectMonaco };
}

describe('startApp', () => {
  it('runs the steps in the order the plan fixes', async () => {
    const h = harness();
    await createStartApp(h.deps)();
    expect(h.log).toEqual([
      'setContextProvider',
      'loadSettings',
      'loadUiState',
      'loadMachines',
      'loadContributions',
      'installDispatcher',
      'watchContext',
      'installTestHook',
      'checkPython',
    ]);
    h.resolveMonaco();
    await vi.waitFor(() => expect(h.log).toContain('ready=true'));
    expect(h.log.slice(-2)).toEqual(['installMonacoBridge', 'ready=true']);
  });

  it('does not wait for Monaco before it returns', async () => {
    const h = harness();
    // The editor only attaches once the shell has mounted, so awaiting Monaco first
    // would deadlock the shell that is calling this.
    await expect(createStartApp(h.deps)()).resolves.toBeTypeOf('function');
    expect(h.log).not.toContain('ready=true');
  });

  // Step 7 (P5): the probe spawns a process. It is fired, never awaited — an interpreter
  // that takes ten seconds to answer must not hold up `data-ready`.
  it('does not wait for the Python check', async () => {
    const h = harness({ checkPython: () => new Promise(() => {}) });
    await expect(createStartApp(h.deps)()).resolves.toBeTypeOf('function');
    h.resolveMonaco();
    await vi.waitFor(() => expect(h.log).toContain('ready=true'));
  });

  // And it still happens when Monaco never loads: "is there a Python" is shell state, so
  // the script commands must be able to say why they are disabled without an editor.
  it('probes Python even when Monaco fails', async () => {
    const h = harness();
    const dispose = await createStartApp(h.deps)();
    h.rejectMonaco(new Error('no worker'));
    await vi.waitFor(() => expect(h.log).toContain('checkPython'));
    expect(h.log).not.toContain('ready=true');
    dispose();
  });

  it('logs a rejected Python check and starts anyway', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness({ checkPython: () => Promise.reject(new Error('no such command')) });
    await createStartApp(h.deps)();
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
    expect(h.log).toContain('installTestHook');
    error.mockRestore();
  });

  it('resolves the hook promise when the editor is up', async () => {
    let ready: Promise<void> | undefined;
    const h = harness({
      buildTestHook: (p) => {
        ready = p;
        return {
          ready: p,
          version: '0.0.0-test',
          text: () => '',
          cursor: () => ({ line: 1, column: 1 }),
          activeProfile: () => '',
          setProfile: () => {},
        };
      },
    });
    await createStartApp(h.deps)();
    h.resolveMonaco();
    await expect(ready).resolves.toBeUndefined();
  });

  it('keeps the shell usable and `ready` false when Monaco fails', async () => {
    let ready: Promise<void> | undefined;
    const h = harness({
      buildTestHook: (p) => {
        ready = p;
        return {
          ready: p,
          version: '0.0.0-test',
          text: () => '',
          cursor: () => ({ line: 1, column: 1 }),
          activeProfile: () => '',
          setProfile: () => {},
        };
      },
    });
    const dispose = await createStartApp(h.deps)();
    h.rejectMonaco(new Error('no worker'));
    await expect(ready).rejects.toThrow('no worker');
    expect(h.log).not.toContain('ready=true');
    expect(h.log).toContain('installTestHook');
    dispose();
  });

  it('tears every step down again, newest first, and is safe to call twice', async () => {
    const h = harness();
    const dispose = await createStartApp(h.deps)();
    h.resolveMonaco();
    await vi.waitFor(() => expect(h.log).toContain('ready=true'));
    h.log.length = 0;
    dispose();
    dispose();
    expect(h.log).toEqual([
      'ready=false',
      'dispose installMonacoBridge',
      'dispose watchContext',
      'dispose installDispatcher',
      'dispose loadContributions',
      'setContextProvider',
    ]);
  });

  // A config folder that cannot be read must not cost the user their editor.
  it('starts anyway when the persisted state cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness({
      loadSettings: () => Promise.reject(new Error('EACCES settings.json')),
      loadUiState: () => Promise.reject(new Error('EACCES state.json')),
      loadMachines: () => Promise.reject(new Error('EACCES machines.json')),
    });
    await createStartApp(h.deps)();
    expect(h.log).toContain('loadContributions');
    expect(error).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });

  it('disposes a bridge that arrives after the shutdown', async () => {
    const h = harness();
    const dispose = await createStartApp(h.deps)();
    dispose();
    h.log.length = 0;
    h.resolveMonaco();
    await vi.waitFor(() => expect(h.log).toContain('dispose installMonacoBridge'));
    expect(h.log).not.toContain('ready=true');
  });
});

describe('commandContext', () => {
  it('reports an empty app before anything is open', () => {
    expect(commandContext()).toEqual({
      activeDocId: null,
      profileId: null,
      hasSelection: false,
      editorFocused: false,
      compareOpen: false,
      modalOpen: false,
      scriptRunning: false,
    });
  });
});

describe('buildTestHook', () => {
  const hook = buildTestHook(Promise.resolve());

  it('answers with neutral values while no document is open', () => {
    expect(hook.text()).toBe('');
    expect(hook.cursor()).toEqual({ line: 1, column: 1 });
    expect(hook.activeProfile()).toBe('');
  });

  it('exposes the service aggregate', () => {
    expect(hook.ctx?.commands).toBeDefined();
    expect(hook.ctx?.layout).toBeDefined();
  });

  it('refuses an unknown profile', () => {
    expect(() => hook.setProfile('no-such-profile')).toThrow(/Unknown profile/);
  });
});
