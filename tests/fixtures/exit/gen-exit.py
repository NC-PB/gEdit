#!/usr/bin/env python3
"""Writes tests/fixtures/exit/** byte-exact. Run from the H5 worktree.

The goldens here are derived by hand from the transform and script rules and then
checked against a real app run (`m5-exit-criteria`); the scenario is the gate, this
file is how the bytes get into the repository without an editor touching them.
"""

import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
OUT = os.path.join(ROOT, "tests", "fixtures", "exit")

MARK = "(WRITTEN FOR GEDIT - SYNTHETIC EXIT-CRITERIA PROGRAM, NOT FOR A MACHINE)"
MARK_KT = "; WRITTEN FOR GEDIT - SYNTHETIC EXIT-CRITERIA PROGRAM, NOT FOR A MACHINE"

# --------------------------------------------------------------------------- A. Fanuc CP1252

FANUC_CP1252_IN = [
    MARK,
    "%",
    "O4001 (BRACKET – Ø10 MÜLLER)",
    "(T1 D10 END MILL)",
    "(T2 D8.5 DRILL)",
    "(T3 M10 TAP)",
    "",
    "N100 G21 G17 G40 G49 G80 G90 G94",
    "N105 T1 M6",
    "N110 S3000 M3 (ROUGH)",
    "N115 G0 X-60. Y-30.",
    "N120 G43 Z25. H1 M8",
    "N125 G1 Z-2. F250.",
    "N130 X60. F800.",
    "N135 Y30.",
    "N140 X-60.",
    "N145 Y-30.",
    "",
    "N150 G0 Z25. M9",
    "N155 T2 M6",
    "N160 S2400 M3",
    "N165 G0 X0. Y0.",
    "N170 G43 Z25. H2 M8",
    "N175 G81 Z-15. R2. F150.",
    "N180 X20. Y20.",
    "N185 G80",
    "N190 G0 Z25. M9",
    "",
    "N195 T3 M6",
    "N200 S400 M3",
    "N205 G0 X0. Y0.",
    "N210 G43 Z25. H3 M8",
    "N215 G84 Z-12. R5. F600. (M10 TAP)",
    "N220 G80",
    "N225 G0 Z25. M9",
    "N230 M30",
    "%",
]

# Remove empty lines, then remove comments (program name kept), then renumber with the
# profile defaults (start 10, step 10, one space after the number, %/O/( skipped).
FANUC_CP1252_OUT = [
    "%",
    "O4001 (BRACKET – Ø10 MÜLLER)",
    "N10 G21 G17 G40 G49 G80 G90 G94",
    "N20 T1 M6",
    "N30 S3000 M3",
    "N40 G0 X-60. Y-30.",
    "N50 G43 Z25. H1 M8",
    "N60 G1 Z-2. F250.",
    "N70 X60. F800.",
    "N80 Y30.",
    "N90 X-60.",
    "N100 Y-30.",
    "N110 G0 Z25. M9",
    "N120 T2 M6",
    "N130 S2400 M3",
    "N140 G0 X0. Y0.",
    "N150 G43 Z25. H2 M8",
    "N160 G81 Z-15. R2. F150.",
    "N170 X20. Y20.",
    "N180 G80",
    "N190 G0 Z25. M9",
    "N200 T3 M6",
    "N210 S400 M3",
    "N220 G0 X0. Y0.",
    "N230 G43 Z25. H3 M8",
    "N240 G84 Z-12. R5. F600.",
    "N250 G80",
    "N260 G0 Z25. M9",
    "N270 M30",
    "%",
]

# --------------------------------------------------------------------------- B. Fanuc packed, NUL

FANUC_PACKED_IN = [
    MARK,
    "%",
    "O4002(PACKED)",
    "N10G21G17G40G49G80G90G94",
    "N20T1M6",
    "N30S3000M3",
    "N40G0X0.Y0.",
    "N50G43Z25.H1M8",
    "N60G1Z-2.F250.",
    "N70X40.F800.",
    "N80G0Z25.M9",
    "N90T2M6",
    "N100S2400M3",
    "N110G0X20.Y20.",
    "N120G43Z25.H2M8",
    "N130G1Z-5.F120.",
    "N140X-20.F600.",
    "N150G0Z25.M9",
    "N160M30",
    "%",
]

# Feeds x 90 % ("as written" decimals), then speeds x 110 % (whole revolutions).
FANUC_PACKED_OUT = [
    MARK,
    "%",
    "O4002(PACKED)",
    "N10G21G17G40G49G80G90G94",
    "N20T1M6",
    "N30S3300M3",
    "N40G0X0.Y0.",
    "N50G43Z25.H1M8",
    "N60G1Z-2.F225.",
    "N70X40.F720.",
    "N80G0Z25.M9",
    "N90T2M6",
    "N100S2640M3",
    "N110G0X20.Y20.",
    "N120G43Z25.H2M8",
    "N130G1Z-5.F108.",
    "N140X-20.F540.",
    "N150G0Z25.M9",
    "N160M30",
    "%",
]

NUL_LEADER = 32
NUL_TRAILER = 16

# --------------------------------------------------------------------------- C. Klartext, BOM

