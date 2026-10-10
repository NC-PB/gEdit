#!/usr/bin/env python3
"""Writes the inputs of tests/fixtures/exit2/ byte-exact (phase 2 plan §2.2, §6 M13 H13).

Run from the repository root:

    python3 tests/fixtures/exit2/gen-exit2.py .

It writes the programs, the user profile and code files and the two report scripts. The
goldens under ``expected/`` and ``expected-nopython/`` are **not** written here: they are
what gEdit's own code makes of these inputs (the TypeScript core and the bundled Python
scripts, run once by H13a and checked by hand against the criterion, README "How the
goldens were made"), and they are committed as they came out. Change a program here and
the goldens that read it have to be made and checked again.

Every program is synthetic: written for gEdit from the syntax notes in
``docs/planning/syntax/``, in our own words, and not meant to run on a machine.
"""

import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
OUT = os.path.join(ROOT, "tests", "fixtures", "exit2")

MARK = "(WRITTEN FOR GEDIT - SYNTHETIC EXIT-CRITERIA PROGRAM, NOT FOR A MACHINE)"
MARK_SEMI = "; WRITTEN FOR GEDIT - SYNTHETIC EXIT-CRITERIA PROGRAM, NOT FOR A MACHINE"

# =========================================================================== X1 Fanuc lathe

# G-code system A, CRLF (the line ending a post writes for a control). A shaft: rough and
# finish along one profile with the two-block G71 and G70, the finish on the same station
# with its second offset (T0111), an edge break in a subprogram called with M98 that
# returns with M99 P300 to block N300 of the caller, then a M20x1.5 thread three ways: the
# two-block G76, a G92 pass list and one G32 pass. T0100 and T0300 cancel the offset on
# the retract blocks and are no tool change. The subprogram stands first in the file. The
# tool list walks the text and cannot follow a call; since the M13 review (NC-4) a
# subprogram behind M30 is no longer charged to the main program's last tool either, it
# starts with no tool, and this order is kept so the goldens stay comparable.
FANUC_LATHE_A = [
    MARK,
    "%",
    "O3102 (EDGE BREAK ON THE D40 SHOULDER)",
    "G00 X37. Z-48.",
    "G01 Z-50. F0.08",
    "X38.",
    "U2. W-1.",
    "G00 U6.",
    "M99 P300",
    "O3101 (EXIT2 SHAFT - SYSTEM A)",
    "(T0101  OD ROUGH 80 DEG)",
    "(T0111  OD FINISH, STATION 1 WITH ITS SECOND OFFSET)",
    "(T0303  THREAD M20X1.5)",
    "G21 G40 G99",
    "G28 U0 W0",
    "T0101 (OD ROUGH)",
    "G50 S2400",
    "G96 S200 M03",
    "M08",
    "G00 X46. Z2.",
    "G71 U1.5 R0.5",
    "G71 P100 Q180 U0.4 W0.1 F0.25",
    "N100 G00 X17.",
    "N110 G01 Z0. F0.12",
    "N120 X20. Z-1.5",
    "N130 Z-25.",
    "N140 X28.",
    "N150 X30. W-1.",
    "N160 Z-50.",
    "N170 X40.",
    "N175 W-15.",
    "N180 X46.",
    "G00 X100. Z100. T0100",
    "T0111 (OD FINISH)",
    "G96 S240 M03",
    "G00 X46. Z2.",
    "G70 P100 Q180",
    "M98 P3102 (EDGE BREAK)",
    "N300 G00 X100. Z100. T0100",
    "M09",
    "T0303 (THREAD)",
    "G97 S1000 M03",
    "M08",
    "G00 X24. Z5.",
    "G76 P020060 Q80 R0.05",
    "G76 X18.16 Z-22. P920 Q300 F1.5",
    "G00 X24. Z5.",
    "G92 X19.3 Z-22. F1.5",
    "X18.9",
    "X18.6",
    "X18.4",
    "X18.16",
    "G00 X18.16 Z5.",
    "G32 Z-22. F1.5",
    "G00 X24.",
    "Z5.",
    "G00 X100. Z100. T0300",
    "M09",
    "M05",
    "G28 U0 W0",
    "M30",
    "%",
]

