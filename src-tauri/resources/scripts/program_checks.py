#!/usr/bin/env python3
# /// gedit
# name = "Program checks"
# description = "Lists what a program does that the control or the machine will not like: cuts with the spindle stopped, tool changes inside a cycle, the stops, the program frame, numbers whose reading depends on the machine, and the rules of each control. Changes nothing."
# input = "selection-or-document"
# output = "report"
# timeout = 300
#
# [[params]]
# id = "programFrame"
# type = "bool"
# label = "Program frame"
# help = "The program's start and end, the tape markers, and code after the end that never runs."
# default = true
#
# [[params]]
# id = "spindleOff"
# type = "bool"
# label = "Spindle"
# help = "A cut while the spindle is stopped or was never started."
# default = true
#
# [[params]]
# id = "toolChangeSpindle"
# type = "bool"
# label = "Spindle after tool change"
# help = "A tool change on a machining centre stops the spindle; the first cut after it needs a spindle start."
# default = true
#
# [[params]]
# id = "toolChangeInCycle"
# type = "bool"
# label = "Tool change in a cycle"
# help = "A tool change while a modal cycle or a modal call is in force."
# default = true
#
# [[params]]
# id = "offsetCancelCut"
# type = "bool"
# label = "Offset cancel"
# help = "Lathe: a cut after the tool offset was cancelled (T..00)."
# default = true
#
# [[params]]
# id = "speedAfterTapping"
# type = "bool"
# label = "Speed after tapping"
# help = "A cut after leaving a tapping move that sets the speed to zero, with no new speed."
# default = true
#
# [[params]]
# id = "cssClamp"
# type = "bool"
# label = "Speed clamp"
# help = "Constant surface speed with no spindle speed clamp before it."
# default = true
#
# [[params]]
# id = "threadUnderCss"
# type = "bool"
# label = "Thread under surface speed"
# help = "A thread cut under constant surface speed."
# default = true
#
# [[params]]
# id = "stateConflicts"
# type = "bool"
# label = "Refused in this state"
# help = "A code written in a state the control refuses it in: tool centre point control, compensation, a cycle, a frame."
# default = true
#
# [[params]]
# id = "requiredWords"
# type = "bool"
# label = "Missing word"
# help = "A code whose block lacks a word the control needs with it."
# default = true
#
# [[params]]
# id = "aloneInBlock"
# type = "bool"
# label = "Alone in its block"
# help = "A code that has to stand in a block of its own."
# default = true
#
# [[params]]
# id = "rigidTapping"
# type = "bool"
# label = "Rigid tapping"
# help = "The rigid tapping call before its cycle: no speed and no move between them."
# default = true
#
# [[params]]
# id = "cycleUndefined"
# type = "bool"
# label = "Cycle call"
# help = "A cycle call with no cycle defined before it."
# default = true
#
# [[params]]
# id = "modalCallOpen"
# type = "bool"
# label = "Modal call"
# help = "A modal call still in force at the end of the program."
# default = true
#
# [[params]]
# id = "languageSwitch"
# type = "bool"
# label = "Control language"
# help = "A code that switches the control to another programming language."
# default = true
#
# [[params]]
# id = "profileTargets"
# type = "bool"
# label = "Profile targets"
# help = "Lathe: the P and Q blocks of a roughing or finishing cycle, missing or in the wrong order."
# default = true
#
# [[params]]
# id = "callInProfile"
# type = "bool"
# label = "Call in a profile"
# help = "Lathe: a subprogram call inside the P to Q profile of a cycle."
# default = true
#
# [[params]]
# id = "jumpTargets"
# type = "bool"
# label = "Jump target"
# help = "A jump whose target is missing, in the wrong direction or defined twice."
# default = true
#
# [[params]]
# id = "doEnd"
# type = "bool"
# label = "DO and END"
# help = "Loops whose DO and END numbers do not match."
# default = true
#
# [[params]]
# id = "blockWords"
# type = "bool"
# label = "Words in a block"
# help = "Two speed or tool words in one block, or more M codes than the control takes."
# default = true
#
# [[params]]
# id = "toolWordFormat"
# type = "bool"
# label = "Tool word"
# help = "A tool word the machine's tool-word format does not describe, or tool words of different lengths."
# default = true
#
# [[params]]
# id = "programNameBlock"
# type = "bool"
# label = "Program name"
# help = "A program name that shares its block with other words."
# default = true
#
# [[params]]
# id = "sequenceSeparator"
# type = "bool"
# label = "Sequence name"
# help = "A sequence name not followed by a space or a tab."
# default = true
#
# [[params]]
# id = "wordDigits"
# type = "bool"
# label = "Digits"
# help = "A word with more digits than the control stores, once it is converted to increments."
# default = true
#
# [[params]]
# id = "machineReading"
# type = "bool"
# label = "Machine reading"
# help = "A dimension word without a point whose value depends on how the machine reads numbers."
# default = true
#
# [[params]]
# id = "tapeMarkerInComment"
# type = "bool"
# label = "Tape marker"
# help = "A % inside a comment, which ends the program when it is read in."
# default = true
#
# [[params]]
# id = "unclosedComments"
# type = "bool"
# label = "Comment"
# help = "A comment that is not closed on its line."
# default = true
#
# [[params]]
# id = "brackets"
# type = "bool"
# label = "Brackets"
# help = "Brackets or quotes that are not balanced in a block."
# default = true
#
# [[params]]
# id = "lowerCase"
# type = "bool"
# label = "Lower case"
# help = "Lower-case addresses outside comments, where the control reads upper case."
# default = true
#
# [[params]]
# id = "characters"
# type = "bool"
# label = "Characters"
# help = "Characters outside ASCII outside comments, and blocks longer than the control takes."
# default = true
#
# [[params]]
# id = "stops"
# type = "bool"
# label = "Stop"
# help = "Every program stop and optional stop, as a list."
# default = true
# ///
"""The program checks (plan section 6 M10, WP10.2; roadmap R7; `nc-transformations.md`).

One report script with a switch per check, every one of them on by default. The report has
one row per finding — the line, the check, the severity and what was found — and changes
nothing in the document. The report format and the check ids are pinned in
`tests/fixtures/scripts/program_checks/README.md`.

**A check that cries wolf on a correct program is worse than no check.** So every check is
driven by data and judges only what that data settles:

* the **profile** says what a line *is* — comments, block numbers, labels, the program's
  start and end, the stops, the subprogram calls, the tool call, the jump references, the
  longest block, the axes and how the control reads case;
* the **code database** says what a code *does* — the modal interpreter's `sets` (feed and
  speed unit, cycles, frames, tool centre point control), the flags of R3 and R8, and the
  members this script reads for itself: the spindle on or off (`sets.spindle`,
  `sets.toolSpindle`), a rapid or a feed move (`sets.motion`), radius and length
  compensation (`sets.radiusComp`, `sets.lengthComp`), the speed a code leaves behind
  (`sets.exitSpeed`), the control language (`sets.language`), the states the control
  refuses a code in (`conflicts`), a code that has to stand alone (`alone`) and the words its
  block has to carry (`requires`);
* the **effective machine** (AD-31) says how a number is read.

No rule names a dialect. Where the data a check needs is missing, the check does not run,
and where it applies but cannot judge part of the program (a selection that does not show
the program's start, a database that does not say which code starts the spindle) a run
note says so once — it never flags every line instead.

The checks, in the order the report lists a line's findings, are `CHECKS` below; each is
described where it is implemented.

What a cut is
-------------
Several checks ask whether a block **cuts**. A block cuts when

* it moves an axis (`addresses.axes`), or writes a feed move whose code is a keyword of its
  own (Klartext `LP`, `CP`: a polar move carries no axis word), under a code whose
  `sets.motion` is `'feed'` — the motion code in force for a modal code, the block's own
  for a code that is not modal — and the block writes no rapid word (`addresses.rapid`,
  Klartext `FMAX`) and no code whose axis words are data or a machine position; or
* it runs a cycle: a code with `sets.cycle: 'start'`, a call of the defined cycle, a
  positioning block under a modal cycle, a modal call (`M89`) or a modal call written behind
  a keyword whose `sets.cycle` is `'call-modal-next'` (`MCALL CYCLE81(…)`, the rule `scale_feed` uses).

A spindle is running when one was started by a code of `sets.spindle` / `sets.toolSpindle`
or by an assignment that names a spindle by its number (`M1=3`, `M2=4`, which is how a
Sinumerik control addresses spindle 1 and 2), and not stopped since. A cut is judged with
the spindle state before **and** after its own block, so `M3` and `M5` written in the cut's
own block never decide against it. An M code the database does not know may start or stop a
spindle, so after one the spindle state is unknown until the next code the database knows.
"""

from __future__ import annotations

import re
import sys
import unicodedata
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import gedit_nc

TITLE = "Program checks"

#: The most table rows the app takes from one report (`MAX_ROWS` in `core/scripting/apply.ts`;
#: a test holds the two together). A report longer than that is cut here, not in the app: the
#: app cannot read past the 64 MiB of output it accepts, and a program of 80,000 lines that
#: writes every dimension without a point (no machine chosen, so every reading is listed)
#: would lose the whole report to that limit. Information goes first, then warnings; errors
#: are kept. Every row that is left out is counted and the run says so.
MAX_ROWS = 5000
#: Rows kept while the walk is still going, by severity: the information rows of a long
#: program (a reading per word, a lower-case line per line) stop at `MAX_ROWS`; the rest at
#: twice that, so that the cut at the end has something to choose from.
ROW_BUDGET = {"info": MAX_ROWS, "warning": 2 * MAX_ROWS, "error": 2 * MAX_ROWS}
RANK = {"error": 0, "warning": 1, "info": 2}

#: ``(id, label)`` of every check, in the order a line's findings are listed. The id is the
#: parameter of the header and the ``checkId`` of a row; the label is the ``check`` column.
#: `tests/python/test_program_checks.py` holds the header to this list.
CHECKS: List[Tuple[str, str]] = [
    ("programFrame", "Program frame"),
    ("spindleOff", "Spindle"),
    ("toolChangeSpindle", "Spindle after tool change"),
    ("toolChangeInCycle", "Tool change in a cycle"),
    ("offsetCancelCut", "Offset cancel"),
    ("speedAfterTapping", "Speed after tapping"),
    ("cssClamp", "Speed clamp"),
    ("threadUnderCss", "Thread under surface speed"),
    ("stateConflicts", "Refused in this state"),
    ("requiredWords", "Missing word"),
    ("aloneInBlock", "Alone in its block"),
    ("rigidTapping", "Rigid tapping"),
    ("cycleUndefined", "Cycle call"),
    ("modalCallOpen", "Modal call"),
    ("languageSwitch", "Control language"),
    ("profileTargets", "Profile targets"),
    ("callInProfile", "Call in a profile"),
    ("jumpTargets", "Jump target"),
    ("doEnd", "DO and END"),
    ("blockWords", "Words in a block"),
    ("toolWordFormat", "Tool word"),
    ("programNameBlock", "Program name"),
    ("sequenceSeparator", "Sequence name"),
    ("wordDigits", "Digits"),
    ("machineReading", "Machine reading"),
    ("tapeMarkerInComment", "Tape marker"),
    ("unclosedComments", "Comment"),
    ("brackets", "Brackets"),
    ("lowerCase", "Lower case"),
    ("characters", "Characters"),
    ("stops", "Stop"),
]

ORDER = {check_id: index for index, (check_id, _) in enumerate(CHECKS)}
LABEL = dict(CHECKS)

#: The conditions `CodeEntry.conflicts` may name (with `frame:<group>` and a leading `!`). The
#: script reads them by name (`CONDITION_TEXT`); the data tests hold the shipped databases to
#: this list, so a condition the script has no sentence for cannot ship.
CONDITIONS = ("tcp", "radiusComp", "lengthComp", "cycle", "surfaceSpeed", "feedNotPerMinute")

#: What a condition reads like in a finding.
CONDITION_TEXT = {
    "tcp": "tool centre point control is on",
    "radiusComp": "radius compensation is on",
    "lengthComp": "a tool length offset is on",
    "cycle": "a modal cycle is in force",
    "surfaceSpeed": "constant surface speed is on",
    "feedNotPerMinute": "the feed is not a feed per minute",
}

#: The jump keywords whose direction the language fixes, and the one that may miss its
#: target without an alarm. These are the meanings of keywords the profile declares in
#: `syntax.keywords` and names in a `numbering.references` trigger; a profile without them
#: never reaches this table.
JUMP_DIRECTION = {"GOTOF": "forward", "GOTOB": "backward"}
JUMP_MAY_MISS = ("GOTOC",)

