# NC transformations

Operations that rewrite NC code or report on it. For each one: what it does, its options, and the edge cases that matter for CAM output. Dialect details (comment syntax, block-number format, addresses) come from the profile ([dialect-profiles.md](dialect-profiles.md)). Syntax facts are in [syntax/](syntax/).

Tag format: `Priority · Size · Delivery`. **Core** = built into the app, works without Python. **Script** = bundled Python script ([scripting.md](scripting.md#bundled-script-library)).

## Shared foundations

### Transform framework
`P1 · M · Core`

All transforms (core and script) share the same behavior:

- **Scope:** the selection if there is one, otherwise the whole document. Partial lines in a selection are extended to whole lines.
- **Output target:** replace in place, or open the result in a new untitled tab with the same dialect. With a new tab and a selection, only the selected lines are copied.
- **One undo step:** the result is applied through Monaco edit operations. The app diffs old and new text and changes only the lines that differ, so bookmarks and folding outside the changed lines survive.
- **Summary:** each run reports what it did in the status bar, for example "Renumbered 1,284 blocks, skipped 12 lines" or "Scaled 310 feed words, 4 skipped (variables)". Skipped cases can be listed in the results panel.
- **Remember last parameters:** each transform form starts with the values used last time (stored in the state file).

### Number formatting
`P1 · S · Core`

All numeric transforms write numbers with the same rules, taken from the profile and adjustable per run:

- Decimals: fixed count, or keep each value's original number of decimals (default).
- Keep or drop trailing zeros (`10.500` → `10.5`), and keep a trailing decimal point (`10.`) when the original had one. On Fanuc-style controls a missing decimal point can change the meaning of a value ([syntax-fanuc.md](syntax/syntax-fanuc.md)), so never drop the point when the profile says it is significant.
- Leading zeros and explicit plus sign: kept as in the original (`X+10.5` stays signed, which Klartext requires).
- Decimal separator from the profile (point; comma only where the control accepts it).

### NC tokenizer and modal interpreter
`P1 · M · Core` (tokenizer) · `P2 · M · Core + Script` (modal interpreter)

Most functions need the same two building blocks. We build each once per language:

- **Tokenizer:** splits a line into block number, skip mark, address words, keywords, comments, strings and variable expressions, driven by the profile. It is used by the program map, navigation, hover, the code inspector, compare normalization and the core transforms.
- **Modal interpreter:** tracks absolute/incremental mode, plane, motion mode (G0–G3), active tool, feed, spindle state and speed, work offset, and canned-cycle state from the top of the file. It is used by NC-event navigation, the code inspector's "modal state at cursor", extents, checks and geometric transforms.

The core has a TypeScript version. Bundled scripts share a small standard-library-only Python module (`gedit_nc.py`) with the same concepts. Both are tested against the same fixture files (sample CAM programs with expected tokens and modal states as JSON), so they do not drift apart.

## Block numbers

### Renumber blocks
`P1 · M · Core` (basic) · `P2 · S · Core` (advanced options)

Adds block numbers where missing and makes existing ones consecutive. It uses the profile's numbering settings. A small form can open before the run to change start and increment for this run only (setting).

Options:

- Prefix (`N`) and alternative prefixes that also count as block numbers (`:` on some ISO controls)
- Start value, increment, fixed digit count with zero padding (`N0010`)
- Maximum value, and what happens beyond it: wrap to the start value, or stop with a warning. "Fit to maximum" picks the largest even increment so that the last block stays below the maximum.
- Spaces after the number, or pad to a fixed column so the code after the number lines up
- Number only lines that already have a number, or all eligible lines
- Lines to skip: lines starting with any listed prefix (`%`, `O`, `(`), lines containing any listed text, empty lines, and a number of leading or trailing lines (protects a header and the final `%`)
- Restart the sequence at lines matching the program-start pattern (several programs in one file)
- Start trigger: begin at the first line containing a given text, or at the line after it

Edge cases:

- Only the number at the start of a block is touched, after an optional skip mark (`/N100` or `N100 /` depending on the profile). Never touch an `N` inside a comment or a string.
- Alphanumeric sequence names (Okuma `NLAP1`) are jump targets, not numbers, and are left alone.
- Klartext: every logical block is numbered consecutively from `0` (`BEGIN PGM`) in steps of 1, with no options. Continuation lines of multi-line cycle definitions (ending in `~`) have no number and are skipped ([syntax-heidenhain.md](syntax/syntax-heidenhain.md)).
- If the program contains block-number references (jumps, return targets, turning-cycle ranges), a plain renumber silently breaks them. Detect the profile's reference patterns and warn, then offer [reference-aware renumbering](#reference-aware-renumbering).
- Large files stay undoable (see [framework](#transform-framework)).

### Remove block numbers
`P1 · S · Core`

Removes the block number and the space after it at the start of each block, in the selection or the whole file. Keeps skip marks (`/N100 G0` → `/G0`). The command is disabled for profiles where numbers are mandatory (Klartext).

### Reference-aware renumbering
`P3 · L · Core`

Renumbers and also rewrites references to block numbers, so jumps and cycle ranges still point to the right blocks. The profile lists reference rules: a trigger (for example a jump keyword, a subprogram return with a target, or a turning cycle with start/end blocks) and the addresses whose values are block numbers. It runs in two passes: build an old → new map, then rewrite the references. It warns about references to numbers that do not exist or that appear twice. Plain CAM milling output rarely needs it. Lathe cycles with start/end block ranges do.

## Cleanup

### Insert spaces between words
`P1 · M · Core`

`N10G1X10.Y-5.F500` → `N10 G1 X10. Y-5. F500`. Existing spaces are kept. Uses the tokenizer, so these stay intact: comments, strings, variable expressions (`#100=[#1+2]`, `R1=R2*2`), multi-letter keywords (`GOTO`, `IF`, `TOOL CALL`, `CYCLE81(...)`), comma-prefixed words (`,R1.`, `,C0.5`), and signs of numbers. Optionally apply this on open, as a display-independent command that marks the document modified.

### Remove spaces
`P1 · S · Core`

Removes spaces and tabs between words to make the code compact. It never changes comments or strings. It is disabled for profiles where spaces separate words (Klartext) and never removes the space that keywords need (`GOTOF LABEL`).

### Remove empty lines
`P1 · S · Core`

Removes empty and whitespace-only lines. For Klartext, offer to renumber afterwards.

### Remove comments
`P1 · S · Core`

Removes comments according to the profile's comment syntax (`( )` for Fanuc, `;` to end of line for Klartext and Sinumerik). Options:

- Drop lines that become empty (default on).
- Keep the program-name comment on the program-number line (`O1001 (BRACKET)`), which the control shows in its directory.
- Keep comments in the first N lines (header).
- Klartext: keep or remove section headings (`* - ...`). A comment before a trailing `~` must leave the `~` in place.

### Convert case
`P1 · S · Monaco + Core`

Uppercase or lowercase for the selection or the whole file. Monaco's actions cover the selection. The core version adds "exclude comments and strings", which is the default for uppercase.

### Insert and remove block skip
`P2 · S · Core`

Adds the skip mark (usually `/`) to the selected lines, or removes it. The position before or after the block number comes from the profile. A line that already has a skip mark is not marked twice. Removal only touches the mark at the start of the block, never a `/` used as division (`#1=#2/2`, `R1=R2/2`). Numbered skip levels (`/1` to `/9`) are kept when removing marks of another level.

### Character cleanup
`P2 · S · Script`

Makes the file safe for the control, with a report of each change:

- Remove NUL and other control characters.
- Convert tabs to spaces.
- Transliterate non-ASCII characters in comments (`ä` → `ae`, `ø` → `D`, `°` → `DEG`) using a replaceable mapping table, or report them only.
- Optional whitelist of allowed characters from the profile. Anything else is reported with its line.
- Optional maximum line length check (some controls limit the characters per block).

## Rule-based text edits

### Insert text by rule
`P2 · M · Script`

Inserts a given text into lines selected by a plain-text or regex match. Position: start of line, after the block number, end of line (before a trailing comment, as an option), before the match, after the match, replacing the match, or as a new line above or below the matching line. Typical uses: add `M8` after every tool call, add a safety line after each tool change, or put a marker comment before every `M1`. New lines get block numbers if the profile uses automatic numbering. For Klartext, the script renumbers afterwards.

### Remove text by rule
`P2 · S · Script`

Removes a plain or regex match, or the whole matching line, for example an M-code the machine does not support. It overlaps with regex replace but is a guided one-step action that reports its count.

### Batch replace from a mapping file
`P2 · S · Script`

Reads a text file with one `search<delimiter>replacement` pair per line. The delimiter can be tab, `;` or `,`. All pairs are applied **simultaneously** in a single pass, so `T1→T10` and `T10→T100` do not chain. Options: case-insensitive, whole-address matching (`T1` does not hit `T10`), regex pairs. It reports the count per pair. Typical use: remap tool numbers or work offsets for another machine.

## Value changes

### Scale feed rates
`P1 · M · Script`

Multiplies feed values by a percentage. Options: percentage, decimals (or keep original), minimum and maximum clamp, and "only change values above X" / "only below Y". Scope and output target come from the [framework](#transform-framework).

Edge cases:

- Leave rapid alone: Klartext `FMAX` and `FAUTO` are not numeric feeds.
- Feed modes: per-minute (G94) is scaled. Per-revolution (G95) and inverse-time (G93) are skipped by default and listed, with a separate option to scale them too. The modal interpreter tells which mode is active.
- Tapping and threading: in rigid tapping (G84/G74) and thread cutting (G32/G76/G33), the feed is tied to the pitch and spindle speed. Never scale it. Report these blocks. Which codes are tapping or threading comes from the code database (`pitchFeed` flag, [code-assistant.md](code-assistant.md#code-database-format)), not from fixed numbers: Okuma `G71` is a thread cycle, Fanuc lathe `G71` is roughing.
- Variables and expressions (`F#101`, `F=R5`, `FQ5`) are skipped and reported.
- Feeds inside cycle definitions (Klartext cycle Q parameters, Sinumerik cycle arguments) are listed and left unchanged in the first version.

### Scale spindle speeds
`P1 · S · Script`

Same options as feed scaling, with speeds written as integers by default.

Edge cases:

- Under constant surface speed (G96), `S` is a surface speed, and `G50 S`/`G92 S` is a speed limit. These are skipped by default, with separate options to scale them.
- Tapping blocks: warn, because scaling S without F breaks the pitch relation.
- Klartext: `S` is in the `TOOL CALL` line.
- Variables are skipped and reported.

### Arithmetic on address values
`P2 · M · Script`

Adds, subtracts, multiplies or divides the values of selected addresses (checkboxes for X Y Z I J K A B C R F S, plus free text for other names). Options: clamp to a minimum and maximum, number format, and case handling of addresses. Typical uses: shift Z after a stock change, flip a sign, or convert a value scale.

Edge cases:

- Only literal numbers change, never comments, variable numbers (`#101`) or expressions.
- `G`, `M`, `N`, `O` and `T` are excluded by default.
- Adding an offset only makes sense in absolute mode. Incremental blocks (G91, or the Klartext `I` prefix such as `IX+10`) are skipped and reported, because shifting them would add the offset twice.
- Arc-centre words are incremental on most ISO controls, so shifting them would be wrong. They are unchecked by default when adding, and included when multiplying.
- Canned cycles: when shifting Z, the R plane usually needs the same shift. The form hints at this.

## Geometry transforms

All three use the modal interpreter and share these options:

- Arc-centre convention: auto (from profile), relative to arc start (default for ISO), or absolute.
- Distance mode (absolute or incremental) to assume at the start, for files whose header does not set it.
- Write every axis on every motion block after the transform, because axes that were omitted as modal may now change.
- Number format and output target from the framework.

Common edge cases:

- Machine-coordinate moves (G53) and reference-point returns (G28/G30) are never transformed. They are reported.
- Radius-programmed arcs (`R`) keep their radius. Only the end points change.
- Only the XY plane (G17) is supported for rotate and mirror at first. Other planes are reported and left unchanged.
- Klartext: `CC` is an absolute pole and is transformed like a point. Polar moves (`LP`, `CP`) change their angle. Incremental words are kept.
- Canned cycle positions (the XY words after a cycle call) are transformed. The R plane and depth are left unchanged unless Z is shifted.

### Translate coordinates
`P3 · M · Script`

Shifts the path by dX, dY, dZ. Only absolute coordinates change. Incremental moves stay as they are. Absolute arc centres shift with the path.

### Rotate coordinates
`P3 · L · Script`

Rotates the path in the XY plane around a given point by an angle. Arc-centre vectors rotate with the path, and arc direction does not change. X and Y are written on every move after rotation.

### Mirror coordinates
`P3 · L · Script`

Mirrors the path about an axis through a point at an angle (X or Y axis as presets). Mirroring swaps `G2`↔`G3` and `G41`↔`G42` (Klartext: `DR+`↔`DR-`, `RL`↔`RR`). This turns climb milling into conventional milling. Reversing the path direction to restore it is hard and is only offered for simple contours (lines and arcs without cycles) in a later version.

### Expand drilling cycles
`P3 · M · Script`

Replaces standard canned drilling cycles (G73, G81–G89, cancelled by G80) with explicit rapid and feed moves. It respects the return plane (G98/G99), R plane, peck depth, dwell, modal repetition at the following XY positions, and absolute or incremental Z. Uses: controls without a certain cycle, checking what a cycle really does, and as input for the statistics. It only runs where the code database marks these codes as drilling cycles; on Okuma OSP, `G80`–`G88` are contour roughing calls. Machine-builder-specific and conversational cycles are out of scope.

## Program structure

### Split program by tool
`P2 · M · Script`

Writes one new document per tool segment, or extracts or deletes the segment at the cursor. Each output gets the program header (everything before the first tool call, with configurable detection) and a proper program end (`M30`, `%`, or `END PGM` with a matching name). It offers to renumber each output.

### Join programs
`P2 · S · Script`

Combines several open documents in the chosen order into one program. It removes the intermediate end markers and headers (keeping the first header and the last end) and then renumbers. This complements [append file](editor-core.md#insert-file-and-append-file) for the simple case.

## Reports and checks

Scripts that do not change the document. They return a table or a list of findings with line numbers, shown in the results panel. Click a row to jump.

### Tool list
`P1 · S · Script`

Lists the tools in order of first use: number, description, line of the first call, number of calls, and optionally the feed and speed range used. Rules come from the profile's tool section:

- Tool trigger from the profile's `toolCall` rule: `T` with `M6`, any `T` word on turret lathes, `TOOL CALL` with a number or name, or a custom regex.
- Description: the nearest comment above or below the call, or a trailing comment. A filter regex skips decorative banner lines.
- Up to two extra fields extracted by regex from the call line (for example a radius or length word).
- Normalization: collapse lathe offset digits (`T0101` → tool 1), drop leading zeros, list each tool once.

Output: a table in the panel, or text/CSV in a new document for setup sheets. Template-based HTML output is a backlog item.

### Combined tool list
`P2 · S · Script`

The same for several open documents: one list of all tools, with the programs that use each. Needs the multi-document script input ([scripting.md](scripting.md#script-context)).

### Extents
`P2 · M · Script`

Minimum and maximum X, Y, Z (and rotary axes if present), per tool and overall. Arc extremes are included, not only end points. Incremental moves and canned cycle depths are resolved. Work-offset changes start a new group, and G53 moves are listed separately. This is a quick check for wrong Z depths or stray coordinates without a backplot.

### Statistics and time estimate
`P3 · M · Script`

Feed path length, rapid path length and estimated time per tool and overall, using an assumed rapid rate and tool change time (script parameters, defaults from the profile). Per-revolution feeds use the active spindle speed. Canned cycles are expanded internally. Output as a table, or CSV in a new document.

### Program checks
`P2 · M · Script`

One script with selectable checks that returns findings with severity:

- Feed move (G1–G3 or a cycle) while the spindle is stopped: after `M5`, or after a tool change without `M3`/`M4`.
- Program stops and optional stops (`M0`, `M1`) listed, so their positions can be reviewed.
- Program frame: missing or duplicated start/end markers, code after the end marker.
- Tool call without a following spindle start, or without length compensation where the profile expects it.
- Coordinate words without a decimal point where the profile says the point is significant.
- Lowercase addresses outside comments. Unclosed comments.
- Optional: axis values outside given travel limits (script parameters). Only meaningful in machine coordinates, so it stays a simple optional check.

Later, the same findings can also be shown as editor markers (squiggles).

## Backlog

Unscheduled ideas. They are good first contributions as scripts:

- Split multi-channel lathe programs into one document per channel, and check that wait codes match across channels (generic, pattern-based).
- Chart of axis positions and feed over the program (needs UI, uses the modal interpreter).
- Apply a tool radius offset to the path (geometrically hard; CAM already does this).
- Convert Klartext ↔ ISO for simple motion code, and ISO ↔ ISO dialect conversion (re-posting from CAM is the proper way).
- Tool list output through a text/HTML template for printable setup sheets.
