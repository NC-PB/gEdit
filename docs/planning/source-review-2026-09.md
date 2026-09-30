# Source review, September 2026

What the new control manuals and the owner's example programs showed, what gEdit had missed, what this review corrected, and what it proposes for the roadmap. Written against the tree after M8 (integration C) and the housekeeping pass.

**Status:** the corrections in §4 are applied. Every proposal in §5 is **proposed — owner to decide**; neither the [roadmap](roadmap.md) nor the milestones of the [Phase 2 plan](phase-2-implementation.md) were changed. The open items are in [TODO.md](../../TODO.md).

**Status 2026-09-27.** The owner decided the tapping-speed question and reviewed the 24 published example programs (§2, §5 R10, §7); both are implemented. Of §5's roadmap proposals, **R1** (detection that cannot wreck a program) is accepted and implemented, and **R2** (a built-in Sinumerik milling profile) is accepted into the M9 prelude — this review's own findings and sizing are unchanged, only their status. Later the same day, **R3** (5-axis and high-speed codes, and words that are data), **R4** (the remaining tokenizer rules), **R6** (per-machine tool words and `U`/`W`) and **R7** (the program checks the manuals make certain) were accepted as well, placed as §5 proposes: R3, R4's remaining parts and R6 into the M9 prelude, R7 into WP9.4. Two questions this review did not raise were also answered the same day: the plan's own D49 (a five-digit Fanuc lathe `T` word is a 3-digit tool plus a 2-digit offset) and the Sinumerik main spindle (spindle 1). §3, §4.4 and §6 below are marked where this closed them; the findings themselves are not rewritten — the plan (`phase-2-implementation.md` §7.16, §10) and [TODO.md](../../TODO.md) carry the current contract and status. R5, R8, R9 and the rest of R10 are still open.

## 1. What was read

| Source | What it gave |
|---|---|
| Fanuc Series 30i/31i/32i Model A user manuals: common functions, lathe system, machining-centre system (German) | The full G-code lists of both machine types and all three lathe G-code systems, the cycle formats, macro B, program names, number input and its parameters, multi-path waits |
| Heidenhain TNC 640 Klartext user manual (software -07 and -08) and cycle manuals (-07 and -08) | PLANE, TCPM, `LN`, cycle calls, the old DEF-active cycles, the parameter order of the 200-series cycles and the rule for how new parameters are added |
| Siemens 840D sl NC programming (4.92), cycles (2008), fundamentals and job planning (2006, 2013), measuring cycles (2008, 2019), 5-axis handbook (2009), high-level-language training (2010) | The milling side of the control: `CYCLE800`, `CYCLE832`, `TRAORI`, frames, `G75`, the predefined M functions, the older boring and turning cycles, channel coordination |
| Okuma OSP-P200L (English) and P300S/L lathe manuals (2014, 2020), the special-functions manual (2020), a multi-tasking turning-centre operation manual (2017) | Y-axis and coordinate conversion, contour generation, sub-spindle mode, work coordinate systems, arc threading, synchronized tapping, two-turret synchronization, the T word per machine |
| Programming handbooks of several machine builders: twin-turret lathes, single-turret mill-turn machines, multi-tasking machines, turning centres, and a post-processor handbook | How multi-channel machines separate and synchronize their channels in practice, and which control facts a builder changes |
| The owner's published example programs: 24 files in five dialects, CAM output for 2.5D, 3+2, 5-axis simultaneous, drilling and turning | A run of gEdit's real code over real output (§2); installed as owner-public fixtures, originally on the branch `research/public-fixtures`; merged 2026-09-27 without the four large 5-axis files (§10.1) |
| The owner's private programs: 17 files, local only | The same run, reported here in aggregate only |
| The fixes after the M8 reviews | The re-review that TODO asked for, with a code lens and an NC lens (§6) |

Every fact here is restated in our own words; nothing from a manual is copied. The findings were checked by running the shipped tokenizers, detection, program map, renumbering and bundled scripts on synthetic lines and on the published programs.

## 2. What the example programs showed