KLARTEXT_IN = [
    "0 BEGIN PGM EXIT_KT MM",
    "1 " + MARK_KT,
    "2 BLK FORM 0.1 Z X-50 Y-40 Z-20",
    "3 BLK FORM 0.2 X+50 Y+40 Z+0",
    "4 * - ROUGH",
    "5 TOOL CALL 1 Z S3000 F800 ; D10 END MILL Ø10",
    "6 L Z+100 R0 FMAX M3",
    "7 L X-40 Y-30 R0 FMAX M8",
    "8 L Z-2 R0 F300",
    "9 L X+40 R0 F800",
    "10 L Y+30",
    "11 L Z+100 R0 FMAX",
    "12 * - DRILL",
    "13 TOOL CALL 2 Z S2400 ; D8.5 DRILL",
    "14 L Z+100 R0 FMAX M3",
    "15 CYCL DEF 200 DRILLING ~",
    "   Q200=2 ;CLEARANCE ~",
    "   Q201=-15 ;DEPTH ~",
    "   Q206=150 ;PLUNGE FEED ~",
    "   Q202=5 ;PECK ~",
    "   Q203=+0 ;SURFACE ~",
    "   Q204=50 ;2ND CLEARANCE",
    "16 L X+0 Y+0 R0 FMAX M99",
    "17 L X+20 Y+20 R0 FMAX M99",
    "18 L Z+100 R0 FMAX",
    "19 * - FINISH",
    "20 TOOL CALL 3 Z S4500 F450 ; D6 BALL MILL",
    "21 L Z+100 R0 FMAX M3",
    "22 L X-30 Y-20 R0 FMAX",
    "23 L Z-1 R0 F200",
    "24 L X+30 R0 F450",
    "25 L Z+100 R0 FMAX M9",
    "26 M30",
    "27 END PGM EXIT_KT MM",
]

# Feeds x 90 % (Q206 is a cycle feed and stays), then speeds x 110 %.
KLARTEXT_OUT = [
    "0 BEGIN PGM EXIT_KT MM",
    "1 " + MARK_KT,
    "2 BLK FORM 0.1 Z X-50 Y-40 Z-20",
    "3 BLK FORM 0.2 X+50 Y+40 Z+0",
    "4 * - ROUGH",
    "5 TOOL CALL 1 Z S3300 F720 ; D10 END MILL Ø10",
    "6 L Z+100 R0 FMAX M3",
    "7 L X-40 Y-30 R0 FMAX M8",
    "8 L Z-2 R0 F270",
    "9 L X+40 R0 F720",
    "10 L Y+30",
    "11 L Z+100 R0 FMAX",
    "12 * - DRILL",
    "13 TOOL CALL 2 Z S2640 ; D8.5 DRILL",
    "14 L Z+100 R0 FMAX M3",
    "15 CYCL DEF 200 DRILLING ~",
    "   Q200=2 ;CLEARANCE ~",
    "   Q201=-15 ;DEPTH ~",
    "   Q206=150 ;PLUNGE FEED ~",
    "   Q202=5 ;PECK ~",
    "   Q203=+0 ;SURFACE ~",
    "   Q204=50 ;2ND CLEARANCE",
    "16 L X+0 Y+0 R0 FMAX M99",
    "17 L X+20 Y+20 R0 FMAX M99",
    "18 L Z+100 R0 FMAX",
    "19 * - FINISH",
    "20 TOOL CALL 3 Z S4950 F405 ; D6 BALL MILL",
    "21 L Z+100 R0 FMAX M3",
    "22 L X-30 Y-20 R0 FMAX",
    # 200 x 90 % = 180. This line read "F200" until the scenario caught it: the input line
    # had been copied across unchanged while every other L-block feed (F300, F800, F450)
    # was scaled. A plunge on a straight line is an ordinary feed — the only Klartext feed
    # the rules spare is the cycle feed Q206 below, and that one is still 150.
    "23 L Z-1 R0 F180",
    "24 L X+30 R0 F405",
    "25 L Z+100 R0 FMAX M9",
    "26 M30",
    "27 END PGM EXIT_KT MM",
]


def write(rel, data):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)
    print("%-44s %6d bytes" % (rel, len(data)))


def crlf(lines):
    return "".join(line + "\r\n" for line in lines)


def lf(lines):
    return "".join(line + "\n" for line in lines)


def main():
    cp = crlf(FANUC_CP1252_IN).encode("cp1252")
    write("fanuc-cp1252-crlf.nc", cp)
    write("expected/fanuc-cp1252-crlf.nc", crlf(FANUC_CP1252_OUT).encode("cp1252"))
    write("expected-nopython/fanuc-cp1252-crlf.nc", crlf(FANUC_CP1252_OUT).encode("cp1252"))

    lead = b"\x00" * NUL_LEADER
    trail = b"\x00" * NUL_TRAILER
    packed_in = lead + lf(FANUC_PACKED_IN).encode("utf-8") + trail
    write("fanuc-utf8-lf-packed-nul.nc", packed_in)
    write("expected/fanuc-utf8-lf-packed-nul.nc", lead + lf(FANUC_PACKED_OUT).encode("utf-8") + trail)
    write("expected-nopython/fanuc-utf8-lf-packed-nul.nc", packed_in)

    bom = b"\xef\xbb\xbf"
    kt_in = bom + crlf(KLARTEXT_IN).encode("utf-8")
    write("klartext-utf8bom-crlf.h", kt_in)
    write("expected/klartext-utf8bom-crlf.h", bom + crlf(KLARTEXT_OUT).encode("utf-8"))
    write("expected-nopython/klartext-utf8bom-crlf.h", kt_in)


if __name__ == "__main__":
    main()
