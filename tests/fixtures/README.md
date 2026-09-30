# Test fixtures

Sample NC files for unit tests, performance generators and the runtime harness.

## Provenance

Every file here is synthetic. It was written for gEdit by the project, from the syntax
notes in `docs/planning/syntax/`, and was not copied from a machine, a CAM system, a
control manual or a customer program. None of these programs is meant to run on a
machine.

The one planned exception is `nc/owner-public/<profileId>/` (empty so far): programs the
owner handed over as safe to publish (phase 2 plan §9.2, owner decision D45), checked with
`tests/gen/check-anonymized.mjs` first. They keep the bytes the control wrote, carry no
marker, and each gets a line in a `## nc/owner-public/` section here: the control, a
generic description of what it makes, the hand-over date and "published with the owner's
permission". Any other real program stays in the gitignored `tests/real/` and is never
committed.

Each file starts with a comment that says so (`WRITTEN FOR GEDIT ...`). The
exceptions are:
- In Klartext programs, where `BEGIN PGM` must come first, the comment is block 1.
- In Okuma programs with the `$NAME.MIN%` / `$NAME.SUB%` header and Sinumerik programs with
  the `%_N_NAME_MPF` / `%_N_NAME_SPF` transfer header, which must be the first line, the
  comment is the second line.
- In files with a byte order mark or a NUL leader, the comment follows the BOM or the
  leader.
- `empty.txt` has no room for a comment.
- The owner's public programs (above) carry none.

`tests/unit/fixtures.test.ts` checks the marker (in the first two lines), the line endings
of the hand-written files, and that each file's name appears in backticks here.

## Rules

- `.gitattributes` marks `tests/fixtures/**` as `-text`, so git never converts line
  endings. The bytes in the repository are the bytes the tests see.
- Do not edit `nc/encoding/` by hand. Change `tests/gen/gen-encoding.mjs` and run
  `node tests/gen/gen-encoding.mjs`. `node tests/gen/gen-encoding.mjs --check` and the
  unit tests fail when the committed files differ from the generator output.
- Hand-written files use LF, except the three CRLF files named below and
  `scripts/tool_list/fanuc-preselect/input.nc`. Save them with an editor that keeps line
  endings. `tests/unit/fixtures.test.ts` checks endings under `nc/` only; a new CRLF
  fixture there also goes into its `crlf` list.
- New fixtures need a line in this file and, for `nc/`, an expectation in
  `expected/detect/<folder>.json` — one file per folder of `nc/`, read by
  `src/lib/core/profiles/detect.test.ts`, which fails on a file it has no answer for — and
  an outline golden in
  `tests/fixtures/expected/outline/`. `src/lib/core/profiles/outline.test.ts` walks every
  openable `nc/` fixture, so a new one gets a golden of its own: run
  `npx vitest run outline -u`, review the generated file, and commit it — CI fails on a
  fixture whose golden is missing.
- The runtime harness reads several of these folders too: the detection and outline
  goldens (`m3-profiles`, `m3-outline`, `m3-nav`, `m6-lathe-detect`, `m6-lathe-nav`, the
  `m8-*` scenarios), the transform and script cases (`m4-transforms`, `m4-scripts`,
  `m6-lathe-renumber`, `m6-lathe-scripts`, `m8-*`), a modal golden
  (`m8-sinumerik-diamon`) and `exit/` (`m5-exit`). A changed golden can fail a runtime
  scenario as well as a unit test.

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

## `nc/fanuc-lathe/`: Fanuc-style turning programs

Written from `docs/planning/syntax/syntax-fanuc.md` §4-§8. `l01`-`l04` and `l06` are
G-code system A, `l05` and `l07` system B; the expected system per file is in
`expected/detect/fanuc-lathe.json` next to the expected profile.