# G-code system B, LF. A bush: the clamp is G92 S, the power-on feed mode G95 is written
# out, the thread is cut with the G78 single cycle (system B's G92), no U or W anywhere —
# whether they move incrementally in system B is the machine's business (syntax-fanuc.md
# §4.1), so this program does not depend on it.
FANUC_LATHE_B = [
    MARK,
    "%",
    "O3201 (EXIT2 BUSH - SYSTEM B)",
    "G21 G40 G90 G95",
    "G00 X150. Z150.",
    "T0101 (OD ROUGH)",
    "G92 S2200",
    "G96 S180 M03",
    "M08",
    "G00 X52. Z2.",
    "G71 U1.5 R0.5",
    "G71 P100 Q150 U0.4 W0.1 F0.28",
    "N100 G00 X25.",
    "N110 G01 Z0. F0.12",
    "N120 X30. Z-2.5",
    "N130 Z-30.",
    "N140 X44.",
    "N150 X52. Z-34.",
    "G70 P100 Q150",
    "G00 X150. Z150. T0100",
    "M09",
    "T0202 (THREAD M30X2)",
    "G97 S900 M03",
    "M08",
    "G00 X34. Z6.",
    "G78 X29.4 Z-24. F2.0",
    "X28.9",
    "X28.5",
    "X28.15",
    "X27.85",
    "X27.55",
    "G00 X150. Z150. T0200",
    "M09",
    "M05",
    "M30",
    "%",
]

# =========================================================================== X2 Okuma, Sinumerik

# Okuma OSP turning, LF, with the $NAME.MIN% transfer header first. Six-digit T words for
# the rough, the finish and the thread tool, a four-digit one for the groove tool (the
# finish tool cuts under G42, whose nose radius comes from the six-digit T's last pair,
# M13 review NC-12); a
# G04 F dwell at the groove bottom; the driven tool's SB= in the block after the main
# spindle's S was stopped; the G71 thread cycle, whose F is the lead.
OKUMA_LATHE = [
    "$EXIT2-OKUMA.MIN%",
    MARK,
    "O2201",
    "(SPINDLE NOSE D80 - FOUR AND SIX DIGIT T WORDS)",
    "N1 (FACE AND OD ROUGH)",
    "G50 S2400",
    "G00 X600 Z400",
    "T010101",
    "G96 S200 M03 M42",
    "G00 X84 Z3 M08",
    "G95 G01 Z0.2 F0.25",
    "X-1.6 F0.18",
    "G00 Z3",
    "X76",
    "G01 Z-45 F0.28",
    "X84",
    "G00 X600 Z400 M09",
    "N2 (OD FINISH)",
    "T030303",
    "G96 S240 M03",
    "G42 G00 X70 Z2 M08",
    "G01 Z0 F0.12",
    "X74 Z-2",
    "Z-45",
    "G40 G00 X84 Z2 M09",
    "G00 X600 Z400",
    "N3 (GROOVE D66 WITH A DWELL)",
    "T0909",
    "G97 S700 M03",
    "G00 X78 Z-30 M08",
    "G01 X66 F0.06",
    "G04 F0.5",
    "G00 X78",
    "G00 X600 Z400 M09",
    "N4 (THREAD M74X2)",
    "T050505",
    "G97 S600 M03",
    "G00 X78 Z8 M08",
    "G71 X71.55 Z-26 B60 D0.7 U0.1 H1.22 L2 F2 M23 M32 M73",
    "G00 X600 Z400 M09",
    "M05",
    "N5 (FOUR HOLES D6 ON THE FACE - DRIVEN TOOL)",
    "M110",
    "M146",
    "T001111",
    "G94",
    "SB=2400 M13",
    "G00 X50 Z5 C0",
    "G181 X50 Z-8 C0 K3 F100 E0.3",
    "C90",
    "C180",
    "C270",
    "G180",
    "G00 X600 Z400",
    "M12",
    "M147",
    "M109",
    "G95",
    "M02",
    "%",
]

