# Dialects

Every control reads NC code a little differently. A comment is `( ... )` on one and `;` on
another; one numbers every block and refuses a program that does not; `X10.` and `X10` are
the same value on one control and a factor of a thousand apart on the next.

gEdit keeps all of that in a **dialect profile** — one data file per control family. The
editor itself has no favourite dialect: highlighting, the program map, the cleanups, the
renumbering, the code help and the scripts all ask the profile.

## What ships

| Profile | Status bar | For |
|---|---|---|
| **Fanuc (ISO) mill** | `Fanuc` | ISO/G-code programs for milling machines and machining centres — Fanuc and the many controls that emit the same code |
| **Heidenhain Klartext** | `Heidenhain` | Klartext conversational programs (`BEGIN PGM` … `END PGM`) |

Two profiles, both for **milling**. See [Lathes, and other controls](#lathes-and-other-controls)
below before you use gEdit on turning code.

## Which dialect a file gets

When you open a file, gEdit scores each profile:

1. The **extension** counts. `.nc` and `.tap` point at Fanuc, `.h` points strongly at
   Klartext.
2. The **content** of the first 400 non-empty lines counts. A leading `%`, an `O1234`
   program number or a line of `G`/`M` codes points at Fanuc; `BEGIN PGM`, `TOOL CALL`,
   `FMAX` or a block that starts with a bare number points at Klartext. Each line counts
   once, for the strongest thing it matched.
3. The highest total wins. A file that matched nothing at all — an empty file, an unknown
   extension, a plain text note — keeps the default dialect from
   `Settings ▸ Files ▸ Default dialect`.

The extension is a **hint, not a verdict**. A Klartext program that somebody saved as
`part.nc` is still recognised as Klartext, because its content says so.

The dialect of the document is shown in the status bar. Click it to change it — the
highlighting, the code help, the program map and everything on the NC tab switch
immediately. The dialect also decides the filters in the Save As dialog and the extension
a new file is offered.

Changing the dialect changes nothing in the text.

## What a profile decides

| | Fanuc (ISO) mill | Heidenhain Klartext |
|---|---|---|
| File extensions | `.nc` `.tap` `.cnc` `.eia` `.iso` `.min` `.ncc` `.ptp` `.txt` | `.h` |
| Comments | `( ... )` | `;` to the end of the line, plus text in `"` quotes |
| Block numbers | `N` in front, optional | a plain number at the start of the block, **required** |
| Block skip | `/` before or after the number, with levels | `/` after the number |
| Decimal point | significant — `X10` and `X10.` are different values | not significant |
| Words | may be packed together (`G0M1`) | separated by spaces |
| Variables | `#100` | `Q`, `QL`, `QR`, `QS` numbers |
| Continuation | — | a trailing `~` |
| Tool call | `M6`, with the `T` word on the same line or the last one before it | `TOOL CALL`, on the same line |
| Program start / end | `O1234` or `:1234` / `M30`, `M2` | `BEGIN PGM name` / `END PGM` |
| Renumber defaults | start 10, step 10, no padding, restart at each program start, skip `%`, `O` and comment lines | consecutive from 0, step 1 |
| Jumps that point at a block number | `M99 P`, `M98 Q`, `G70`–`G73` `P`/`Q`, `GOTO` | none — `CALL LBL` points at a label, not at a block number |
| Code help entries | 81 codes and 25 addresses | 80 codes and 34 addresses |

The program map lists what each profile calls worth listing: for Fanuc the program number,
whole-line comments, `M0`/`M1` stops, subprogram calls and the program end; for Klartext
the `*` section headings, `;` comments, the program header, labels, subprogram calls,
`STOP` and the program end. Tool calls are in both.

## Lathes, and other controls

**There is no lathe profile in this version.** A turning program opens, edits, saves and
renumbers correctly — it is still ISO code — but it is read with a **mill** profile, and
that has consequences worth knowing:

- **Tool changes.** The mill profile recognises a tool change by `M6`. A turret lathe
  changes tools with the `T` word alone, so `F7` finds nothing and the bundled tool-list
  script returns an empty list. It does not fail silently: the list carries a warning at
  the first tool word saying that a turret lathe needs a lathe profile.
- **Thread cutting.** On `G76` and `G92` the `F` word is a thread lead, not a feed rate.
  The bundled "Scale feed rates" script knows this and **refuses to touch those blocks**,
  and the hover says the same thing when you point at them. Scaling them would cut a
  different thread.
- **Constant surface speed.** `G96`/`G97` are understood by the scripts' feed and speed
  tracker, but `G98`/`G99` as lathe feed modes are not.

A Fanuc lathe profile, Siemens Sinumerik and Okuma OSP are planned for a later phase.

## Writing your own profile

Not in this version. Profiles are data files inside the application, and gEdit does not
read profiles from your own folders yet. What you *can* extend today is the script library
— see [scripts.md](scripts.md), and note that a script always gets the resolved profile
and the code database of the document it runs on, so a script can be written against
whatever dialect the document is in instead of assuming one.