| File | Contents |
|---|---|
| `l01-turning-a.nc` | **CRLF.** A three-tool turning program in system A: `%`, `O2001 (PIN D30)`, a header tool list, `G21 G40 G99`, `G28 U0 W0`, `T0101`, the speed clamp `G50 S2500` with `G96 S220`, the two-block `G71` with the `N100`-`N200` profile and `G70 P100 Q200`, the retract `G00 X100. Z100. T0100` that is **not** a tool change, `T0303` with the two-block `G76`, a `G92` pass list and one `G32` pass, `T0505 G00 …` with `G83` on a C position and `G80`, `M30`, `%`. |
| `l02-packed.nc` | Words without spaces and every turret spelling: `N10T0101M8`, `T101`, `T1`, `T0111` (a second offset for the same station), the offset cancels `T0100`, and a lower-case block. |
| `l03-multi-program.nc` | A main program `O2003` calling `O2102` twice with `M98 P2102`, and the subprogram with a `G71`/`G70` pair and `M99`, between one pair of `%`. |
| `l04-references.nc` | One of every block reference: `IF […] GOTO 300`, a plain `GOTO 900` whose target is missing, the local call `M98 Q500`, the other-program call `M98 P2005 Q500` (a block of program 2005, never rewritten), `M99 P300`, and a duplicated `N500`. |
| `l05-system-b.nc` | System B: the clamp `G92 S2200`, feed per revolution `G95`, the single cycles `G77` and `G78`, and a `G33` threading pass. |
| `l06-decimal.nc` | The same values with and without a decimal point: `X50`/`X50.`, `Z1000`/`Z1000.`, `F155`/`F155.`, `G83 … Q6000 K3` against `Q6.`, `C90000` against `C90.`, and the dwells `G04 X1.5`, `G04 U2` and `G04 P500`. |
| `l07-system-b-drill.nc` | Six `G99 G83 …` cycle-return blocks against one `G92 S2000` clamp: the program that decides whether variant detection counts a pattern once or per line (phase 2 plan §8.1). |
| `O2001` | A turning program in a file without an extension. |
| `detect-lathe.txt` | A complete turning program in a `.txt` file, so only the content decides the dialect. |

## `nc/sinumerik/`: Siemens Sinumerik 840D turning programs

Written from `docs/planning/syntax/syntax-sinumerik.md` §2-§8. Diameter programming is on
at the top of each of them, because that is the profile's documented default (phase 2 plan
§8.5, owner decision D35); `s02` and `s05` switch it. The `.MPF` and `.SPF` extensions are
written in upper case and still count as `mpf` and `spf`.

| File | Contents |
|---|---|
| `s01-shaft.MPF` | A three-tool shaft: the transfer header `%_N_SHAFT_MPF` and `;$PATH=`, a header tool list between separator lines, `G18 G90 G95 G40 G500 DIAMON`, `MSG("…")` in front of each operation, `T="ROUGH" D1` with `G96 S200 LIMS=3000 M4` and the stock-removal call `CYCLE95("…",…)`, which is recognized and not described, `T3 D1` for a `G42` finishing pass with a `G3 … CR=2` corner, `T="THREAD_M40"` cutting three straight `G33 Z… K1.5 SF=0` passes, `MSG()` and `M30`. |
| `s02-drill.MPF` | A flange: a centre hole on the turning axis with `G17` and `CYCLE83(…)`, then driven tools on the face — `SPOS=0`, `DIAMOF`, `TRANSMIT`, `G17 G94`, the tool spindle as `S3=2400 M3=3`, `MCALL CYCLE83(…)` over three positions and the cancelling `MCALL`, `M3=5`, `SETMS(3)` for three `CYCLE84(…)` tapping calls, `SETMS(1)`, `TRAFOOF`, `DIAMON` and `G18 G95`. |
| `s03-sub.SPF` | A subprogram: `%_N_GROOVE_SPF`, `PROC GROOVE(REAL XBOT, REAL ZPOS, INT PECKS)`, `DEF REAL` and `DEF INT`, the `R` parameter `R10`, the labels `NEXT_PECK:` and `LAST_CUT:` with `IF … GOTOF` and `GOTOB`, values written `X=XNOW`, the dwell `G4 F0.3`, `MSG("…")` and `MSG()`, the calls `L20`, `L30 P2`, `CALL "…"`, `EXTCALL "…"` and `PROBE_DIA(1,,3)`, and `M17`. |
| `s04-packed.MPF` | No transfer header, packed words (`N10G18G90G95`, `T1D1`, `G0X90Z2`), the block skips `/` and `/1`, a lower-case block, and every form of the `T` word: `T1`, `T12`, the offset cancel `T0 D0` that is **not** a tool change, `MSG("T1 ROUGH")`, which names a tool inside a string and is not one either, and the spindle forms `T1=5` (tool 5) and `T2="PARTOFF"` next to `M1=4`, `M1=5`, `M2=4` and `M2=5`, which switch spindles and are neither a stop nor the program end. |
| `s05-diameter.MPF` | Diameter programming assumed on at the top, then switched three ways — `DIAMOF`, `DIAM90` with a `G91` step, `DIAMON` — plus the clamp `G26 S3000`, `G710`, the dwells `G4 F1.5` and `G4 S2` (two spindle revolutions, not a speed) and the optional stop `M1`. |
| `SHAFT_OP20` | A part-off program in a file without an extension, so only the content decides the dialect. |
| `detect-sinumerik.txt` | A finishing pass and a centre hole in a `.txt` file, so only the content decides the dialect. |