# Sinumerik 840D turning, LF, with the %_N_..._MPF transfer header first and its ;$PATH=
# line right behind it, as the control writes them (the marker is the third line). Diameter
# programming is never written: the profile assumes DIAMON (D35). Halfway, DIAMOF switches
# to radius programming for a face groove, and the thread after it is written in radius
# values too (X21.7 is a diameter of 43.4, X21.08 the core diameter 42.16 of M44x1.5).
# T="ROUGH" D1 and T1 D1 name tools two ways; LIMS= clamps each surface speed; the thread
# is three G33 passes whose K is the lead. The last pass carries the feed of the retract
# after it (F0.15): a G33 block's F is no lead and not the thread's feed, so scale feed
# leaves it and says why.
SINUMERIK_LATHE = [
    "%_N_EXIT2_SHAFT_MPF",
    ";$PATH=/_N_WKS_DIR/_N_EXIT2_WPD",
    MARK_SEMI,
    "; SHAFT D44 - DIAMETER PROGRAMMING ASSUMED, NEVER WRITTEN",
    "N10 G18 G90 G95 G40 G500",
    "N20 G54",
    "N30 MSG(\"OD ROUGH\")",
    "N35 T=\"ROUGH\" D1",
    "N40 G96 S180 LIMS=2800 M4",
    "N50 G0 X54 Z2 M8",
    "N60 G1 Z0.2 F0.25",
    "N70 X-1.6 F0.18",
    "N80 G0 Z2",
    "N90 X46",
    "N100 G1 Z-40 F0.28",
    "N110 X54",
    "N120 G0 X200 Z200 M9",
    "N125 MSG(\"OD FINISH\")",
    "N130 T1 D1",
    "N140 G96 S220 LIMS=3200 M4",
    "N150 G0 X40 Z2 M8",
    "N160 G42 G1 Z0 F0.15",
    "N170 X44 Z-2",
    "N180 Z-40",
    "N190 G40 G0 X54",
    "N200 X200 Z200 M9",
    "; FROM HERE ON X IS A RADIUS",
    "N210 DIAMOF",
    "N215 MSG(\"FACE GROOVE\")",
    "N220 T2 D1",
    "N230 G96 S150 LIMS=2500 M4",
    "N240 G0 X14 Z2 M8",
    "N250 G1 Z-3 F0.06",
    "N260 G0 Z2",
    "N270 X100 Z100 M9",
    "N275 MSG(\"THREAD M44X1.5\")",
    "N280 T=\"THREAD_M44\" D1",
    "N290 G97 S700 M4",
    "N300 G0 X24 Z5 M8",
    "N310 X21.7",
    "N320 G33 Z-30 K1.5 SF=0",
    "N330 G0 X24",
    "N340 Z5",
    "N350 X21.4",
    "N360 G33 Z-30 K1.5 SF=0",
    "N370 G0 X24",
    "N380 Z5",
    "N390 X21.08",
    "N400 G33 Z-30 K1.5 SF=0 F0.15",
    "N410 G1 X24",
    "N420 X100 Z100 M9",
    "N425 MSG()",
    "N430 M5",
    "N440 M30",
]



# =========================================================================== X6 search

# Three short Fanuc mill programs to search across. T1 is called in A and, written T01, in
# C; T10 (A) and T12 (B) begin with the same digits and are not T1; three comments name
# T1 or T10 and are no tool word. The speeds are S1800 and S2400 (A), S2000 (B, the
# boundary) and S2001 (C). M8 is written four times: twice in A, once in B and in C.
SEARCH_A = [
    MARK,
    "%",
    "O5101 (SEARCH A - FACE AND DRILL)",
    "(T1  FACE MILL D50)",
    "(T10 DRILL D6.8)",
    "G21 G17 G40 G49 G80 G90",
    "T1 M6",
    "G0 G54 X-30. Y0. S1800 M3",
    "G43 H1 Z50. M8",
    "Z5.",
    "G1 Z-1. F500.",
    "X130.",
    "G0 Z50. M9",
    "T10 M6",
    "G0 G54 X20. Y20. S2400 M3",
    "G43 H10 Z50. M8",
    "G81 G98 Z-12. R2. F150.",
    "X80.",
    "G80",
    "M5",
    "G91 G28 Z0.",
    "M30",
    "%",
]

SEARCH_B = [
    MARK,
    "%",
    "O5102 (SEARCH B - POCKET)",
    "(T12 END MILL D12)",
    "G21 G17 G40 G49 G80 G90",
    "T12 M6",
    "G0 G54 X0. Y0. S2000 M3",
    "G43 H12 Z50. M8",
    "Z2.",
    "G1 Z-4. F200.",
    "X40. F600.",
    "Y30.",
    "X0.",
    "Y0.",
    "G0 Z50. M9",
    "M5",
    "G91 G28 Z0.",
    "M30",
    "%",
]

SEARCH_C = [
    MARK,
    "%",
    "O5103 (SEARCH C - CHAMFER)",
    "(T1 CHAMFER MILL D10, WRITTEN T01 BELOW)",
    "G21 G17 G40 G49 G80 G90",
    "T01 M6",
    "G0 G54 X-5. Y-5. S2001 M3",
    "G43 H01 Z50. M8",
    "Z2.",
    "G1 Z-1. F300.",
    "X45.",
    "Y35.",
    "X-5.",
    "Y-5.",
    "G0 Z50. M9",
    "M5",
    "G91 G28 Z0.",
    "M30",
    "%",
]


# =========================================================================== X8 checks

# Four programs that are deliberately wrong: each holds one finding of every kind the
# program checks report on its dialect, one at a time on lines of their own, and one
# number written without a point whose value depends on the machine. Every defect is
# named in a comment on its line or the line above, in our words. They are not programs
# anybody should run; they are what a careless edit or the wrong post leaves behind.

