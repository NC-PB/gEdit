# Cycle-form goldens (P3.8)

One file per case, `<profileId>/<case>.json`, read by `src/lib/core/templates/cycleForm.test.ts`
(Phase 3 plan §5 P3.8, §6.11, AD-39). Every case runs the real modal index over its input, takes
the state after the cursor's block, and calls `cycleFormAt` (or `cycleFormFor` for an insert) and
`applyCycleForm`. All inputs are synthetic: a program under `nc/` or lines written here.

| Member | Meaning |
|---|---|
| `$format` | `1` |
| `about` | what the case shows, in plain words |
| `input` | a program under `nc/`, relative to the golden (`"../../nc/fanuc/f01-mill-3tools.nc"`), or the lines themselves |
| `line` | the cursor's line (1-based) |
| `machine` | optional: a partial `MachineParams` applied as the document's machine; `numberInput` may name one of the profile's presets (`"is-b"`, `"okuma-1mm"`) |
| `insert` | optional: `{ "code", "env": { "prevBlockNumber", "numbered" } }`, the insert mode (`cycleFormFor` of that entry, a new block after the cursor's block) |
| `form` | optional: the `values` and `kept` the form reads from the block |
| `values` | what the user confirms, by address (`""` clears a word; an address left out is unchanged) |
| `expected` | `{ "first", "last", "lines" }` (the edit: lines `first`…`last` replaced; `last` is `first - 1` for an insert), or `{ "refused": "<key>", "params"? }` (`cycleFormAt` refuses), or `{ "errors": { "<address>": "<key>" } }` (`applyCycleForm` refuses) |
