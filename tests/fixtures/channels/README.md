# Channel fixtures and goldens (M12)

The resolution and check cases of plan §7.17 and §9.1 (M12 rows), shared by the TypeScript
tests and, through `tests/python/helpers.py` `channel_context(golden=…)`, by Python.

- `nc/<control>/` — the channel programs (WP12.1).
- `resolve/<case>.json` — what `resolveDocument` answers for one program: layout, sections,
  outside ranges, marks, problems, and for `multi-file` the document's channel and its
  siblings' names (WP12.1; read by `src/lib/core/channels/goldens.test.ts`).
- `check/<case>.json` — the findings of the wait-code check (WP12.2).

## Provenance

Every program here is synthetic: written for gEdit by the project from the syntax notes
(`docs/planning/syntax/`) and the channel plan (§7.17, §8.9), not copied from a machine, a
CAM system, a control manual or a customer program, and not meant to run on a machine. The
wait codes, `P` words, section starts and file names are gEdit's own examples of the shapes
the manuals describe (F61). Each program carries the `WRITTEN FOR GEDIT` marker in its first
two lines (the second line under an Okuma `$NAME.MIN%` or a Sinumerik `%_N_…_MPF` header),
uses LF endings and ends with a newline; `tests/fixtures/**` is `-text`, so the bytes are the
bytes the tests read. `goldens.test.ts` checks all of that, that every program is listed
below, that every program is read by a golden, and that each one is detected as the
profile its goldens name.