CHECKS_MILL = [
    MARK,
    "%",
    "O6101 (CHECKS - MILL)",
    "(T1 FACE MILL D50, T2 DRILL D8.5, T3 TAP M10)",
    "G21 G17 G40 G49 G80 G90 G94",
    "T1 M6",
    "S2000 M3",
    "G0 G54 X-30. Y0.",
    "G43 Z25. H1 M8",
    "G1 Z-1. F500.",
    "(NEXT: AN X WITHOUT A POINT, 50 MM OR 0.05 MM DEPENDING ON THE MACHINE)",
    "X50",
    "X130.",
    "M5",
    "(NEXT: A CUT WITH THE SPINDLE STOPPED)",
    "Y40.",
    "G0 Z25. M9",
    "T2 M6",
    "G0 X20. Y20.",
    "G43 Z25. H2 M8",
    "(NEXT: THE FIRST CUT OF T2, AND NO SPINDLE START SINCE THE CHANGE)",
    "G81 G98 Z-15. R2. F120.",
    "X80.",
    "(NEXT: A TOOL CHANGE WHILE G81 IS STILL IN FORCE)",
    "T3 M6",
    "G80",
    "S500 M3",
    "G0 X20. Y20.",
    "G43 Z25. H3",
    "M29 S500",
    "(NEXT: A MOVE BETWEEN M29 AND THE TAPPING CYCLE)",
    "G0 X25.",
    "G84 Z-12. R2. F750.",
    "(NEXT: G43.4 WHILE THE TAPPING CYCLE IS IN FORCE)",
    "G43.4 H3",
    "G80",
    "(NEXT: G65 WITH A G CODE IN FRONT OF IT)",
    "G0 G65 P9010 A1.",
    "#1=0",
    "(NEXT: A LOOP THAT IS NEVER CLOSED)",
    "WHILE [#1 LT 3] DO1",
    "#1=#1+1",
    "(NEXT: A JUMP TO A BLOCK THAT DOES NOT EXIST)",
    "GOTO 900",
    "(NEXT: TWO SPEEDS IN ONE BLOCK)",
    "S1000 S1200 M3",
    "(NEXT: MORE DIGITS THAN THE CONTROL STORES)",
    "G0 X123456.789",
    "(STEP OVER 50% OF THE CUTTER)",
    "G0 Z50. (RETRACT, THE COMMENT IS NOT CLOSED",
    "#2=[#1+1",
    "g0 x0. y0.",
    "(NEXT: AN EN DASH PASTED IN FOR A MINUS)",
    "G0 Z–5.",
    "M0 (CHECK THE PART)",
    "M1",
    "M30",
    "(NEXT: CODE AFTER THE END)",
    "G0 X0. Y0.",
    "%",
]