#: M12.5 decision 9: a control whose main program has to end with an end code while a
#: subprogram may simply return at its last line. The profile's file extensions say whether
#: the control is one of these (it keeps subprograms in files of their own extension), and a
#: program is a subprogram when its file has that extension or its start line names it
#: (`%_N_PART_SPF`) or defines a procedure (`PROC PART`). Every other program of such a
#: profile is a main program, and the last one of a file that ends with no end code is cut
#: short or unfinished.
SUBPROGRAM_EXTENSIONS = ("spf",)
SUBPROGRAM_START = re.compile(r"(?:^|[_.])SPF\b|^\s*(?:N\d+[ \t]+)?PROC\b", re.IGNORECASE)
#: A section of a Sinumerik archive that holds data, not a program: `%_N_<n>_<m>_MPF` with a
#: section number `<m>` other than 0 (tool data and the like; the `_0_` sections are the
#: channels' programs). It has no end code to miss.
#: A subprogram header written as a comment on the first line of the file (`;%_N_PART_SPF`):
#: the file holds a subprogram whatever its name says. Only the first line counts: further
#: down, a commented header is a comment, and the program it names is not split off.
COMMENTED_SUBPROGRAM_HEADER = re.compile(r"^;%(?:_N_)?\w+_SPF\b", re.IGNORECASE)
ARCHIVE_DATA_START = re.compile(r"^;?%_N_\d+_0*[1-9]\d*_MPF\b", re.IGNORECASE)
#: The jumps that never fall through to the next block when nothing makes them conditional:
#: a main program whose last block is one of them loops and does not run off its end. `GOTOC`
#: goes on when its target is missing and `GOTOS` when the PLC signal is 0, so they are not.
UNCONDITIONAL_JUMPS = ("GOTOB", "GOTOF", "GOTO")

#: How far apart a DO and its END may be numbered (macro statements, `syntax.keywords` with
#: both `DO` and `END`): the control knows the loop numbers 1 to 3.
DO_NUMBERS = (1, 2, 3)

#: Quick tests that keep a line-by-line check off the lines it cannot apply to.
BRACKET_CHARS = re.compile(r'[()\[\]"]')
LOWER = re.compile(r"[a-z]")