**Why under `channels/nc/` and not `nc/channels/`** (§9.1 names the latter). Every program
under `tests/fixtures/nc/` must have each of its G and M words described by its code
database (`src/lib/core/codes/load.test.ts`), and a wait code is a machine builder's code
that no built-in database describes, or ever will (§8: "no machine-builder codes in a
built-in"). The same reason put `l08-g183-macro.nc` under `expected/detect/programs/`. They
also need no detection or outline golden of the M3 kind: the map's channel grouping is
WP12.5's, and the detected profile is asserted here.

## The programs

### `nc/fanuc-lathe/` — one file with sections (`single-file`)

Sections start on a program number: `O21xx` in order (`c01`–`c05`, `c11`: the Nth start is
the Nth channel), or `O1xxx`/`O2xxx` naming the channel (`c10`). Waits are `M9xx` with the
paths as **digits of `P`** (`P12`, `P21`, `P13`), packed (`M901P12`) and spaced
(`M902 P12`, `M 907 P 12`), unless the case says otherwise.

| File | Contents |
|---|---|
| `c01-twin-single.nc` | Two channels in one file: header lines above both, `O2101 (CHANNEL 1 …)` … `M99`, `O2102 (CHANNEL 2 …)` … `M30` `%`, each section with its own tools and the waits `M130`, `M131`, `M132`, read by the `M1` + two digits `prefix` rule, all matching. |
| `c02-mismatch-single.nc` | The same shape in the real wait shapes (`M9xx` with digit `P`, packed and spaced, `N`-numbered and bare). On purpose: `M902` (line 14) only in channel 1 — its partner is missing; `M903` once in channel 1 (16) and twice in channel 2 (37, 39) — the counts differ; `M905`/`M906` in one order in channel 1 (19, 22) and the other in channel 2 (42, 44) — a swapped pair; `M907 P13` (24) names path 3, which the machine does not have; `M908` (25) has no `P` and, as on a three-path control, names nobody — the wait with no counterpart. Clean on purpose: `M901 P12` against `M901 P21` (the order of the digits is free) and `M0909 P12` against `M909P12` (a leading zero is not read). |
| `c03-jump.nc` | Channel 1: `M901`, a plain label `N50`, `M902`, `M903`, the jump target `N100`, a backward `IF […] GOTO 100`, `M904`. Channel 2: `M902`, `M901`, `M904`, `M903`. The pair `M901`/`M902` is swapped across a label nobody jumps to (its order is checked); the pair `M903`/`M904` is swapped across a jump target and a backward jump (its order is not checked). |
| `c04-comments.nc` | Wait codes where they are not waits: in a comment line, in a trailing comment, `M9010` (outside the range), `#901=12`, `M902.5`. Read as waits: `M901 (FIRST WAIT) P12` (the `P` after a comment counts), the block-skip `/M903 P12` (a wait the operator may skip is still a wait of the program), `M 907 P 12`. Waits whose `P` cannot be read and is therefore one unknown piece, never "no `P`": `M904 P12.`, `M905 P#1`, `M906 P12 P13`. A wait written inside a string is in `s11-two-channel_1.MPF`: Fanuc programs have no strings. |
| `c05-one-channel.nc` | An ordinary one-channel program (`O1234`), opened with the two-channel machine: no section starts, `layout: 'none'`, no marks, no problem. |
| `c10-alternating.nc` | Four sections `O1001`, `O2001`, `O1002`, `O2002` (channels 1, 2, 1, 2), each ended by `M99`/`M30`, each with its own tools and one wait, then the subprogram `O9001` both channels call, after the last section end: it and the closing `%` are outside every channel, like the header lines. |
| `c11-repeat-ids.nc` | The shape of a real two-channel program: a label on every wait line (`N10 M910 P12` …), `M910` twice and `M920` three times in both channels, the same counts in the same order — the clean case. |

### `nc/fanuc-lathe/` — one file per channel (`multi-file`)

| File | Contents |
|---|---|
| `c06-part_CH1.nc`, `c06-part_CH2.nc` | A matching pair named `<stem>_CH<n>.nc`, with `P` as a **bit sum** (`P3` = channels 1 and 2) and one `M902` without `P` (paths 1 and 2 on a two-path control); channel 1 also has an `M01` and both end with `M30` (`c06-stops-and-ends.json` reads them as waits). |
| `c07-part_CH1.nc` | Channel 1 of a pair whose `c07-part_CH2.nc` is deliberately absent. |
| `c08-marker_A.nc`, `c08-marker_B.nc` | The channel written in the header, `(PATH 1)` and `(PATH 2)`: under a `_CH<n>` file-name rule the names say nothing and the `marker` answers alone; `c08-marker-disagrees.json` reads `c08-marker_B.nc` with a rule whose letters say channel 1 — the header wins and the disagreement is a problem. |
| `c09-notachannel.nc` | A base name no pattern matches: no channel (`layout: 'none'`) until the user assigns one (`c09-assigned.json`, `channels.assign` in WP12.5). |
| `c12-main.nc`, `c12-main_GS.nc` | A main-spindle and a counter-spindle program with no channel token in common, expressed by **per-channel templates** `{{stem}}.nc` and `{{stem}}_GS.nc`; `P12` names the two through the aliases `1` and `2`. |
| `c13-three-path.nc1`, `c13-three-path.nc2`, `c13-three-path.nc3` | Three paths, one file each, the path number at the end of the extension, read by the built-in preset `fanuc-lathe/fanuc-3path-digits` itself: `P123`, `P12`, `P13`, `P21`, `P31`, `P321`, packed and spaced — every wait matches. |

### `nc/okuma/`

| File | Contents |
|---|---|
| `o10-two-turret.MIN` | Two turrets in one program, read by the preset `okuma-osp/okuma-2turret`: alternating `G13`/`G14` sections (the aliases of turrets `a` and `b`), the header lines outside; the **ordered** `P` codes `P5`, `P15`, `P35` on turret A against `P5`, `P25`, `P35` on turret B (a number on one side only is legal: the clean case); the **counted** `M100` twice on each side. |
| `o11-count-mismatch.MIN` | The same program with one `M100` fewer on turret B: the counts differ (one finding). |

### `nc/sinumerik/`

| File | Contents |
|---|---|
| `s11-two-channel_1.MPF`, `s11-two-channel_2.MPF` | One program per channel, named `<stem>_<n>.MPF`; **rendezvous** waits `WAITM(10,TURN_MAIN,TURN_SUB)`, `WAITM(20, TURN_MAIN, TURN_SUB)`, `WAITMC(40,1,2)` whose partners are symbolic names resolved through the aliases `TURN_MAIN`/`TURN_SUB`, or numbers, in either order; `SETM(30)`/`CLEARM(30)` (not blocking: shown, never checked); not marks: `WAITM(…)` inside a `MSG("…")` string and in a `;` comment, and `WAITE(2)`. The patterns are the preset's, written for gEdit. |

## Golden format

```json
{ "input": "../nc/fanuc-lathe/c01-twin-single.nc",
  "profile": "fanuc-lathe",
  "machine": { "channels": { "layout": "single-file", "list": [ … ], "sectionStart": "…", "syncMarks": [ … ] } },
  "expect": { "layout": "single-file",
              "sections": [ { "channel": "1", "ranges": [ { "startLine": 4, "endLine": 24 } ] } ],
              "outside": [ { "startLine": 1, "endLine": 3 } ],
              "marks": [ { "ruleId": "m1xx", "mark": "30", "line": 11, "channel": "1", "partners": ["1", "2"], "blocking": true } ],
              "problems": [] } }
```

- `input` is relative to the golden file. `profile` is the profile the program is read with,
  and the one it must be detected as.
- `machine.channels` is the machine's channel block (`ChannelParams`, §7.17). Since #149 the
  block is never part of the effective profile, so nothing else of a machine changes how
  channels resolve, and a golden carries only this member. Instead of `machine`, `"preset":
  "<profile id>/<preset id>"` takes a built-in preset's block as it ships (`c13`, `o10`,
  `o11`), so a preset change shows up here.
- `assigned` (optional) is the user's assignment of a `multi-file` document (`c09-assigned`).
- `expect` keys, each compared exactly when present: `layout`; `sections` (one entry per
  channel found, declared order, ranges in document order); `outside`; `marks` (every
  `SyncHit`, in line order; an entry lists the fields it checks, the order and the count are
  exact); `problems` (`path`, message `key`, `params`); for `multi-file` also `self` (the
  document's channel id or `null`), `by` (`fileName`, `marker`, `assigned`) and `siblings`
  (`siblingNames(baseName, p, self)`: the other channels' ids and names, `name: null` where
  none can be derived, or `null` when the name is no channel file).
- A sync rule may use any `match` kind of §7.17: `codes` (the plain list, `"M900-M999"`),
  `prefix`, `regex`; and any `partners` kind: `all`, `fixed`, `word` (`"address": "P"`,
  `"decode": "digits" | "bitmask"`, `whenAbsent`), `line`.
- Line numbers are 1-based, ranges inclusive, counted over the editor's lines: a file that
  ends with a newline has one more, empty, line, which belongs to the last section when one
  runs to the end.