CHECKS_LATHE = [
    MARK,
    "%",
    "O6202 (A SUBPROGRAM THE PROFILE CALLS)",
    "G01 W-1. F0.1",
    "M99",
    "O6201 (CHECKS - LATHE)",
    "G21 G40 G99",
    "T0101 (OD ROUGH)",
    "(NEXT: CONSTANT SURFACE SPEED WITH NO G50 S CLAMP BEFORE IT)",
    "G96 S200 M03",
    "G00 X52. Z2.",
    "G71 U1.5 R0.5",
    "G71 P100 Q200 U0.4 W0.1 F0.25",
    "N100 G00 X20.",
    "N110 G01 Z-20. F0.15",
    "(NEXT: A SUBPROGRAM CALL INSIDE THE PROFILE)",
    "N120 M98 P6202",
    "N200 X52.",
    "(NEXT: Q300 NAMES NO BLOCK)",
    "G70 P100 Q300",
    "G00 X100. Z100. T0100",
    "G00 X50. Z2.",
    "(NEXT: A CUT AFTER T0100 CANCELLED THE OFFSET)",
    "G01 Z-10. F0.2",
    "G00 X56.",
    "(NEXT: A Z WITHOUT A POINT, 2000 MM OR 2 MM DEPENDING ON THE MACHINE)",
    "G00 Z2000",
    "T0303 (THREAD)",
    "G96 S150 M03",
    "G00 X24. Z5.",
    "(NEXT: A THREAD CUT UNDER CONSTANT SURFACE SPEED)",
    "G92 X19.4 Z-18. F1.5",
    "X19.",
    "G00 X100. Z100. T0300",
    "(NEXT: A TILTED PLANE WHILE CONSTANT SURFACE SPEED IS ON)",
    "G68.2 X0. Y0. Z0. I0. J90. K0.",
    # B1 fix NC (NC-02): on the lathe G69 ends only the turret mirror image; the tilted plane ends with G69.1.
    "G69.1",
    "T0404 (OD FINISH)",
    "G97 S800 M03",
    "G00 X30. Z2.",
    "G01 Z-5. F0.1",
    "W-2.",
    "G00 X100. Z100. T0400",
    "T0505 (TAP M8 ON THE FACE)",
    "G97 S300 M03",
    "M29 S300",
    "(NEXT: A MOVE BETWEEN M29 AND THE TAPPING CYCLE)",
    "G00 X0. Z5.",
    "G84 Z-12. F1.25",
    "(NEXT: A TOOL CALL WHILE G84 IS STILL IN FORCE)",
    "T0606",
    "G80",
    "G00 X100. Z100. T0600",
    "(NEXT: A SIX-DIGIT TOOL WORD THE MACHINE'S FORMAT DOES NOT DESCRIBE)",
    "T010101",
    "(NEXT: TWO TOOL WORDS IN ONE BLOCK)",
    "T0202 T0303",
    "M05",
    "(NEXT: A CUT WITH THE SPINDLE STOPPED)",
    "G01 X40. F0.1",
    "(NEXT: G65 WITH A G CODE IN FRONT OF IT)",
    "G00 G65 P9010 A1.",
    "#1=0",
    "(NEXT: A LOOP THAT IS NEVER CLOSED)",
    "WHILE [#1 LT 3] DO1",
    "#1=#1+1",
    "(NEXT: A JUMP TO A BLOCK THAT DOES NOT EXIST)",
    "GOTO 900",
    "(NEXT: MORE DIGITS THAN THE CONTROL STORES)",
    "G00 X123456.789",
    "(FEED 100% FROM HERE)",
    "G00 X100. (RETRACT, THE COMMENT IS NOT CLOSED",
    "#2=[#1+1",
    "g00 z100.",
    "(NEXT: AN EN DASH PASTED IN FOR A MINUS)",
    "G00 Z–5.",
    "M00 (CHECK THE PART)",
    "M01",
    "M30",
    "(NEXT: CODE AFTER THE END)",
    "G00 X100. Z100.",
    "%",
]

CHECKS_OKUMA = [
    "$CHECKS-OKUMA.MIN%",
    MARK,
    "(NEXT: THE PROGRAM NAME SHARES ITS BLOCK)",
    "O6301 G50",
    "(WRITTEN FOR A 1 UM MACHINE: X60000 IS 60 MM, F250 IS 0.25 MM PER REV)",
    "N1 (OD ROUGH)",
    "(NEXT: A SEQUENCE NAME WITH NO SPACE BEHIND IT)",
    "N100G00 X600000 Z400000",
    "T010101",
    "(NEXT: CONSTANT SURFACE SPEED WITH NO G50 S CLAMP BEFORE IT)",
    "G96 S200 M03",
    "G00 X64000 Z2000 M08",
    "G95 G01 Z-40000 F250",
    "(NEXT: G96 WITHOUT AN S)",
    "G96",
    "(NEXT: G140 WHILE CONSTANT SURFACE SPEED IS ON)",
    "G140",
    "G00 X600000 Z400000 M09",
    "N2 (THREAD M60X2)",
    "(NEXT: A FOUR-DIGIT TOOL WORD AFTER A SIX-DIGIT ONE)",
    "T0303",
    "G96 S120 M03",
    "G00 X64000 Z8000",
    "(NEXT: A THREAD CUT UNDER CONSTANT SURFACE SPEED)",
    "G33 X59400 Z-30000 F2000",
    "G00 X600000 Z400000",
    "M05",
    "(NEXT: A CUT WITH THE SPINDLE STOPPED)",
    "G01 X60000 F200",
    "G00 X600000",
    "(NEXT: TWO SPEEDS IN ONE BLOCK)",
    "G97 S500 M03 S600",
    "N3 (FOUR HOLES ON THE FACE - DRIVEN TOOL)",
    "(NEXT: M110 SHARES ITS BLOCK)",
    "M05 M110",
    "T001111",
    "G94",
    "SB=2000 M13",
    "G00 X50000 Z5000 C0",
    "G181 X50000 Z-8000 C0 K3000 F1200 E50",
    "C90000",
    "(NEXT: A TOOL CALL WHILE G181 IS STILL IN FORCE)",
    "T001212",
    "G180",
    "M12",
    "M109",
    "G95",
    "(NEXT: NINE M CODES IN ONE BLOCK)",
    "M03 M08 M10 M11 M24 M25 M41 M42 M73",
    "(NEXT: A JUMP TO A SEQUENCE NAME THAT DOES NOT EXIST)",
    "GOTO NEND2",
    "G00 X600000 (RETRACT, THE COMMENT IS NOT CLOSED",
    "VC1=[VC2+1",
    "g00 z400000",
    "(NEXT: AN EN DASH PASTED IN FOR A MINUS)",
    "G00 Z\u20135000",
    "M00 (CHECK THE PART)",
    "M01",
    "NEND M02",
    "(NEXT: CODE AFTER THE END)",
    "G00 X600000",
    "%",
]