## `nc/heidenhain/`: Heidenhain Klartext programs

| File | Contents |
|---|---|
| `h01-3tools.h` | **CRLF.** `BEGIN PGM`, `BLK FORM`, `* -` section headings, `;` comment blocks and trailing comments, `TOOL CALL 1 Z S3000`, `CYCL DEF 200 ~` with continuation lines, `CYCL CALL`, `M99` calls, `FMAX`, `RL`, `CALL LBL 1` with `LBL 1`/`LBL 0` after `M30`, `END PGM`. It is also the source for `gen-large.mjs --dialect heidenhain`. |
| `h02-tool-names.h` | `TOOL CALL "MILL_D10" Z S5000 F800 DL+0.1`, a `TOOL DEF` preselect, `DECLARE STRING QS1` with `TOOL CALL QS1`, and the indexed tool `TOOL CALL 12.1`. |
| `h03-speed-only.h` | `TOOL CALL Z S5000` and `TOOL CALL S6000 F900`, which change the speed but not the tool. |
| `h04-cycle-feeds.h` | Cycle 200 with a numeric `Q206` and with `Q206=FAUTO`, cycle 207 with the pitch `Q239`, and the feeds `FAUTO`, `FZ`, `FU`, `FQ50` and `F` with a `Q50 =` assignment. |
| `detect-heidenhain.txt` | A complete program in a `.txt` file. |

## `nc/okuma/`: Okuma OSP turning programs

Written from `docs/planning/syntax/syntax-okuma.md` §2-§8. A unit system changes what a
number is worth, never how the program looks, so the files read the same under each of the
profile's three unit systems; the numbers themselves are chosen for a 1 mm machine, the
profile's assumed default. `o01`-`o03` and `o05` are main programs with the `$NAME.MIN%`
transfer header, `o04` a subprogram file with the `$NAME.SUB%` header. The expected profile
per file is in `expected/detect/okuma.json`. `expected/detect/_improvements.json` holds
detection cases written out as inline text: `o01-flange.MIN` under `.nc`, `.txt` and no
extension, and three short synthetic programs written during the NC review (no header but a
`G71` thread cycle with `H` and `D`; a `G77` tap with `K`; a `$` continuation line).

| File | Contents |
|---|---|
| `o01-flange.MIN` | A four-tool turning program: `$O01-FLANGE.MIN%`, `O1001`, `N1 (…)` operation comments, the clamp `G50 S2500` before `G96 S180 M03 M42`, the six-digit `T010101` and `T030303` next to the four-digit `T0202` and `T0707` on purpose, a `G42`/`G40` finishing pass, and two `G74` cycles - a centre hole and a face groove - whose `T0203` and `T0708` change only the offset of the end point and are **not** tool changes, `M02`, `%`. Its header decides the dialect under any extension, and its six-digit `T` words carry it even without the header. |
| `o02-thread.MIN` | Threading under `G97`: the multi-pass cycle `G71 … B60 D0.7 U0.1 H2.45 L2 F2 M23 M32 M73` (a thread cycle on this control, not a roughing cycle), a `G33 … F2` pass followed by passes that change only `X`, and the dwell `G04 F1`. |
| `o03-live-tool.MIN` | Driven tools on the face: `M110` alone in its block, `M146`, `G94`, `SB=2000 M13`, a modal `G181` drilling cycle repeated at five more `C` positions, `G180`, a `G184` tapping cycle with `Q6`, `M12`, `M147`, `M109`. |
| `o04-sub.SUB` | Two subprograms in one file: `O1234` with the sequence name `NLOOP`, `V1` counters, `X=DIA1+2` expressions, `IF [V1 LT 3] GOTO NLOOP` and `CALL O2345 Q2 DIA1=40 ZL1=-20`; `O2345` with the LAP call `G85 NLAP1 …`, its shape `NLAP1 G81` … `G80`, the short jump `IF […] N100`, `GOTO NEND` and `NEND RTS`. |
| `o05-lap-tap.MIN` | LAP roughing and finishing (`N0100 G85 NAT01 …`, `N0200 G87 NAT01`) along the shape `NAT01 G81` … `G80`, which stands before the calls; the change of cutting conditions on two lines that start with `$` (`$ G84 XA=60 DA=2 FA=0.25`, `$ XB=40 DB=1 FB=0.2`); a `G71` thread cycle whose `H`, `L` and `F` go on over a `$` line; and a `G77` tap with its approach `K`. The lines the `$`-continuation and `G77 … K` tapping detection rules need. |
| `SHAFT-OP2` | A turning and cross-drilling program in a file **without an extension and without the `$…%` header**, which is how a program copied off the control can arrive: only the content decides the dialect. |
| `detect-okuma.txt` | A complete program in a `.txt` file, with the header and the modal call `MODIN O3000` … `MODOUT`, so only the content decides the dialect. |

