# Code assistant

Help for reading and writing NC code: explanations of the codes on the current line, a code inspector with editable values, parametric templates, and better completion.

Tag format: `Priority · Size · Delivery`.

> **Status.** Design note from 2026-09-19. What shipped is described in the user guide ([Code help](../user/README.md#code-help), [Understanding a block](../user/inspector.md), [Writing with templates](../user/templates.md)); where this note and the guide differ, the guide is right. Status per section: the code dictionary, hover (with cycle parameters and modal context), completion and the inspector with value editing shipped in Phase 1 and in P3a; templates, template files, formulas, cycle forms (as **Edit Cycle**) and the template manager shipped in P3b. The `P2` and `P3` tags below are the tags of the original plan; the *Status* lines say what happened. Not built: the assistant master switch, the inspector's Templates part (templates are in the Insert tab, in completion and in the manager instead), template illustrations (backlog).

## Design

Two layers, both data-driven and per dialect:

1. **Code dictionary.** It describes address letters, G/M codes, keywords and the parameters of standard cycles. It drives hover help, the code inspector, completion and cycle forms. Because it works on parsed words, it explains any block, whether it came from a post-processor, a template or was typed by hand.
2. **Templates.** Reusable code snippets with parameters, inserted through a form or as a snippet with tab stops. They replaced the static code blocks of Phase 0, which are deleted.

We do not match templates back against existing code to edit it. That breaks as soon as the code deviates slightly from the template. Editing existing code works on parsed words and the dictionary instead.

Both live in one **code database** file per dialect ([format below](#code-database-format)). The user's own templates live in code files of the user's, next to their own G and M codes ([Where your templates are kept](../user/templates.md#where-your-templates-are-kept)).

## Hover help

### Hover explanations for codes
`P1 · M · Core` (codes and addresses) · `P2 · S · Core` (cycle parameters, modal context)

**Status:** shipped: codes and addresses in Phase 1; cycle parameters and modal context in P3a (P3.3). Hover can be switched off in `Settings ▸ Assistance`; a delay or a modifier key was not built.

Hovering over a word shows a short explanation from the dictionary. It uses a Monaco `HoverProvider` per dialect.

- **P1:** G/M codes, address letters and Klartext keywords, for example `G83`: "Peck drilling cycle, modal until G80" or `M8`: "Coolant on".
- **P2:** on a cycle word, a table of the cycle's parameters with the values found in the block. For Klartext, a Q parameter line in a cycle definition shows the meaning of that parameter.
- **P2:** modal context from the interpreter, for example `X10.` → "X target, absolute (G90), work offset G54".
- Variables (`#101`, `R5`, `Q12`) show their kind only. Values are unknown without simulation.
- A setting turns hover off, and it can be delayed or shown only while a modifier key is held.

## Code inspector

### Code inspector panel
`P2 · M · Core`

**Status:** shipped in P3a (P3.2b).

A panel that follows the cursor. It sits on the left beside the Program Map and is closed until it is opened (`Cmd/Ctrl+Alt+A`); see [Understanding a block](../user/inspector.md). It has two parts (the third part of the original design, templates, went elsewhere):

- **Current block:** each word of the block (or of a multi-line Klartext cycle definition) as a row with address, value and meaning. Unknown words are shown as unknown, not hidden.
- **Modal state at cursor:** motion mode, plane, absolute/incremental, units, work offset, active tool, spindle direction and speed, feed and feed mode, coolant, cutter compensation, active canned cycle. It comes from the modal interpreter ([nc-transformations.md](nc-transformations.md#nc-tokenizer-and-modal-interpreter)). This is useful for CAM output, where most state is set far above the current line.
- **Templates:** planned as a third part of the panel (filtered by group and a search box). Not built: the templates are on the Insert tab, in completion on an empty line and in the template manager ([Templates in completion](#templates-in-completion), [Template files and management](#template-files-and-management)).

A shortcut shows or hides the panel. There is no single switch for the whole assistant: hover, completion and the motion colors have their own switches in `Settings ▸ Assistance`.

### Edit values in the inspector
`P2 · M · Core`

**Status:** shipped in P3a (P3.2a): a value is written the way the machine reads it, or refused; it is never rounded.

Values in the current-block table can be edited in place. Changing a value rewrites only that word, as one undo step. It keeps the word order, the spacing, the number style (decimal point, decimals, sign) and any trailing comment. Values are checked against the dictionary (a negative feed or a non-integer tool number is flagged). This avoids typos in address letters when correcting feeds, speeds, depths or retract planes.

### Cycle forms
`P3 · M · Core`

**Status:** shipped in P3b (P3.8) as **Edit Cycle…** on the Insert tab ([Edit Cycle](../user/templates.md#edit-cycle)). A cycle written in two blocks (the lathe `G71` to `G76`) is refused, because a form could put a word in the wrong block.

For cycles described in the dictionary (G73, G81–G89 and the lathe equivalents; Klartext 200-series drilling cycles), "Edit cycle" opens a form with one field per parameter, pre-filled from the block. On confirm, the block is rewritten. Present words keep their order, new optional words are appended in the dictionary order, and words the dictionary does not know are kept. The same form inserts a new cycle when the cursor is not on one.

## Completion

### Dictionary-driven completion
`P1 · S · Core`

**Status:** shipped in Phase 1. An entry not yet checked against a manual is offered with a "Not verified yet" note.

Replaced the hardcoded cycle lists of the Phase 0 grammars:

- Suggestions come from the dictionary (`src/lib/core/codes/completionItems.ts`), with English labels and descriptions.
- Filtered by what is typed: `G8` offers G80–G89 with labels, and `M` offers M codes. Klartext offers keywords at the start of a block (`L`, `CC`, `C`, `TOOL CALL`, `CYCL DEF`).
- No suggestions inside comments.
- Cycles insert as snippets with tab stops for their required parameters.
- Settings: automatic suggestions on or off (Ctrl+Space always works), per profile.

### Templates in completion
`P2 · S · Core`

**Status:** shipped in P3b (P3.5): templates are offered on a line with nothing before the word; `Tab` accepts.

Templates appear in the completion list with their label. Picking one inserts it inline (snippet templates) or opens its parameter form.

## Templates

### Parametric templates
`P2 · M · Core`

**Status:** shipped in P3b (P3.4, P3.6).

A template is a named piece of code with parameters, scoped to a dialect and a group (for example "Program frame", "Tool change", "Drilling", "Moves"). Inserting one opens a form with a field per parameter. On confirm, the generated code is inserted at the cursor as one undo step. The project ships a default set per control: 49 templates in all (program start and end, tool start or change, drilling, tapping, turning and threading cycles, a few moves), listed in [What ships](../user/templates.md#what-ships). Safe retract, work offset and rapid/linear/arc templates were not built (Klartext has *Straight move* and *Circle around a centre*). Every shipped template is marked "review pending" until the owner has checked it.

Parameter options:

- Type: number, integer, text, choice, formula (read-only, computed).
- Output formatting: prefix and suffix (usually the address letter), decimals (as entered / at least one / fixed), digit count with zero padding (`42` → `0042`), explicit plus sign.
- Validation: required or optional, minimum and maximum, negatives allowed, forced uppercase for text. Invalid input shows an error in the form. Values are never corrected silently.
- Text parameters are wrapped in the dialect's comment delimiters when the template marks them as comments.
- Default value, or a choice list with display labels and inserted values (coolant mode, spindle direction, plane).
- Remember the last value (stored in the state file).
- Optional parameters left empty drop their whole word (prefix included). A line that ends up with nothing but a block number is dropped.
- Field order in the form can differ from the order in the code.

### Placeholders
`P2 · S · Core`

**Status:** shipped in P3b as described.

Template bodies are plain NC text with placeholders:

| Placeholder | Meaning |
|---|---|
| `{{id}}` | Value of parameter `id`, formatted by its options. Can repeat. |
| `{{N}}` at line start | Block number derived from the surrounding numbering (previous number + increment). Empty if the document is not numbered. For Klartext the following blocks are renumbered after insertion. |
| `{{sys.date}}`, `{{sys.time}}`, `{{sys.file}}`, `{{sys.stem}}` | Date, time, file name, file name without extension |
| `\{{` | Literal `{{` |

A template without parameters can set `"snippet": true` and use Monaco snippet syntax (`${1:Z-5.}`, `${2|M8,M7|}`) for inline tab stops without a form. This keeps simple templates simple.

### Formula parameters
`P3 · M · Core`

**Status:** shipped in P3b (P3.8). The calculation is exact on decimal text, and there are no units.

A formula parameter computes its value from other parameters, for example feed from speed, teeth and chip load: `s * z * fz`. It supports `+ - * / %`, parentheses, `abs floor ceil round sign sqrt ln log sin cos tan asin acos atan`, and `pi`, with angles in degrees. It uses a small safe expression parser, never `eval`. Results use the same formatting options and appear in the form as read-only fields (can be hidden per template). A template with only a formula works as a small calculator that inserts its result.

### Template files and management
`P2 · S · Core` (file-based) · `P3 · M · Core` (manager UI)

**Status:** shipped in P3b (P3.8, P3.9); see [The template manager](../user/templates.md#the-template-manager).

- Built-in templates ship read-only inside the app, in the code database files (`src/lib/data/codes/*.json`). User templates live in the `templates` list of `<config>/codes/<id>.json`, where `<id>` is the code database id, and are merged on top (same template `id` replaces the built-in one whole).
- Editing the JSON file by hand works, and the file reloads when it is saved (*Reload Profiles* on the Tools tab reads the folder again). Sharing means copying the file.
- The manager dialog (shipped, P3.9) lists, groups, adds, duplicates, deletes and reorders the user's templates. It has a body editor with buttons that insert placeholders, a property form for the selected parameter, and a live preview of the generated code. It saves through the file's own document, with the backup and the reload.
- *New Template from Selection* (shipped, P3.8 and P3.9): the selection becomes the body, and the numeric values can become parameters (`Z-5.` → parameter `z` with prefix `Z`).
- Favorites (shipped): a star per template; the starred ones form a "Favorites" group. The stars are a preference kept in the state file, not a member of the template.

Template illustrations (an image per template or parameter) are in the backlog.

## Code database format

One JSON file per dialect. Built-ins are in `src/lib/data/codes/`, and user additions are in `<config>/codes/`. It replaced the Phase 0 `src/lib/data/blocks/*.json`, which are deleted. The examples below show the shape; the shipped files also use `extends` (a file builds on another, for example `fanuc-lathe` on `fanuc`) and `remove`, and have members this note does not list (see [Your own profiles and code files](../user/profiles.md#code-files-your-own-g-and-m-codes) for the ones a user may write). No JSON Schema file ships yet (the `$schema` line is a plan; JSON Schemas for profiles and machines are in the Phase 4 table of the roadmap).

```json
{
  "$schema": "../schema/codes.schema.json",
  "dialect": "fanuc",
  "version": 1,
  "addresses": {
    "X": { "label": "X axis", "description": "Target position on the X axis." },
    "F": { "label": "Feed", "description": "Feed rate, unit depends on the feed mode (G94/G95)." },
    "S": { "label": "Spindle speed", "description": "Spindle speed, or surface speed under G96." }
  },
  "codes": [
    { "code": "G0", "aliases": ["G00"], "group": "motion", "modal": true,
      "label": "Rapid move", "description": "Moves at rapid rate to the target position." },
    { "code": "G81", "group": "cycle", "modal": true,
      "label": "Drilling cycle", "description": "Feed to depth, rapid out. Active until G80.",
      "params": [
        { "address": "X", "label": "Hole position X" },
        { "address": "Y", "label": "Hole position Y" },
        { "address": "Z", "label": "Hole bottom", "required": true },
        { "address": "R", "label": "Approach plane", "required": true },
        { "address": "F", "label": "Drilling feed", "required": true, "min": 0 }
      ] },
    { "code": "M8", "aliases": ["M08"], "group": "coolant", "label": "Coolant on" }
  ],
  "templates": [
    {
      "id": "drill-g81",
      "label": "Drilling (G81)",
      "group": "Drilling",
      "description": "One hole with a simple drilling cycle, then cancel.",
      "toolbar": true,
      "body": "{{N}}G81 {{x}} {{y}} {{z}} {{r}} {{f}}\n{{N}}G80",
      "params": [
        { "id": "x", "label": "X", "type": "number", "prefix": "X", "decimals": "min1" },
        { "id": "y", "label": "Y", "type": "number", "prefix": "Y", "decimals": "min1" },
        { "id": "z", "label": "Depth", "type": "number", "prefix": "Z", "decimals": "min1", "required": true, "max": 0 },
        { "id": "r", "label": "Approach plane", "type": "number", "prefix": "R", "decimals": "min1", "default": 2 },
        { "id": "f", "label": "Feed", "type": "number", "prefix": "F", "decimals": 0, "min": 1, "remember": true }
      ]
    }
  ]
}
```

Klartext uses the same structure. `code` holds keywords and cycle identifiers, and cycle parameters are Q addresses:

```json
{
  "dialect": "heidenhain",
  "version": 1,
  "codes": [
    { "code": "L", "group": "motion", "label": "Straight line", "description": "Linear move to the target point." },
    { "code": "CYCL DEF 200", "group": "cycle", "label": "Drilling",
      "params": [
        { "address": "Q200", "label": "Safety distance above surface" },
        { "address": "Q201", "label": "Depth (negative = into material)" },
        { "address": "Q206", "label": "Plunge feed" },
        { "address": "Q202", "label": "Depth per infeed" }
      ] }
  ],
  "templates": [
    { "id": "tool-call", "label": "Tool call", "group": "Tool change",
      "body": "{{N}}TOOL CALL {{t}} Z {{s}}",
      "params": [
        { "id": "t", "label": "Tool", "type": "integer", "min": 0, "required": true },
        { "id": "s", "label": "Speed", "type": "integer", "prefix": "S", "min": 0 }
      ] }
  ]
}
```

Schema notes:

- `dialect` is the code database id (`fanuc`, `heidenhain`). Profiles point to it with their `codes` field ([dialect-profiles.md](dialect-profiles.md#schema-overview)), so several profiles can share one database.
- `codes[].code` is matched case-insensitively against the tokenizer's words, and `aliases` covers zero-padded forms. Codes with a decimal part (`G54.1`) are listed explicitly.
- `group` is free text but drives completion sorting and the inspector's modal-state grouping (`motion`, `plane`, `distance`, `feedmode`, `offset`, `compensation`, `cycle`, `spindle`, `coolant`, `program`).
- `pitchFeed: true` marks tapping and threading codes, whose feed is tied to the pitch. Feed and speed scaling use it to skip those blocks.
- `params` on a code describes the words that belong to it. The same parameter schema (`label`, `required`, `min`, `max`, `type`, `choices`) is used by template params and by script params ([scripting.md](scripting.md#parameters)), so one form engine serves all three.
- Migration from `blocks/*.json` (done in P3b, the old files are deleted): object key → `id`, `Text` → `label`, `Description` → `description`, `Button` → `toolbar`, `TextBlock` → `body`. The loader no longer reads the old format.

## Authoring rules for content

- Every label and description is written by contributors in their own words, short and factual. Do not copy text from control manuals or commercial software. Parameter names and code numbers are facts and are fine.
- The first release covers only the CAM-output subset per dialect ([syntax/](syntax/)). A missing entry is shown as unknown, never guessed.
- Machine-builder-specific cycles and conversational functions are not added to the built-in dictionaries.
