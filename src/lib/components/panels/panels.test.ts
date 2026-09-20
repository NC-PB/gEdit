// The panel markup contract (plan §7.9): the M0 program-map and script-output test ids
// survive the move into the panel regions. Rendered with `svelte/server`, so no DOM,
// no Monaco and no `onMount`.

import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import ProgramMapPanel from './ProgramMapPanel.svelte';
import ScriptOutputPanel from './ScriptOutputPanel.svelte';
import ScriptStatus from './ScriptStatus.svelte';
import {
  resetScriptsV1ForTest,
  scriptData,
  scriptRunning,
  scriptStderr,
  scriptStdout,
  lastScript,
} from './scriptsV1State';

afterEach(resetScriptsV1ForTest);

describe('ProgramMapPanel', () => {
  it('keeps the program-map seam and says why it is empty', () => {
    const html = render(ProgramMapPanel).body;
    expect(html).toContain('data-testid="program-map"');
    expect(html).not.toContain('data-testid="program-map-item"');
    expect(html).toContain('Open a program to see its structure.');
  });
});

describe('ScriptOutputPanel', () => {
  it('reports whether a script is running', () => {
    expect(render(ScriptOutputPanel).body).toContain('data-running="0"');
    scriptRunning.set(true);
    expect(render(ScriptOutputPanel).body).toContain('data-running="1"');
  });

  it('shows structured data, stdout and stderr under their own test ids', () => {
    scriptData.set({ len: 3 });
    scriptStdout.set('raw text');
    scriptStderr.set('boom');
    const html = render(ScriptOutputPanel).body;
    expect(html).toContain('data-testid="output-json"');
    expect(html).toContain('data-testid="output-stdout"');
    expect(html).toContain('data-testid="output-stderr"');
    expect(html).toContain('"len": 3');
  });

  it('does not repeat the JSON a script also printed on stdout', () => {
    const data = { ok: true };
    scriptData.set(data);
    scriptStdout.set(JSON.stringify(data));
    const html = render(ScriptOutputPanel).body;
    expect(html).toContain('data-testid="output-json"');
    expect(html).not.toContain('data-testid="output-stdout"');
  });

  it('offers a hint when there is nothing to show', () => {
    expect(render(ScriptOutputPanel).body).toContain('Run a Python script to see its output here.');
  });
});

describe('ScriptStatus', () => {
  it('is empty while nothing runs and names the script while one does', () => {
    expect(render(ScriptStatus).body).toContain('data-item="script"');
    scriptRunning.set(true);
    lastScript.set('a_echo.py');
    expect(render(ScriptStatus).body).toContain('Script: a_echo.py');
  });
});
