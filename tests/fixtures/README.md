# Test fixtures

Sample NC files for unit tests, performance generators and the runtime harness.

## Provenance

Every file here is synthetic. It was written for gEdit by the project, from the syntax
notes in `docs/planning/syntax/`, and was not copied from a machine, a CAM system, a
control manual or a customer program. None of these programs is meant to run on a
machine.

Each file starts with a comment that says so (`WRITTEN FOR GEDIT ...`). The
exceptions are:
- In Klartext programs, where `BEGIN PGM` must come first, the comment is block 1.
- In files with a byte order mark or a NUL leader, the comment follows the BOM or the
  leader.
- `empty.txt` has no room for a comment.

`tests/unit/fixtures.test.ts` checks the marker and checks that every file is listed
below.

## Rules

- `.gitattributes` marks `tests/fixtures/**` as `-text`, so git never converts line
  endings. The bytes in the repository are the bytes the tests see.
- Do not edit `nc/encoding/` by hand. Change `tests/gen/gen-encoding.mjs` and run
  `node tests/gen/gen-encoding.mjs`. `node tests/gen/gen-encoding.mjs --check` and the
  unit tests fail when the committed files differ from the generator output.
- Hand-written files use LF, except the three CRLF files named below. Save them with an
  editor that keeps line endings.
- New fixtures need a line in this file and, for `nc/`, an expectation in
  `expected/detect/<folder>.json` — one file per folder of `nc/`, read by
  `src/lib/core/profiles/detect.test.ts`, which fails on a file it has no answer for — and
  an outline golden in
  `tests/fixtures/expected/outline/`. `src/lib/core/profiles/outline.test.ts` walks every
  openable `nc/` fixture, so a new one gets a golden of its own: run
  `npx vitest run outline -u`, review the generated file, and commit it — CI fails on a
  fixture whose golden is missing.

## `nc/fanuc/`: Fanuc-style ISO programs

| File | Contents |
|---|---|
| `f01-mill-3tools.nc` | **CRLF.** A 3-tool milling program: `%`, `O1001 (BRACKET)`, a header tool list, `T1 M6` followed by the preselect `T2`, `G43 H`, `M8`, the cycles G81/G83/G84 with `G80`, `M98 P2000`, `M30`, `%`. It is also the source for `gen-large.mjs --dialect fanuc`. |
| `f02-packed.nc` | Words without spaces: `N10G0G90X0Y0`, a duplicate `N10` with `N10T1M6`, `M06T2`, `T3G43H3M6`, the macro words `#101=[#1+2.]` and `IF[…]GOTO100`, the block-skip forms `/1N90`, `/N100` and `N120/G0`, and a bare `N100` as the jump target. |
| `f03-multi-program.nc` | A main program `O3001` and a subprogram `O3002` ending in `M99`, between one pair of `%`. The main program has `T5` and `M6` on separate lines and `T6 G43 H6 M6` (words between T and M6). |
| `f04-feed-modes.nc` | Feed modes G93/G94/G95, `G96`/`G97` with `G50 S`, `G84` tapping in G95 with the pitch as F, and `F#101`. |
| `f05-comments-edge.nc` | `(T1 M6)` as a comment, unclosed `(` comments, comments before, between and after words, `(A)(B)`, a block-skipped comment, and `(NEXT: T1 M6)` trailing a move. |
| `O1234` | A file without an extension, with the packed tool change `N10T1M06`. |
| `f07.tap` | A short program with the `.tap` extension. |
| `detect-fanuc.txt` | A complete program in a `.txt` file, so only the content decides the dialect. |

## `nc/fanuc-lathe/`: Fanuc-style turning programs (M6)

Written from `docs/planning/syntax/syntax-fanuc.md` §4-§8. `l01`-`l04` and `l06` are
G-code system A, `l05` and `l07` system B; the expected system per file is in
`expected/detect/fanuc-lathe.json` next to the expected profile.

