# Regular expressions

A regular expression is a pattern that matches text: "the letter F followed by digits". gEdit
uses them in two places, and they are **not the same dialect**:

| Where | Flavour |
|---|---|
| The editor's find and replace (`Cmd/Ctrl+F`), and **Find All…** and **Replace All…** with *Regular expression* ticked | JavaScript (ECMAScript) |
| A script you write ([Scripts](scripts.md)) | Python's `re` module |

Most of what is below is the same in both. Where it is not, the page says so. For NC code a
word query is often better than a pattern: see [Searching](README.md#searching), which finds
`G1` as a word and never inside a comment, with no pattern at all. Use a regular expression
for what is not a word: a pattern in a comment, a run of lines, the shape of a number.

## The pieces you need

| Pattern | Matches |
|---|---|
| `F` | the letter F (`f` too, unless *Match case* is on) |
| `\d` | one digit |
| `\d+` | one or more digits |
| `\d*` | zero or more digits |
| `-?` | an optional minus sign |
| `\.` | a decimal point. A bare `.` is *any* character, so `G84.2` as `G84\.2` |
| `[XYZ]` | one of X, Y or Z |
| `[^)]*` | any run of characters that are not `)` |
| `\(` and `\)` | the brackets of a comment. A bare `(` opens a group |
| `^` and `$` | the start and the end of the line |
| `\s` | a blank or a tab |
| `A\|B` | A or B |
| `( … )` | a group; `$1` (editor) or `\1` (Python) is what it matched |

Write `.`, `(`, `)`, `[`, `]`, `+`, `*`, `?`, `|`, `$`, `^`, `{` and `\` with a `\` in front when you
mean the character itself.

## Examples for NC code

These work in both flavours unless the note says otherwise.

| You want | Pattern |
|---|---|
| A feed word, with or without a point | `(?<![A-Z])F\d+(\.\d*)?` |
| Only the number after an `S` | `(?<=S)\d+` |
| A line that is only a comment | `^\s*\(.*\)\s*$` |
| A Z move below zero | `Z-\d+(\.\d*)?` |
| A block number at the start of a line | `^N\d+\s*` |
| `G1` however it is written: `G1`, `G01`, `G1.`, but not `G10`, `G1.5` or a `G1` inside another word | `(?<![A-Z])G0*1(?:\.0*)?(?![\d.])` |
| Any of the tool changes `T1 M6` and `T01 M06` | `T0*1\s+M0*6\b` |
| A `%` inside a comment | `\([^)]*%[^)]*\)` |
| A Klartext cycle definition | `^\s*\d*\s*CYCL DEF\s+\d+` |

Two of these are worth a closer look.

**The number after an address, `(?<=S)\d+`.** The part in `(?<=…)` must be there in front,
but is not part of the match. Replacing the match with `12000` turns `S800` into `S12000`
and leaves the `S` alone. It also matches the `1` of `S1=500` and a digit in a comment: it
knows nothing about NC code (in the editor's find box; **Replace All…** drops a hit in a
comment unless you tick *Also in comments*). To change feeds or speeds on a program, use the bundled
scripts ([Scripts](scripts.md)), which know what is a comment and what is modal.

**`G1` in one line, `(?<![A-Z])G0*1(?:\.0*)?(?![\d.])`.** Read it from the left: not
preceded by a letter, `G`, any number of zeros, `1`, an optional point with zeros, and not
followed by a digit or a point. **Find Whole Address…** hands a pattern of this kind to the
editor's find (with a few more allowances, such as a `+` sign, and no match behind an
underscore). The word query of **Find All…** is not a pattern: it reads the line
as NC code, so it never finds a `G1` inside a comment, which the pattern does. If you do
not want to write it, use one of those.

## The differences that bite

| | JavaScript (editor) | Python `re` (scripts) |
|---|---|---|
| **Case** | The *Aa* button in the find box, or the *Match case* box in the form; off by default | Off by default; `re.IGNORECASE`, or `(?i)` at the start of the pattern |
| **Inline flags** | Not supported: `(?i)` is an error | `(?i)`, `(?m)`, `(?s)` work |
| **`\b` around `G1.`** | `\b` sits between a letter or digit and anything else. `\bG1\.\b` never matches `G1. ` (a point and a blank are both "anything else"), and `\bG1\b` matches the `G1` of `G1.5`. Use the lookarounds above | The same |
| **Lookbehind** | `(?<=…)` and `(?<!…)` may be any length: `(?<=G0?1\s)` works | Must have a fixed length: `(?<=G0?1\s)` is an error. Write `(?:(?<=G1 )\|(?<=G01 ))` or restructure |
| **Named group** | `(?<name>…)` | `(?P<name>…)`, read back with `\g<name>` (in a replacement) or `m.group("name")` |
| **In the replacement** | `$1`, and in **Replace All…** also `$&` (the whole match) and `$$` (a dollar sign) | `\1` or `\g<1>`, `\g<0>` for the whole match; `$` is just a dollar sign. `\g<1>0` keeps a digit from joining the group number |
| **Start and end of text** | `^` and `$`; no `\A`, `\Z` | `^` and `$` (per line only with `(?m)`), and `\A`, `\Z` |
| **`\d` and `\w`** | Ascii only | Unicode: an Arabic digit is a `\d`. Add `re.ASCII` to get the editor's meaning |
| **A newline in the pattern** | In the editor's find, `\n` makes the pattern span lines | The same, if you give it more than a line; in a script you usually go line by line |

In **Find All…** and **Replace All…** a pattern is tried on **one line at a time**, as the line is
written, so `\n` never matches there. A hit that lies in a comment is dropped unless you tick
*Also in comments* (this box is for text searches; a word is never found in a comment). A
pattern that matches only an empty string (`$`, `^`, `\b` alone) changes nothing, because
empty matches are skipped. If you tick both *Whole address* and *Regular expression*, *Whole
address* wins: a word is not a pattern.

In **Replace All…** with a regular expression, `$1` is the first group, `$&` the whole
match and `$$` a dollar sign. That is the JavaScript way, even though the search ran in
gEdit and not in the find box.

## In a script

Scripts use `re`, but the first of the [five rules](scripts.md#five-rules-that-matter-more-than-any-feature)
is the reason to be careful: **work on tokens, not on a regular expression over raw lines.**
`tokenize_line` knows what a comment, a string and a variable are in this dialect; a pattern
does not. A pattern is the right tool for what is *inside* a word or a comment you already
isolated: the digits of a value, the text of a message.

```python
import re

# The number after F, on a token that is already known to be a feed word.
m = re.fullmatch(r"F(\d+)(\.\d*)?", token_text)

# Add a point to a whole number: 5 -> 5.
text = re.sub(r"(?<![\d.])(\d+)(?![\d.])", r"\1.", value)

# Name the parts.
m = re.search(r"(?P<code>[GM])0*(?P<num>\d+)", word)
```

Two habits that save a program:

- **Never run `re.sub` over a whole line** to change a number. `re.sub(r"F\d+", "F100", line)`
  rewrites `(FINISH F1 PASS)` as well.
- **Keep numbers as text.** `10.` is not `10`. `scale_decimal` and `format_number` in the
  library keep the point and the precision a value was written with.

## When a pattern is slow

A pattern with a group inside a group that both repeat (`(\d+)*`) can take very long on a
line that almost matches. If a search seems to hang, write the pattern with fewer
repeats: `\d+` instead of `(\d+)*`. gEdit has no way to stop a pattern that runs away (the
editor's own find box is the same), and the program is frozen until it ends or you close
the application, so **save your work before you try a pattern with nested repeats**.
