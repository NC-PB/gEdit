# File compare

Compare two NC programs side by side, for example a re-posted program against the previous version, or the post output against the copy edited at the machine. The goal is to see real changes (motion, feeds, tools) without noise from renumbering, reformatted numbers or new header comments.

Tag format: `Priority · Size · Delivery`.

## Starting a comparison

### Compare with an open document, a file, or the saved version
`P1 · S · Monaco + Core`

- Active document vs. another open document (chosen from a list if more than two are open).
- Active document vs. a file on disk (file dialog).
- Active document vs. its saved version on disk, to show unsaved changes. The [external change prompt](editor-core.md#external-change-detection) uses this too.
- Two files on disk, neither open yet (P2).

The comparison opens in the editor area in place of the single editor and uses Monaco's diff editor. Closing the comparison returns to normal tabs. Both documents stay open, and neither is modified by closing.

### What Monaco's diff editor provides
`P1 · S · Monaco`

- Side-by-side and inline views, with changed lines and changed characters highlighted.
- Next/previous difference navigation (shortcuts).
- Ignore leading/trailing whitespace.
- Editable right side, and reverting a change block from left to right.
- Synced scrolling, overview ruler.

That covers a useful first version with no custom diff code.

## NC-aware comparison

### Ignore options
`P2 · M · Core`

Options per profile, adjustable in the compare toolbar:

| Option | Effect |
|---|---|
| Ignore block numbers | Values and presence (`N10 G0 X0` equals `G0 X0`) |
| Ignore whitespace | Spaces and tabs anywhere in the line (`G1X10` equals `G1 X10`) |
| Ignore comments | Uses the profile's comment syntax. A line that is only a comment disappears from the comparison. |
| Ignore case | `g1 x10` equals `G1 X10` |
| Ignore number format | Leading zeros, trailing zeros and an explicit plus sign: `X+05.500` equals `X5.5`, `G01` equals `G1` |
| Numeric tolerance | Values within ± tolerance count as equal, for example 0.001 for rounding differences between post versions |

The decimal point needs care. On Fanuc-style controls, `X10` and `X10.` can mean different values ([syntax-fanuc.md](syntax/syntax-fanuc.md)). When the profile marks the decimal point as significant, number normalization keeps the presence of the point.

### NC-aware review mode
`P2 · S · Core`

First implementation of the ignore options, at low cost. Both texts are normalized line by line (normalizing each word through the tokenizer) and the normalized texts are shown in a read-only Monaco diff editor. A toggle switches back to the raw view. Line numbers in the normalized view map to the original lines, so "go to this line in the document" still works. Normalization code is shared with scripts through the [tokenizer](nc-transformations.md#nc-tokenizer-and-modal-interpreter).

Limitation: merging is only available in the raw view.

### Aligned NC-aware diff with merge
`P3 · L · Core`

The full version: compute the line diff on the normalized lines (a Myers or patience diff in TypeScript), then show the **original** text in two synced editors. Differences are decorations, and view zones fill gaps so matching lines stay level. Merging copies original lines. Needed only if review mode plus raw merge turns out to be too limiting.

### Word-level marking
`P2 · S · Core`

Inside a changed line, mark the whole NC word that differs (`F1200` → `F1000` highlights both words completely), not single digits. Uses the tokenizer on both lines. It applies to review mode and later to the aligned diff.

## Merging

### Copy differences in both directions
`P2 · M · Core`

Copy the current difference block from left to right or right to left (shortcuts and gutter buttons). Monaco only reverts from original to modified. The other direction is added with edits on the left model. Each merge is one undo step in the target document. An option jumps to the next difference after a merge. A single-line mode copies only the line at the cursor instead of the whole block.

## Output

### Export differences
`P2 · S · Core`

Save a unified diff (raw or normalized) or a simple two-column listing as a text file, or open it in a new tab. Use: change record for program revisions and approvals.

### Compare colors
`P2 · S · Core`

Colors for inserted, removed and changed lines and changed words come from the theme and have light and dark variants ([settings-ui.md](settings-ui.md#themes-and-colors)).

## Not planned

- Printing only the differences (use the export plus the normal print function).
- Tab key switching between compare panes.
- Three-way merge.