| File | Contents |
|---|---|
| `l01-turning-a.nc` | **CRLF.** A three-tool turning program in system A: `%`, `O2001 (PIN D30)`, a header tool list, `G21 G40 G99`, `G28 U0 W0`, `T0101`, the speed clamp `G50 S2500` with `G96 S220`, the two-block `G71` with the `N100`-`N200` profile and `G70 P100 Q200`, the retract `G00 X100. Z100. T0100` that is **not** a tool change, `T0303` with the two-block `G76`, a `G92` pass list and one `G32` pass, `T0505 G00 …` with `G83` on a C position and `G80`, `M30`, `%`. |
| `l02-packed.nc` | Words without spaces and every turret spelling: `N10T0101M8`, `T101`, `T1`, `T0111` (a second offset for the same station), the offset cancels `T0100`, and a lower-case block. |
| `l03-multi-program.nc` | A main program `O2003` calling `O2102` twice with `M98 P2102`, and the subprogram with a `G71`/`G70` pair and `M99`, between one pair of `%`. |
| `l04-references.nc` | One of every block reference: `GOTO 300`, `IF […] GOTO`, a `GOTO 900` whose target is missing, the local call `M98 Q500`, the other-program call `M98 P2005 Q500` (not a reference), `M99 P300`, and a duplicated `N500`. |
| `l05-system-b.nc` | System B: the clamp `G92 S2200`, feed per revolution `G95`, the single cycles `G77` and `G78`, and a `G33` threading pass. |
| `l06-decimal.nc` | The same values with and without a decimal point: `X50`/`X50.`, `Z1000`/`Z1000.`, `F155`/`F155.`, `G83 … Q6000 K3` against `Q6.`, `C90000` against `C90.`, and the dwells `G04 X1.5`, `G04 U2` and `G04 P500`. |
| `l07-system-b-drill.nc` | Six `G99 G83 …` cycle-return blocks against one `G92 S2000` clamp: the program that decides whether variant detection counts a pattern once or per line (§8.1). |
| `O2001` | A turning program in a file without an extension. |
| `detect-lathe.txt` | A complete turning program in a `.txt` file, so only the content decides the dialect. |

## `nc/heidenhain/`: Heidenhain Klartext programs

| File | Contents |
|---|---|
| `h01-3tools.h` | **CRLF.** `BEGIN PGM`, `BLK FORM`, `* -` section headings, `;` comment blocks and trailing comments, `TOOL CALL 1 Z S3000`, `CYCL DEF 200 ~` with continuation lines, `CYCL CALL`, `M99` calls, `FMAX`, `RL`, `CALL LBL 1` with `LBL 1`/`LBL 0` after `M30`, `END PGM`. It is also the source for `gen-large.mjs --dialect heidenhain`. |
| `h02-tool-names.h` | `TOOL CALL "MILL_D10" Z S5000 F800 DL+0.1`, a `TOOL DEF` preselect, `DECLARE STRING QS1` with `TOOL CALL QS1`, and the indexed tool `TOOL CALL 12.1`. |
| `h03-speed-only.h` | `TOOL CALL Z S5000` and `TOOL CALL S6000 F900`, which change the speed but not the tool. |
| `h04-cycle-feeds.h` | Cycle 200 with a numeric `Q206` and with `Q206=FAUTO`, cycle 207 with the pitch `Q239`, and the feeds `FAUTO`, `FZ`, `FU`, `FQ50` and `F` with a `Q50 =` assignment. |
| `detect-heidenhain.txt` | A complete program in a `.txt` file. |

## `nc/ambiguous/`: content that barely decides, or does not decide at all

| File | Contents |
|---|---|
| `fanuc-fragment.txt` | Fanuc blocks without `%` or an O number: only weak markers. |
| `heidenhain-fragment.txt` | Numbered Klartext `L`, `CC` and `C` blocks without `BEGIN PGM`. |
| `comment-only.txt` | Only `( )` comment lines. |
| `mill-4digit-t.nc` | A milling program whose tool numbers have four digits (`T1001 M6`), so it matches the lathe's turret-word rule and stays a mill on the mill markers (M6). |
| `empty.txt` | Zero bytes. |

## `nc/encoding/`: byte-level cases, generated by `tests/gen/gen-encoding.mjs`

All of them hold the same short milling program.