## `nc/ambiguous/`: content that barely decides, or does not decide at all

| File | Contents |
|---|---|
| `fanuc-fragment.txt` | Fanuc blocks without `%` or an O number: only weak markers. |
| `heidenhain-fragment.txt` | Numbered Klartext `L`, `CC` and `C` blocks without `BEGIN PGM`. |
| `comment-only.txt` | Only `( )` comment lines. |
| `mill-4digit-t.nc` | A milling program whose tool numbers have four digits (`T1001 M6`), so it matches the lathe's turret-word rule and stays a mill on the mill markers (`M6`, `G43 … H`, `G17`, `Y` words). |
| `empty.txt` | Zero bytes. |

## `nc/encoding/`: byte-level cases, generated by `tests/gen/gen-encoding.mjs`

All of them except `nul-heavy.bin` hold the same short milling program.

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

## `exit/`: the Phase 1 exit-criteria programs

Three programs and the bytes `m5-exit-criteria` and `m5-exit-criteria-nopython` must save
(`expected/`, `expected-nopython/`); they are also the programs of the screenshots in the
top-level README. Written by `exit/gen-exit.py`; do not edit them by hand.
`exit/README.md` describes each file. `tests/unit/fixtures.test.ts` does not walk `exit/`.

## Expectations and golden files

Not NC programs: tables that say what a module must answer. The sample lines in them are
synthetic too, written for gEdit from `docs/planning/syntax/`. `tests/unit/fixtures.test.ts`
walks `nc/` only, so these files are checked by the tests that read them.

| File | Read by | Contents |
|---|---|---|
| `expected/detect/<folder>.json` | `src/lib/core/profiles/detect.test.ts` (also `src/lib/data/profiles/fanucLathe.test.ts`) | The expected profile for every file under `nc/` (`fallback` and `refused` are answers too); `fanuc-lathe.json` adds the expected G-code system. The keys together must equal the `nc/` listing, so a new fixture without an entry fails. |
| `expected/detect/_improvements.json` | `src/lib/core/profiles/detect.test.ts` and `src/lib/data/profiles/okuma.test.ts` | Hand-written detection cases as inline text, each with the answer the first detection (M0) gave and the one it gives now; the leading `_` keeps the file out of the per-folder glob. |
| `tokens/fanuc-gcode.json` | `src/lib/core/nc/tokenizer.test.ts` and `tests/python/test_gedit_nc.py` | 68 golden lines, 184 tokens. Each entry is `{ line, tokens }` plus an optional `prev` (the incoming `LineState`, default not-a-continuation) and an optional `state` (the expected outgoing one). An entry is compared on the fields it lists; whitespace tokens are left out. |
| `tokens/fanuc-lathe.json` | the same | 72 golden lines, 197 tokens, same format, written for turning: every `T` spelling, `U`/`W` words, the two-block cycles, `G4U2`, `C90000` and `E1.5`. |
| `tokens/heidenhain-klartext.json` | the same | 67 golden lines, 323 tokens, same format. |
| `tokens/okuma-osp.json` | the same | 111 golden lines, 256 tokens, same format: comments, block skips, sequence numbers and names (`NLAP1`), four- and six-digit `T` words, the cycles and macro keywords, `SB=`, the `$…%` header, `X=V1+V2`, and a no-break space before `=`. |
| `tokens/sinumerik.json` | the same | 125 golden lines, 255 tokens, same format, written for turning: `;` comments, the skip levels, packed words, `T`/`D` pairs, the bare command keywords, strings, calls (also `CYCLE840 (…)` with a blank before the bracket), labels, `R1=R2*2`, `$AA_IM[X]`, and a no-break space before `=`. |
| `numberformat.cases.json` | `src/lib/core/nc/numberFormat.test.ts` and `tests/python/test_gedit_nc.py` | 57 `formatNumber` cases: the decimal string, the written literal `original` (or `null`, parsed through `parseNumber`), the `NumberFormatOptions` (`fmt`), `significant` (whether the decimal point is significant), the expected text and a `note`. |

