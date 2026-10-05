# Compare fixtures (WP11.2)

Read by `src/lib/core/compare/compare.test.ts`. Every file here is synthetic, written for
gEdit from `docs/planning/syntax/`, and was not copied from a machine, a CAM system, a
control manual or a customer program. None of these programs is meant to run on a machine.
Each NC file says so in its second line. `.gitattributes` keeps `tests/fixtures/**`
byte-exact (`-text`); the files use LF.

| File | Contents |
|---|---|
| `x5-repost/original.nc` | A two-tool Fanuc mill program (`%`, `O1001 (BRACKET OP1)`, tool comments, block numbers `N10`…`N190`, a face pass and a `G81` drilling cycle). |
| `x5-repost/reposted.nc` | The same program as another post would write it (X5): no block numbers, numbers reformatted **within the same pointedness** (`X-30.` → `X-30.000`, `F300.` → `F300.0`), `G00`/`M06` without their leading zeros, two new header comments on lines of their own (not in the `O` block), a blank line — and exactly two real changes: the feed of the `X130.` pass (`F600.` → `F650.0`) and the drilling depth (`Z-15.25` → `Z-15.000`). |
| `x5-repost/expected.diff` | The unified diff of the two sides normalized with the `fanuc-gcode` review-mode defaults and no machine: two one-line hunks, merged into one because their context touches. No newline after the last line. |