| File | Bytes |
|---|---|
| `utf8-lf.nc` | UTF-8 without BOM, LF. Contains `Ø`, `°`, `µ`, `Ü` and `→` (not in Windows-1252). |
| `utf8-bom-crlf.nc` | UTF-8 with BOM (`EF BB BF`), CRLF. |
| `cp1252-crlf.nc` | Windows-1252, CRLF, with `Ø ° µ Ü – €`. The file is not valid UTF-8. |
| `cr-only.nc` | ASCII, CR line breaks only (no `0x0A`). |
| `mixed-eol.nc` | ASCII: 10 CRLF, 2 LF and 1 CR; CRLF is the majority. |
| `nul-leader-trailer.nc` | 40 NUL bytes, the program (CRLF), 40 NUL bytes: punched-tape leader and trailer. |
| `nul-inside.nc` | 3 NUL bytes inside two lines, well under 10 % of the file. |
| `nul-heavy.bin` | A comment line, then 512 bytes of which half are NUL: binary data. |
| `utf16le-bom.nc` | UTF-16 LE with BOM (`FF FE`), CRLF. |
| `utf16be-bom.nc` | UTF-16 BE with BOM (`FE FF`), CRLF. |

## Expectations and golden files (M3)

Not NC programs: tables that say what a module must answer. The sample lines in them are
synthetic too, written for gEdit from `docs/planning/syntax/`. `tests/unit/fixtures.test.ts`
walks `nc/` only, so these files are checked by the tests that read them.

| File | Read by | Contents |
|---|---|---|
| `expected/detect/fixtures.json` | `src/lib/core/profiles/detect.test.ts` | The expected profile for every file under `nc/` (`fallback` and `refused` are answers too), plus `improvements`: the hand-written cases whose answer AD-11 detection changed against M0. The test asserts the key list equals the `nc/` listing, so a new fixture without an entry fails. |
| `tokens/fanuc-gcode.json` | `src/lib/core/nc/tokenizer.test.ts` | 68 golden lines, 184 tokens. Each entry is `{ line, tokens }` plus an optional `prev` (the incoming `LineState`, default not-a-continuation) and an optional `state` (the expected outgoing one). An entry is compared on the fields it lists; whitespace tokens are left out. |
| `tokens/fanuc-lathe.json` | same | 72 golden lines, same format, written for turning: every `T` spelling, `U`/`W` words, the two-block cycles, `G4U2`, `C90000` and `E1.5`. |
| `tokens/heidenhain-klartext.json` | same | 67 golden lines, 323 tokens, same format. |
| `numberformat.cases.json` | `src/lib/core/nc/numberFormat.test.ts` | 57 `formatNumber` cases: the decimal string, the written literal `original` (or `null`, parsed through `parseNumber`), the `NumberFormatOptions`, the expected text, and an optional `note`. |

## Transform and script cases (M4)

Case folders, not single files: one folder per case, discovered by the test that reads
them, so adding a case is adding a folder and nothing else. The programs in them are
synthetic and written for gEdit like everything else here, but they carry **no**
`WRITTEN FOR GEDIT` marker line: the marker is a comment, and `remove-comments` and
`convert-case` would rewrite it into the golden. The provenance statement lives in the
header of each reading test instead, the way `tokenizer.test.ts` does it for the token
goldens. `tests/unit/fixtures.test.ts` walks `nc/` only and does not look at these.

| Folder | Read by | Layout |
|---|---|---|
| `transforms/<id>/<case>/` | `src/lib/core/transforms/<id>.test.ts` | `input.nc`, `options.json`, `expected.nc` (§8.2). `<id>` is the `TransformDef.id`. |
| `scripts/<script>/<case>/` | `tests/python/test_<script>.py` | `input.nc` (stdin), the golden (below), optionally `params.json`, and a `case.json` naming the profile or replacing a member of the script context. |

A script's golden has one of two shapes, decided by what the script's header declares as
its `output` (`src-tauri/resources/scripts/README.md`):

- **a `report` script (`tool_list.py`)** writes `expected.json`: the whole stdout envelope,
  compared field for field.