CHECKS_SINUMERIK = [
    "%_N_CHECKS_MPF",
    ";$PATH=/_N_WKS_DIR/_N_CHECKS_WPD",
    MARK_SEMI,
    "G18 G90 G95 G40 G500",
    "T=\"ROUGH\" D1",
    "; NEXT: CONSTANT SURFACE SPEED WITH NO LIMS= BEFORE IT",
    "G96 S200 M4",
    "G0 X54 Z2 M8",
    "G1 Z-40 F0.25",
    "G0 X200 Z200 M9",
    "T=\"THREAD_M44\" D1",
    "G96 S120 M4",
    "G0 X48 Z5",
    "; NEXT: A THREAD CUT UNDER CONSTANT SURFACE SPEED",
    "X43.4",
    "G33 Z-30 K1.5 SF=0",
    "G0 X200 Z200",
    "T=\"TAP_M8\" D1",
    "G97 S500 M3",
    "G0 X0 Z5",
    "SPOS=0",
    "G331 Z-15 K1.25 S500",
    "G332 Z5 K1.25",
    "; NEXT: A CUT AFTER G332 WITH NO NEW SPEED",
    "G1 Z2 F0.1",
    "G0 X200 Z200",
    "T=\"DRILL_8\" D1",
    "; NEXT: TWO SPEEDS IN ONE BLOCK",
    "S1200 S1500 M3",
    "G0 X0 Z5",
    "MCALL CYCLE83(10,0,2,-20,,,5,,,,,1)",
    "Z4",
    "; NEXT: A TOOL CHANGE WHILE THE MODAL CALL IS IN FORCE",
    "T=\"ROUGH\" D1",
    "G42 G1 X40 Z2 F0.2",
    "; NEXT: G75 WHILE RADIUS COMPENSATION IS ON",
    "G75 X0",
    "G40 G0 X200",
    "; NEXT: THE ISO DIALECT SWITCHED ON",
    "G291",
    "G290",
    "M5",
    "; NEXT: A CUT WITH THE SPINDLE STOPPED",
    "G1 X60 F0.2",
    "; NEXT: A JUMP TO A LABEL THAT DOES NOT EXIST",
    "GOTOF NOWHERE",
    "R1=(R2+3",
    "g0 x200",
    "; NEXT: AN EN DASH PASTED IN FOR A MINUS",
    "G0 Z–10",
    "M0",
    "M1",
    "; NEXT: THE MODAL CALL IS STILL ON AT THE END",
    "M30",
    "; NEXT: CODE AFTER THE END",
    "G0 X200",
]


# =========================================================================== X9 user profile

# A turning program in the folder the user profile `exit2-lathe` names (detect.folders).
# M13 is the shop's own code: the user code file `exit2-lathe` describes it, no built-in
# Fanuc database does. Block numbers on the G71 profile only, as a post writes them.
PART_17 = [
    MARK,
    "%",
    "O1717 (PART 17 - PIN D20)",
    "G21 G40 G99",
    "G28 U0 W0",
    "M13",
    "T0101 (OD ROUGH)",
    "G50 S2500",
    "G96 S190 M03",
    "M08",
    "G00 X30. Z2.",
    "G71 U1.2 R0.5",
    "G71 P100 Q140 U0.4 W0.1 F0.22",
    "N100 G00 X16.",
    "N110 G01 Z0. F0.1",
    "N120 X20. Z-2.",
    "N130 Z-28.",
    "N140 X30.",
    "G70 P100 Q140",
    "G00 X100. Z100. T0100",
    "M09",
    "M05",
    "G28 U0 W0",
    "M30",
    "%",
]

# The user files, written as a user would write them (two-space JSON). `{{SHOP}}` is the
# folder the run copies `shop/` to; the run puts the absolute path in before it writes the
# file to <config>/profiles/.
USER_PROFILE = """{
  "id": "exit2-lathe",
  "extends": "fanuc-lathe",
  "name": "Exit2 lathe (user profile)",
  "shortName": "Exit2 T",
  "codes": "exit2-lathe",
  "detect": {
    "folders": ["{{SHOP}}"]
  },
  "numbering": {
    "step": 5
  }
}
"""

# One wrong field: a step has to be a number.
USER_PROFILE_BROKEN = """{
  "id": "exit2-broken",
  "extends": "fanuc-lathe",
  "name": "Exit2 broken (user profile)",
  "shortName": "Exit2 X",
  "numbering": {
    "step": "five"
  }
}
"""

