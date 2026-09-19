# Dialect profiles

A **profile** is everything gEdit knows about one kind of NC file: extensions and detection, comment and block-number syntax, how tool calls look, how to number blocks, colors, editing behavior, formatting on load and save, compare defaults and tool-list rules. Nearly every NC-aware feature reads the profile of the active document, so it is the central configuration object.

Tag format: `Priority · Size · Delivery`.

## Today and target

Today the dialect knowledge is spread over hardcoded files:

| Current file | Holds | Moves to |
|---|---|---|
| `src/lib/utils/dialects.ts` | Label, save filter, extensions, default file name | `name`, `files` |
| `src/lib/utils/detectLanguage.ts` | Extension switch, weighted content regexes | `detect` |
| `src/lib/utils/gcodeParser.ts` | Per-dialect regexes for tool calls and comments | `toolCall`, `outline` |
| `src/lib/languages/fanuc.ts`, `heidenhain.ts` | Monarch grammar, completion list | `grammar` + `syntax` + `colors`; completions go to the [code database](code-assistant.md#code-database-format) |
| `src/lib/data/blocks/*.json` | Insertable snippets | Code database `templates` |

Target: built-in profiles are JSON files shipped with the app. The TypeScript code becomes generic: detection scoring, an outline rule runner, and a grammar generator that reads the profile. Adding a dialect then means adding a profile and a code database, plus a grammar only if the syntax family is new.

## Profile model

### Built-in and user profiles
`P1 · M · Core` (built-ins as JSON) · `P2 · M · Core` (user profiles with `extends`)

- Built-in profiles: `fanuc-gcode` (milling) and `heidenhain-klartext` (the existing ids stay, so current Monaco language ids keep working). Later: a Fanuc lathe child profile, `sinumerik-gcode` and `okuma-osp`. Built-ins are read-only in the app bundle.
- User profiles live in `<config>/profiles/*.json`. A user profile names a parent with `extends` and contains only the fields it changes. Objects merge deeply, and arrays and scalar values replace. A typical use is one profile per machine, sharing a base dialect but with a different extension, folder or numbering step.
- Each profile registers its own Monaco language id (its `id`), so profiles with different comment syntax or keywords can be highlighted differently.
- An open document can switch profiles manually (existing selector in the ribbon; later also in the status bar). The choice is remembered per file path (P2).

Example user profile:

```json
{
  "id": "mill3",
  "name": "Mill 3 (Fanuc)",
  "extends": "fanuc-gcode",
  "files": { "defaultExtension": "nc", "openFolder": "D:/CAM/mill3/out" },
  "detect": { "folders": ["D:/CAM/mill3"] },
  "numbering": { "step": 5, "digits": 4 }
}
```

### Format choice

JSON, validated by a JSON Schema (`schema/profile.schema.json`). Reasons: it matches the existing blocks JSON, needs no extra parser in TypeScript, and serde reads it in Rust. The schema gives field descriptions for the generated settings UI. The downside is escaped backslashes in regexes (`"\\d+"`). The [pattern tester](#profile-editor) in the settings UI reduces that pain.

## Schema overview

| Section | Fields | Used by |
|---|---|---|
| (top level) | `id`, `name`, `version`, `extends`, `grammar` (`iso` \| `klartext`, later `sinumerik` \| `okuma`), `codes` (code database id) | Everything |
| `files` | `extensions[]`, `defaultExtension`, `openFolder`, `saveFolder`, `encoding` (`keep` \| `ascii` \| `latin1` \| `utf8`), `lineEnding` (`keep` \| `crlf` \| `lf` \| `cr`), `newFileLineEnding` | Open/save dialogs, [encoding](editor-core.md#encoding-and-line-endings) |
| `detect` | `extensions{ext: weight}`, `content[{pattern, weight}]`, `folders[]`, `priority` | [Detection](#detection) |
| `syntax` | `caseSensitive`, `comments[{start, end}]`, `sectionHeading`, `continuation`, `blockSkip{chars, position, levels}`, `blockNumber{prefix, altPrefixes, mode, mandatory}`, `decimalSeparator`, `decimalPointSignificant`, `wordSeparatorRequired`, `incrementalPrefix`, `variables`, `keywords[]`, `maxLineLength` | Tokenizer, grammar, all transforms |
| `addresses` | `tool`, `feed`, `rapid`, `spindle`, `axes[]`, `arcCenter[]`, `arcCenterMode` (`incremental` \| `absolute`) | Scaling, arithmetic, geometry, checks |
| `toolCall` | `trigger`, `tool`, `toolFrom` (`same-line` \| `same-line-or-last`) | Program map, navigation, tool list |
| `program` | `start[]`, `end[]` | Numbering restart, split/join, checks |
| `outline` | `[{kind, pattern}]` | [Program map](#outline-program-map) |
| `numbering` | See [Numbering](#numbering) | Renumber, go to block, auto-number |
| `numberFormat` | `decimals` (`keep` \| n), `trailingZeros`, `keepPoint`, `plusSign` | [Number formatting](nc-transformations.md#number-formatting) |
| `editing` | `forceUppercase`, `preventLineJoin`, `autoSpace`, `autoIndent`, `tabWidth`, `rulers[]`, `completion` | [Typing behavior](editor-core.md#typing-behavior-for-nc-code) |
| `onLoad` / `onSave` | See [Load and save formatting](#load-and-save-formatting) | File handling |
| `compare` | `ignoreBlockNumbers`, `ignoreWhitespace`, `ignoreComments`, `ignoreCase`, `ignoreNumberFormat`, `tolerance` | [File compare](file-compare.md#ignore-options) |
| `toolList` | `description` (`above` \| `below` \| `trailing` \| `auto`), `commentFilter`, `extraFields[]`, `collapseOffsetDigits`, `dropLeadingZeros` | [Tool list](nc-transformations.md#tool-list) |
| `highlight` | `[{match, role \| color, extend}]` | [Colors](#tokenizer-and-colors) |
| `colors` | `{dark: {role: color}, light: {...}}` | [Colors](#tokenizer-and-colors) |

All patterns are ECMAScript regular expressions, matched per line and case-insensitively unless `syntax.caseSensitive` is set. Code patterns see the line with comments masked by the tokenizer (strings stay, because tool names can be strings), so `(T1 M6)` in a comment never counts as a tool change. Only `outline` rules of kind `comment` and `section` see the raw line. Named groups (`tool`, `name`, `text`) supply the values shown in the UI. Lists are JSON arrays, never delimiter-separated strings.

CAM output is often packed (`N10T1M6`), and `\b` finds no boundary between a digit and the next address letter. Code patterns therefore use `(?<![A-Z])` before the address and `(?!\d)` after the number instead of `\b`.

## Example: Fanuc

```json
{
  "$schema": "../schema/profile.schema.json",
  "id": "fanuc-gcode",
  "name": "Fanuc (ISO)",
  "version": 1,
  "grammar": "iso",
  "codes": "fanuc",
  "files": {
    "extensions": ["nc", "tap", "cnc", "eia", "iso", "txt"],
    "defaultExtension": "nc",
    "encoding": "keep",
    "lineEnding": "keep",
    "newFileLineEnding": "crlf"
  },
  "detect": {
    "extensions": { "nc": 3, "tap": 3, "cnc": 2, "eia": 2, "iso": 2 },
    "content": [
      { "pattern": "^\\s*%\\s*$", "weight": 5 },
      { "pattern": "^\\s*[O:]\\d{1,8}(?!\\d)", "weight": 5 },
      { "pattern": "^\\s*N\\d+", "weight": 1 },
      { "pattern": "^\\s*(N\\d+\\s*)?[GM]\\d{1,3}(\\.\\d)?(?![\\d.])", "weight": 1 }
    ]
  },
  "syntax": {
    "comments": [{ "start": "(", "end": ")" }],
    "blockSkip": { "chars": "/", "position": "either", "levels": true },
    "blockNumber": { "mode": "prefix", "prefix": "N", "altPrefixes": [], "mandatory": false },
    "decimalSeparator": ".",
    "decimalPointSignificant": true,
    "wordSeparatorRequired": false,
    "variables": "#\\d+",
    "keywords": ["GOTO", "IF", "THEN", "WHILE", "DO", "END"]
  },
  "addresses": {
    "tool": "T", "feed": "F", "spindle": "S",
    "axes": ["X", "Y", "Z", "A", "B", "C"],
    "arcCenter": ["I", "J", "K"], "arcCenterMode": "incremental"
  },
  "toolCall": { "trigger": "(?<![A-Z])M0*6(?!\\d)", "tool": "(?<![A-Z])T(?<tool>\\d+)", "toolFrom": "same-line-or-last" },
  "program": {
    "start": ["^\\s*O(?<name>\\d+)"],
    "end": ["(?<![A-Z])M0*(30|2)(?!\\d)"]
  },
  "outline": [
    { "kind": "program", "pattern": "^\\s*O(?<name>\\d+)" },
    { "kind": "comment", "pattern": "^\\s*\\((?<text>[^)]*)\\)\\s*$" },
    { "kind": "stop", "pattern": "(?<![A-Z])M0*[01](?!\\d)" }
  ],
  "numbering": {
    "start": 10, "step": 10, "digits": 0, "max": 99999, "onOverflow": "wrap",
    "spacesAfter": 1,
    "skipStartingWith": ["%", "O", "("],
    "skipEmpty": true,
    "restartAtProgramStart": true,
    "references": [
      { "trigger": "(?<![A-Z])M99(?!\\d)", "addresses": ["P"] },
      { "trigger": "(?<![A-Z])GOTO", "addresses": ["GOTO"] }
    ]
  },
  "editing": { "forceUppercase": true, "preventLineJoin": true, "tabWidth": 4 },
  "onLoad": { "stripNul": true },
  "compare": {
    "ignoreBlockNumbers": true, "ignoreWhitespace": true, "ignoreComments": false,
    "ignoreCase": true, "ignoreNumberFormat": true, "tolerance": 0
  },
  "toolList": { "description": "auto", "commentFilter": "^[-*=_\\s]*$", "dropLeadingZeros": true }
}
```

Notes on this example:

- `toolFrom: "same-line-or-last"`: many posts preselect the next tool with a bare `T` word right after a tool change, so a `T` word alone is not a tool change. The change is the `M6` line, and its tool is the `T` on the same line or the last `T` before it.
- `.min` is left out on purpose. Today it maps to Fanuc, but it is the Okuma OSP main-program extension ([syntax-okuma.md](syntax/syntax-okuma.md#111-extension-conflict-min)). It stays with Fanuc only until the Okuma profile exists.
- The Fanuc lathe child profile changes the rules that differ for turning ([syntax-fanuc.md](syntax/syntax-fanuc.md#41-profiles-the-same-code-means-different-things)): every `T` word is a tool change (with `collapseOffsetDigits` in the tool list), and `G70`–`G73` get a reference rule for their `P`/`Q` block numbers. The milling profile must not have that rule, because on mills `G73` is peck drilling and its `Q` is a peck depth.

## Example: Heidenhain Klartext

```json
{
  "$schema": "../schema/profile.schema.json",
  "id": "heidenhain-klartext",
  "name": "Heidenhain Klartext",
  "version": 1,
  "grammar": "klartext",
  "codes": "heidenhain",
  "files": { "extensions": ["h"], "defaultExtension": "h", "encoding": "keep", "lineEnding": "keep", "newFileLineEnding": "crlf" },
  "detect": {
    "extensions": { "h": 10 },
    "content": [
      { "pattern": "^\\s*(\\d+\\s+)?BEGIN\\s+PGM\\b", "weight": 5 },
      { "pattern": "^\\s*(\\d+\\s+)?TOOL\\s+CALL\\b", "weight": 5 },
      { "pattern": "^\\s*\\d+\\s+(L|CC|C|CR|LBL)\\b", "weight": 1 },
      { "pattern": "\\bFMAX\\b", "weight": 1 }
    ]
  },
  "syntax": {
    "comments": [{ "start": ";", "end": null }],
    "sectionHeading": "^\\s*\\d+\\s+\\*",
    "continuation": "~\\s*$",
    "blockSkip": { "chars": "/", "position": "after-number" },
    "blockNumber": { "mode": "leading-integer", "mandatory": true },
    "decimalSeparator": ".",
    "decimalPointSignificant": false,
    "wordSeparatorRequired": true,
    "incrementalPrefix": "I",
    "variables": "Q[LRS]?\\d+"
  },
  "addresses": { "feed": "F", "rapid": "FMAX", "spindle": "S", "axes": ["X", "Y", "Z", "A", "B", "C"] },
  "toolCall": { "trigger": "\\bTOOL\\s+CALL\\s+(\\d|\"|QS\\d)", "tool": "TOOL\\s+CALL\\s+(?<tool>\\d+(\\.\\d)?|\"[^\"]+\"|QS\\d+)", "toolFrom": "same-line" },
  "program": { "start": ["\\bBEGIN\\s+PGM\\s+(?<name>\\S+)"], "end": ["\\bEND\\s+PGM\\b"] },
  "outline": [
    { "kind": "section", "pattern": "^\\s*\\d+\\s+\\*\\s*-?\\s*(?<text>.*)$" },
    { "kind": "comment", "pattern": "^\\s*\\d+\\s*;\\s*(?<text>.*)$" },
    { "kind": "label", "pattern": "\\bLBL\\s+(?<name>\\S+)" },
    { "kind": "stop", "pattern": "\\b(STOP|M0?[01])\\b" }
  ],
  "numbering": { "mode": "consecutive", "start": 0, "step": 1 },
  "editing": { "forceUppercase": false, "preventLineJoin": true }
}
```

The tool-call trigger requires a tool number, name or `QS` parameter, because a `TOOL CALL` with only `S` or `F` changes the speed, not the tool. The block-skip position and the continuation rules are marked "verify" in [syntax-heidenhain.md](syntax/syntax-heidenhain.md). The profile makes them easy to correct without code changes.

## Sections in detail

### Detection
`P1 · S · Core`

Replaces the `switch` in `detectLanguage.ts`:

1. If a profile lists a folder that contains the file, that profile wins.
2. Otherwise, each profile gets a score: its extension weight plus the weights of content patterns that match within the first 400 non-empty lines (the same limit as today). A line counts only for its strongest matching pattern.
3. The highest score wins. Ties go to the higher `priority`, then to user profiles over built-ins, then to the current or default profile.
4. A manual choice by the user for a file path is remembered and overrides detection (P2).

### Outline (program map)
`P1 · S · Core`

Replaces the branches in `gcodeParser.ts` with a generic runner. Tool entries come from `toolCall`. `outline` adds more kinds (`program`, `section`, `comment`, `label`, `stop`, `subprogram-call`). For each line, the first matching rule wins. The display text comes from the named groups. The kinds have fixed icons in the program map. Comment lines inside a tool segment can be shown as children of the tool, which gives a two-level tree (tool → operation comments) for typical CAM output.

### Numbering
`P1 · S · Profile` (fields) · consumed by [renumber](nc-transformations.md#renumber-blocks)

`mode`: `free` (default: any start and step) or `consecutive` (Klartext: every logical block, from `start` in steps of 1, no gaps allowed). How a block number is recognized (`N` prefix or leading integer) comes from `syntax.blockNumber`. Other fields: `start`, `step`, `fitToMax`, `digits`, `max`, `onOverflow` (`wrap` \| `stop`), `spacesAfter` or `alignColumn`, `everyNth`, `skipStartingWith[]`, `skipContaining[]`, `skipEmpty`, `skipFirst`, `skipLast`, `onlyNumbered`, `restartAtProgramStart`, `startTrigger` + `startAfterTrigger`, `references[]`, `autoNumberOnEnter`, `promptBeforeRenumber`.

### Editing
`P2 · S · Profile`

`forceUppercase` (comments excluded), `preventLineJoin`, `autoSpace`, `autoIndent`, `tabWidth`, `rulers` (for example the control's maximum block length), `completion` (`auto` \| `manual` \| `off`). Values missing in a profile fall back to the global editor settings.

### Load and save formatting
`P2 · S · Core`

- `onLoad`: `stripNul` (default on, reported), `tabsToSpaces`, `insertSpaces`. Any change made on load marks the document modified and is listed in the status bar, so the user knows the file will differ when saved.
- `onSave`: `trimTrailingWhitespace`, `finalNewline` (`keep` \| `add` \| `remove`), plus `files.encoding` and `files.lineEnding`. Characters that the target encoding cannot represent block the save with a list of lines, instead of being replaced silently.

### Tokenizer and colors
`P1 · M · Core` (generated grammar, role colors) · `P2 · S · Core` (per-profile colors, extra rules)

- `grammar` selects a Monarch grammar generator. `iso` covers Fanuc-style word-address code. It is generated from `syntax` (comment delimiters, block-number prefix, skip mark, variables) and the code database keywords. `klartext` is hand-written but reads the same `syntax` fields. Sinumerik (strings, `;` comments, function-style cycle calls) and Okuma OSP (alphanumeric sequence names, `=` addresses, `V` variables) differ too much for `iso` and get their own grammars, following the rule order in [syntax-sinumerik.md](syntax/syntax-sinumerik.md#38-monarch-rule-order-proposal) and [syntax-okuma.md](syntax/syntax-okuma.md#38-monarch-rule-order-proposal).
- Tokens carry roles: `blockNumber`, `skip`, `gcode`, `mcode`, `axis`, `arcCenter`, `feed`, `spindle`, `tool`, `variable`, `keyword`, `comment`, `section`, `programMarker`, `number`, `string`, `operator`, `invalid`.
- Each token is emitted as `role.profileId` (for example `feed.fanuc-gcode`). The app generates one Monaco theme for light and one for dark: base rules per role, plus per-profile overrides from `colors`. Monaco matches the more specific rule, so profiles can color differently even though a Monaco theme is global.
- `highlight` adds ordered extra rules before the defaults, for example `{ "match": "M0?[01]\\b", "role": "stop" }` or `{ "match": "G0?0\\b", "color": "#e5534b", "extend": "line" }`. `extend` colors the following digits, the following letters, or the whole line.
- Profile changes re-register the grammar (`setMonarchTokensProvider`) and regenerate the theme without a restart.
- Coloring whole lines by the active motion mode (rapid vs. feed vs. arc) needs modal state, which Monarch cannot track. It is done with decorations from the modal interpreter (P3).

## Profile editor
`P2 · M · Core`

A page in the settings dialog ([settings-ui.md](settings-ui.md#settings-dialog)):

- List of profiles. Built-ins are marked read-only and can be duplicated into a user profile with `extends`. User profiles can be renamed, deleted (with confirmation) and reordered (the order is the detection tie-break).
- One form per section, generated from the JSON Schema with help text per field.
- Pattern tester: paste sample lines, and see which rules (detection, outline, tool call, program start/end, numbering skips) match and what they capture.
- Live preview: a small read-only editor with a sample program for the profile, re-highlighted as colors or rules change.
- Open the profile as JSON in a tab (advanced), and import or export a single profile file.

## Migration steps

1. Write TypeScript types and the JSON Schema. Convert today's hardcoded data into `fanuc-gcode.json` and `heidenhain-klartext.json`. Load them at startup. Behavior stays identical, which is checked with sample-file tests for detection and the program map. (P1)
2. Replace `detectLanguage.ts` with profile scoring and `gcodeParser.ts` with the outline runner. (P1)
3. Generate the ISO grammar from the profile, and parameterize the Klartext grammar. (P1)
4. Move completions and blocks into the code database. (P1/P2)
5. User profiles with `extends`, then the profile editor. (P2)
6. Add the Fanuc lathe child profile, then Sinumerik and Okuma OSP profiles and grammars from the syntax notes. (P2)