- **a `replace` script (`scale_feed.py`, `scale_speed.py`)** writes `expected.nc` — the
  program text the script hands back, byte for byte — plus `envelope.json` for the rest of
  the envelope (`message` and `findings`). The text is split out because a golden of a
  transform is read by diffing it against its `input.nc`, and inside a JSON string it would
  be one escaped line with `\n` in it. `helpers.script_cases()` wants exactly one
  `expected.*` per folder, which `envelope.json` does not disturb; both test modules assert
  the full stdout all the same (`sorted(payload) == ["findings", "message", "text"]`).

`options.json` comes in two shapes, one per work package, and the reading test knows
which it expects:

- **`renumber` and `remove-block-numbers` (WP4.2)** wrap the run: `{ note, profile,
  scope | firstLine, options, expect }`. `expect` may name the `summary` key, the
  `skipped` lines with their severity, the `warnings` keys and the `preflight`; what it
  does not list is not checked.

  A case places its input inside a document in one of two ways, and which one it picks is
  part of what it tests:

  - **`scope: { startLine, endLine }`** — `input.nc` and `expected.nc` are the whole
    program, and the transform is handed the slice *plus the document*, exactly as
    `app/transforms.ts` does it for a selection. The test also asserts that the lines
    outside the scope are unchanged. This is the shape a selection case wants: a `GOTO`
    above the selection and a Klartext `~` block the selection starts inside are only
    visible to a run that has the document (G8 M4).
  - **`firstLine`** — a bare fragment and no document, which is what a headless caller
    hands over. Such a run must say that it could not look outside its own lines rather
    than report that it found nothing.
- **The five cleanup transforms (WP4.3)** hold the bare `TransformContext.options`
  (`{}` when there are none). The dialect comes from the case folder name — `klartext-…`
  is `heidenhain-klartext`, anything else `fanuc-gcode` — and `firstLine` is 1.

Unifying the two on the WP4.2 shape, and with it hoisting the loader both test files
repeat, is a cleanup for a later milestone; it would rewrite every golden's sidecar, so it
did not belong in the M4 merge. The WP4.2 cases are additionally asserted **idempotent**
(running the transform on its own `expected.nc` changes nothing) and to return an identity
`lineMap`.

68 transform cases: `renumber` 35, `remove-block-numbers` 11, `remove-comments` 7,
`insert-spaces` 5, `convert-case` 4, `remove-empty-lines` 3, `remove-spaces` 3.
75 script cases: `scale_feed` 33, `tool_list` 23, `scale_speed` 19.

The counts above include the M6 additions: the reference cases of WP6.3 under `renumber`
and `remove-block-numbers`, and the turning cases of WP6.6 under all three scripts. The
M6 families are described in **The machine and what it decides (M6)** below.

Eleven more were added by the **NC review of M6 (G8/G10)**, and as with the M4 ten, each
one is the reviewer's own program and each one is a thing the code got wrong rather than a
rule it already kept:

| Case | What it used to do |
|---|---|
| `renumber/spaced-cycle-values` | read no reference at all in `G71 P 100 Q 200`, moved the blocks and left the pointers behind |
| `renumber/m98-p-before-call` | rewrote the `Q` of `N50 P2000 M98 Q50`, because the `P` stood in front of the M-word |
| `renumber/mill-turning-cycle` | renumbered the blocks a `G70`/`G71 P-Q` names with an empty warning list, under the mill profile |
| `renumber/two-words-one-address` | rewrote a 3 mm peck depth as a block number, because the block carried two `Q` words |
| `renumber/wrap-references` | rewrote every reference with a number the wrapped program now carries twice |
| `remove-block-numbers/computed-jump` | deleted the target of `GOTO #100` and reported nothing, because "keep referenced" was on |
| `remove-block-numbers/mill-turning-cycle` | deleted the blocks a `G70`/`G71 P-Q` names, under the mill profile |
| `scale_feed/lathe-b-thread-no-clamp` | multiplied the `G78` thread leads of a system-B program read as system A |
| `scale_feed/lathe-a-thread-as-b` | multiplied the `G92` thread lead of a system-A program read with a system-B machine |
| `scale_feed/lathe-mill-tapping` | multiplied the `G74` tapping pitch of a milling program read with the lathe profile |
| `scale_speed/lathe-a-clamp-as-b` | raised the `G50 S` top-speed clamp of a `G96` program read with a system-B machine |

