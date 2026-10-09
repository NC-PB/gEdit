# Motion goldens

Which mark each line of a program gets from the motion colours (`core/nc/motion.ts`, Phase 3
plan §6.6): rapid, linear, arc, thread, cycle, or none.

```
tests/fixtures/motion/<profileId>/<case>.json
```

```json
{
  "about": "what the case shows",
  "machine": { "variants": { "gcodeSystem": "B" } },
  "input": ["G0 X0 Y0", "G1 X10. F100."],
  "lines": { "1": "rapid", "2": "linear" }
}
```

| Member | What it means |
|---|---|
| `about` | what the program is about, in a sentence or two |
| `machine` | optional, a partial `MachineParams` applied as the document's machine |
| `input` | the program, one string per line; synthetic, written for gEdit |
| `lines` | the kind of **every** line, 1-based: `"rapid"`, `"linear"`, `"arc"`, `"thread"`, `"cycle"`, or `null` for no mark |

A line gets `null` when it does not move (a comment, `M8`, `T0101`, a `G0` alone, a data
block such as `G10`), and also when it moves but the motion mode in force is not known: no
motion code yet, or one that only the profile or the machine assumed. A guess is never painted.

`src/lib/core/nc/motion.test.ts` runs every file with the tokenizer and the modal interpreter,
the way the app does, and compares each line. Every built-in profile has a case, and the
lathe has one for each G-code system.