## Transform and script cases

Case folders, not single files: one folder per case, discovered by the test that reads
them, so adding a case is adding a folder and nothing else. The programs in them are
synthetic and written for gEdit like everything else here. The transform cases carry no
`WRITTEN FOR GEDIT` line (`renumber/basic` apart), because `remove-comments` and
`convert-case` would rewrite it into the golden. Most script cases carry it, which is
harmless because the scripts never touch comments. `tests/unit/fixtures.test.ts` walks
`nc/` only and checks neither.

| Folder | Read by | Layout |
|---|---|---|
| `transforms/<id>/<case>/` | `src/lib/core/transforms/<id in camelCase>.test.ts` (e.g. `removeBlockNumbers.test.ts`) | `input.nc`, `options.json`, `expected.nc` (phase 1 plan §8.2). `<id>` is the `TransformDef.id`. |
| `scripts/<script>/<case>/` | `tests/python/test_<script>.py` | `input.nc` (stdin), the golden (below), optionally `params.json` and `preceding.nc` (the part of the document above a selection, which fills `input.precedingLines`), and a `case.json` naming the profile or replacing a member of the script context. |

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

`options.json` comes in two shapes, and the reading test knows which it expects:

- **`renumber` and `remove-block-numbers`** wrap the run: `{ note, profile, options,
  expect }` plus an optional `scope` or `firstLine`. `expect` may name the `summary` key,
  the `skipped` lines with their severity, the `warnings` keys and the `preflight`; what it
  does not list is not checked.

  How a case places its input inside a document is part of what it tests:

  - **neither** — `input.nc` is a bare fragment with no document, starting at line 1: the
    shape most cases use.
  - **`scope: { startLine, endLine }`** — `input.nc` and `expected.nc` are the whole
    program, and the transform is handed the slice *plus the document*, exactly as
    `app/transforms.ts` does it for a selection. The test also asserts that the lines
    outside the scope are unchanged. This is the shape a selection case wants: a `GOTO`
    above the selection and a Klartext `~` block the selection starts inside are only
    visible to a run that has the document.
  - **`firstLine`** — a bare fragment and no document that starts at that line, which is
    what a headless caller hands over. Such a run must say that it could not look outside
    its own lines rather than report that it found nothing.
- **The five cleanup transforms** hold the bare `TransformContext.options` (`{}` when there
  are none). The dialect comes from the case folder name — `klartext-…` is
  `heidenhain-klartext`, anything else `fanuc-gcode` — and `firstLine` is 1.

The two shapes, and the loader that `renumber.test.ts` and `removeBlockNumbers.test.ts`
each carry, are known duplication; unifying them on the `renumber` shape rewrites every
cleanup case's `options.json`. The `renumber` and `remove-block-numbers` cases are
additionally asserted **idempotent** (running the transform on its own `expected.nc`
changes nothing) and to return an identity `lineMap`.

74 transform cases: `renumber` 41, `remove-block-numbers` 11, `remove-comments` 7,
`insert-spaces` 5, `convert-case` 4, `remove-empty-lines` 3, `remove-spaces` 3.
111 script cases: `scale_feed` 53, `scale_speed` 31, `tool_list` 27. The tests discover the
folders, so `ls tests/fixtures/transforms/*/ tests/fixtures/scripts/*/` is the authority.