Ten of them were added by the M4 review, and each one is a program the code used to get
wrong rather than a rule it already kept:

| Case | What it used to do |
|---|---|
| `renumber/program-markers` | wrote `N10 :1000` in front of a colon-form program number |
| `renumber/selection-goto-above` | rewrote a jump target with no warning at all |
| `renumber/klartext-selection-continuation` | wrote a block number into a cycle parameter line |
| `renumber/mill-peck-cycle` | raised the reference confirmation on an ordinary G73 peck cycle |
| `remove-block-numbers/references` | deleted `GOTO` / `M99 P` / `G71 P-Q` targets in silence |
| `insert-spaces/klartext-keyword-values` | split `REP5` into `REP 5` on a dialect it claims to leave alone |
| `scale_feed/fanuc-lathe-threading` | multiplied the thread lead of every `G76` and `G92` block |
| `scale_feed/fanuc-zero-feed-with-limit` | raised `F0.` to the "smallest feed" and started cutting |
| `scale_feed/fanuc-lathe-decimals` | rounded a lathe feed back to itself and said nothing |
| `tool_list/fanuc-lathe-turret` | answered "No tool changes found." for a six-tool program |

## The machine and what it decides (M6)

These say how a **control** reads a program, which is a property of the machine and not of
the dialect (AD-31). They are written from `docs/planning/syntax/` and from the defaults of
plan §8.8, and every one of them is read by two languages or by two modules, so a rule can
never drift apart between them.

| File or folder | Read by | Contents |
|---|---|---|
| `machines/numbers.json` | `src/lib/core/machines/numbers.test.ts` and `tests/python/test_machine.py` | 138 cases over the number rules of §7.15, in five sets: `class` (which rule a word falls under), `value` (what its literal means in mm, inches, degrees or seconds), `writeBack` (putting a value back into the word it came from, and when that rounds), `readings` (what each preset would make of it) and `resolve` (a value only where every reading agrees). The presets are written into the file rather than read from a profile, because Okuma ships in M8; a case may name `{ "profile": "<id>" }` instead once it does. **Both languages run the same cases**, so a rule changed on one side fails on the other. |
| `machines/files/*.json` | `src/lib/core/machines/file.test.ts` | The four states a real `machines.json` is found in: `valid`, `invalid-record` (one record the reader keeps verbatim at its position), `newer-version` (a `$version` gEdit must read and never write) and `broken` (valid JSON of the wrong shape — the array where the object belongs). |
| `modal/<profile>/*.json` | `tests/python/test_modal.py` | What is in force after each block: `about`, `input` (a program under `nc/`), an optional `machine` (the machine parameters the golden runs with) and `states`, one entry per line that asserts something. A golden that names a `machine` needs its effective profile under `resolved/effective/`, which only integration writes (§5.2 rule 3). |
| `resolved/{profiles,codes,effective}/**` | `tests/unit/resolved.test.ts` | What the app really builds out of `src/lib/data/**`: each profile with its parents merged in, each code database with `extends` and `remove` applied, and each effective profile for a set of machine parameters (`effective/index.json` maps the parameter key to its file). They exist so that a review reads the **result** instead of the difference, and they are regenerated with `UPDATE_RESOLVED=1 npm test -- resolved`. |

## Generated at run time

`tests/gen/gen-large.mjs` writes large programs to `.perf/` (gitignored), built from
`f01-mill-3tools.nc` and `h01-3tools.h`:

```sh
node tests/gen/gen-large.mjs --lines 300000 --dialect fanuc --mb 10 --out .perf/fanuc-300k.nc
node tests/gen/gen-large.mjs --lines 1000 --dialect heidenhain --mb 50 --out .perf/klartext-50mb.h
```

`--lines` is the minimum line count. `--mb` is the minimum size in MiB. With both, the
moves get more words (feed, rotary axes) so the size fits the line count; if even the
longest moves are too short, the program gets more lines. `--eol lf` switches from CRLF
to LF.