USER_CODES = """{
  "dialect": "exit2-lathe",
  "version": 1,
  "extends": "fanuc-lathe",
  "codes": [
    {
      "code": "M13",
      "label": "Chip conveyor on",
      "description": "Starts the chip conveyor. A code of the machine builder on the lathes of this shop, described in the shop's own code file; another lathe may use another code for it, or none."
    }
  ]
}
"""


# =========================================================================== X11 decimal points

# G-code system B, LF. The same kind of word with and without a point: on a machine that
# reads a point-less number in increments of 0.001 mm (IS-B) this is a sensible facing
# pass (Z1000 is 1 mm in front of the face, X50 faces to 0.05 mm, W-2000 is 2 mm); read
# as written (calculator input) the same words are 1000 mm, 50 mm and 2000 mm. F155 is a
# feed per minute (G94), which every Fanuc preset reads as written.
DECIMAL_LATHE = [
    MARK,
    "%",
    "O3301 (DECIMAL POINTS - THE MACHINE DECIDES)",
    "(WITHOUT A POINT Z1000 IS 1 MM IN INCREMENTS OF 0.001 MM, 1000 MM AS WRITTEN)",
    "G21 G40 G90 G95",
    "G00 X150. Z150.",
    "T0101 (FACE AND TURN)",
    "G92 S2500",
    "G96 S180 M03",
    "G00 X52. Z10.",
    "G01 Z1000 F0.15",
    "G94 Z0. F155",
    "X50",
    "X50.",
    "W-2000",
    "G95 W-5. F0.15",
    "G00 X150. Z150. T0100",
    "M05",
    "M30",
    "%",
]


# =========================================================================== X12 channels

# Two channels of a twin-turret lathe in one file. The program numbers mark the sections:
# O1xxx is channel 1 (the upper turret), O2xxx channel 2 (the lower one); they alternate
# over four sections, and both channels call the subprogram O9001, which is no channel's.
# Wait codes are M100-M199 (a builder's range, written for gEdit): with the machine
# "Twin 31i" each waits for both channels; with "Twin 31i lines" the P word names the
# channels (P12, P21, P123). Defects, each on purpose: M150 only in channel 1 (its
# partner is missing), M160 only in channel 2 (a wait nothing answers), M130 twice in
# channel 1 and once in channel 2 (the counts differ), M140/M141 in one order in channel 1
# and the other in channel 2 (a swapped pair), and M170 P123, which names a channel 3 the
# machine does not have (only a rule that reads the partners from the line can see it).
# M110 and M120 legitimately repeat: each is written in both channels as often, in order.
# Only the wait codes are designed: the motion is not a coherent job (both channels face
# with O9001 and command the main spindle between the same waits, which a real twin-turret
# program would not do), and the third line says so (M13 review NC-12).
TWIN_SINGLE = [
    MARK,
    "(TWO CHANNELS IN ONE FILE: O1XXX IS CHANNEL 1, O2XXX IS CHANNEL 2)",
    "(WAIT CODES M100-M199 - EVERY WAIT DEFECT ON PURPOSE - THE MOTION IS NOT COHERENT)",
    "%",
    "O1001 (UPPER - ROUGH)",
    "G21 G40 G99",
    "T0101 (OD ROUGH)",
    "G50 S2500",
    "G96 S200 M03",
    "M110 P12",
    "G00 X52. Z2. M08",
    "M98 P9001",
    "G01 Z-30. F0.25",
    "M120 P12",
    "G00 X56. Z2.",
    "M130 P12",
    "G01 Z-15. F0.25",
    "M130 P12",
    "G00 X100. Z100. M09",
    "M99",
    "O2001 (LOWER - CENTRE DRILL)",
    "G21 G40 G99",
    "T0202 (CENTRE DRILL)",
    "G97 S1500 M03",
    "M110 P21",
    "G00 X0. Z5. M08",
    "M98 P9001",
    "G01 Z-4. F0.08",
    "M120 P21",
    "G00 Z5.",
    "M130 P21",
    "G00 X100. Z100. M09",
    "M99",
    "O1002 (UPPER - FINISH)",
    "T0303 (OD FINISH)",
    "G96 S240 M03",
    "M140 P12",
    "G00 X48. Z2.",
    "M141 P12",
    "G01 Z-30. F0.12",
    "M150 P12",
    "G00 X100. Z100.",
    "M110 P12",
    "M170 P123",
    "M05",
    "M99",
    "O2002 (LOWER - DRILL D10)",
    "T0404 (DRILL D10)",
    "G97 S900 M03",
    "M141 P21",
    "G00 X0. Z5.",
    "M140 P21",
    "G01 Z-25. F0.1",
    "M160 P21",
    "G00 Z5. M09",
    "M110 P21",
    "M170 P21",
    "M05",
    "M30",
    "O9001 (SHARED - FACE PASS)",
    "G00 X56. Z0.5",
    "G01 X-1.6 F0.2",
    "G00 Z2.",
    "M99",
    "%",
]