A case that reproduces a review finding says so: in its `note` (`renumber`,
`remove-block-numbers`), in the header of its test (the cleanups) or in the comments of the
`REQUIRED_CASES` list of its test (the scripts). Each such case is a synthetic program the
reviewer wrote to reproduce a failure — a thing the code got wrong, not a rule it already
kept.

## The machine and what it decides

These say how a **control** reads a program, which is a property of the machine and not of
the dialect (phase 2 plan AD-31). They are written from `docs/planning/syntax/` and from
the defaults of phase 2 plan §8.8. The number rules are run by both languages, and the
modal goldens by the Python interpreter (the TypeScript one does not exist yet) and by the
runtime harness; `machines/files/` is read by the TypeScript tests alone.

| File or folder | Read by | Contents |
|---|---|---|
| `machines/numbers.json` | `src/lib/core/machines/numbers.test.ts` and `tests/python/test_machine.py` | 138 cases over the number rules of phase 2 plan §7.15, in five sets: `class` (which rule a word falls under), `value` (what its literal means in mm, inches, degrees or seconds), `writeBack` (putting a value back into the word it came from, and when that rounds), `readings` (what each preset would make of it) and `resolve` (a value only where every reading agrees). The number presets (`inputs`) are written into the file. `decls` and `profiles` name a built-in profile (`{ "profile": "<id>" }`), except `decls.okuma` and `profiles.feed-word-e`, which were written inline before the Okuma profile existed; pointing them at `okuma-osp` is a follow-up. **Both languages run the same cases**, so a rule changed on one side fails on the other. |
| `machines/files/*.json` | `src/lib/core/machines/file.test.ts` and `src/lib/stores/machines.test.ts` | The four states a real `machines.json` is found in: `valid`, `invalid-record` (one record the reader keeps verbatim at its position), `newer-version` (a `$version` gEdit must read and never write) and `broken` (valid JSON of the wrong shape — the array where the object belongs). |
| `modal/<profile>/*.json` | `tests/python/test_modal.py`; `m8-sinumerik-diamon` in the runtime harness | What is in force after each block: `about`, `input` (a program under `nc/`), an optional `machine` (the machine parameters the golden runs with) and `states`, one entry per line that asserts something. The format is in `modal/README.md`. A golden that names a `machine` needs its effective profile under `resolved/effective/`: run `UPDATE_RESOLVED=1 npm test -- resolved` after adding it. |
| `resolved/{profiles,codes,effective}/**` | `tests/unit/resolved.test.ts`, and the Python tests read them | What the app really builds out of `src/lib/data/**`: each profile with its parents merged in, each code database with `extends` and `remove` applied, and, per profile, `defaults.json`, one `preset-<id>.json` per number preset, one `variant-<id>-<value>.json` per variant choice, and one `k-<hash>.json` per distinct machine a golden runs with; `effective/index.json` maps each such golden (every `modal/**` file, every script `case.json` with a `machine`) to its `k-…` file. They exist so that a review reads the **result** instead of the difference, and they are regenerated with `UPDATE_RESOLVED=1 npm test -- resolved`. |

## Generated at run time

`tests/gen/gen-large.mjs` writes large programs to `.perf/` (gitignored). The mill
dialects are built from `f01-mill-3tools.nc` and `h01-3tools.h`, the two turning dialects
from the seed programs `OKUMA_PROGRAM` and `SINUMERIK_PROGRAM` written into the generator.
`--lines` and `--dialect` are required; without `--out` the file is
`.perf/<dialect>-<lines>.<ext>`.

```sh
node tests/gen/gen-large.mjs --lines 300000 --dialect fanuc --mb 10 --out .perf/fanuc-300k.nc
node tests/gen/gen-large.mjs --lines 1000 --dialect heidenhain --mb 50 --out .perf/klartext-50mb.h
node tests/gen/gen-large.mjs --lines 300000 --dialect okuma --mb 10 --out .perf/okuma-300k.min
node tests/gen/gen-large.mjs --lines 300000 --dialect sinumerik --mb 10 --out .perf/sinumerik-300k.mpf
```

`--lines` is the minimum line count. `--mb` is the minimum size in MiB. With both, the
moves get more words (feed, rotary axes) so the size fits the line count; if even the
longest moves are too short, the program gets more lines. `--eol lf` switches from CRLF
to LF.
