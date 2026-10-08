// M12.5 WP-RP3: the program-map rules of Klartext (`TOOL CALL` by name) and Sinumerik turning
// (the header written as a comment; plan §6 M12.5). The lathe's tool word (decision 1) is pinned in
// `fanucLathe.test.ts` and `r6Variants.test.ts`, the Siemens mill's tool change (decision 5)
// in `sinumerikMill.test.ts`; `tool_list.py` reads the same patterns
// (`tests/python/test_tool_list.py`, `test_r6_variants.py`). Every line here is synthetic.

import { describe, expect, it } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { OutlineIndex } from '$lib/core/profiles/outline';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import type { CompiledProfile } from '$lib/core/profiles/types';

const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

function compiled(id: string): CompiledProfile {
  const found = BUILTINS.find((cp) => cp.profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

function items(cp: CompiledProfile, lines: string[]) {
  const index = new OutlineIndex(cp);
  index.reset(lines);
  return index
    .items()
    .flatMap((item) => [item, ...(item.children ?? [])])
    .map(({ children: _children, ...own }) => own);
}

describe('Klartext: TOOL CALL "name" at the end of the line', () => {
  const klartext = compiled('heidenhain-klartext');

  it('is a tool change, as it is with an axis behind it', () => {
    const program = ['0 BEGIN PGM DEMO MM', '1 TOOL CALL "END MILL 10"', '2 TOOL CALL "END MILL 10" Z S3000', '3 END PGM DEMO MM'];
    const tools = items(klartext, program).filter((item) => item.kind === 'tool');
    // Before M12.5 only line 3 was one: `\b` after a closing quote at the line end fails.
    expect(tools.map((item) => [item.line, item.tool])).toEqual([
      [2, '"END MILL 10"'],
      [3, '"END MILL 10"'],
    ]);
  });

  it('still reads the number forms and a name before a comment, and leaves a speed change alone', () => {
    const program = [
      '0 BEGIN PGM DEMO MM',
      '1 TOOL CALL 5',
      '2 TOOL CALL "DRILL 8" ; CENTRE FIRST',
      '3 TOOL CALL Z S4000',
      '4 TOOL CALL 12.1 Z S2000',
      '5 END PGM DEMO MM',
    ];
    const tools = items(klartext, program).filter((item) => item.kind === 'tool');
    expect(tools.map((item) => [item.line, item.tool])).toEqual([
      [2, '5'],
      [3, '"DRILL 8"'],
      [5, '12.1'],
    ]);
  });

  it('reads a name with a digit straight behind it, and a number with more decimals as its whole part', () => {
    // M12.5 review: the guard belongs on the axis letter, not on the name. A tool index is
    // one digit (`12.1`); behind more decimals the tool is the whole number, as before.
    const program = [
      '0 BEGIN PGM DEMO MM',
      '1 TOOL CALL "END MILL 10"',
      '2 TOOL CALL "D10"5 Z S3000',
      '3 TOOL CALL 5 ZS3000',
      '4 TOOL CALL 7.12 Z',
      '5 END PGM DEMO MM',
    ];
    const tools = items(klartext, program).filter((item) => item.kind === 'tool');
    expect(tools.map((item) => [item.line, item.tool])).toEqual([
      [2, '"END MILL 10"'],
      [3, '"D10"'],
      [4, '5'],
      [5, '7'],
    ]);
  });
});

describe('Sinumerik: the header written as a comment', () => {
  const turning = compiled('sinumerik');
  const programRule = () => turning.re.outline.find((rule) => rule.kind === 'program');

  it('is accepted by the program rule, with or without the leading semicolon', () => {
    // Turning programs may write `;%_N_<name>_MPF` as their first line.
    const rule = programRule();
    expect(rule?.re.exec(';%_N_SHAFT_12_MPF')?.groups?.name).toBe('SHAFT_12');
    expect(rule?.re.exec('%_N_SHAFT_12_MPF')?.groups?.name).toBe('SHAFT_12');
    expect(rule?.re.exec(';%_N_HOLDER_SPF')?.groups?.name).toBe('HOLDER');
    // Any other comment stays a comment.
    expect(rule?.re.exec('; ROUGH TURNING')).toBeNull();
    expect(rule?.re.exec(';;%_N_SHAFT_12_MPF')).toBeNull();
  });

  it('gives the program its program item in the map (with syntax.header accepting the semicolon)', () => {
    const program = [';%_N_SHAFT_12_MPF', ';$PATH=/_N_WKS_DIR/_N_SHAFT_WPD', 'N10 G0 X100 Z5', 'N20 M30'];
    const found = items(turning, program);
    expect(found[0]).toMatchObject({ kind: 'program', line: 1 });
    expect(found.filter((item) => item.kind === 'program')).toHaveLength(1);
  });
});