# The same job as one file per channel, named so a pattern can pair them (twin_CH1.nc and
# twin_CH2.nc). Defects: M150 only in channel 1 and M160 only in channel 2, one row in each
# document; M110 and M120 pair as they should.
TWIN_CH1 = [
    MARK,
    "(CHANNEL 1 OF TWO - THE PAIR IS TWIN_CH1.NC AND TWIN_CH2.NC)",
    "%",
    "O4101 (UPPER TURRET)",
    "G21 G40 G99",
    "T0101 (OD ROUGH)",
    "G50 S2500",
    "G96 S200 M03",
    "M110 P12",
    "G00 X52. Z2. M08",
    "G01 Z-30. F0.25",
    "M120 P12",
    "T0303 (OD FINISH)",
    "G96 S240 M03",
    "G00 X48. Z2.",
    "G01 Z-30. F0.12",
    "M150 P12",
    "G00 X100. Z100. M09",
    "M05",
    "M30",
    "%",
]

TWIN_CH2 = [
    MARK,
    "(CHANNEL 2 OF TWO - THE PAIR IS TWIN_CH1.NC AND TWIN_CH2.NC)",
    "%",
    "O4201 (LOWER TURRET)",
    "G21 G40 G99",
    "T0202 (CENTRE DRILL)",
    "G97 S1500 M03",
    "M110 P21",
    "G00 X0. Z5. M08",
    "G01 Z-4. F0.08",
    "M120 P21",
    "T0404 (DRILL D10)",
    "G97 S900 M03",
    "G00 X0. Z5.",
    "G01 Z-25. F0.1",
    "M160 P21",
    "G00 Z5. M09",
    "M05",
    "M30",
    "%",
]

# =========================================================================== writing


def write(rel, data):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)
    print("%-44s %6d bytes" % (rel, len(data)))


def crlf(lines):
    return "".join(line + "\r\n" for line in lines).encode("ascii")


def lf(lines):
    return "".join(line + "\n" for line in lines).encode("ascii")


def lf8(lines):
    return "".join(line + "\n" for line in lines).encode("utf-8")


PROGRAMS = {
    "fanuc-lathe-a.nc": crlf(FANUC_LATHE_A),
    "fanuc-lathe-b.nc": lf(FANUC_LATHE_B),
    "okuma-lathe.MIN": lf(OKUMA_LATHE),
    "okuma-lathe.txt": lf(OKUMA_LATHE),
    "sinumerik-lathe.MPF": lf(SINUMERIK_LATHE),
    "sinumerik-lathe.txt": lf(SINUMERIK_LATHE),
    "search-a.nc": lf(SEARCH_A),
    "search-b.nc": lf(SEARCH_B),
    "search-c.nc": lf(SEARCH_C),
    "checks-mill.nc": lf8(CHECKS_MILL),
    "checks-lathe.nc": lf8(CHECKS_LATHE),
    "checks-okuma.MIN": lf8(CHECKS_OKUMA),
    "checks-sinumerik.MPF": lf8(CHECKS_SINUMERIK),
    "shop/part-17.nc": lf(PART_17),
    "decimal-lathe.nc": lf(DECIMAL_LATHE),
    "twin-single.nc": lf(TWIN_SINGLE),
    "twin_CH1.nc": lf(TWIN_CH1),
    "twin_CH2.nc": lf(TWIN_CH2),
    "user/profiles/exit2-lathe.json": USER_PROFILE.encode("ascii"),
    "user/profiles/exit2-broken.json": USER_PROFILE_BROKEN.encode("ascii"),
    "user/codes/exit2-lathe.json": USER_CODES.encode("ascii"),
}


# X5: the two programs of compare/x5-repost/, copied byte for byte under the names the
# exit criteria use (they are gEdit's own synthetic fixtures, compare/README.md).
COPIES = {
    "repost-old.nc": "tests/fixtures/compare/x5-repost/original.nc",
    "repost-new.nc": "tests/fixtures/compare/x5-repost/reposted.nc",
}


def main():
    for rel, data in PROGRAMS.items():
        write(rel, data)
    for rel, source in COPIES.items():
        with open(os.path.join(ROOT, source), "rb") as handle:
            write(rel, handle.read())


if __name__ == "__main__":
    main()