The run: detection, tokens, program map, hover coverage, a renumber dry run, scale feed, scale speed and the tool list, over every published and private program. Nothing crashed or hung; the slowest step on a 376,000-line program was a script at 10–17 s, inside the 60 s deadline. Detection was right for 19 of 24 published programs and 16 of 17 private ones — as findings 1–4 below and dec/detect's R1 fixed, **all 20 committed public programs now detect as their folder says**; the private programs stay at 16 of 17, the same Y-axis lathe program still opening as a mill (reconfirmed by `dec/int`'s own G11 run).

**Changes a program so it no longer runs or cuts right (findings 1–6, all fixed by 2026-09-27):**

1. **Fixed (R1).** A 5-axis Klartext program made almost entirely of `LN` blocks opens as **Fanuc mill** (the Klartext line rule does not know `LN`, while every `Y` word scores for the mill). Renumbering then writes `N10` in front of all of its 99,000 blocks, and scale feed reads `CYCL DEF 7.0` as an F word and changes the cycle number.
2. **Fixed (R1).** Four of the six published Siemens programs, all milling, open as **Fanuc mill**. There, `( … )` is a comment: Remove Comments deletes the arguments of `I=AC(…)` and `MCALL CYCLE83 (…)`, and renumbering writes `N10 ;$PATH=…`.
3. **Fixed (dec/klartext).** A Klartext post that writes the block-skip `/` **in front of** the block number: renumbering writes a second number into those blocks (`15 /15 L …`).
4. **Fixed (dec/names).** A Fanuc program **named** `<NAME>` instead of numbered: renumbering numbers the name line, scale feed reads the letters of the name as words and rewrites the digits in it, and on the lathe a name that contains `T12` is a tool change.
5. **Fixed (dec/scaling, owner decision 1).** Tapping speeds are scaled in three dialects (a driven tap on a lathe, Klartext cycles 206 and 209, a private lathe program) and only reported; the tap's feed stays, so the pitch changes. This is the pending "Tapping speed" decision, now with evidence.
6. **Fixed (dec/scaling, TODO Next up 8).** A lead under a G code the database does not know (a builder's radial tapping cycle) is scaled like a feed.

**Wrong information, no text changed — status:** Klartext numbers written with a **decimal comma** (6 of 7 published Klartext programs) are unknown tokens, and `Q206=636,62` reads as 636 — **fixed** (dec/klartext); a Sinumerik milling program read with the turning profile counts every preselect as a tool change — still open (waits for R2's profile, M9 prelude); the Okuma machining-centre programs show no tool change at all — still open (R9's profile, Phase 3; the detection guard that at least opens them as Okuma is done, R1); a lathe post that writes five-digit `T` words shows no tools — **fixed** (dec/tools, owner decision 3: the tool now shows; one private Y-axis-heavy program still detects as a mill, a separate gap, see TODO); renumbering a 5-axis program numbered past N3,700,000 wraps into 37 series of duplicates — untouched by this batch, still open; scale speed changes nothing on a Sinumerik post that writes `SETMS(1)` before every speed — **fixed** (dec/scaling, the Sinumerik main-spindle decision).

**Noise:** real programs carry tokens that the planned G11 "no unknown token" check would fail on (Sinumerik `GOTOF` targets and bare cycle calls, Klartext cycle names and datum-table references, `;` block ends); 10 of 17 private programs have at least one. `check-anonymized.mjs` flags cycle and label numbers as part numbers, and does not read strings.

## 3. What gEdit missed, ranked

By harm to CAM output first, then by how often the owner's output meets it. "Fixed" means on this branch (§4); the rest is in TODO or a proposal (§5).

| # | Dialect | Missed | Where it goes |
|---|---|---|---|
| 1 | Klartext, Sinumerik | A milling program of either opens as Fanuc mill, and renumbering or Remove Comments then corrupts it | **Fixed** (R1, dec/detect: decisive headers, Siemens-only markers, and a guard that refuses the risky transforms and scripts on a contradiction) |
| 2 | Klartext | `M136` (feed per revolution) was unknown: scale feed with a "smallest feed" of 50 turned `F0.2` mm/rev into `F50.0` | **Fixed** |
| 3 | Fanuc | Tap and thread leads the databases did not know were scaled: `G34` (variable lead, mill and lathe) and lathe `G84.2`; mill `G84.2`/`G84.3` and the tapping mode `G63` still are | **Fixed** (`G34`, lathe `G84.2` in M8; mill `G84.2`/`G84.3` and `G63` in dec/scaling, TODO Next up 8) |
| 4 | Fanuc | `<NAME>` program names, `M98 <NAME>` calls | **Fixed** (dec/names) |
| 5 | Klartext | Block skip in front of the block number | **Fixed** (dec/klartext) |
| 6 | Okuma | `G136`/`G137`/`G138`: after `G137` or `G138`, X is a radius; extents and address arithmetic would read it at twice its value. The owner's turning post writes them in every driven-tool section | **Fixed** (database, `sets.diameter`) |
| 7 | all | Words that are data, not positions: `G65`/`G66` arguments, `G10` offsets, `G52`/`G92` settings, frame origins and angles (`G68.2`, `CYCLE800`, `TRANS`), `G75`/`M91`/`M92` machine points, and absolute positions inside cycle calls (Klartext `Q203`, Sinumerik `RTP`/`RFP`/`DP`) | R3, R8 |
| 8 | Fanuc lathe | The M10 "partners from the line" rule cannot read Fanuc's own `P` word (`P12` digits or `P3` bit sum; no `P` = paths 1 and 2), which is what the owner's 3-path set writes | R5 |
| 9 | all mills | The 5-axis and high-speed codes CAM writes are unknown to every database, so M9's unknown-code finding and M11's hover would be noise on every 5-axis file | R3 |
| 10 | Klartext | Cycle calls do not end a definition: one `CYCL DEF` serves many `M99`; the database's `cycle: cancel` models it the Fanuc way | TODO (modal data) |
| 11 | Okuma | Four of five Okuma programs are machining-centre programs, read with the lathe profile | R9 |
| 12 | Sinumerik | Renumbering capped block numbers at 99999 and wrapped; the control has no five-digit limit and wants unique numbers | **Fixed** |
| 13 | Fanuc, Okuma | The `T` word split is a parameter of the machine (Fanuc offset digits; Okuma 200+ offsets), and `U`/`W` are not incremental on every system-B machine | R6 |
| 14 | all | Program checks the manuals make cheap and certain are not in WP9.4 yet; one planned Okuma check (`T` not 4 or 6 digits) would flag correct programs | R7 |
| 15 | Heidenhain, Sinumerik, Okuma, Fanuc | Many `verify` flags the manuals settle, several wrong labels (Sinumerik `CYCLE87`, Okuma `GET`/`PUT`, lathe-B and mill `G50`) | **Fixed** (§4.1) |

## 4. Corrections made on this branch

### 4.1 Code databases (`src/lib/data/codes/*.json`)

Each fact is settled by the manual named in §1; the resolved fixtures are regenerated and every test that pinned the old data states the new rule.

- **Fanuc mill (`fanuc`):** `G34` added (variable-lead thread, `pitchFeed`; the lathe inherits it). `K` (repeat count) added to `G74`, `G76` and `G84`–`G89`, `P` (dwell) to `G76` and `G87`, `Q` (peck tapping) to `G84`, so a `K3` is never read as a length. `G44`, `G87`, `G88` confirmed. `G50` relabelled "Scaling cancel" and `G92` confirmed; both keep their `S` clamp guard for a lathe program opened as mill.
- **Fanuc lathe (`fanuc-lathe`, `fanuc-lathe-b`):** `G84.2` (rigid tapping, older block format, `pitchFeed`) added. `G54.1` and `G93` are no longer removed: the lathe's own list has both. `G85`/`G89` confirmed. System-B `G50` relabelled "Scaling cancel", keeping its speed-limit guard. `G77`–`G79` in the system-A database keep `verify` on purpose: they describe system B.
- **Heidenhain (`heidenhain`):** `M136`/`M137` added as the feed-mode pair. `Q208` of cycle 205 is optional, like `Q395` (both came with software -04). `PLANE SPATIAL`, `PLANE RESET`, `FUNCTION TCPM`, `FUNCTION RESET TCPM` and `CYCL CALL POS` confirmed; the TCPM pair is modal like `M128`/`M129`; the PLANE pair moved from the group `plane` (the G17–G19 group) to a group of its own, `tilt`. `M92` says that the tool length is not applied.
- **Sinumerik (`sinumerik`):** `CYCLE87`–`CYCLE89` described as the cycles manual has them (the old text said the operator retracts; the cycle does, at rapid, on NC start) and confirmed. `M40`–`M45` (gear stages) and `M70` added: the control predefines them, and all of the owner's Siemens programs write `M41`. The `LIMS` text says where it acts (`G96`, `G961`, `G97`, not `G971`).
- **Okuma (`okuma`):** `G136`/`G137`/`G138` added with `sets.diameter`. `GET`/`PUT` relabelled (they move characters between the serial buffers and variables, not machine resources); `READ`/`WRITE` described. `G17`–`G21`, `G112`/`G113`, `G140`/`G141`, `G190`/`G191`, `M17`, `PSELECT`, `END` confirmed, with corrected labels where they were vague. Left marked: `G36`/`G37` (no manual gives the format), `G107`/`G108` (modality), `G142`/`G143` (only the older code table).

### 4.2 Profiles (`src/lib/data/profiles/*.json`)

- **Sinumerik:** `numbering.max` 99999 → 2147483647 (the INT limit of the `N` address) and `onOverflow` `wrap` → `stop`. The renumber form reads a maximum that stops as the control's hard limit, so the limit has to be the control's own, not a round number.

### 4.3 Syntax notes (`docs/planning/syntax/*.md`)

All four notes name the new sources, drop the **(verify)** marks the manuals settle, correct what they contradict and answer their open questions where the manuals or the owner's output can. The larger corrections:

- **Fanuc:** two G codes of one group in a block are not an alarm (the last wins); several M codes need a parameter; system C is fully listed; `G50` on a system-B/C lathe is scaling cancel; `H`/`V` are incremental C/Y in system A; `G54.1` and `G93` exist on the lathe; `E` is the inch-thread form; the cycle word formats; macro B functions, loops and variables; program names, block-number limits, the `%` and code-table rules; new lint rows.
- **Heidenhain:** `LN` without normals is valid for peripheral milling; tool-name characters and the delta limit; PLANE and TCPM forms; cycle-call semantics and the DEF-active cycles; the 200-series parameter orders and the "optional parameters are appended" rule; the owner's `~` layout; decimal comma and skip-before-number exist in real output.
- **Sinumerik:** `CYCLE800`, `CYCLE832` (the second argument changes meaning between versions), the older boring and turning cycles, `G58`/`G59`/`G74`/`G75`, the predefined M functions, ISO mode, channel coordination, block-number range.
- **Okuma:** the Y-axis and conversion modes, contour generation, sub-spindle mode, work coordinate systems, arc threading, synchronized tapping, the T word per machine, the two-turret rules for M10, the machining-centre gap.

The user guide follows the data: the code-help counts and the "not verified yet" lists in [dialects.md](../user/dialects.md), and the Sinumerik renumbering default there and in [transformations.md](../user/transformations.md).

### 4.4 What this review deliberately did not change

| Change | Why not here |
|---|---|
| Mill `G84.2`/`G84.3` | Two more codes behind the prefix `G8` change what the Phase 1 runtime scenario `m3-assistant` counts, and the harness could not be run — **done in dec/scaling**, `m3-assistant` updated (dec-fix-code fixed the three checks it missed); G6 confirmation still pending, TODO Next up 1 |
| `G63` (Fanuc tapping mode) | A tapping mode is neither a cycle nor a motion; the rule "`pitchFeed` only in a cycle or motion group" needs a decision first — **decided and done**: `pitchFeed` may sit on a modal code of a group of its own (dec/scaling, `FeedModeTracker.pitch_mode`) |
| `<NAME>` program names | `syntax.names` would do it for the tokenizer, but AD-24 keeps the M8 tokenizer fields off the Fanuc profile, and the tool rule and the map need the name masked as well — **done**: a new opt-in field `syntax.programNames`, masked with `_`, no AD-24 amendment (dec/names) |
| `P`/`K` units on lathe `G84`/`G85`/`G88`/`G89` | The unit table of plan §8.2 is the one place parameter units are written, so it changes first — still open (the **mill**'s `G84.2`/`G84.3` are in the table now, dec/scaling; the lathe rows are unchanged) |
| Detection weights (`BEGIN PGM`, `%_N_`) | Detection margins are reviewed as a set (G10), and the M8 re-review just showed one weight change misreading a Fanuc program — **done in R1** (dec/detect), margin table reprinted for the merged tree (dec/int) |
| Sinumerik `M6`/`M19` `verify` | Kept by the G10 rule that what the machine sets up stays out of hover |

## 5. Roadmap proposals

Each one is **proposed — owner to decide**. Sizes as in the [planning README](README.md#conventions-used-in-these-documents). Ranked by value for the owner's CAM output.

### R1. Detection that cannot wreck a program

**Accepted and implemented, 2026-09-27 (`dec/detect`).**

- **What:** a decisive Klartext header (`BEGIN PGM` on a leading numbered block) and Sinumerik header (`%_N_…_MPF`/`;$PATH=`), like the Okuma header already is; content markers for Siemens-only syntax that count on lines that move Y (`=AC(`, `CR=`, `CYCLE8…(`, `MSG(`, `TRAORI`); an Okuma machining-centre guard (`G15`/`G16 H`, `G56 H`); and Remove Comments and renumbering refusing to run when the content contradicts the dialect (a `%_N_` header read as Fanuc).
- **Why:** it is the most harmful finding of the run: two of the owner's published dialects are corrupted by an ordinary renumber or comment cleanup, only because of how they were detected.
- **Smallest useful version:** the two decisive headers and the refusal in Remove Comments. Data plus one guard.
- **Size:** S. **Where:** TODO Next up #5, before M9, with the G10 margin table printed again. **Displaces:** nothing.
- **Done:** delivered as more than the smallest version — decisive headers for both dialects, the Siemens-only markers, the Okuma machining-centre guard, the Okuma/Fanuc-lathe header-less tie broken deliberately, and the guard on every risky transform (Remove Comments, Renumber, Remove Block Numbers, Insert/Remove Spaces, Convert Case) and on replacing scripts, not Remove Comments alone. Contract, decisions and the full margin table are in `phase-2-implementation.md` §7.16 and §10.1.

### R2. A built-in Sinumerik milling profile

**Accepted into the M9 prelude, 2026-09-27.**

- **What:** ship the `sinumerik-mill` child the user guide already sketches: `M6` tool changes (a `T` alone is a preselect), diameter off, `G17`/`G94` power-on, detection weights for milling syntax, and database entries for `CYCLE800`, `CYCLE832`, `TRAORI`/`TRAFOOF`, `G75`, the `ORI…` and `DYN…` codes.
- **Why:** five of the six published Siemens programs are milling posts; read as turning, every preselect is a tool change and the tool list shifts every tool's feed one row down. Plan §11 #18 and D47 deferred it "until sample programs exist" — they exist now.
- **Smallest useful version:** the profile and 20 entries, with mill-turn (`DIAMON`, `LIMS`, `SETMS`, `TRANSMIT`) staying with the turning profile.
- **Size:** M. **Where:** the M9 prelude (P9), since M9's checks and extents read the tool segments. **Displaces:** the regex help page could move from M9 to M12.
- **Status:** not built yet; written into the M9 prelude of `phase-2-implementation.md` §6.

### R3. 5-axis and high-speed codes, and words that are data

- **What:** entries for what CAM writes on every 5-axis and 3+2 file (Fanuc `G43.4`/`G43.5`, `G68.2`–`G68.4` + `G53.1` + `G69`/`G69.1`, `G05.1`, `G61`–`G64`, `G12.1`/`G13.1`, `G07.1`, `G65`/`G66`/`G67`, `G10`; Klartext cycles 7, 9, 19, 247 and the other PLANE forms; Sinumerik as in R2), plus two database flags: "the axis words of this block are data" and "this code opens / closes a frame".
- **Why:** the owner's mill output is 3+2 or 5-axis in all four milling dialects. Without the entries, M9's unknown-code finding and M11's hover fire on every such file; without the flags, extents and address arithmetic treat a `G10` offset or a tilted-plane origin as a position.
- **Smallest useful version:** the entries with correct parameter classes, and the two flags read by WP9.5 and WP11.4 instead of hard-coded `G53`/`G28` lists (which would also break "no consumer names a dialect").
- **Size:** M (content S, contract S). **Where:** the flags in the M9 prelude's contract; the content in M9's G10. **Displaces:** nothing; it is what M9's extents need to be right.

### R4. Read the numbers and names real programs write, before M9

**The comma and the program names are done, 2026-09-27.**

- **What:** the Klartext decimal comma; Fanuc program names and the macro function and print names (`FIX[`, `POPEN`); Okuma two-letter `=` words and four-digit option M codes; the Sinumerik `:123` main block and the call-rule exclusions (`CUT3DCC`, `ORIRESET(`); Klartext `TIP-TIP` and the PLANE words.
- **Why:** M9's checks and extents read values; a comma number that reads as 636 instead of 636.62, or an `X` word that is really `FIX`, gives wrong minimums and false findings. The comma is in six of the seven published Klartext programs.
- **Smallest useful version:** tokenizer rules in TS and Python on the shared goldens, one golden per case.
- **Size:** S–M. **Where:** the M9 prelude. **Displaces:** nothing.
- **Done:** the Klartext decimal comma (`dec/klartext`, `syntax.decimalSeparatorAlt`) and Fanuc program names (`dec/names`, `syntax.programNames`) are implemented, ahead of M9. **Still open:** the macro function and print names, the Okuma `=` words and option M codes, the Sinumerik `:123`/call-rule exclusions, and the Klartext PLANE words.

### R5. The wait-code model the manuals describe, for M10

- **What:** in §7.17, a `decode` choice on the "partners from the line" rule (`split`, `digits` with 0 as channel 10, `bitmask`) and the partners of a mark with no `P` (`whenAbsent`); an optional "alone in its block" rule; an optional "required on" pattern (Okuma: a spindle command on one turret needs the same `P` on the other); a finding for two marks whose partner sets disagree; `WAITE` as an end-of-program wait that is never counted; `SETM`/`CLEARM` non-blocking. And program checks and extents per channel, since M9 reads a two-channel document as one program (a spindle run by the other channel is not "a cut with the spindle stopped").
- **Why:** the owner's 3-path set is a Fanuc lathe program whose waits carry digit `P` words; the current rule would report every one of them as naming an unknown channel.
- **Smallest useful version:** `decode` and `whenAbsent` (they fix the false findings); the rest as data-only options.
- **Size:** S contract, S checks. **Where:** the M10 prelude (P10) and WP10.6. **Displaces:** nothing; the c02 fixture is rewritten in the real shapes.

### R6. Machine parameters the manuals show are per machine

- **What:** a Fanuc lathe choice "U/W/V/H are incremental" (on in system A, off on some system-B machines); a tool-word variant for the `T` split (Fanuc offset digits 1/2/3, Okuma three-digit offsets on machines with 200 or more); extra axis letters (`W`, `B`, `A` for a sub-spindle or second headstock); in the number presets an IS-A preset, the ×10 option and the point-less feed-per-revolution unit.
- **Why:** one of the owner's lathe posts writes five-digit `T` words and gets no tools; extents that read `U` as incremental on a machine that refuses it are wrong by a whole move.
- **Smallest useful version:** the `U`/`W` choice and the tool-word variant, as variants and overlays of the existing machine parameters (AD-31, no new consumer).
- **Size:** S–M. **Where:** the M9 prelude (extents read `U`/`W`), the rest with plan §11 #26. **Displaces:** nothing.

### R7. The program checks the manuals make certain

- **What:** add to WP9.4, each data-driven: Fanuc — `%` inside a comment, a program reaching `%` without its end code, a word over eight digits, `G65` sharing its block, `DO`/`END` numbers, the `M29` rules, the 5-axis modal-state rules; Klartext — a tool call or `M91`/`M92` while TCPM is on, a cycle call with no cycle defined, `PLANE` without `MOVE`/`TURN`/`STAY`, codes a TNC 640 refuses; Sinumerik — a cut after `G332` without a new `S`, `G75` under compensation, `G291`; Okuma — the `G137`/`G138`/`G140` rules and the two-turret spindle rule. Drop the planned Okuma "T not 4 or 6 digits" error.
- **Why:** each one is an alarm on the machine that a line-based check finds for free; the dropped one would flag every correct machining-centre program and every lathe with 200 offsets.
- **Size:** S each. **Where:** M9 WP9.4. **Displaces:** the one dropped check.

### R8. Address arithmetic that knows where absolute positions hide

- **What:** a parameter role "absolute position (on the tool axis)" in the database, so a Z shift moves Klartext `Q203`, `CYCL CALL POS` and Sinumerik `RTP`/`RFP`/`DP`, `CYCLE800` reference points and `=AC()` centres, or refuses and lists every such call; skip and report machine-coordinate blocks (`M91`, `M92`, `G75`, `SUPA`); refuse inside a tilted frame and on simultaneous rotary moves without a TCP mode (one of the owner's 5-axis programs moves A and C in every feed block without one).
- **Why:** the daily lathe task of M11 is a Z shift; on Klartext and Sinumerik the hole depth sits inside the cycle call, so a shift that moves only the `L`/`G1` words drills every hole off by the shift.
- **Smallest useful version:** the role on the drilling cycles and "refuse and list".
- **Size:** M. **Where:** the M11 prelude (contract) and WP11.4, with WP9.5 reading the same role for hole bottoms. **Displaces:** nothing; without it the feature is a scrap risk on two dialects.

### R9. An Okuma machining-centre profile

**The guard is done, 2026-09-27; the profile still waits.**

- **What:** `okuma-mill` extending `okuma-osp`: `M6` tool changes with a preselect, no diameter, five-digit block numbers, a small database.
- **Why:** four of the owner's five Okuma programs are machining-centre programs; today they show no tool changes and lathe meanings in hover.
- **Smallest useful version:** now, only the detection guard of R1; the profile once a programming manual for the machining-centre control is available.
- **Size:** S guard, M profile. **Where:** the guard with R1; the profile in Phase 3 or when the manual arrives. **Displaces:** nothing.
- **Done:** the guard (R1's `G15 H`/`G16 H`/`G56 H` rule) is implemented, so the three owner machining-centre programs open as Okuma. The profile itself — a milling-aware code database and tool rule for those controls — is still open; it still reads as a lathe otherwise.

### R10. Scaling policy from the real programs

**The tapping part is done, 2026-09-27.**

- **What:** refuse to scale the speed of a tapping block and report it (the pending decision); report, not scale, an `F` under a G code the database does not know; read `M128 F`, `M140 … F`, a `PLANE … F` and cycle 19's `F` as that function's feed, not the path feed; later, scale Klartext feeds defined once as Q parameters (the manual recommends that form to post writers).
- **Why:** three dialects of real output tap with a scaled speed; a builder's tapping cycle had its lead scaled.
- **Size:** S (the Q-parameter feeds M). **Where:** TODO Next up and the "Tapping speed" decision; Q feeds in the backlog. **Displaces:** nothing.
- **Done:** the tapping-speed refusal is implemented (`dec/scaling`, owner decision 1), and extended to codes that tap on another kind of machine (Okuma `G84`/`G88`, the Fanuc lathe's `G74`, `CodeEntry.tappingElsewhere`) by the NC review's fix; an `F` under a G code the database does not know is now reported, not scaled, too (`dec/scaling`, TODO Next up 8). **Still open:** the function-feed reading of `M128 F`/`M140 F`/`PLANE F`/cycle 19's `F`, and the Q-parameter feeds.

### Not proposed

A backplot or kinematics of any kind, NURBS evaluation, real-time macros, an older program-format mode, Heidenhain turning cycles, a built-in profile for a builder's EIA/ISO mode (a user profile after M12 covers it), builder cycles and M codes, and multi-tasking turning-centre tool words unless the owner has such a machine. An "open the called program" command (`EXTCALL`, `CALL PGM`, `M98 <NAME>`) is a fair Phase 3 candidate, not a Phase 2 one.

### If the owner accepts all of them

The Phase 2 order stays M9 → M10 → M11 → M12. R1 and R10 joined the "Next up" list, and R2 the M9 prelude, on 2026-09-27; R3 (contract), R4's remaining parts and R6 (`U`/`W`, tool word) still go into the M9 prelude; R7 into WP9.4; R5 into the M10 prelude; R8 into the M11 prelude; R9's profile and the Q-parameter feeds into Phase 3. The M9 prelude grows by about a week of part-time work, and the regex help page is the one M9 item that could move to M12 to make room.

## 6. The re-review of the M8 fixes

TODO asked for it; both lenses ran against the fixes after M8 integration B. The `continuationStart` contract, its `^` check and `prime_tracker(first)` work as intended apart from the points below, which are in TODO.

**Status 2026-09-27:** both medium findings and the medium–high one are fixed, as part of the decision batch's integration (`dec/int`) and the NC review that followed it (`dec/int`'s own fix commits, findings NC1–NC8). Of the low findings, the `$` handling of scale speed and the tool list now has tests and the blank-after-`$` gap itself is fixed; LAP shape `E` feeds are now reported; the map no longer shows a masked comment in a `NEND` line as blanks; Sinumerik `SVC=` is now scaled (under "Also scale constant surface speeds") and reported otherwise. Still open: the `^` check on `continuationStart` can be bypassed (user profiles, M12); a thread in a Sinumerik program still triggers a second full tokenizer pass; renumbering still protects `$` lines only through the editable skip list, never through `continuationStart`.

- **Medium — fixed:** scale feed on a selection that starts inside a modal `MCALL CYCLE840` scales the next tap's lead, with no finding (the whole-document run keeps it). `lead_carriers` now walks the lines above the selection (`dec/scaling`).
- **Medium — fixed:** an Okuma `$` line counts as a continuation only when a blank follows the `$`, so the lead on `$H…` is scaled; the manuals require no blank. `continuationStart` now tells a continuation from the `$NAME.MIN%` header by the `%` (`dec/int`).
- **Medium–high — fixed:** the Okuma `G180`–`G189` detect rule went from weight 3 to 100, so a Fanuc lathe program that calls a builder macro by such a G number opens as Okuma, and renumbering then leaves its `G71 P/Q` pointing at old numbers. The weight is 3 again (`dec/detect`, R1).
- **Low:** the `^` check on `continuationStart` can be bypassed (user profiles, M12) — open; the `$` handling of scale speed and the tool list has no test — **fixed**, new goldens `scale_feed`/`scale_speed`/`okuma-continued-block`, `tool_list/okuma-dollar-continuation`; a thread in a Sinumerik program triggers a second full tokenizer pass — open; renumbering protects `$` lines only through the editable skip list — open; LAP shape `E` feeds are neither scaled nor reported — **fixed**, reported (`dec/scaling`); the map shows a masked comment in a `NEND` line as blanks — **fixed**, `displayText` recovers the real text (`dec/tools`); Sinumerik `SVC=` is neither scaled nor reported — **fixed**, follows the surface-speed option (`dec/scaling`).

## 7. Owner questions

What the manuals answered for the controls in general has moved out of TODO's "Machine facts"; what only the owner's machines can decide stays there, sharper than before. New questions from this review are there too: how many tool offsets each Okuma lathe has, which Okuma machines are machining centres and what their control is, which Sinumerik machines run ISO mode, and the control generation and software number of each Heidenhain machine. The `T` format of the lathe post that writes five digits is answered (2026-09-27: 3-digit tool + 2-digit offset); what is still open of that question is only the 1–2-digit short `T` word (D49, `phase-2-implementation.md` §10.2).
