# Modal goldens

What is in force after a block, as both languages have to read it: Python from M6
(`_nc_modal.py`, WP6.4) and TypeScript from M11 (`core/nc/modal.ts`, WP11.1), against the
same files. Plan §7.4 and AD-19.

```
tests/fixtures/modal/<profileId>/<case>.json
```

## The format

```json
{
  "input": "../../nc/fanuc-lathe/l05-system-b.nc",
  "machine": { "variants": { "gcodeSystem": "B" }, "modalInitial": { "feedmode": "G95" } },
  "states": [
    { "line": 12, "after": { "groups": { "feedmode": "G95", "spindlemode": "G96" },
                             "feedUnit": "per-rev", "tool": "01", "speed": "220",
                             "speedLimit": "2500" } },
    { "line": 3,  "after": { "groups": { "plane": "=G18", "feedmode": "=G95@machine" },
                             "diameter": "=on" } },
    { "line": 20, "after": { "activeCycle": null, "block": { "cycle": "G71" } } }
  ]
}
```

| Member | What it means |
|---|---|
| `input` | the program, relative to this file |
| `machine` | optional, a partial `MachineParams` (§7.15) applied as the document's machine |
| `states[].line` | 1-based line of the program; the state is the one **after** that line |
| `states[].after` | **only the listed keys are compared** — a golden says what it is about |

`states` need not be in order and need not cover every line: a golden is a claim about the
lines that matter, not a dump.

## Reading a value

A group value is the code (`"G95"`), or `=<code>` when the value is **assumed** — nothing
in the program set it, so it comes from the power-on state. Where an assumed value does
not come from the profile, the source is appended:

| Written | Means |
|---|---|
| `"G95"` | the program set it, on some line at or before this one |
| `"=G95"` | assumed, from the profile's documented default (§8.8) |
| `"=G95@machine"` | assumed, because the document's machine says the control powers on like that |
| `"=G95@detected"` | assumed, because a detected variant's overlay says so |

`units` and `diameter` use the same prefixes (`"=on"`, `"=inch@machine"`), `tool` is the
station, and `feed`, `speed` and `speedLimit` are the value **as written** (`"220"`,
`".15"`), never a converted number — what a number means on a machine is
`_nc_machine.py` / `core/machines/numbers.ts`, not the modal state.

Python exposes the same camelCase keys, so one golden reads the same in both languages.

## The machine, and why a golden names it

The interpreter never reads a machine configuration. Everything machine-specific reaches
it through the **effective profile** it is given (AD-19), which is why a golden pins its
behaviour by naming the machine parameters it runs with rather than by describing them in
prose.

Both languages read that golden's effective profile from the generated
`tests/fixtures/resolved/effective/**` (`effective_context(golden=…)` in
`tests/python/helpers.py`), so a golden that names a machine or relies on variant
detection runs against exactly **one** merge result. TypeScript may also apply
`applyMachine` itself; **Python never merges a machine into a profile**, because two
implementations of one merge is how the two sides start disagreeing quietly.

A golden whose effective profile has not been generated yet is a *spec golden* (plan §5.2
rule 3): it fails with

> run `UPDATE_RESOLVED=1 npm test -- resolved`

and integration regenerates the resolved fixtures after Wave A.

## Writing one

- Every program under `tests/fixtures/nc/**` is synthetic and carries the
  `WRITTEN FOR GEDIT` marker. A modal golden points at one of those, never at a real
  program (§9.2, D45).
- Say what the case is **about** in the keys you list. A golden that lists everything
  fails for reasons that have nothing to do with it.
- A rule that has no program behind it belongs in a unit test over an inline code list,
  not here.