#: A word with this many characters or more is shortened in a finding.
SHOW = 40


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def sets_of(entry: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return as_dict(as_dict(entry).get("sets"))


def code_of(entry: Optional[Dict[str, Any]], fallback: str = "") -> str:
    code = as_dict(entry).get("code")
    return code if isinstance(code, str) and code != "" else fallback


def head_of(code: str) -> str:
    end = 0
    while end < len(code) and code[end].isalpha():
        end += 1
    return code[:end].upper()


def shown(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= SHOW else text[: SHOW - 1] + "…"


is_assignment = gedit_nc.is_assignment


def digits_of(text: str) -> int:
    """The digits of a written number, leading zeros not counted."""
    raw = text.strip().lstrip("+-")
    whole, _, frac = raw.partition(".")
    whole = whole.lstrip("0")
    return len(whole) + len(frac)


def plural(count: int, one: str, many: str) -> str:
    return "%d %s" % (count, one if count == 1 else many)


def listing(items: Sequence[str]) -> str:
    """``a``, ``a or b``, ``a, b or c``."""
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " or " + items[-1]


# ---------------------------------------------------------------------------
# What a block writes
# ---------------------------------------------------------------------------


class Written:
    """One code a block writes: its text, its database entry, the token and the line."""

    __slots__ = ("code", "entry", "token", "kind", "line", "facts")

    def __init__(self, code: str, entry: Optional[Dict[str, Any]], token: gedit_nc.Token, kind: str, line: int, facts: Optional["Facts"]):
        self.code = code
        self.entry = entry
        self.token = token
        self.kind = kind
        self.line = line
        self.facts = facts


def written_codes(tokens: Sequence[gedit_nc.Token], run: "Run", line: int) -> List[Written]:
    """Every code a line writes, in written order, the way the modal interpreter reads them.

    An address word (``G95``), a call (``CYCLE81(…)``, the code of its identifier) and a
    keyword, joined with the number behind it where the database knows the pair (``CYCL DEF
    200``) or the cycle a sub-block belongs to (``CYCL DEF 7.1``). An assignment
    (``M3=3``) is a value and never a code.
    """
    interp = run.interp
    out: List[Written] = []
    count = len(tokens)
    for i, token in enumerate(tokens):
        kind = token.kind
        if kind == "word":
            address = token.address or ""
            if address == "" or is_assignment(token):
                continue
            code = address + (token.value_text or "")
        elif kind == "call":
            code = token.address or ""
            if code == "":
                continue
        elif kind == "keyword":
            name = token.address or token.text
            number = token.value_text
            if number is None:
                for j in range(i + 1, count):
                    nxt = tokens[j]
                    if nxt.kind == "whitespace":
                        continue
                    if nxt.address is None and nxt.value_text is not None:
                        number = nxt.value_text
                    break
            code = name
            if number is not None:
                joined = "%s %s" % (name, number)
                if interp.entry(joined) is not None:
                    code = joined
                else:
                    whole, dot, part = number.partition(".")
                    if dot == "." and whole.isdigit() and part.isdigit() and interp.entry("%s %s" % (name, whole)) is not None:
                        code = "%s %s" % (name, whole)
        else:
            continue
        entry = interp.entry(code)
        out.append(Written(code, entry, token, kind, line, run.facts_of(entry)))
    return out


class Block:
    """The lines of one NC block (a Klartext ``~`` list, an Okuma ``$`` line) and what they say."""

    def __init__(self, line: int) -> None:
        self.line = line
        self.lines: List[Tuple[int, str, str, List[gedit_nc.Token]]] = []
        self.tokens: List[Tuple[int, gedit_nc.Token]] = []
        self.written: List[Written] = []
        #: The modal cycle in force before the block's first line was applied.
        self.cycle_before: Optional[str] = None

    @property
    def entries(self) -> List[Dict[str, Any]]:
        return [w.entry for w in self.written if w.entry is not None]

    def text(self) -> str:
        return " ".join(line[1].strip() for line in self.lines)


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------


class Run:
    """One run of the program checks over a document or a selection."""

    def __init__(self, context: Dict[str, Any], lines: List[str]) -> None:
        self.context = context
        self.profile: Dict[str, Any] = as_dict(context.get("profile"))
        self.cp = gedit_nc.compile_profile(self.profile)
        codes = context.get("codes")
        self.codes: List[Dict[str, Any]] = [c for c in codes if isinstance(c, dict)] if isinstance(codes, list) else []
        self.interp = gedit_nc.ModalInterpreter(self.cp, self.codes)
        self.machine = gedit_nc.machine_params(context)
        self.lines = lines

        params = as_dict(context.get("params"))
        self.enabled: Set[str] = {cid for cid, _ in CHECKS if params.get(cid) is not False}

        scope = as_dict(context.get("input"))
        start = scope.get("startLine")
        self.first = start if isinstance(start, int) and not isinstance(start, bool) and start >= 1 else 1
        self.selection = scope.get("scope") == "selection"
        self.above = gedit_nc.preceding_lines(context)
        #: The run sees the program from its start: a document, or a selection with every
        #: line above it.
        self.from_start = (not self.selection) or self.first == 1 or bool(self.above)

        self.rows: List[Tuple[int, int, int, Dict[str, Any]]] = []
        #: Rows the walk did not keep (`ROW_BUDGET`), and the per-severity counts it keeps by.
        self.dropped = 0
        self._kept: Dict[str, int] = {"info": 0, "warning": 0, "error": 0}
        #: `machineReading`: the per-word rows, and the one row that replaces them where every
        #: number depends on the machine (a unit system).
        self.reading_rows: List[Tuple[int, str]] = []
        self.every_number: Optional[Tuple[int, str]] = None
        #: `machineReading` rows past `MAX_ROWS` that were not built (they could not be shown).
        self.readings_dropped = 0
        self.last_tool: Optional[str] = None
        #: `toolWordFormat`: the lengths of the tool words seen, with the first line of each.
        self.tool_lengths: Dict[int, int] = {}
        self.tool_mix_reported = False
        self.notes: List[Dict[str, Any]] = []
        self._noted: Set[str] = set()
        self._serial = 0

        self._facts: Dict[int, Optional[Facts]] = {}
        #: `read_numbers`: the class of an address and the readings of a literal, remembered
        #: per combination because a long program asks the same questions on every line.
        self._classes: Dict[Tuple[Any, ...], Optional[str]] = {}
        self._readings: Dict[Tuple[Any, ...], Any] = {}
        self._read_profile()
        self._read_database()
        self._reset_program()
        units = as_dict(self.interp.state.get("units")).get("value")
        if units not in ("mm", "inch"):
            units = as_dict(self.machine.get("params")).get("units")
        #: The program's units, followed through the database's `sets.units`.
        self.units = units if units in ("mm", "inch") else "mm"

    # -- what the profile and the database offer ------------------------------

    def _read_profile(self) -> None:
        profile = self.profile
        addresses = as_dict(profile.get("addresses"))
        syntax = as_dict(profile.get("syntax"))
        self.lathe = gedit_nc.machine_type_of(profile) == "lathe"
        self.axes = {str(a).upper() for a in as_list(addresses.get("axes")) if isinstance(a, str) and a}
        spindle = addresses.get("spindle")
        self.speed_address = spindle.upper() if isinstance(spindle, str) and spindle else "S"
        tool = addresses.get("tool")
        self.tool_address = tool.upper() if isinstance(tool, str) and tool else None
        main = addresses.get("mainSpindle")
        self.main_spindle = main.strip() if isinstance(main, str) and main.strip() else None
        feed = addresses.get("feed")
        self.feed_address = feed.upper() if isinstance(feed, str) and feed else "F"
        rapid = addresses.get("rapid")
        self.rapid_word = rapid.upper() if isinstance(rapid, str) and rapid else None
        limits = addresses.get("speedLimitWords")
        self.speed_limit_words = {str(w).upper() for w in as_list(limits) if isinstance(w, str)}

        self.comment_rules = [as_dict(rule) for rule in as_list(syntax.get("comments"))]
        self.paren_comments = any(rule.get("start") == "(" for rule in self.comment_rules)
        self.strings = syntax.get("strings") is True
        self.max_line = syntax.get("maxLineLength") if isinstance(syntax.get("maxLineLength"), int) else None
        self.max_digits = syntax.get("maxWordDigits") if isinstance(syntax.get("maxWordDigits"), int) else None
        self.max_m = syntax.get("maxMCodes") if isinstance(syntax.get("maxMCodes"), int) else None
        self.sequence_names = syntax.get("sequenceNames") is True
        self.has_labels = isinstance(syntax.get("labels"), str) and syntax.get("labels") != ""
        self.has_header = isinstance(syntax.get("header"), str) and syntax.get("header") != ""
        program = as_dict(profile.get("program"))
        #: The program's end line is its closing record (Klartext `END PGM`), named like its start.
        self.end_record = program.get("endRecord") is True
        extensions = {str(e).lower() for e in as_list(as_dict(profile.get("files")).get("extensions")) if isinstance(e, str)}
        #: A main program has to end with an end code (`SUBPROGRAM_EXTENSIONS`).
        self.main_needs_end = bool(extensions.intersection(SUBPROGRAM_EXTENSIONS)) and bool(program.get("end"))
        document = as_dict(self.context.get("document"))
        name = document.get("name") if isinstance(document.get("name"), str) else document.get("path")
        stem, dot, extension = (name or "").rpartition(".") if isinstance(name, str) else ("", "", "")
        #: The document is a subprogram file by its extension.
        self.subprogram_file = bool(dot) and extension.lower() in SUBPROGRAM_EXTENSIONS
        #: The document has never been saved (no path): no file name says what it holds.
        self.untitled = not (isinstance(document.get("path"), str) and document.get("path") != "")
        keywords = {str(k).upper() for k in as_list(syntax.get("keywords")) if isinstance(k, str)}
        self.keywords = keywords
        self.upper_only = as_dict(profile.get("editing")).get("forceUppercase") is True

        patterns = self.cp.patterns
        self.tool_trigger = patterns.get("tool_trigger")
        self.tool_ignore = patterns.get("tool_ignore")
        self.tool_pattern = patterns.get("tool")
        self.program_start = list(patterns.get("program_start") or [])
        self.program_end = list(patterns.get("program_end") or [])
        outline = patterns.get("outline") or []
        self.stop_patterns = [regex for kind, regex in outline if kind == "stop" and regex is not None]
        self.end_patterns = [regex for kind, regex in outline if kind == "end" and regex is not None]
        self.call_patterns = [regex for kind, regex in outline if kind == "subprogram-call" and regex is not None]
        raw_refs = [as_dict(rule) for rule in as_list(as_dict(profile.get("numbering")).get("references"))]
        self.references: List[Tuple[Any, List[str], bool]] = []
        for (trigger, addrs), raw in zip(patterns.get("references") or [], raw_refs):
            if trigger is not None:
                self.references.append((trigger, [a.upper() for a in addrs], raw.get("rewrite") is not False))

        # A program name has to stand alone where every start pattern ends the line.
        self.name_alone = bool(self.program_start) and all(
            str(source).rstrip().endswith("$") for source in as_list(as_dict(profile.get("program")).get("start"))
        )

        # The tape marker: what a lone `%` is to this profile, when it has no file header.
        tokens, _ = gedit_nc.tokenize_line("%", self.cp)
        self.tape_marker = not self.has_header and len(tokens) == 1 and tokens[0].kind == "programMarker"

        # A tool rule that takes exactly two lengths of tool word (four and six digits: with
        # and without a nose-radius set) names two forms of one equipment, and a file keeps
        # to one of them; a rule that takes a range (leading zeros optional) has no forms.
        lengths = [n for n in range(1, 11) if self.tool_trigger is not None and self.tool_trigger.search("T" + "1" * n)]
        self.tool_forms = len(lengths) == 2
        decl = as_dict(profile.get("machineParams"))
        # A profile whose presets disagree about a number written with a point is a unit
        # system: every number depends on the machine, so `machineReading` says it once.
        sample = gedit_nc.parse_number("1.")
        value, readings = gedit_nc.resolve_value(sample, "length", gedit_nc.machine_params(self.context), profile, "mm")
        self.unit_system = value is None and bool(readings)
        self.tool_word_variant = any(as_dict(v).get("id") == "toolWord" for v in as_list(decl.get("variants")))
        #: Whether the machine itself says how its tool word is written. Only then is a tool
        #: word the rule does not describe a finding: a machining-centre program opened with
        #: a lathe profile writes `T1 M6`, which no lathe tool word describes (R7, R9).
        variant_sources = as_dict(as_dict(self.machine.get("source")).get("variants"))
        self.tool_word_stated = variant_sources.get("toolWord") == "machine"
        self.presets = [as_dict(p) for p in as_list(as_dict(decl.get("numberInput")).get("presets"))]
        #: M12.5 decision 4 (§7.16 #178): the lines that hold one of the machine's channel
        #: marks (`channels.marks`, resolved by the app). The machine's wait code wins over the
        #: code database there (`M198` is a wait on a three-path machine, not the database's
        #: external call), so no `requiredWords` or `aloneInBlock` row is written on them.
        self.mark_lines: Set[int] = {
            mark["line"] for mark in gedit_nc.sync_marks(self.context) if isinstance(mark.get("line"), int)
        }

    def _read_database(self) -> None:
        codes = self.codes
        any_sets = lambda member: any(member in sets_of(e) for e in codes)  # noqa: E731
        self.has_spindle = any_sets("spindle") or any_sets("toolSpindle")
        self.has_motion = any(sets_of(e).get("motion") in ("rapid", "feed") for e in codes)
        self.has_clamp = any(sets_of(e).get("speedLimit") is True for e in codes) or bool(self.speed_limit_words)
        self.has_exit_speed = any(sets_of(e).get("exitSpeed") == "zero" for e in codes)
        self.has_defined = any(sets_of(e).get("cycle") == "define" for e in codes) and any(
            sets_of(e).get("cycle") in ("call", "call-modal") for e in codes
        )
        #: The heads of the codes that start or stop a spindle (`M`): an unknown code of one
        #: of these may do it too.
        self.spindle_heads = {
            head_of(code_of(e)) for e in codes if sets_of(e).get("spindle") or sets_of(e).get("toolSpindle")
        }
        #: Rigid tapping: a tapping code that is neither a cycle nor a mode (`M29`), and the
        #: tapping cycles it has to come before (`G84`).
        self.tap_calls = {
            code_of(e).upper()
            for e in codes
            if e.get("tapping") is True and e.get("modal") is not True and not sets_of(e).get("cycle")
        }
        self.tap_cycles = {
            code_of(e).upper()
            for e in codes
            if e.get("tapping") is True and e.get("modal") is True and sets_of(e).get("cycle") == "start"
        }
        #: An offset cancel on a turret (`T0100`) is the tool rule's `ignore` on a lone tool word.
        self.cancel_rule = (
            self.lathe and self.tool_ignore is not None and self.tool_address is not None and self.on("offsetCancelCut")
        )
        chosen = as_dict(self.machine.get("source")).get("numberInput") == "machine"
        number_input = as_dict(as_dict(self.machine.get("params")).get("numberInput"))
        if chosen:
            # A machine reads every literal one way unless a point decides (increments).
            modes = {number_input.get("mode")} | {
                as_dict(c).get("mode") for c in as_dict(number_input.get("classes")).values() if as_dict(c).get("mode")
            }
            reading = "increment" in modes
        else:
            reading = len(self.presets) > 1
        self.reads_numbers = (self.on("machineReading") and reading) or (self.on("wordDigits") and self.max_digits is not None)

    def facts_of(self, entry: Optional[Dict[str, Any]]) -> Optional["Facts"]:
        """The :class:`Facts` of a database entry, worked out once."""
        if entry is None:
            return None
        key = id(entry)
        if key not in self._facts:
            self._facts[key] = Facts(entry, self)
        return self._facts[key]

    # -- state ----------------------------------------------------------------

    def _reset_program(self) -> None:
        """The state at the start of a program (a start marker resets it)."""
        self.flush_never()
        known = self.from_start
        #: key -> running; keys are 'main', 'tool' and 'n<number>'.
        self.running: Set[str] = set()
        self.spindle_known = known
        self.spindle_ever = False
        #: Why the spindle is not running: ('never', 0, '') / ('code', line, text) /
        #: ('toolChange', line, text); and whether that stop was reported.
        self.stop: Tuple[str, int, str] = ("never", 0, "")
        self.stop_reported = False
        self.motion_modal: Optional[str] = None
        self.motion_code: Optional[str] = None
        self.radius_comp: Optional[Tuple[str, int]] = None
        self.length_comp: Optional[Tuple[str, int]] = None
        self.mcall: Optional[Tuple[str, int]] = None
        self.in_contour = False
        self.cancelled: Optional[Tuple[int, str]] = None
        self.cancel_reported = False
        #: The tapping call in force (code, line) and the first speed word or move written
        #: behind it (the row to add if a tapping cycle then starts), or None.
        self.tap_pending: Optional[Tuple[str, int, Optional[Tuple[int, str, str]]]] = None
        self.zero_speed: Optional[Tuple[str, int]] = None
        self.clamp_reported = False
        self.css_thread_reported = False
        self.defined_seen = False
        self.defined_known = known
        self.iso_reported = False
        #: Cuts before any spindle start, kept until the program shows whether it starts a
        #: spindle at all: a subprogram runs under the caller's spindle and starts none.
        self.never_rows: List[Tuple[int, str]] = []

    def flush_never(self) -> None:
        """Reports the cuts before the first spindle start of a program that starts one."""
        rows = getattr(self, "never_rows", [])
        if rows and getattr(self, "spindle_ever", False):
            for line, message in rows:
                self.add("spindleOff", line, "warning", message)
        self.never_rows = []

    # -- output ---------------------------------------------------------------

    def add(self, check: str, line: int, severity: str, message: str) -> None:
        if check not in self.enabled or line < self.first:
            return
        if self._kept.get(severity, 0) >= ROW_BUDGET.get(severity, MAX_ROWS):
            self.dropped += 1
            return
        self._kept[severity] = self._kept.get(severity, 0) + 1
        self._serial += 1
        self.rows.append(
            (
                line,
                ORDER[check],
                self._serial,
                {"line": line, "check": LABEL[check], "checkId": check, "severity": severity, "message": message},
            )
        )

    def note(self, key: str, line: int, message: str, severity: str = "info") -> None:
        if key in self._noted:
            return
        self._noted.add(key)
        self.notes.append({"line": max(line, self.first), "severity": severity, "message": message})

    def on(self, check: str) -> bool:
        return check in self.enabled


# ---------------------------------------------------------------------------
# The walk
# ---------------------------------------------------------------------------


def walk(run: Run) -> None:
    """Every line in program order, the lines above a selection first (their state only)."""
    cp = run.cp
    interp = run.interp
    lines = run.above + run.lines
    number = run.first - len(run.above)
    state: Optional[gedit_nc.LineState] = None
    block: Optional[Block] = None
    open_block = False
    doc = Document(run)
    for text in lines:
        tokens, state = gedit_nc.tokenize_line(text, cp, state)
        masked = gedit_nc.mask_comments(text, cp)
        lead = gedit_nc.continues_block(text, cp)
        if block is not None and not (open_block or lead):
            finish_block(run, block, doc)
            block = None
        if block is None:
            block = Block(number)
            block.cycle_before = interp.active_cycle
        interp.update(tokens, number, masked, continued=lead)
        line_tokens = [t for t in tokens if t.kind != "whitespace"]
        block.lines.append((number, text, masked, line_tokens))
        block.tokens.extend((number, t) for t in line_tokens)
        block.written.extend(written_codes(tokens, run, number))
        open_block = any(t.kind == "continuation" for t in tokens)
        if number >= run.first:
            line_checks(run, number, text, masked, line_tokens)
        doc.line(number, text, masked, line_tokens)
        number += 1
    if block is not None:
        finish_block(run, block, doc)
    doc.finish()
    finish(run)


# ---------------------------------------------------------------------------
# Checks of one line
# ---------------------------------------------------------------------------


def line_checks(run: Run, number: int, text: str, masked: str, tokens: List[gedit_nc.Token]) -> None:
    """The checks that read one line as it is written."""
    if run.on("stops") and run.stop_patterns:
        for regex in run.stop_patterns:
            match = regex.search(masked)
            if match is not None:
                written = match.group(0).strip()
                entry = run.interp.entry(written)
                label = as_dict(entry).get("label") if entry is not None else None
                run.add("stops", number, "info", "%s: %s" % (written, label or "a stop"))
                break

    if run.on("tapeMarkerInComment") and run.tape_marker and "%" in text:
        for token in tokens:
            if token.kind == "comment" and "%" in token.text:
                run.add(
                    "tapeMarkerInComment",
                    number,
                    "error",
                    "%s: a %% inside a comment ends the program when it is read in from tape or a serial line"
                    % shown(token.text),
                )
                break

    if run.on("unclosedComments"):
        for token in tokens:
            if token.kind != "comment":
                continue
            for rule in run.comment_rules:
                start, end = rule.get("start"), rule.get("end")
                if isinstance(start, str) and start and isinstance(end, str) and end and token.text.startswith(start):
                    if not token.text.endswith(end) or len(token.text) < len(start) + len(end):
                        run.add(
                            "unclosedComments",
                            number,
                            "error",
                            "%s: the comment is opened with %s and not closed with %s on its line"
                            % (shown(token.text), start, end),
                        )
                    break

    if run.on("brackets") and BRACKET_CHARS.search(masked):
        check_brackets(run, number, masked)

    if run.on("lowerCase") and run.upper_only and LOWER.search(masked):
        lower = []
        for token in tokens:
            if token.kind in ("comment", "string", "whitespace", "continuation"):
                continue
            part = token.text
            if token.kind == "call":
                part = part.split("(", 1)[0]
            if LOWER.search(part):
                lower.append(shown(token.text))
        if lower:
            run.add(
                "lowerCase",
                number,
                "info",
                "%s: written in lower case; this control reads its addresses in upper case" % ", ".join(lower[:3]),
            )

    if run.on("characters") and not text.isascii():
        for token in tokens:
            if token.kind in ("comment", "string") or token.text.isascii():
                continue
            bad = [ch for ch in token.text if ord(ch) > 127]
            if bad:
                ch = bad[0]
                name = unicodedata.name(ch, "U+%04X" % ord(ch)).lower()
                run.add(
                    "characters",
                    number,
                    "warning",
                    "%s: %s (%s) is not an ASCII character, outside a comment" % (shown(token.text), ch, name),
                )
                break
    if run.on("characters") and run.max_line is not None and len(text) > run.max_line:
        run.add(
            "characters",
            number,
            "error",
            "the block is %d characters long; the control takes at most %d" % (len(text), run.max_line),
        )

    if run.on("sequenceSeparator") and run.sequence_names and tokens:
        head = tokens[0] if tokens[0].kind != "skip" else (tokens[1] if len(tokens) > 1 else None)
        if head is not None and head.kind in ("blockNumber", "label"):
            after = [t for t in tokens if t.start >= head.end]
            nxt = after[0] if after else None
            if nxt is not None and nxt.start == head.end and nxt.kind in ("word", "keyword", "call", "variable"):
                run.add(
                    "sequenceSeparator",
                    number,
                    "error",
                    "%s%s: the sequence name has to be followed by a space or a tab" % (head.text, shown(nxt.text)),
                )

    if run.on("toolWordFormat") and run.tool_word_variant and run.tool_address is not None and run.tool_trigger is not None:
        check_tool_words(run, number, tokens)

    if run.on("programNameBlock") and run.name_alone and tokens:
        first = tokens[0]
        if first.kind == "word" and any(regex.search(first.text) for regex in run.program_start):
            others = [t for t in tokens[1:] if t.kind not in ("comment",)]
            if others:
                run.add(
                    "programNameBlock",
                    number,
                    "error",
                    "%s: the program name has to stand in a block of its own" % shown(text.strip()),
                )


def check_tool_words(run: Run, number: int, tokens: Sequence[gedit_nc.Token]) -> None:
    """`toolWordFormat`: a tool word the effective tool rule does not describe, and tool words
    of more than one length in a file (the machine's `toolWord` variant decides the form)."""
    for token in tokens:
        if token.kind != "word" or (token.address or "").upper() != run.tool_address or "=" in token.text:
            continue
        digits = (token.value_text or "").strip()
        if not digits.isdigit():
            continue
        described = run.tool_trigger.search(token.text) is not None or (
            run.tool_ignore is not None and run.tool_ignore.search(token.text) is not None
        )
        if not described:
            if not run.tool_word_stated:
                continue
            run.add(
                "toolWordFormat",
                number,
                "warning",
                "%s: not a tool word this machine's tool-word format describes (%d digits)" % (token.text, len(digits)),
            )
            continue
        if run.tool_forms and run.tool_lengths and len(digits) not in run.tool_lengths and not run.tool_mix_reported:
            first = min(run.tool_lengths.values())
            run.add(
                "toolWordFormat",
                number,
                "warning",
                "%s: a %d-digit tool word after %d-digit ones (line %d); one file should keep to one form"
                % (token.text, len(digits), next(k for k, v in run.tool_lengths.items() if v == first), first),
            )
            run.tool_mix_reported = True
        run.tool_lengths.setdefault(len(digits), number)


def check_brackets(run: Run, number: int, masked: str) -> None:
    """Unbalanced ``( )`` (where they are syntax, not a comment), ``[ ]`` and ``"``."""
    depth = {"(": 0, "[": 0}
    closer = {")": "(", "]": "["}
    in_string = False
    problem: Optional[str] = None
    for ch in masked:
        if ch == '"' and run.strings:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in depth:
            if ch == "(" and run.paren_comments:
                continue
            depth[ch] += 1
        elif ch in closer:
            opener = closer[ch]
            if depth[opener] == 0:
                problem = problem or "a %s with no %s before it" % (ch, opener)
            else:
                depth[opener] -= 1
    if problem is None:
        if run.strings and in_string:
            problem = 'a " that is not closed'
        elif depth["("] > 0 and not run.paren_comments:
            problem = "%s not closed" % plural(depth["("], "( is", "( are")
        elif depth["["] > 0:
            problem = "%s not closed" % plural(depth["["], "[ is", "[ are")
    if problem is not None:
        run.add("brackets", number, "error", "%s: %s" % (shown(masked.strip()), problem))


# ---------------------------------------------------------------------------
# Checks of one block
# ---------------------------------------------------------------------------


class Facts:
    """What the checks read off one database entry, worked out once per entry."""

    __slots__ = (
        "code", "modal", "group", "motion", "cycle", "axis_words", "conflicts", "requires",
        "alone", "data", "spindle", "radius", "length", "exit_zero", "language", "contour",
        "surface", "thread", "units", "mcall_keyword", "defines", "calls", "tap_call",
        "tap_cycle", "busy",
    )

    def __init__(self, entry: Dict[str, Any], run: "Run") -> None:
        sets = sets_of(entry)
        self.code = code_of(entry)
        self.modal = entry.get("modal") is True
        group = entry.get("group")
        self.group = group if isinstance(group, str) else None
        motion = sets.get("motion")
        self.motion = motion if motion in ("rapid", "feed") else None
        cycle = sets.get("cycle")
        self.cycle = cycle if isinstance(cycle, str) else None
        self.axis_words = gedit_nc.axis_words_of(entry)
        self.conflicts = [c for c in as_list(entry.get("conflicts")) if isinstance(c, str) and c]
        self.requires = [str(r).upper() for r in as_list(entry.get("requires")) if isinstance(r, str) and r]
        self.alone = entry.get("alone") is True
        self.data = entry.get("wordsAreData") is True
        spindle: Optional[Tuple[str, str]] = None
        if sets.get("spindle") in ("on", "off"):
            spindle = ("main", sets["spindle"])
        elif sets.get("toolSpindle") in ("on", "off"):
            spindle = ("tool", sets["toolSpindle"])
        self.spindle = spindle
        self.radius = sets.get("radiusComp") if sets.get("radiusComp") in ("on", "off") else None
        self.length = sets.get("lengthComp") if sets.get("lengthComp") in ("on", "off") else None
        self.exit_zero = sets.get("exitSpeed") == "zero"
        self.language = sets.get("language") if sets.get("language") in ("iso", "native") else None
        contour = entry.get("contour")
        self.contour = contour if contour in ("open", "close") else None
        self.surface = sets.get("speedUnit") == "surface"
        self.thread = (
            entry.get("pitchFeed") is True
            and entry.get("tapping") is not True
            and (cycle == "start" or group == "motion")
        )
        units = sets.get("units")
        self.units = units if units in ("mm", "inch") else None
        # The word that makes the call behind it modal (`MCALL CYCLE81(…)`): the database
        # says which one with `sets.cycle: 'call-modal-next'`.
        self.mcall_keyword = cycle == "call-modal-next"
        self.calls = cycle in ("call", "call-modal")
        self.defines = group == "cycle" and not self.calls
        upper = self.code.upper()
        self.tap_call = upper in run.tap_calls
        self.tap_cycle = upper in run.tap_cycles
        #: Anything at all for the block checks besides the motion and the cycle.
        self.busy = bool(
            self.conflicts or self.requires or self.alone or spindle or self.radius or self.length
            or self.exit_zero or self.language or self.contour or self.surface or self.thread
            or self.units or self.mcall_keyword or self.calls or self.defines or self.tap_call
            or self.tap_cycle
        )


def finish_block(run: Run, block: Block, doc: "Document") -> None:
    """Every check that reads a whole block and the state it runs in."""
    interp = run.interp
    emit = block.line >= run.first
    line = block.line
    written = block.written
    words = [(wline, t) for wline, t in block.tokens if t.kind == "word"]

    # -- the facts every check shares ---------------------------------------
    moves = False
    for _, t in words:
        if t.index is None and (t.value_text or "") != "" and (t.address or "").upper() in run.axes:
            moves = True
            break
    data_or_machine = False
    own_motion: Optional[str] = None
    keyword_move = False
    starts_cycle = False
    calls_cycle = False
    contour_mark: Optional[str] = None
    busy = []
    mcall_keyword = False
    for w in written:
        f = w.facts
        if f is None:
            continue
        if f.axis_words is not None:
            data_or_machine = True
        if f.motion is not None:
            if f.modal:
                run.motion_modal = f.motion
            else:
                own_motion = f.motion
                if w.kind == "keyword":
                    keyword_move = True
        if f.modal and f.group == "motion":
            previous = run.motion_code
            run.motion_code = f.code
            if run.has_exit_speed and previous is not None and previous != f.code:
                left = run.facts_of(interp.entry(previous))
                if left is not None and left.exit_zero and not f.exit_zero:
                    run.zero_speed = (previous, w.line)
        if f.cycle == "start":
            starts_cycle = True
        elif f.calls and interp.defined_cycle is not None:
            calls_cycle = True
        if f.busy:
            busy.append(w)
            if f.mcall_keyword and w.kind == "keyword":
                mcall_keyword = True
            if f.contour is not None:
                contour_mark = f.contour
            if f.units is not None:
                run.units = f.units
    rapid = False
    if run.rapid_word is not None:
        # The rapid word is `FMAX` or, written apart as a control takes it, `F MAX`: the feed
        # address with no value and the rest of the word behind it (found on the owner's
        # Klartext posts at the M10 integration, where `L A+0 C+0 R0 F MAX` is a rapid).
        head = run.feed_address
        tail = run.rapid_word[len(head):] if head and run.rapid_word.startswith(head.upper()) else ""
        previous: Optional[gedit_nc.Token] = None
        for _, t in block.tokens:
            if t.kind in ("keyword", "word") and (t.value_text or "") == "" and ((t.address or t.text) or "").upper() == run.rapid_word:
                rapid = True
                break
            if (
                tail
                and previous is not None
                and previous.kind == "word"
                and (previous.address or "").upper() == head.upper()
                and (previous.value_text or "") == ""
                and t.text.upper() == tail
            ):
                rapid = True
                break
            previous = t
    if keyword_move and not moves:
        # A path keyword moves without an axis word only with words of its own (a polar
        # `LP PR+10 PA+45`); `L M3` or `L R0 F500` alone moves nothing.
        # A number without an address is no word of the move either: it belongs to the code
        # in front of it (`L CYCL DEF 32.0 TOLERANCE`, the cycle's sub-block number; M12.5
        # decision 8, a bare `L` is no move).
        # A word behind another statement keyword of the block belongs to that statement
        # (`L CYCL DEF 32.1 T0.05`: `T` is the cycle's tolerance, `TA` its angle tolerance;
        # a cycle definition moves nothing in its own block), so only the words in front of
        # the first such keyword can move the path keyword.
        codes = {id(w.token) for w in written if w.entry is not None}
        statements = {
            id(w.token)
            for w in written
            if w.kind == "keyword"
            and w.entry is not None
            and (w.facts is None or w.facts.motion is None)
            and (w.token.address or w.token.text or "").upper() != (run.rapid_word or "")
        }
        own: List[gedit_nc.Token] = []
        for _, t in block.tokens:
            if id(t) in statements:
                break
            if t.kind == "word":
                own.append(t)
        keyword_move = any(
            id(t) not in codes
            and (t.value_text or "") != ""
            and (t.address or "") != ""
            and (t.address or "").upper() not in (run.feed_address, run.speed_address, "M")
            for t in own
        )
    motion = own_motion or run.motion_modal
    tool_change = is_tool_change(run, block)
    tool_called = tool_change
    if tool_change:
        tool = tool_of(run, block)
        if tool is not None and tool == run.last_tool:
            # The tool that is already in the spindle: a new speed or a new length, no change.
            tool_change = False
        if tool is not None:
            run.last_tool = tool

    # The modal call written behind a keyword of the database's `cycle` group.
    mcall_opened = False
    if mcall_keyword:
        calls = [w for w in written if w.kind == "call"]
        if calls:
            run.mcall = (code_of(calls[0].entry, calls[0].code), line)
            mcall_opened = True
        else:
            run.mcall = None

    runs_cycle = (starts_cycle and not mcall_opened) or calls_cycle
    if not runs_cycle and moves and not data_or_machine:
        if interp.active_cycle is not None or (run.mcall is not None and not mcall_opened):
            runs_cycle = True
    feed_move = (moves or keyword_move) and not data_or_machine and not rapid and motion == "feed"
    # A contour definition (`contour: 'open'` to `'close'`, the Okuma LAP shape between G81
    # and G80) describes a shape a later cycle cuts; its blocks do not move the machine.
    contour = run.in_contour or contour_mark == "open"
    if contour_mark is not None:
        run.in_contour = contour_mark == "open"
    cut = (feed_move or runs_cycle) and not contour

    # -- the spindle ---------------------------------------------------------
    if run.has_spindle and run.has_motion:
        spindle_cut_checks(run, block, busy, cut, tool_change, emit)

    # -- tool change inside a cycle -----------------------------------------
    if tool_change and emit and run.on("toolChangeInCycle"):
        # The cycle was in force before this block and is still in force after it: a block
        # that starts the cycle itself (`G92 X Z K T1 ...`, a thread cycle that carries a
        # tool word) or cancels it (`G80 T2 M6`) is no tool change inside one.
        # A modal call written behind a keyword is named as such, although the interpreter
        # carries its cycle as the active one too.
        modal_call = run.mcall is not None and not mcall_opened
        cycle = block.cycle_before if interp.active_cycle is not None and not modal_call else None
        if cycle is not None:
            cycle_line = as_dict(interp.state.get("activeCycle")).get("line") if interp.active_cycle == cycle else None
            run.add(
                "toolChangeInCycle",
                line,
                "warning",
                "%s: a tool change while the cycle %s%s is in force"
                % (shown(block.text()), cycle, " (line %d)" % cycle_line if isinstance(cycle_line, int) and cycle_line > 0 else ""),
            )
        elif modal_call:
            run.add(
                "toolChangeInCycle",
                line,
                "warning",
                "%s: a tool change while the modal call of %s (line %d) is in force"
                % (shown(block.text()), run.mcall[0], run.mcall[1]),
            )

    # -- an offset cancel followed by a cut (lathe) -------------------------
    if run.cancel_rule:
        if cut and run.cancelled is not None and not run.cancel_reported and emit:
            run.add(
                "offsetCancelCut",
                line,
                "warning",
                "%s: a cut after %s cancelled the tool offset (line %d), with no tool call between"
                % (shown(block.text()), run.cancelled[1], run.cancelled[0]),
            )
            run.cancel_reported = True
        for wline, t in words:
            if (t.address or "").upper() != run.tool_address or t.value is None or is_assignment(t):
                continue
            if run.tool_ignore.search(t.text) and station_of(run, t.text) not in (None, 0):
                run.cancelled = (wline, t.text)
                run.cancel_reported = False
            elif run.tool_trigger is not None and run.tool_trigger.search(t.text):
                run.cancelled = None

    # -- the speed after leaving a tapping move (`exitSpeed`) ---------------
    if run.has_exit_speed and (run.zero_speed is not None):
        if any(writes_speed(run, t) for _, t in words):
            run.zero_speed = None
        elif cut:
            if emit:
                run.add(
                    "speedAfterTapping",
                    line,
                    "error",
                    "%s: a cut after %s (left on line %d) with no new %s; leaving %s sets the spindle speed to zero"
                    % (shown(block.text()), run.zero_speed[0], run.zero_speed[1], run.speed_address, run.zero_speed[0]),
                )
            run.zero_speed = None

    # -- constant surface speed: the clamp and threads ----------------------
    surface = any(w.facts.surface for w in busy)
    if surface and run.has_clamp and run.from_start and not run.clamp_reported:
        if interp.state.get("speedLimit") is None:
            if emit:
                code = next(w for w in busy if w.facts.surface)
                run.add(
                    "cssClamp",
                    line,
                    "warning",
                    "%s: constant surface speed with no spindle speed clamp before it; the spindle speeds up as the diameter shrinks"
                    % shown(code.token.text),
                )
            run.clamp_reported = True
    if busy and interp.speed_unit == "surface" and not run.css_thread_reported:
        if any(w.facts.thread for w in busy):
            if emit:
                run.add(
                    "threadUnderCss",
                    line,
                    "warning",
                    "%s: a thread cut under constant surface speed; the speed changes with the diameter and the lead may not follow"
                    % shown(block.text()),
                )
            run.css_thread_reported = True
    if run.css_thread_reported and interp.speed_unit != "surface":
        run.css_thread_reported = False

    # -- radius and length compensation, as the block leaves them ------------
    # A conflict is judged in the state after the block's other codes: `G40 G68.2` is
    # written with the compensation off, `G41 G68.2` with it on.
    for w in busy:
        f = w.facts
        if f.radius == "on":
            run.radius_comp = (f.code, w.line)
        elif f.radius == "off":
            run.radius_comp = None
        if f.length == "on":
            run.length_comp = (f.code, w.line)
        elif f.length == "off":
            run.length_comp = None

    for w in busy:
        f = w.facts
        # -- codes the control refuses in the state in force (`conflicts`) ----
        if f.conflicts and emit:
            reason = conflict_in_force(run, w, f.conflicts)
            if reason is not None:
                run.add("stateConflicts", w.line, "warning", "%s: %s" % (shown(w.token.text), reason))
        # -- the words a block has to carry (`requires`) ----------------------
        if f.requires and emit and w.line not in run.mark_lines:
            present = {
                ((t.address or t.text) or "").upper() for _, t in block.tokens if t.kind in ("word", "keyword") and t is not w.token
            }
            if not present.intersection(f.requires):
                run.add("requiredWords", w.line, "error", "%s: the block has to write %s" % (f.code, listing(f.requires)))
        # -- a code that has to stand alone (`alone`) -------------------------
        if f.alone and emit and w.line not in run.mark_lines:
            check_alone(run, block, w)
        # -- the control language ---------------------------------------------
        if f.language == "iso" and not run.iso_reported:
            if emit:
                run.add(
                    "languageSwitch",
                    w.line,
                    "warning",
                    "%s: from here the control reads the program in its ISO dialect; these checks read it as written for this profile"
                    % f.code,
                )
            run.iso_reported = True

    # -- rigid tapping (`M29` before `G84`) ---------------------------------
    if run.tap_calls and run.tap_cycles and (busy or run.tap_pending is not None):
        rigid_tapping(run, block, busy, words, moves, emit, tool_called)

    # -- a call while no cycle is defined (Klartext) ------------------------
    if run.has_defined:
        for w in busy:
            f = w.facts
            if f.calls:
                if run.defined_known and not run.defined_seen and emit:
                    run.add(
                        "cycleUndefined",
                        w.line,
                        "error",
                        "%s: a cycle call, and no cycle is defined before it" % shown(w.token.text),
                    )
            elif f.defines:
                run.defined_seen = True
                run.defined_known = True

    # -- several S or T words, too many M codes ------------------------------
    if emit and words and run.on("blockWords"):
        check_block_words(run, block, words)

    # -- the words whose reading depends on the machine, and their digits ----
    if emit and run.reads_numbers:
        read_numbers(run, block, words)



def check_alone(run: Run, block: Block, w: "Written") -> None:
    """`aloneInBlock`: nothing else in the block (a call's arguments behind it excepted)."""
    others = []
    data = w.facts.data
    letter = head_of(w.code)
    before = True
    for _, t in block.tokens:
        if t is w.token:
            before = False
            continue
        if t.kind in ("blockNumber", "skip", "label", "comment", "continuation"):
            continue
        if data and not before:
            # The arguments of a call stand behind it; another code of its letter is not one.
            if t.kind == "word" and (t.address or "").upper() == letter and not is_assignment(t):
                others.append(t.text)
            continue
        others.append(t.text)
    if others:
        where = "in front of it or another %s code" % letter if data else "besides it"
        run.add(
            "aloneInBlock",
            w.line,
            "error",
            "%s: has to stand in a block of its own; the block writes %s %s" % (w.facts.code, shown(" ".join(others)), where),
        )


def check_block_words(run: Run, block: Block, words: Sequence[Tuple[int, gedit_nc.Token]]) -> None:
    """`blockWords`: two plain speed or tool words in a block, or more M codes than the
    control takes (`syntax.maxMCodes`). A block whose words are data (a macro call) is left out."""
    if any(w.facts is not None and w.facts.data for w in block.written):
        return
    speed = 0
    tool = 0
    m_count = 0
    for _, t in words:
        address = (t.address or "").upper()
        if address == "" or t.index is not None or "=" in t.text:
            continue
        if address == run.speed_address:
            speed += 1
        elif address == run.tool_address:
            tool += 1
        elif address == "M":
            m_count += 1
    if tool == 2 and two_tools_with_change(run, block):
        # `T7 T8 M6` (owner, 2026-10-08, M9-1): the first word is the tool the change loads
        # and the second the one the magazine prepares; the tool rule takes the first.
        tool = 1
    for address, count in ((run.speed_address, speed), (run.tool_address, tool)):
        if count > 1:
            run.add("blockWords", block.line, "error", "%s: %d %s words in one block" % (shown(block.text()), count, address))
    if run.max_m is not None and m_count > run.max_m:
        run.add(
            "blockWords",
            block.line,
            "error",
            "%s: %d M codes in one block; the control takes at most %d" % (shown(block.text()), m_count, run.max_m),
        )


def two_tools_with_change(run: Run, block: Block) -> bool:
    """`blockWords` (M12.5 decision 8): a block with two tool words is legal when it also
    writes the tool-change code — the profile's tool trigger still matches once the tool
    words are blanked out (`M6`), or the block writes `M6` itself (a lathe profile, whose
    trigger *is* the tool word, reading a mill-turn's `T01 T02 M06`) — and the tool rule
    takes the first of the two words."""
    if run.tool_trigger is None or run.tool_address is None:
        return False
    first: Optional[gedit_nc.Token] = None
    change = False
    for _, _, masked, tokens in block.lines:
        blanked = list(masked)
        for t in tokens:
            if t.kind != "word" or t.index is not None or "=" in t.text:
                continue
            address = (t.address or "").upper()
            if address == "M" and (t.value_text or "").strip().lstrip("0") == "6":
                change = True
            if address == run.tool_address:
                if first is None:
                    first = t
                for i in range(t.start, min(t.end, len(blanked))):
                    blanked[i] = " "
        if run.tool_trigger.search("".join(blanked)):
            change = True
    if not change or first is None:
        return False
    if run.tool_pattern is None:
        return True
    tool = tool_of(run, block)
    match = run.tool_pattern.search(first.text)
    if match is None:
        return False
    station = match.groupdict().get("tool") or match.group(0)
    return tool is not None and tool == (station.strip().lstrip("0") or "0")


def is_tool_change(run: Run, block: Block) -> bool:
    """A tool line of the profile's tool rule (``toolCall.trigger``, not ``toolCall.ignore``)."""
    if run.tool_trigger is None:
        return False
    for _, _, masked, _ in block.lines:
        if run.tool_trigger.search(masked) and not (run.tool_ignore is not None and run.tool_ignore.search(masked)):
            return True
    return False


def tool_of(run: Run, block: Block) -> Optional[str]:
    """The tool a block's tool line names, as the profile's ``toolCall.tool`` reads it."""
    if run.tool_pattern is None:
        return None
    for _, _, masked, _ in block.lines:
        match = run.tool_pattern.search(masked)
        if match is not None:
            station = match.groupdict().get("tool") or match.group(0)
            return station.strip().lstrip("0") or "0"
    return None


def station_of(run: Run, text: str) -> Optional[int]:
    """The station a lone tool word names (``toolCall.tool``'s group), or ``None``."""
    if run.tool_pattern is None:
        return None
    match = run.tool_pattern.search(text)
    if match is None:
        return None
    station = match.groupdict().get("tool")
    if station is None or not station.strip().isdigit():
        return None
    return int(station.strip(), 10)


def writes_speed(run: Run, token: gedit_nc.Token) -> bool:
    """A word that sets the main spindle's speed: the plain speed word, or ``S1=`` and ``S[1]=``."""
    address = (token.address or "").upper()
    if address == run.speed_address and not is_assignment(token):
        return True
    return gedit_nc.names_main_spindle(token, run.speed_address, run.main_spindle)


# -- the spindle ---------------------------------------------------------------


def spindle_cut_checks(run: Run, block: Block, busy: Sequence[Written], cut: bool, tool_change: bool, emit: bool) -> None:
    """`spindleOff` and `toolChangeSpindle`: a cut while no spindle runs."""
    running_before = bool(run.running)
    known_before = run.spindle_known
    # A tool change on a machining centre takes the tool out of the spindle: the spindle
    # stops. A turret indexes while the spindle turns, so on a lathe it changes nothing.
    if tool_change and not run.lathe:
        run.running.discard("main")
        run.spindle_known = True
        run.stop = ("toolChange", block.line, shown(block.text()))
        run.stop_reported = False
    for w in busy:
        event = w.facts.spindle
        if event is None:
            continue
        key, state = event
        spindle_event(run, key, state, w.line, w.token.text)
    if run.spindle_heads:
        for w in block.written:
            if w.entry is None and w.kind == "word" and head_of(w.code) in run.spindle_heads:
                # An M code the database does not know may start or stop a spindle.
                run.spindle_known = False
        # `M1=3`, `M2=4`: a spindle named by its number (an assignment of an `M` head).
        for wline, t in block.tokens:
            if t.kind != "word" or t.index is not None or "=" not in t.text or not is_assignment(t):
                continue
            address = (t.address or "").upper()
            head = head_of(address)
            number = address[len(head):]
            if head not in run.spindle_heads or not number.isdigit():
                continue
            facts = run.facts_of(run.interp.entry(head + (t.value_text or "").strip()))
            if facts is None:
                run.spindle_known = False
                continue
            if facts.spindle is None or facts.spindle[0] != "main":
                continue
            main = run.main_spindle is not None and gedit_nc.same_spindle(number, run.main_spindle)
            spindle_event(run, "main" if main else "n" + number, facts.spindle[1], wline, t.text)
    if not cut or not emit:
        return
    if running_before or run.running:
        return
    if not (known_before and run.spindle_known) or run.stop_reported:
        return
    kind, stop_line, stop_text = run.stop
    text = shown(block.text())
    if kind == "toolChange":
        run.add(
            "toolChangeSpindle",
            block.line,
            "warning",
            "%s: the first cut after the tool change on line %d (%s), and no spindle start between them"
            % (text, stop_line, stop_text),
        )
    elif kind == "code":
        run.add(
            "spindleOff",
            block.line,
            "warning",
            "%s: a cut while the spindle is stopped (%s on line %d)" % (text, stop_text, stop_line),
        )
    else:
        run.never_rows.append((block.line, "%s: a cut before the program starts a spindle" % text))
    run.stop_reported = True


def spindle_event(run: Run, key: str, state: str, line: int, text: str) -> None:
    run.spindle_known = True
    if state == "on":
        run.running.add(key)
        run.spindle_ever = True
    else:
        run.running.discard(key)
        if not run.running:
            run.stop = ("code", line, text)
            run.stop_reported = False


# -- conflicts -----------------------------------------------------------------


def conflict_in_force(run: Run, w: Written, conflicts: Sequence[Any]) -> Optional[str]:
    """The first condition of ``conflicts`` that holds for this code, as a sentence, or ``None``."""
    for raw in conflicts:
        if not isinstance(raw, str) or raw == "":
            continue
        negate = raw.startswith("!")
        name = raw[1:] if negate else raw
        holds, detail = condition(run, w, name)
        if holds is None:
            continue
        if holds != negate:
            if negate:
                if name.startswith("frame:"):
                    return "the control takes it only while a frame of the group '%s' is open, and none is" % name.split(":", 1)[1]
                return "the control takes it only while %s, and that is not so" % CONDITION_TEXT.get(name, name)
            text = detail or CONDITION_TEXT.get(name, name)
            return "the control refuses it while %s" % text
    return None


def condition(run: Run, w: Written, name: str) -> Tuple[Optional[bool], Optional[str]]:
    """Whether one condition of `conflicts` holds after the block, and the words that say so."""
    interp = run.interp
    if name == "tcp":
        tcp = interp.tcp
        if tcp is None:
            return (False, None)
        return (True, "tool centre point control is on (%s, line %d)" % (tcp["code"], tcp["line"]))
    if name == "radiusComp":
        if run.radius_comp is None:
            return (False, None)
        return (True, "radius compensation is on (%s, line %d)" % run.radius_comp)
    if name == "lengthComp":
        if run.length_comp is None:
            return (False, None)
        return (True, "a tool length offset is on (%s, line %d)" % run.length_comp)
    if name == "cycle":
        cycle = interp.active_cycle
        if cycle is not None and cycle != code_of(w.entry, w.code):
            return (True, "the cycle %s is in force" % cycle)
        if run.mcall is not None:
            return (True, "the modal call of %s is in force" % run.mcall[0])
        return (False, None)
    if name == "surfaceSpeed":
        unit = interp.speed_unit
        if unit == "unknown":
            return (None, None)
        return (unit == "surface", None)
    if name == "feedNotPerMinute":
        unit = interp.feed_unit
        if unit == "unknown":
            return (None, None)
        return (unit != "per-minute", "the feed is %s, not per minute" % unit.replace("-", " "))
    if name.startswith("frame:"):
        group = name.split(":", 1)[1]
        own = code_of(w.entry, w.code)
        for frame in reversed(interp.open_frames):
            if frame["code"] == own and frame["line"] == w.line:
                continue
            entry = interp.entry(frame["code"])
            if as_dict(entry).get("group") == group:
                return (True, "the frame of %s (line %d) is open" % (frame["code"], frame["line"]))
        return (False, None)
    return (None, None)


# -- rigid tapping ---------------------------------------------------------------


def rigid_tapping(
    run: Run,
    block: Block,
    busy: Sequence[Written],
    words: Sequence[Tuple[int, gedit_nc.Token]],
    moves: bool,
    emit: bool,
    tool_called: bool = False,
) -> None:
    """The tapping call (`M29`) before its cycle: no speed word and no move between the two,
    and never inside a running tapping cycle.

    The call is only a tapping call if a tapping cycle follows it: on a machine where the
    same M number means something else (a lathe's live tool), speeds and moves behind it
    are ordinary. So a speed word or a move is **remembered** behind the call and reported
    only when a tapping cycle then starts; a new call (which announces that cycle itself),
    a tool call or the end of the program drops it."""
    tap_call = next((w.facts.code for w in busy if w.facts.tap_call), None)
    starts_cycle = any(w.facts.tap_cycle for w in busy)
    if tap_call is not None:
        if block.cycle_before is not None and block.cycle_before.upper() in run.tap_cycles and not starts_cycle:
            if emit:
                run.add(
                    "rigidTapping",
                    block.line,
                    "error",
                    "%s: written while the tapping cycle %s is in force" % (shown(block.text()), block.cycle_before),
                )
            run.tap_pending = None
            return
        run.tap_pending = None if starts_cycle else (tap_call, block.line, None)
        return
    if run.tap_pending is None:
        return
    code, line, found = run.tap_pending
    if starts_cycle:
        if found is not None and emit:
            what_line, what, text = found
            run.add(
                "rigidTapping",
                what_line,
                "error",
                "%s: %s between %s (line %d) and the tapping cycle" % (text, what, code, line),
            )
        run.tap_pending = None
        return
    if tool_called:
        run.tap_pending = None
        return
    if found is None and emit:
        speed = any(writes_speed(run, t) for _, t in words)
        if speed or moves:
            what = "a spindle speed" if speed else "a move"
            run.tap_pending = (code, line, (block.line, what, shown(block.text())))


# -- numbers ---------------------------------------------------------------------

#: The number classes a "dimension word" has.
DIMENSION_CLASSES = ("length", "angle")


def unit_text(number_class: str, units: str) -> str:
    inch = units == "inch"
    if number_class == "length":
        return "in" if inch else "mm"
    if number_class == "angle":
        return "°"
    if number_class == "feedPerMin":
        return "in/min" if inch else "mm/min"
    if number_class == "feedPerRev":
        return "in/rev" if inch else "mm/rev"
    if number_class == "dwell":
        return "s"
    return ""


def value_text(value: Optional[str], number_class: str, units: str) -> str:
    if value is None:
        return "no value"
    unit = unit_text(number_class, units)
    if unit == "°":
        return value + unit
    return "%s %s" % (value, unit) if unit else value


def short_label(preset: Dict[str, Any]) -> str:
    label = preset.get("label")
    if not isinstance(label, str) or label == "":
        label = str(preset.get("preset") or preset.get("id") or "")
    return label.split(":", 1)[0].strip()


def read_numbers(run: Run, block: Block, words: Sequence[Tuple[int, gedit_nc.Token]]) -> None:
    """`machineReading` and `wordDigits`: what each written number is worth on this machine."""
    interp = run.interp
    profile = run.profile
    units = run.units
    entries: Optional[List[Dict[str, Any]]] = None
    in_force: Optional[List[Dict[str, Any]]] = None
    block_key: Optional[Tuple[Any, ...]] = None
    chosen = as_dict(run.machine.get("source")).get("numberInput") == "machine"
    reading = run.on("machineReading") and (run.every_number is None or not run.unit_system)
    digits = run.on("wordDigits") and run.max_digits is not None
    for line, t in words:
        literal = t.value
        if literal is None or not t.address or "=" in t.text:
            continue
        # Cheap tests first: a number with a point is read alike on every increment
        # machine, and a short number cannot have too many digits.
        want_reading = reading and (not literal.has_point or run.unit_system)
        want_digits = digits and len((literal.int_part or "").lstrip("0")) + 4 > run.max_digits
        if not want_reading and not want_digits:
            continue
        if entries is None:
            entries = block.entries
            cycle = interp.active_cycle
            entry = interp.entry(cycle) if cycle else None
            in_force = [entry] if entry is not None else []
            block_key = (tuple(id(e) for e in entries), tuple(id(e) for e in in_force), interp.feed_unit, interp.pitch_feed)
        class_key = (t.address, block_key)
        if class_key in run._classes:
            cls = run._classes[class_key]
        else:
            cls = gedit_nc.number_class_of(t.address, profile, interp.feed_unit, entries, interp.pitch_feed, in_force)
            run._classes[class_key] = cls
        if want_digits:
            check_digits(run, line, t, cls, units, chosen)
        if not want_reading or cls not in DIMENSION_CLASSES:
            continue
        if chosen:
            if literal.has_point:
                continue
            value = gedit_nc.value_of(literal, cls, run.machine, units)
            pointed = gedit_nc.parse_number(literal.raw + ".")
            other = gedit_nc.value_of(pointed, cls, run.machine, units) if pointed is not None else None
            if value is not None and other is not None and value != other:
                run.add(
                    "machineReading",
                    line,
                    "info",
                    "%s: %s on machine '%s'; %s. would be %s"
                    % (t.text, value_text(value, cls, units), run.machine.get("name") or "", t.text, value_text(other, cls, units)),
                )
            continue
        reading_key = (literal.raw, bool(literal.has_point), cls, units)
        if reading_key in run._readings:
            value, readings = run._readings[reading_key]
        else:
            value, readings = gedit_nc.resolve_value(literal, cls, run.machine, profile, units)
            run._readings[reading_key] = (value, readings)
        if value is not None or not readings:
            continue
        if len(run.reading_rows) >= MAX_ROWS and not run.unit_system:
            # The list would be cut at the end anyway (`cap_rows`); do not build its text.
            run.readings_dropped += 1
            continue
        parts = []
        for i, item in enumerate(readings):
            parts.append(
                "%s by '%s'%s" % (value_text(item.get("value"), cls, units), short_label(item), " (the assumed default)" if i == 0 else "")
            )
        text = "%s: read as %s; choose a machine" % (t.text, listing(parts))
        if run.unit_system:
            if run.every_number is None:
                run.every_number = (line, "the unit system decides every value, written with a point or without: %s" % text)
            reading = False
            continue
        run.reading_rows.append((line, text))


def check_digits(run: Run, line: int, t: gedit_nc.Token, cls: Optional[str], units: str, chosen: bool) -> None:
    """`wordDigits`: a word with more digits than the control stores (`syntax.maxWordDigits`)."""
    limit = run.max_digits
    assert limit is not None
    literal = t.value
    if cls is None or cls in ("count", "increment"):
        count = digits_of(literal.raw)
        if count > limit:
            run.add("wordDigits", line, "error", "%s: %d digits; the control takes at most %d" % (t.text, count, limit))
        return
    readings: List[Dict[str, Any]] = []
    if chosen:
        readings = [run.machine]
    else:
        readings = [{"numberInput": as_dict(p.get("value"))} for p in run.presets] or [run.machine]
    counts = []
    for machine in readings:
        count = increments_of(literal, cls, machine, units)
        if count is None:
            return
        counts.append(count)
    if counts and min(counts) > limit:
        run.add(
            "wordDigits",
            line,
            "error",
            "%s: %d digits once it is converted to increments; the control takes at most %d" % (t.text, min(counts), limit),
        )


def increments_of(literal: Any, cls: str, machine: Dict[str, Any], units: str) -> Optional[int]:
    """How many digits a word has once the control has converted it to increments.

    A count of increments (a word without a point on an increment machine) and a scaled
    word keep their digits; any other word is its value in steps of the class's increment,
    whose digits are the literal's with as many decimals as the step has (the steps the
    profiles declare are powers of ten). ``None`` when the step is not one.
    """
    params = as_dict(machine.get("params")) if "params" in machine else machine
    number_input = as_dict(params.get("numberInput"))
    entry = as_dict(as_dict(number_input.get("classes")).get(cls))
    mode = entry.get("mode") or number_input.get("mode")
    if mode == "scale" or (mode == "increment" and not literal.has_point):
        return digits_of(literal.raw)
    if cls == "angle":
        step = entry.get("increment") or number_input.get("incrementDeg") or number_input.get("incrementMm")
    elif cls == "dwell":
        step = entry.get("increment") or number_input.get("incrementSec") or number_input.get("incrementMm")
    elif units == "inch":
        step = entry.get("incrementInch") or number_input.get("incrementInch")
    else:
        step = entry.get("increment") or number_input.get("incrementMm")
    if not isinstance(step, str):
        return digits_of(literal.raw)
    match = re.match(r"^0*(?:\.(0*)1|1)$", step.strip())
    if match is None:
        return None
    decimals = len(match.group(1)) + 1 if match.group(1) is not None else 0
    frac = (literal.frac_part or "")[:decimals].ljust(decimals, "0")
    return len(((literal.int_part or "") + frac).lstrip("0"))


# ---------------------------------------------------------------------------
# The program as a whole: the frame, the targets, the jumps, DO and END
# ---------------------------------------------------------------------------


class Program:
    """One program of the document, from a start marker (or the top) to the next one."""

    def __init__(self, line: int, start_text: Optional[str], name: Optional[str] = None) -> None:
        self.line = line
        self.start_text = start_text
        #: The name the start line gives the program (the start pattern's `name` group).
        self.name = name
        self.code_lines = 0
        self.any_end = False
        #: The last code line is a jump that cannot fall through (`UNCONDITIONAL_JUMPS`).
        self.ends_in_jump = False
        self.hard_end: Optional[Tuple[int, str]] = None
        self.after_end_reported = False
        #: The first code line after the end: (line, text, its block number).
        self.after_end: Optional[Tuple[int, str, Optional[int]]] = None
        self.numbers: Dict[int, List[int]] = {}
        self.labels: Dict[str, List[int]] = {}
        #: line, keyword, target, 'number' or 'label', the reference as written
        self.jumps: List[Tuple[int, str, str, str, str]] = []
        self.profiles: List[Tuple[int, Optional[int], Optional[int], str]] = []
        self.calls: List[int] = []
        self.dos: List[Tuple[int, int]] = []


def ends_in_jump(tokens: Sequence[gedit_nc.Token]) -> bool:
    """A block that is one unconditional jump (`GOTOB START`): the jump keyword is the first
    keyword of the block and the block is not skipped (`/`)."""
    for t in tokens:
        if t.kind == "skip":
            return False
        if t.kind == "keyword":
            return (t.address or t.text or "").upper() in UNCONDITIONAL_JUMPS
    return False


def is_code(token: gedit_nc.Token) -> bool:
    """A token that is part of a program's code: not a comment, a block number, a marker or a
    run of control characters (the NUL leader of a punched tape)."""
    if token.kind in ("comment", "continuation", "blockNumber", "skip", "programMarker", "whitespace"):
        return False
    return any(ch.isprintable() and not ch.isspace() for ch in token.text)


class Document:
    """The checks that need the whole program: `programFrame`, `profileTargets`,
    `callInProfile`, `jumpTargets`, `doEnd` and `modalCallOpen` at the end codes."""

    def __init__(self, run: Run) -> None:
        self.run = run
        self.whole = not run.selection
        self.programs: List[Program] = []
        self.current = Program(run.first, None)
        self.programs.append(self.current)
        self.tape: List[int] = []
        self.tape_closed: Optional[int] = None
        self.after_tape_reported = False
        self.first_code: Optional[int] = None
        #: The last line of the document that holds any text (where an end check reports).
        self.last_text: Optional[int] = None
        #: The first line of the document that holds any text.
        self.first_text: Optional[str] = None

    def line(self, number: int, text: str, masked: str, tokens: List[gedit_nc.Token]) -> None:
        run = self.run
        if number < run.first:
            # Above a selection: only a new program matters, for the state it resets.
            if any(r.search(masked) for r in run.program_start):
                run._reset_program()
            return
        if text.strip():
            self.last_text = number
            if self.first_text is None:
                self.first_text = text.strip()
        code_tokens = [t for t in tokens if is_code(t)]
        tape = run.tape_marker and len(tokens) == 1 and tokens[0].kind == "programMarker" and tokens[0].text.strip() == "%"
        start = None if tape else next((m for m in (r.search(masked) for r in run.program_start) if m is not None), None)
        if tape:
            self.on_tape(number)
            return
        if self.tape_closed is not None and code_tokens and self.whole and not self.after_tape_reported:
            run.add("programFrame", number, "error", "%s: after the closing %% on line %d; the control never reads it" % (shown(text.strip()), self.tape_closed))
            self.after_tape_reported = True
        if start is not None:
            self.on_start(number, text.strip(), start.groupdict().get("name"))
        elif code_tokens:
            self.on_code(number, text, masked, tokens)
        program = self.current
        for t in tokens:
            if t.kind == "blockNumber" and t.value_text and t.value_text.isdigit():
                program.numbers.setdefault(int(t.value_text, 10), []).append(number)
            elif t.kind == "label" and t.address and defines_label(tokens, t):
                program.labels.setdefault(t.address.upper(), []).append(number)
        if run.call_patterns and any(r.search(masked) for r in run.call_patterns):
            program.calls.append(number)
        self.read_references(number, masked, tokens)
        self.read_do_end(number, tokens)
        if code_tokens and start is None:
            self.first_code = self.first_code or number

    # -- the frame -------------------------------------------------------------

    def on_tape(self, number: int) -> None:
        run = self.run
        self.tape.append(number)
        if len(self.tape) == 1 and self.first_code is None:
            return
        program = self.current
        if self.tape_closed is None and program.code_lines > 0 and not program.any_end and self.whole:
            run.add(
                "programFrame",
                number,
                "error",
                "%%: the tape ends here, and the program%s has no end code"
                % (" " + shown(program.start_text) + " (line %d)" % program.line if program.start_text else ""),
            )
        if self.tape_closed is None:
            self.tape_closed = number

    def on_start(self, number: int, text: str, name: Optional[str] = None) -> None:
        run = self.run
        program = self.current
        if program.code_lines > 0 and not program.any_end and self.whole:
            run.add(
                "programFrame",
                number,
                "error",
                "%s: a new program starts, and the one before it%s has no end code"
                % (shown(text), " (" + shown(program.start_text) + ", line %d)" % program.line if program.start_text else ""),
            )
        self.close(program)
        self.current = Program(number, text, name)
        self.programs.append(self.current)
        run._reset_program()

    def on_code(self, number: int, text: str, masked: str, tokens: List[gedit_nc.Token]) -> None:
        run = self.run
        program = self.current
        hard = None
        for regex in run.program_end:
            match = regex.search(masked)
            if match is not None:
                hard = match
                break
        soft = hard is None and any(r.search(masked) for r in run.end_patterns)
        conditional = hard is not None and (
            any(t.kind == "skip" for t in tokens)
            or any(t.kind == "keyword" and t.start < hard.start() and not (t.start <= hard.start() < t.end) for t in tokens)
        )
        if program.hard_end is not None and self.whole and not program.after_end_reported:
            if any(t.kind == "label" for t in tokens):
                # A label after the end is a jump target: what follows it can run.
                program.after_end_reported = True
            elif hard is not None and not conditional:
                run.add("programFrame", number, "warning", "%s: the program end is written a second time (line %d)" % (shown(text.strip()), program.hard_end[0]))
                program.after_end_reported = True
            else:
                # Judged once the program is read: a jump may name this block's number.
                numbers = [int(t.value_text, 10) for t in tokens if t.kind == "blockNumber" and (t.value_text or "").isdigit()]
                program.after_end = (number, shown(text.strip()), numbers[0] if numbers else None)
                program.after_end_reported = True
        program.code_lines += 1
        program.ends_in_jump = ends_in_jump(tokens)
        if hard is not None and run.end_record and program.name and self.whole:
            # M12.5 decision 9: the closing record names the program as its start does
            # (`END PGM T MM` closes `BEGIN PGM T MM`).
            after = masked[hard.end():].split()
            closing = after[0] if after else None
            if closing is not None and closing.upper() != program.name.upper():
                run.add(
                    "programFrame",
                    number,
                    "error",
                    "%s: the end names the program %s, and its start on line %d names it %s"
                    % (shown(text.strip()), shown(closing), program.line, shown(program.name)),
                )
        if hard is not None and not conditional:
            program.any_end = True
            if program.hard_end is None:
                program.hard_end = (number, hard.group(0).strip())
                if run.mcall is not None:
                    run.add(
                        "modalCallOpen",
                        number,
                        "warning",
                        "%s: the modal call of %s (line %d) is still in force at the end of the program" % (hard.group(0).strip(), run.mcall[0], run.mcall[1]),
                    )
        elif soft or hard is not None:
            program.any_end = True

    def on_end_of_file(self) -> None:
        run = self.run
        if not self.whole:
            return
        self.check_end_at_end_of_file()
        if run.tape_marker and len(self.tape) == 1 and self.first_code is not None:
            only = self.tape[0]
            if only < self.first_code:
                run.add("programFrame", only, "info", "%: the tape starts here and has no closing %; a transfer that reads to the closing % needs one")
            else:
                run.add("programFrame", only, "info", "%: the tape ends here and has no opening % before the program; a transfer that starts at the first % needs one")

    def check_end_at_end_of_file(self) -> None:
        """M12.5 decision 9: the file ends inside a program that has no end. A program
        with a closing record (Klartext `BEGIN PGM` without `END PGM`), and a main program of
        a control whose main programs have to end with an end code (`SUBPROGRAM_EXTENSIONS`;
        a subprogram returns at its last line and is not judged). Both are what a file cut
        short looks like. Reported once, at the last line that holds text."""
        run = self.run
        program = self.current
        if program.code_lines == 0 or program.any_end or self.last_text is None:
            return
        if run.end_record:
            if program.start_text is None:
                return
            run.add(
                "programFrame",
                self.last_text,
                "error",
                "the file ends here, and the program %s (line %d) has no end; the file may be cut short"
                % (shown(program.start_text), program.line),
            )
            return
        if not run.main_needs_end or run.subprogram_file or run.untitled:
            # An untitled document has no file name to say main program or subprogram: a
            # pasted subprogram body or a snippet is no file cut short.
            return
        if program.start_text is not None and SUBPROGRAM_START.search(program.start_text):
            return
        if program.ends_in_jump:
            return
        if program is self.programs[0] and self.first_text is not None and COMMENTED_SUBPROGRAM_HEADER.search(self.first_text):
            return
        if len(self.programs) > 1 and program.start_text is not None and ARCHIVE_DATA_START.search(program.start_text):
            return
        run.add(
            "programFrame",
            self.last_text,
            "error",
            "the file ends here, and the main program%s has no end code; the file may be cut short"
            % (" " + shown(program.start_text) + " (line %d)" % program.line if program.start_text else ""),
        )

    # -- references and jumps -----------------------------------------------

    def read_references(self, number: int, masked: str, tokens: List[gedit_nc.Token]) -> None:
        run = self.run
        hits = [(trigger.search(masked), addresses, local) for trigger, addresses, local in run.references]
        elsewhere = {a for match, addresses, local in hits if match is not None and not local for a in addresses}
        for match, addresses, local in hits:
            if match is None or not local or elsewhere.intersection(addresses):
                continue
            if "P" in addresses and "Q" in addresses:
                p = word_number(tokens, "P")
                q = word_number(tokens, "Q")
                self.current.profiles.append((number, p, q, match.group(0).strip()))
                continue
            for address in addresses:
                target = jump_target(tokens, address, match.end(), run.has_labels)
                if target is not None:
                    keyword = match.group(0).split()[-1].upper() if match.group(0).split() else ""
                    written = target[2]
                    if address == "N" or (address != keyword and not target[2].upper().startswith(keyword)):
                        written = "%s %s" % (keyword, target[2])
                    jump = (number, keyword, target[0], target[1], written)
                    if not any(j[0] == number and j[2] == target[0] for j in self.current.jumps):
                        self.current.jumps.append(jump)

    def read_do_end(self, number: int, tokens: List[gedit_nc.Token]) -> None:
        run = self.run
        if not run.on("doEnd") or "DO" not in run.keywords or "END" not in run.keywords:
            return
        for t in tokens:
            if t.kind != "keyword" or (t.address or "").upper() not in ("DO", "END"):
                continue
            name = (t.address or "").upper()
            raw = (t.value_text or "").strip()
            if not raw.isdigit():
                continue
            n = int(raw, 10)
            dos = self.current.dos
            if name == "DO":
                if n not in DO_NUMBERS:
                    run.add("doEnd", number, "error", "DO%d: a loop number has to be %s" % (n, listing([str(x) for x in DO_NUMBERS])))
                    continue
                if any(d == n for d, _ in dos):
                    run.add("doEnd", number, "error", "DO%d: a DO%d is already open (line %d)" % (n, n, next(l for d, l in dos if d == n)))
                    continue
                dos.append((n, number))
            else:
                if not dos or all(d != n for d, _ in dos):
                    run.add("doEnd", number, "error", "END%d: closes no open DO%d" % (n, n))
                    continue
                if dos[-1][0] != n:
                    run.add(
                        "doEnd",
                        number,
                        "error",
                        "END%d: the loop DO%d (line %d) is still open inside it; the loops cross" % (n, dos[-1][0], dos[-1][1]),
                    )
                # The END closes its own DO; a loop it crossed stays open for its own END.
                for i in range(len(dos) - 1, -1, -1):
                    if dos[i][0] == n:
                        del dos[i]
                        break

    def close(self, program: Program) -> None:
        run = self.run
        for n, line in program.dos:
            if self.whole:
                run.add("doEnd", line, "error", "DO%d: no END%d follows in the program" % (n, n))
        program.dos = []

    def finish(self) -> None:
        self.close(self.current)
        self.on_end_of_file()
        run = self.run
        if not self.whole:
            if any(run.on(c) for c in ("programFrame", "profileTargets", "callInProfile", "jumpTargets")):
                run.note(
                    "whole",
                    run.first,
                    "The program frame, the jump targets and the profile targets need the whole program; they are not checked in a selection.",
                )
            return
        for program in self.programs:
            self.check_after_end(program)
            self.check_profiles(program)
            self.check_jumps(program)

    def check_after_end(self, program: Program) -> None:
        if program.after_end is None or program.hard_end is None:
            return
        line, text, number = program.after_end
        if number is not None and any(kind == "number" and int(target, 10) == number for _, _, target, kind, _ in program.jumps):
            return
        self.run.add(
            "programFrame",
            line,
            "error",
            "%s: after the program end %s on line %d; it never runs" % (text, program.hard_end[1], program.hard_end[0]),
        )

    def check_profiles(self, program: Program) -> None:
        run = self.run
        if not run.lathe:
            return
        for line, p, q, code in program.profiles:
            p_lines = program.numbers.get(p, []) if p is not None else []
            q_lines = program.numbers.get(q, []) if q is not None else []
            if p is not None and not p_lines:
                run.add("profileTargets", line, "error", "%s: P%d names no block of this program" % (code, p))
            if q is not None and not q_lines:
                run.add("profileTargets", line, "error", "%s: Q%d names no block of this program" % (code, q))
            if p_lines and q_lines:
                start, end = p_lines[0], q_lines[-1]
                if start > end:
                    run.add("profileTargets", line, "error", "%s: the block of P%d (line %d) stands after the block of Q%d (line %d)" % (code, p, start, q, end))
                    continue
                for call in program.calls:
                    if start <= call <= end:
                        run.add(
                            "callInProfile",
                            call,
                            "error",
                            "a subprogram call inside the profile N%d to N%d that %s on line %d runs" % (p, q, code, line),
                        )

    def check_jumps(self, program: Program) -> None:
        run = self.run
        targeted: Set[Tuple[str, str]] = set()
        #: Jumps to a name that no label has but that is the beginning of labels that exist
        #: (`GOTOF TOOL` over `TOOL_1_0:`, `TOOL_2_0:`). A name can be a string variable on a
        #: control that takes one, and a post that builds its labels from a variable
        #: is the common case; the check cannot see the variable, so it says nothing about
        #: these jumps or about a label of that family written twice (found on the owner's
        #: Sinumerik tool-search posts at the M10 integration).
        computed: Set[str] = set()
        for line, keyword, target, kind, written in program.jumps:
            if kind == "number":
                lines = program.numbers.get(int(target, 10), [])
                shown_target = "N" + target
            else:
                lines = program.labels.get(target.upper(), [])
                shown_target = written.split()[-1] if written.split() else target
            targeted.add((kind or "label", target.upper() if kind != "number" else str(int(target, 10))))
            if not lines:
                if keyword in JUMP_MAY_MISS:
                    continue
                if kind != "number" and any(name.startswith(target.upper()) and name != target.upper() for name in program.labels):
                    computed.add(target.upper())
                    continue
                run.add("jumpTargets", line, "error", "%s: no block %s in this program" % (written, shown_target))
                continue
            direction = JUMP_DIRECTION.get(keyword)
            if direction == "forward" and all(l < line for l in lines):
                run.add("jumpTargets", line, "warning", "%s: jumps forward, and %s stands above it (line %d)" % (written, shown_target, lines[0]))
            elif direction == "backward" and all(l > line for l in lines):
                run.add("jumpTargets", line, "warning", "%s: jumps back, and %s stands below it (line %d)" % (written, shown_target, lines[0]))
            if len(lines) > 1:
                run.add(
                    "jumpTargets",
                    line,
                    "warning" if kind == "number" else "error",
                    "%s: %s stands on %s (lines %s)" % (written, shown_target, plural(len(lines), "line", "lines"), ", ".join(str(l) for l in lines)),
                )
        if run.has_labels:
            for name, lines in sorted(program.labels.items()):
                if len(lines) > 1 and ("label", name) not in targeted and not any(name.startswith(c) for c in computed):
                    run.add("jumpTargets", lines[1], "error", "%s: the label is defined twice (lines %s)" % (name, ", ".join(str(l) for l in lines)))


def defines_label(tokens: Sequence[gedit_nc.Token], label: gedit_nc.Token) -> bool:
    """A label at the head of its block defines it; one behind a jump names it."""
    for t in tokens:
        if t is label:
            return True
        if t.kind not in ("skip", "blockNumber", "whitespace"):
            return False
    return False


def is_expression_target(rest: Sequence[gedit_nc.Token]) -> bool:
    """A jump target written as an expression, which the check does not judge (M12.5
    decision 8; the Sinumerik programming manual allows a string, a variable and a
    concatenation as the target of `GOTOF`/`GOTOB`): a string (`GOTOF "STEP_"<<COUNTER`),
    a variable (`GOTOF R10`) or a name joined to something by an operator (`COUNT<<1`)."""
    code = [t for t in rest if t.kind not in ("whitespace", "comment")]
    if not code:
        return False
    head = code[0]
    if head.kind in ("string", "variable"):
        return True
    if len(code) > 1 and code[1].kind == "operator" and code[1].text != ":" and head.kind in ("unknown", "word", "label"):
        return True
    return False


def word_number(tokens: Sequence[gedit_nc.Token], address: str) -> Optional[int]:
    for t in tokens:
        if t.kind == "word" and (t.address or "").upper() == address and (t.value_text or "").isdigit():
            return int(t.value_text, 10)
    return None


def jump_target(tokens: Sequence[gedit_nc.Token], address: str, after: int, names: bool) -> Optional[Tuple[str, str, str]]:
    """The target of a jump: ``(text, 'number' | 'label', the jump as written)``, or ``None``.

    ``address`` is the reference rule's: ``N`` (the block number or label behind the jump
    keyword — `GOTOF LABEL1`, `GOTO NLAP1`, `GOTOB :20`) or an address whose value is the
    target (`GOTO` of `GOTO 100`, the `Q` of `M98 Q20`).
    """
    if address == "N":
        rest = [t for t in tokens if t.start >= after]
        if names and is_expression_target(rest):
            return None
        for i, t in enumerate(rest):
            if t.kind == "label" and t.address:
                return (t.address.upper(), "label", t.text)
            if t.kind == "blockNumber" and (t.value_text or "").isdigit():
                return (t.value_text, "number", t.text)
            if t.kind == "word" and (t.address or "").upper() == "N" and (t.value_text or "").isdigit():
                return (t.value_text, "number", t.text)
            if t.kind == "operator" and t.text == ":" and i + 1 < len(rest):
                nxt = rest[i + 1]
                if nxt.kind == "word" and nxt.address is None and (nxt.value_text or "").isdigit():
                    return (nxt.value_text, "number", ":" + nxt.text)
            if names and t.kind in ("unknown", "word") and re.match(r"^[A-Z_][A-Z0-9_]*$", t.text.upper()):
                return (t.text.upper(), "label", t.text)
            if t.kind == "comment":
                return None
        return None
    for t in tokens:
        name = (t.address or "").upper()
        if name == address and (t.value_text or "").strip().isdigit() and t.kind in ("word", "keyword"):
            return (t.value_text.strip(), "number", t.text)
    return None


# ---------------------------------------------------------------------------
# The end of the run
# ---------------------------------------------------------------------------


def finish(run: Run) -> None:
    run.flush_never()
    if run.every_number is not None:
        line, text = run.every_number
        run.add("machineReading", line, "info", text)
    else:
        for line, text in run.reading_rows:
            run.add("machineReading", line, "info", text)
        run.dropped += run.readings_dropped
    if run.selection and not run.from_start:
        run.note(
            "above",
            run.first,
            "The lines above the selection were not sent, so the spindle, the cycles and the clamp in force at line %d are not known; those checks start judging where the selection sets them."
            % run.first,
        )
    if (run.on("spindleOff") or run.on("toolChangeSpindle")) and not (run.has_spindle and run.has_motion) and run.codes:
        run.note(
            "spindle-data",
            run.first,
            "The code database does not say which codes start and stop the spindle and which moves are rapid, so cuts with the spindle stopped are not checked.",
        )


def machine_sentence(run: Run) -> str:
    machine = run.machine
    name = machine.get("name")
    source = as_dict(machine.get("source")).get("numberInput")
    number_input = as_dict(as_dict(machine.get("params")).get("numberInput"))
    head = "Machine '%s'" % name if isinstance(name, str) and name else "No machine chosen"
    if source == "machine" and number_input:
        mode = number_input.get("mode")
        step = number_input.get("incrementMm")
        if mode == "increment" and isinstance(step, str):
            return "%s: numbers without a point are increments of %s mm." % (head, step)
        if mode == "scale" and isinstance(step, str):
            return "%s: every number counts in units of %s mm." % (head, step)
        if mode == "calculator":
            return "%s: every number is read as written." % head
        return "%s." % head
    if len(run.presets) > 1:
        return "%s: where the presets read a number differently, the finding lists every reading." % head
    return "%s." % head


def cap_rows(ordered: List[Dict[str, Any]], limit: int = MAX_ROWS) -> Tuple[List[Dict[str, Any]], int]:
    """At most ``limit`` rows of a report already in line order, and how many were left out.

    Errors are kept before warnings and warnings before information, each in line order, so
    a program with a reading for every word still shows the error on its last line; what is
    kept stays in line order.
    """
    if len(ordered) <= limit:
        return ordered, 0
    chosen = sorted(range(len(ordered)), key=lambda i: (RANK.get(ordered[i]["severity"], 2), i))[:limit]
    chosen.sort()
    return [ordered[i] for i in chosen], len(ordered) - limit


def summary(run: Run, rows: Sequence[Dict[str, Any]]) -> str:
    if not rows:
        lead = "No findings."
    else:
        checks = {row["checkId"] for row in rows}
        lead = "%s in %s." % (plural(len(rows), "finding", "findings"), plural(len(checks), "check", "checks"))
    return "%s %s" % (lead, machine_sentence(run))


def main() -> int:
    context = gedit_nc.load_context()
    lines = gedit_nc.read_input()
    profile = context.get("profile")
    if not isinstance(profile, dict) or not profile:
        print(
            "Program checks needs a dialect profile. Run it from gEdit, which puts the profile into the script context.",
            file=sys.stderr,
        )
        return 1
    try:
        run = Run(context, lines)
    except ValueError as err:
        print("Program checks cannot use this profile: %s" % err, file=sys.stderr)
        return 1
    walk(run)
    rows, cut = cap_rows([row for _, _, _, row in sorted(run.rows, key=lambda r: (r[0], r[1], r[2]))])
    left_out = cut + run.dropped
    if left_out:
        run.note(
            "rows-cut",
            run.first,
            "%s not listed: the results list holds at most %d rows. Information was left out first, then warnings, and the rows kept are in line order. "
            "Choose a machine for this document, or untick a check, to make the list shorter."
            % (plural(left_out, "finding is", "findings are"), MAX_ROWS),
            "warning",
        )
    columns = [
        {"key": "line", "label": "Line"},
        {"key": "check", "label": "Check"},
        {"key": "severity", "label": "Severity"},
        {"key": "message", "label": "Finding"},
    ]
    gedit_nc.report(TITLE, columns, rows, summary(run, rows), run.notes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
